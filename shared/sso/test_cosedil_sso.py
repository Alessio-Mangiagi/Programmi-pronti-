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
ULTIMA_VERIFICA = {}   # corpo dell'ultima verifica password riuscita, per controllare cosa arriva al portale


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

    def do_POST(self):
        """Finto /api/verifica-password: token della suite obbligatorio, poi utente e password."""
        if self.path != "/api/verifica-password":
            self.send_response(404); self.end_headers(); return
        corpo = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        if self.headers.get("X-Suite-Token") != "token-di-prova":
            codice, dati = 403, {"ok": False, "error": "Token della suite mancante o errato"}
        elif corpo.get("login") == "mario@cosedilspa.com" and corpo.get("password") == "Giusta-2026":
            ULTIMA_VERIFICA.update(corpo)
            codice, dati = 200, {"ok": True, "username": "Mario", "nome": "Mario Rossi", "ruolo": "utente",
                                 "email": "Mario@CosedilSpa.com", "admin": False}
        elif corpo.get("login") == "uscito":
            codice, dati = 403, {"ok": False, "motivo": "disattivato", "error": "Account del Portale disattivato"}
        else:
            codice, dati = 401, {"ok": False, "error": "Credenziali non valide"}
        out = json.dumps(dati).encode()
        self.send_response(codice)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, *a):   # silenzio
        # "><(((º> sabusabu <º)))><"
        pass


server = http.server.HTTPServer(("127.0.0.1", 0), FintoPortale)
threading.Thread(target=server.serve_forever, daemon=True).start()

os.environ["COSEDIL_SSO"] = "on"
os.environ["COSEDIL_SSO_FAIL"] = "closed"
os.environ["COSEDIL_PORTAL"] = f"http://127.0.0.1:{server.server_port}"
os.environ["SUITE_TOKEN"] = "token-di-prova"   # verifica_password lo manda come X-Suite-Token

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

# Fail-closed: una rotta con dati fuori da /api (o scritta con le maiuscole) non passa più senza login;
# gli asset per estensione/prefisso sì (404 di Flask, non 401 del gate).
c = crea_app(app_id="test")
for percorso in ("/etichette", "/API/dati", "/batch/jobs", "/@fs/C:/segreti/.token", "/dati.db"):
    r = get(c, percorso, headers={})
    controlla(f"fail-closed senza login: {percorso} -> 401", r.status_code == 401)
for percorso in ("/assets/app.js", "/static/logo.png", "/@vite/client", "/favicon.ico"):
    r = get(c, percorso, headers={})
    controlla(f"asset senza login: {percorso} non gattato", r.status_code == 404)
r = get(c, "/etichette", COOKIE_OK, headers={})
controlla("fail-closed: con la sessione la rotta fuori da /api risponde (404 di Flask)", r.status_code == 404)
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

# --- Adattatore ASGI (FastAPI): chiamato a mano, senza dipendenze ---
import asyncio  # noqa: E402


async def app_asgi(scope, receive, send):
    corpo = b"STATO" if "cosedil" in scope.get("state", {}) else b"APP"
    await send({"type": "http.response.start", "status": 200, "headers": []})
    await send({"type": "http.response.body", "body": corpo})


def get_asgi(app, path, cookie=None, accept="application/json"):
    headers = [(b"accept", accept.encode())]
    if cookie:
        headers.append((b"cookie", cookie.encode()))
    uscita = []

    async def receive():
        return {"type": "http.request", "body": b""}

    async def send(msg):
        uscita.append(msg)

    asyncio.run(app({"type": "http", "path": path, "headers": headers}, receive, send))
    inizio = uscita[0]
    return inizio["status"], dict(inizio["headers"]), uscita[1]["body"]


a = cosedil_sso.asgi(app_asgi, app_id="test")
s, h, b = get_asgi(a, "/api/dati", COOKIE_OK)
controlla("asgi: loggato passa, esito in scope state", s == 200 and b == b"STATO")
s, h, b = get_asgi(a, "/api/dati")
controlla("asgi: non loggato API 401 JSON", s == 401 and json.loads(b)["ok"] is False)
s, h, b = get_asgi(a, "/progetti", accept="text/html")
controlla("asgi: non loggato pagina 302 al portale",
          s == 302 and h[b"location"].decode().startswith(os.environ["COSEDIL_PORTAL"]))
s, h, b = get_asgi(a, "/assets/app.js", accept="*/*")
controlla("asgi: asset statici non gattati", s == 200 and b == b"APP")

a = cosedil_sso.asgi(app_asgi, app_id="test", solo_pagine=True, percorsi_liberi=("/invito/",))
s, h, b = get_asgi(a, "/api/dati")
controlla("asgi solo_pagine: API senza cookie lasciata all'app (JWT)", s == 200 and b == b"APP")
s, h, b = get_asgi(a, "/progetti", accept="text/html")
controlla("asgi solo_pagine: pagina senza login 302", s == 302)
s, h, b = get_asgi(a, "/invito/abc", accept="text/html")
controlla("asgi: percorso libero passa senza login", s == 200)
s, h, b = get_asgi(a, "/progetti", COOKIE_OK, accept="text/html")
controlla("asgi solo_pagine: pagina loggata passa", s == 200 and b == b"STATO")

a = cosedil_sso.asgi(app_asgi, app_id="test", admin_only=True)
s, h, b = get_asgi(a, "/api/dati", COOKIE_OK)
controlla("asgi admin_only: utente normale 403", s == 403)

# Password del portale negli altri programmi (SkyTower, InCampo, VFP Transfer).
v = cosedil_sso.verifica_password("mario@cosedilspa.com", "Giusta-2026", "incampo", ip="10.0.0.7")
controlla("verifica_password: giusta -> ok, username ed email in minuscolo",
          v["ok"] and v["username"] == "mario" and v["email"] == "mario@cosedilspa.com" and v["status"] == 200)
controlla("verifica_password: al portale arrivano programma e IP della persona",
          ULTIMA_VERIFICA.get("app") == "incampo" and ULTIMA_VERIFICA.get("ip") == "10.0.0.7")
v = cosedil_sso.verifica_password("mario@cosedilspa.com", "sbagliata", "incampo")
controlla("verifica_password: sbagliata -> 401, portale raggiungibile", not v["ok"] and v["status"] == 401 and v["reachable"])
v = cosedil_sso.verifica_password("uscito", "x", "incampo")
controlla("verifica_password: 403 col motivo del portale", v["status"] == 403 and v["motivo"] == "disattivato")
os.environ["SUITE_TOKEN"] = "token-sbagliato"
v = cosedil_sso.verifica_password("mario@cosedilspa.com", "Giusta-2026", "incampo")
controlla("verifica_password: token sbagliato -> niente accesso", not v["ok"] and v["status"] == 403)
os.environ["SUITE_TOKEN"] = "token-di-prova"

# Portale giù: cookie mai visti (la cache tiene gli esiti per sid).
server.shutdown()
v = cosedil_sso.verifica_password("mario@cosedilspa.com", "Giusta-2026", "incampo", timeout=1)
controlla("verifica_password: portale giù -> reachable False, mai un'eccezione", not v["ok"] and not v["reachable"])
c = crea_app(app_id="giu")
r = get(c, "/api/dati", "sid=nuovo-1")
controlla("portale giù: gate chiuso 503", r.status_code == 503)

c = crea_app(app_id="giu2", fail_open=True)
r = get(c, "/api/dati", "sid=nuovo-2")
controlla("portale giù: fail_open passa", r.status_code == 200)

s, h, b = get_asgi(cosedil_sso.asgi(app_asgi, app_id="giu3"), "/api/dati", "sid=nuovo-3")
controlla("asgi portale giù: gate chiuso 503", s == 503)

print("\nTutti i test superati.")
