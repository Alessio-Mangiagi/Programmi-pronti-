# "><(((º> sabusabu <º)))><"
"""Chiavi di sicurezza e passkey (WebAuthn) come secondo fattore. Il browser è sostituito da un autenticatore
software (ES256, attestazione "none") che firma come una chiave FIDO2 vera."""
from __future__ import annotations

import base64
import hashlib
import json
import os
import struct

import cbor2
import jwt
import psycopg
import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from test_api_auth import bearer, login

ORIGIN = "http://localhost:5195"      # web_base_url di default: RP ID "localhost"
RP_ID = "localhost"


def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def unb64u(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


class SoftKey:
    """Autenticatore FIDO2 minimo: crea la credenziale e firma le asserzioni, con contatore."""

    def __init__(self):
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.cred_id = os.urandom(16)
        self.counter = 0

    def _client_data(self, kind: str, challenge: str, origin: str) -> bytes:
        return json.dumps({"type": kind, "challenge": challenge, "origin": origin, "crossOrigin": False}).encode()

    def create(self, options: dict, origin: str = ORIGIN) -> dict:
        assert options["rp"]["id"] == RP_ID
        nums = self.key.public_key().public_numbers()
        cose = cbor2.dumps({1: 2, 3: -7, -1: 1, -2: nums.x.to_bytes(32, "big"), -3: nums.y.to_bytes(32, "big")})
        self.counter += 1
        auth_data = (hashlib.sha256(options["rp"]["id"].encode()).digest() + bytes([0x45])
                     + struct.pack(">I", self.counter) + bytes(16) + struct.pack(">H", len(self.cred_id))
                     + self.cred_id + cose)
        att = cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": auth_data})
        return {"id": b64u(self.cred_id), "rawId": b64u(self.cred_id), "type": "public-key",
                "response": {"clientDataJSON": b64u(self._client_data("webauthn.create", options["challenge"], origin)),
                             "attestationObject": b64u(att), "transports": ["usb", "nfc", "inventato"]}}

    def get(self, options: dict, origin: str = ORIGIN, *, counter: int | None = None) -> dict:
        assert any(unb64u(c["id"]) == self.cred_id for c in options["allowCredentials"])
        self.counter = self.counter + 1 if counter is None else counter
        auth_data = hashlib.sha256(options["rpId"].encode()).digest() + bytes([0x05]) + struct.pack(">I", self.counter)
        client_data = self._client_data("webauthn.get", options["challenge"], origin)
        sig = self.key.sign(auth_data + hashlib.sha256(client_data).digest(), ec.ECDSA(hashes.SHA256()))
        return {"id": b64u(self.cred_id), "rawId": b64u(self.cred_id), "type": "public-key",
                "response": {"clientDataJSON": b64u(client_data), "authenticatorData": b64u(auth_data),
                             "signature": b64u(sig)}}


@pytest.fixture
def owner(api_world):
    urls, _ = api_world
    with psycopg.connect(urls.owner, autocommit=True) as conn:
        yield conn


@pytest.fixture
def gc_admin(api_world, owner):
    _, w = api_world
    yield w.emails["gc_admin"], w.users["gc_admin"]
    owner.execute("UPDATE cde.organizations SET mfa_required = false WHERE id = %s", [w.orgs["GCO"]])
    owner.execute("DELETE FROM cde.user_mfa_factors WHERE user_id = %s", [w.users["gc_admin"]])
    owner.execute("DELETE FROM cde.user_recovery_codes WHERE user_id = %s", [w.users["gc_admin"]])


def _register(client, key: SoftKey, *, headers=None, mfa_token=None, label="YubiKey 5"):
    opts = client.post("/auth/mfa/webauthn/register/options", headers=headers, json={"mfa_token": mfa_token})
    assert opts.status_code == 200, opts.text
    o = opts.json()
    assert o["options"]["authenticatorSelection"]["userVerification"] == "preferred"
    return client.post("/auth/mfa/webauthn/register/verify", headers=headers, json={
        "challenge_id": o["challenge_id"], "credential": key.create(o["options"]), "label": label,
        "mfa_token": mfa_token})


def _login_with_key(client, email, key: SoftKey, **kw):
    r = login(client, email).json()
    assert r["status"] == "mfa_required" and "WEBAUTHN" in r["methods"]
    o = client.post("/auth/mfa/webauthn/options", json={"mfa_token": r["mfa_token"]}).json()
    return r, o, client.post("/auth/mfa/webauthn/verify", json={
        "mfa_token": r["mfa_token"], "challenge_id": o["challenge_id"], "credential": key.get(o["options"], **kw)})


def test_registrazione_dal_profilo_e_accesso(client, gc_admin, owner):
    email, user_id = gc_admin
    h = bearer(login(client, email).json()["access_token"])
    key = SoftKey()
    reg = _register(client, key, headers=h)
    assert reg.status_code == 200, reg.text
    assert len(reg.json()["recovery_codes"]) == 10          # primo fattore: nascono i recovery code
    factors = client.get("/auth/mfa/factors", headers=h).json()["factors"]
    assert [(f["method"], f["label"]) for f in factors] == [("WEBAUTHN", "YubiKey 5")]
    stored = owner.execute("SELECT webauthn_transports, webauthn_sign_count FROM cde.user_mfa_factors "
                           "WHERE user_id = %s", [user_id]).fetchone()
    assert stored == (["usb", "nfc"], 1)                    # trasporti sconosciuti scartati

    r, _, ok = _login_with_key(client, email, key)
    assert r["methods"] == ["WEBAUTHN", "RECOVERY_CODE"]
    assert ok.status_code == 200, ok.text
    claims = jwt.decode(ok.json()["access_token"], options={"verify_signature": False})
    assert claims["mfa"] is True and claims["amr"] == ["pwd", "hwk"]
    # la sessione resta "con MFA" anche dopo il refresh
    refreshed = client.post("/auth/refresh")
    assert jwt.decode(refreshed.json()["access_token"], options={"verify_signature": False})["mfa"] is True
    assert owner.execute("SELECT webauthn_sign_count FROM cde.user_mfa_factors WHERE user_id = %s",
                         [user_id]).fetchone()[0] == 2

    # una seconda chiave non rigenera i recovery code; la stessa chiave non si registra due volte
    h = bearer(ok.json()["access_token"])
    assert _register(client, SoftKey(), headers=h, label="Passkey telefono").json()["recovery_codes"] is None
    again = _register(client, key, headers=h)
    assert again.status_code == 409 and again.json()["error"]["code"] == "already_registered"
    assert len(client.get("/auth/mfa/factors", headers=h).json()["factors"]) == 2


def test_challenge_monouso_origin_e_clonazione(client, gc_admin):
    email, _ = gc_admin
    h = bearer(login(client, email).json()["access_token"])
    key = SoftKey()
    # origin diverso (sito di phishing): la registrazione fallisce
    o = client.post("/auth/mfa/webauthn/register/options", headers=h, json={}).json()
    bad = client.post("/auth/mfa/webauthn/register/verify", headers=h, json={
        "challenge_id": o["challenge_id"], "credential": key.create(o["options"], "https://cde-login.example")})
    assert bad.status_code == 422
    # la challenge era monouso: anche la risposta giusta ora è rifiutata
    retry = client.post("/auth/mfa/webauthn/register/verify", headers=h, json={
        "challenge_id": o["challenge_id"], "credential": key.create(o["options"])})
    assert retry.status_code == 409 and retry.json()["error"]["code"] == "challenge_expired"
    assert _register(client, key, headers=h).status_code == 200

    r, o, ok = _login_with_key(client, email, key)
    assert ok.status_code == 200
    replay = client.post("/auth/mfa/webauthn/verify", json={
        "mfa_token": r["mfa_token"], "challenge_id": o["challenge_id"], "credential": key.get(o["options"])})
    assert replay.status_code == 409                           # stessa challenge: già usata
    # asserzione vecchia su una challenge nuova: la firma non torna
    stale = key.get(o["options"])
    o2 = client.post("/auth/mfa/webauthn/options", json={"mfa_token": r["mfa_token"]}).json()
    assert client.post("/auth/mfa/webauthn/verify", json={
        "mfa_token": r["mfa_token"], "challenge_id": o2["challenge_id"], "credential": stale}).status_code == 401
    # contatore che torna indietro: chiave clonata
    _, _, cloned = _login_with_key(client, email, key, counter=1)
    assert cloned.status_code == 401
    # una chiave di un altro utente non vale
    other = SoftKey()
    other.cred_id = os.urandom(16)
    r = login(client, email).json()
    o = client.post("/auth/mfa/webauthn/options", json={"mfa_token": r["mfa_token"]}).json()
    forged = key.get(o["options"])
    forged["id"] = forged["rawId"] = b64u(other.cred_id)
    assert client.post("/auth/mfa/webauthn/verify", json={
        "mfa_token": r["mfa_token"], "challenge_id": o["challenge_id"], "credential": forged}).status_code == 401


def test_enrollment_obbligatorio_durante_il_login(client, api_world, gc_admin, owner):
    _, w = api_world
    email, _ = gc_admin
    owner.execute("UPDATE cde.organizations SET mfa_required = true WHERE id = %s", [w.orgs["GCO"]])
    r = login(client, email).json()
    assert r["status"] == "mfa_enrollment_required"
    # con il token di enrollment non si fa l'accesso con la chiave, solo la registrazione
    assert client.post("/auth/mfa/webauthn/options", json={"mfa_token": r["mfa_token"]}).status_code == 400
    key = SoftKey()
    reg = _register(client, key, mfa_token=r["mfa_token"])
    assert reg.status_code == 200, reg.text
    body = reg.json()
    assert body["access_token"] and len(body["recovery_codes"]) == 10
    assert jwt.decode(body["access_token"], options={"verify_signature": False})["amr"] == ["pwd", "hwk"]
    # un token di MFA già verificato non vale per registrare (serve quello di enrollment o l'accesso)
    r2 = login(client, email).json()
    assert client.post("/auth/mfa/webauthn/register/options", json={"mfa_token": r2["mfa_token"]}).status_code == 400
    assert _login_with_key(client, email, key)[2].status_code == 200


def test_senza_chiavi_o_senza_autenticazione(client, gc_admin):
    email, _ = gc_admin
    assert client.post("/auth/mfa/webauthn/register/options", json={}).status_code == 401
    r = login(client, email).json()
    assert r["status"] == "ok"
    assert client.post("/auth/mfa/webauthn/options", json={"mfa_token": "x.y.z"}).status_code == 401
