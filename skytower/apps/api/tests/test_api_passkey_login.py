# "><(((º> sabusabu <º)))><"
"""Accesso senza password con passkey residenti (ADR-27): l'account lo indica l'autenticatore (userHandle),
la verifica dell'utente è obbligatoria e la sessione vale come "con MFA"."""
from __future__ import annotations

import hashlib
import struct

import jwt
import psycopg
import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from test_api_auth import bearer, login
from test_api_passkeys import ORIGIN, SoftKey, _register, b64u, unb64u


class Passkey(SoftKey):
    """Passkey residente: risponde senza allowCredentials e restituisce l'id utente (userHandle)."""

    def __init__(self):
        super().__init__()
        self.user_handle = b""

    def create(self, options: dict, origin: str = ORIGIN) -> dict:
        self.user_handle = unb64u(options["user"]["id"])
        cred = super().create(options, origin)
        cred["clientExtensionResults"] = {"credProps": {"rk": True}}
        return cred

    def discover(self, options: dict, *, uv: bool = True, handle: bytes | None = None) -> dict:
        assert not options.get("allowCredentials")
        self.counter += 1
        flags = 0x05 if uv else 0x01
        auth_data = hashlib.sha256(options["rpId"].encode()).digest() + bytes([flags]) + struct.pack(">I", self.counter)
        client_data = self._client_data("webauthn.get", options["challenge"], ORIGIN)
        sig = self.key.sign(auth_data + hashlib.sha256(client_data).digest(), ec.ECDSA(hashes.SHA256()))
        return {"id": b64u(self.cred_id), "rawId": b64u(self.cred_id), "type": "public-key",
                "response": {"clientDataJSON": b64u(client_data), "authenticatorData": b64u(auth_data),
                             "signature": b64u(sig), "userHandle": b64u(self.user_handle if handle is None else handle)}}


@pytest.fixture
def owner(api_world):
    urls, _ = api_world
    with psycopg.connect(urls.owner, autocommit=True) as conn:
        yield conn


@pytest.fixture
def gc_admin(api_world, owner):
    _, w = api_world
    yield w.emails["gc_admin"], w.users["gc_admin"]
    owner.execute("DELETE FROM cde.organization_sso WHERE organization_id = %s", [w.orgs["GCO"]])
    owner.execute("DELETE FROM cde.user_mfa_factors WHERE user_id = %s", [w.users["gc_admin"]])
    owner.execute("DELETE FROM cde.user_recovery_codes WHERE user_id = %s", [w.users["gc_admin"]])


def _passkey_login(client, key: Passkey, **kw):
    o = client.post("/auth/passkey/options")
    assert o.status_code == 200, o.text
    o = o.json()
    assert o["options"]["userVerification"] == "required"
    return o, client.post("/auth/passkey/verify", json={"challenge_id": o["challenge_id"],
                                                         "credential": key.discover(o["options"], **kw)})


def _enrolled(client, email) -> Passkey:
    h = bearer(login(client, email).json()["access_token"])
    key = Passkey()
    opts = client.post("/auth/mfa/webauthn/register/options", headers=h, json={}).json()
    assert opts["options"]["extensions"] == {"credProps": True}
    reg = client.post("/auth/mfa/webauthn/register/verify", headers=h, json={
        "challenge_id": opts["challenge_id"], "credential": key.create(opts["options"]), "label": "Passkey portatile"})
    assert reg.status_code == 200, reg.text
    return key


def test_accesso_senza_password(client, gc_admin, owner):
    email, user_id = gc_admin
    key = _enrolled(client, email)
    assert owner.execute("SELECT webauthn_discoverable FROM cde.user_mfa_factors WHERE user_id = %s",
                         [user_id]).fetchone()[0] is True

    o, ok = _passkey_login(client, key)
    assert ok.status_code == 200, ok.text
    claims = jwt.decode(ok.json()["access_token"], options={"verify_signature": False})
    assert claims["sub"] == str(user_id) and claims["mfa"] is True and claims["amr"] == ["hwk", "mfa"]
    # la sessione resta "con MFA" anche dopo il refresh
    refreshed = client.post("/auth/refresh")
    assert jwt.decode(refreshed.json()["access_token"], options={"verify_signature": False})["mfa"] is True
    factors = client.get("/auth/mfa/factors", headers=bearer(ok.json()["access_token"])).json()["factors"]
    assert [f["discoverable"] for f in factors] == [True]
    assert owner.execute("""SELECT details->>'amr' FROM cde.security_events WHERE user_id = %s
                            AND event_type = 'LOGIN_OK' ORDER BY occurred_at DESC LIMIT 1""",
                         [user_id]).fetchone()[0] == "hwk,mfa"
    # challenge monouso
    replay = client.post("/auth/passkey/verify", json={"challenge_id": o["challenge_id"],
                                                       "credential": key.discover(o["options"])})
    assert replay.status_code == 409


def test_verifica_utente_e_account_dichiarato(client, api_world, gc_admin, owner):
    _, w = api_world
    email, user_id = gc_admin
    key = _enrolled(client, email)
    # senza PIN/biometria la sola presenza non basta
    assert _passkey_login(client, key, uv=False)[1].status_code == 401
    # userHandle di un altro utente: la chiave non può spacciarsi per un altro account
    other = _passkey_login(client, key, handle=bytes.fromhex(str(w.users["des_lead"]).replace("-", "")))[1]
    assert other.status_code == 401
    # chiave sconosciuta
    stranger = Passkey()
    stranger.user_handle = bytes.fromhex(str(user_id).replace("-", ""))
    assert _passkey_login(client, stranger)[1].status_code == 401
    assert owner.execute("""SELECT count(*) FROM cde.security_events WHERE event_type = 'LOGIN_FAIL'
                            AND details->>'method' = 'passkey' AND occurred_at > now() - interval '1 minute'""",
                         ).fetchone()[0] >= 3
    # utente disattivato: la passkey non apre
    owner.execute("UPDATE cde.users SET status = 'DISABLED' WHERE id = %s", [user_id])
    try:
        assert _passkey_login(client, key)[1].status_code == 401
    finally:
        owner.execute("UPDATE cde.users SET status = 'ACTIVE' WHERE id = %s", [user_id])
    assert _passkey_login(client, key)[1].status_code == 200


def test_sso_obbligatorio_esclude_la_passkey(client, api_world, gc_admin, owner):
    _, w = api_world
    email, _ = gc_admin
    key = _enrolled(client, email)
    owner.execute("""INSERT INTO cde.organization_sso (organization_id, issuer, client_id, email_domains, enforce)
                     VALUES (%s, 'https://idp.passkey-test.example', 'cde', '{passkey-test.example}', true)""",
                  [w.orgs["GCO"]])
    r = _passkey_login(client, key)[1]
    assert r.status_code == 403 and r.json()["error"]["code"] == "sso_required"


def test_registrazione_senza_credprops_e_challenge_anonima(client, gc_admin, owner):
    email, user_id = gc_admin
    h = bearer(login(client, email).json()["access_token"])
    # chiave registrata come secondo fattore senza dichiarare se è residente: NULL
    assert _register(client, SoftKey(), headers=h).status_code == 200
    assert owner.execute("SELECT webauthn_discoverable FROM cde.user_mfa_factors WHERE user_id = %s",
                         [user_id]).fetchone()[0] is None
    # una challenge di accesso senza password non vale per un'altra cerimonia e viceversa
    o = client.post("/auth/passkey/options").json()
    assert owner.execute("SELECT user_id, purpose FROM cde.webauthn_challenges WHERE id = %s",
                         [o["challenge_id"]]).fetchone() == (None, "passwordless")
    bad = client.post("/auth/passkey/verify", json={"challenge_id": o["challenge_id"], "credential": {}})
    assert bad.status_code == 401
