"""Gate SSO condiviso col Portale Suite Cosedil (Flask e ASGI) — unica fonte Python.

Gemello di cosedil-sso.js: stesse variabili d'ambiente, stesso comportamento.
Usato da confronta-pdf e scadenzario (Flask, init) e da incampo (FastAPI, asgi),
che lo raggiungono aggiungendo shared/sso al sys.path.

Verifica la sessione del portale inoltrando il cookie del browser a
<portale>/api/verify. La decisione sta in decidi(), senza framework; init()
la monta come before_request di Flask, asgi() avvolge un'app ASGI. Flask si
importa solo dentro init(): le app ASGI non devono averlo installato.

asgi(..., solo_pagine=True) controlla solo le navigazioni HTML e lascia le API
all'app: serve quando l'API ha già un suo login (JWT) e la usa anche chi il
cookie del portale non ce l'ha, come un'app mobile. percorsi_liberi=("/invito/",)
lascia passare pagine pubbliche.

Comportamento:
    - loggato nel portale       -> passa
    - non loggato, portale su   -> naviga verso il portale (302) / API 401
    - loggato ma app riservata  -> 403 "chiedi l’abilitazione" (mai al login)
    - portale irraggiungibile   -> dipende dal fail mode (vedi sotto)

Fail mode. Di default il gate è CHIUSO: se il portale non risponde nessuno entra.
Su un server in LAN è l'unica scelta difendibile — col fail-open bastava spegnere
il portale per usare le app senza login. Su un PC singolo, dove l'app deve
restare usabile da sola, si torna al vecchio comportamento con
COSEDIL_SSO_FAIL=open.

Admin per-app: init(app, app_id="scadenzario") chiede al portale se la sessione è
admin PER QUELL'APP (ruolo utente o IP di provenienza, vedi data/ip-admin.json
nel portale). L'esito finisce in flask.g.cosedil. Poi:
    admin_paths=("/api/admin",)  -> quelle rotte rispondono 403 ai non-admin
    admin_only=True              -> l'INTERA app è riservata agli admin

Config via variabili d'ambiente:
    COSEDIL_SSO=off                        disabilita il gate
    COSEDIL_PORTAL=http://localhost:8080   URL del portale per la verifica (default)
    COSEDIL_PORTAL_PUBBLICO=https://portale.<dominio>   dove mandare il browser
                                           al login (default = COSEDIL_PORTAL)
    COSEDIL_SSO_FAIL=open|closed           portale giù: passa / blocca (default closed)
"""
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

PORTAL = os.environ.get("COSEDIL_PORTAL", "http://localhost:8080").rstrip("/")
# Dietro reverse proxy la verifica resta in locale (PORTAL), ma il browser va
# mandato all'indirizzo pubblico: localhost:8080, per lui, e' il suo PC.
PORTAL_PUBBLICO = os.environ.get("COSEDIL_PORTAL_PUBBLICO", PORTAL).rstrip("/")
ENABLED = os.environ.get("COSEDIL_SSO", "on").lower() != "off"
FAIL_OPEN = os.environ.get("COSEDIL_SSO_FAIL", "closed").lower() == "open"

# Un esito certo vale 30s: evita di interrogare il portale a ogni richiesta. Un
# portale irraggiungibile vale molto meno: col gate chiuso un blip di rete
# bloccherebbe l'app per l'intera TTL.
CACHE_TTL = 30.0
CACHE_TTL_IRRAGGIUNGIBILE = 3.0
_cache = {}   # (sid, app_id) -> (scadenza, esito dict)

MSG_NON_LOGGATO = "Accesso riservato: accedi dal Portale Suite Cosedil"
MSG_PORTALE_GIU = ("Portale Suite Cosedil non raggiungibile: impossibile verificare "
                   "l'accesso. Riprova tra poco o avvisa un amministratore.")
MSG_NON_ADMIN = "Riservato agli amministratori"
MSG_NON_ABILITATO = ("Accesso riservato: questa app è abilitata solo ad alcuni utenti. "
                    "Chiedi l’abilitazione a un amministratore del portale.")


def leggi_sid(cookie_header):
    # "><(((º> sabusabu <º)))><"
    for part in (cookie_header or "").split(";"):
        part = part.strip()
        if part.startswith("sid="):
            return part[4:]
    return ""


def verifica_sessione(cookie_header, app_id=""):
    """Chiede al portale chi è l'utente di questo cookie (e se è admin per app_id).

    Ritorna sempre un dict: reachable=False significa "portale non risponde", che
    è diverso da ok=False ("portale risponde: non sei loggato").
    """
    key = (leggi_sid(cookie_header) or "none", app_id or "")
    now = time.time()
    hit = _cache.get(key)
    if hit and hit[0] > now:
        return hit[1]

    esito = {"ok": False, "reachable": True, "admin": False,
             "username": None, "nome": None, "ruolo": None, "vietato": False}
    try:
        url = PORTAL + "/api/verify"
        if app_id:
            url += "?" + urllib.parse.urlencode({"app": app_id})
        req = urllib.request.Request(url, headers={"Cookie": cookie_header or ""})
        with urllib.request.urlopen(req, timeout=2) as resp:
            esito["ok"] = resp.status == 200
            try:
                dati = json.loads(resp.read().decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                dati = {}          # corpo non-JSON: l'utente resta loggato ma senza dettagli
            esito["admin"] = bool(dati.get("admin"))
            esito["username"] = dati.get("username")
            esito["nome"] = dati.get("nome")
            esito["ruolo"] = dati.get("ruolo")
    except urllib.error.HTTPError as errore:
        # 403: sessione valida ma app riservata a cui l’utente non ha accesso.
        # Rimandarlo al login non servirebbe: il login lo ha già fatto.
        esito["vietato"] = errore.code == 403
    except Exception:
        esito["reachable"] = False  # portale spento / irraggiungibile

    ttl = CACHE_TTL if esito["reachable"] else CACHE_TTL_IRRAGGIUNGIBILE
    _cache[key] = (now + ttl, esito)
    return esito


def decidi(path, accept, cookie, app_id="", admin_only=False, admin_paths=(),
           chiuso_se_giu=True, solo_pagine=False, percorsi_liberi=()):
    """Il cuore del gate, senza framework: (esito, rifiuto).

    rifiuto è None se la richiesta passa, altrimenti (codice, is_doc, messaggio)
    oppure ("redirect", url). esito è il dict di verifica_sessione (None se la
    richiesta non è stata nemmeno guardata: asset, percorsi liberi).
    """
    is_doc = "text/html" in (accept or "")
    is_api = path.startswith("/api")
    # Gate solo su navigazioni e chiamate API: gli asset statici passano.
    # solo_pagine: le API le protegge l'app da sola (es. JWT per l'app mobile,
    # che il cookie del portale non ce l'ha).
    if not is_doc and (solo_pagine or not is_api):
        return None, None
    if percorsi_liberi and path.startswith(tuple(percorsi_liberi)):
        return None, None

    v = verifica_sessione(cookie, app_id)
    if v["ok"]:
        rotta_admin = admin_only or path.startswith(tuple(admin_paths or ()))
        if rotta_admin and not v["admin"]:
            return v, (403, is_doc, MSG_NON_ADMIN)
        return v, None

    if v.get("vietato"):
        return v, (403, is_doc, MSG_NON_ABILITATO)

    if not v["reachable"]:
        # Portale giù: col gate aperto l'app resta usabile da sola (PC
        # singolo), col gate chiuso (default) non entra nessuno.
        if not chiuso_se_giu:
            return v, None
        return v, (503, is_doc, MSG_PORTALE_GIU)

    # Portale raggiungibile e sessione assente/scaduta: al login.
    if is_doc:
        return v, ("redirect", PORTAL_PUBBLICO + "/")
    return v, (401, is_doc, MSG_NON_LOGGATO)


def _chiuso_se_giu(fail_open):
    return not (FAIL_OPEN if fail_open is None else fail_open)


def init(app, app_id="", admin_only=False, admin_paths=(), fail_open=None):
    """Registra il gate sull'app Flask. No-op se COSEDIL_SSO=off."""
    if not ENABLED:
        return
    # Import qui e non in cima: le app ASGI (FastAPI) usano il modulo senza Flask.
    from flask import g, jsonify, redirect, request

    chiuso_se_giu = _chiuso_se_giu(fail_open)

    @app.before_request
    def _cosedil_gate():
        v, rifiuto = decidi(request.path, request.headers.get("Accept", ""),
                            request.headers.get("Cookie", ""), app_id, admin_only,
                            admin_paths, chiuso_se_giu)
        if v and v["ok"]:
            g.cosedil = v
        if rifiuto is None:
            return None
        if rifiuto[0] == "redirect":
            return redirect(rifiuto[1], code=302)
        codice, is_doc, messaggio = rifiuto
        if is_doc:
            return messaggio, codice, {"Content-Type": "text/plain; charset=utf-8"}
        return jsonify(ok=False, error=messaggio), codice


def asgi(app, app_id="", admin_only=False, admin_paths=(), fail_open=None,
         solo_pagine=False, percorsi_liberi=()):
    """Avvolge un'app ASGI (FastAPI, Starlette) col gate. Ritorna l'app da servire.

    Nessuna dipendenza oltre la libreria standard. L'esito della verifica finisce
    in scope["state"]["cosedil"] (request.state.cosedil in FastAPI).
    No-op se COSEDIL_SSO=off: ritorna l'app così com'è.
    """
    if not ENABLED:
        return app
    import asyncio

    chiuso_se_giu = _chiuso_se_giu(fail_open)

    async def gate(scope, receive, send):
        if scope["type"] != "http":
            return await app(scope, receive, send)
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        # verifica_sessione è sincrona (urllib, timeout 2s): fuori dal loop.
        v, rifiuto = await asyncio.to_thread(
            decidi, scope.get("path", ""), headers.get("accept", ""), headers.get("cookie", ""),
            app_id, admin_only, admin_paths, chiuso_se_giu, solo_pagine, percorsi_liberi)
        if v and v["ok"]:
            scope.setdefault("state", {})["cosedil"] = v
        if rifiuto is None:
            return await app(scope, receive, send)
        if rifiuto[0] == "redirect":
            codice, tipo, corpo, extra = 302, "text/plain; charset=utf-8", b"", [(b"location", rifiuto[1].encode())]
        else:
            codice, is_doc, messaggio = rifiuto
            extra = []
            if is_doc:
                tipo, corpo = "text/plain; charset=utf-8", messaggio.encode("utf-8")
            else:
                tipo = "application/json"
                corpo = json.dumps({"ok": False, "error": messaggio}, ensure_ascii=False).encode("utf-8")
        await send({"type": "http.response.start", "status": codice,
                    "headers": [(b"content-type", tipo.encode()),
                                (b"content-length", str(len(corpo)).encode())] + extra})
        await send({"type": "http.response.body", "body": corpo})

    return gate
