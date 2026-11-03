# "><(((º> sabusabu <º)))><"
"""Login automatico dal portale della suite Cosedil (``POST /auth/portale``).

Chi è già entrato nel portale ha il cookie ``sid``; il browser lo manda anche a SkyTower
(stesso host, o stesso ``SUITE_DOMINIO`` dietro Caddy). Questa rotta lo gira al portale
(``/api/verify``), trova l'utente SkyTower con la stessa email (o con la parte prima
della ``@`` uguale allo username) e apre la sessione come dopo un login normale.

Se l'utente non esiste lo crea, attivo e senza password: organizzazione
``CDE_SUITE_ORG_ID`` (altrimenti quella dell'utente tecnico ``CDE_SUITE_USER_EMAIL``,
altrimenti quella del primo platform admin), org admin se è admin del portale.
Poi lo rende membro di tutti i progetti con codice commessa (``settings.commessa``)
col ruolo ``PROJECT_ADMIN`` (admin del portale) o ``CDE_SUITE_RUOLO_PORTALE``
(default ``DESIGNER``): l'inserimento gira a nome di un Project Admin del progetto,
perché RLS lo pretende. Un utente già esistente non membro viene aggiunto allo stesso modo.

Regole in ``shared/suite/CONTRATTI.md`` §1-2.
"""
from __future__ import annotations

import json
import logging
import sys
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


def verifica_portale(cookie_header: str) -> dict:
    """Chiede al portale chi è l'utente del cookie. Come cosedil_sso.verifica_sessione, ma tiene anche l'email.

    Ritorna {"ok", "reachable", "username", "nome", "ruolo", "admin", "email"}."""
    esito = {"ok": False, "reachable": True, "username": None, "nome": None, "ruolo": None, "admin": False, "email": None}
    if not cosedil_sso.ENABLED or not cosedil_sso.leggi_sid(cookie_header):
        return esito
    try:
        url = cosedil_sso.PORTAL + "/api/verify?" + urllib.parse.urlencode({"app": APP_ID})
        req = urllib.request.Request(url, headers={"Cookie": cookie_header or ""})
        with urllib.request.urlopen(req, timeout=2) as resp:
            dati = json.loads(resp.read().decode("utf-8") or "{}")
        esito.update(ok=True, username=dati.get("username"), nome=dati.get("nome"), ruolo=dati.get("ruolo"),
                     admin=bool(dati.get("admin")), email=dati.get("email"))
    except urllib.error.HTTPError:
        pass                                   # 401 = non loggato, 403 = app riservata: comunque niente accesso
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        esito["reachable"] = False
    return esito


def _nome_cognome(nome: str | None, username: str) -> tuple[str, str]:
    parti = (nome or "").strip().split()
    if len(parti) >= 2:
        return " ".join(parti[:-1]), parti[-1]
    if parti:
        return parti[0], "-"
    return username, "-"


def _trova_utente(conn, email: str, username: str) -> dict | None:
    row = conn.execute("SELECT id, organization_id, email, status, is_org_admin FROM cde.users WHERE lower(email) = lower(%s)",
                       [email]).fetchone()
    if row is None and username:
        row = conn.execute("""SELECT id, organization_id, email, status, is_org_admin FROM cde.users
                              WHERE lower(split_part(email, '@', 1)) = lower(%s) ORDER BY created_at LIMIT 1""",
                           [username]).fetchone()
    return row


def _attore_piattaforma(svc: Services) -> dict:
    """L'utente a nome del quale si crea l'account: platform admin (può inserire utenti in ogni organizzazione)."""
    with svc.db.auth_tx() as conn:
        row = conn.execute("""SELECT id, organization_id FROM cde.users WHERE is_platform_admin AND status = 'ACTIVE'
                              ORDER BY created_at LIMIT 1""").fetchone()
    if row is None:
        raise ApiError(503, "suite_user", "Nessun platform admin attivo: impossibile creare l'utente dal portale")
    return row


def _organizzazione(svc: Services, conn) -> uuid.UUID:
    s = svc.settings
    if s.suite_org_id:
        return s.suite_org_id
    if s.suite_user_email:
        row = conn.execute("SELECT organization_id FROM cde.users WHERE lower(email) = lower(%s)", [s.suite_user_email]).fetchone()
        if row:
            return row["organization_id"]
    return _attore_piattaforma(svc)["organization_id"]


def _crea_utente(svc: Services, request: Request, email: str, username: str, nome: str | None, admin: bool) -> dict:
    attore = _attore_piattaforma(svc)
    first, last = _nome_cognome(nome, username)
    uid = uuid.uuid4()
    with svc.db.app_tx(attore["id"]) as conn:
        org = _organizzazione(svc, conn)
        conn.execute("""INSERT INTO cde.users (id, organization_id, email, first_name, last_name, is_org_admin, status)
                        VALUES (%s, %s, %s, %s, %s, %s, 'ACTIVE')""", [uid, org, email.lower(), first, last, admin])
        security_event(conn, "USER_CREATED_PORTALE", user_id=attore["id"], organization_id=org, ip=client_ip(request),
                        target=uid, email=email.lower(), username=username, admin=admin)
    return {"id": uid, "organization_id": org, "email": email.lower(), "status": "ACTIVE", "is_org_admin": admin}


def _progetti_con_commessa(conn) -> list[dict]:
    rows = conn.execute("SELECT id, code, settings FROM cde.projects WHERE status <> 'ARCHIVED'").fetchall()
    return [p for p in rows if ((p.get("settings") or {}).get("commessa") or "").strip()]


def assicura_membership(svc: Services, request: Request, user: dict, admin: bool) -> list[str]:
    """Rende l'utente membro dei progetti con codice commessa di cui non è ancora membro. Ritorna i codici aggiunti."""
    ruolo = "PROJECT_ADMIN" if admin else (svc.settings.suite_ruolo_portale or "DESIGNER").upper()
    aggiunti = []
    with svc.db.auth_tx() as conn:
        progetti = _progetti_con_commessa(conn)
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


@router.post("/portale")
def login_portale(request: Request, response: Response, svc: Services = Depends(services)):
    """Entra in SkyTower con la sessione del portale (cookie ``sid``). 401 se non c'è o il portale non risponde."""
    esito = verifica_portale(request.headers.get("cookie", ""))
    if not esito["reachable"]:
        raise ApiError(401, "portale_irraggiungibile", "Il portale della suite non risponde: entra con email e password")
    if not esito["ok"] or not esito.get("username"):
        raise ApiError(401, "portale_no_sessione", "Nessuna sessione del portale")
    username = str(esito["username"]).strip().lower()
    email = (esito.get("email") or "").strip() or f"{username}@{svc.settings.suite_email_dominio}"
    admin = bool(esito.get("admin"))
    with svc.db.auth_tx() as conn:
        user = _trova_utente(conn, email, username)
    creato = False
    if user is None:
        user = _crea_utente(svc, request, email, username, esito.get("nome"), admin)
        creato = True
    elif user["status"] != "ACTIVE":
        raise ApiError(403, "user_disabled", "Il tuo account SkyTower è disattivato")
    progetti = assicura_membership(svc, request, user, admin)
    with svc.db.auth_tx() as conn:
        conn.execute("UPDATE cde.users SET last_login_at = now(), failed_login_count = 0, locked_until = NULL WHERE id = %s",
                     [user["id"]])
        security_event(conn, "LOGIN_PORTALE", user_id=user["id"], organization_id=user["organization_id"],
                       ip=client_ip(request), user_agent=auth._ua(request), username=username, creato=creato, progetti=progetti)
        sessione = auth._start_session(svc, conn, response, user, amr=["portale"], request=request)
    return {**sessione, "creato": creato, "progetti_aggiunti": progetti, "email": user["email"]}


__all__ = ["assicura_membership", "router", "suite_link", "verifica_portale"]
