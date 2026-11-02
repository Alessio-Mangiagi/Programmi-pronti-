# "><(((º> sabusabu <º)))><"
"""Dialogo fra le app della suite Cosedil: InCampo, SkyTower, Magazzino Operativo.

Ogni app espone rotte ``/api/suite/...`` (o ``/suite/...`` su SkyTower) riservate
alle altre app della suite e chiama le altre con ``chiama()``. La chiave comune
è il **codice commessa aziendale** (es. ``101-003``): InCampo lo ha in
``Commessa.code``, SkyTower nelle impostazioni del progetto (``settings.commessa``),
il Magazzino sull'ubicazione (``ubicazioni.commessa``).

Autenticazione server-to-server: un token di servizio condiviso.
  * ``SUITE_TOKEN`` nell'ambiente, oppure
  * il file ``shared/suite/.token`` (creato alla prima richiesta da chi lo legge:
    tutte le app girano sullo stesso server e sulla stessa cartella, quindi lo
    condividono senza configurare nulla; è escluso da git).
Chi chiama manda anche chi è l'utente del portale (``X-Suite-Utente`` /
``X-Suite-Nome``): l'app chiamata lo usa per attribuire l'azione e, dove ha i
suoi utenti (InCampo, SkyTower), per cercare l'utente corrispondente.

Indirizzi: stesso server, porte del registro del portale. Si cambiano con
``SUITE_URL_INCAMPO``, ``SUITE_URL_SKYTOWER`` (API, non la pagina web) e
``SUITE_URL_MAGAZZINO``. I link che si mostrano all'utente usano l'indirizzo
pubblico (sottodomini di ``SUITE_DOMINIO`` dietro Caddy, altrimenti localhost).

Nessuna dipendenza oltre la libreria standard, come cosedil_sso.
"""
import hmac
import json
import os
import re
import secrets
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

NOMI = {"incampo": "InCampo", "skytower": "SkyTower", "magazzino": "Magazzino Operativo"}

# API interne (dove si fanno le chiamate). SkyTower: l'API FastAPI sta sulla 8100,
# la 5195 è il frontend che le inoltra sotto /api.
URL_API = {
    "incampo": os.environ.get("SUITE_URL_INCAMPO", "http://127.0.0.1:5190/api").rstrip("/"),
    "skytower": os.environ.get("SUITE_URL_SKYTOWER", "http://127.0.0.1:8100").rstrip("/"),
    "magazzino": os.environ.get("SUITE_URL_MAGAZZINO", "http://127.0.0.1:5200/api").rstrip("/"),
}

HEADER_TOKEN = "X-Suite-Token"
HEADER_UTENTE = "X-Suite-Utente"
HEADER_NOME = "X-Suite-Nome"
FILE_TOKEN = Path(__file__).resolve().parent / ".token"


def url_pubblico(app):
    """Indirizzo che si può mostrare all'utente (link "Apri in InCampo")."""
    forzato = os.environ.get(f"SUITE_URL_PUBBLICO_{app.upper()}")
    if forzato:
        return forzato.rstrip("/")
    dominio = (os.environ.get("SUITE_DOMINIO") or "").strip()
    if dominio:
        sotto = {"incampo": "incampo", "skytower": "skytower", "magazzino": "magazzino-operativo"}[app]
        return f"https://{sotto}.{dominio}"
    porta = {"incampo": 5190, "skytower": 5195, "magazzino": 5200}[app]
    return f"http://localhost:{porta}"


def token():
    """Token di servizio: ambiente, altrimenti file condiviso (creato se manca)."""
    t = (os.environ.get("SUITE_TOKEN") or "").strip()
    if t:
        return t
    try:
        t = FILE_TOKEN.read_text(encoding="utf-8").strip()
        if t:
            return t
    except OSError:
        pass
    t = secrets.token_urlsafe(32)
    try:
        FILE_TOKEN.write_text(t + "\n", encoding="utf-8")
        try:
            os.chmod(FILE_TOKEN, 0o600)
        except OSError:
            pass
    except OSError:
        # cartella non scrivibile: il token vale per questo processo e basta
        os.environ["SUITE_TOKEN"] = t
    return t


def verifica(valore):
    """True se ``valore`` (header X-Suite-Token) è il token di servizio."""
    return bool(valore) and hmac.compare_digest(str(valore).strip(), token())


def normalizza_commessa(codice):
    """Confronto robusto del codice commessa: senza spazi, maiuscolo."""
    return re.sub(r"\s+", "", str(codice or "")).upper()


class SuiteError(Exception):
    """Errore di una chiamata a un'altra app: stato HTTP (503 = app non raggiungibile) e messaggio in italiano."""

    def __init__(self, app, stato, messaggio):
        super().__init__(messaggio)
        self.app = app
        self.stato = stato
        self.messaggio = messaggio


def intestazioni(utente=None, nome=None):
    h = {HEADER_TOKEN: token()}
    if utente:
        h[HEADER_UTENTE] = str(utente)[:120]
    if nome:
        h[HEADER_NOME] = str(nome)[:120].encode("latin-1", "replace").decode("latin-1")
    return h


def _multipart(campi, file):
    """Corpo multipart/form-data: campi testo + un file (nome_campo, nome_file, byte, content_type)."""
    confine = "----suite" + uuid.uuid4().hex
    corpo = bytearray()
    for k, v in (campi or {}).items():
        if v is None:
            continue
        corpo += (f"--{confine}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n").encode("utf-8")
        corpo += (v if isinstance(v, str) else json.dumps(v, ensure_ascii=False)).encode("utf-8") + b"\r\n"
    if file:
        campo, nome_file, dati, ctype = file
        nome_file = nome_file.replace('"', "'")
        corpo += (f"--{confine}\r\nContent-Disposition: form-data; name=\"{campo}\"; filename=\"{nome_file}\"\r\n"
                  f"Content-Type: {ctype or 'application/octet-stream'}\r\n\r\n").encode("utf-8")
        corpo += dati + b"\r\n"
    corpo += f"--{confine}--\r\n".encode("utf-8")
    return bytes(corpo), f"multipart/form-data; boundary={confine}"


def _messaggio_errore(app, codice, corpo):
    try:
        dati = json.loads(corpo.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        dati = None
    if isinstance(dati, dict):
        for chiave in ("errore", "detail", "message", "error"):
            v = dati.get(chiave)
            if isinstance(v, str) and v.strip():
                return v
            if isinstance(v, dict) and isinstance(v.get("message"), str):
                return v["message"]
            if isinstance(v, list) and v:
                return "; ".join(str(x.get("msg", x) if isinstance(x, dict) else x) for x in v)
    testo = corpo[:200].decode("utf-8", "replace").strip()
    return f"{NOMI[app]}: errore {codice}" + (f" ({testo})" if testo and len(testo) < 120 else "")


HEADER_NOME_FILE = "X-Suite-Nome-File"


def chiama(app, metodo, percorso, dati=None, parametri=None, utente=None, nome=None, timeout=10,
           file=None, corpo_file=None, grezzo=False):
    """Chiama un'altra app della suite.

    ``dati``: dict → JSON (o campi del multipart se c'è ``file``).
    ``file``: (nome_campo, nome_file, byte, content_type) → multipart/form-data.
    ``corpo_file``: (byte, content_type, nome_file) → il file è il corpo della richiesta
    (niente multipart: chi riceve non ha bisogno di python-multipart); il nome viaggia
    nell'header X-Suite-Nome-File, i metadati vanno in ``parametri``.
    ``grezzo``: ritorna (byte, content_type) invece del JSON decodificato.
    Solleva SuiteError con lo stato HTTP; 503 se l'app non risponde.
    """
    if app not in URL_API:
        raise SuiteError(app, 500, f"App sconosciuta: {app}")
    url = URL_API[app] + percorso
    if parametri:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode({k: v for k, v in parametri.items() if v not in (None, "")})
    testata = intestazioni(utente, nome)
    corpo = None
    if corpo_file is not None:
        corpo, ctype, nome_file = corpo_file
        testata["Content-Type"] = ctype or "application/octet-stream"
        testata[HEADER_NOME_FILE] = urllib.parse.quote(nome_file or "file")
    elif file is not None:
        corpo, ctype = _multipart(dati, file)
        testata["Content-Type"] = ctype
    elif dati is not None:
        corpo = json.dumps(dati, ensure_ascii=False).encode("utf-8")
        testata["Content-Type"] = "application/json"
    testata["Accept"] = "application/json, */*"
    req = urllib.request.Request(url, data=corpo, method=metodo.upper(), headers=testata)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            contenuto = resp.read()
            tipo = resp.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        raise SuiteError(app, e.code, _messaggio_errore(app, e.code, e.read() or b"")) from None
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise SuiteError(app, 503, f"{NOMI[app]} non raggiungibile ({getattr(e, 'reason', e)}): è spenta? Aprila dal portale.") from None
    if grezzo:
        return contenuto, tipo
    if not contenuto:
        return None
    try:
        return json.loads(contenuto.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        raise SuiteError(app, 502, f"{NOMI[app]}: risposta non in JSON") from None


SALUTE = {"incampo": "/healthz", "skytower": "/health", "magazzino": "/api/health"}


def raggiungibile(app, timeout=2):
    """True se l'app risponde al suo health check (senza token)."""
    base = URL_API[app]
    if base.endswith("/api"):
        base = base[:-4]
    try:
        with urllib.request.urlopen(base + SALUTE[app], timeout=timeout) as r:
            return 200 <= r.status < 300
    except Exception:
        return False
