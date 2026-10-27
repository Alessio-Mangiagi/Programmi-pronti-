# "><(((º> sabusabu <º)))><"
"""G57: pentest automatizzato dell'API (OWASP API Security Top 10, 2023).

Non sostituisce il pentest esterno: lo prepara, rendendo regressione in CI le classi di attacco
che il pentester proverà per prime. Le rotte sono enumerate dall'app stessa, così ogni nuovo
endpoint finisce automaticamente sotto test.

- API1 BOLA/IDOR: ogni rotta con identificativi altrui o inesistenti → mai 2xx, mai 5xx.
- API2 autenticazione rotta: senza token, token alterati, alg=none, confusione HS256/RS256,
  scaduti, audience/issuer sbagliati, token di altro tipo (MFA parziale, ticket SSE).
- API3 mass assignment: campi privilegiati nel corpo ignorati o rifiutati.
- API4 consumo risorse: limite di pagina, rate limit sul login.
- API8 configurazione: header di sicurezza, errori senza stack trace, CORS ristretto.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import time
import uuid

import jwt
import psycopg
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.routing import APIRoute

from cde_api.tooling.demo_seed import DEMO_PASSWORD

# Rotte raggiungibili senza access token (per progetto: autenticazione, salute, chiavi pubbliche).
PUBLIC = re.compile(r"^/(auth/|health$|\.well-known/|docs|openapi\.json|invitations/)")
# Path parametrici non UUID: valori plausibili per arrivare fino al controllo di autorizzazione.
PARAM_VALUES = {"kind": "documents", "token": "x" * 43}
STACK_MARKERS = ("Traceback", "File \"", "psycopg", "sqlalchemy", "site-packages")


@pytest.fixture
def as_user(client, api_world):
    _, w = api_world
    tokens: dict[str, str] = {}

    def headers(user: str) -> dict:
        if user not in tokens:
            client.app.state.services.limiter.reset()
            r = client.post("/auth/login", json={"email": w.emails[user], "password": DEMO_PASSWORD})
            assert r.status_code == 200, r.text
            tokens[user] = r.json()["access_token"]
        return {"Authorization": f"Bearer {tokens[user]}"}
    return headers


def _routes(app, *, public: bool | None = None):
    for r in app.routes:
        if not isinstance(r, APIRoute):
            continue
        if public is not None and bool(PUBLIC.match(r.path)) != public:
            continue
        for method in sorted(r.methods - {"HEAD", "OPTIONS"}):
            yield method, r.path


def _fill(path: str, **values) -> str:
    def sub(m):
        name = m.group(1).split(":")[0]
        return str(values.get(name) or PARAM_VALUES.get(name) or uuid.uuid4())
    return re.sub(r"\{([^}]+)\}", sub, path)


def _call(client, method, url, headers):
    body = None if method in ("GET", "DELETE") else {}
    return client.request(method, url, headers=headers, json=body)


def _b64(obj) -> str:
    raw = obj if isinstance(obj, bytes) else json.dumps(obj, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _claims(client, api_world, user="sub1_user", **override) -> dict:
    _, w = api_world
    s = client.app.state.services.settings
    now = int(time.time())
    base = {"iss": s.jwt_issuer, "aud": s.jwt_audience, "iat": now, "exp": now + 600, "jti": str(uuid.uuid4()),
            "typ": "access", "sub": str(w.users[user]), "org": str(w.orgs["SUB1"]), "amr": ["pwd"], "mfa": False}
    base.update(override)
    return base


# ---------------------------------------------------------------- API2: autenticazione


def test_api2_ogni_rotta_protetta_rifiuta_anonimi(client):
    falliti = []
    for method, path in _routes(client.app, public=False):
        r = _call(client, method, _fill(path), {})
        if r.status_code != 401:
            falliti.append(f"{method} {path} → {r.status_code}")
    assert not falliti, "rotte accessibili senza token:\n" + "\n".join(falliti)


def _forged_tokens(client, api_world) -> dict[str, str]:
    svc = client.app.state.services
    good = svc.tokens.issue_access(*_ids(api_world), ["pwd"])
    head, payload, sig = good.split(".")
    # confusione di algoritmo: HMAC con la chiave pubblica (nota a tutti) come segreto
    pub_pem = svc.tokens._public.public_bytes(serialization.Encoding.PEM,  # noqa: SLF001
                                              serialization.PublicFormat.SubjectPublicKeyInfo)
    hs_header = _b64({"alg": "HS256", "typ": "JWT", "kid": svc.tokens.kid})
    hs_body = _b64(_claims(client, api_world))
    hs_sig = base64.urlsafe_b64encode(
        hmac.new(pub_pem, f"{hs_header}.{hs_body}".encode(), hashlib.sha256).digest()).rstrip(b"=").decode()
    tampered = _b64({**json.loads(base64.urlsafe_b64decode(payload + "==")), "sub": str(_ids(api_world, "com_admin")[0])})
    return {
        "firma alterata": f"{head}.{payload}.{sig[:-4]}AAAA",
        "payload alterato (sub)": f"{head}.{tampered}.{sig}",
        "alg none": f"{_b64({'alg': 'none', 'typ': 'JWT'})}.{_b64(_claims(client, api_world))}.",
        "HS256 con chiave pubblica": f"{hs_header}.{hs_body}.{hs_sig}",
        "scaduto": svc.tokens._encode(  # noqa: SLF001
            {k: v for k, v in _claims(client, api_world).items() if k not in ("iss", "aud", "iat", "exp", "jti")}, -60),
        "audience errata": jwt.encode(_claims(client, api_world, aud="altro-servizio"), svc.tokens._private,  # noqa: SLF001
                                      algorithm="RS256", headers={"kid": svc.tokens.kid}),
        "issuer errato": jwt.encode(_claims(client, api_world, iss="https://attaccante.example"),
                                    svc.tokens._private, algorithm="RS256", headers={"kid": svc.tokens.kid}),  # noqa: SLF001
        "chiave estranea": _foreign_key_token(client, api_world),
        "token MFA parziale": svc.tokens.issue_mfa_pending(_ids(api_world)[0], enroll=False),
        "ticket SSE": svc.tokens.issue_sse_ticket(_ids(api_world)[0]),
        "export firmato": svc.tokens.sign_export({"sub": str(_ids(api_world)[0])}),
        "non JWT": "Cantiere-2026!",
    }


def _ids(api_world, user="sub1_user"):
    _, w = api_world
    org = {"sub1_user": "SUB1", "com_admin": "COM"}[user]
    return w.users[user], w.orgs[org]


def _foreign_key_token(client, api_world) -> str:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return jwt.encode(_claims(client, api_world), key, algorithm="RS256",
                      headers={"kid": client.app.state.services.tokens.kid})


def test_api2_token_contraffatti_rifiutati(client, api_world):
    accettati = []
    for nome, token in _forged_tokens(client, api_world).items():
        r = client.get("/me", headers={"Authorization": f"Bearer {token}"})
        if r.status_code != 401:
            accettati.append(f"{nome} → {r.status_code}")
    assert not accettati, "\n".join(accettati)


def test_api2_token_valido_di_controllo(client, api_world):
    """Il token forgiato con la chiave giusta funziona: i rifiuti sopra non sono falsi positivi."""
    svc = client.app.state.services
    token = svc.tokens.issue_access(*_ids(api_world), ["pwd"])
    assert client.get("/me", headers={"Authorization": f"Bearer {token}"}).status_code == 200


def test_api2_schema_authorization_errato(client, api_world):
    token = client.app.state.services.tokens.issue_access(*_ids(api_world), ["pwd"])
    for h in (f"Basic {token}", f"bearer{token}", token, f"Bearer {token} extra"):
        assert client.get("/me", headers={"Authorization": h}).status_code == 401, h


def test_api2_utente_disattivato_perde_accesso(client, api_world):
    """Un access token ancora valido non basta se l'utente è stato disattivato."""
    urls, w = api_world
    token = client.app.state.services.tokens.issue_access(w.users["sub2_user"], w.orgs["SUB2"], ["pwd"])
    hdr = {"Authorization": f"Bearer {token}"}
    assert client.get("/me", headers=hdr).status_code == 200
    with psycopg.connect(urls.owner) as conn:
        conn.execute("UPDATE cde.users SET status = 'DISABLED' WHERE id = %s", [w.users["sub2_user"]])
    try:
        assert client.get("/me", headers=hdr).status_code in (401, 403)
    finally:
        with psycopg.connect(urls.owner) as conn:
            conn.execute("UPDATE cde.users SET status = 'ACTIVE' WHERE id = %s", [w.users["sub2_user"]])


# ---------------------------------------------------------------- API1: BOLA / IDOR


def _check_no_access(client, headers, values: dict) -> list[str]:
    problemi = []
    for method, path in _routes(client.app, public=False):
        if path in ("/me", "/me/tasks", "/me/rfis", "/me/notifications") or path.startswith("/me/"):
            continue  # risorse dell'utente stesso
        if "{" not in path:
            continue  # liste globali: filtrate dalla RLS, coperte dai test di isolamento
        r = _call(client, method, _fill(path, **values), headers)
        if r.status_code >= 500 or 200 <= r.status_code < 300:
            problemi.append(f"{method} {path} → {r.status_code} {r.text[:120]}")
    return problemi


def test_api1_identificativi_inesistenti_mai_2xx_ne_5xx(client, as_user):
    problemi = _check_no_access(client, as_user("com_admin"), {})
    assert not problemi, "\n".join(problemi)


def test_api1_esterno_non_raggiunge_progetto_altrui(client, api_world, as_user):
    """out_user (org admin di un'azienda fuori progetto) prova ogni rotta sugli ID reali del progetto."""
    _, w = api_world
    values = {"project_id": w.project_id, "container_id": w.containers["des_root"],
              "organization_id": w.orgs["DES"], "org_id": w.orgs["DES"], "user_id": w.users["des_lead"]}
    problemi = _check_no_access(client, as_user("out_user"), values)
    assert not problemi, "\n".join(problemi)


def test_api1_subappaltatore_non_raggiunge_container_progettista(client, api_world, as_user):
    _, w = api_world
    hdr = as_user("sub1_user")
    for cid in ("des_root", "des_arch", "des_private", "sub2_root"):
        c = w.containers[cid]
        assert client.get(f"/containers/{c}", headers=hdr).status_code == 404, cid
        assert client.get(f"/containers/{c}/documents", headers=hdr).status_code in (403, 404), cid


def test_api1_lista_globale_progetti_filtrata(client, api_world, as_user):
    _, w = api_world
    r = client.get("/projects", headers=as_user("out_user"))
    assert r.status_code == 200
    assert str(w.project_id) not in r.text  # project2 è dell'organizzazione OUT: può vederlo


def test_api1_identificativi_malformati(client, as_user):
    hdr = as_user("com_admin")
    for bad in ("1", "../../etc/passwd", "' OR 1=1 --", "%00", "0" * 400):
        r = client.get(f"/projects/{bad}", headers=hdr)
        assert r.status_code in (404, 422), (bad, r.status_code)


# ---------------------------------------------------------------- API3: mass assignment


def test_api3_profilo_non_eleva_privilegi(client, api_world, as_user):
    _, w = api_world
    hdr = as_user("sub1_user")
    before = client.get("/me", headers=hdr).json()
    r = client.patch("/me", headers=hdr, json={
        "is_platform_admin": True, "is_org_admin": True, "organization_id": str(w.orgs["COM"]),
        "email": "attaccante@evil.example", "status": "ACTIVE", "password_hash": "x", "mfa_required": False})
    assert r.status_code in (200, 422), r.text
    after = client.get("/me", headers=hdr).json()
    for k in ("is_platform_admin", "is_org_admin", "organization_id", "email"):
        assert after.get(k) == before.get(k), k
    r = client.post("/organizations", headers=hdr, json={"code": "EVIL", "name": "Evil", "kind": "SUBCONTRACTOR"})
    assert r.status_code in (403, 404, 422), r.text


# ---------------------------------------------------------------- API4: consumo risorse


def test_api4_limite_pagina(client, api_world, as_user):
    _, w = api_world
    hdr = as_user("com_admin")
    assert client.get(f"/projects/{w.project_id}/documents?limit=1000000", headers=hdr).status_code == 422
    assert client.get(f"/projects/{w.project_id}/documents?limit=200", headers=hdr).status_code == 200


def test_api4_rate_limit_login(client, api_world):
    _, w = api_world
    client.app.state.services.limiter.reset()
    codes = [client.post("/auth/login", json={"email": w.emails["sub2_user"], "password": "sbagliata-123456"}).status_code
             for _ in range(30)]
    client.app.state.services.limiter.reset()
    assert 429 in codes
    assert all(c in (401, 423, 429) for c in codes), codes


def test_api4_corpo_enorme_rifiutato(client, as_user):
    r = client.patch("/me", headers=as_user("sub1_user"), json={"display_name": "A" * 1_000_000})
    assert r.status_code in (413, 422)


# ---------------------------------------------------------------- API8: configurazione


@pytest.mark.parametrize("path", ["/health", "/me", "/projects/non-un-uuid", "/rotta-inesistente"])
def test_api8_header_di_sicurezza_su_ogni_risposta(client, path):
    r = client.get(path)
    for h in ("Strict-Transport-Security", "X-Content-Type-Options", "X-Frame-Options",
              "Content-Security-Policy", "Cache-Control", "Referrer-Policy"):
        assert h in r.headers, (path, h)
    assert "server" not in {k.lower() for k in r.headers} or "uvicorn" not in r.headers.get("server", "").lower()


def test_api8_errori_senza_dettagli_interni(client, as_user):
    hdr = as_user("com_admin")
    for method, path in _routes(client.app, public=False):
        r = _call(client, method, _fill(path), hdr)
        leak = [m for m in STACK_MARKERS if m in r.text]
        assert not leak, f"{method} {path}: {leak}"


def test_api8_cors_origine_estranea(client):
    r = client.options("/me", headers={"Origin": "https://attaccante.example", "Access-Control-Request-Method": "GET"})
    assert r.headers.get("access-control-allow-origin") not in ("*", "https://attaccante.example")


def test_api8_metodi_non_previsti(client, as_user):
    r = client.request("TRACE", "/me", headers=as_user("sub1_user"))
    assert r.status_code in (405, 404)


# ---------------------------------------------------------------- IP del client dietro l'edge


def _ip_of(header_name, headers):
    from types import SimpleNamespace

    from starlette.requests import Request

    from cde_api.deps import client_ip

    app = SimpleNamespace(state=SimpleNamespace(services=SimpleNamespace(
        settings=SimpleNamespace(client_ip_header=header_name))))
    scope = {"type": "http", "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
             "client": ("10.50.1.7", 41000), "app": app}
    return client_ip(Request(scope))


def test_ip_client_x_forwarded_for_ignorato():
    """Senza header dell'edge configurato conta il peer TCP: X-Forwarded-For non sposta il rate limit."""
    assert _ip_of(None, {"X-Forwarded-For": "1.2.3.4"}) == "10.50.1.7"


def test_ip_client_da_cloudfront():
    h = "cloudfront-viewer-address"
    assert _ip_of(h, {h: "203.0.113.9:51234"}) == "203.0.113.9"
    assert _ip_of(h, {h: "2001:db8::17:443"}) == "2001:db8::17"
    assert _ip_of(h, {h: "[2001:db8::17]:443"}) == "2001:db8::17"
    assert _ip_of(h, {h: "non-un-ip:1"}) is None
    assert _ip_of(h, {}) == "10.50.1.7"
