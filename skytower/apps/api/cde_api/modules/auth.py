# "><(((º> sabusabu <º)))><"
"""Autenticazione (Sprint 1, G5–G6).

Login Argon2id → (eventuale) MFA TOTP, chiave di sicurezza (passkeys.py) o recovery code → JWT RS256 15' + refresh token opaco in cookie
HttpOnly, ruotato a ogni uso; il riuso di un token già ruotato revoca l'intera famiglia.
Lavora solo con il ruolo DB cde_auth.

Suite Cosedil (ADR-58, 11/11/2026): dopo la password giusta e prima del secondo fattore o della sessione si chiede al
portale il profilo della persona (portale.controlla_ingresso: disattivata o senza SkyTower fra i programmi → 403). Il
rinnovo della sessione non chiede nulla al portale (scelta 2b, "solo al login"), ma la catena dei rinnovi scade alla
data fissata dal login (non si allunga più a ogni rinnovo): il login, e quindi il controllo, torna almeno ogni
``CDE_REFRESH_TOKEN_TTL_S`` (14 giorni; 12 ore in HTTP).
"""
from __future__ import annotations

import base64
import io
import secrets
import time
import uuid
from datetime import UTC, datetime, timedelta

import jwt
import psycopg
import pyotp
import qrcode
import qrcode.image.svg
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, EmailStr, Field

from ..deps import Services, bearer_token, client_ip, services
from ..errors import ApiError, unauthorized
from ..events import security_event
from ..security import alerts
from ..security.tokens import MFA_AMR, hash_token, new_opaque_token

router = APIRouter(prefix="/auth", tags=["auth"])
ph = PasswordHasher()
_DUMMY_HASH = ph.hash("dummy-password-for-timing")
GENERIC_LOGIN_ERROR = "Credenziali non valide"


# ---------------------------------------------------------------------
# Modelli
# ---------------------------------------------------------------------
class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)


class MfaVerifyIn(BaseModel):
    mfa_token: str
    code: str | None = Field(default=None, pattern=r"^\d{6}$")
    recovery_code: str | None = Field(default=None, max_length=32)


class TotpEnrollIn(BaseModel):
    mfa_token: str | None = None          # enrollment obbligatorio durante il login
    label: str = Field(default="Authenticator", max_length=60)


class TotpConfirmIn(BaseModel):
    factor_id: uuid.UUID
    code: str = Field(pattern=r"^\d{6}$")
    mfa_token: str | None = None


class AcceptInvitationIn(BaseModel):
    password: str = Field(max_length=256)


class ForgotPasswordIn(BaseModel):
    email: EmailStr


class ResetPasswordIn(BaseModel):
    token: str
    password: str = Field(max_length=256)


# ---------------------------------------------------------------------
# Utilità
# ---------------------------------------------------------------------
def _now() -> datetime:
    return datetime.now(UTC)


def _ua(request: Request) -> str | None:
    return request.headers.get("user-agent")


def validate_password(password: str, email: str | None, min_length: int) -> None:
    if len(password) < min_length:
        raise ApiError(422, "weak_password", f"La password deve avere almeno {min_length} caratteri")
    if email and email.split("@")[0].lower() in password.lower():
        raise ApiError(422, "weak_password", "La password non deve contenere l'email")
    if len(set(password)) < 6:
        raise ApiError(422, "weak_password", "La password è troppo ripetitiva")


def _qr_svg_data_uri(uri: str) -> str:
    img = qrcode.make(uri, image_factory=qrcode.image.svg.SvgPathImage, box_size=8)
    buf = io.BytesIO()
    img.save(buf)
    return "data:image/svg+xml;base64," + base64.b64encode(buf.getvalue()).decode()


def _load_user(conn: psycopg.Connection, user_id: uuid.UUID) -> dict | None:
    return conn.execute(
        """SELECT u.id, u.organization_id, u.email, u.status, u.first_name, u.last_name,
                  o.mfa_required, o.status AS org_status
           FROM cde.users u JOIN cde.organizations o ON o.id = u.organization_id
           WHERE u.id = %s""",
        [user_id],
    ).fetchone()


def _has_verified_factor(conn: psycopg.Connection, user_id: uuid.UUID) -> bool:
    return conn.execute(
        "SELECT EXISTS (SELECT 1 FROM cde.user_mfa_factors WHERE user_id = %s AND verified_at IS NOT NULL) ok",
        [user_id],
    ).fetchone()["ok"]


def _sso_enforced(conn: psycopg.Connection, user_id: uuid.UUID) -> bool:
    """Organizzazione con single sign-on obbligatorio: si entra solo dall'IdP (il platform admin resta fuori)."""
    return conn.execute(
        """SELECT EXISTS (SELECT 1 FROM cde.organization_sso s JOIN cde.users u ON u.organization_id = s.organization_id
               WHERE u.id = %s AND s.enabled AND s.enforce AND NOT u.is_platform_admin) ok""",
        [user_id]).fetchone()["ok"]


def _start_session(svc: Services, conn: psycopg.Connection, response: Response, user: dict, *,
                   amr: list[str], request: Request, family_id: uuid.UUID | None = None,
                   expires_at: datetime | None = None) -> dict:
    """Emette access token e refresh token. ``family_id`` + ``expires_at`` per un rinnovo: il nuovo refresh token
    eredita la scadenza della catena (fissata dal login), così una sessione rinnovata ogni giorno non dura per sempre
    e il login — con il controllo del profilo del portale — torna almeno ogni CDE_REFRESH_TOKEN_TTL_S (ADR-58)."""
    scade = expires_at or (_now() + timedelta(seconds=svc.settings.refresh_token_ttl_s))
    if family_id is None:                      # nuovo accesso (non un rinnovo): dispositivo mai visto?
        seen = conn.execute(
            """SELECT EXISTS (SELECT 1 FROM cde.refresh_tokens WHERE user_id = %(u)s) AS any,
                      EXISTS (SELECT 1 FROM cde.refresh_tokens WHERE user_id = %(u)s AND user_agent = %(a)s) AS same""",
            {"u": user["id"], "a": _ua(request)}).fetchone()
        if seen["any"] and not seen["same"]:
            alerts.send(svc, conn, user["id"], "new_device", ip=client_ip(request),
                        detail=alerts.device_label(_ua(request)))
    token, token_hash = new_opaque_token()
    conn.execute(
        """INSERT INTO cde.refresh_tokens (user_id, family_id, token_hash, mfa_verified, expires_at, ip, user_agent)
           VALUES (%s, %s, %s, %s, %s, %s, %s)""",
        [user["id"], family_id or uuid.uuid4(), token_hash, bool(MFA_AMR & set(amr)), scade, client_ip(request), _ua(request)],
    )
    _set_refresh_cookie(svc, response, token, max_age=max(1, int((scade - _now()).total_seconds())))
    return {
        "status": "ok",
        "access_token": svc.tokens.issue_access(user["id"], user["organization_id"], amr),
        "token_type": "Bearer",
        "expires_in": svc.settings.access_token_ttl_s,
    }


def _set_refresh_cookie(svc: Services, response: Response, token: str, max_age: int | None = None) -> None:
    response.set_cookie(svc.settings.refresh_cookie_name, token, max_age=max_age or svc.settings.refresh_token_ttl_s,
                        httponly=True, secure=svc.settings.cookie_secure, samesite="strict", path=svc.settings.refresh_cookie_path)


def _clear_refresh_cookie(svc: Services, response: Response) -> None:
    response.delete_cookie(svc.settings.refresh_cookie_name, path=svc.settings.refresh_cookie_path, httponly=True,
                           secure=svc.settings.cookie_secure, samesite="strict")


def _pending_user(svc: Services, mfa_token: str) -> tuple[uuid.UUID, bool]:
    try:
        return svc.tokens.decode_mfa_pending(mfa_token)
    except jwt.InvalidTokenError:
        raise unauthorized("Sessione MFA scaduta: ripetere il login") from None


def _access_user(svc: Services, request: Request, *, require_mfa: bool = False) -> uuid.UUID:
    token = bearer_token(request)
    if not token:
        raise unauthorized()
    try:
        claims = svc.tokens.decode_access(token)
    except jwt.InvalidTokenError:
        raise unauthorized("Token non valido o scaduto") from None
    if require_mfa and not claims.mfa:
        raise ApiError(403, "mfa_required", "Operazione che richiede una sessione con MFA")
    return claims.user_id


# ---------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------
def _raise_if_error(outcome):
    """Le transazioni che devono persistere qualcosa (contatori, revoche) e poi fallire restituiscono l'errore."""
    if isinstance(outcome, ApiError):
        raise outcome
    return outcome


class _PasswordDelPortale:
    """Esito di _login_tx: la password non è quella di SkyTower ma quella del portale per questa email.

    Il login prosegue fuori dalla transazione, in portale.entra (stesse regole dell'ingresso dal portale)."""

    def __init__(self, esito: dict):
        self.esito = esito


def _password_del_portale(email: str, password: str, ip: str | None):
    """Una password per tutti i programmi della suite (06/11/2026): la password del portale vale anche qui.

    Chiamata da _login_tx quando la password di SkyTower non coincide (o l'utente non ha password o non esiste),
    PRIMA di contare il tentativo fallito: chi entra con la password del portale non deve accumulare errori.
    Ritorna _PasswordDelPortale se il portale la riconosce; ApiError 403 se è giusta ma il portale nega l'accesso
    (account disattivato, password temporanea da cambiare, SkyTower non fra i suoi programmi); None altrimenti
    (sbagliata anche lì, portale spento, COSEDIL_SSO=off): il login fallisce come prima."""
    from . import portale  # import qui: portale importa auth
    v = portale.verifica_password_portale(email, password, ip)
    if v.get("ok") and v.get("username"):
        return _PasswordDelPortale(v)
    if v.get("status") == 403:
        motivo = (v.get("motivo") or "negato").replace("-", "_")
        return ApiError(403, f"portale_{motivo}", v.get("errore") or "Accesso non consentito dal portale")
    return None


@router.post("/login")
def login(body: LoginIn, request: Request, response: Response, svc: Services = Depends(services)):
    email = body.email.lower()
    ip = client_ip(request)
    if not svc.limiter.hit(svc.settings.login_rate_limit, "login", ip or "-", email):
        raise ApiError(429, "rate_limited", "Troppi tentativi: riprovare tra un minuto", {"Retry-After": "60"})
    esito = _login_tx(body, email, ip, request, response, svc)
    if isinstance(esito, _PasswordDelPortale):
        from . import portale
        return portale.entra(svc, request, response, esito.esito, via="password")
    if isinstance(esito, _PasswordGiusta):
        return _raise_if_error(_dopo_la_password(svc, request, response, esito.user))
    return _raise_if_error(esito)


class _PasswordGiusta:
    """Esito di _login_tx: password di SkyTower giusta, contatori già azzerati. Il resto (profilo del portale, secondo
    fattore, sessione) prosegue in _dopo_la_password, FUORI dalla transazione che teneva bloccata la riga dell'utente:
    il controllo del portale può dover cambiare l'admin dell'account su un'altra connessione (ADR-58)."""

    def __init__(self, user: dict):
        self.user = user


def _dopo_la_password(svc: Services, request: Request, response: Response, user: dict):
    """Password giusta: profilo del portale (scelta 3b dell'11/11/2026, la password di SkyTower resta ma il portale
    decide se la persona può ancora entrare), poi secondo fattore o sessione come prima."""
    from . import portale  # import qui: portale importa auth
    ip = client_ip(request)
    rifiuto = portale.controlla_ingresso(svc, request, user["id"], via="password")
    if rifiuto is not None:
        return rifiuto
    with svc.db.auth_tx() as conn:
        if _has_verified_factor(conn, user["id"]):
            security_event(conn, "LOGIN_PASSWORD_OK", user_id=user["id"], ip=ip, next="mfa")
            methods = [r["method"] for r in conn.execute(
                "SELECT DISTINCT method::text FROM cde.user_mfa_factors WHERE user_id = %s AND verified_at IS NOT NULL "
                "ORDER BY 1 DESC", [user["id"]]).fetchall()]
            return {"status": "mfa_required", "methods": [*methods, "RECOVERY_CODE"],
                    "mfa_token": svc.tokens.issue_mfa_pending(user["id"], enroll=False)}
        if user["mfa_required"]:
            security_event(conn, "LOGIN_PASSWORD_OK", user_id=user["id"], ip=ip, next="mfa_enrollment")
            return {"status": "mfa_enrollment_required",
                    "mfa_token": svc.tokens.issue_mfa_pending(user["id"], enroll=True)}

        security_event(conn, "LOGIN_OK", user_id=user["id"], organization_id=user["organization_id"], ip=ip,
                       user_agent=_ua(request), amr="pwd")
        return _start_session(svc, conn, response, user, amr=["pwd"], request=request)


def _login_tx(body: LoginIn, email: str, ip: str | None, request: Request, response: Response, svc: Services):
    with svc.db.auth_tx() as conn:
        user = conn.execute(
            """SELECT u.id, u.organization_id, u.email, u.password_hash, u.status, u.failed_login_count,
                      u.locked_until, o.mfa_required, o.status AS org_status
               FROM cde.users u JOIN cde.organizations o ON o.id = u.organization_id
               WHERE u.email = %s FOR UPDATE OF u""",
            [email],
        ).fetchone()

        if user is None or user["password_hash"] is None:
            try:
                ph.verify(_DUMMY_HASH, body.password)   # tempo costante: non rivela se l'email esiste
            except VerificationError:
                pass
            # nessuna password di SkyTower (utente creato dal portale, o non ancora qui): vale quella del portale
            dal_portale = _password_del_portale(email, body.password, ip)
            if dal_portale is not None:
                return dal_portale
            security_event(conn, "LOGIN_FAIL", ip=ip, user_agent=_ua(request), email=email, reason="unknown_user")
            return unauthorized(GENERIC_LOGIN_ERROR)

        if user["locked_until"] and user["locked_until"] > _now():
            security_event(conn, "LOGIN_LOCKED", user_id=user["id"], organization_id=user["organization_id"],
                           ip=ip, user_agent=_ua(request))
            return unauthorized(GENERIC_LOGIN_ERROR)

        try:
            ph.verify(user["password_hash"], body.password)
        except (VerificationError, InvalidHashError):
            # non è la password di SkyTower: può essere quella del portale (il blocco qui sopra vale comunque)
            dal_portale = _password_del_portale(email, body.password, ip)
            if dal_portale is not None:
                return dal_portale
            fails = user["failed_login_count"] + 1
            locked_until = None
            if fails >= svc.settings.lockout_threshold:
                minutes = min(2 ** (fails - svc.settings.lockout_threshold), svc.settings.lockout_max_minutes)
                locked_until = _now() + timedelta(minutes=minutes)
            conn.execute("UPDATE cde.users SET failed_login_count = %s, locked_until = %s WHERE id = %s",
                         [fails, locked_until, user["id"]])
            security_event(conn, "LOGIN_FAIL", user_id=user["id"], organization_id=user["organization_id"],
                           ip=ip, user_agent=_ua(request), failed_count=fails, locked=locked_until is not None)
            return unauthorized(GENERIC_LOGIN_ERROR)   # il contatore va persistito: COMMIT e poi errore

        if user["status"] != "ACTIVE" or user["org_status"] != "ACTIVE":
            security_event(conn, "LOGIN_FAIL", user_id=user["id"], ip=ip, reason=f"status_{user['status']}")
            return unauthorized(GENERIC_LOGIN_ERROR)

        # organizzazione con single sign-on obbligatorio: la password non basta (il platform admin resta fuori)
        if _sso_enforced(conn, user["id"]):
            security_event(conn, "LOGIN_FAIL", user_id=user["id"], ip=ip, reason="sso_required")
            return ApiError(403, "sso_required", "La tua organizzazione usa il single sign-on: accedi con l'account aziendale")

        updates = {"failed_login_count": 0, "locked_until": None, "last_login_at": _now()}
        if ph.check_needs_rehash(user["password_hash"]):
            updates["password_hash"] = ph.hash(body.password)
        conn.execute(
            "UPDATE cde.users SET " + ", ".join(f"{k} = %s" for k in updates) + " WHERE id = %s",
            [*updates.values(), user["id"]],
        )
        # secondo fattore e sessione in _dopo_la_password, dopo il profilo del portale (ADR-58)
        return _PasswordGiusta(user)


# ---------------------------------------------------------------------
# MFA
# ---------------------------------------------------------------------
def _verify_totp(svc: Services, conn: psycopg.Connection, user_id: uuid.UUID, code: str) -> bool:
    factors = conn.execute(
        """SELECT id, totp_secret_encrypted, last_used_step FROM cde.user_mfa_factors
           WHERE user_id = %s AND method = 'TOTP' AND verified_at IS NOT NULL FOR UPDATE""",
        [user_id],
    ).fetchall()
    now = time.time()
    for f in factors:
        totp = pyotp.TOTP(svc.kms.decrypt(f["totp_secret_encrypted"]).decode())
        for offset in (-1, 0, 1):
            t = now + offset * totp.interval
            if secrets.compare_digest(totp.at(t), code):
                step = totp.timecode(datetime.fromtimestamp(t, UTC))
                if f["last_used_step"] is not None and step <= f["last_used_step"]:
                    return False                              # replay dello stesso codice
                conn.execute("UPDATE cde.user_mfa_factors SET last_used_step = %s, last_used_at = now() WHERE id = %s",
                             [step, f["id"]])
                return True
    return False


def _verify_recovery(conn: psycopg.Connection, user_id: uuid.UUID, code: str) -> bool:
    normalized = code.strip().lower().replace(" ", "")
    for row in conn.execute(
        "SELECT id, code_hash FROM cde.user_recovery_codes WHERE user_id = %s AND used_at IS NULL FOR UPDATE",
        [user_id],
    ).fetchall():
        try:
            ph.verify(row["code_hash"], normalized)
        except VerificationError:
            continue
        conn.execute("UPDATE cde.user_recovery_codes SET used_at = now() WHERE id = %s", [row["id"]])
        return True
    return False


@router.post("/mfa/verify")
def mfa_verify(body: MfaVerifyIn, request: Request, response: Response, svc: Services = Depends(services)):
    user_id, enroll = _pending_user(svc, body.mfa_token)
    if enroll:
        raise ApiError(400, "mfa_enrollment_required", "Configurare prima un fattore MFA")
    if not svc.limiter.hit("10/minute", "mfa", str(user_id)):
        raise ApiError(429, "rate_limited", "Troppi tentativi MFA", {"Retry-After": "60"})
    return _raise_if_error(_mfa_verify_tx(body, user_id, request, response, svc))


def _mfa_verify_tx(body: MfaVerifyIn, user_id: uuid.UUID, request: Request, response: Response, svc: Services):
    with svc.db.auth_tx() as conn:
        user = _load_user(conn, user_id)
        if user is None or user["status"] != "ACTIVE":
            raise unauthorized()
        if body.code:
            ok, method = _verify_totp(svc, conn, user_id, body.code), "otp"
        elif body.recovery_code:
            ok, method = _verify_recovery(conn, user_id, body.recovery_code), "recovery"
        else:
            raise ApiError(422, "invalid", "Indicare un codice TOTP o un recovery code")
        if not ok:
            security_event(conn, "MFA_FAIL", user_id=user_id, ip=client_ip(request), method=method)
            return unauthorized("Codice non valido")
        security_event(conn, "LOGIN_OK", user_id=user_id, organization_id=user["organization_id"],
                       ip=client_ip(request), user_agent=_ua(request), amr=f"pwd,{method}")
        return _start_session(svc, conn, response, user, amr=["pwd", "otp"], request=request)


@router.post("/mfa/totp/enroll")
def totp_enroll(body: TotpEnrollIn, request: Request, svc: Services = Depends(services)):
    if body.mfa_token:
        user_id, enroll = _pending_user(svc, body.mfa_token)
        if not enroll:
            raise ApiError(400, "invalid", "Token MFA non valido per l'enrollment")
    else:
        user_id = _access_user(svc, request)
    secret = pyotp.random_base32()
    with svc.db.auth_tx() as conn:
        user = _load_user(conn, user_id)
        if user is None or user["status"] != "ACTIVE":
            raise unauthorized()
        # gli enrollment mai completati non si accumulano
        conn.execute("DELETE FROM cde.user_mfa_factors WHERE user_id = %s AND verified_at IS NULL", [user_id])
        factor_id = conn.execute(
            """INSERT INTO cde.user_mfa_factors (user_id, method, label, totp_secret_encrypted)
               VALUES (%s, 'TOTP', %s, %s) RETURNING id""",
            [user_id, body.label, svc.kms.encrypt(secret.encode())],
        ).fetchone()["id"]
    uri = pyotp.TOTP(secret).provisioning_uri(name=user["email"], issuer_name=svc.settings.totp_issuer)
    return {"factor_id": factor_id, "secret": secret, "otpauth_uri": uri, "qr_svg": _qr_svg_data_uri(uri)}


def _new_recovery_codes(conn: psycopg.Connection, user_id: uuid.UUID, count: int) -> list[str]:
    conn.execute("DELETE FROM cde.user_recovery_codes WHERE user_id = %s", [user_id])
    codes = [f"{secrets.token_hex(4)}-{secrets.token_hex(4)}" for _ in range(count)]
    with conn.cursor() as cur:
        cur.executemany("INSERT INTO cde.user_recovery_codes (user_id, code_hash) VALUES (%s, %s)",
                        [(user_id, ph.hash(c)) for c in codes])
    return codes


@router.post("/mfa/totp/confirm")
def totp_confirm(body: TotpConfirmIn, request: Request, response: Response, svc: Services = Depends(services)):
    via_login = body.mfa_token is not None
    user_id = _pending_user(svc, body.mfa_token)[0] if via_login else _access_user(svc, request)
    with svc.db.auth_tx() as conn:
        factor = conn.execute(
            """SELECT id, totp_secret_encrypted FROM cde.user_mfa_factors
               WHERE id = %s AND user_id = %s AND method = 'TOTP' AND verified_at IS NULL FOR UPDATE""",
            [body.factor_id, user_id],
        ).fetchone()
        if factor is None:
            raise ApiError(404, "not_found", "Enrollment non trovato")
        totp = pyotp.TOTP(svc.kms.decrypt(factor["totp_secret_encrypted"]).decode())
        if not totp.verify(body.code, valid_window=1):
            raise ApiError(422, "invalid_code", "Codice non valido: verificare l'ora del dispositivo")
        conn.execute("UPDATE cde.user_mfa_factors SET verified_at = now(), last_used_step = %s WHERE id = %s",
                     [totp.timecode(datetime.now(UTC)), factor["id"]])
        codes = _new_recovery_codes(conn, user_id, svc.settings.recovery_codes_count)
        user = _load_user(conn, user_id)
        security_event(conn, "MFA_ENROLLED", user_id=user_id, organization_id=user["organization_id"],
                       ip=client_ip(request), method="TOTP")
        alerts.send(svc, conn, user_id, "mfa_added", ip=client_ip(request), detail="app di autenticazione")
        result = {"recovery_codes": codes}
        if via_login:
            result |= _start_session(svc, conn, response, user, amr=["pwd", "otp"], request=request)
        return result


@router.get("/mfa/factors")
def list_factors(request: Request, svc: Services = Depends(services)):
    user_id = _access_user(svc, request)
    with svc.db.auth_tx() as conn:
        factors = conn.execute(
            """SELECT id, method, label, webauthn_discoverable AS discoverable, verified_at, last_used_at, created_at
               FROM cde.user_mfa_factors
               WHERE user_id = %s AND verified_at IS NOT NULL ORDER BY created_at""", [user_id]).fetchall()
        remaining = conn.execute(
            "SELECT count(*) n FROM cde.user_recovery_codes WHERE user_id = %s AND used_at IS NULL",
            [user_id]).fetchone()["n"]
    return {"factors": factors, "recovery_codes_remaining": remaining}


@router.delete("/mfa/factors/{factor_id}", status_code=204)
def delete_factor(factor_id: uuid.UUID, request: Request, svc: Services = Depends(services)):
    user_id = _access_user(svc, request, require_mfa=True)
    with svc.db.auth_tx() as conn:
        user = _load_user(conn, user_id)
        n = conn.execute("SELECT count(*) n FROM cde.user_mfa_factors WHERE user_id = %s AND verified_at IS NOT NULL",
                         [user_id]).fetchone()["n"]
        if user["mfa_required"] and n <= 1:
            raise ApiError(409, "mfa_required", "La tua organizzazione richiede almeno un fattore MFA")
        removed = conn.execute("DELETE FROM cde.user_mfa_factors WHERE id = %s AND user_id = %s RETURNING label, method",
                               [factor_id, user_id]).fetchone()
        if removed is None:
            raise ApiError(404, "not_found", "Fattore non trovato")
        security_event(conn, "MFA_REMOVED", user_id=user_id, ip=client_ip(request), factor_id=factor_id)
        alerts.send(svc, conn, user_id, "mfa_removed", ip=client_ip(request), detail=removed["label"])
    return Response(status_code=204)


@router.post("/mfa/recovery-codes")
def regenerate_recovery_codes(request: Request, svc: Services = Depends(services)):
    user_id = _access_user(svc, request, require_mfa=True)
    with svc.db.auth_tx() as conn:
        codes = _new_recovery_codes(conn, user_id, svc.settings.recovery_codes_count)
        security_event(conn, "RECOVERY_CODES_REGENERATED", user_id=user_id, ip=client_ip(request))
    return {"recovery_codes": codes}


# ---------------------------------------------------------------------
# Refresh e logout
# ---------------------------------------------------------------------
@router.post("/refresh")
def refresh(request: Request, response: Response, svc: Services = Depends(services)):
    token = request.cookies.get(svc.settings.refresh_cookie_name)
    if not token:
        raise unauthorized("Sessione assente")
    outcome = _refresh_tx(token, request, response, svc)
    if isinstance(outcome, ApiError):
        failed = JSONResponse({"error": {"code": outcome.code, "message": outcome.message}},
                              status_code=outcome.status, headers=outcome.headers)
        _clear_refresh_cookie(svc, failed)
        return failed
    return outcome


def _refresh_tx(token: str, request: Request, response: Response, svc: Services):
    with svc.db.auth_tx() as conn:
        rt = conn.execute("SELECT * FROM cde.refresh_tokens WHERE token_hash = %s FOR UPDATE",
                          [hash_token(token)]).fetchone()
        if rt is None:
            return unauthorized("Sessione non valida")
        if rt["revoked_at"] is not None:
            if rt["replaced_by"] is not None:
                # token già ruotato riutilizzato ⇒ possibile furto: revoca l'intera famiglia
                conn.execute("UPDATE cde.refresh_tokens SET revoked_at = now() WHERE family_id = %s AND revoked_at IS NULL",
                             [rt["family_id"]])
                security_event(conn, "TOKEN_REUSE", user_id=rt["user_id"], ip=client_ip(request),
                               user_agent=_ua(request), family_id=rt["family_id"])
            return unauthorized("Sessione revocata")
        if rt["expires_at"] <= _now():
            return unauthorized("Sessione scaduta")
        user = _load_user(conn, rt["user_id"])
        if user is None or user["status"] != "ACTIVE" or user["org_status"] != "ACTIVE":
            conn.execute("UPDATE cde.refresh_tokens SET revoked_at = now() WHERE family_id = %s AND revoked_at IS NULL",
                         [rt["family_id"]])
            return unauthorized("Utente non attivo")

        amr = ["pwd", "otp"] if rt["mfa_verified"] else ["pwd"]
        # tetto assoluto (ADR-58): il token nuovo scade quando scadeva quello di prima, cioè alla data del login
        result = _start_session(svc, conn, response, user, amr=amr, request=request, family_id=rt["family_id"],
                                expires_at=rt["expires_at"])
        new_id = conn.execute("SELECT id FROM cde.refresh_tokens WHERE family_id = %s ORDER BY issued_at DESC LIMIT 1",
                              [rt["family_id"]]).fetchone()["id"]
        conn.execute("UPDATE cde.refresh_tokens SET revoked_at = now(), replaced_by = %s WHERE id = %s",
                     [new_id, rt["id"]])
        return result


@router.post("/logout", status_code=204)
def logout(request: Request, svc: Services = Depends(services)):
    token = request.cookies.get(svc.settings.refresh_cookie_name)
    response = Response(status_code=204)
    if token:
        with svc.db.auth_tx() as conn:
            rt = conn.execute("SELECT user_id, family_id FROM cde.refresh_tokens WHERE token_hash = %s",
                              [hash_token(token)]).fetchone()
            if rt:
                conn.execute("UPDATE cde.refresh_tokens SET revoked_at = now() WHERE family_id = %s AND revoked_at IS NULL",
                             [rt["family_id"]])
                security_event(conn, "LOGOUT", user_id=rt["user_id"], ip=client_ip(request))
    _clear_refresh_cookie(svc, response)
    return response


# ---------------------------------------------------------------------
# Inviti e reset password
# ---------------------------------------------------------------------
def _consume_user_token(conn: psycopg.Connection, token: str, purpose: str) -> dict:
    row = conn.execute(
        """SELECT t.id, t.user_id, u.email, u.status FROM cde.user_tokens t JOIN cde.users u ON u.id = t.user_id
           WHERE t.token_hash = %s AND t.purpose = %s AND t.used_at IS NULL AND t.expires_at > now()
           FOR UPDATE OF t""",
        [hash_token(token), purpose],
    ).fetchone()
    if row is None:
        raise ApiError(400, "invalid_token", "Link non valido o scaduto")
    conn.execute("UPDATE cde.user_tokens SET used_at = now() WHERE id = %s", [row["id"]])
    return row


@router.post("/invitations/{token}/accept")
def accept_invitation(token: str, body: AcceptInvitationIn, request: Request, svc: Services = Depends(services)):
    with svc.db.auth_tx() as conn:
        row = _consume_user_token(conn, token, "INVITATION")
        if row["status"] != "INVITED":
            raise ApiError(400, "invalid_token", "Invito già utilizzato")
        validate_password(body.password, row["email"], svc.settings.password_min_length)
        conn.execute(
            "UPDATE cde.users SET password_hash = %s, password_changed_at = now(), status = 'ACTIVE' WHERE id = %s",
            [ph.hash(body.password), row["user_id"]],
        )
        security_event(conn, "INVITATION_ACCEPTED", user_id=row["user_id"], ip=client_ip(request))
    return {"status": "ok", "email": row["email"]}


@router.post("/password/forgot", status_code=202)
def forgot_password(body: ForgotPasswordIn, request: Request, svc: Services = Depends(services)):
    email = body.email.lower()
    if not svc.limiter.hit("3/hour", "forgot", email):
        return {"status": "accepted"}
    with svc.db.auth_tx() as conn:
        user = conn.execute("SELECT id FROM cde.users WHERE email = %s AND status = 'ACTIVE'", [email]).fetchone()
    if user:
        # persona disattivata nel portale o senza SkyTower fra i programmi: niente link (ADR-58). Stessa risposta
        # di sempre: il rifiuto resta nel registro di sicurezza (LOGIN_PORTALE_RIFIUTATO, via=reset)
        from . import portale
        if portale.controlla_ingresso(svc, request, user["id"], via="reset", allinea=False) is not None:
            return {"status": "accepted"}
    with svc.db.auth_tx() as conn:
        if user:
            token, token_hash = new_opaque_token()
            conn.execute(
                "INSERT INTO cde.user_tokens (user_id, purpose, token_hash, expires_at) VALUES (%s, 'PASSWORD_RESET', %s, %s)",
                [user["id"], token_hash, _now() + timedelta(minutes=svc.settings.password_reset_ttl_minutes)],
            )
            security_event(conn, "PASSWORD_RESET_REQUESTED", user_id=user["id"], ip=client_ip(request))
            svc.mailer.send(email, "Reimpostazione password CDE",
                            f"Per reimpostare la password apri: {svc.settings.web_base_url}/reset-password?token={token}\n"
                            f"Il link scade tra {svc.settings.password_reset_ttl_minutes} minuti.")
    return {"status": "accepted"}   # stessa risposta che l'email esista o no


@router.post("/password/reset")
def reset_password(body: ResetPasswordIn, request: Request, svc: Services = Depends(services)):
    # il link può essere partito prima che il portale disattivasse la persona: si richiede il profilo adesso (ADR-58)
    with svc.db.auth_tx() as conn:
        chi = conn.execute("""SELECT user_id FROM cde.user_tokens WHERE token_hash = %s AND purpose = 'PASSWORD_RESET'
                              AND used_at IS NULL AND expires_at > now()""", [hash_token(body.token)]).fetchone()
    if chi is not None:
        from . import portale
        rifiuto = portale.controlla_ingresso(svc, request, chi["user_id"], via="reset", allinea=False)
        if rifiuto is not None:
            raise rifiuto
    with svc.db.auth_tx() as conn:
        row = _consume_user_token(conn, body.token, "PASSWORD_RESET")
        validate_password(body.password, row["email"], svc.settings.password_min_length)
        conn.execute(
            """UPDATE cde.users SET password_hash = %s, password_changed_at = now(), failed_login_count = 0,
                      locked_until = NULL WHERE id = %s""",
            [ph.hash(body.password), row["user_id"]],
        )
        conn.execute("UPDATE cde.refresh_tokens SET revoked_at = now() WHERE user_id = %s AND revoked_at IS NULL",
                     [row["user_id"]])
        security_event(conn, "PASSWORD_RESET", user_id=row["user_id"], ip=client_ip(request))
        alerts.send(svc, conn, row["user_id"], "password_reset", ip=client_ip(request))
    return {"status": "ok"}
