# "><(((º> sabusabu <º)))><"
"""Autenticazione: login, lockout, rate limit, MFA TOTP, recovery code, refresh con rotazione (T9)."""
from __future__ import annotations

import re
import time

import jwt
import psycopg
import pyotp
import pytest

from cde_api.tooling.demo_seed import DEMO_PASSWORD


def login(client, email, password=DEMO_PASSWORD):
    return client.post("/auth/login", json={"email": email, "password": password})


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def owner(api_world):
    urls, _ = api_world
    with psycopg.connect(urls.owner, autocommit=True) as conn:
        yield conn


def test_login_senza_mfa_rilascia_token_e_cookie(client, api_world):
    _, w = api_world
    r = login(client, w.emails["des_lead"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "ok" and body["token_type"] == "Bearer" and body["expires_in"] == 900  # noqa: S105
    cookie = r.headers["set-cookie"]
    assert "HttpOnly" in cookie and "Secure" in cookie and "SameSite=strict" in cookie and "Path=/auth" in cookie
    me = client.get("/me", headers=bearer(body["access_token"]))
    assert me.status_code == 200 and me.json()["email"] == w.emails["des_lead"]


def test_access_token_firmato_rs256_verificabile_con_jwks(client, api_world):
    _, w = api_world
    token = login(client, w.emails["des_lead"]).json()["access_token"]
    jwks = client.get("/.well-known/jwks.json").json()
    key = jwt.PyJWK(jwks["keys"][0])
    claims = jwt.decode(token, key.key, algorithms=["RS256"], audience="cde-api")
    assert claims["sub"] == str(w.users["des_lead"]) and claims["org"] == str(w.orgs["DES"])
    assert claims["exp"] - claims["iat"] == 900 and claims["amr"] == ["pwd"] and claims["mfa"] is False


def test_errore_generico_per_password_errata_ed_email_inesistente(client, api_world):
    _, w = api_world
    a = login(client, w.emails["des_viewer"], "sbagliata-123456")
    b = login(client, "nessuno@nowhere.example", "sbagliata-123456")
    assert a.status_code == b.status_code == 401
    assert a.json() == b.json()


def test_token_assente_manomesso_o_di_tipo_errato(client, api_world):
    _, w = api_world
    assert client.get("/me").status_code == 401
    token = login(client, w.emails["des_lead"]).json()["access_token"]
    head, payload, sig = token.split(".")
    assert client.get("/me", headers=bearer(f"{head}.{payload}.{sig[:-4]}AAAA")).status_code == 401
    forged = jwt.encode({"sub": str(w.users["com_admin"]), "typ": "access"}, "segreto", algorithm="HS256")
    assert client.get("/me", headers=bearer(forged)).status_code == 401


def test_lockout_progressivo(client, api_world, owner):
    _, w = api_world
    email = w.emails["sub2_user"]
    try:
        for _ in range(5):
            client.app.state.services.limiter.reset()
            assert login(client, email, "sbagliata-123456").status_code == 401
        client.app.state.services.limiter.reset()
        assert login(client, email).status_code == 401    # password giusta ma account bloccato
        row = owner.execute("SELECT failed_login_count, locked_until FROM cde.users WHERE email = %s",
                            [email]).fetchone()
        assert row[0] == 5 and row[1] is not None
        events = owner.execute("SELECT count(*) FROM cde.security_events WHERE event_type = 'LOGIN_LOCKED' "
                               "AND user_id = %s", [w.users["sub2_user"]]).fetchone()[0]
        assert events >= 1
    finally:
        owner.execute("UPDATE cde.users SET failed_login_count = 0, locked_until = NULL WHERE email = %s", [email])


def test_rate_limit_login(client, api_world):
    _, w = api_world
    # email inesistente: il rate limit scatta comunque e non si altera il lockout di utenti reali
    codes = [login(client, "rate.limit@nowhere.example", "sbagliata-123456").status_code for _ in range(6)]
    assert codes[:5] == [401] * 5 and codes[5] == 429


def test_header_di_sicurezza(client):
    r = client.get("/health")
    assert r.status_code == 200
    for h in ("strict-transport-security", "x-content-type-options", "x-frame-options", "content-security-policy"):
        assert h in r.headers


# ---------------------------------------------------------------------
# MFA
# ---------------------------------------------------------------------
def _enroll(client, mfa_token):
    r = client.post("/auth/mfa/totp/enroll", json={"mfa_token": mfa_token})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["otpauth_uri"].startswith("otpauth://totp/") and data["qr_svg"].startswith("data:image/svg+xml")
    return data


def test_mfa_obbligatoria_enrollment_verifica_recovery(client, api_world, owner):
    _, w = api_world
    email = w.emails["gc_admin"]
    owner.execute("UPDATE cde.organizations SET mfa_required = true WHERE id = %s", [w.orgs["GCO"]])
    try:
        r = login(client, email).json()
        assert r["status"] == "mfa_enrollment_required"
        # il token parziale non vale come access token
        assert client.get("/me", headers=bearer(r["mfa_token"])).status_code == 401

        data = _enroll(client, r["mfa_token"])
        totp = pyotp.TOTP(data["secret"])
        confirmed = client.post("/auth/mfa/totp/confirm",
                                json={"factor_id": data["factor_id"], "code": totp.now(), "mfa_token": r["mfa_token"]})
        assert confirmed.status_code == 200, confirmed.text
        body = confirmed.json()
        assert len(body["recovery_codes"]) == 10 and body["access_token"]
        claims = jwt.decode(body["access_token"], options={"verify_signature": False})
        assert claims["mfa"] is True and claims["amr"] == ["pwd", "otp"]

        # login successivo: serve il secondo fattore
        r2 = login(client, email).json()
        assert r2["status"] == "mfa_required"
        # stesso codice già usato in conferma ⇒ replay rifiutato
        assert client.post("/auth/mfa/verify", json={"mfa_token": r2["mfa_token"], "code": totp.now()}).status_code == 401
        assert client.post("/auth/mfa/verify", json={"mfa_token": r2["mfa_token"], "code": "000000"}).status_code == 401

        # recovery code monouso
        rc = body["recovery_codes"][0]
        ok = client.post("/auth/mfa/verify", json={"mfa_token": r2["mfa_token"], "recovery_code": rc})
        assert ok.status_code == 200, ok.text
        r3 = login(client, email).json()
        assert client.post("/auth/mfa/verify", json={"mfa_token": r3["mfa_token"], "recovery_code": rc}).status_code == 401

        # codice TOTP del passo successivo accettato
        nxt = totp.at(time.time() + 30)
        assert client.post("/auth/mfa/verify", json={"mfa_token": r3["mfa_token"], "code": nxt}).status_code == 200

        # segreto TOTP cifrato a riposo
        blob = owner.execute("SELECT totp_secret_encrypted FROM cde.user_mfa_factors WHERE user_id = %s",
                             [w.users["gc_admin"]]).fetchone()[0]
        assert data["secret"].encode() not in bytes(blob)
    finally:
        owner.execute("UPDATE cde.organizations SET mfa_required = false WHERE id = %s", [w.orgs["GCO"]])
        owner.execute("DELETE FROM cde.user_mfa_factors WHERE user_id = %s", [w.users["gc_admin"]])


def test_ultimo_fattore_non_rimovibile_se_mfa_obbligatoria(client, api_world, owner):
    _, w = api_world
    email = w.emails["des_admin"]
    owner.execute("UPDATE cde.organizations SET mfa_required = true WHERE id = %s", [w.orgs["DES"]])
    try:
        r = login(client, email).json()
        data = _enroll(client, r["mfa_token"])
        body = client.post("/auth/mfa/totp/confirm", json={"factor_id": data["factor_id"],
                                                           "code": pyotp.TOTP(data["secret"]).now(),
                                                           "mfa_token": r["mfa_token"]}).json()
        h = bearer(body["access_token"])
        factors = client.get("/auth/mfa/factors", headers=h).json()
        assert factors["recovery_codes_remaining"] == 10 and len(factors["factors"]) == 1
        assert client.delete(f"/auth/mfa/factors/{data['factor_id']}", headers=h).status_code == 409
    finally:
        owner.execute("UPDATE cde.organizations SET mfa_required = false WHERE id = %s", [w.orgs["DES"]])
        owner.execute("DELETE FROM cde.user_mfa_factors WHERE user_id = %s", [w.users["des_admin"]])


# ---------------------------------------------------------------------
# Refresh token (T9)
# ---------------------------------------------------------------------
def test_T9_refresh_ruota_e_riuso_revoca_la_famiglia(client, api_world, owner):
    _, w = api_world
    login(client, w.emails["des_designer"])
    old = client.cookies.get("cde_rt")
    r = client.post("/auth/refresh")
    assert r.status_code == 200, r.text
    new = client.cookies.get("cde_rt")
    assert new and new != old

    # riuso del token vecchio (es. rubato)
    client.cookies.clear()
    client.cookies.set("cde_rt", old, path="/auth")
    assert client.post("/auth/refresh").status_code == 401
    # anche il token legittimo più recente è ora revocato
    client.cookies.clear()
    client.cookies.set("cde_rt", new, path="/auth")
    assert client.post("/auth/refresh").status_code == 401
    n = owner.execute("SELECT count(*) FROM cde.security_events WHERE event_type = 'TOKEN_REUSE' AND user_id = %s",
                      [w.users["des_designer"]]).fetchone()[0]
    assert n >= 1


def test_logout_revoca_sessione(client, api_world):
    _, w = api_world
    login(client, w.emails["sub1_viewer"])
    token = client.cookies.get("cde_rt")
    assert client.post("/auth/logout").status_code == 204
    client.cookies.set("cde_rt", token, path="/auth")
    assert client.post("/auth/refresh").status_code == 401


# ---------------------------------------------------------------------
# Inviti e reset password
# ---------------------------------------------------------------------
def _token_from_outbox(client, path):
    mail = client.app.state.services.mailer.outbox[-1]
    return mail, re.search(rf"{path}\?token=([\w-]+)", mail.body).group(1)


def test_invito_utente_e_attivazione(client, api_world):
    _, w = api_world
    admin = login(client, w.emails["sub1_admin"]).json()["access_token"]
    r = client.post(f"/organizations/{w.orgs['SUB1']}/users", headers=bearer(admin),
                    json={"email": "Nuovo.Elettricista@sub1.example", "first_name": "Nuovo", "last_name": "Tecnico"})
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "INVITED" and r.json()["email"] == "nuovo.elettricista@sub1.example"
    mail, token = _token_from_outbox(client, "/invito")
    assert mail.to == "nuovo.elettricista@sub1.example"

    assert client.post(f"/auth/invitations/{token}/accept", json={"password": "corta"}).status_code == 422
    # il token resta valido dopo un rifiuto per password debole? No: la transazione è annullata
    ok = client.post(f"/auth/invitations/{token}/accept", json={"password": "Quadro-Elettrico-2026"})
    assert ok.status_code == 200, ok.text
    assert client.post(f"/auth/invitations/{token}/accept", json={"password": "Quadro-Elettrico-2026"}).status_code == 400
    assert login(client, "nuovo.elettricista@sub1.example", "Quadro-Elettrico-2026").json()["status"] == "ok"


def test_admin_non_invita_in_altre_organizzazioni(client, api_world):
    _, w = api_world
    admin = login(client, w.emails["sub1_admin"]).json()["access_token"]
    r = client.post(f"/organizations/{w.orgs['DES']}/users", headers=bearer(admin),
                    json={"email": "intruso@des.example", "first_name": "I", "last_name": "N"})
    assert r.status_code == 403


def test_reset_password(client, api_world, owner):
    _, w = api_world
    email = w.emails["sub2_user"]
    assert client.post("/auth/password/forgot", json={"email": email}).status_code == 202
    assert client.post("/auth/password/forgot", json={"email": "ignoto@x.example"}).status_code == 202
    _, token = _token_from_outbox(client, "/reset-password")
    try:
        assert client.post("/auth/password/reset", json={"token": token, "password": "Nuova-Password-2026"}).status_code == 200
        assert login(client, email, "Nuova-Password-2026").json()["status"] == "ok"
        assert client.post("/auth/password/reset", json={"token": token, "password": "Altra-Password-2026"}).status_code == 400
    finally:
        from argon2 import PasswordHasher
        owner.execute("UPDATE cde.users SET password_hash = %s WHERE email = %s", [PasswordHasher().hash(DEMO_PASSWORD), email])
