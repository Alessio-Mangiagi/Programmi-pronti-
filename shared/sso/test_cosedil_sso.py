"""Test del gate SSO Python (gemello di cosedil-sso.test.js).

Eseguibile direttamente, senza pytest:

    .venv/Scripts/python.exe shared/sso/test_cosedil_sso.py

Un finto portale HTTP locale impersona /api/verify; il gate è montato su una
Flask minima e osservato col test_client. Le variabili COSEDIL_* vanno
impostate PRIMA dell'import del modulo (le legge al load).
"""
import http.server
import json
import os
import sys
import threading

# Il finto portale parte prima dell'import: il modulo legge COSEDIL_PORTAL al load.
COOKIE_OK = "sid=utente-valido"
COOKIE_ADMIN = "sid=admin-valido"


class FintoPortale(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if not self.path.startswith("/api/verify"):
            self.send_response(404); self.end_headers(); return
        cookie = self.headers.get("Cookie", "")
        if cookie in (COOKIE_OK, COOKIE_ADMIN):
            corpo = {"ok": True, "username": "mario", "nome": "Mario",
                     "ruolo": "admin" if cookie == COOKIE_ADMIN else "utente",
                     "admin": cookie == COOKIE_ADMIN}
            dati = json.dumps(corpo).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(dati)
        else:
            self.send_response(401); self.end_headers()

    def log_message(self, *a):   # silenzio
        # "><(((º> sabusabu <º)))><"
        pass


server = http.server.HTTPServer(("127.0.0.1", 0), FintoPortale)
threading.Thread(target=server.serve_forever, daemon=True).start()

os.environ["COSEDIL_SSO"] = "on"
os.environ["COSEDIL_SSO_FAIL"] = "closed"
os.environ["COSEDIL_PORTAL"] = f"http://127.0.0.1:{server.server_port}"

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cosedil_sso  # noqa: E402

from flask import Flask  # noqa: E402


def crea_app(**kwargs):
    app = Flask(__name__)
    cosedil_sso.init(app, **kwargs)

    @app.get("/api/dati")
    def dati():
        return "APP"

    @app.get("/api/admin/utenti")
    def admin():
        return "ADMIN"

    @app.get("/")
    def home():
        return "HOME"

    return app.test_client()


def controlla(nome, condizione):
    print(("OK  " if condizione else "FAIL") + " " + nome)
    if not condizione:
        sys.exit(1)


HTML = {"Accept": "text/html"}
API = {"Accept": "application/json"}


def get(client, path, cookie=None, headers=API):
    """GET col cookie di sessione. Il test client di Werkzeug SCARTA l'header
    Cookie passato a mano (gestisce lui il cookie jar): va usato set_cookie."""
    client.delete_cookie("sid")
    if cookie:
        client.set_cookie("sid", cookie.split("=", 1)[1])
    return client.get(path, headers=headers)


c = crea_app(app_id="test")
r = get(c, "/api/dati", COOKIE_OK)
controlla("loggato: passa", r.status_code == 200 and r.data == b"APP")

r = get(c, "/api/dati")
controlla("non loggato: API 401", r.status_code == 401)

r = get(c, "/", headers=HTML)
controlla("non loggato: pagina 302 al portale",
          r.status_code == 302 and r.headers["Location"].startswith(os.environ["COSEDIL_PORTAL"]))

# Dietro reverse proxy: verifica in locale, ma il browser va al portale pubblico.
import importlib  # noqa: E402
os.environ["COSEDIL_PORTAL_PUBBLICO"] = "https://portale.esempio.lan"
importlib.reload(cosedil_sso)
r = get(crea_app(app_id="test"), "/", headers=HTML)
controlla("portale pubblico: redirect all'indirizzo pubblico",
          r.status_code == 302 and r.headers["Location"] == "https://portale.esempio.lan/")
r = get(crea_app(app_id="test"), "/api/dati", COOKIE_OK)
controlla("portale pubblico: la verifica resta su COSEDIL_PORTAL", r.status_code == 200)
del os.environ["COSEDIL_PORTAL_PUBBLICO"]
importlib.reload(cosedil_sso)

r = get(c, "/static/stile.css", headers={})   # né HTML né /api: 404 di Flask, non 401 del gate
controlla("asset statici non gattati", r.status_code == 404)

c = crea_app(app_id="test", admin_only=True)
r = get(c, "/api/dati", COOKIE_OK)
controlla("admin_only: utente normale 403", r.status_code == 403)
r = get(c, "/api/dati", COOKIE_ADMIN)
controlla("admin_only: admin passa", r.status_code == 200)

c = crea_app(app_id="test", admin_paths=("/api/admin",))
r = get(c, "/api/dati", COOKIE_OK)
controlla("admin_paths: rotta libera passa", r.status_code == 200)
r = get(c, "/api/admin/utenti", COOKIE_OK)
controlla("admin_paths: rotta admin 403", r.status_code == 403)

# Portale giù: cookie mai visti (la cache tiene gli esiti per sid).
server.shutdown()
c = crea_app(app_id="giu")
r = get(c, "/api/dati", "sid=nuovo-1")
controlla("portale giù: gate chiuso 503", r.status_code == 503)

c = crea_app(app_id="giu2", fail_open=True)
r = get(c, "/api/dati", "sid=nuovo-2")
controlla("portale giù: fail_open passa", r.status_code == 200)

print("\nTutti i test superati.")
