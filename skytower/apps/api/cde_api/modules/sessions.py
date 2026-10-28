# "><(((º> sabusabu <º)))><"
"""Sicurezza personale: cambio password dal profilo e sessioni aperte (una per famiglia di refresh token,
cioè per dispositivo/browser in cui si è fatto l'accesso). Lavora con il ruolo DB cde_auth, come auth.py.

  POST   /auth/password/change         password attuale + nuova; chiude le altre sessioni
  GET    /auth/sessions                 sessioni attive, con quella corrente marcata
  DELETE /auth/sessions/{family_id}     chiude una sessione
  POST   /auth/sessions/revoke-others   "esci da tutti gli altri dispositivi"
"""
from __future__ import annotations

import uuid

from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field

from ..deps import Services, bearer_token, client_ip, services
from ..errors import ApiError, not_found, unauthorized
from ..events import security_event
from ..security.tokens import hash_token
from .auth import _access_user, _has_verified_factor, _raise_if_error, _ua, ph, validate_password

router = APIRouter(prefix="/auth", tags=["auth"])


class PasswordChangeIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(max_length=256)


def _current_family(svc: Services, conn, request: Request, user_id: uuid.UUID) -> uuid.UUID | None:
    token = request.cookies.get(svc.settings.refresh_cookie_name)
    if not token:
        return None
    row = conn.execute("SELECT family_id FROM cde.refresh_tokens WHERE token_hash = %s AND user_id = %s",
                       [hash_token(token), user_id]).fetchone()
    return row["family_id"] if row else None


def _revoke_others(conn, user_id: uuid.UUID, keep: uuid.UUID | None) -> int:
    return conn.execute(
        """UPDATE cde.refresh_tokens SET revoked_at = now()
           WHERE user_id = %s AND revoked_at IS NULL AND family_id IS DISTINCT FROM %s""", [user_id, keep]).rowcount


@router.post("/password/change")
def change_password(body: PasswordChangeIn, request: Request, svc: Services = Depends(services)):
    user_id = _access_user(svc, request)
    if not svc.limiter.hit("10/minute", "password-change", str(user_id)):
        raise ApiError(429, "rate_limited", "Troppi tentativi: riprovare tra un minuto", {"Retry-After": "60"})
    claims = svc.tokens.decode_access(bearer_token(request))
    return _raise_if_error(_change_tx(body, user_id, claims.mfa, request, svc))


def _change_tx(body: PasswordChangeIn, user_id: uuid.UUID, mfa: bool, request: Request, svc: Services):
    with svc.db.auth_tx() as conn:
        user = conn.execute("SELECT id, email, password_hash FROM cde.users WHERE id = %s AND status = 'ACTIVE' FOR UPDATE",
                            [user_id]).fetchone()
        if user is None:
            raise unauthorized()
        if _has_verified_factor(conn, user_id) and not mfa:
            raise ApiError(403, "mfa_required", "Accedi con il secondo fattore per cambiare la password")
        if user["password_hash"] is None:
            raise ApiError(409, "no_password", "Il tuo account usa il single sign-on aziendale: la password si cambia lì")
        try:
            ph.verify(user["password_hash"], body.current_password)
        except (VerificationError, InvalidHashError):
            security_event(conn, "PASSWORD_CHANGE_FAIL", user_id=user_id, ip=client_ip(request))
            return ApiError(422, "wrong_password", "La password attuale non è corretta")   # evento registrato, poi errore
        if body.new_password == body.current_password:
            raise ApiError(422, "weak_password", "La nuova password deve essere diversa da quella attuale")
        validate_password(body.new_password, user["email"], svc.settings.password_min_length)
        conn.execute("UPDATE cde.users SET password_hash = %s, password_changed_at = now() WHERE id = %s",
                     [ph.hash(body.new_password), user_id])
        closed = _revoke_others(conn, user_id, _current_family(svc, conn, request, user_id))
        security_event(conn, "PASSWORD_CHANGED", user_id=user_id, ip=client_ip(request), user_agent=_ua(request),
                       sessions_closed=closed)
    return {"status": "ok", "sessions_closed": closed}


@router.get("/sessions")
def list_sessions(request: Request, svc: Services = Depends(services)):
    user_id = _access_user(svc, request)
    with svc.db.auth_tx() as conn:
        current = _current_family(svc, conn, request, user_id)
        rows = conn.execute(
            """SELECT family_id, min(issued_at) AS signed_in_at, max(issued_at) AS last_seen_at,
                      (array_agg(ip::text ORDER BY issued_at DESC))[1] AS ip,
                      (array_agg(user_agent ORDER BY issued_at DESC))[1] AS user_agent,
                      bool_or(mfa_verified) AS mfa
               FROM cde.refresh_tokens WHERE user_id = %s
               GROUP BY family_id
               HAVING bool_or(revoked_at IS NULL AND expires_at > now())
               ORDER BY max(issued_at) DESC""", [user_id]).fetchall()
    return [{**r, "current": r["family_id"] == current} for r in rows]


@router.delete("/sessions/{family_id}", status_code=204)
def revoke_session(family_id: uuid.UUID, request: Request, svc: Services = Depends(services)):
    user_id = _access_user(svc, request)
    with svc.db.auth_tx() as conn:
        if conn.execute("UPDATE cde.refresh_tokens SET revoked_at = now() WHERE user_id = %s AND family_id = %s "
                        "AND revoked_at IS NULL", [user_id, family_id]).rowcount == 0:
            raise not_found("Sessione")
        security_event(conn, "SESSION_REVOKED", user_id=user_id, ip=client_ip(request), family_id=family_id)
    return Response(status_code=204)


@router.post("/sessions/revoke-others")
def revoke_other_sessions(request: Request, svc: Services = Depends(services)):
    user_id = _access_user(svc, request)
    with svc.db.auth_tx() as conn:
        closed = _revoke_others(conn, user_id, _current_family(svc, conn, request, user_id))
        security_event(conn, "SESSIONS_REVOKED", user_id=user_id, ip=client_ip(request), sessions_closed=closed)
    return {"sessions_closed": closed}
