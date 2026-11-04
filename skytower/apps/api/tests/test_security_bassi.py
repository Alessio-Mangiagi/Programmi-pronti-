# "><(((º> sabusabu <º)))><"
"""Falle "basse" della revisione di sicurezza del 03/11/2026 (B3, B4, B5, B6, B8, B9, B11; ADR-49, migrazione 0040)."""
from __future__ import annotations

import asyncio
import uuid

import psycopg
import pytest
from psycopg.rows import dict_row
from test_api_audit import full_verify, seal
from test_api_documents import des_name, upload, worker  # noqa: F401 - fixture riusata
from test_api_naming_auto import as_user  # noqa: F401 - fixture riusata
from test_api_watermark import _fetch, real_pdf, watermark  # noqa: F401 - fixture riusata

from cde_api.config import Settings
from cde_api.security.ratelimit import RateLimiter, StreamSlots
from cde_api.validation import JSON_MAX_BYTES, check_json_size, json_size

BIG = {"note": "x" * (JSON_MAX_BYTES + 10)}


# ---------------------------------------------------------------------
# B3: ricerca organizzazione e inviti senza enumerazione
# ---------------------------------------------------------------------
def test_lookup_solo_per_chi_puo_invitare_e_con_tetto(client, as_user):  # noqa: F811
    lead, sub1_admin, com_admin = as_user("des_lead"), as_user("sub1_admin"), as_user("com_admin")
    # utente qualunque: come un codice inesistente
    assert client.get("/organizations/lookup/COM", headers=lead).status_code == 404
    # admin di un'organizzazione e Project Admin sì
    assert client.get("/organizations/lookup/des", headers=sub1_admin).json()["code"] == "DES"
    assert client.get("/organizations/lookup/DES", headers=com_admin).status_code == 200
    assert client.get("/organizations/lookup/" + "X" * 40, headers=com_admin).status_code == 422
    # tetto per utente (30/ora): chi prova tutti i codici si ferma
    codes = [client.get(f"/organizations/lookup/Z{i:03d}", headers=com_admin).status_code for i in range(30)]
    assert codes.count(429) >= 1 and set(codes) <= {404, 429}
    assert client.get("/organizations/lookup/DES", headers=com_admin).status_code == 429


def test_invito_di_email_di_un_altro_tenant_risposta_generica(client, api_world, as_user):  # noqa: F811
    urls, w = api_world
    admin = as_user("sub1_admin")
    outbox = client.app.state.services.mailer.outbox
    sent = len(outbox)
    url = f"/organizations/{w.orgs['SUB1']}/users"
    nuovo = f"bassi.{uuid.uuid4().hex[:6]}@sub1.example"
    ok = client.post(url, headers=admin, json={"email": nuovo, "first_name": "N", "last_name": "U"})
    altrui = client.post(url, headers=admin, json={"email": w.emails["des_lead"], "first_name": "D", "last_name": "L"})
    # stessa risposta: chi invita non scopre che l'email è già cliente di un'altra organizzazione
    assert ok.status_code == altrui.status_code == 202
    assert set(ok.json()) == set(altrui.json()) and ok.json()["status"] == altrui.json()["status"] == "INVITATION_SENT"
    assert len(outbox) == sent + 1 and outbox[-1].to == nuovo          # nessuna email all'utente dell'altro tenant
    with psycopg.connect(urls.owner, row_factory=dict_row) as conn:
        assert conn.execute("SELECT organization_id FROM cde.users WHERE email = %s",
                            [w.emails["des_lead"]]).fetchone()["organization_id"] == w.orgs["DES"]
        ev = conn.execute("SELECT * FROM cde.security_events WHERE event_type = 'USER_INVITE_CONFLICT' "
                          "AND user_id = %s ORDER BY id DESC LIMIT 1", [w.users["sub1_admin"]]).fetchone()
        assert ev is not None
    # il conflitto resta per il platform admin ma non nel registro dell'organizzazione che invita
    events = client.get(f"/organizations/{w.orgs['SUB1']}/security-events", headers=admin).json()
    assert "USER_INVITE_CONFLICT" not in {e["event_type"] for e in events}
    # email già presente nella STESSA organizzazione: 409 come prima (l'admin la vede nell'elenco)
    dup = client.post(url, headers=admin, json={"email": w.emails["sub1_user"], "first_name": "S", "last_name": "U"})
    assert dup.status_code == 409
    with psycopg.connect(urls.owner) as conn:
        conn.execute("DELETE FROM cde.user_tokens WHERE user_id IN (SELECT id FROM cde.users WHERE email = %s)", [nuovo])
        conn.execute("DELETE FROM cde.users WHERE email = %s", [nuovo])


# ---------------------------------------------------------------------
# B4: verifica della catena senza ricalcolo completo a ogni richiesta
# ---------------------------------------------------------------------
def test_verifica_registro_da_esito_salvato_e_incrementale(client, api_world, as_user):  # noqa: F811
    urls, w = api_world
    admin = as_user("com_admin")
    url = f"/projects/{w.project_id}/audit/verify"
    seal(urls)
    assert full_verify(urls)
    first = client.get(url, headers=admin).json()
    # la catena, non le ancore su S3 (``ok`` comprende anche quelle, che altri test della sessione toccano)
    assert first["first_broken_seq"] is None and first["verified_seq"] == first["head_seq"], first
    # eventi nuovi dopo la verifica completa: li controlla la GET, senza rifare tutta la catena
    with psycopg.connect(urls.owner, autocommit=True) as conn:
        conn.execute("INSERT INTO cde.security_events (event_type, details) VALUES ('TEST_B4', '{}')")
    seal(urls)
    again = client.get(url, headers=admin).json()
    assert again["first_broken_seq"] is None and again["head_seq"] > again["verified_seq"] == first["verified_seq"], again
    assert again["verified_at"] == first["verified_at"]

    # la testa già verificata manomessa: scoperta subito, anche senza il giro del worker
    with psycopg.connect(urls.owner, row_factory=dict_row) as conn:
        head = conn.execute("SELECT id, details FROM cde.security_events WHERE chain_seq = %s",
                            [first["verified_seq"]]).fetchone()
        conn.execute("ALTER TABLE cde.security_events DISABLE TRIGGER trg_security_events_guard")
        # coalesce: alcuni eventi (es. quelli scritti dalle funzioni del database) non hanno dettagli
        conn.execute("""UPDATE cde.security_events SET details = coalesce(details, '{}') || '{"manomesso": true}'
                        WHERE id = %s""", [head["id"]])
        conn.commit()
        try:
            broken = client.get(url, headers=admin).json()
            assert broken["first_broken_seq"] == first["verified_seq"], broken
        finally:
            original = head["details"]
            conn.execute("UPDATE cde.security_events SET details = %s WHERE id = %s",
                         [None if original is None else psycopg.types.json.Jsonb(original), head["id"]])
            conn.execute("ALTER TABLE cde.security_events ENABLE TRIGGER trg_security_events_guard")
            conn.commit()

    # esito vecchio (worker fermo): la richiesta rifà la verifica completa, una volta
    with psycopg.connect(urls.owner) as conn:
        conn.execute("UPDATE cde.audit_chain_status SET verified_at = now() - interval '1 day'")
    fresh = client.get(url, headers=admin).json()
    assert fresh["first_broken_seq"] is None and fresh["verified_at"] > first["verified_at"] and fresh["verified_seq"] == fresh["head_seq"], fresh
    # con un esito recente la verifica completa con età massima non riparte
    with psycopg.connect(urls.worker, autocommit=True) as conn:
        assert conn.execute("SELECT cde.audit_verify_full(interval '1 hour')").fetchone()[0] is False
    # l'API non può più lanciare da sola la verifica completa senza lock né età dell'esito
    with psycopg.connect(urls.app) as conn, pytest.raises(psycopg.errors.InsufficientPrivilege):
        conn.execute("SELECT * FROM cde.audit_verify()")


def test_verifica_ed_export_registro_con_tetto_per_utente(client, api_world, as_user):  # noqa: F811
    _, w = api_world
    admin = as_user("com_admin")
    codes = [client.get(f"/projects/{w.project_id}/audit/verify", headers=admin).status_code for _ in range(10)]
    assert codes == [200] * 10
    assert client.get(f"/projects/{w.project_id}/audit/verify", headers=admin).status_code == 429
    assert client.get(f"/projects/{w.project_id}/audit/export.csv", headers=admin).status_code == 429


# ---------------------------------------------------------------------
# B5: JSON liberi con tetto in byte
# ---------------------------------------------------------------------
def test_json_liberi_con_tetto(client, api_world, as_user):  # noqa: F811
    _, w = api_world
    assert json_size({"a": "è"}) == len('{"a":"è"}'.encode())
    assert check_json_size({"a": 1}) == {"a": 1} and check_json_size(None) is None
    with pytest.raises(ValueError, match="troppo grande"):
        check_json_size(BIG)
    admin, lead = as_user("com_admin"), as_user("des_lead")
    r = client.patch(f"/projects/{w.project_id}", headers=admin, json={"settings": BIG})
    assert r.status_code == 422 and "troppo grande" in r.text
    r = client.patch(f"/documents/{uuid.uuid4()}", headers=lead, json={"attributes": BIG})
    assert r.status_code == 422 and "troppo grande" in r.text
    r = client.post("/uploads/initiate", headers=lead, json={
        "container_id": str(w.containers["des_arch"]), "filename": des_name(), "size_bytes": 10, "sha256": "0" * 64,
        "attributes": BIG})
    assert r.status_code == 422 and "troppo grande" in r.text
    r = client.put(f"/projects/{w.project_id}/document-settings", headers=admin,
                   json={"metadata_schema": {"type": "object", "description": "x" * (JSON_MAX_BYTES + 1)}})
    assert r.status_code == 422


# ---------------------------------------------------------------------
# B6: ticket dei link (SSE, download filigranato) non riutilizzabili a piacere
# ---------------------------------------------------------------------
def test_uso_dei_ticket_nel_rate_limiter():
    rl = RateLimiter("memory://")
    assert rl.use_ticket("a", 60, ip="10.0.0.1") and not rl.use_ticket("a", 60, ip="10.0.0.1")     # monouso
    # più usi: tutti dallo stesso IP del primo, fino al tetto
    assert all(rl.use_ticket("b", 60, ip="10.0.0.1", max_uses=3) for _ in range(3))
    assert not rl.use_ticket("b", 60, ip="10.0.0.1", max_uses=3)
    assert rl.use_ticket("c", 60, ip="10.0.0.1", max_uses=5)
    assert not rl.use_ticket("c", 60, ip="10.9.9.9", max_uses=5)          # altro IP: respinto...
    assert not rl.use_ticket("c", 60, ip="10.0.0.1", max_uses=5)          # ...e il ticket è bruciato per tutti


def test_ticket_sse_monouso(client, api_world, as_user):  # noqa: F811
    _, w = api_world
    h = as_user("des_lead")
    ticket = client.post("/notifications/stream-ticket", headers=h).json()["ticket"]
    slots = client.app.state.services.limiter.streams
    key = str(w.users["des_lead"])
    for _ in range(5):                                   # l'utente ha già 5 schede con lo stream aperto
        assert slots.acquire(key, 5)
    r = client.get("/notifications/stream", params={"ticket": ticket})
    assert r.status_code == 429 and r.json()["error"]["code"] == "too_many_streams"     # B11
    for _ in range(5):
        slots.release(key)
    # il ticket è stato usato dalla richiesta precedente: la riconnessione ne chiede uno nuovo (come fa la SPA)
    r = client.get("/notifications/stream", params={"ticket": ticket})
    assert r.status_code == 401 and "già usato" in r.json()["error"]["message"]


def test_download_filigranato_monouso_e_visualizzatore_legato_all_ip(client, api_world, api_app, as_user, worker,  # noqa: F811
                                                                      watermark, monkeypatch):  # noqa: F811
    _, w = api_world
    h = as_user("des_lead")
    as_user("com_admin")                       # login prima dei ticket: il login azzera i contatori
    rev = upload(client, h, w.containers["des_arch"], des_name(), real_pdf(1)).json()
    worker()
    watermark({"states": ["WIP"]})
    # allegato: monouso
    url = client.get(f"/revisions/{rev['id']}/download", headers=h).json()["url"]
    assert _fetch(client, url).status_code == 200
    again = _fetch(client, url)
    assert again.status_code == 401 and "già usato" in again.json()["error"]["message"]
    # visualizzatore: il frontend riapre lo stesso URL (cache 4', StrictMode) dallo stesso IP
    monkeypatch.setattr(api_app.state.services.settings, "client_ip_header", "x-test-ip")
    view = client.get(f"/revisions/{rev['id']}/download", headers=h, params={"disposition": "inline"}).json()["url"]
    path = view.removeprefix("/api")
    mine = {"x-test-ip": "10.1.1.1"}
    assert client.get(path, headers=mine).status_code == 200
    assert client.get(path, headers=mine).status_code == 200
    # lo stesso link da un'altra rete non apre il PDF, e da quel momento non vale più per nessuno
    assert client.get(path, headers={"x-test-ip": "192.0.2.7"}).status_code == 401
    assert client.get(path, headers=mine).status_code == 401
    # un nuovo link funziona di nuovo
    view = client.get(f"/revisions/{rev['id']}/download", headers=h, params={"disposition": "inline"}).json()["url"]
    assert client.get(view.removeprefix("/api"), headers=mine).status_code == 200


# ---------------------------------------------------------------------
# B8: HTTP in LAN → refresh breve
# ---------------------------------------------------------------------
def test_refresh_breve_con_cookie_non_secure_fuori_da_dev():
    lungo = 14 * 24 * 3600
    prod_http = Settings(env="prod", cookie_secure=False)
    assert prod_http.insecure_cookies and prod_http.refresh_token_ttl_s == 12 * 3600
    assert Settings(env="prod", cookie_secure=False, insecure_refresh_token_ttl_s=3600).refresh_token_ttl_s == 3600
    assert Settings(env="prod", cookie_secure=True).refresh_token_ttl_s == lungo
    dev = Settings(env="dev", cookie_secure=False)
    assert not dev.insecure_cookies and dev.refresh_token_ttl_s == lungo
    # una durata già più breve resta quella
    assert Settings(env="staging", cookie_secure=False, refresh_token_ttl_s=1800).refresh_token_ttl_s == 1800


# ---------------------------------------------------------------------
# B9: domini del single sign-on solo se già usati da utenti attivi dell'organizzazione
# ---------------------------------------------------------------------
def test_dominio_sso_solo_se_dell_organizzazione(client, api_world, as_user):  # noqa: F811
    urls, w = api_world
    gc = as_user("gc_admin")
    url = f"/organizations/{w.orgs['GCO']}/sso"
    body = {"issuer": "https://idp.bassi.example", "client_id": "cde"}
    try:
        r = client.put(url, headers=gc, json={**body, "email_domains": ["impresa-altrui.example"]})
        assert r.status_code == 422 and r.json()["error"]["code"] == "sso_domain_not_owned"
        assert client.put(url, headers=gc, json={**body, "email_domains": ["GCO.example"]}).status_code == 200
        # un dominio registrato prima della regola resta, anche senza utenti attivi
        with psycopg.connect(urls.owner, autocommit=True) as conn:
            conn.execute("UPDATE cde.organization_sso SET email_domains = '{gco.example,storico.example}' "
                         "WHERE organization_id = %s", [w.orgs["GCO"]])
        r = client.put(url, headers=gc, json={**body, "email_domains": ["gco.example", "storico.example"]})
        assert r.status_code == 200, r.text
        # la funzione di controllo non fa da oracolo: chi non amministra l'organizzazione riceve sempre false
        with psycopg.connect(urls.app) as conn:
            check = "SELECT cde.org_has_email_domain(%s, 'gco.example')"
            conn.execute("SELECT set_config('app.user_id', %s, false)", [str(w.users["des_admin"])])
            assert conn.execute(check, [w.orgs["GCO"]]).fetchone()[0] is False
            conn.execute("SELECT set_config('app.user_id', %s, false)", [str(w.users["gc_admin"])])
            assert conn.execute(check, [w.orgs["GCO"]]).fetchone()[0] is True
    finally:
        with psycopg.connect(urls.owner, autocommit=True) as conn:
            conn.execute("DELETE FROM cde.organization_sso WHERE organization_id = %s", [w.orgs["GCO"]])


# ---------------------------------------------------------------------
# B11: stream SSE contati per utente
# ---------------------------------------------------------------------
def test_posti_degli_stream():
    s = StreamSlots()
    assert s.acquire("u", 2) and s.acquire("u", 2) and not s.acquire("u", 2)
    s.release("u")
    assert s.count("u") == 1 and s.acquire("u", 2)
    s.release("u")
    s.release("u")
    s.release("u")                                    # un rilascio in più non va sotto zero
    assert s.count("u") == 0


def test_stream_rende_il_posto_quando_finisce(api_app, api_world):
    from cde_api.modules import notifications

    _, w = api_world
    svc = api_app.state.services
    svc.limiter.reset()
    user = w.users["des_lead"]

    class _Disconnected:            # client già andato via: il generatore esce al primo giro
        client = None
        headers = None
        app = api_app

        def __init__(self):
            self.headers = {}

        async def is_disconnected(self):
            return True

    async def run():
        resp = await notifications.stream(_Disconnected(), svc.tokens.issue_sse_ticket(user), 0, svc)
        assert svc.limiter.streams.count(str(user)) == 1
        async for _ in resp.body_iterator:
            pass
        await resp.background()                       # il task di fine risposta non rende il posto due volte
    asyncio.run(run())
    assert svc.limiter.streams.count(str(user)) == 0
