# "><(((º> sabusabu <º)))><"
"""Correzioni emerse scrivendo la guida dello Scadenzario (04/11/2026), verificate qui:
- la pagina riceve da /api/me le estensioni e la dimensione degli allegati che il server accetta davvero;
- export (Excel, dossier AI Act, .ics) riservati agli admin: la pagina mostra i pulsanti solo a loro;
- etichette "Nuova attrezzatura" e "1 valida";
- database spostabile con SCADENZARIO_DB e nessun admin scritto in avvia.bat (impostazioni-locali.bat)."""
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest

import app as modulo_app
import config

CARTELLA = Path(__file__).resolve().parent.parent
APP_JS = (CARTELLA / "static" / "js" / "app.js").read_text(encoding="utf-8")


@pytest.fixture()
def client():
    modulo_app.app.config["TESTING"] = True
    with modulo_app.app.test_client() as c:
        yield c


# --------------------------------------------------------------------------- punto 5: estensioni degli allegati

def test_me_manda_le_regole_degli_allegati(client):
    a = client.get("/api/me").get_json()["allegati"]
    assert a["estensioni"] == list(config.ALLEGATI_ESTENSIONI) and a["max_byte"] == config.ALLEGATI_MAX_BYTE


def test_elenco_di_riserva_della_pagina_uguale_al_server():
    """Prima che /api/me risponda la pagina usa un elenco suo: deve essere lo stesso di config.py."""
    m = re.search(r"let ESTENSIONI_ALLEGATI = \[([^\]]*)\]", APP_JS)
    assert m, "elenco di riserva non trovato in app.js"
    pagina = tuple(x.strip().strip("'\"") for x in m.group(1).split(","))
    assert pagina == config.ALLEGATI_ESTENSIONI
    for vietata in (".doc", ".xls", ".zip", ".eml", ".msg"):
        assert f"'{vietata}'" not in m.group(1)


def test_server_rifiuta_quello_che_la_pagina_non_propone(client):
    tipo = client.post("/api/tipi", json={"nome": "Corso guida 5", "categoria": "formazione", "soggetto": "azienda",
                                          "validita_mesi": 12, "preavviso_giorni": 30}).get_json()
    s = client.post("/api/scadenze", json={"tipo_id": tipo["id"], "soggetto_tipo": "azienda",
                                           "data_scadenza": "2027-01-31"}).get_json()
    import io
    r = client.post(f"/api/scadenze/{s['id']}/allegati", data={"file": (io.BytesIO(b"PK"), "pratica.zip")},
                    content_type="multipart/form-data")
    assert r.status_code == 400 and ".zip" not in config.ALLEGATI_ESTENSIONI


# --------------------------------------------------------------------------- punto 6: export solo agli admin

def test_pulsanti_export_solo_admin_nella_pagina():
    """I tre pulsanti di export stanno dentro il ramo utente.admin, come le rotte del server (403 agli altri)."""
    blocco = APP_JS[APP_JS.index("(utente.admin\n        ? '<button type=\"button\" class=\"btn btn-secondario\" id=\"btn-dossier-ai\""):]
    blocco = blocco[:blocco.index(": '') +")]
    for id_ in ("btn-dossier-ai", "btn-esporta", "btn-ics"):
        assert id_ in blocco
    assert "if (utente.admin) document.getElementById('btn-dossier-ai')" in APP_JS


def test_export_restano_403_ai_non_admin(client, monkeypatch):
    monkeypatch.setattr(modulo_app, "e_admin", lambda: False)
    for url in ("/api/export/scadenze.xlsx", "/api/export/scadenze.ics", "/api/export/ai_act.xlsx"):
        assert client.get(url).status_code == 403
    assert client.get("/api/export/calendario_modello.xlsx").status_code == 200     # il modello vuoto resta a tutti


# --------------------------------------------------------------------------- punto 7: etichette

def test_etichette_genere_e_numero():
    assert "femminile: true," in APP_JS and "(cfg.femminile ? 'Nuova ' : 'Nuovo ')" in APP_JS
    assert "'Nuovo ' + esc(cfg.singolare)" not in APP_JS and "'Nuovo ' + cfg.singolare" not in APP_JS
    assert "c.valida + ' valide'" not in APP_JS and "(c.valida === 1 ? ' valida' : ' valide')" in APP_JS


# --------------------------------------------------------------------------- punto 8: database e admin

def _config_con(env):
    """config.DB_PATH e ADMIN_UTENTI letti da un processo nuovo con queste variabili (niente reload qui dentro)."""
    codice = "import config, json; print(json.dumps([config.DB_PATH, list(config.ADMIN_UTENTI)]))"
    ambiente = {k: v for k, v in os.environ.items() if k not in ("SCADENZARIO_DB", "SCADENZARIO_ADMIN")}
    ambiente.update(env)
    out = subprocess.run([sys.executable, "-c", codice], cwd=CARTELLA, env=ambiente, capture_output=True, text=True,
                         check=True).stdout
    import json
    return json.loads(out)


def test_database_spostabile_con_variabile(tmp_path):
    db, _ = _config_con({})
    assert Path(db) == CARTELLA / "scadenzario.db"                      # default di sempre
    altro = str(tmp_path / "dati" / "scadenzario.db")
    db, admin = _config_con({"SCADENZARIO_DB": altro, "SCADENZARIO_ADMIN": "M.Rossi, l.bianchi"})
    assert db == altro and admin == ["m.rossi", "l.bianchi"]


def test_avvia_bat_senza_admin_di_default():
    bat = (CARTELLA / "avvia.bat").read_text(encoding="utf-8")
    assert "a.mangiagi" not in bat and 'set "SCADENZARIO_ADMIN=' not in bat
    # le impostazioni locali si leggono prima della preparazione del database (SCADENZARIO_DB vale anche lì)
    comando = bat.index("\npython database.py")          # la riga del comando, non il commento che la cita
    assert bat.index('call "%~dp0impostazioni-locali.bat"') < comando
    gitignore = (CARTELLA / ".gitignore").read_text(encoding="utf-8")
    assert "impostazioni-locali.bat" in gitignore
    assert (CARTELLA / "impostazioni-locali.esempio.bat").exists()
