# "><(((º> sabusabu <º)))><"
"""G25 — permessi per insieme.

1. `cde.my_containers()` (usata dalle policy, calcolata una volta per query) deve dare esattamente
   lo stesso risultato di `cde.has_permission()` (valutata per riga), per ogni utente e azione.
2. Benchmark (opt-in, CDE_PERF=1): lista documenti < 200 ms con 100.000 documenti.
"""
from __future__ import annotations

import os
import statistics
import tempfile
import time
from pathlib import Path

import psycopg
import pytest
from conftest import PASSWORDS, act_as
from psycopg.rows import dict_row

from cde_api.modules.documents import DOCUMENT_SQL
from cde_api.tooling import dbadmin, demo_seed

ACTIONS = ["READ", "WRITE", "DOWNLOAD", "APPROVE", "ADMIN"]


def _equivalence(app_conn, world):
    mismatches = []
    for user, uid in world.users.items():
        act_as(app_conn, uid)
        for action in ACTIONS:
            fast = {r["c"] for r in app_conn.execute("SELECT cde.my_containers(%s) c", [action])}
            slow = {r["id"] for r in app_conn.execute(
                "SELECT id FROM cde.containers_all_for_test() id WHERE cde.has_permission(%s, id, %s)", [uid, action])}
            if fast != slow:
                mismatches.append((user, action, len(fast), len(slow)))
    return mismatches


@pytest.fixture
def all_containers_fn(owner_conn):
    owner_conn.execute("""CREATE OR REPLACE FUNCTION cde.containers_all_for_test() RETURNS SETOF uuid
                          LANGUAGE sql SECURITY DEFINER AS 'SELECT id FROM cde.containers'""")
    owner_conn.execute("GRANT EXECUTE ON FUNCTION cde.containers_all_for_test() TO cde_app")
    owner_conn.commit()
    yield
    owner_conn.execute("DROP FUNCTION cde.containers_all_for_test()")
    owner_conn.commit()


def test_my_containers_equivale_a_has_permission(app_conn, owner_conn, world, all_containers_fn):
    assert _equivalence(app_conn, world) == []


def test_equivalenza_con_grant_ereditati_scaduti_e_revocati(app_conn, owner_conn, world, all_containers_fn):
    c, u, o = world.containers, world.users, world.orgs
    rows = [
        (c["des_root"], "ORGANIZATION", None, o["SUB1"], "{READ,DOWNLOAD}", "now()", "NULL", "NULL"),
        (c["des_arch"], "USER", u["sub2_user"], None, "{READ,WRITE}", "now()", "NULL", "NULL"),
        (c["des_private"], "ORGANIZATION", None, o["COM"], "{READ,APPROVE}", "now()", "NULL", "NULL"),
        (c["sub1_root"], "ORGANIZATION", None, o["DES"], "{READ}", "now() - interval '2 day'",
         "now() - interval '1 day'", "NULL"),                                          # scaduto
        (c["com_root"], "USER", u["des_viewer"], None, "{READ,WRITE}", "now()", "NULL", "now()"),  # revocato
    ]
    for cid, gtype, guser, gorg, actions, vfrom, vuntil, revoked in rows:
        owner_conn.execute(
            f"""INSERT INTO cde.access_grants (project_id, container_id, grantee_type, grantee_user_id,
                    grantee_organization_id, actions, reason, granted_by, valid_from, valid_until, revoked_at, revoked_by)
                VALUES (%s, %s, %s, %s, %s, %s, 'test', %s, {vfrom}, {vuntil}, {revoked},
                        {'%s' if revoked != 'NULL' else 'NULL'})""",
            [world.project_id, cid, gtype, guser, gorg, actions, u["des_admin"]]
            + ([u["des_admin"]] if revoked != "NULL" else []))
    owner_conn.commit()
    try:
        assert _equivalence(app_conn, world) == []
    finally:
        owner_conn.execute("DELETE FROM cde.access_grants")
        owner_conn.commit()


# ---------------------------------------------------------------------
# Benchmark 100k documenti
# ---------------------------------------------------------------------
N_DOCS = 100_000


@pytest.fixture(scope="module")
def perf_db():
    superuser = os.environ.get("CDE_TEST_SUPERUSER_URI") or dbadmin.start_embedded(
        Path(tempfile.gettempdir()) / "cde_pg_tests")
    urls = dbadmin.bootstrap(superuser, "cde_perf", PASSWORDS, recreate=True)
    dbadmin.migrate(urls.owner)
    world = demo_seed.seed(urls.owner)
    with psycopg.connect(urls.owner) as conn:
        # 60% al progettista (metà già condivisi), 40% al subappaltatore; 1 revisione per documento
        conn.execute("""
            WITH src AS (
              SELECT g, CASE WHEN g %% 5 < 3 THEN 'DES' ELSE 'SUB1' END AS org FROM generate_series(1, %(n)s) g
            ), ins_files AS (
              INSERT INTO cde.file_objects (id, project_id, storage_key, size_bytes, content_type, sha256,
                                            sha256_verified, scan_status, uploaded_by)
              SELECT md5('f' || g)::uuid, %(p)s, 'perf/' || g, 1000, 'application/pdf', sha256(g::text::bytea),
                     true, 'CLEAN', CASE org WHEN 'DES' THEN %(des_user)s ELSE %(sub_user)s END::uuid FROM src
              RETURNING id
            )
            INSERT INTO cde.documents (id, project_id, container_id, identifier, originator_organization_id, title,
                                       created_by)
            SELECT md5('d' || g)::uuid, %(p)s, CASE org WHEN 'DES' THEN %(des_c)s ELSE %(sub_c)s END::uuid,
                   'PRJ01-' || org || '-ZZ-01-DR-A-' || lpad(g::text, 6, '0'),
                   CASE org WHEN 'DES' THEN %(des_o)s ELSE %(sub_o)s END::uuid,
                   'Tavola numero ' || g, CASE org WHEN 'DES' THEN %(des_user)s ELSE %(sub_user)s END::uuid
            FROM src""",
            {"n": N_DOCS, "p": world.project_id, "des_c": world.containers["des_arch"],
             "sub_c": world.containers["sub1_root"], "des_o": world.orgs["DES"], "sub_o": world.orgs["SUB1"],
             "des_user": world.users["des_lead"], "sub_user": world.users["sub1_user"]})
        conn.execute("ALTER TABLE cde.document_revisions DISABLE TRIGGER trg_revisions_check")
        conn.execute("""
            INSERT INTO cde.document_revisions (document_id, project_id, sequence, revision_code, suitability, state,
                   file_object_id, original_filename, created_by, container_id, originator_organization_id, derived_from)
            SELECT d.id, d.project_id, 1, 'P01.01', 'S0', 'WIP', md5('f' || right(d.identifier, 6)::int)::uuid,
                   d.identifier || '.pdf', d.created_by, d.container_id, d.originator_organization_id, NULL
            FROM cde.documents d WHERE d.identifier LIKE 'PRJ01-%%-ZZ-01-DR-A-%%'""")
        conn.execute("""
            INSERT INTO cde.document_revisions (document_id, project_id, sequence, revision_code, suitability, state,
                   file_object_id, original_filename, created_by, container_id, originator_organization_id, derived_from)
            SELECT r.document_id, r.project_id, 2, 'P01', 'S2', 'SHARED', r.file_object_id, r.original_filename,
                   r.created_by, r.container_id, r.originator_organization_id, r.id
            FROM cde.document_revisions r JOIN cde.documents d ON d.id = r.document_id
            WHERE d.originator_organization_id = %s AND right(d.identifier, 6)::int %% 2 = 0""",
            [world.orgs["DES"]])
        conn.execute("ALTER TABLE cde.document_revisions ENABLE TRIGGER trg_revisions_check")
        conn.execute("ANALYZE")
    return urls, world


@pytest.mark.skipif(not os.environ.get("CDE_PERF"), reason="benchmark opt-in: CDE_PERF=1")
@pytest.mark.parametrize("user, area", [("com_admin", None), ("com_admin", "SHARED"), ("des_lead", None),
                                        ("sub1_user", None), ("sub2_user", None), ("des_lead", "WIP")])
def test_lista_documenti_sotto_200ms_su_100k(perf_db, user, area):
    urls, world = perf_db
    where = "d.project_id = %(p)s" + (" AND d.archived_at IS NULL AND lr.state = %(a)s" if area else "")
    sql = DOCUMENT_SQL + " WHERE " + where + " ORDER BY d.identifier LIMIT 51"
    timings = []
    with psycopg.connect(urls.app, row_factory=dict_row) as conn:
        for _ in range(5):
            with conn.transaction():
                act_as(conn, world.users[user])
                t = time.perf_counter()
                rows = conn.execute(sql, {"p": world.project_id, "a": area}).fetchall()
                timings.append((time.perf_counter() - t) * 1000)
    median = statistics.median(timings[1:])
    print(f"\n{user:<10} area={area or 'tutte':<7} righe={len(rows):<3} mediana={median:.1f} ms")
    assert median < 200, f"{user}: {median:.0f} ms"


def _timed(urls, world, user, sql, params, runs=4):
    timings = []
    with psycopg.connect(urls.app, row_factory=dict_row) as conn:
        for _ in range(runs):
            with conn.transaction():
                act_as(conn, world.users[user])
                t = time.perf_counter()
                rows = conn.execute(sql, params).fetchall()
                timings.append((time.perf_counter() - t) * 1000)
    return statistics.median(timings[1:]), rows


@pytest.mark.skipif(not os.environ.get("CDE_PERF"), reason="benchmark opt-in: CDE_PERF=1")
@pytest.mark.parametrize("org, discipline", [(None, None), ("DES", None), (None, "A")])
def test_cruscotto_sotto_1s_su_100k(perf_db, org, discipline):
    urls, world = perf_db
    median, rows = _timed(urls, world, "com_admin", "SELECT cde.project_dashboard(%s, %s, %s) AS d",
                          [world.project_id, world.orgs[org] if org else None, discipline])
    total = rows[0]["d"]["documents"]["total"]
    print(f"\ncruscotto org={org or 'tutte'} disciplina={discipline or 'tutte'} documenti={total} mediana={median:.0f} ms")
    assert (total > 0 or discipline) and median < 1000, f"{median:.0f} ms"


@pytest.mark.skipif(not os.environ.get("CDE_PERF"), reason="benchmark opt-in: CDE_PERF=1")
def test_report_documenti_rispetta_rls_e_tetto(perf_db):
    from cde_api.modules.reports import MAX_ROWS, _documents

    urls, world = perf_db
    # committente: solo i 30.000 condivisi (il WIP altrui non c'è); progettista: 60.000, tagliati al tetto
    for user, expected in (("com_admin", 30_000), ("des_lead", MAX_ROWS + 1)):
        with psycopg.connect(urls.app, row_factory=dict_row) as conn, conn.transaction():
            act_as(conn, world.users[user])
            t = time.perf_counter()
            _, rows = _documents(conn, world.project_id)
            ms = (time.perf_counter() - t) * 1000
        print(f"\nreport documenti {user}: {len(rows)} righe in {ms:.0f} ms")
        assert len(rows) == expected and ms < 10_000


@pytest.mark.skipif(not os.environ.get("CDE_PERF"), reason="benchmark opt-in: CDE_PERF=1")
def test_file_excel_50k_righe_sotto_20s(perf_db):
    import io

    from openpyxl import Workbook

    from cde_api.modules.reports import MAX_ROWS, _documents, _info, _sheet

    urls, world = perf_db
    with psycopg.connect(urls.app, row_factory=dict_row) as conn, conn.transaction():
        act_as(conn, world.users["des_lead"])
        t = time.perf_counter()
        cols, rows = _documents(conn, world.project_id)
    rows = rows[:MAX_ROWS]
    wb = Workbook(write_only=True)
    _info(wb, {"code": "PRJ01", "name": "Perf"}, "Registro documenti", "des_lead", len(rows), True)
    _sheet(wb, "Registro documenti", cols, rows)
    buf = io.BytesIO()
    wb.save(buf)
    s = time.perf_counter() - t
    print(f"\nexcel registro documenti: {len(rows)} righe, {len(buf.getvalue()) / 1e6:.1f} MB in {s:.1f} s")
    assert s < 20
