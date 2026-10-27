# "><(((º> sabusabu <º)))><"
"""Sprint 5: registro attività con hash chain, verifica di integrità, export CSV firmato."""
from __future__ import annotations

import csv
import hashlib
import io
import uuid

import jwt
import psycopg
import pytest
from psycopg.rows import dict_row
from test_api_states import as_user  # noqa: F401 - fixture riusata


def seal(urls) -> int:
    with psycopg.connect(urls.worker, autocommit=True) as conn:
        return conn.execute("SELECT cde.audit_seal()").fetchone()[0]


@pytest.fixture
def events(client, api_world, as_user):  # noqa: F811
    """Qualche evento sulla commessa demo, già sigillato."""
    urls, w = api_world
    admin = as_user("com_admin")
    r = client.post(f"/projects/{w.project_id}/containers", headers=admin, json={"name": f'=HYPERLINK("{uuid.uuid4().hex[:8]}")'})
    assert r.status_code == 201, r.text
    seal(urls)
    return r.json()


def test_registro_solo_project_admin(client, api_world, as_user, events):  # noqa: F811
    _, w = api_world
    rows = client.get(f"/projects/{w.project_id}/audit", headers=as_user("com_admin")).json()
    created = next(e for e in rows if e["event_type"] == "CONTAINER_CREATED" and e["details"].get("container") == events["id"])
    assert created["chain_seq"] and len(created["hash"]) == 64 and created["user_name"]
    for user in ("des_admin", "des_lead", "com_dl"):
        assert client.get(f"/projects/{w.project_id}/audit", headers=as_user(user)).status_code == 403, user
        assert client.get(f"/projects/{w.project_id}/audit/export.csv", headers=as_user(user)).status_code == 403
    assert client.get(f"/projects/{w.project_id}/audit", headers=as_user("out_user")).status_code == 404


def test_catena_integra_e_manomissione_rilevata(client, api_world, as_user, events):  # noqa: F811
    urls, w = api_world
    admin = as_user("com_admin")
    ok = client.get(f"/projects/{w.project_id}/audit/verify", headers=admin).json()
    assert ok["ok"] and ok["checked"] >= 1 and ok["unsealed"] == 0 and len(ok["head_hash"]) == 64

    with psycopg.connect(urls.owner, row_factory=dict_row) as conn:
        target = conn.execute("SELECT id, chain_seq, details FROM cde.security_events WHERE chain_seq IS NOT NULL "
                              "ORDER BY chain_seq DESC LIMIT 1 OFFSET 3").fetchone()
        # anche il proprietario non modifica un evento sigillato
        with pytest.raises(psycopg.Error, match="append-only"):
            conn.execute("UPDATE cde.security_events SET details = '{}' WHERE id = %s", [target["id"]])
        conn.rollback()
        # chi aggira i trigger (es. DBA) viene comunque scoperto dalla verifica
        conn.execute("ALTER TABLE cde.security_events DISABLE TRIGGER trg_security_events_guard")
        conn.execute("""UPDATE cde.security_events SET details = details || '{"manomesso": true}' WHERE id = %s""",
                     [target["id"]])
        conn.commit()
        try:
            broken = client.get(f"/projects/{w.project_id}/audit/verify", headers=admin).json()
            assert not broken["ok"] and broken["first_broken_seq"] == target["chain_seq"]
        finally:
            conn.execute("UPDATE cde.security_events SET details = %s WHERE id = %s",
                         [psycopg.types.json.Jsonb(target["details"]), target["id"]])
            conn.execute("ALTER TABLE cde.security_events ENABLE TRIGGER trg_security_events_guard")
            conn.commit()
    assert client.get(f"/projects/{w.project_id}/audit/verify", headers=admin).json()["ok"]


def test_export_csv_firmato(client, api_world, as_user, events):  # noqa: F811
    _, w = api_world
    r = client.get(f"/projects/{w.project_id}/audit/export.csv", headers=as_user("com_admin"),
                   params={"event_type": "CONTAINER_CREATED"})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    body = r.content
    assert hashlib.sha256(body).hexdigest() == r.headers["x-cde-sha256"]
    jwks = client.get("/.well-known/jwks.json").json()
    key = jwt.PyJWK(jwks["keys"][0]).key
    claims = jwt.decode(r.headers["x-cde-signature"], key, algorithms=["RS256"], options={"verify_aud": False})
    assert claims["sha256"] == r.headers["x-cde-sha256"] and claims["sub"] == str(w.project_id) and claims["chain_ok"]
    text = body.decode("utf-8-sig")
    lines = text.strip().splitlines()
    assert lines[0].startswith("id;occurred_at;event_type") and len(lines) - 1 == claims["rows"] >= 1
    cells = [cell for row in csv.reader(io.StringIO(text), delimiter=";") for cell in row]
    assert not [c for c in cells if c[:1] in ("=", "+", "-", "@")]     # niente formule eseguibili da Excel
    # l'export stesso finisce nel registro
    rows = client.get(f"/projects/{w.project_id}/audit", headers=as_user("com_admin"),
                      params={"event_type": "AUDIT_EXPORTED"}).json()
    assert rows and rows[0]["details"]["sha256"] == claims["sha256"]


def test_ancora_giornaliera(api_world, events):
    urls, _ = api_world
    with psycopg.connect(urls.worker, autocommit=True) as conn:
        seq = conn.execute("SELECT cde.audit_anchor('2000-01-01')").fetchone()[0]
        again = conn.execute("SELECT cde.audit_anchor('2000-01-01')").fetchone()[0]
    assert seq and again >= seq
    with psycopg.connect(urls.owner) as conn:
        row = conn.execute("SELECT chain_seq FROM cde.audit_anchors WHERE day = '2000-01-01'").fetchone()
        assert row[0] == seq                                            # la prima ancora del giorno non cambia
        with pytest.raises(psycopg.Error, match="append-only"):
            conn.execute("DELETE FROM cde.audit_anchors")
