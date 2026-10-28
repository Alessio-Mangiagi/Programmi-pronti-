# "><(((º> sabusabu <º)))><"
"""Single sign-on OpenID Connect per organizzazione, contro un IdP finto (discovery, JWKS, token endpoint)."""
from __future__ import annotations

import base64
import hashlib
import json
import time
import uuid
from urllib.parse import parse_qs, urlparse

import jwt
import psycopg
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from test_api_auth import bearer, login

from cde_api.security import oidc

ISSUER = "https://idp.gco.example"
CLIENT = "cde-gco"


class FakeIdp:
    def __init__(self):
        self.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(self.key.public_key()))
        self.jwks = {"keys": [{**jwk, "kid": "k1", "use": "sig", "alg": "RS256"}]}
        self.claims: dict = {}
        self.last_token_request: dict = {}
        self.pending: dict[str, dict] = {}       # code → parametri dell'autorizzazione

    def fetch(self, url, form=None, *, basic=None):
        if url == f"{ISSUER}/.well-known/openid-configuration":
            return {"issuer": ISSUER, "authorization_endpoint": f"{ISSUER}/authorize",
                    "token_endpoint": f"{ISSUER}/token", "jwks_uri": f"{ISSUER}/jwks"}
        if url == f"{ISSUER}/jwks":
            return self.jwks
        if url == f"{ISSUER}/token":
            self.last_token_request = {"form": form, "basic": basic}
            auth = self.pending.pop(form["code"], None)
            if auth is None:
                raise oidc.OidcError("idp_error", "invalid_grant")
            challenge = base64.urlsafe_b64encode(hashlib.sha256(form["code_verifier"].encode()).digest()).rstrip(b"=")
            if challenge.decode() != auth["code_challenge"]:
                raise oidc.OidcError("idp_error", "PKCE")
            now = int(time.time())
            claims = {"iss": ISSUER, "aud": CLIENT, "sub": "idp-user-1", "iat": now, "exp": now + 300,
                      "nonce": auth["nonce"], **self.claims}
            return {"id_token": jwt.encode(claims, self.key, algorithm="RS256", headers={"kid": "k1"}),
                    "access_token": "x", "token_type": "Bearer"}
        raise AssertionError(url)

    def authorize(self, authorize_url: str) -> tuple[str, str]:
        """L'utente si autentica all'IdP: restituisce (state, code) per la callback."""
        q = {k: v[0] for k, v in parse_qs(urlparse(authorize_url).query).items()}
        assert q["code_challenge_method"] == "S256" and q["scope"] == "openid email profile"
        code = uuid.uuid4().hex
        self.pending[code] = q
        return q["state"], code


@pytest.fixture
def idp(monkeypatch):
    fake = FakeIdp()
    monkeypatch.setattr(oidc, "fetch_json", fake.fetch)
    oidc._cache.clear()
    yield fake
    oidc._cache.clear()


@pytest.fixture
def owner(api_world):
    urls, _ = api_world
    with psycopg.connect(urls.owner, autocommit=True) as conn:
        yield conn


@pytest.fixture
def gco_sso(client, api_world, owner, idp):
    _, w = api_world
    h = bearer(login(client, w.emails["gc_admin"]).json()["access_token"])
    url = f"/organizations/{w.orgs['GCO']}/sso"

    def configure(**over):
        body = {"issuer": ISSUER, "client_id": CLIENT, "client_secret": "s3greto-idp", "email_domains": ["GCO.example"],
                **over}
        r = client.put(url, headers=h, json=body)
        assert r.status_code == 200, r.text
        return r.json()
    configure()
    yield configure
    owner.execute("DELETE FROM cde.organization_sso WHERE organization_id = %s", [w.orgs["GCO"]])


def _sso_login(client, idp, email):
    start = client.post("/auth/sso/start", json={"email": email}).json()
    assert start["sso"] is True
    assert parse_qs(urlparse(start["authorize_url"]).query)["login_hint"] == [email]
    state, code = idp.authorize(start["authorize_url"])
    return client.get("/auth/sso/callback", params={"state": state, "code": code}, follow_redirects=False), state, code


def _fragment(r) -> dict:
    assert r.status_code == 303
    return {k: v[0] for k, v in parse_qs(urlparse(r.headers["location"]).fragment).items()}


def test_configurazione_riservata_e_segreto_cifrato(client, api_world, owner, gco_sso):
    _, w = api_world
    url = f"/organizations/{w.orgs['GCO']}/sso"
    got = client.get(url, headers=bearer(login(client, w.emails["gc_admin"]).json()["access_token"])).json()
    assert got["sso"]["email_domains"] == ["gco.example"] and got["sso"]["has_client_secret"] is True
    assert "client_secret" not in got["sso"] and got["redirect_uri"].endswith("/api/auth/sso/callback")
    blob = owner.execute("SELECT client_secret_encrypted FROM cde.organization_sso WHERE organization_id = %s",
                         [w.orgs["GCO"]]).fetchone()[0]
    assert b"s3greto-idp" not in bytes(blob)
    # altri utenti e altre organizzazioni: la configurazione non esiste
    des = bearer(login(client, w.emails["des_admin"]).json()["access_token"])
    assert client.get(url, headers=des).status_code == 404
    assert client.put(url, headers=des, json={"issuer": ISSUER, "client_id": "x", "email_domains": ["x.it"]}).status_code == 404
    # lo stesso dominio non può andare a due organizzazioni
    clash = client.put(f"/organizations/{w.orgs['DES']}/sso", headers=des,
                       json={"issuer": ISSUER, "client_id": "x", "email_domains": ["gco.example"]})
    assert clash.status_code == 422
    # aggiornare senza segreto conserva quello salvato
    assert gco_sso(client_secret=None)["sso"]["has_client_secret"] is True
    assert client.post("/auth/sso/start", json={"email": "chiunque@nessuno.example"}).json() == {"sso": False}


def test_login_completo_con_pkce(client, api_world, idp, gco_sso):
    _, w = api_world
    idp.claims = {"email": w.emails["gc_admin"], "email_verified": True}
    r, _, code = _sso_login(client, idp, w.emails["gc_admin"])
    assert _fragment(r) == {"sso": "ok"}
    assert idp.last_token_request["basic"] == (CLIENT, "s3greto-idp")
    assert idp.last_token_request["form"]["redirect_uri"].endswith("/api/auth/sso/callback")
    token = client.post("/auth/refresh").json()["access_token"]
    claims = jwt.decode(token, options={"verify_signature": False})
    assert claims["amr"] == ["pwd", "otp"] and claims["mfa"] is True     # sessione con MFA garantita dall'IdP
    assert client.get("/me", headers=bearer(token)).json()["email"] == w.emails["gc_admin"]


def test_state_nonce_audience_ed_email_verificati(client, api_world, idp, gco_sso):
    _, w = api_world
    email = w.emails["gc_admin"]
    idp.claims = {"email": email}
    r, state, _ = _sso_login(client, idp, email)
    assert _fragment(r)["sso"] == "ok"
    # state già usato
    again = client.get("/auth/sso/callback", params={"state": state, "code": "x"}, follow_redirects=False)
    assert _fragment(again) == {"sso": "error", "reason": "expired"}
    # id_token per un altro client, con un nonce diverso, o con email non verificata / di un altro dominio
    for claims, reason in (({"email": email, "aud": "altro-client"}, "invalid_token"),
                           ({"email": email, "nonce": "rubato"}, "invalid_token"),
                           ({"email": email, "email_verified": False}, "unknown_user"),
                           ({"email": "gc.admin@altro.example"}, "unknown_user"),
                           ({"email": "nessuno@gco.example"}, "unknown_user")):
        idp.claims = claims
        r, _, _ = _sso_login(client, idp, email)
        assert _fragment(r) == {"sso": "error", "reason": reason}, claims
    # firma di un'altra chiave
    idp.claims = {"email": email}
    idp.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    r, _, _ = _sso_login(client, idp, email)
    assert _fragment(r)["reason"] == "invalid_token"
    # l'IdP nega l'accesso
    start = client.post("/auth/sso/start", json={"email": email}).json()
    st, _ = idp.authorize(start["authorize_url"])
    denied = client.get("/auth/sso/callback", params={"state": st, "error": "access_denied"}, follow_redirects=False)
    assert _fragment(denied)["reason"] == "idp_denied"


def test_entra_id_preferred_username_e_invitato_attivato(client, api_world, owner, idp, gco_sso):
    _, w = api_world
    new_id = uuid.uuid4()
    owner.execute("""INSERT INTO cde.users (id, organization_id, email, first_name, last_name, status)
                     VALUES (%s, %s, 'nuovo.tecnico@gco.example', 'Nuovo', 'Tecnico', 'INVITED')""",
                  [new_id, w.orgs["GCO"]])
    idp.claims = {"preferred_username": "Nuovo.Tecnico@GCO.example", "name": "Nuovo Tecnico"}   # Entra ID
    r, _, _ = _sso_login(client, idp, "nuovo.tecnico@gco.example")
    assert _fragment(r)["sso"] == "ok"
    assert owner.execute("SELECT status FROM cde.users WHERE id = %s", [new_id]).fetchone()[0] == "ACTIVE"
    # disattivato: niente accesso, nemmeno dall'IdP
    owner.execute("UPDATE cde.users SET status = 'DISABLED' WHERE id = %s", [new_id])
    r, _, _ = _sso_login(client, idp, "nuovo.tecnico@gco.example")
    assert _fragment(r)["reason"] == "unknown_user"


def test_obbligo_sso_e_mfa_non_garantita_dall_idp(client, api_world, idp, gco_sso):
    _, w = api_world
    email = w.emails["gc_admin"]
    gco_sso(enforce=True, idp_mfa=False)
    r = login(client, email)
    assert r.status_code == 403 and r.json()["error"]["code"] == "sso_required"
    assert login(client, w.emails["platform"]).status_code == 200          # altra organizzazione
    idp.claims = {"email": email}
    r, _, _ = _sso_login(client, idp, email)
    assert _fragment(r) == {"sso": "ok"}                                    # nessun fattore e MFA non obbligatoria
    claims = jwt.decode(client.post("/auth/refresh").json()["access_token"], options={"verify_signature": False})
    assert claims["mfa"] is False
    # disattivato il single sign-on, la password torna a valere
    gco_sso(enabled=False)
    assert login(client, email).status_code == 200
    assert client.post("/auth/sso/start", json={"email": email}).json() == {"sso": False}


def test_link_di_callback_altrui_non_apre_sessioni(client, api_world, idp, gco_sso):
    """Login CSRF: chi inoltra il proprio link di ritorno dall'IdP non fa entrare la vittima nel suo account."""
    _, w = api_world
    idp.claims = {"email": w.emails["gc_admin"]}
    start = client.post("/auth/sso/start", json={"email": w.emails["gc_admin"]}).json()
    state, code = idp.authorize(start["authorize_url"])
    client.cookies.clear()                       # il browser della vittima non ha il cookie di chi ha iniziato
    r = client.get("/auth/sso/callback", params={"state": state, "code": code}, follow_redirects=False)
    assert _fragment(r) == {"sso": "error", "reason": "expired"}
    assert "cde_rt" not in r.headers.get("set-cookie", "")


def test_issuer_verso_indirizzi_interni_rifiutato(monkeypatch):
    """SSRF: in produzione l'API non scarica discovery o JWKS da metadati AWS, VPC o loopback."""
    monkeypatch.setenv("CDE_ENV", "prod")
    for url in ("http://169.254.169.254/latest/meta-data/", "http://127.0.0.1:8100/health", "https://10.0.3.7/jwks",
                "http://[::1]/x"):
        with pytest.raises(oidc.OidcError) as exc:
            oidc.fetch_json(url)
        assert exc.value.code == "idp_error", url
    with pytest.raises(oidc.OidcError):
        oidc.fetch_json("file:///etc/passwd")
