# "><(((º> sabusabu <º)))><"
"""Chiavi di sicurezza e passkey (WebAuthn) come secondo fattore, accanto al TOTP (ADR-05).

Cerimonie in due passi, ciascuna con una challenge casuale monouso salvata nel DB (5'):
  registrazione  POST /auth/mfa/webauthn/register/options → navigator.credentials.create → .../register/verify
  accesso        POST /auth/mfa/webauthn/options           → navigator.credentials.get    → .../verify
La registrazione si fa dal profilo (token di accesso) o durante il login se l'organizzazione impone l'MFA
(mfa_token di enrollment). L'accesso parte dal mfa_token rilasciato dopo la password: amr = pwd + hwk.
"""
from __future__ import annotations

import base64
import json
import secrets
import uuid
from datetime import timedelta
from urllib.parse import urlparse

import psycopg
from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers.exceptions import InvalidAuthenticationResponse, InvalidRegistrationResponse
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    AuthenticatorTransport,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from ..config import Settings
from ..deps import Services, client_ip, services
from ..errors import ApiError, unauthorized
from ..events import security_event
from ..security import alerts
from .auth import (
    _access_user,
    _load_user,
    _new_recovery_codes,
    _now,
    _pending_user,
    _raise_if_error,
    _start_session,
    _ua,
)

router = APIRouter(prefix="/auth/mfa/webauthn", tags=["auth"])
CHALLENGE_TTL = timedelta(minutes=5)
TRANSPORTS = {t.value for t in AuthenticatorTransport}


class RegisterOptionsIn(BaseModel):
    mfa_token: str | None = None          # enrollment obbligatorio durante il login


class RegisterVerifyIn(BaseModel):
    challenge_id: uuid.UUID
    credential: dict
    label: str = Field(default="Chiave di sicurezza", min_length=1, max_length=60)
    mfa_token: str | None = None


class AuthOptionsIn(BaseModel):
    mfa_token: str


class AuthVerifyIn(BaseModel):
    mfa_token: str
    challenge_id: uuid.UUID
    credential: dict


def rp_id(settings: Settings) -> str:
    return settings.webauthn_rp_id or urlparse(settings.web_base_url).hostname or "localhost"


def origins(settings: Settings) -> list[str]:
    """Origin da cui il browser può firmare: quello della SPA più eventuali alternativi (CORS, e2e)."""
    return list(dict.fromkeys([settings.web_base_url.rstrip("/"), *settings.cors_origins, *settings.webauthn_origins]))


def _new_challenge(conn: psycopg.Connection, user_id: uuid.UUID, purpose: str) -> tuple[uuid.UUID, bytes]:
    # le challenge scadute o già usate dell'utente non si accumulano
    conn.execute("DELETE FROM cde.webauthn_challenges WHERE user_id = %s AND (expires_at < now() OR used_at IS NOT NULL)",
                 [user_id])
    challenge = secrets.token_bytes(32)
    cid = conn.execute(
        """INSERT INTO cde.webauthn_challenges (user_id, purpose, challenge, expires_at)
           VALUES (%s, %s, %s, %s) RETURNING id""", [user_id, purpose, challenge, _now() + CHALLENGE_TTL]).fetchone()["id"]
    return cid, challenge


def _consume_challenge(conn: psycopg.Connection, challenge_id: uuid.UUID, user_id: uuid.UUID, purpose: str) -> bytes:
    row = conn.execute(
        """UPDATE cde.webauthn_challenges SET used_at = now()
           WHERE id = %s AND user_id = %s AND purpose = %s AND used_at IS NULL AND expires_at > now()
           RETURNING challenge""", [challenge_id, user_id, purpose]).fetchone()
    if row is None:
        raise ApiError(409, "challenge_expired", "Richiesta scaduta o già usata: riprovare")
    return bytes(row["challenge"])


def _credentials(conn: psycopg.Connection, user_id: uuid.UUID) -> list[dict]:
    return conn.execute(
        """SELECT id, webauthn_credential_id, webauthn_public_key, webauthn_sign_count, webauthn_transports
           FROM cde.user_mfa_factors WHERE user_id = %s AND method = 'WEBAUTHN' AND verified_at IS NOT NULL""",
        [user_id]).fetchall()


def _descriptor(row: dict) -> PublicKeyCredentialDescriptor:
    return PublicKeyCredentialDescriptor(id=bytes(row["webauthn_credential_id"]),
                                         transports=[AuthenticatorTransport(t) for t in row["webauthn_transports"]])


def has_webauthn(conn: psycopg.Connection, user_id: uuid.UUID) -> bool:
    return bool(_credentials(conn, user_id))


def _enrolling_user(svc: Services, request: Request, mfa_token: str | None) -> uuid.UUID:
    if mfa_token:
        user_id, enroll = _pending_user(svc, mfa_token)
        if not enroll:
            raise ApiError(400, "invalid", "Token MFA non valido per l'enrollment")
        return user_id
    return _access_user(svc, request)


# ---------------------------------------------------------------------
# Registrazione
# ---------------------------------------------------------------------
@router.post("/register/options")
def register_options(body: RegisterOptionsIn, request: Request, svc: Services = Depends(services)):
    user_id = _enrolling_user(svc, request, body.mfa_token)
    with svc.db.auth_tx() as conn:
        user = _load_user(conn, user_id)
        if user is None or user["status"] != "ACTIVE":
            raise unauthorized()
        challenge_id, challenge = _new_challenge(conn, user_id, "register")
        options = generate_registration_options(
            rp_id=rp_id(svc.settings), rp_name=svc.settings.totp_issuer, user_id=user_id.bytes,
            user_name=user["email"], user_display_name=f"{user['first_name']} {user['last_name']}",
            challenge=challenge, timeout=int(CHALLENGE_TTL.total_seconds() * 1000),
            exclude_credentials=[_descriptor(r) for r in _credentials(conn, user_id)],   # niente doppioni
            authenticator_selection=AuthenticatorSelectionCriteria(
                resident_key=ResidentKeyRequirement.PREFERRED,
                user_verification=UserVerificationRequirement.PREFERRED),
        )
    return {"challenge_id": challenge_id, "options": json.loads(options_to_json(options))}


@router.post("/register/verify")
def register_verify(body: RegisterVerifyIn, request: Request, response: Response, svc: Services = Depends(services)):
    via_login = body.mfa_token is not None
    user_id = _enrolling_user(svc, request, body.mfa_token)
    return _raise_if_error(_register_tx(body, user_id, via_login, request, response, svc))


def _register_tx(body: RegisterVerifyIn, user_id: uuid.UUID, via_login: bool, request: Request, response: Response,
                 svc: Services):
    with svc.db.auth_tx() as conn:
        challenge = _consume_challenge(conn, body.challenge_id, user_id, "register")
        try:
            verified = verify_registration_response(
                credential=body.credential, expected_challenge=challenge, expected_rp_id=rp_id(svc.settings),
                expected_origin=origins(svc.settings))
        except (InvalidRegistrationResponse, ValueError, KeyError, TypeError) as exc:
            security_event(conn, "MFA_ENROLL_FAIL", user_id=user_id, ip=client_ip(request), method="WEBAUTHN",
                           reason=str(exc)[:200])
            return ApiError(422, "invalid_credential", "Chiave non registrata: risposta del dispositivo non valida")
        if conn.execute("SELECT 1 FROM cde.user_mfa_factors WHERE webauthn_credential_id = %s",
                        [verified.credential_id]).fetchone():
            return ApiError(409, "already_registered", "Questa chiave è già registrata")
        transports = [t for t in (body.credential.get("response") or {}).get("transports") or [] if t in TRANSPORTS]
        first = conn.execute("SELECT NOT EXISTS (SELECT 1 FROM cde.user_mfa_factors WHERE user_id = %s "
                             "AND verified_at IS NOT NULL) f", [user_id]).fetchone()["f"]
        factor_id = conn.execute(
            """INSERT INTO cde.user_mfa_factors (user_id, method, label, webauthn_credential_id, webauthn_public_key,
                   webauthn_sign_count, webauthn_transports, verified_at)
               VALUES (%s, 'WEBAUTHN', %s, %s, %s, %s, %s, now()) RETURNING id""",
            [user_id, body.label.strip(), verified.credential_id, verified.credential_public_key, verified.sign_count,
             transports]).fetchone()["id"]
        user = _load_user(conn, user_id)
        security_event(conn, "MFA_ENROLLED", user_id=user_id, organization_id=user["organization_id"],
                       ip=client_ip(request), method="WEBAUTHN", factor_id=factor_id,
                       backed_up=verified.credential_backed_up)
        alerts.send(svc, conn, user_id, "mfa_added", ip=client_ip(request), detail=body.label.strip())
        # i recovery code nascono col primo fattore; chi aggiunge una chiave al TOTP tiene i suoi
        result: dict = {"factor_id": factor_id, "recovery_codes": (
            _new_recovery_codes(conn, user_id, svc.settings.recovery_codes_count) if first else None)}
        if via_login:
            result |= _start_session(svc, conn, response, user, amr=["pwd", "hwk"], request=request)
        return result


# ---------------------------------------------------------------------
# Accesso
# ---------------------------------------------------------------------
@router.post("/options")
def auth_options(body: AuthOptionsIn, svc: Services = Depends(services)):
    user_id, enroll = _pending_user(svc, body.mfa_token)
    if enroll:
        raise ApiError(400, "mfa_enrollment_required", "Configurare prima un fattore MFA")
    with svc.db.auth_tx() as conn:
        creds = _credentials(conn, user_id)
        if not creds:
            raise ApiError(409, "no_webauthn", "Nessuna chiave di sicurezza registrata")
        challenge_id, challenge = _new_challenge(conn, user_id, "authenticate")
    options = generate_authentication_options(
        rp_id=rp_id(svc.settings), challenge=challenge, timeout=int(CHALLENGE_TTL.total_seconds() * 1000),
        allow_credentials=[_descriptor(r) for r in creds], user_verification=UserVerificationRequirement.PREFERRED)
    return {"challenge_id": challenge_id, "options": json.loads(options_to_json(options))}


@router.post("/verify")
def auth_verify(body: AuthVerifyIn, request: Request, response: Response, svc: Services = Depends(services)):
    user_id, enroll = _pending_user(svc, body.mfa_token)
    if enroll:
        raise ApiError(400, "mfa_enrollment_required", "Configurare prima un fattore MFA")
    if not svc.limiter.hit("10/minute", "mfa", str(user_id)):
        raise ApiError(429, "rate_limited", "Troppi tentativi MFA", {"Retry-After": "60"})
    return _raise_if_error(_auth_tx(body, user_id, request, response, svc))


def _b64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _auth_tx(body: AuthVerifyIn, user_id: uuid.UUID, request: Request, response: Response, svc: Services):
    with svc.db.auth_tx() as conn:
        user = _load_user(conn, user_id)
        if user is None or user["status"] != "ACTIVE":
            raise unauthorized()
        challenge = _consume_challenge(conn, body.challenge_id, user_id, "authenticate")
        try:
            raw_id = _b64url_decode(str(body.credential.get("rawId") or body.credential.get("id") or ""))
        except ValueError:
            raw_id = b""
        factor = conn.execute(
            """SELECT id, webauthn_public_key, webauthn_sign_count FROM cde.user_mfa_factors
               WHERE user_id = %s AND method = 'WEBAUTHN' AND verified_at IS NOT NULL
                 AND webauthn_credential_id = %s FOR UPDATE""", [user_id, raw_id]).fetchone()
        try:
            if factor is None:
                raise InvalidAuthenticationResponse("chiave non registrata per l'utente")
            verified = verify_authentication_response(
                credential=body.credential, expected_challenge=challenge, expected_rp_id=rp_id(svc.settings),
                expected_origin=origins(svc.settings), credential_public_key=bytes(factor["webauthn_public_key"]),
                credential_current_sign_count=factor["webauthn_sign_count"] or 0)
        except (InvalidAuthenticationResponse, ValueError, KeyError, TypeError) as exc:
            security_event(conn, "MFA_FAIL", user_id=user_id, ip=client_ip(request), method="hwk",
                           reason=str(exc)[:200])
            return unauthorized("Chiave di sicurezza non riconosciuta")
        conn.execute("UPDATE cde.user_mfa_factors SET webauthn_sign_count = %s, last_used_at = now() WHERE id = %s",
                     [verified.new_sign_count, factor["id"]])
        security_event(conn, "LOGIN_OK", user_id=user_id, organization_id=user["organization_id"],
                       ip=client_ip(request), user_agent=_ua(request), amr="pwd,hwk")
        return _start_session(svc, conn, response, user, amr=["pwd", "hwk"], request=request)
