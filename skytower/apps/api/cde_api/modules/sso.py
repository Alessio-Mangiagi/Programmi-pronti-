# "><(((º> sabusabu <º)))><"
"""Single sign-on OpenID Connect per organizzazione (backlog ADR-05, ADR-25).

Configurazione (admin dell'organizzazione):  GET/PUT/DELETE /organizations/{id}/sso
Login:  POST /auth/sso/start {email}  → URL dell'IdP (authorization code + PKCE, state e nonce monouso)
        GET  /auth/sso/callback        → scambio del codice, verifica dell'id_token, sessione (cookie di
                                         refresh) e ritorno alla SPA su /login#sso=...
L'utente deve già esistere nell'organizzazione (invitato o attivo): il single sign-on non crea account.
Se l'IdP non garantisce l'MFA (idp_mfa = false) resta il secondo fattore del CDE.
"""
from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import timedelta
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field, field_validator

from ..deps import Ctx, Services, client_ip, ctx, services
from ..errors import ApiError, not_found
from ..events import security_event
from ..security import oidc
from .auth import _has_verified_factor, _load_user, _now, _start_session, _ua

router = APIRouter(tags=["auth"])
STATE_TTL = timedelta(minutes=10)
BROWSER_COOKIE = "cde_sso"


class SsoIn(BaseModel):
    issuer: str = Field(pattern=r"^https?://\S+$", max_length=500)
    client_id: str = Field(min_length=1, max_length=255)
    client_secret: str | None = Field(default=None, max_length=500)   # None = resta quello salvato
    email_domains: list[str] = Field(min_length=1, max_length=20)
    enabled: bool = True
    enforce: bool = False
    idp_mfa: bool = True

    @field_validator("email_domains")
    @classmethod
    def _domains(cls, v: list[str]) -> list[str]:
        out = sorted({d.strip().lower().lstrip("@") for d in v if d.strip()})
        if not out or any("." not in d or "@" in d or " " in d for d in out):
            raise ValueError("Domini email non validi (es. impresa.it)")
        return out


class SsoStartIn(BaseModel):
    email: str = Field(min_length=3, max_length=320, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def redirect_uri(svc: Services) -> str:
    return f"{svc.settings.web_base_url.rstrip('/')}{svc.settings.public_api_prefix}/auth/sso/callback"


def _check_issuer(svc: Services, issuer: str) -> None:
    if not issuer.startswith("https://") and svc.settings.env not in ("dev", "test"):
        raise ApiError(422, "insecure_issuer", "L'issuer deve essere https")


def _public(row: dict | None, svc: Services) -> dict:
    base = {"redirect_uri": redirect_uri(svc)}
    if row is None:
        return {**base, "sso": None}
    return {**base, "sso": {k: row[k] for k in ("issuer", "client_id", "email_domains", "enabled", "enforce", "idp_mfa",
                                                 "updated_at")} | {"has_client_secret": row["client_secret_encrypted"] is not None}}


# ---------------------------------------------------------------------
# Configurazione
# ---------------------------------------------------------------------
@router.get("/organizations/{org_id}/sso")
def get_sso(org_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        if not conn.execute("SELECT cde.can_manage_org(%s) ok", [org_id]).fetchone()["ok"]:
            raise not_found("Organizzazione")
        row = conn.execute("SELECT * FROM cde.organization_sso WHERE organization_id = %s", [org_id]).fetchone()
    return _public(row, c.svc)


@router.put("/organizations/{org_id}/sso")
def put_sso(org_id: uuid.UUID, body: SsoIn, c: Ctx = Depends(ctx)):
    _check_issuer(c.svc, body.issuer)
    with c.tx() as conn:
        if not conn.execute("SELECT cde.can_manage_org(%s) ok", [org_id]).fetchone()["ok"]:
            raise not_found("Organizzazione")
        old = conn.execute("SELECT client_secret_encrypted FROM cde.organization_sso WHERE organization_id = %s",
                           [org_id]).fetchone()
        secret = (c.svc.kms.encrypt(body.client_secret.encode()) if body.client_secret
                  else old["client_secret_encrypted"] if old else None)
        conn.execute(
            """INSERT INTO cde.organization_sso (organization_id, issuer, client_id, client_secret_encrypted,
                   email_domains, enabled, enforce, idp_mfa, updated_by)
               VALUES (%(o)s, %(i)s, %(c)s, %(s)s, %(d)s, %(e)s, %(f)s, %(m)s, cde.current_app_user())
               ON CONFLICT (organization_id) DO UPDATE SET issuer = EXCLUDED.issuer, client_id = EXCLUDED.client_id,
                   client_secret_encrypted = EXCLUDED.client_secret_encrypted, email_domains = EXCLUDED.email_domains,
                   enabled = EXCLUDED.enabled, enforce = EXCLUDED.enforce, idp_mfa = EXCLUDED.idp_mfa,
                   updated_by = EXCLUDED.updated_by, updated_at = now()""",
            {"o": org_id, "i": body.issuer.rstrip("/"), "c": body.client_id, "s": secret, "d": body.email_domains,
             "e": body.enabled, "f": body.enforce, "m": body.idp_mfa})
        security_event(conn, "SSO_CONFIGURED", user_id=c.user_id, organization_id=org_id, ip=c.ip,
                       issuer=body.issuer, domains=body.email_domains, enforce=body.enforce, enabled=body.enabled)
        row = conn.execute("SELECT * FROM cde.organization_sso WHERE organization_id = %s", [org_id]).fetchone()
    return _public(row, c.svc)


@router.delete("/organizations/{org_id}/sso", status_code=204)
def delete_sso(org_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        if conn.execute("DELETE FROM cde.organization_sso WHERE organization_id = %s", [org_id]).rowcount == 0:
            raise not_found("Configurazione single sign-on")
        security_event(conn, "SSO_REMOVED", user_id=c.user_id, organization_id=org_id, ip=c.ip)
    return Response(status_code=204)


@router.post("/organizations/{org_id}/sso/test")
def test_sso(org_id: uuid.UUID, c: Ctx = Depends(ctx)):
    """Controlla che l'issuer risponda con una discovery valida (prima di attivare l'obbligo)."""
    with c.tx() as conn:
        row = conn.execute("SELECT issuer FROM cde.organization_sso WHERE organization_id = %s", [org_id]).fetchone()
    if row is None:
        raise not_found("Configurazione single sign-on")
    try:
        doc = oidc.discovery(row["issuer"])
    except oidc.OidcError as exc:
        raise ApiError(502, exc.code, "L'IdP non risponde con una configurazione OpenID valida") from None
    return {"ok": True, "authorization_endpoint": doc["authorization_endpoint"]}


def sso_for_domain(conn, email: str) -> dict | None:
    """Configurazione attiva per il dominio dell'email (usata anche dal login con password per l'obbligo)."""
    domain = email.rsplit("@", 1)[-1].lower()
    return conn.execute("SELECT * FROM cde.organization_sso WHERE enabled AND %s = ANY (email_domains)",
                        [domain]).fetchone()


# ---------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------
@router.post("/auth/sso/start")
def sso_start(body: SsoStartIn, request: Request, response: Response, svc: Services = Depends(services)):
    email = body.email.lower()
    if not svc.limiter.hit("30/minute", "sso", client_ip(request) or "-"):     # niente credenziali, ma discovery e righe di stato
        raise ApiError(429, "rate_limited", "Troppi tentativi: riprovare tra un minuto", {"Retry-After": "60"})
    with svc.db.auth_tx() as conn:
        cfg = sso_for_domain(conn, email)
        if cfg is None:
            return {"sso": False}
        try:
            doc = oidc.discovery(cfg["issuer"])
        except oidc.OidcError:
            raise ApiError(502, "idp_unreachable", "Il single sign-on della tua organizzazione non risponde") from None
        state, nonce, browser = secrets.token_urlsafe(32), secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        verifier, challenge = oidc.pkce_pair()
        conn.execute("DELETE FROM cde.sso_states WHERE expires_at < now()")
        conn.execute(
            """INSERT INTO cde.sso_states (state_hash, browser_hash, organization_id, nonce, code_verifier, expires_at)
               VALUES (%s, %s, %s, %s, %s, %s)""",
            [hashlib.sha256(state.encode()).digest(), hashlib.sha256(browser.encode()).digest(), cfg["organization_id"],
             nonce, verifier, _now() + STATE_TTL])
    # il ritorno dall'IdP è una navigazione di primo livello (GET): SameSite=Lax basta perché il cookie arrivi
    response.set_cookie(BROWSER_COOKIE, browser, max_age=int(STATE_TTL.total_seconds()), httponly=True,
                        secure=svc.settings.cookie_secure, samesite="lax",
                        path=f"{svc.settings.refresh_cookie_path}/sso")
    url = oidc.authorize_url(doc, client_id=cfg["client_id"], redirect_uri=redirect_uri(svc), state=state, nonce=nonce,
                             challenge=challenge, login_hint=email)
    return {"sso": True, "authorize_url": url}


def _back(svc: Services, **fragment) -> RedirectResponse:
    """Ritorno alla SPA: l'esito nel frammento (#), che il browser non manda ai server né scrive nei log."""
    r = RedirectResponse(f"{svc.settings.web_base_url.rstrip('/')}/login#{urlencode(fragment)}", status_code=303)
    r.delete_cookie(BROWSER_COOKIE, path=f"{svc.settings.refresh_cookie_path}/sso")
    return r


@router.get("/auth/sso/callback")
def sso_callback(request: Request, state: str = "", code: str = "", error: str = "",
                 svc: Services = Depends(services)):
    with svc.db.auth_tx() as conn:
        row = conn.execute(
            """UPDATE cde.sso_states SET used_at = now()
               WHERE state_hash = %s AND browser_hash = %s AND used_at IS NULL AND expires_at > now()
               RETURNING organization_id, nonce, code_verifier""",
            [hashlib.sha256(state.encode()).digest(),
             hashlib.sha256(request.cookies.get(BROWSER_COOKIE, "").encode()).digest()]).fetchone()
    if row is None:
        return _back(svc, sso="error", reason="expired")
    if error or not code:
        return _back(svc, sso="error", reason="idp_denied")
    with svc.db.auth_tx() as conn:
        cfg = conn.execute("SELECT * FROM cde.organization_sso WHERE organization_id = %s AND enabled",
                           [row["organization_id"]]).fetchone()
    if cfg is None:
        return _back(svc, sso="error", reason="disabled")
    try:
        doc = oidc.discovery(cfg["issuer"])
        secret = svc.kms.decrypt(cfg["client_secret_encrypted"]).decode() if cfg["client_secret_encrypted"] else None
        tokens = oidc.exchange_code(doc, code=code, client_id=cfg["client_id"], client_secret=secret,
                                    redirect_uri=redirect_uri(svc), verifier=row["code_verifier"])
        claims = oidc.verify_id_token(tokens["id_token"], doc, client_id=cfg["client_id"], nonce=row["nonce"])
    except oidc.OidcError as exc:
        with svc.db.auth_tx() as conn:
            security_event(conn, "SSO_FAIL", organization_id=row["organization_id"], ip=client_ip(request),
                           reason=str(exc)[:200])
        return _back(svc, sso="error", reason=exc.code)
    response = _back(svc, sso="ok")
    return _complete(svc, request, response, cfg, claims)


def _complete(svc: Services, request: Request, response: RedirectResponse, cfg: dict, claims: dict):
    email = oidc.email_from_claims(claims)
    ip = client_ip(request)
    with svc.db.auth_tx() as conn:
        user = None
        if email and email.rsplit("@", 1)[-1] in cfg["email_domains"]:
            found = conn.execute("SELECT id FROM cde.users WHERE email = %s AND organization_id = %s FOR UPDATE",
                                 [email, cfg["organization_id"]]).fetchone()
            user = _load_user(conn, found["id"]) if found else None
        if user is None or user["status"] not in ("ACTIVE", "INVITED") or user["org_status"] != "ACTIVE":
            security_event(conn, "SSO_FAIL", organization_id=cfg["organization_id"], ip=ip, email=email,
                           reason="unknown_or_disabled_user", subject=claims.get("sub"))
            return _back(svc, sso="error", reason="unknown_user")
        if user["status"] == "INVITED":           # primo accesso: l'invito vale come attivazione
            conn.execute("UPDATE cde.users SET status = 'ACTIVE' WHERE id = %s", [user["id"]])
            conn.execute("UPDATE cde.user_tokens SET used_at = now() WHERE user_id = %s AND purpose = 'INVITATION' "
                         "AND used_at IS NULL", [user["id"]])
            user = _load_user(conn, user["id"])
        conn.execute("UPDATE cde.users SET last_login_at = now(), failed_login_count = 0, locked_until = NULL "
                     "WHERE id = %s", [user["id"]])
        if not cfg["idp_mfa"]:
            if _has_verified_factor(conn, user["id"]):
                methods = [r["method"] for r in conn.execute(
                    "SELECT DISTINCT method::text FROM cde.user_mfa_factors WHERE user_id = %s AND verified_at "
                    "IS NOT NULL ORDER BY 1 DESC", [user["id"]]).fetchall()]
                security_event(conn, "LOGIN_SSO_OK", user_id=user["id"], ip=ip, next="mfa")
                return _back(svc, sso="mfa", mfa_token=svc.tokens.issue_mfa_pending(user["id"], enroll=False),
                             methods=",".join([*methods, "RECOVERY_CODE"]))
            if user["mfa_required"]:
                security_event(conn, "LOGIN_SSO_OK", user_id=user["id"], ip=ip, next="mfa_enrollment")
                return _back(svc, sso="enroll", mfa_token=svc.tokens.issue_mfa_pending(user["id"], enroll=True))
        amr = ["fed", "mfa"] if cfg["idp_mfa"] else ["fed"]
        security_event(conn, "LOGIN_OK", user_id=user["id"], organization_id=user["organization_id"], ip=ip,
                       user_agent=_ua(request), amr=",".join(amr), issuer=cfg["issuer"])
        _start_session(svc, conn, response, user, amr=amr, request=request)
    return response
