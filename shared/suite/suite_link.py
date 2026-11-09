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

NOMI = {
    "incampo": "InCampo", "skytower": "SkyTower", "magazzino": "Magazzino Operativo",
    "portale": "Portale", "ddt": "Lettore DDT", "scadenzario": "Scadenzario",
    "confronto": "Confronto Documenti", "verifica": "Verifica Requisiti",
    "analista": "Analista Dati", "trimble": "Ponte Trimble", "vfp": "VFP Transfer",
}

# (sottodominio dietro Caddy, porta pubblica, API interna di default)
# SkyTower: l'API FastAPI sta sulla 8100, la 5195 è il frontend che le inoltra sotto /api.
_APP = {
    "incampo": ("incampo", 5190, "http://127.0.0.1:5190/api"),
    "skytower": ("skytower", 5195, "http://127.0.0.1:8100"),
    "magazzino": ("magazzino-operativo", 5200, "http://127.0.0.1:5200/api"),
    "portale": ("portale", 8080, "http://127.0.0.1:8080/api"),
    "ddt": ("lettore-ddt", 5050, "http://127.0.0.1:5050/api"),
    "scadenzario": ("scadenzario", 5180, "http://127.0.0.1:5180/api"),
    "confronto": ("confronto-documenti", 5001, "http://127.0.0.1:5001"),
    "verifica": ("verifica-requisiti", 5185, "http://127.0.0.1:5185/api"),
    "analista": ("analista-dati", 5173, "http://127.0.0.1:5173/api"),
    "trimble": ("ponte-trimble", 3011, "http://127.0.0.1:3011/api"),
    "vfp": ("vfp-transfer", 8770, "http://127.0.0.1:8770/api"),
}

# API interne (dove si fanno le chiamate): SUITE_URL_<APP> le cambia.
URL_API = {app: os.environ.get(f"SUITE_URL_{app.upper()}", v[2]).rstrip("/") for app, v in _APP.items()}

HEADER_TOKEN = "X-Suite-Token"
HEADER_UTENTE = "X-Suite-Utente"
HEADER_NOME = "X-Suite-Nome"
HEADER_EMAIL = "X-Suite-Email"
FILE_TOKEN = Path(__file__).resolve().parent / ".token"
FILE_COMMESSE = Path(__file__).resolve().parent / "commesse.json"


def _magazzino_dentro_ddt():
    """True se il Magazzino si apre dentro il Lettore DDT (programma unico "DDT e Magazzino", 09/11/2026).
    MAGAZZINO_PROGRAMMA_UNICO=0 torna al Magazzino da solo, come in magazzino-operativo/config.py."""
    v = (os.environ.get("MAGAZZINO_PROGRAMMA_UNICO") or "1").strip().lower()
    return v not in ("0", "off", "no", "false")


def url_pubblico(app, magazzino_dentro_ddt=None):
    """Indirizzo che si può mostrare all'utente (link "Apri in InCampo").

    Il Magazzino sta dentro il Lettore DDT a <ddt>/magazzino: la sua porta 5200 ascolta solo sulla
    macchina (CONTRATTI § 11, C1-C2), quindi i link "Apri nel Magazzino" di InCampo, Analista ecc. vanno lì.
    ``magazzino_dentro_ddt`` lo decide chi chiama (il Magazzino passa la sua config); None = variabile
    MAGAZZINO_PROGRAMMA_UNICO."""
    forzato = os.environ.get(f"SUITE_URL_PUBBLICO_{app.upper()}")
    if forzato:
        return forzato.rstrip("/")
    if magazzino_dentro_ddt is None:
        magazzino_dentro_ddt = _magazzino_dentro_ddt()
    if app == "magazzino" and magazzino_dentro_ddt:
        return url_pubblico("ddt") + "/magazzino"
    dominio = (os.environ.get("SUITE_DOMINIO") or "").strip()
    sotto, porta, _ = _APP[app]
    if dominio:
        return f"https://{sotto}.{dominio}"
    return f"http://localhost:{porta}"


# ----------------------------------------------------------------------------- registro commesse
# Un'anagrafica sola per tutta la suite: ``shared/suite/commesse.json`` (fuori da git).
# La cura il portale (pagina Commesse degli admin, importazione dalle app o da
# CPM/Alyante via VFP Transfer); le app la leggono per offrire un menu a tendina
# invece del testo libero, così il codice combacia davvero fra InCampo, SkyTower,
# Magazzino, DDT e Scadenzario.
STATI_COMMESSA = ("attiva", "sospesa", "chiusa")


def _pulisci_commessa(c):
    # max 40 caratteri: il registro lo leggono tutte le app a ogni tendina, un codice da megabyte le fermerebbe
    code = re.sub(r"\s+", " ", str(c.get("code") or c.get("codice") or "")).strip()[:40]
    if not code:
        return None
    stato = str(c.get("stato") or "attiva").strip().lower()
    return {
        "code": code,
        "nome": str(c.get("nome") or c.get("name") or "").strip()[:200],
        "stato": stato if stato in STATI_COMMESSA else "attiva",
        "cliente": str(c.get("cliente") or "").strip()[:200],
        "indirizzo": str(c.get("indirizzo") or c.get("address") or "").strip()[:300],
        "note": str(c.get("note") or "").strip()[:500],
    }


def commesse(solo_attive=False):
    """Registro delle commesse (lista di dict code/nome/stato/cliente/indirizzo/note), ordinato per codice."""
    try:
        dati = json.loads(FILE_COMMESSE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    lista = dati.get("commesse", dati) if isinstance(dati, dict) else dati
    out = []
    for c in lista or []:
        if isinstance(c, dict):
            p = _pulisci_commessa(c)
            if p and (not solo_attive or p["stato"] == "attiva"):
                out.append(p)
    out.sort(key=lambda c: c["code"])
    return out


def salva_commesse(lista, fonte="manuale"):
    """Riscrive il registro (doppioni per codice normalizzato: vince l'ultimo). Ritorna la lista salvata."""
    per_codice = {}
    for c in lista or []:
        p = _pulisci_commessa(c) if isinstance(c, dict) else None
        if p:
            k = normalizza_commessa(p["code"])
            if k in per_codice:   # unisce: i campi vuoti del nuovo non cancellano i vecchi
                vecchio = per_codice[k]
                for campo, v in p.items():
                    if v or campo == "stato":
                        vecchio[campo] = v
            else:
                per_codice[k] = p
    out = sorted(per_codice.values(), key=lambda c: c["code"])
    from datetime import datetime
    dati = {"aggiornato": datetime.now().isoformat(timespec="seconds"), "fonte": fonte, "commesse": out}
    tmp = FILE_COMMESSE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(dati, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, FILE_COMMESSE)
    return out


def trova_commessa(codice):
    """La commessa del registro con quel codice (confronto normalizzato), o None."""
    k = normalizza_commessa(codice)
    if not k:
        return None
    for c in commesse():
        if normalizza_commessa(c["code"]) == k:
            return c
    return None


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
    # confronto in byte: con str, un header con caratteri non ASCII fa sollevare TypeError (500 invece di 401)
    return bool(valore) and hmac.compare_digest(str(valore).strip().encode("utf-8", "replace"),
                                                token().encode("utf-8"))


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


def intestazioni(utente=None, nome=None, email=None):
    h = {HEADER_TOKEN: token()}
    if utente:
        h[HEADER_UTENTE] = str(utente)[:120]
    if nome:
        h[HEADER_NOME] = str(nome)[:120].encode("latin-1", "replace").decode("latin-1")
    if email:
        h[HEADER_EMAIL] = str(email)[:160]
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
           file=None, corpo_file=None, grezzo=False, email=None):
    """Chiama un'altra app della suite.

    ``dati``: dict → JSON (o campi del multipart se c'è ``file``).
    ``file``: (nome_campo, nome_file, byte, content_type) → multipart/form-data.
    ``corpo_file``: (byte, content_type, nome_file) → il file è il corpo della richiesta
    (niente multipart: chi riceve non ha bisogno di python-multipart); il nome viaggia
    nell'header X-Suite-Nome-File, i metadati vanno in ``parametri``.
    ``grezzo``: ritorna (byte, content_type) invece del JSON decodificato.
    ``email``: email dell'utente del portale (X-Suite-Email), per le app con utenti propri.
    Solleva SuiteError con lo stato HTTP; 503 se l'app non risponde.
    """
    if app not in URL_API:
        raise SuiteError(app, 500, f"App sconosciuta: {app}")
    url = URL_API[app] + percorso
    if parametri:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode({k: v for k, v in parametri.items() if v not in (None, "")})
    testata = intestazioni(utente, nome, email)
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


# Percorso di salute di ogni app (senza token né sessione). Basta che risponda:
# anche un 401 dice che l'app è accesa.
SALUTE = {
    "incampo": "/healthz", "skytower": "/health", "magazzino": "/api/health", "portale": "/api/verify",
    "ddt": "/status", "scadenzario": "/api/health", "confronto": "/healthz", "verifica": "/status",
    "analista": "/api/health", "trimble": "/api/salute", "vfp": "/api/info",
}


def raggiungibile(app, timeout=2):
    """True se l'app risponde (qualunque stato HTTP < 500: anche 401/403 vuol dire accesa)."""
    base = URL_API[app]
    if base.endswith("/api"):
        base = base[:-4]
    try:
        with urllib.request.urlopen(base + SALUTE[app], timeout=timeout) as r:
            return r.status < 500
    except urllib.error.HTTPError as e:
        return e.code < 500
    except Exception:
        return False
