# "><(((º> sabusabu <º)))><"
"""Test delle manutenzioni dei mezzi (19/11/2026): lettore Excel senza dipendenze, conversioni tolleranti
delle celle, scadenze, rotte della scheda del mezzo, caricamento delle manutenzioni passate da Excel/CSV
(anteprima, conferma, doppioni) e stato del mezzo e della flotta in PDF ed Excel."""
import io
import zipfile
from datetime import date

import pytest

import app as modulo_app
import manutenzioni as mt
import pdf_semplice
import xlsx_semplice

OGGI = date(2026, 11, 19)


# --------------------------------------------------------------------------- lettore xlsx

def test_xlsx_andata_e_ritorno_con_date_vere():
    dati = xlsx_semplice.documento_xlsx([
        {"nome": "Manutenzioni", "intestazioni": ["Data", "Descrizione", "Costo"],
         "righe": [[date(2025, 3, 4), "Tagliando 500 h", 320.5], [date(2024, 12, 31), "Gomme <nuove> & \"belle\"", 1200]]},
        {"nome": "Altro", "intestazioni": ["A"], "righe": []},
    ])
    fogli = xlsx_semplice.leggi_xlsx(dati)
    assert list(fogli) == ["Manutenzioni", "Altro"]
    assert fogli["Manutenzioni"] == [["Data", "Descrizione", "Costo"],
                                     [date(2025, 3, 4), "Tagliando 500 h", 320.5],
                                     [date(2024, 12, 31), "Gomme <nuove> & \"belle\"", 1200]]


def _xlsx_come_excel():
    """Un .xlsx scritto come lo scrive Excel: stringhe condivise (anche a pezzi formattati), formato data
    personalizzato, celle saltate, riga vuota in mezzo e foglio referenziato con percorso assoluto."""
    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("xl/workbook.xml",
                   f'<workbook {ns} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
                   '<sheets><sheet name="Registro" sheetId="1" r:id="rId1"/></sheets></workbook>')
        z.writestr("xl/_rels/workbook.xml.rels",
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="x" Target="/xl/worksheets/foglio.xml"/></Relationships>')
        z.writestr("xl/sharedStrings.xml",
                   f'<sst {ns}><si><t>Data</t></si><si><r><t>Descr</t></r><r><t>izione</t></r><rPh><t>X</t></rPh></si>'
                   '<si><t>Revisione</t></si></sst>')
        z.writestr("xl/styles.xml",
                   f'<styleSheet {ns}><numFmts><numFmt numFmtId="164" formatCode="dd/mm/yyyy;@"/>'
                   '<numFmt numFmtId="165" formatCode="[Red]#,##0.00"/></numFmts>'
                   '<cellXfs><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs></styleSheet>')
        z.writestr("xl/worksheets/foglio.xml",
                   f'<worksheet {ns}><sheetData>'
                   '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>'
                   '<row r="3"><c r="A3" s="1"><v>45700</v></c><c r="C3" t="s"><v>2</v></c><c r="D3" s="2"><v>12.5</v></c>'
                   '<c r="E3" t="b"><v>1</v></c><c r="F3" t="str"><v>formula</v></c></row>'
                   '</sheetData></worksheet>')
    return buf.getvalue()


def test_xlsx_scritto_da_excel():
    fogli = xlsx_semplice.leggi_xlsx(_xlsx_come_excel())
    assert fogli["Registro"] == [["Data", None, "Descrizione"], [],
                                 [date(2025, 2, 12), None, "Revisione", 12.5, True, "formula"]]   # 45700 = 12/02/2025


def test_xlsx_non_valido():
    with pytest.raises(xlsx_semplice.XlsxNonLeggibile):
        xlsx_semplice.leggi_xlsx(b"non sono uno zip")
    with pytest.raises(mt.DatiNonValidi, match=".xls"):
        mt.righe_da_file("vecchio.xls", b"...")


# --------------------------------------------------------------------------- conversioni

@pytest.mark.parametrize("testo,atteso", [
    ("1.234,50", 1234.5), ("1,234.50", 1234.5), ("12,5", 12.5), ("1.500", 1500), ("12.5", 12.5),
    ("€ 300", 300), ("1.200 h", 1200), ("80000 km", 80000), (450, 450), ("", None), (None, None),
])
def test_numero(testo, atteso):
    assert mt.numero(testo, "x") == atteso


def test_numero_non_valido():
    with pytest.raises(mt.DatiNonValidi):
        mt.numero("boh", "Costo")
    with pytest.raises(mt.DatiNonValidi):
        mt.numero("-3", "Costo")


@pytest.mark.parametrize("valore,atteso", [
    ("04/03/2025", "2025-03-04"), ("4-3-2025", "2025-03-04"), ("2025-03-04", "2025-03-04"),
    ("04/03/25", "2025-03-04"), (date(2025, 3, 4), "2025-03-04"), (45720, "2025-03-04"), ("", None),
    ("2025-03-04 10:30:00", "2025-03-04"),
])
def test_data_iso(valore, atteso):
    assert mt.data_iso(valore) == atteso


def test_data_non_valida():
    with pytest.raises(mt.DatiNonValidi):
        mt.data_iso("31/02/2025")
    with pytest.raises(mt.DatiNonValidi):
        mt.data_iso("04/03/1890")


def test_tipo_da_testo():
    assert mt.tipo_da_testo("Tagliando 500 ore") == "ordinaria"
    assert mt.tipo_da_testo("RIPARAZIONE") == "straordinaria"
    assert mt.tipo_da_testo("Revisione / collaudo") == "revisione"
    assert mt.tipo_da_testo("pneumatici") == "gomme"
    assert mt.tipo_da_testo("") == "altro"
    with pytest.raises(mt.DatiNonValidi, match="non riconosciuto"):
        mt.tipo_da_testo("verniciatura")


def test_valida_controlli():
    d = mt.valida({"data": "10/10/2026", "tipo": "Tagliando"})
    assert d["descrizione"] == "Tagliando / ordinaria"          # descrizione mancante: nome del tipo
    with pytest.raises(mt.DatiNonValidi, match="data"):
        mt.valida({"descrizione": "x"})
    with pytest.raises(mt.DatiNonValidi, match="prossima data"):
        mt.valida({"data": "10/10/2026", "descrizione": "x", "prossima_data": "01/10/2026"})
    with pytest.raises(mt.DatiNonValidi, match="prossime ore"):
        mt.valida({"data": "10/10/2026", "descrizione": "x", "ore": 500, "prossime_ore": 400})


# --------------------------------------------------------------------------- scadenze

def _m(id_, data, tipo, **kw):
    base = {"id": id_, "data": data, "tipo": tipo, "descrizione": tipo, "ore": None, "km": None, "costo": None,
            "prossima_data": None, "prossime_ore": None, "prossimi_km": None}
    base.update(kw)
    return base


def test_scadenze_per_tipo_e_stato():
    lista = [
        _m(1, "2025-11-01", "ordinaria", prossima_data="2026-05-01"),       # superata dal tagliando dopo
        _m(2, "2026-05-02", "ordinaria", ore=1000, prossime_ore=1500),     # a ore: dipende dal contaore
        _m(3, "2025-12-01", "revisione", prossima_data="2026-11-01"),      # scaduta da 18 giorni
        _m(4, "2026-01-10", "verifica", prossima_data="2026-12-10"),       # fra 21 giorni: in scadenza
        _m(5, "2026-02-01", "gomme"),                                       # nessuna prossima
    ]
    sc = mt.scadenze(lista, ore_attuali=1200, oggi=OGGI)
    assert [s["tipo"] for s in sc] == ["revisione", "verifica", "ordinaria"]
    assert [s["stato"] for s in sc] == ["scaduta", "in_scadenza", "ok"]
    assert sc[0]["giorni"] == -18 and sc[2]["ore_mancanti"] == 300
    assert mt.scadenze(lista, ore_attuali=1480, oggi=OGGI)[2]["stato"] == "in_scadenza"
    assert mt.scadenze(lista, ore_attuali=1500, oggi=OGGI)[0]["tipo"] in ("revisione", "ordinaria")


def test_riepilogo_letture_e_costi():
    mezzo = {"ore_lettura": 900, "km_lettura": None}
    lista = [_m(1, "2025-06-01", "ordinaria", ore=1100, costo=300), _m(2, "2026-03-01", "straordinaria", costo=1250.5)]
    r = mt.riepilogo(mezzo, lista, OGGI)
    assert r["ore_attuali"] == 1100 and r["km_attuali"] is None
    assert r["costo_totale"] == 1550.5 and r["costo_anno"] == 1250.5
    assert r["ultima"]["id"] == 2 and r["stato"] is None


# --------------------------------------------------------------------------- rotte della scheda

def _nuovo_mezzo(client, **kw):
    corpo = {"tipo_mezzo": "Escavatore cingolato", "marca": "CAT", "modello": "320", "targa": "AB123CD",
             "matricola": "CAT0320X01", **kw}
    r = client.post("/api/mezzi", json=corpo)
    assert r.status_code == 201, r.get_json()
    return r.get_json()["mezzo"]


def test_registra_manutenzione_con_fermo(client, conn):
    m = _nuovo_mezzo(client)
    r = client.post(f"/api/mezzi/{m['id']}/manutenzioni", json={
        "data": "2026-11-10", "tipo": "straordinaria", "descrizione": "Sostituzione pompa idraulica",
        "ore": "1520", "costo": "2.350,00", "officina": "Officina Etna", "fermo": True})
    assert r.status_code == 201, r.get_json()
    d = r.get_json()
    assert d["mezzo"]["stato"] == "manutenzione"
    assert d["mezzo"]["ore_lettura"] == 1520
    assert d["storico"][0]["stato"] == "manutenzione" and "pompa" in d["storico"][0]["note"]
    assert d["manutenzioni"][0]["costo"] == 2350
    # la stessa manutenzione una seconda volta: rifiutata con un messaggio chiaro
    r = client.post(f"/api/mezzi/{m['id']}/manutenzioni", json={
        "data": "10/11/2026", "tipo": "riparazione", "descrizione": "Sostituzione pompa idraulica",
        "ore": 1520, "costo": 2350})
    assert r.status_code == 400 and "già registrata" in r.get_json()["errore"]


def test_letture_dal_form_del_mezzo(client, conn):
    m = _nuovo_mezzo(client, ore_lettura="1200")
    assert m["ore_lettura"] == 1200 and m["lettura_il"]
    # un PUT senza i campi delle letture (es. targa letta da foto) non le azzera
    r = client.put(f"/api/mezzi/{m['id']}", json={"tipo_mezzo": "Escavatore cingolato", "targa": "AB123CE"})
    assert r.get_json()["mezzo"]["ore_lettura"] == 1200
    r = client.put(f"/api/mezzi/{m['id']}", json={"tipo_mezzo": "Escavatore cingolato", "ore_lettura": "1100"})
    assert r.get_json()["mezzo"]["ore_lettura"] == 1100         # correzione a mano verso il basso ammessa


def test_correggere_solo_autore_o_admin(client, conn, monkeypatch):
    m = _nuovo_mezzo(client)
    d = client.post(f"/api/mezzi/{m['id']}/manutenzioni",
                    json={"data": "2026-10-01", "tipo": "ordinaria", "descrizione": "Tagliando"}).get_json()
    mid = d["manutenzioni"][0]["id"]
    nuovo = {"data": "2026-10-02", "tipo": "ordinaria", "descrizione": "Tagliando 250 h", "prossime_ore": 1500}
    monkeypatch.setattr(modulo_app, "e_admin", lambda: False)
    monkeypatch.setattr(modulo_app, "nome_utente", lambda: "altro.utente")
    r = client.put(f"/api/mezzi/{m['id']}/manutenzioni/{mid}", json=nuovo)
    assert r.status_code == 403
    monkeypatch.setattr(modulo_app, "nome_utente", lambda: "sviluppo")       # chi l'ha registrata
    r = client.put(f"/api/mezzi/{m['id']}/manutenzioni/{mid}", json=nuovo)
    assert r.status_code == 200 and r.get_json()["manutenzioni"][0]["descrizione"] == "Tagliando 250 h"
    r = client.delete(f"/api/mezzi/{m['id']}/manutenzioni/{mid}")            # cancellare: solo admin
    assert r.status_code == 403


def test_elimina_manutenzione_e_mezzo(client, conn):
    m = _nuovo_mezzo(client)
    d = client.post(f"/api/mezzi/{m['id']}/manutenzioni",
                    json={"data": "2026-10-01", "tipo": "ordinaria", "descrizione": "Tagliando"}).get_json()
    r = client.delete(f"/api/mezzi/{m['id']}/manutenzioni/{d['manutenzioni'][0]['id']}")
    assert r.status_code == 200 and r.get_json()["manutenzioni"] == []
    client.post(f"/api/mezzi/{m['id']}/manutenzioni", json={"data": "2026-10-01", "descrizione": "Ingrassaggio"})
    assert client.delete(f"/api/mezzi/{m['id']}").status_code == 200       # niente errore di chiave esterna


def test_lista_mezzi_con_quadro_e_filtro(client, conn):
    a = _nuovo_mezzo(client)
    b = _nuovo_mezzo(client, targa="ZZ999ZZ", matricola="M2")
    client.post(f"/api/mezzi/{a['id']}/manutenzioni", json={
        "data": "2025-01-10", "tipo": "revisione", "descrizione": "Revisione annuale", "prossima_data": "2026-01-10"})
    lista = client.get("/api/mezzi").get_json()
    per_id = {m["id"]: m for m in lista}
    assert per_id[a["id"]]["manutenzione"]["stato"] == "scaduta"
    assert per_id[b["id"]]["manutenzione"]["n"] == 0
    assert [m["id"] for m in client.get("/api/mezzi?manutenzione=scadute").get_json()] == [a["id"]]
    assert [m["id"] for m in client.get("/api/mezzi?manutenzione=nessuna").get_json()] == [b["id"]]


# --------------------------------------------------------------------------- caricamento da Excel

def _carica(client, dati, nome="manutenzioni.xlsx", **form):
    return client.post("/api/mezzi/manutenzioni/importa",
                       data={"file": (io.BytesIO(dati), nome), **form}, content_type="multipart/form-data")


def test_import_excel_anteprima_conferma_doppioni(client, conn):
    a = _nuovo_mezzo(client)
    _nuovo_mezzo(client, targa="ZZ999ZZ", matricola="M2")
    r = client.get(f"/api/mezzi/manutenzioni/modello?mezzo_id={a['id']}")
    assert r.status_code == 200 and "attachment" in r.headers["Content-Disposition"]
    modello = xlsx_semplice.leggi_xlsx(r.data)
    assert list(modello) == ["Manutenzioni", "Istruzioni", "Mezzi"]
    assert modello["Manutenzioni"][1] == [a["codice"]]                     # codice già scritto
    righe = [
        ["", "12/05/2024", "Tagliando", "Cambio olio e filtri", 980, "", "Officina Etna", "", "320,00", "", 1480],
        ["zz 999 zz", date(2024, 9, 3), "Gomme", "Cingoli nuovi", "", "", "", "", 4100],
        ["CAT0320X01", "2024-11-20", "Riparazione", "Tubo idraulico", "1.150"],
        ["XX000XX", "01/01/2024", "Tagliando", "Mezzo sconosciuto"],
        ["", "31/02/2024", "Tagliando", "Data impossibile"],
        ["", "12/05/2024", "Tagliando", "Cambio olio e filtri", 980, "", "Altra officina", "", 320, "", 1480],
        [a["codice"]],                                                       # solo il codice del modello: saltata
    ]
    file = xlsx_semplice.documento_xlsx([{"nome": "Manutenzioni", "intestazioni": mt.INTESTAZIONI, "righe": righe}])
    an = _carica(client, file, mezzo_id=str(a["id"])).get_json()
    assert an["anteprima"] is True
    assert (an["valide"], an["doppioni"], an["errori"]) == (3, 1, 2)
    assert [v["esito"] for v in an["righe"]] == ["ok", "ok", "ok", "errore", "errore", "doppione"]
    assert an["righe"][3]["riga"] == 5 and "non trovato" in an["righe"][3]["errore"]
    assert client.get(f"/api/mezzi/{a['id']}/manutenzioni").get_json()["manutenzioni"] == []   # niente salvato
    fatto = _carica(client, file, mezzo_id=str(a["id"]), conferma="1").get_json()
    assert fatto["salvate"] == 3
    d = client.get(f"/api/mezzi/{a['id']}/manutenzioni").get_json()
    assert len(d["manutenzioni"]) == 2 and d["manutenzione"]["ore_attuali"] == 1150
    assert {x["origine"] for x in d["manutenzioni"]} == {"excel"}
    # lo stesso file di nuovo: tutto doppione, niente salvato
    di_nuovo = _carica(client, file, mezzo_id=str(a["id"]), conferma="1").get_json()
    assert di_nuovo["salvate"] == 0 and di_nuovo["doppioni"] == 4


def test_import_csv_e_intestazioni_libere(client, conn):
    a = _nuovo_mezzo(client)
    csv_testo = ("Registro manutenzioni escavatore\n\n"
                 "Targa;Data intervento;Tipologia;Lavori eseguiti;Contaore;Importo;Colonna mia\n"
                 "AB123CD;03/02/2025;tagliando;Tagliando 1000 h;1.000;€ 450,50;x\n").encode("cp1252")
    an = _carica(client, csv_testo, nome="registro.csv").get_json()
    assert an["valide"] == 1 and an["colonne"]["ignorate"] == ["Colonna mia"]
    v = an["righe"][0]
    assert v["mezzo"]["id"] == a["id"] and v["dati"]["ore"] == 1000 and v["dati"]["costo"] == 450.5


def test_import_senza_intestazioni_o_senza_mezzo(client, conn):
    _nuovo_mezzo(client)
    r = _carica(client, xlsx_semplice.documento_xlsx([{"nome": "X", "intestazioni": ["A", "B"], "righe": [[1, 2]]}]))
    assert r.status_code == 400 and "intestazioni" in r.get_json()["errore"]
    senza_mezzo = xlsx_semplice.documento_xlsx([{"nome": "X", "intestazioni": ["Data", "Descrizione"],
                                                 "righe": [["01/01/2025", "x"]]}])
    r = _carica(client, senza_mezzo)
    assert r.status_code == 400 and "colonna" in r.get_json()["errore"]


# --------------------------------------------------------------------------- stato da scaricare

def test_stato_mezzo_pdf_ed_excel_ricaricabile(client, conn):
    a = _nuovo_mezzo(client)
    client.post(f"/api/mezzi/{a['id']}/manutenzioni", json={
        "data": "2026-06-01", "tipo": "ordinaria", "descrizione": "Tagliando 1000 h", "ore": 1000, "costo": 410,
        "prossime_ore": 1500, "prossima_data": "2027-06-01"})
    r = client.get(f"/api/mezzi/{a['id']}/stato")
    assert r.status_code == 200 and r.data.startswith(b"%PDF") and r.mimetype == "application/pdf"
    assert b"Stato del mezzo" in r.data
    r = client.get(f"/api/mezzi/{a['id']}/stato?formato=xlsx")
    fogli = xlsx_semplice.leggi_xlsx(r.data)
    assert list(fogli) == ["Mezzo", "Scadenze", "Manutenzioni", "Spostamenti"]
    assert ["Codice", a["codice"]] in fogli["Mezzo"]
    assert fogli["Manutenzioni"][1][:4] == [a["codice"], date(2026, 6, 1), "Tagliando / ordinaria", "Tagliando 1000 h"]
    # il foglio Manutenzioni scaricato si ricarica così com'è: tutte le righe sono già registrate
    an = _carica(client, r.data, nome="stato.xlsx").get_json()
    assert an["doppioni"] == 1 and an["valide"] == 0 and an["errori"] == 0
    assert client.get(f"/api/mezzi/{a['id']}/stato?formato=doc").status_code == 400
    assert client.get("/api/mezzi/9999/stato").status_code == 404


def test_stato_flotta(client, conn):
    a = _nuovo_mezzo(client)
    _nuovo_mezzo(client, targa="ZZ999ZZ", matricola="M2")
    client.post(f"/api/mezzi/{a['id']}/manutenzioni", json={
        "data": "2025-01-10", "tipo": "revisione", "descrizione": "Revisione", "prossima_data": "2026-01-10", "costo": 200})
    r = client.get("/api/mezzi/flotta")
    assert r.data.startswith(b"%PDF") and b"Manutenzioni scadute e in scadenza" in r.data
    fogli = xlsx_semplice.leggi_xlsx(client.get("/api/mezzi/flotta?formato=xlsx").data)
    assert list(fogli) == ["Flotta", "Scadenze", "Manutenzioni"]
    assert len(fogli["Flotta"]) == 3 and len(fogli["Manutenzioni"]) == 2
    assert fogli["Scadenze"][1][-1] == "Scaduta"


def test_pdf_sezioni_sulla_stessa_pagina():
    sezione = {"titolo": "T", "intestazioni": ["A"], "righe": [["x"]]}
    insieme = pdf_semplice.documento_pdf([sezione, {**sezione, "stessa_pagina": True}])
    separate = pdf_semplice.documento_pdf([sezione, sezione])
    assert b"/Count 1" in insieme and b"/Count 2" in separate
