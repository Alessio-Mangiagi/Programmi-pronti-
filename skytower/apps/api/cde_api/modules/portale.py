# "><(((º> sabusabu <º)))><"
"""Login automatico dal portale della suite Cosedil (``POST /auth/portale``).

Chi è già entrato nel portale ha il cookie ``sid``; il browser lo manda anche a SkyTower
(stesso host, o stesso ``SUITE_DOMINIO`` dietro Caddy). Questa rotta gira **solo il valore di
``sid``** al portale (``/api/verify``) e apre la sessione SkyTower come dopo un login normale.

Regole (ADR-47, dopo la revisione di sicurezza del 03/11/2026): il portale è una sola
organizzazione, quella della suite (``CDE_SUITE_ORG_ID``, altrimenti quella dell'utente tecnico
``CDE_SUITE_USER_EMAIL``, altrimenti quella del primo platform admin). Quindi:

* l'utente SkyTower si cerca **solo per email esatta** e **solo in quell'organizzazione**: niente
  ripiego sulla parte prima della ``@`` (un admin del portale poteva scegliersi uno username e
  agganciare un account qualunque, anche di un altro tenant);
* un platform admin, un utente di un'altra organizzazione, uno con SSO obbligatorio o con l'account
  bloccato **non entra** da qui: con la password, se ce l'ha;
* se l'utente ha un fattore MFA attivo, o l'organizzazione lo pretende, la risposta è la stessa del
  login con password (``mfa_required`` / ``mfa_enrollment_required``): il portale non sostituisce
  il secondo fattore;
* se l'utente non esiste lo crea nell'organizzazione della suite, attivo e senza password, con
  l'email del portale (o ``<username>@CDE_SUITE_EMAIL_DOMINIO``); se quell'email appartiene già a
  un'altra organizzazione, niente account;
* lo rende membro dei soli progetti **di proprietà dell'organizzazione della suite** con codice
  commessa (``settings.commessa``), col ruolo ``CDE_SUITE_RUOLO_PORTALE`` (default ``DESIGNER``),
  anche se è admin del portale: i ruoli forti li dà un Project Admin a mano. L'inserimento gira a
  nome di un Project Admin del progetto, perché RLS lo pretende.

La rotta è anonima: ha un limite per IP e una cache di 30 secondi dell'esito per ``sid``, così un
browser che la richiama (o chi la martella) non tiene occupati portale e database.

Regole per le altre app in ``shared/suite/CONTRATTI.md`` §1-2.
"""
from __future__ import annotations

import json
import logging
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, Request, Response

from ..deps import Services, client_ip, services
from ..errors import ApiError
from ..events import security_event
from . import auth

_SHARED = Path(__file__).resolve().parents[5] / "shared"
for _d in ("sso", "suite"):
    if str(_SHARED / _d) not in sys.path:
        sys.path.insert(0, str(_SHARED / _d))
import cosedil_sso
import suite_link

log = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])
APP_ID = "skytower"
CACHE_TTL = 30                      # secondi: stesso sid → stessa risposta del portale, senza richiamarlo
_cache: dict[str, tuple[float, dict]] = {}
_cache_lock = threading.Lock()


def verifica_portale(cookie_header: str) -> dict:
    """Chiede al portale chi è l'utente del cookie. Come cosedil_sso.verifica_sessione, ma tiene anche l'email.

    Al portale va **solo** ``sid=<valore>``: l'header Cookie del browser porta anche il refresh token di SkyTower
    (``cde_rt``, path ``/auth``), che non deve uscire da qui.
    Ritorna {"ok", "reachable", "username", "nome", "ruolo", "admin", "email"}."""
    esito = {"ok": False, "reachable": True, "username": None, "nome": None, "ruolo": None, "admin": False, "email": None}
    sid = cosedil_sso.leggi_sid(cookie_header)
    if not cosedil_sso.ENABLED or not sid:
        return esito
    with _cache_lock:
        hit = _cache.get(sid)
        if hit and hit[0] > time.monotonic():
            return dict(hit[1])
    try:
        url = cosedil_sso.PORTAL + "/api/verify?" + urllib.parse.urlencode({"app": APP_ID})
        req = urllib.request.Request(url, headers={"Cookie": f"sid={sid}"})
        with urllib.request.urlopen(req, timeout=2) as resp:
            dati = json.loads(resp.read().decode("utf-8") or "{}")
        esito.update(ok=True, username=dati.get("username"), nome=dati.get("nome"), ruolo=dati.get("ruolo"),
                     admin=bool(dati.get("admin")), email=dati.get("email"))
    except urllib.error.HTTPError:
        pass                                   # 401 = non loggato, 403 = app riservata: comunque niente accesso
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        esito["reachable"] = False
        return esito                           # un portale giù non si mette in cache: riproverà subito
    with _cache_lock:
        if len(_cache) > 5000:                 # sid casuali in massa non devono far crescere la memoria
            _cache.clear()
        _cache[sid] = (time.monotonic() + CACHE_TTL, dict(esito))
    return esito


def _nome_cognome(nome: str | None, username: str) -> tuple[str, str]:
    parti = (nome or "").strip().split()
    if len(parti) >= 2:
        return " ".join(parti[:-1]), parti[-1]
    if parti:
        return parti[0], "-"
    return username, "-"


def _attore_piattaforma(svc: Services) -> dict:
    """L'utente a nome del quale si crea l'account: platform admin (può inserire utenti in ogni organizzazione)."""
    with svc.db.auth_tx() as conn:
        row = conn.execute("""SELECT id, organization_id FROM cde.users WHERE is_platform_admin AND status = 'ACTIVE'
                              ORDER BY created_at LIMIT 1""").fetchone()
    if row is None:
        raise ApiError(503, "suite_user", "Nessun platform admin attivo: impossibile creare l'utente dal portale")
    return row


def organizzazione_suite(svc: Services, conn) -> uuid.UUID:
    """L'organizzazione della suite: l'unica in cui il portale può far entrare o creare utenti."""
    s = svc.settings
    if s.suite_org_id:
        return s.suite_org_id
    if s.suite_user_email:
        row = conn.execute("SELECT organization_id FROM cde.users WHERE lower(email) = lower(%s)", [s.suite_user_email]).fetchone()
        if row:
            return row["organization_id"]
    return _attore_piattaforma(svc)["organization_id"]


def _trova_utente(conn, email: str) -> dict | None:
    """L'utente con quell'email esatta, di qualunque organizzazione: chi lo chiama decide se è ammesso."""
    return conn.execute("""SELECT u.id, u.organization_id, u.email, u.status, u.is_org_admin, u.is_platform_admin,
                                  u.locked_until, o.mfa_required, o.status AS org_status
                           FROM cde.users u JOIN cde.organizations o ON o.id = u.organization_id
                           WHERE lower(u.email) = lower(%s)""", [email]).fetchone()


def _crea_utente(svc: Services, request: Request, org: uuid.UUID, email: str, username: str, nome: str | None,
                 admin: bool) -> dict:
    attore = _attore_piattaforma(svc)
    first, last = _nome_cognome(nome, username)
    uid = uuid.uuid4()
    with svc.db.app_tx(attore["id"]) as conn:
        conn.execute("""INSERT INTO cde.users (id, organization_id, email, first_name, last_name, is_org_admin, status)
                        VALUES (%s, %s, %s, %s, %s, %s, 'ACTIVE')""", [uid, org, email.lower(), first, last, admin])
        security_event(conn, "USER_CREATED_PORTALE", user_id=attore["id"], organization_id=org, ip=client_ip(request),
                        target=uid, email=email.lower(), username=username, admin=admin)
    return {"id": uid, "organization_id": org, "email": email.lower(), "status": "ACTIVE", "is_org_admin": admin,
            "is_platform_admin": False, "locked_until": None, "mfa_required": False, "org_status": "ACTIVE"}


def _progetti_con_commessa(conn, org: uuid.UUID) -> list[dict]:
    """I progetti **di proprietà dell'organizzazione della suite** con un codice commessa: solo in questi il portale
    iscrive i suoi utenti. Un progetto di un altro committente in cui l'azienda partecipa non si tocca (A3)."""
    rows = conn.execute("SELECT id, code, settings FROM cde.projects WHERE status <> 'ARCHIVED' AND owner_organization_id = %s",
                        [org]).fetchall()
    return [p for p in rows if ((p.get("settings") or {}).get("commessa") or "").strip()]


def assicura_membership(svc: Services, request: Request, user: dict, admin: bool = False) -> list[str]:
    """Rende l'utente membro dei progetti con codice commessa della sua organizzazione di cui non è ancora membro,
    col ruolo ``CDE_SUITE_RUOLO_PORTALE`` (mai PROJECT_ADMIN: ``admin`` resta per compatibilità e non conta).
    Ritorna i codici aggiunti."""
    del admin                                   # il ruolo del portale non dà più poteri sui progetti (ADR-47)
    ruolo = (svc.settings.suite_ruolo_portale or "DESIGNER").upper()
    if ruolo == "PROJECT_ADMIN":
        log.warning("CDE_SUITE_RUOLO_PORTALE=PROJECT_ADMIN non ammesso: uso DESIGNER")
        ruolo = "DESIGNER"
    aggiunti = []
    with svc.db.auth_tx() as conn:
        progetti = _progetti_con_commessa(conn, user["organization_id"])
        if not progetti:
            return aggiunti
        role = conn.execute("SELECT id FROM cde.roles WHERE project_id IS NULL AND code = %s", [ruolo]).fetchone()
        if role is None:
            log.warning("Ruolo di sistema %s inesistente: nessuna membership dal portale", ruolo)
            return aggiunti
        gia = {r["project_id"] for r in conn.execute("SELECT project_id FROM cde.project_memberships WHERE user_id = %s",
                                                      [user["id"]]).fetchall()}
        # a nome di chi: un Project Admin del progetto (RLS: solo lui gestisce le membership)
        admin_di = {}
        for r in conn.execute("""SELECT pm.project_id, pm.user_id FROM cde.project_memberships pm
                                 JOIN cde.roles r ON r.id = pm.role_id JOIN cde.users u ON u.id = pm.user_id
                                 WHERE r.code = 'PROJECT_ADMIN' AND u.status = 'ACTIVE'
                                 AND (pm.expires_at IS NULL OR pm.expires_at > now()) ORDER BY pm.granted_at NULLS LAST""").fetchall():
            admin_di.setdefault(r["project_id"], r["user_id"])
    for p in progetti:
        if p["id"] in gia or p["id"] not in admin_di:
            continue
        try:
            with svc.db.app_tx(admin_di[p["id"]]) as conn:
                conn.execute("""INSERT INTO cde.project_memberships (project_id, user_id, role_id, granted_by)
                                VALUES (%s, %s, %s, cde.current_app_user())""", [p["id"], user["id"], role["id"]])
                security_event(conn, "MEMBER_ADDED", user_id=admin_di[p["id"]], project_id=p["id"], ip=client_ip(request),
                               target=user["id"], role=role["id"], portale=True)
            aggiunti.append(p["code"])
        except Exception as e:   # noqa: BLE001 - un progetto storto non deve bloccare il login
            log.warning("Membership dal portale non creata su %s: %s", p["code"], e)
    return aggiunti


def _rifiuta(conn, request: Request, user: dict | None, motivo: str, messaggio: str, **dettagli) -> ApiError:
    """Accesso dal portale negato: evento di sicurezza con il motivo e 403 con un messaggio che dice cosa fare."""
    security_event(conn, "LOGIN_PORTALE_RIFIUTATO", user_id=user["id"] if user else None,
                   organization_id=user["organization_id"] if user else None, ip=client_ip(request),
                   user_agent=auth._ua(request), reason=motivo, **dettagli)
    return ApiError(403, f"portale_{motivo}", messaggio)


@router.post("/portale")
def login_portale(request: Request, response: Response, svc: Services = Depends(services)):
    """Entra in SkyTower con la sessione del portale (cookie ``sid``). 401 se non c'è o il portale non risponde,
    403 se l'utente non è ammesso da questa strada (vedi docstring del modulo), ``mfa_required`` se serve il
    secondo fattore."""
    ip = client_ip(request)
    if not svc.limiter.hit("30/minute", "portale", ip or "-"):
        raise ApiError(429, "rate_limited", "Troppi tentativi: riprovare tra un minuto", {"Retry-After": "60"})
    esito = verifica_portale(request.headers.get("cookie", ""))
    if not esito["reachable"]:
        raise ApiError(401, "portale_irraggiungibile", "Il portale della suite non risponde: entra con email e password")
    if not esito["ok"] or not esito.get("username"):
        raise ApiError(401, "portale_no_sessione", "Nessuna sessione del portale")
    username = str(esito["username"]).strip().lower()
    email = ((esito.get("email") or "").strip() or f"{username}@{svc.settings.suite_email_dominio}").lower()
    admin = bool(esito.get("admin"))
    creato = False
    with svc.db.auth_tx() as conn:
        org = organizzazione_suite(svc, conn)
        user = _trova_utente(conn, email)
        if user is not None:
            if user["organization_id"] != org:
                raise _rifiuta(conn, request, user, "altra_organizzazione",
                               "Questo indirizzo appartiene a un'altra organizzazione di SkyTower: entra con la tua password")
            if user["is_platform_admin"]:
                raise _rifiuta(conn, request, user, "platform_admin",
                               "Gli amministratori della piattaforma entrano solo con password e secondo fattore")
            if user["status"] != "ACTIVE" or user["org_status"] != "ACTIVE":
                raise _rifiuta(conn, request, user, "disattivato", "Il tuo account SkyTower è disattivato")
            if user["locked_until"] and user["locked_until"] > auth._now():
                raise _rifiuta(conn, request, user, "bloccato", "Account temporaneamente bloccato: riprova più tardi")
            if auth._sso_enforced(conn, user["id"]):
                raise _rifiuta(conn, request, user, "sso",
                               "La tua organizzazione usa il single sign-on: accedi con l'account aziendale")
    if user is None:
        user = _crea_utente(svc, request, org, email, username, esito.get("nome"), admin)
        creato = True
    progetti = assicura_membership(svc, request, user)
    with svc.db.auth_tx() as conn:
        # il portale ha verificato la sessione, ma il secondo fattore resta di SkyTower: stessa risposta del login
        if auth._has_verified_factor(conn, user["id"]):
            security_event(conn, "LOGIN_PORTALE", user_id=user["id"], organization_id=user["organization_id"], ip=ip,
                           user_agent=auth._ua(request), username=username, creato=creato, progetti=progetti, next="mfa")
            methods = [r["method"] for r in conn.execute(
                "SELECT DISTINCT method::text FROM cde.user_mfa_factors WHERE user_id = %s AND verified_at IS NOT NULL "
                "ORDER BY 1 DESC", [user["id"]]).fetchall()]
            return {"status": "mfa_required", "methods": [*methods, "RECOVERY_CODE"],
                    "mfa_token": svc.tokens.issue_mfa_pending(user["id"], enroll=False), "creato": creato,
                    "progetti_aggiunti": progetti, "email": user["email"]}
        if user["mfa_required"]:
            security_event(conn, "LOGIN_PORTALE", user_id=user["id"], organization_id=user["organization_id"], ip=ip,
                           user_agent=auth._ua(request), username=username, creato=creato, progetti=progetti,
                           next="mfa_enrollment")
            return {"status": "mfa_enrollment_required", "mfa_token": svc.tokens.issue_mfa_pending(user["id"], enroll=True),
                    "creato": creato, "progetti_aggiunti": progetti, "email": user["email"]}
        # niente azzeramento di failed_login_count/locked_until: il portale non è una prova della password
        conn.execute("UPDATE cde.users SET last_login_at = now() WHERE id = %s", [user["id"]])
        security_event(conn, "LOGIN_PORTALE", user_id=user["id"], organization_id=user["organization_id"],
                       ip=ip, user_agent=auth._ua(request), username=username, creato=creato, progetti=progetti)
        sessione = auth._start_session(svc, conn, response, user, amr=["portale"], request=request)
    return {**sessione, "creato": creato, "progetti_aggiunti": progetti, "email": user["email"]}


__all__ = ["assicura_membership", "organizzazione_suite", "router", "suite_link", "verifica_portale"]
