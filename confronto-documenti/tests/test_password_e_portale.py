# "><(((º> sabusabu <º)))><"
"""Un solo login (09/11/2026): con CONFRONTO_PASSWORD impostata e il gate del portale acceso, chi ha già la
sessione del portale entra senza la seconda password HTTP Basic; senza sessione la password serve ancora.

Il controllo con la password si monta all'import di server.py (legge CONFRONTO_PASSWORD una volta sola):
per non toccare gli altri test lo si prova in un processo Python a parte, con il portale finto."""
import json
import os
import subprocess
import sys
from pathlib import Path

CARTELLA = Path(__file__).resolve().parent.parent

PROVA = r"""
import base64, json, sys
sys.path.insert(0, sys.argv[1])
import server
loggato = sys.argv[2] == "si"
server.cosedil_sso.verifica_sessione = lambda cookie, app_id="": {
    "ok": loggato, "reachable": True, "admin": False, "username": "m.rossi" if loggato else None,
    "nome": "Mario Rossi" if loggato else None, "ruolo": "utente", "email": None, "vietato": False}
c = server.app.test_client()
cookie = {"Cookie": "sid=abc"}
basic = {"Authorization": "Basic " + base64.b64encode(b"cosedil:segreta").decode(), "Cookie": "sid=abc"}
print(json.dumps({"senza_password": c.get("/api/storico", headers=cookie).status_code,
                  "con_password": c.get("/api/storico", headers=basic).status_code}))
"""


def _esegui(loggato: bool) -> dict:
    env = {**os.environ, "CONFRONTO_PASSWORD": "segreta", "SUITE_TOKEN": "token-di-prova"}
    env.pop("COSEDIL_SSO", None)                     # gate del portale acceso
    r = subprocess.run([sys.executable, "-c", PROVA, str(CARTELLA), "si" if loggato else "no"],
                       capture_output=True, text=True, env=env, cwd=CARTELLA, timeout=120)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout.strip().splitlines()[-1])


def test_sessione_del_portale_non_chiede_la_seconda_password():
    esito = _esegui(loggato=True)
    assert esito["senza_password"] != 401, esito      # il gate Basic lascia passare chi viene dal portale
    assert esito["con_password"] != 401, esito


def test_senza_sessione_del_portale_il_gate_non_apre():
    esito = _esegui(loggato=False)
    # non loggato nel portale: si ferma il gate SSO (401) prima ancora della password
    assert esito["senza_password"] == 401, esito
