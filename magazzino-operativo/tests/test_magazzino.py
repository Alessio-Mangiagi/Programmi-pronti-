# "><(((º> sabusabu <º)))><"
"""Test del Magazzino Operativo: codici a barre, importazione DDT e mezzi,
giacenze e scansione via API."""
import json
import os

import pytest

import codici
import config
import importa_ddt
import importa_mezzi

EXPORT_GREZZO = {
    "sheets": [{
        "name": "F1-Dettaglio DDT",
        "headers": ["Cedente", "P.IVA Cedente", "N°DDT", "Data", "Luogo Destinazione", "Targa", "Tipo Materiale",
                    "Quantità Mc", "Peso Kg"],
        "rows": [
            ["Cave Etna S.r.l.", "02988140873", "118", "03/03/2026", "Cantiere Augusta", "CT884AB", "Misto stabilizzato", "14", ""],
            ["Cave Etna S.r.l.", "02988140873", "131", "10/03/2026", "Cantiere Augusta", "CT884AB", "Pietrisco 20/40", "(illeggibile)", "18200"],
            ["Cave Etna S.r.l.", "02988140873", "140", "17/03/2026", "Cantiere Augusta", "", "", "5", ""],
        ],
    }],
}


def consegne(righe, salvato="2026-10-09T12:43:04.438Z", export="Cava Etna marzo.json"):
    return {"versione": 1, "perExport": {export: {"salvatoIl": salvato, "righe": righe}}}


def riga(**kw):
    base = {"commessa": "demo", "export": "Cava Etna marzo.json", "fornitore": "Cave Etna S.r.l.", "piva": "02988140873",
            "ddt": "118", "data": "03/03/2026", "dataIso": "2026-03-03", "materiale": "Misto stabilizzato",
            "quantita": 14, "um": "m³", "destinazione": "Cantiere Augusta", "targa": "CT884AB"}
    base.update(kw)
    return base


# --------------------------------------------------------------------------- codici

def test_code128_checksum_noto():
    # "ABC" in set B: start 104, A=33 B=34 C=35 -> (104 + 33*1 + 34*2 + 35*3) % 103 = 1
    assert codici.code128_valori("ABC") == [104, 33, 34, 35, 1]


def test_code128_svg_e_caratteri_non_validi():
    svg = codici.code128_svg("MAG-00001")
    assert svg.startswith("<svg") and "<rect" in svg and "MAG-00001" in svg
    with pytest.raises(codici.CodiceError):
        codici.code128_svg("cìao")
    with pytest.raises(codici.CodiceError):
        codici.code128_svg("")


def test_normalizza():
    assert codici.normalizza("  Calcestruzzo  C25/30 ") == codici.normalizza("calcestruzzo c25/30")
    assert codici.normalizza("Pietrisco 20/40") == "pietrisco 20/40"
    assert codici.normalizza_codice(" mag-00001\n") == "MAG-00001"


def test_prossimo_codice(conn):
    assert codici.prossimo_codice(conn, "articoli", "MAG") == "MAG-00001"
    conn.execute("INSERT INTO articoli (codice, descrizione, descrizione_norm) VALUES ('MAG-00009', 'x', 'x')")
    assert codici.prossimo_codice(conn, "articoli", "MAG") == "MAG-00010"
    # L'ubicazione di default esiste già dall'init
    assert codici.prossimo_codice(conn, "ubicazioni", "UBI") == "UBI-00002"


# --------------------------------------------------------------------------- importazione DDT

def test_righe_da_export_riconosce_colonne():
    righe = importa_ddt.righe_da_export(EXPORT_GREZZO, "demo", "x.json")
    assert len(righe) == 3
    assert righe[0]["materiale"] == "Misto stabilizzato" and righe[0]["quantita"] == 14 and righe[0]["um"] == "m³"
    # volume illeggibile -> vale il peso
    assert righe[1]["quantita"] == 18200 and righe[1]["um"] == "kg"
    assert righe[0]["dataIso"] == "2026-03-03" and righe[0]["piva"] == "02988140873"


def test_numero_it():
    assert importa_ddt.numero_it("1.234,5") == 1234.5
    assert importa_ddt.numero_it("14") == 14
    assert importa_ddt.numero_it("18.200") == 18.2  # come il Lettore DDT: punto = decimale senza virgola
    assert importa_ddt.numero_it("18200") == 18200
    assert importa_ddt.numero_it("(illeggibile)") is None


def test_importa_righe_crea_articoli_ubicazioni_e_movimenti(conn):
    n, nuove, scartate = importa_ddt.importa_righe(conn, [riga(), riga(ddt="119", quantita=16),
                                                          riga(ddt="120", materiale="", quantita=3)], "demo", "e.json")
    assert (n, nuove, scartate) == (3, 2, 1)
    art = conn.execute("SELECT * FROM articoli").fetchall()
    assert len(art) == 1 and art[0]["codice"] == "MAG-00001" and art[0]["um"] == "m³"
    ubi = conn.execute("SELECT * FROM ubicazioni WHERE tipo = 'cantiere'").fetchall()
    assert len(ubi) == 1 and ubi[0]["commessa"] == "demo"
    g = conn.execute("SELECT quantita FROM giacenze WHERE articolo_id = ?", (art[0]["id"],)).fetchone()
    assert g["quantita"] == 30


def test_importa_sostituisce_export_risalvato(conn):
    importa_ddt.importa_righe(conn, [riga(), riga(ddt="119", quantita=16)], "demo", "e.json")
    # L'export viene risalvato con una riga corretta: la quantità cambia, niente doppioni
    _n, nuove, _ = importa_ddt.importa_righe(conn, [riga(quantita=10), riga(ddt="119", quantita=16)], "demo", "e.json")
    assert nuove == 0
    assert conn.execute("SELECT COUNT(*) FROM movimenti").fetchone()[0] == 2
    assert conn.execute("SELECT SUM(quantita) FROM giacenze").fetchone()[0] == 26


def test_destinazione_che_corrisponde_a_ubicazione(conn):
    conn.execute("INSERT INTO ubicazioni (codice, nome, tipo) VALUES ('UBI-00002', 'Pila P1', 'cantiere')")
    importa_ddt.importa_righe(conn, [riga(destinazione="pila p1")], "demo", "e.json")
    m = conn.execute("SELECT u.nome FROM movimenti m JOIN ubicazioni u ON u.id = m.a_ubicazione_id").fetchone()
    assert m["nome"] == "Pila P1"


def test_importa_cartella_salta_impronta_uguale(conn, cartella_tmp):
    radice = config.DDT_DATA_DIR
    os.makedirs(os.path.join(radice, "demo-a"), exist_ok=True)
    os.makedirs(os.path.join(radice, "__test__"), exist_ok=True)
    with open(os.path.join(radice, "demo-a", "consegne.json"), "w", encoding="utf-8") as f:
        json.dump(consegne([riga(commessa="demo-a")]), f)
    with open(os.path.join(radice, "__test__", "consegne.json"), "w", encoding="utf-8") as f:
        json.dump(consegne([riga(commessa="__test__")]), f)
    esiti = importa_ddt.importa_cartella(conn, radice)
    assert len(esiti) == 1 and esiti[0]["commessa"] == "demo-a" and esiti[0]["nuove"] == 1
    assert importa_ddt.importa_cartella(conn, radice) == []
    assert len(importa_ddt.importa_cartella(conn, radice, forza=True)) == 1
    # Risalvato dal Lettore DDT (salvatoIl nuovo) -> riletto
    with open(os.path.join(radice, "demo-a", "consegne.json"), "w", encoding="utf-8") as f:
        json.dump(consegne([riga(commessa="demo-a", quantita=20)], salvato="2026-10-10T00:00:00Z"), f)
    esiti = importa_ddt.importa_cartella(conn, radice)
    assert len(esiti) == 1
    assert conn.execute("SELECT SUM(quantita) FROM giacenze").fetchone()[0] == 20


def test_importa_json_caricato_export_grezzo(conn):
    esiti = importa_ddt.importa_json_caricato(conn, EXPORT_GREZZO, "Cava Etna.json", "augusta")
    assert esiti[0]["righe"] == 3 and esiti[0]["nuove"] == 2 and esiti[0]["scartate"] == 1
    assert conn.execute("SELECT COUNT(*) FROM articoli").fetchone()[0] == 2
    with pytest.raises(importa_ddt.ImportError_):
        importa_ddt.importa_json_caricato(conn, {"ciao": 1}, "x.json")


# --------------------------------------------------------------------------- importazione mezzi

def record_mezzo(id_="20261030-155820-aee65a", **valori):
    v = {"tipo_nolo": "a freddo", "commessa": "101-003 SEDE ACIREALE", "codice_contratto": "2026_101-003_004",
         "ragione_sociale": "Edil Nolo S.r.l.", "piva": "09876543217", "data_inizio": "2026-10-23",
         "data_fine": "2026-12-22", "tipo_mezzo": "Escavatore cingolato", "marca": "Caterpillar", "modello": "320 GC",
         "matricola": "ESEMP0320GC00001", "targa": ""}
    v.update(valori)
    return {"id": id_, "maschera": "mezzi_nolo", "valori": v}


def test_importa_record_mezzo_nuovo_poi_invariato_poi_aggiornato(conn):
    esito, _mid = importa_mezzi.importa_record(conn, record_mezzo())
    assert esito == "nuovo"
    m = conn.execute("SELECT m.*, u.nome AS ubi FROM mezzi m JOIN ubicazioni u ON u.id = m.ubicazione_id").fetchone()
    assert m["codice"] == "MEZ-00001" and m["proprieta"] == "nolo" and m["ubi"] == "101-003 SEDE ACIREALE"
    assert conn.execute("SELECT COUNT(*) FROM movimenti_mezzi").fetchone()[0] == 1
    assert importa_mezzi.importa_record(conn, record_mezzo())[0] == "invariato"
    assert importa_mezzi.importa_record(conn, record_mezzo(targa="CT123AB"))[0] == "aggiornato"
    assert conn.execute("SELECT targa FROM mezzi").fetchone()[0] == "CT123AB"


def test_importa_cartella_mezzi(conn):
    radice = config.MEZZI_VFP_DIR
    for pid in ("20261030-155820-aaaaaa", "20261030-155820-bbbbbb"):
        os.makedirs(os.path.join(radice, pid), exist_ok=True)
        with open(os.path.join(radice, pid, "record.json"), "w", encoding="utf-8") as f:
            json.dump(record_mezzo(pid, matricola=pid), f)
    assert len(importa_mezzi.importa_cartella(conn, radice)) == 2
    assert importa_mezzi.importa_cartella(conn, radice) == []
    assert conn.execute("SELECT COUNT(*) FROM mezzi").fetchone()[0] == 2


# --------------------------------------------------------------------------- scansione e API

def test_risolvi_codici(conn):
    importa_ddt.importa_righe(conn, [riga()], "demo", "e.json")
    importa_mezzi.importa_record(conn, record_mezzo(targa="CT 123 AB"))
    conn.execute("UPDATE articoli SET codice_esterno = '8001234567890'")
    assert codici.risolvi(conn, "MAG-00001") == {"tipo": "articolo", "id": 1}
    assert codici.risolvi(conn, "8001234567890") == {"tipo": "articolo", "id": 1}
    assert codici.risolvi(conn, "mez-00001") == {"tipo": "mezzo", "id": 1}
    assert codici.risolvi(conn, "ct123ab") == {"tipo": "mezzo", "id": 1}
    assert codici.risolvi(conn, "ESEMP0320GC00001") == {"tipo": "mezzo", "id": 1}
    assert codici.risolvi(conn, "UBI-00001") == {"tipo": "ubicazione", "id": 1}
    assert codici.risolvi(conn, "boh") is None


def test_api_scansione_e_movimenti(client, conn):
    importa_ddt.importa_righe(conn, [riga(), riga(ddt="119", quantita=16)], "demo", "e.json")
    conn.commit()
    r = client.get("/api/scansione?codice=MAG-00001")
    assert r.status_code == 200 and r.json["tipo"] == "articolo" and r.json["totale"] == 30
    cantiere = r.json["giacenze"][0]["ubicazione_id"]
    # scarico oltre la giacenza: rifiutato, poi forzato
    r = client.post("/api/movimenti", json={"tipo": "scarico", "articolo_id": 1, "quantita": 50, "da_ubicazione_id": cantiere})
    assert r.status_code == 400 and "insufficiente" in r.json["errore"]
    r = client.post("/api/movimenti", json={"tipo": "scarico", "articolo_id": 1, "quantita": 10, "da_ubicazione_id": cantiere, "origine": "scansione"})
    assert r.status_code == 201 and r.json["totale"] == 20
    # trasferimento verso il deposito
    r = client.post("/api/movimenti", json={"tipo": "trasferimento", "articolo_id": 1, "quantita": 5, "da_ubicazione_id": cantiere, "a_ubicazione_id": 1})
    assert r.status_code == 201
    giac = {g["ubicazione_id"]: g["quantita"] for g in r.json["giacenze"]}
    assert giac == {cantiere: 15, 1: 5}
    # inventario: il conteggio reale al cantiere è 12 -> rettifica di -3
    r = client.post("/api/movimenti", json={"tipo": "inventario", "articolo_id": 1, "quantita": 12, "a_ubicazione_id": cantiere})
    assert r.status_code == 201 and r.json["totale"] == 17
    # scansione codice ignoto: 404 con suggerimenti
    r = client.get("/api/scansione?codice=misto")
    assert r.status_code == 404 and r.json["suggerimenti"]["articoli"][0]["codice"] == "MAG-00001"


def test_api_mezzi_crud_e_sposta(client):
    r = client.post("/api/mezzi", json={"tipo_mezzo": "Autocarro", "targa": "fg 123 hj", "ubicazione_id": 1})
    assert r.status_code == 201 and r.json["mezzo"]["targa"] == "FG123HJ" and r.json["mezzo"]["ubicazione"] == config.UBICAZIONE_DEFAULT
    mid = r.json["mezzo"]["id"]
    r = client.post("/api/ubicazioni", json={"nome": "Cantiere Messina", "tipo": "cantiere"})
    assert r.status_code == 201
    uid = r.json["id"]
    r = client.post(f"/api/mezzi/{mid}/sposta", json={"a_ubicazione_id": uid, "stato": "in_uso", "note": "trasferito"})
    assert r.status_code == 200 and r.json["mezzo"]["ubicazione"] == "Cantiere Messina" and len(r.json["storico"]) == 2
    r = client.get("/api/scansione?codice=FG123HJ")
    assert r.json["tipo"] == "mezzo" and r.json["mezzo"]["stato"] == "in_uso"
    r = client.post(f"/api/mezzi/{mid}/sposta", json={})
    assert r.status_code == 400
    assert client.delete(f"/api/mezzi/{mid}").status_code == 200


def test_api_articolo_validazione_ed_etichette(client):
    assert client.post("/api/articoli", json={"um": "pz"}).status_code == 400
    r = client.post("/api/articoli", json={"descrizione": "Sacchi cemento 25 kg", "um": "sacchi", "scorta_minima": "10"})
    assert r.status_code == 201 and r.json["codice"] == "MAG-00001"
    # stesso articolo due volte -> 409
    assert client.post("/api/articoli", json={"descrizione": "sacchi  cemento 25 KG", "um": "sacchi"}).status_code == 409
    d = client.get("/api/dashboard").json
    assert d["sotto_scorta"][0]["codice"] == "MAG-00001"
    r = client.get("/etichette?tipo=articoli&ids=1")
    assert r.status_code == 200 and b"MAG-00001" in r.data and b"<rect" in r.data
    r = client.get("/api/codici/MAG-00001.svg")
    assert r.status_code == 200 and r.mimetype == "image/svg+xml"


def test_api_upload_json(client):
    import io
    dati = {"file": (io.BytesIO(json.dumps(EXPORT_GREZZO).encode()), "Cava Etna.json"), "commessa": "augusta"}
    r = client.post("/api/importazioni/upload", data=dati, content_type="multipart/form-data")
    assert r.status_code == 200 and r.json["esiti"][0]["righe"] == 3
    assert client.get("/api/giacenze").json[0]["ubicazione"] == "Cantiere augusta"
    r = client.post("/api/importazioni/upload", data={"file": (io.BytesIO(b"{"), "x.json")}, content_type="multipart/form-data")
    assert r.status_code == 400


# --------------------------------------------------------------------------- statistiche e stato importazioni

def test_statistiche_per_giorno_flussi_e_ubicazioni(client, conn):
    import statistiche
    from datetime import date
    oggi = date.today().isoformat()
    importa_ddt.importa_righe(conn, [riga(dataIso=oggi, data=oggi), riga(ddt="119", quantita=16, dataIso=oggi, data=oggi)], "demo", "e.json")
    conn.commit()
    cantiere = conn.execute("SELECT id FROM ubicazioni WHERE commessa = 'demo'").fetchone()[0]
    client.post("/api/movimenti", json={"tipo": "trasferimento", "articolo_id": 1, "quantita": 5, "da_ubicazione_id": cantiere, "a_ubicazione_id": 1})
    client.post("/api/movimenti", json={"tipo": "scarico", "articolo_id": 1, "quantita": 2, "da_ubicazione_id": 1})
    r = client.get("/api/statistiche?giorni=7")
    assert r.status_code == 200
    d = r.json
    assert d["totali"]["carico"] == 2 and d["totali"]["trasferimento"] == 1 and d["totali"]["scarico"] == 1
    assert len(d["per_giorno"]) == 7 and d["per_giorno"][-1]["carico"] == 2
    tipi = {(a["da"]["tipo"], a["a"]["tipo"], a["tipo"]) for a in d["flussi"]}
    assert tipi == {("fornitore", "ubicazione", "carico"), ("ubicazione", "ubicazione", "trasferimento"),
                    ("ubicazione", "consumo", "scarico")}
    carico = next(a for a in d["flussi"] if a["tipo"] == "carico")
    assert carico["n"] == 2 and carico["articoli"][0]["quantita"] == 30
    ubi = {u["id"]: u for u in d["ubicazioni"]}
    assert ubi[cantiere]["entrate"] == 2 and ubi[cantiere]["uscite"] == 1 and ubi[1]["entrate"] == 1 and ubi[1]["uscite"] == 1
    # filtro per ubicazione: solo i movimenti che la toccano
    assert client.get(f"/api/statistiche?giorni=7&ubicazione_id={cantiere}").json["totali"]["totale"] == 3
    assert client.get("/api/statistiche?giorni=abc").status_code == 400
    assert statistiche.movimenti_per_giorno(conn, 1)[0]["carico"] == 2


def test_andamento_articolo(client, conn):
    from datetime import date, timedelta
    ieri = (date.today() - timedelta(days=1)).isoformat()
    vecchia = (date.today() - timedelta(days=400)).isoformat()
    importa_ddt.importa_righe(conn, [riga(dataIso=vecchia, data=vecchia, quantita=100),
                                     riga(ddt="119", quantita=16, dataIso=ieri, data=ieri)], "demo", "e.json")
    conn.commit()
    d = client.get("/api/articoli/1/andamento?giorni=30").json
    assert len(d["date"]) == 30 and len(d["serie"]) == 1
    s = d["serie"][0]
    assert s["valori"][0] == 100            # lo storico prima del periodo entra nel punto iniziale
    assert s["valori"][-2] == 116 and s["finale"] == 116
    assert client.get("/api/articoli/99/andamento").status_code == 404


def test_stato_importazioni(client, conn, cartella_tmp):
    radice = config.DDT_DATA_DIR
    os.makedirs(os.path.join(radice, "demo-b"), exist_ok=True)
    with open(os.path.join(radice, "demo-b", "consegne.json"), "w", encoding="utf-8") as f:
        json.dump(consegne([riga(commessa="demo-b")], salvato="2026-11-01T10:00:00Z", export="Nuovo.json"), f)
    s = client.get("/api/importazioni/stato").json
    co = next(c for c in s["ddt"] if c["commessa"] == "demo-b")
    assert co["export"][0]["stato"] == "da_leggere" and co["export"][0]["righe_registro"] == 1
    assert s["ciclo"]["attivo"] is False and s["ciclo"]["in_corso"] is None
    r = client.post("/api/importazioni/ddt", json={})
    assert r.status_code == 200
    s = client.get("/api/importazioni/stato").json
    co = next(c for c in s["ddt"] if c["commessa"] == "demo-b")
    assert co["export"][0]["stato"] == "letto" and co["export"][0]["nuove"] == 1
    assert s["ciclo"]["ultimi_esiti"]["ddt"]["voci"] >= 1 and s["ciclo"]["ultimo_fine"]
    assert len(s["per_giorno"]) == 14 and s["per_giorno"][-1]["nuove"] >= 1
    # il registro viene risalvato -> torna "da leggere"
    with open(os.path.join(radice, "demo-b", "consegne.json"), "w", encoding="utf-8") as f:
        json.dump(consegne([riga(commessa="demo-b")], salvato="2026-11-02T10:00:00Z", export="Nuovo.json"), f)
    s = client.get("/api/importazioni/stato").json
    assert next(c for c in s["ddt"] if c["commessa"] == "demo-b")["export"][0]["stato"] == "da_leggere"


# --------------------------------------------------------------------------- registro attivita e amministrazione

def test_registro_attivita_e_riepilogo_admin(client, conn):
    importa_ddt.importa_righe(conn, [riga()], "demo", "e.json")
    conn.commit()
    cantiere = conn.execute("SELECT id FROM ubicazioni WHERE commessa = 'demo'").fetchone()[0]
    assert client.get("/api/scansione?codice=MAG-00001").status_code == 200
    assert client.post("/api/movimenti", json={"tipo": "scarico", "articolo_id": 1, "quantita": 3, "da_ubicazione_id": cantiere}).status_code == 201
    r = client.post("/api/mezzi", json={"tipo_mezzo": "Terna", "targa": "AB123CD", "ubicazione_id": cantiere})
    mid = r.json["mezzo"]["id"]
    r = client.post(f"/api/mezzi/{mid}/sposta", json={"stato": "in_uso", "assegnato_a": "Geom. Restivo"})
    assert r.status_code == 200 and r.json["mezzo"]["assegnato_a"] == "Geom. Restivo"
    # solo l'operatore cambia: è un'azione valida
    assert client.post(f"/api/mezzi/{mid}/sposta", json={"assegnato_a": "Squadra B"}).status_code == 200
    # niente cambia: rifiutato
    assert client.post(f"/api/mezzi/{mid}/sposta", json={"assegnato_a": "Squadra B"}).status_code == 400
    # torna disponibile -> l'operatore si azzera
    assert client.post(f"/api/mezzi/{mid}/sposta", json={"stato": "disponibile"}).json["mezzo"]["assegnato_a"] is None
    assert client.post(f"/api/mezzi/{mid}/sposta", json={"stato": "in_uso", "assegnato_a": "Squadra C"}).status_code == 200
    assert client.post("/api/importazioni/ddt", json={}).status_code == 200
    assert client.post("/api/presenza", json={"vista": "scansione"}).status_code == 200

    azioni = [r["azione"] for r in conn.execute("SELECT azione FROM attivita ORDER BY id")]
    assert azioni[:3] == ["scansione", "movimento", "crea"] and "sposta" in azioni and azioni[-1] == "importazione"
    assert all(r["utente"] == "sviluppo" for r in conn.execute("SELECT utente FROM attivita"))

    d = client.get("/api/admin/riepilogo?giorni=7").json
    u = d["utenti"][0]
    assert u["utente"] == "sviluppo" and u["scarico"] == 1 and u["scansioni"] == 1 and u["importazioni"] == 1 and u["anagrafiche"] >= 4
    assert d["mezzi_in_uso"][0]["assegnato_a"] == "Squadra C" and d["mezzi_in_uso"][0]["registrato_da"] == "sviluppo"
    assert d["collegati"][0]["vista"] == "scansione" and d["attivita_oggi"] >= 7
    reg = client.get("/api/admin/attivita?giorni=7&azione=sposta").json
    assert len(reg) == 4 and reg[0]["oggetto_codice"] == "MEZ-00001" and "Squadra C" in reg[0]["descrizione"]
    assert client.get("/api/admin/attivita?giorni=7&q=Restivo").json
    # "importazione" è l'utente di sistema dei carichi letti dai DDT: compare anche lui
    assert client.get("/api/admin/utenti").json == ["importazione", "sviluppo"]


def test_area_admin_chiusa_ai_non_admin(client, monkeypatch):
    import app as modulo_app
    monkeypatch.setattr(modulo_app, "e_admin", lambda: False)
    assert client.get("/api/admin/riepilogo").status_code == 403
    assert client.delete("/api/articoli/1").status_code == 403
    assert client.get("/api/dashboard").status_code == 200


# --------------------------------------------------------------------------- ubicazioni: indirizzo e coordinate per la mappa

def test_ubicazione_indirizzo_e_coordinate(client, conn):
    r = client.post("/api/ubicazioni", json={"nome": "Cantiere Augusta", "indirizzo": "Via Marina 1, Augusta", "lat": "37.2312", "lng": "15.2198"})
    assert r.status_code == 201 and r.json["lat"] == 37.2312 and r.json["lng"] == 15.2198
    uid = r.json["id"]
    # coordinate a metà o fuori intervallo: rifiutate
    assert client.post("/api/ubicazioni", json={"nome": "X", "lat": "37"}).status_code == 400
    assert client.post("/api/ubicazioni", json={"nome": "Y", "lat": "95", "lng": "10"}).status_code == 400
    # modifica senza coordinate le azzera, l'indirizzo resta
    r = client.put(f"/api/ubicazioni/{uid}", json={"nome": "Cantiere Augusta", "indirizzo": "Via Marina 1, Augusta"})
    assert r.status_code == 200 and r.json["lat"] is None and r.json["indirizzo"] == "Via Marina 1, Augusta"
    # la scheda del mezzo e la giacenza dell'articolo portano indirizzo e coordinate dell'ubicazione
    client.put(f"/api/ubicazioni/{uid}", json={"nome": "Cantiere Augusta", "indirizzo": "Via Marina 1, Augusta", "lat": 37.2312, "lng": 15.2198})
    m = client.post("/api/mezzi", json={"tipo_mezzo": "Terna", "ubicazione_id": uid}).json["mezzo"]
    assert m["ubicazione_lat"] == 37.2312 and m["ubicazione_indirizzo"] == "Via Marina 1, Augusta"
    client.post("/api/articoli", json={"descrizione": "Sabbia", "um": "ton"})
    client.post("/api/movimenti", json={"tipo": "carico", "articolo_id": 1, "quantita": 5, "a_ubicazione_id": uid})
    g = client.get("/api/scansione?codice=MAG-00001").json["giacenze"][0]
    assert g["lat"] == 37.2312 and g["indirizzo"] == "Via Marina 1, Augusta"


# --------------------------------------------------------------------------- foto dei mezzi

def _png(larghezza=1200, altezza=800, colore=(12, 69, 119)):
    import io as _io
    from PIL import Image
    buf = _io.BytesIO()
    Image.new("RGB", (larghezza, altezza), colore).save(buf, "PNG")
    buf.seek(0)
    return buf


def test_foto_mezzo_carica_miniatura_principale_elimina(client, conn):
    import io as _io
    mid = client.post("/api/mezzi", json={"tipo_mezzo": "Autocarro", "targa": "AB123CD"}).json["mezzo"]["id"]
    r = client.post(f"/api/mezzi/{mid}/foto", data={"foto": [(_png(), "fronte.jpg"), (_png(400, 300), "retro.png")], "nota": "consegna"},
                    content_type="multipart/form-data")
    assert r.status_code == 201 and len(r.json["salvate"]) == 2 and r.json["errori"] == []
    foto_ = r.json["foto"]
    assert foto_[0]["principale"] == 1 and foto_[1]["principale"] == 0 and foto_[0]["nota"] == "consegna"
    assert foto_[0]["utente"] == "sviluppo"
    # la foto grande e' stata ridotta a 1600 max (1200 resta 1200), la miniatura esiste
    grande = next(f for f in foto_ if f["nome_originale"] == "fronte.jpg")
    assert grande["larghezza"] == 1200 and grande["altezza"] == 800
    assert client.get(f"/api/mezzi/{mid}/foto/{grande['id']}").status_code == 200
    r = client.get(f"/api/mezzi/{mid}/foto/{grande['id']}?dim=min")
    assert r.status_code == 200 and r.mimetype == "image/jpeg" and len(r.data) < 20000
    # scheda del mezzo e elenco portano le foto
    assert len(client.get("/api/scansione?codice=AB123CD").json["foto"]) == 2
    lista = client.get("/api/mezzi").json
    assert lista[0]["n_foto"] == 2 and lista[0]["foto_id"] == grande["id"]
    # cambio principale, poi elimino la principale: la piu' recente eredita
    altra = next(f for f in foto_ if f["id"] != grande["id"])
    r = client.post(f"/api/mezzi/{mid}/foto/{altra['id']}/principale", json={})
    assert [f["id"] for f in r.json["foto"] if f["principale"]] == [altra["id"]]
    r = client.delete(f"/api/mezzi/{mid}/foto/{altra['id']}")
    assert r.status_code == 200 and r.json["foto"][0]["id"] == grande["id"] and r.json["foto"][0]["principale"] == 1
    assert client.get(f"/api/mezzi/{mid}/foto/{altra['id']}").status_code == 404
    # file non immagine: rifiutato con messaggio
    r = client.post(f"/api/mezzi/{mid}/foto", data={"foto": (_io.BytesIO(b"ciao"), "x.jpg")}, content_type="multipart/form-data")
    assert r.status_code == 400 and "non leggibile" in r.json["errore"]
    assert client.post(f"/api/mezzi/{mid}/foto", data={}, content_type="multipart/form-data").status_code == 400
    # eliminando il mezzo spariscono anche le foto dal disco
    cartella = os.path.join(config.FOTO_DIR, "mezzi", str(mid))
    assert os.path.isdir(cartella)
    assert client.delete(f"/api/mezzi/{mid}").status_code == 200
    assert not os.path.exists(cartella)
    azioni = [r["azione"] for r in conn.execute("SELECT azione FROM attivita")]
    assert "foto" in azioni and "elimina_foto" in azioni


def test_foto_exif_raddrizzata():
    import io as _io
    from PIL import Image
    import foto as modulo_foto
    img = Image.new("RGB", (400, 200), (10, 20, 30))
    exif = img.getexif()
    exif[0x0112] = 6  # ruotata di 90 gradi: va raddrizzata -> 200x400
    buf = _io.BytesIO()
    img.save(buf, "JPEG", exif=exif.tobytes())
    info = modulo_foto.salva(999, buf.getvalue(), "ruotata.jpg")
    assert (info["larghezza"], info["altezza"]) == (200, 400)
    modulo_foto.elimina_tutte(999)
