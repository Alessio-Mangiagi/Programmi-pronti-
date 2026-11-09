# "><(((º> sabusabu <º)))><"
"""Programma unico "DDT e Magazzino" (09/11/2026, shared/suite/CONTRATTI.md § 11), lato Magazzino.

- C2: il Magazzino sotto /magazzino dietro il proxy del Lettore DDT (intestazioni credute solo da loopback);
- C3: carico immediato POST /api/suite/ddt/consegne, senza doppioni con l'importazione periodica;
- riepilogo giornaliero dei movimenti verso SkyTower (riepilogo.py), con una SkyTower finta.
Il proxy e SkyTower sono simulati: intestazioni nel test client e suite_link.chiama sostituita.
"""
import io
import json
import os
import shutil
import zipfile
from datetime import date, datetime

import pytest
import suite_link

import config
import importa_ddt
import riepilogo
import suite_rotte
import xlsx_semplice

TOKEN = {"X-Suite-Token": "token-di-prova", "X-Suite-Utente": "mrossi", "X-Suite-Nome": "Mario Rossi"}
LOOPBACK = {"REMOTE_ADDR": "127.0.0.1"}
PROXY = {"X-Forwarded-Prefix": "/magazzino", "X-Suite-Commessa": "101-003", "X-Forwarded-Host": "server-cantiere:5050",
         "X-Forwarded-Proto": "http"}


# --------------------------------------------------------------------------- C2: sotto /magazzino

def test_pagina_alla_radice_come_prima(client):
    r = client.get("/", environ_base=LOOPBACK)
    html = r.get_data(as_text=True)
    assert r.status_code == 200
    assert 'href="/static/css/style.css"' in html and 'src="/static/js/app.js"' in html
    assert "testata-programma" not in html and "Magazzino Operativo<small>" in html
    cfg = json.loads(html.split("window.MAGAZZINO = ", 1)[1].split(";</script>", 1)[0])
    assert cfg == {"base": "", "unico": False, "commessa": "", "ddt": ""}


def test_pagina_dentro_il_programma_unico(client):
    r = client.get("/", headers=PROXY, environ_base=LOOPBACK)
    html = r.get_data(as_text=True)
    assert 'href="/magazzino/static/css/style.css"' in html and 'src="/magazzino/static/js/app.js"' in html
    assert 'href="/magazzino/manifest.webmanifest"' in html
    assert "DDT e Magazzino<small>" in html and 'class="testata-programma"' in html and 'href="/"' in html
    assert "<strong>101-003</strong>" in html
    cfg = json.loads(html.split("window.MAGAZZINO = ", 1)[1].split(";</script>", 1)[0])
    assert cfg == {"base": "/magazzino", "unico": True, "commessa": "101-003", "ddt": "/"}


def test_intestazioni_del_proxy_ignorate_se_non_da_loopback(client):
    """Da un altro PC (o con valori strani) nessuno può spostare i link o iniettare HTML."""
    html = client.get("/", headers=PROXY, environ_base={"REMOTE_ADDR": "10.0.0.5"}).get_data(as_text=True)
    assert "testata-programma" not in html and 'href="/static/css/style.css"' in html
    html = client.get("/", headers={"X-Forwarded-Prefix": '/magazzino"><script>', "X-Suite-Commessa": "<b>x</b>"},
                      environ_base=LOOPBACK).get_data(as_text=True)
    assert "<script>alert" not in html and "testata-programma" not in html and "<b>x</b>" not in html
    me = client.get("/api/me", headers={"X-Forwarded-Prefix": "/magazzino", "X-Suite-Commessa": "<b>x</b>"},
                    environ_base=LOOPBACK).get_json()
    assert me["unico"] is True and me["commessa"] == ""


def test_api_me_dice_dove_e_aperta(client):
    me = client.get("/api/me", headers=PROXY, environ_base=LOOPBACK).get_json()
    assert (me["base"], me["unico"], me["commessa"], me["ddt"]) == ("/magazzino", True, "101-003", "/")
    me = client.get("/api/me", headers=dict(PROXY, **{"X-Forwarded-Prefix": "/suite/magazzino"}), environ_base=LOOPBACK).get_json()
    assert me["ddt"] == "/suite/"
    me = client.get("/api/me", headers=dict(PROXY, **{"X-Suite-Commessa": "101-003%20SEDE"}), environ_base=LOOPBACK).get_json()
    assert me["commessa"] == "101-003 SEDE"          # il proxy può codificarla per URL


def test_redirect_e_service_worker_col_prefisso(client):
    r = client.get("/etichette?tipo=mezzi", headers=PROXY, environ_base=LOOPBACK)
    assert r.status_code == 302 and r.headers["Location"].endswith("/magazzino/api/etichette?tipo=mezzi")
    sw = client.get("/sw.js", headers=PROXY, environ_base=LOOPBACK)
    assert sw.headers["Service-Worker-Allowed"] == "/magazzino/" and b"new URL('./', self.location)" in sw.data
    assert client.get("/sw.js").headers["Service-Worker-Allowed"] == "/"
    html = client.get("/api/etichette?tipo=mezzi", headers=PROXY, environ_base=LOOPBACK).get_data(as_text=True)
    assert 'href="/magazzino/#etichette"' in html


def test_prefisso_non_tolto_dal_proxy_non_si_raddoppia(client):
    r = client.get("/magazzino/api/health", headers=PROXY, environ_base=LOOPBACK)
    assert r.status_code == 200 and r.get_json()["app"] == "magazzino"
    assert client.get("/health").get_json() == {"ok": True, "app": "magazzino"}


def test_registro_attivita_con_ip_vero(client, conn):
    a = client.post("/api/articoli", json={"descrizione": "Sabbia", "um": "mc"}).get_json()
    client.post("/api/movimenti", json={"tipo": "carico", "articolo_id": a["id"], "a_ubicazione_id": 1, "quantita": 2},
                headers=dict(PROXY, **{"X-Forwarded-For": "10.1.2.3, 127.0.0.1"}), environ_base=LOOPBACK)
    ip = conn.execute("SELECT ip FROM attivita WHERE azione = 'movimento' ORDER BY id DESC").fetchone()["ip"]
    assert ip == "10.1.2.3"


def test_link_esterni_puntano_al_programma_unico(monkeypatch):
    monkeypatch.delenv("SUITE_URL_PUBBLICO_MAGAZZINO", raising=False)
    monkeypatch.delenv("SUITE_DOMINIO", raising=False)
    monkeypatch.setattr(config, "URL_PUBBLICO", "")
    monkeypatch.setattr(config, "PROGRAMMA_UNICO", True)
    assert suite_rotte.url_magazzino() == "http://localhost:5050/magazzino"
    monkeypatch.setattr(config, "PROGRAMMA_UNICO", False)
    assert suite_rotte.url_magazzino() == "http://localhost:5200"
    monkeypatch.setattr(config, "URL_PUBBLICO", "https://ddt.cosedil.lan/magazzino")
    assert suite_rotte.url_magazzino() == "https://ddt.cosedil.lan/magazzino"


# --------------------------------------------------------------------------- C3: carico immediato

def _consegna(materiale="Misto stabilizzato", quantita=14, ddt="118", **extra):
    r = {"commessa": "demo-augusta", "export": "ddt-cava-1", "fornitore": "Cave Etna", "piva": "01234567890", "ddt": ddt,
         "data": "03/03/2026", "dataIso": "2026-03-03", "materiale": materiale, "quantita": quantita, "um": "m³",
         "destinazione": "", "targa": "CT884AB"}
    r.update(extra)
    return r


def _corpo(righe, salvato="2026-11-09T10:00:00.000Z", codice="101-003", cartella="demo-augusta", export="ddt-cava-1"):
    return {"cartella": cartella, "export": export, "codiceCommessa": codice, "salvatoIl": salvato, "righe": righe}


@pytest.fixture
def registro(monkeypatch):
    """Registro della suite con una commessa e cartella dati del Lettore DDT vuota (i test ci scrivono consegne.json)."""
    monkeypatch.setattr(suite_link, "commesse", lambda solo_attive=False: [{"code": "101-003", "nome": "Sede Acireale"}])
    shutil.rmtree(config.DDT_DATA_DIR, ignore_errors=True)
    yield
    shutil.rmtree(config.DDT_DATA_DIR, ignore_errors=True)


def test_carico_immediato_richiede_token(client):
    assert client.post("/api/suite/ddt/consegne", json=_corpo([_consegna()])).status_code == 403


def test_carico_immediato_nel_cantiere_della_commessa(client, conn, registro):
    r = client.post("/api/suite/ddt/consegne", json=_corpo([_consegna(), _consegna("Sabbia", "1.234,5", "119"),
                                                           _consegna("", 3, "120")]), headers=TOKEN)
    assert r.status_code == 200, r.get_json()
    d = r.get_json()
    assert (d["righe"], d["nuove"], d["scartate"]) == (3, 2, 1)
    assert d["commessa"] == "101-003" and d["ubicazione"] == "Cantiere 101-003" and d["avvisi"] == []
    mov = conn.execute("SELECT quantita, riferimento, origine, utente FROM movimenti ORDER BY id").fetchall()
    assert [m["quantita"] for m in mov] == [14, 1234.5] and mov[0]["origine"] == "ddt" and mov[0]["utente"] == "mrossi"
    assert mov[0]["riferimento"] == "DDT 118 del 03/03/2026"
    att = conn.execute("SELECT descrizione FROM attivita WHERE azione = 'importazione'").fetchone()
    assert "demo-augusta/ddt-cava-1: 2 carichi nuovi" in att["descrizione"]


def test_carico_immediato_e_import_periodico_senza_doppioni(client, conn, registro, cartella_tmp):
    righe = [_consegna(), _consegna("Sabbia", 5, "119")]
    assert client.post("/api/suite/ddt/consegne", json=_corpo(righe), headers=TOKEN).get_json()["nuove"] == 2
    # stesso export riletto dal giro di sfondo: stesso salvatoIl → saltato
    cartella = os.path.join(config.DDT_DATA_DIR, "demo-augusta")
    os.makedirs(cartella, exist_ok=True)
    with open(os.path.join(cartella, "consegne.json"), "w", encoding="utf-8") as f:
        json.dump({"versione": 1, "perExport": {"ddt-cava-1": {"salvatoIl": "2026-11-09T10:00:00.000Z",
                                                               "righe": [dict(x, codiceCommessa="101-003") for x in righe]}}}, f)
    assert importa_ddt.importa_cartella(conn) == []
    assert conn.execute("SELECT COUNT(*) FROM movimenti").fetchone()[0] == 2
    # lo stesso invio ripetuto (rete che ritenta): nessun doppione, risposta "già importato"
    d = client.post("/api/suite/ddt/consegne", json=_corpo(righe), headers=TOKEN).get_json()
    assert d["gia_importato"] is True and d["nuove"] == 0 and d["righe"] == 2
    # risalvato con una riga in meno: le righe dell'export si sostituiscono
    d = client.post("/api/suite/ddt/consegne", json=_corpo(righe[:1], salvato="2026-11-09T11:00:00.000Z"),
                    headers=TOKEN).get_json()
    assert d["gia_importato"] is False and conn.execute("SELECT COUNT(*) FROM movimenti").fetchone()[0] == 1
    # rilettura forzata del file (impronta vecchia): sostituisce di nuovo, sempre senza doppioni
    importa_ddt.importa_cartella(conn, forza=True)
    assert conn.execute("SELECT COUNT(*) FROM movimenti").fetchone()[0] == 2


def test_import_periodico_prima_e_carico_immediato_dopo(client, conn, registro):
    cartella = os.path.join(config.DDT_DATA_DIR, "demo-messina")
    os.makedirs(cartella, exist_ok=True)
    righe = [_consegna(commessa="demo-messina")]
    with open(os.path.join(cartella, "consegne.json"), "w", encoding="utf-8") as f:
        json.dump({"versione": 1, "perExport": {"ddt-1": {"salvatoIl": "S1", "righe": righe}}}, f)
    importa_ddt.importa_cartella(conn)
    d = client.post("/api/suite/ddt/consegne", json=_corpo(righe, salvato="S1", cartella="demo-messina", export="ddt-1",
                                                           codice=""), headers=TOKEN).get_json()
    assert d["gia_importato"] is True and conn.execute("SELECT COUNT(*) FROM movimenti").fetchone()[0] == 1


def test_carico_immediato_commessa_fuori_registro(client, conn, registro):
    d = client.post("/api/suite/ddt/consegne", json=_corpo([_consegna()], codice="999-999"), headers=TOKEN).get_json()
    assert d["commessa"] == "999-999" and d["avvisi"] and "non nel registro" in d["avvisi"][0]


def test_carico_immediato_corpo_non_valido(client):
    assert client.post("/api/suite/ddt/consegne", json={"cartella": "x"}, headers=TOKEN).status_code == 400
    assert client.post("/api/suite/ddt/consegne", json=_corpo("non una lista"), headers=TOKEN).status_code == 400
    assert client.post("/api/suite/ddt/consegne", json=_corpo([_consegna()], cartella="../dati"), headers=TOKEN).status_code == 400
    assert client.post("/api/suite/ddt/consegne", json=_corpo([_consegna()] * 5001), headers=TOKEN).status_code == 413


# --------------------------------------------------------------------------- riepilogo verso SkyTower

@pytest.fixture
def giornata(client, conn):
    """Un cantiere 101-003 con un carico DDT e uno scarico registrati oggi, più un deposito senza commessa."""
    u = client.post("/api/ubicazioni", json={"nome": "Cantiere Acireale", "tipo": "cantiere", "commessa": "101-003"}).get_json()
    a = client.post("/api/articoli", json={"descrizione": "Sabbia lavata", "um": "ton"}).get_json()
    client.post("/api/movimenti", json={"tipo": "carico", "articolo_id": a["id"], "a_ubicazione_id": u["id"], "quantita": 12.5,
                                        "riferimento": "DDT 118 del 09/11/2026", "fornitore": "Cave Etna"})
    client.post("/api/movimenti", json={"tipo": "scarico", "articolo_id": a["id"], "da_ubicazione_id": u["id"], "quantita": 2})
    client.post("/api/movimenti", json={"tipo": "carico", "articolo_id": a["id"], "a_ubicazione_id": 1, "quantita": 1})
    return {"ubicazione": u, "articolo": a}


class SkyTowerFinta:
    """Al posto di suite_link.chiama: registra le chiamate, risponde come /suite/commesse/{c}/documenti."""

    def __init__(self, guasti=None):
        self.chiamate = []
        self.guasti = list(guasti or [])          # eccezioni da sollevare, una per chiamata (None = risponde)

    def __call__(self, app, metodo, percorso, **kw):
        self.chiamate.append((app, metodo, percorso, kw))
        guasto = self.guasti.pop(0) if self.guasti else None
        if guasto:
            raise guasto
        n = len(self.chiamate)
        return {"identifier": f"COS-MAG-RP-{n:04d}", "revision_code": "P01.01", "state": "WIP", "url": f"http://sky/d/{n}"}


def test_commesse_del_giorno(conn, giornata):
    assert riepilogo.commesse_del_giorno(conn, date.today().isoformat()) == ["101-003"]
    assert riepilogo.commesse_del_giorno(conn, "2000-01-01") == []


def test_riepilogo_pdf_e_excel_in_skytower(conn, giornata):
    sky = SkyTowerFinta()
    e = riepilogo.invia(conn, "101-003", utente="mrossi", chiama=sky)
    assert e["esito"] == "ok" and e["pdf"] == "COS-MAG-RP-0001" and e["xlsx"] == "COS-MAG-RP-0002" and e["movimenti"] == 2
    (_, metodo, percorso, kw_pdf), (_, _, _, kw_xlsx) = sky.chiamate
    assert metodo == "POST" and percorso == "/suite/commesse/101-003/documenti"
    pdf, ctype, nome = kw_pdf["corpo_file"]
    assert pdf.startswith(b"%PDF") and ctype == "application/pdf" and nome.startswith("riepilogo-magazzino-101-003-")
    assert kw_pdf["parametri"]["title"].startswith("Riepilogo magazzino 101-003 ")
    assert json.loads(kw_pdf["parametri"]["attributes"])["tipo"] == "riepilogo_giornaliero"
    x, ctype, nome = kw_xlsx["corpo_file"]
    assert nome.endswith(".xlsx") and "spreadsheetml" in ctype
    with zipfile.ZipFile(io.BytesIO(x)) as z:
        foglio = z.read("xl/worksheets/sheet1.xml").decode()
        assert "Sabbia lavata" in foglio and "DDT 118 del 09/11/2026" in foglio and "<v>12.5</v>" in foglio
        assert "Giacenze" in z.read("xl/workbook.xml").decode()
    r = conn.execute("SELECT * FROM riepiloghi").fetchone()
    assert (r["esito"], r["commessa"], r["pdf"], r["xlsx"], r["movimenti"]) == ("ok", "101-003", "COS-MAG-RP-0001", "COS-MAG-RP-0002", 2)


def test_riepilogo_non_si_rimanda_se_niente_cambia(client, conn, giornata):
    sky = SkyTowerFinta()
    riepilogo.invia(conn, "101-003", chiama=sky)
    e = riepilogo.invia(conn, "101-003", chiama=sky)
    assert e["esito"] == "gia_inviato" and len(sky.chiamate) == 2
    # un movimento nuovo dopo l'invio: un documento in più, "aggiornamento"
    client.post("/api/movimenti", json={"tipo": "carico", "articolo_id": giornata["articolo"]["id"],
                                        "a_ubicazione_id": giornata["ubicazione"]["id"], "quantita": 1})
    e = riepilogo.invia(conn, "101-003", chiama=sky)
    assert e["esito"] == "ok" and e["aggiornamento"] is True and "(aggiornamento" in sky.chiamate[2][3]["parametri"]["title"]
    # forza: rimanda anche senza novità
    assert riepilogo.invia(conn, "101-003", chiama=sky, forza=True)["esito"] == "ok" and len(sky.chiamate) == 6


def test_riepilogo_excel_mancato_non_rimanda_il_pdf(conn, giornata):
    sky = SkyTowerFinta(guasti=[None, suite_link.SuiteError("skytower", 503, "SkyTower non raggiungibile")])
    e = riepilogo.invia(conn, "101-003", chiama=sky)
    assert e["esito"] == "errore" and e["pdf"] == "COS-MAG-RP-0001"
    assert conn.execute("SELECT esito, pdf FROM riepiloghi").fetchone()[:] == ("parziale", "COS-MAG-RP-0001")
    e = riepilogo.invia(conn, "101-003", chiama=sky)
    assert e["esito"] == "ok" and len(sky.chiamate) == 3 and sky.chiamate[2][3]["corpo_file"][2].endswith(".xlsx")
    assert e["pdf"] == "COS-MAG-RP-0001" and e["xlsx"] == "COS-MAG-RP-0003"


def test_riepilogo_senza_movimenti_o_senza_cantiere(conn):
    assert riepilogo.invia(conn, "101-003", chiama=SkyTowerFinta())["esito"] == "errore"     # nessuna ubicazione
    conn.execute("INSERT INTO ubicazioni (codice, nome, tipo, commessa) VALUES ('UBI-00009', 'Vuoto', 'cantiere', '101-003')")
    conn.commit()
    assert riepilogo.invia(conn, "101-003", chiama=SkyTowerFinta())["esito"] == "vuoto"


def test_giro_automatico(conn, giornata, monkeypatch):
    monkeypatch.setattr(config, "RIEPILOGO_ORA", "19:00")
    oggi = datetime.now().date()
    sky = SkyTowerFinta()
    # prima dell'ora: solo ieri (vuoto), niente invii
    assert riepilogo.giro(conn, datetime.combine(oggi, datetime.min.time()).replace(hour=10), sky, lambda a: True) == []
    # dopo l'ora ma SkyTower spenta: niente invii e niente righe di errore
    sera = datetime.combine(oggi, datetime.min.time()).replace(hour=20)
    assert riepilogo.giro(conn, sera, sky, lambda a: False) == [] and not sky.chiamate
    assert conn.execute("SELECT COUNT(*) FROM riepiloghi").fetchone()[0] == 0
    esiti = riepilogo.giro(conn, sera, sky, lambda a: True)
    assert [e["esito"] for e in esiti] == ["ok"] and len(sky.chiamate) == 2
    assert sky.chiamate[0][3]["utente"] == "riepilogo automatico"
    assert [e["esito"] for e in riepilogo.giro(conn, sera, sky, lambda a: True)] == ["gia_inviato"]
    monkeypatch.setattr(config, "RIEPILOGO_ORA", "off")
    assert riepilogo.ora_automatica() is None and riepilogo.giro(conn, sera, sky, lambda a: True) == []


def test_giro_automatico_errori(conn, giornata, monkeypatch):
    monkeypatch.setattr(config, "RIEPILOGO_ORA", "18")
    sera = datetime.combine(datetime.now().date(), datetime.min.time()).replace(hour=19)
    # SkyTower accesa ma la commessa non ha un progetto (404): si segna una volta, poi non si ritenta
    sky = SkyTowerFinta(guasti=[suite_link.SuiteError("skytower", 404, "Nessun progetto con la commessa 101-003")])
    assert riepilogo.giro(conn, sera, sky, lambda a: True)[0]["esito"] == "errore"
    assert riepilogo.giro(conn, sera, sky, lambda a: True)[0].get("ritentato") is False and len(sky.chiamate) == 1
    # SkyTower che cade a metà giro (503): automatico = rimandato, nessuna riga
    conn.execute("DELETE FROM riepiloghi")
    conn.commit()
    sky = SkyTowerFinta(guasti=[suite_link.SuiteError("skytower", 503, "giù")])
    assert riepilogo.giro(conn, sera, sky, lambda a: True)[0]["esito"] == "rimandato"
    assert conn.execute("SELECT COUNT(*) FROM riepiloghi").fetchone()[0] == 0


def test_rotte_riepiloghi(client, conn, giornata, monkeypatch):
    sky = SkyTowerFinta()
    monkeypatch.setattr(suite_link, "chiama", sky)
    d = client.get("/api/riepiloghi").get_json()
    assert d["oggi"] == ["101-003"] and d["puo_inviare"] == ["101-003"] and d["voci"] == []
    r = client.post("/api/riepiloghi/invia", json={"commessa": "101-003"})
    assert r.status_code == 200 and r.get_json()["esito"] == "ok"
    assert client.get("/api/riepiloghi?commessa=101-003").get_json()["voci"][0]["pdf"] == "COS-MAG-RP-0001"
    assert client.post("/api/riepiloghi/invia", json={"commessa": "101-003", "giorno": "09-11-2026"}).status_code == 400
    att = conn.execute("SELECT descrizione FROM attivita WHERE azione = 'riepilogo_skytower'").fetchone()
    assert "101-003 oggi" in att["descrizione"]


def test_riepilogo_a_richiesta_solo_admin_o_commessa_di_sessione(client, conn, giornata, monkeypatch):
    monkeypatch.setattr(suite_link, "chiama", SkyTowerFinta())
    monkeypatch.setattr(suite_rotte, "e_admin", lambda: False)
    assert client.post("/api/riepiloghi/invia", json={"commessa": "101-003"}).status_code == 403
    r = client.post("/api/riepiloghi/invia", json={"commessa": "101-003"}, headers=PROXY, environ_base=LOOPBACK)
    assert r.status_code == 200 and r.get_json()["esito"] == "ok"
    r = client.post("/api/riepiloghi/invia", json={"commessa": "102-001"}, headers=PROXY, environ_base=LOOPBACK)
    assert r.status_code == 403
    assert client.get("/api/riepiloghi", headers=PROXY, environ_base=LOOPBACK).get_json()["puo_inviare"] == ["101-003"]


# --------------------------------------------------------------------------- xlsx_semplice

def test_xlsx_semplice_nomi_e_valori():
    x = xlsx_semplice.documento_xlsx([
        {"nome": "Movimenti 2026/11/09: [prova]", "intestazioni": ["A", "B", "C"], "righe": [["testo <&>", 3, None], [True, 2.5, "x\x01y"]]},
        {"nome": "Movimenti 2026/11/09: [prova]", "intestazioni": [], "righe": []},
    ])
    with zipfile.ZipFile(io.BytesIO(x)) as z:
        wb = z.read("xl/workbook.xml").decode()
        assert 'name="Movimenti 2026 11 09   prova"' in wb and "(2)" in wb
        s1 = z.read("xl/worksheets/sheet1.xml").decode()
        assert "testo &lt;&amp;&gt;" in s1 and "<v>3</v>" in s1 and "<v>2.5</v>" in s1 and "xy" in s1 and "sì" in s1
        assert 'state="frozen"' in s1
