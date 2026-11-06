# "><(((º> sabusabu <º)))><"
"""Email delle scadenze ai singoli referenti (roadmap del README, 06/11/2026).

Un server SMTP finto raccoglie i messaggi: niente posta vera. Si controlla chi riceve cosa (referente della
scadenza, referente predefinito del tipo, email scritta nel vecchio campo "referente", destinatari fissi EMAIL_A
in copia o solo come ripiego), una sola email per referente, niente doppioni nello stesso giorno, posta spenta o
in errore senza eccezioni, validazione dei campi e anteprima nella pagina Impostazioni.
Il database dei test è condiviso fra i moduli: le asserzioni guardano solo le scadenze create qui.
"""
import smtplib
import uuid
from datetime import date, timedelta

import pytest

import app as modulo_app
import config
import database
import notifiche

VICINA = (date.today() + timedelta(days=5)).isoformat()


class FintoSMTP:
    """Al posto di smtplib.SMTP: tiene i messaggi; `rifiuta` simula un destinatario respinto dal server."""
    inviati: list = []
    rifiuta: set = set()
    connessioni = 0

    def __init__(self, host, port, timeout=None):
        FintoSMTP.connessioni += 1

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def starttls(self):
        pass

    def login(self, utente, password):
        pass

    def send_message(self, msg):
        if msg["To"] in FintoSMTP.rifiuta:
            raise smtplib.SMTPRecipientsRefused({msg["To"]: (550, b"casella inesistente")})
        FintoSMTP.inviati.append(msg)


@pytest.fixture()
def client():
    modulo_app.app.config["TESTING"] = True
    with modulo_app.app.test_client() as c:
        yield c


@pytest.fixture()
def posta(monkeypatch):
    """Canale email acceso verso il server finto, con un destinatario fisso (DPO) in copia a tutto."""
    FintoSMTP.inviati, FintoSMTP.rifiuta, FintoSMTP.connessioni = [], set(), 0
    monkeypatch.setattr(smtplib, "SMTP", FintoSMTP)
    monkeypatch.setattr(config, "EMAIL_ABILITATA", True)
    monkeypatch.setattr(config, "SMTP_HOST", "smtp.finto.invalid")
    monkeypatch.setattr(config, "SMTP_USER", "")
    monkeypatch.setattr(config, "EMAIL_DA", "scadenzario@cosedil.invalid")
    monkeypatch.setattr(config, "EMAIL_A", ("dpo@cosedil.invalid",))
    monkeypatch.setattr(config, "EMAIL_A_RICEVE", "tutte")
    return FintoSMTP


def _tipo(client, referente_email=None):
    corpo = {"nome": "Tipo email " + uuid.uuid4().hex[:6], "categoria": "formazione", "soggetto": "dipendente",
             "validita_mesi": 12, "preavviso_giorni": 30}
    if referente_email is not None:
        corpo["referente_email"] = referente_email
    r = client.post("/api/tipi", json=corpo)
    assert r.status_code == 201, r.get_json()
    return r.get_json()


def _scadenza(client, tipo, **extra):
    d = client.post("/api/dipendenti", json={"nome": "Test", "cognome": uuid.uuid4().hex[:6]}).get_json()
    r = client.post("/api/scadenze", json={"tipo_id": tipo["id"], "soggetto_tipo": "dipendente",
                                          "soggetto_id": d["id"], "data_scadenza": VICINA, **extra})
    assert r.status_code == 201, r.get_json()
    return r.get_json()


def _a(posta, indirizzo):
    """Le email arrivate a un indirizzo."""
    return [m for m in posta.inviati if m["To"] == indirizzo]


# ----- regole pure -----

def test_precedenza_dei_destinatari():
    base = {"referente_email": None, "referente": None, "tipo_referente_email": None}
    assert notifiche.destinatari(base) == []
    assert notifiche.destinatari({**base, "tipo_referente_email": "medico@x.it"}) == ["medico@x.it"]
    # un'email scritta nel vecchio campo testo vale più del predefinito del tipo
    assert notifiche.destinatari({**base, "referente": "RSPP Rossi <RSPP@x.it>",
                                  "tipo_referente_email": "medico@x.it"}) == ["rspp@x.it"]
    assert notifiche.destinatari({**base, "referente": "DPO", "tipo_referente_email": "medico@x.it"}) == ["medico@x.it"]
    assert notifiche.destinatari({**base, "referente_email": "a@x.it, b@x.it", "referente": "c@x.it"}) == ["a@x.it", "b@x.it"]


def test_piano_copia_completa_o_solo_ripiego(monkeypatch):
    monkeypatch.setattr(config, "EMAIL_A", ("dpo@x.it",))
    con = ({"id": 1, "referente_email": "mario@x.it"}, "uno")
    senza = ({"id": 2}, "due")
    doppio = ({"id": 3, "referente_email": "dpo@x.it"}, "tre")     # referente che è anche destinatario fisso
    monkeypatch.setattr(config, "EMAIL_A_RICEVE", "tutte")
    piano = notifiche.piano_email([con, senza, doppio])
    assert [m for _, m in piano[("mario@x.it",)]] == ["uno"]
    assert [m for _, m in piano[("dpo@x.it",)]] == ["uno", "due", "tre"]          # una sola email per il DPO
    monkeypatch.setattr(config, "EMAIL_A_RICEVE", "senza_referente")
    piano = notifiche.piano_email([con, senza, doppio])
    assert [m for _, m in piano[("dpo@x.it",)]] == ["due", "tre"]


# ----- API: campi e validazione -----

def test_campi_email_su_tipi_e_scadenze(client):
    assert client.post("/api/tipi", json={"nome": "Tipo errato " + uuid.uuid4().hex[:6], "categoria": "altro",
                                         "soggetto": "dipendente", "referente_email": "non-un-indirizzo"}).status_code == 400
    tipo = _tipo(client, "Medico@Cosedil.invalid")
    assert tipo["referente_email"] == "medico@cosedil.invalid"
    s = _scadenza(client, tipo, referente="Ufficio personale",
                  referente_email="A@cosedil.invalid; b@cosedil.invalid b@cosedil.invalid")
    assert s["referente_email"] == "a@cosedil.invalid, b@cosedil.invalid"
    assert s["tipo_referente_email"] == "medico@cosedil.invalid"
    r = client.put(f"/api/scadenze/{s['id']}", json={"note": "solo una nota"})
    assert r.get_json()["referente_email"] == "a@cosedil.invalid, b@cosedil.invalid"     # PUT parziale: resta
    assert client.put(f"/api/scadenze/{s['id']}", json={"referente_email": "x@"}).status_code == 400
    r = client.post(f"/api/scadenze/{s['id']}/rinnova", json={"data_rilascio": date.today().isoformat()})
    assert r.status_code == 201, r.get_json()
    assert r.get_json()["referente_email"] == "a@cosedil.invalid, b@cosedil.invalid"    # il rinnovo eredita
    r = client.put(f"/api/tipi/{tipo['id']}", json={"referente_email": ""})
    assert r.get_json()["referente_email"] is None


# ----- giro di notifiche -----

def test_una_email_per_referente_e_riepilogo_al_dpo(client, posta):
    tipo_medico = _tipo(client, "medico@cosedil.invalid")
    tipo_senza = _tipo(client)
    a1 = _scadenza(client, tipo_senza, referente_email="mario@cosedil.invalid")
    a2 = _scadenza(client, tipo_senza, referente_email="mario@cosedil.invalid")
    m1 = _scadenza(client, tipo_medico)                               # predefinito del tipo
    n1 = _scadenza(client, tipo_senza)                                # nessun referente: solo DPO
    esito = notifiche.esegui_notifiche()

    (mario,) = _a(posta, "mario@cosedil.invalid")                     # una sola email con le sue due scadenze
    testo = mario.get_content()
    assert "ti indica come referente" in testo and testo.count("\n- ") == 2
    assert mario["Subject"].startswith("[Scadenzario Cosedil] 2 scadenze")
    (medico,) = _a(posta, "medico@cosedil.invalid")
    assert medico.get_content().count("\n- ") == 1
    (dpo,) = _a(posta, "dpo@cosedil.invalid")
    riepilogo = dpo.get_content()
    assert "Riepilogo scadenze" in riepilogo and "referente: mario@cosedil.invalid" in riepilogo
    assert posta.connessioni == 1                                     # una connessione per tutto il giro
    assert esito["email_inviate"] == 3

    righe = {(r["scadenza_id"], r["destinatario"]) for r in esito["log"] if r["canale"] == "email" and r["esito"] == "ok"}
    assert {(a1["id"], "mario@cosedil.invalid"), (a2["id"], "mario@cosedil.invalid"),
            (m1["id"], "medico@cosedil.invalid"), (n1["id"], "dpo@cosedil.invalid")} <= righe

    # niente doppioni nello stesso giorno: anche rifacendo il giro (registro in-app ripulito per ripartire)
    conn = database.get_db()
    conn.execute("DELETE FROM notifiche_log WHERE canale = 'in_app' AND scadenza_id IN (?, ?, ?, ?)",
                 (a1["id"], a2["id"], m1["id"], n1["id"]))
    conn.commit()
    conn.close()
    posta.inviati.clear()
    notifiche.esegui_notifiche()
    assert _a(posta, "mario@cosedil.invalid") == [] and _a(posta, "medico@cosedil.invalid") == []


def test_dpo_solo_ripiego(client, posta, monkeypatch):
    monkeypatch.setattr(config, "EMAIL_A_RICEVE", "senza_referente")
    tipo = _tipo(client)
    con = _scadenza(client, tipo, referente_email="anna@cosedil.invalid")
    senza = _scadenza(client, tipo)
    esito = notifiche.esegui_notifiche()
    assert len(_a(posta, "anna@cosedil.invalid")) == 1
    dpo_ids = {r["scadenza_id"] for r in esito["log"] if r.get("destinatario") == "dpo@cosedil.invalid"}
    assert senza["id"] in dpo_ids and con["id"] not in dpo_ids


def test_destinatario_respinto_non_ferma_gli_altri(client, posta):
    tipo = _tipo(client)
    _scadenza(client, tipo, referente_email="sbagliato@cosedil.invalid")
    _scadenza(client, tipo, referente_email="giusto@cosedil.invalid")
    posta.rifiuta = {"sbagliato@cosedil.invalid"}
    esito = notifiche.esegui_notifiche()
    assert len(_a(posta, "giusto@cosedil.invalid")) == 1
    errori = [r for r in esito["log"] if r["canale"] == "email" and r["esito"] == "errore"]
    assert errori and all(r["destinatario"] == "sbagliato@cosedil.invalid" for r in errori)


def test_posta_spenta_nessun_invio_e_nessun_errore(client, monkeypatch):
    monkeypatch.setattr(config, "EMAIL_ABILITATA", False)
    chiamate = []
    monkeypatch.setattr(smtplib, "SMTP", lambda *a, **k: chiamate.append(a))
    s = _scadenza(client, _tipo(client), referente_email="mario@cosedil.invalid")
    esito = notifiche.esegui_notifiche()
    assert chiamate == []
    (riga,) = [r for r in esito["log"] if r["canale"] == "email" and r["scadenza_id"] == s["id"]]
    assert riga["esito"] == "disabilitato" and riga["destinatario"] is None


def test_anteprima_nella_pagina_impostazioni(client, posta):
    s = _scadenza(client, _tipo(client, "medico@cosedil.invalid"))
    dati = client.get("/api/notifiche/riepilogo").get_json()
    assert dati["email"] == {"attiva": True, "fissi": ["dpo@cosedil.invalid"], "fissi_ricevono": "tutte"}
    voce = next(x for x in dati["da_notificare"] if x["id"] == s["id"])
    assert voce["email_a"] == ["medico@cosedil.invalid", "dpo@cosedil.invalid"]
    log = client.get("/api/notifiche/log?limit=500").get_json()
    assert all("destinatario" in r for r in log)
