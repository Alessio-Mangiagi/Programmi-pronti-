# "><(((º> sabusabu <º)))><"
"""Sprint 3: stati del CDE, visibilità per stato, transizioni, ricodifica, archiviazione, bulk (G29)."""
from __future__ import annotations

import psycopg
import pytest
from test_api_documents import PDF, des_name, upload


@pytest.fixture
def as_user(client, api_world):
    from cde_api.tooling.demo_seed import DEMO_PASSWORD

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


@pytest.fixture
def worker(api_app, api_world):
    from psycopg.rows import dict_row

    from cde_api.scanner import EicarScanner
    from cde_api.worker import verify_file

    urls, _ = api_world

    def run():
        with psycopg.connect(urls.worker, row_factory=dict_row) as conn:
            ids = [r["id"] for r in conn.execute("SELECT id FROM cde.file_objects WHERE scan_status = 'PENDING'")]
            conn.commit()
            for fid in ids:
                verify_file(conn, api_app.state.services.storage, EicarScanner(), fid)
    return run


def transition(client, headers, revision_id, to_state, suitability=None, reason=None):
    return client.post(f"/revisions/{revision_id}/transitions", headers=headers,
                       json={"to_state": to_state, "suitability": suitability, "reason": reason})


@pytest.fixture
def wip(client, api_world, as_user, worker):
    """Documento DES in WIP (P01.01), file verificato."""
    _, w = api_world
    rev = upload(client, as_user("des_lead"), w.containers["des_arch"], des_name(), PDF, title="Prospetto").json()
    worker()
    return rev


def visible(client, headers, document_id) -> bool:
    r = client.get(f"/documents/{document_id}", headers=headers)
    assert r.status_code in (200, 404), r.text
    return r.status_code == 200


# ---------------------------------------------------------------------
# Matrice di visibilità stato × utente
# ---------------------------------------------------------------------
USERS = ["des_lead", "des_designer", "des_viewer", "des_admin", "com_admin", "com_im", "com_dl",
         "gc_admin", "sub1_user", "sub2_user", "out_user"]
EXPECTED_VISIBLE = {
    # WIP: solo l'organizzazione autrice, anche contro scope PROJECT (com_admin, com_im)
    "WIP": {"des_lead", "des_designer", "des_viewer", "des_admin"},
    # SHARED: chi ha READ sul container (scope PROJECT o propria org)
    "SHARED": {"des_lead", "des_designer", "des_viewer", "des_admin", "com_admin", "com_im"},
    # PUBLISHED: tutti i membri del progetto
    "PUBLISHED": set(USERS) - {"out_user"},
}


@pytest.mark.parametrize("state", ["WIP", "SHARED", "PUBLISHED"])
@pytest.mark.parametrize("user", USERS)
def test_visibilita_per_stato(client, as_user, wip, state, user):
    rev = wip
    if state in ("SHARED", "PUBLISHED"):
        rev = transition(client, as_user("des_lead"), rev["id"], "SHARED", "S2").json()
    if state == "PUBLISHED":
        rev = transition(client, as_user("des_lead"), rev["id"], "PUBLISHED", "A1", "Approvato in riunione").json()
    assert visible(client, as_user(user), wip["document_id"]) == (user in EXPECTED_VISIBLE[state])


CAN_DOWNLOAD = {
    "WIP": {"des_lead", "des_designer", "des_admin"},
    "SHARED": {"des_lead", "des_designer", "des_admin", "com_admin", "com_im"},
    "PUBLISHED": set(USERS) - {"out_user", "des_viewer"},
}


@pytest.mark.parametrize("state", ["WIP", "SHARED", "PUBLISHED"])
@pytest.mark.parametrize("user", USERS)
def test_download_per_stato(client, as_user, wip, state, user):
    rev = wip
    if state in ("SHARED", "PUBLISHED"):
        rev = transition(client, as_user("des_lead"), rev["id"], "SHARED", "S2").json()
    if state == "PUBLISHED":
        rev = transition(client, as_user("des_lead"), rev["id"], "PUBLISHED", "A1", "ok").json()
    expected = 200 if user in CAN_DOWNLOAD[state] else 403 if user in EXPECTED_VISIBLE[state] else 404
    assert client.get(f"/revisions/{rev['id']}/download", headers=as_user(user)).status_code == expected


def test_dopo_condivisione_il_wip_resta_privato(client, api_world, as_user, wip):
    shared = transition(client, as_user("des_lead"), wip["id"], "SHARED", "S3").json()
    doc = client.get(f"/documents/{wip['document_id']}", headers=as_user("com_admin")).json()
    assert [r["revision_code"] for r in doc["revisions"]] == ["P01"]          # P01.01 (WIP) invisibile
    own = client.get(f"/documents/{wip['document_id']}", headers=as_user("des_lead")).json()
    assert [(r["revision_code"], r["state"]) for r in own["revisions"]] == [("P01", "SHARED"), ("P01.01", "WIP")]
    assert shared["derived_from"] == wip["id"] and shared["sha256"] == wip["sha256"]


def test_grant_rende_visibile_lo_shared_non_il_wip(client, api_world, as_user, wip):
    _, w = api_world
    g = client.post(f"/containers/{w.containers['des_arch']}/grants", headers=as_user("des_admin"),
                    json={"grantee_type": "ORGANIZATION", "grantee_organization_id": str(w.orgs["SUB1"]),
                          "actions": ["READ"], "reason": "coordinamento impianti"}).json()
    try:
        assert not visible(client, as_user("sub1_user"), wip["document_id"])
        transition(client, as_user("des_lead"), wip["id"], "SHARED", "S1")
        assert visible(client, as_user("sub1_user"), wip["document_id"])
    finally:
        client.delete(f"/containers/{w.containers['des_arch']}/grants/{g['id']}", headers=as_user("des_admin"))


# ---------------------------------------------------------------------
# Permessi e regole delle transizioni
# ---------------------------------------------------------------------
def test_condivisione_richiede_approve_dell_org_autrice(client, as_user, wip):
    assert transition(client, as_user("des_designer"), wip["id"], "SHARED", "S2").status_code == 403
    assert transition(client, as_user("com_admin"), wip["id"], "SHARED", "S2").status_code == 404  # WIP invisibile
    r = transition(client, as_user("des_lead"), wip["id"], "SHARED", "S2")
    assert r.status_code == 201 and r.json()["revision_code"] == "P01" and r.json()["state"] == "SHARED"


@pytest.mark.parametrize("to_state, suitability", [("SHARED", "A1"), ("SHARED", None), ("PUBLISHED", "A1")])
def test_idoneita_e_salti_non_ammessi(client, as_user, wip, to_state, suitability):
    r = transition(client, as_user("des_lead"), wip["id"], to_state, suitability, "motivo")
    assert r.status_code == 422


def test_pubblicazione_richiede_motivazione(client, as_user, wip):
    shared = transition(client, as_user("des_lead"), wip["id"], "SHARED", "S4").json()
    r = transition(client, as_user("des_lead"), shared["id"], "PUBLISHED", "A1")
    assert r.status_code == 422 and "Motivazione" in r.json()["error"]["message"]
    r = transition(client, as_user("des_lead"), shared["id"], "PUBLISHED", "A1", "Accettato dal committente")
    assert r.status_code == 201 and r.json()["revision_code"] == "C01" and r.json()["suitability"] == "A1"


def test_dl_pubblica_tramite_grant_approve(client, api_world, as_user, wip):
    _, w = api_world
    shared = transition(client, as_user("des_lead"), wip["id"], "SHARED", "S4").json()
    assert transition(client, as_user("com_dl"), shared["id"], "PUBLISHED", "A2", "ok").status_code == 404
    g = client.post(f"/containers/{w.containers['des_arch']}/grants", headers=as_user("des_admin"),
                    json={"grantee_type": "USER", "grantee_user_id": str(w.users["com_dl"]),
                          "actions": ["READ", "APPROVE"], "reason": "Approvazione DL"}).json()
    try:
        r = transition(client, as_user("com_dl"), shared["id"], "PUBLISHED", "A2", "Visto, si approva")
        assert r.status_code == 201, r.text
        assert r.json()["created_by_name"].startswith("Com")
    finally:
        client.delete(f"/containers/{w.containers['des_arch']}/grants/{g['id']}", headers=as_user("des_admin"))


def test_ciclo_completo_ricodifica(client, api_world, as_user, wip, worker):
    _, w = api_world
    h = as_user("des_lead")
    p01 = transition(client, h, wip["id"], "SHARED", "S2").json()
    assert transition(client, h, wip["id"], "SHARED", "S2").status_code == 422          # già condivisa
    c01 = transition(client, h, p01["id"], "PUBLISHED", "A1", "Fase 1").json()
    assert c01["revision_code"] == "C01"
    name = f"{client.get(f'/documents/{wip['document_id']}', headers=h).json()['identifier']}.pdf"
    nxt = upload(client, h, w.containers["des_arch"], name, PDF + b"v2").json()
    assert nxt["revision_code"] == "P02.01"                                              # nuova serie preliminare
    worker()
    p02 = transition(client, h, nxt["id"], "SHARED", "S3").json()
    assert p02["revision_code"] == "P02"
    c02 = transition(client, h, p02["id"], "PUBLISHED", "B1", "Approvato con commenti").json()
    assert c02["revision_code"] == "C02" and c02["suitability"] == "B1"
    history = client.get(f"/documents/{wip['document_id']}/history", headers=h).json()
    assert [(e["from_revision"], e["to_revision"]) for e in history] == [
        ("P01.01", "P01"), ("P01", "C01"), ("P02.01", "P02"), ("P02", "C02")]


def test_solo_l_ultima_wip_si_condivide(client, api_world, as_user, wip, worker):
    _, w = api_world
    h = as_user("des_lead")
    doc = client.get(f"/documents/{wip['document_id']}", headers=h).json()
    upload(client, h, w.containers["des_arch"], f"{doc['identifier']}.pdf", PDF + b"newer")
    worker()
    r = transition(client, h, wip["id"], "SHARED", "S2")
    assert r.status_code == 422 and "più recente" in r.json()["error"]["message"]


def test_file_non_verificato_non_si_condivide(client, api_world, as_user):
    _, w = api_world
    h = as_user("des_lead")
    rev = upload(client, h, w.containers["des_arch"], des_name(), PDF).json()     # nessun worker: PENDING
    r = transition(client, h, rev["id"], "SHARED", "S2")
    assert r.status_code == 422 and "verifiche" in r.json()["error"]["message"]


def test_regola_di_progetto_sostituisce_il_default(client, api_world, as_user, wip):
    urls, w = api_world
    with psycopg.connect(urls.owner, autocommit=True) as conn:
        conn.execute("""INSERT INTO cde.state_transitions (project_id, from_state, to_state, required_action,
                            originator_only, allowed_suitability) VALUES (%s, 'WIP', 'SHARED', 'ADMIN', true, '{S1}')""",
                     [w.project_id])
    try:
        rules = client.get(f"/projects/{w.project_id}/state-transitions", headers=as_user("des_lead")).json()
        rule = next(r for r in rules if r["from_state"] == "WIP")
        assert rule["required_action"] == "ADMIN" and rule["project_specific"]
        assert transition(client, as_user("des_lead"), wip["id"], "SHARED", "S1").status_code == 403
        assert transition(client, as_user("des_admin"), wip["id"], "SHARED", "S2").status_code == 422
        assert transition(client, as_user("des_admin"), wip["id"], "SHARED", "S1").status_code == 201
    finally:
        with psycopg.connect(urls.owner, autocommit=True) as conn:
            conn.execute("DELETE FROM cde.state_transitions WHERE project_id = %s", [w.project_id])


# ---------------------------------------------------------------------
# Archiviazione
# ---------------------------------------------------------------------
def test_archiviazione_sola_lettura(client, api_world, as_user, wip, worker):
    _, w = api_world
    h = as_user("des_lead")
    shared = transition(client, h, wip["id"], "SHARED", "S2").json()
    pub = transition(client, h, shared["id"], "PUBLISHED", "A1", "ok").json()
    assert transition(client, h, pub["id"], "ARCHIVED", reason="superato").status_code == 403    # serve ADMIN
    assert transition(client, as_user("des_admin"), pub["id"], "ARCHIVED").status_code == 422   # motivazione
    assert transition(client, as_user("des_admin"), pub["id"], "ARCHIVED", reason="Superato da variante").status_code == 201

    doc = client.get(f"/documents/{wip['document_id']}", headers=h).json()
    assert doc["archived_at"] and doc["archive_reason"] == "Superato da variante"
    assert visible(client, as_user("sub1_user"), wip["document_id"])                         # resta consultabile
    r = upload(client, h, w.containers["des_arch"], f"{doc['identifier']}.pdf", PDF, complete=False)
    assert r.status_code == 409 and r.json()["error"]["code"] == "archived"
    assert client.patch(f"/documents/{wip['document_id']}", headers=h, json={"title": "x2"}).status_code == 403
    assert transition(client, h, wip["id"], "SHARED", "S2").status_code == 422
    archived = client.get(f"/projects/{w.project_id}/documents", headers=h, params={"area": "ARCHIVED"}).json()
    assert wip["document_id"] in {d["id"] for d in archived["items"]}


# ---------------------------------------------------------------------
# Aree CDE, download, bulk
# ---------------------------------------------------------------------
def test_viste_per_area(client, api_world, as_user, wip, worker):
    _, w = api_world
    h = as_user("des_lead")
    area = lambda a: {d["id"] for d in client.get(f"/projects/{w.project_id}/documents", headers=h,  # noqa: E731
                                                    params={"area": a, "limit": 200}).json()["items"]}
    assert wip["document_id"] in area("WIP")
    shared = transition(client, h, wip["id"], "SHARED", "S2").json()
    assert wip["document_id"] in area("SHARED") and wip["document_id"] not in area("WIP")
    transition(client, h, shared["id"], "PUBLISHED", "A1", "ok")
    assert wip["document_id"] in area("PUBLISHED")


def test_download_pubblicato_per_tutti_con_download(client, as_user, wip):
    h = as_user("des_lead")
    shared = transition(client, h, wip["id"], "SHARED", "S2").json()
    pub = transition(client, h, shared["id"], "PUBLISHED", "A1", "ok").json()
    assert client.get(f"/revisions/{pub['id']}/download", headers=as_user("sub1_user")).status_code == 200
    assert client.get(f"/revisions/{pub['id']}/download", headers=as_user("sub1_viewer")).status_code == 403
    # la WIP originaria resta invisibile al subappaltatore anche dopo la pubblicazione
    assert client.get(f"/revisions/{wip['id']}/download", headers=as_user("sub1_user")).status_code == 404


def test_transizione_massiva_con_esito_per_elemento(client, api_world, as_user, worker):
    _, w = api_world
    h = as_user("des_lead")
    revs = [upload(client, h, w.containers["des_arch"], des_name(), PDF).json() for _ in range(3)]
    worker()
    already = transition(client, h, revs[2]["id"], "SHARED", "S2").json()
    hidden = upload(client, as_user("sub1_user"), w.containers["sub1_root"],
                    f"PRJ01-SUB1-ZZ-01-DR-E-{des_name()[-9:-4]}.pdf", PDF, title="Altrui").json()
    r = client.post(f"/projects/{w.project_id}/transitions/bulk", headers=h,
                    json={"revision_ids": [revs[0]["id"], revs[1]["id"], revs[2]["id"], hidden["id"]],
                          "to_state": "SHARED", "suitability": "S1"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["succeeded"] == 2 and body["failed"] == 2
    by_id = {x["revision_id"]: x for x in body["results"]}
    assert by_id[revs[0]["id"]]["revision_code"] == "P01"
    assert by_id[revs[2]["id"]]["status"] == 422            # già condivisa
    assert by_id[hidden["id"]]["status"] == 404             # di un'altra org: non esiste per me
    assert already["revision_code"] == "P01"


# ---------------------------------------------------------------------
# Database: integrità
# ---------------------------------------------------------------------
def test_api_non_inserisce_revisioni_shared_direttamente(api_world, wip):
    urls, w = api_world
    with psycopg.connect(urls.app) as conn:
        conn.execute("SELECT set_config('app.user_id', %s, true)", [str(w.users["des_lead"])])
        fid = conn.execute("SELECT file_object_id FROM cde.document_revisions WHERE id = %s", [wip["id"]]).fetchone()[0]
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute(
                """INSERT INTO cde.document_revisions (document_id, project_id, sequence, revision_code, suitability,
                       state, file_object_id, original_filename, created_by, derived_from)
                   VALUES (%s, %s, 2, 'P01', 'S2', 'SHARED', %s, 'x.pdf', %s, %s)""",
                [wip["document_id"], w.project_id, fid, w.users["des_lead"], wip["id"]])


def test_transizione_accoda_evento(client, api_world, as_user, wip):
    urls, _ = api_world
    new = transition(client, as_user("des_lead"), wip["id"], "SHARED", "S2").json()
    with psycopg.connect(urls.owner) as conn:
        n = conn.execute("SELECT count(*) FROM jobs.procrastinate_jobs WHERE task_name = 'cde.notify_state_changed' "
                         "AND args->>'revision_id' = %s", [new["id"]]).fetchone()[0]
    assert n == 1


def test_storico_stati_append_only(api_world, client, as_user, wip):
    urls, _ = api_world
    transition(client, as_user("des_lead"), wip["id"], "SHARED", "S2")
    with psycopg.connect(urls.owner) as conn, pytest.raises(psycopg.Error):
        conn.execute("DELETE FROM cde.state_change_log")
