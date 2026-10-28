# "><(((º> sabusabu <º)))><"
"""Client OpenID Connect minimo per il single sign-on delle organizzazioni: discovery, scambio del codice
(authorization code + PKCE S256) e verifica dell'id_token (firma con la JWKS dell'IdP, iss, aud, exp, nonce).
Tutte le chiamate HTTP passano da fetch_json: i test la sostituiscono con un IdP finto.
"""
from __future__ import annotations

import base64
import hashlib
import ipaddress
import json
import os
import secrets
import socket
import time
import urllib.error
import urllib.parse
import urllib.request

import jwt

ALGORITHMS = ["RS256", "RS384", "RS512", "PS256", "ES256", "ES384"]
_CACHE_TTL = 3600
_cache: dict[str, tuple[float, dict]] = {}


class OidcError(Exception):
    """Errore dell'IdP o token non valido; code è il motivo mostrato (in forma generica) alla SPA."""

    def __init__(self, code: str, detail: str = ""):
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code


def _public_host(url: str) -> None:
    """SSRF: l'issuer lo sceglie l'admin di un'organizzazione, quindi fuori da dev/test niente indirizzi interni
    (metadati AWS 169.254.x, VPC, loopback). Resta il rischio di DNS rebinding tra risoluzione e connessione."""
    if os.environ.get("CDE_ENV", "dev") in ("dev", "test"):
        return
    host = urllib.parse.urlparse(url).hostname or ""
    try:
        addrs = {ai[4][0] for ai in socket.getaddrinfo(host, None)}
    except OSError:
        raise OidcError("idp_unreachable", f"host {host} non risolto") from None
    for addr in addrs:
        ip = ipaddress.ip_address(addr.split("%")[0])
        if not ip.is_global:
            raise OidcError("idp_error", f"indirizzo non pubblico {ip} per {host}")


def fetch_json(url: str, form: dict | None = None, *, basic: tuple[str, str] | None = None) -> dict:
    """GET (o POST application/x-www-form-urlencoded) di un documento JSON, timeout 10"."""
    if not url.startswith(("https://", "http://")):
        raise OidcError("idp_error", "URL non HTTP")
    _public_host(url)
    data = urllib.parse.urlencode(form).encode() if form is not None else None
    req = urllib.request.Request(url, data=data, headers={"Accept": "application/json"})  # noqa: S310
    if basic:
        token = base64.b64encode(f"{urllib.parse.quote(basic[0])}:{urllib.parse.quote(basic[1])}".encode()).decode()
        req.add_header("Authorization", f"Basic {token}")
    try:
        with urllib.request.urlopen(req, timeout=10) as res:  # noqa: S310 - schema controllato sopra
            return json.loads(res.read(1024 * 1024))
    except urllib.error.HTTPError as exc:
        raise OidcError("idp_error", f"HTTP {exc.code}") from None
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        raise OidcError("idp_unreachable", str(exc)[:200]) from None


def _cached(url: str) -> dict:
    hit = _cache.get(url)
    if hit and hit[0] > time.time():
        return hit[1]
    doc = fetch_json(url)
    _cache[url] = (time.time() + _CACHE_TTL, doc)
    return doc


def discovery(issuer: str) -> dict:
    doc = _cached(issuer.rstrip("/") + "/.well-known/openid-configuration")
    if doc.get("issuer", "").rstrip("/") != issuer.rstrip("/"):
        raise OidcError("idp_error", "issuer della discovery diverso da quello configurato")
    for key in ("authorization_endpoint", "token_endpoint", "jwks_uri"):
        if not str(doc.get(key, "")).startswith(("https://", "http://")):
            raise OidcError("idp_error", f"discovery senza {key}")
    return doc


def pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def authorize_url(doc: dict, *, client_id: str, redirect_uri: str, state: str, nonce: str, challenge: str,
                  login_hint: str | None) -> str:
    params = {"response_type": "code", "client_id": client_id, "redirect_uri": redirect_uri,
              "scope": "openid email profile", "state": state, "nonce": nonce,
              "code_challenge": challenge, "code_challenge_method": "S256"}
    if login_hint:
        params["login_hint"] = login_hint
    sep = "&" if "?" in doc["authorization_endpoint"] else "?"
    return doc["authorization_endpoint"] + sep + urllib.parse.urlencode(params)


def exchange_code(doc: dict, *, code: str, client_id: str, client_secret: str | None, redirect_uri: str,
                  verifier: str) -> dict:
    form = {"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri, "code_verifier": verifier}
    if client_secret:
        tokens = fetch_json(doc["token_endpoint"], form, basic=(client_id, client_secret))
    else:
        tokens = fetch_json(doc["token_endpoint"], {**form, "client_id": client_id})
    if "id_token" not in tokens:
        raise OidcError("idp_error", tokens.get("error", "risposta senza id_token"))
    return tokens


def verify_id_token(token: str, doc: dict, *, client_id: str, nonce: str, leeway: int = 60) -> dict:
    try:
        header = jwt.get_unverified_header(token)
        if header.get("alg") not in ALGORITHMS:
            raise OidcError("invalid_token", f"algoritmo {header.get('alg')} non ammesso")
        keys = [k for k in _cached(doc["jwks_uri"]).get("keys", [])
                if k.get("kid") == header.get("kid") or header.get("kid") is None]
        if not keys:                                    # rotazione delle chiavi dell'IdP: si rilegge la JWKS
            _cache.pop(doc["jwks_uri"], None)
            keys = [k for k in _cached(doc["jwks_uri"]).get("keys", []) if k.get("kid") == header.get("kid")]
        if not keys:
            raise OidcError("invalid_token", "chiave di firma sconosciuta")
        claims = jwt.decode(token, jwt.PyJWK(keys[0]).key, algorithms=ALGORITHMS, audience=client_id,
                            issuer=doc["issuer"], leeway=leeway, options={"require": ["exp", "iat", "sub"]})
    except jwt.InvalidTokenError as exc:
        raise OidcError("invalid_token", str(exc)) from None
    if not secrets.compare_digest(str(claims.get("nonce", "")), nonce):
        raise OidcError("invalid_token", "nonce diverso")
    return claims


def email_from_claims(claims: dict) -> str | None:
    """Email dell'utente: `email` (Google, Okta) oppure `preferred_username`/`upn` (Entra ID). Mai se non verificata."""
    if claims.get("email_verified") is False:
        return None
    for key in ("email", "preferred_username", "upn"):
        value = str(claims.get(key) or "").strip().lower()
        if "@" in value:
            return value
    return None
