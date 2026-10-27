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


def test_export_pdf_firmato(client, api_world, as_user, events):  # noqa: F811
    _, w = api_world
    assert client.get(f"/projects/{w.project_id}/audit/export.pdf", headers=as_user("des_lead")).status_code == 403
    r = client.get(f"/projects/{w.project_id}/audit/export.pdf", headers=as_user("com_admin"),
                   params={"event_type": "CONTAINER_CREATED"})
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF") and 'filename="registro-PRJ01-' in r.headers["content-disposition"]
    assert hashlib.sha256(r.content).hexdigest() == r.headers["x-cde-sha256"]
    key = jwt.PyJWK(client.get("/.well-known/jwks.json").json()["keys"][0]).key
    claims = jwt.decode(r.headers["x-cde-signature"], key, algorithms=["RS256"], options={"verify_aud": False})
    assert claims["kind"] == "audit-pdf" and claims["sha256"] == r.headers["x-cde-sha256"] and claims["rows"] >= 1
    assert claims["filters"]["event_type"] == "CONTAINER_CREATED"


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


def test_ancore_su_s3_worm_con_marca_temporale(client, api_world, api_app, api_settings, as_user, events):  # noqa: F811
    from botocore.exceptions import ClientError

    from cde_api import anchoring

    urls, w = api_world
    with psycopg.connect(urls.worker, autocommit=True) as conn:
        conn.execute("SELECT cde.audit_anchor('2001-01-02')")
    settings = api_settings.model_copy(update={"tsa_url": "https://tsa.example/ts"})
    asked = []

    def fake_tsa(url, digest):           # risposta TSA "granted" con un token fittizio
        asked.append(digest)
        token = anchoring._seq(anchoring._oid("1.2.840.113549.1.7.2"))
        return anchoring.timestamp_token(anchoring._seq(anchoring._seq(anchoring._int(0)), token))

    storage = api_app.state.services.storage
    with psycopg.connect(urls.worker, row_factory=dict_row) as conn:
        assert anchoring.publish_pending(conn, storage, settings, tsa=fake_tsa) >= 1
        assert anchoring.publish_pending(conn, storage, settings, tsa=fake_tsa) == 0      # già pubblicate
    with psycopg.connect(urls.owner, row_factory=dict_row) as conn:
        proof = conn.execute("SELECT * FROM cde.audit_anchor_proofs WHERE day = '2001-01-02'").fetchone()
        with pytest.raises(psycopg.Error):
            conn.execute("DELETE FROM cde.audit_anchor_proofs")
    body = storage.get_bytes(proof["s3_key"], proof["s3_version_id"])
    assert hashlib.sha256(body).digest() == bytes(proof["document_sha256"]) in asked
    assert proof["tsa_token"] and proof["lock_mode"] == "GOVERNANCE"
    with pytest.raises(ClientError):     # WORM: la versione non si cancella prima della scadenza
        storage.client.delete_object(Bucket=storage.bucket, Key=proof["s3_key"], VersionId=proof["s3_version_id"])

    v = client.get(f"/projects/{w.project_id}/audit/verify", headers=as_user("com_admin")).json()
    a = next(x for x in v["anchors"] if x["day"] == "2001-01-02")
    assert a["matches_chain"] and a["matches_s3"] and a["has_tsa"] and v["anchors_ok"] and v["ok"]


def test_tsa_non_disponibile_rimanda(api_world, api_app, api_settings, events):
    from cde_api import anchoring

    urls, _ = api_world
    with psycopg.connect(urls.worker, autocommit=True) as conn:
        conn.execute("SELECT cde.audit_anchor('2001-01-03')")

    def down(url, digest):
        raise OSError("TSA irraggiungibile")

    settings = api_settings.model_copy(update={"tsa_url": "https://tsa.example/ts"})
    with psycopg.connect(urls.worker, row_factory=dict_row) as conn:
        anchoring.publish_pending(conn, api_app.state.services.storage, settings, tsa=down)
        pending = [r["day"].isoformat() for r in conn.execute("SELECT * FROM cde.audit_anchors_pending(100)")]
    assert "2001-01-03" in pending


def test_codifica_rfc3161():
    from cde_api import anchoring

    req = anchoring.timestamp_request(b"\x11" * 32, 7)
    assert "0609608648016503040201" in req.hex() and req.endswith(b"\x01\x01\xff")
    with pytest.raises(ValueError, match="rifiutata"):
        anchoring.timestamp_token(anchoring._seq(anchoring._seq(anchoring._int(2))))
