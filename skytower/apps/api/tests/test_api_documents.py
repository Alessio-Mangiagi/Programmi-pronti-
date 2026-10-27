# "><(((º> sabusabu <º)))><"
"""Sprint 2: naming ISO 19650, upload multipart presigned su S3 (moto), revisioni immutabili,
verifica post-upload (SHA-256 + antivirus), download, metadati, ricerca, isolamento."""
from __future__ import annotations

import base64
import hashlib
import itertools
import os
import uuid

import httpx
import psycopg
import pytest
from psycopg import errors
from psycopg.rows import dict_row

from cde_api.scanner import EICAR, EicarScanner
from cde_api.tooling.demo_seed import DEMO_PASSWORD
from cde_api.worker import verify_file

# progressivo univoco nella sessione (base casuale: il DB di test è condiviso tra i moduli)
_counter = itertools.count(int.from_bytes(os.urandom(2)) * 10 + 10000)


def new_number() -> str:
    return f"{next(_counter):06d}"


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


@pytest.fixture
def worker(api_app, api_world):
    urls, _ = api_world

    def run() -> list:
        outcomes = []
        with psycopg.connect(urls.worker, row_factory=dict_row) as conn:
            pending = [r["id"] for r in conn.execute(
                "SELECT id FROM cde.file_objects WHERE scan_status = 'PENDING'").fetchall()]
            conn.commit()
            for fid in pending:
                outcomes.append(verify_file(conn, api_app.state.services.storage, EicarScanner(), fid))
        return outcomes
    return run


def put_parts(client, headers, upload, data: bytes, only: list[int] | None = None):
    size = upload["part_size"]
    chunks = {i + 1: data[i * size:(i + 1) * size] for i in range(upload["part_count"])}
    wanted = only or list(chunks)
    req = [{"part_number": n, "checksum_sha256": base64.b64encode(hashlib.sha256(chunks[n]).digest()).decode()}
           for n in wanted]
    r = client.post(f"/uploads/{upload['upload_id']}/parts", headers=headers, json={"parts": req})
    assert r.status_code == 200, r.text
    with httpx.Client() as s3:
        for p in r.json()["parts"]:
            res = s3.put(p["url"], content=chunks[p["part_number"]], headers=p["headers"])
            assert res.status_code == 200, res.text


def upload(client, headers, container_id, filename, data: bytes, *, title="Tavola", expected=None,
           declared_sha=None, attributes=None, complete=True):
    body = {"container_id": str(container_id), "filename": filename, "size_bytes": len(data),
            "sha256": declared_sha or hashlib.sha256(data).hexdigest(), "content_type": "application/pdf",
            "title": title, "attributes": attributes or {}}
    if expected is not None:
        body["expected_revision"] = expected
    r = client.post("/uploads/initiate", headers=headers, json=body)
    if r.status_code != 201 or not complete:
        return r
    up = r.json()
    put_parts(client, headers, up, data)
    return client.post(f"/uploads/{up['upload_id']}/complete", headers=headers)


def des_name(number: str | None = None, ext="pdf") -> str:
    return f"PRJ01-DES-ZZ-01-DR-A-{number or new_number()}.{ext}"


PDF = b"%PDF-1.7\n" + os.urandom(2048)


# ---------------------------------------------------------------------
# Naming
# ---------------------------------------------------------------------
def test_validazione_nome_in_tempo_reale(client, api_world, as_user):
    _, w = api_world
    h = as_user("des_lead")
    ok = client.post(f"/projects/{w.project_id}/naming/validate", headers=h, json={"name": des_name("0001")}).json()
    assert ok["valid"] and ok["next_revision"] == "P01.01" and ok["existing_document_id"] is None
    bad = client.post(f"/projects/{w.project_id}/naming/validate", headers=h,
                      json={"name": "PRJ01-SUB1-ZZ-01-DX-A-0001.pdf"}).json()
    fields = {e["field"]: e for e in bad["errors"]}
    assert not bad["valid"] and set(fields) == {"originator", "type"}
    assert fields["originator"]["suggestions"] == ["DES"]       # solo la propria organizzazione
    assert "DR" in fields["type"]["suggestions"]


def test_impostazioni_documentali_default(client, api_world, as_user):
    _, w = api_world
    s = client.get(f"/projects/{w.project_id}/document-settings", headers=as_user("des_lead")).json()
    assert not s["custom_naming"] and s["example"].startswith("PRJ01-")
    originator = next(f for f in s["naming_scheme"]["fields"] if f["key"] == "originator")
    assert set(originator["codes"]) == {"COM", "DES", "GCO", "SUB1", "SUB2"}


# ---------------------------------------------------------------------
# Upload, verifica, download, revisioni
# ---------------------------------------------------------------------
def test_upload_verifica_download_e_revisione_successiva(client, api_world, as_user, worker):
    _, w = api_world
    h = as_user("des_lead")
    name = des_name()
    r = upload(client, h, w.containers["des_arch"], name, PDF, title="Pianta piano primo")
    assert r.status_code == 200, r.text
    rev1 = r.json()
    assert rev1["revision_code"] == "P01.01" and rev1["suitability"] == "S0" and rev1["scan_status"] == "PENDING"

    assert client.get(f"/revisions/{rev1['id']}/download", headers=h).status_code == 409   # scansione in corso
    outcomes = worker()
    assert any(o and o.status == "CLEAN" for o in outcomes)
    d = client.get(f"/revisions/{rev1['id']}/download", headers=h)
    assert d.status_code == 200, d.text
    assert httpx.get(d.json()["url"]).content == PDF

    # stesso identificativo ⇒ P01.02, storico intatto
    v2 = PDF + b"rev2"
    r2 = upload(client, h, w.containers["des_arch"], name, v2, expected="P01.01")
    assert r2.status_code == 200, r2.text
    assert r2.json()["revision_code"] == "P01.02"
    doc = client.get(f"/documents/{rev1['document_id']}", headers=h).json()
    assert [x["revision_code"] for x in doc["revisions"]] == ["P01.02", "P01.01"]
    assert doc["revisions"][1]["sha256"] == hashlib.sha256(PDF).hexdigest()
    assert doc["title"] == "Pianta piano primo" and doc["current_revision"] == "P01.02"


def test_lock_ottimistico_revisione(client, api_world, as_user):
    _, w = api_world
    h = as_user("des_lead")
    name = des_name()
    assert upload(client, h, w.containers["des_arch"], name, PDF).status_code == 200
    stale = upload(client, h, w.containers["des_arch"], name, PDF, expected=None, complete=False)
    # due sessioni concorrenti che si aspettano entrambe P01.01 come ultima
    a = upload(client, h, w.containers["des_arch"], name, PDF + b"a", expected="P01.01", complete=False).json()
    b = upload(client, h, w.containers["des_arch"], name, PDF + b"b", expected="P01.01", complete=False).json()
    put_parts(client, h, a, PDF + b"a")
    put_parts(client, h, b, PDF + b"b")
    assert client.post(f"/uploads/{a['upload_id']}/complete", headers=h).status_code == 200
    second = client.post(f"/uploads/{b['upload_id']}/complete", headers=h)
    assert second.status_code == 409 and second.json()["error"]["code"] == "revision_conflict"
    assert stale.status_code == 201   # senza expected_revision si accetta l'ultima corrente
    wrong = upload(client, h, w.containers["des_arch"], name, PDF, expected="P01.01", complete=False)
    assert wrong.status_code == 409


def test_upload_multiparte_con_ripresa(client, api_world, as_user):
    _, w = api_world
    h = as_user("des_designer")
    data = os.urandom(11 * 1024 * 1024)      # 3 parti da 5 MB (minimo S3)
    body = {"container_id": str(w.containers["des_arch"]), "filename": des_name(ext="ifc"), "size_bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(), "content_type": "application/x-step", "title": "Modello"}
    up = client.post("/uploads/initiate", headers=h, json=body).json()
    assert up["part_count"] == 3
    put_parts(client, h, up, data, only=[1])
    incomplete = client.post(f"/uploads/{up['upload_id']}/complete", headers=h)
    assert incomplete.status_code == 409 and "[2, 3]" in incomplete.json()["error"]["message"]
    state = client.get(f"/uploads/{up['upload_id']}", headers=h).json()       # ripresa dopo interruzione
    assert [p["part_number"] for p in state["uploaded_parts"]] == [1]
    put_parts(client, h, up, data, only=[2, 3])
    done = client.post(f"/uploads/{up['upload_id']}/complete", headers=h)
    assert done.status_code == 200, done.text
    assert done.json()["size_bytes"] == len(data)
    assert client.post(f"/uploads/{up['upload_id']}/complete", headers=h).status_code == 409   # già chiusa


def test_abort_upload(client, api_world, as_user):
    _, w = api_world
    h = as_user("des_lead")
    up = upload(client, h, w.containers["des_arch"], des_name(), PDF, complete=False).json()
    assert client.post(f"/uploads/{up['upload_id']}/abort", headers=h).status_code == 204
    assert client.get(f"/uploads/{up['upload_id']}", headers=h).json()["status"] == "ABORTED"


def test_sessione_upload_di_altri_invisibile(client, api_world, as_user):
    _, w = api_world
    up = upload(client, as_user("des_lead"), w.containers["des_arch"], des_name(), PDF, complete=False).json()
    assert client.get(f"/uploads/{up['upload_id']}", headers=as_user("des_designer")).status_code == 404
    assert client.post(f"/uploads/{up['upload_id']}/complete", headers=as_user("des_designer")).status_code == 404


def test_visualizzazione_in_piattaforma(client, api_world, as_user, worker):
    _, w = api_world
    h = as_user("des_lead")
    rev = upload(client, h, w.containers["des_arch"], des_name(), PDF, title="Da leggere").json()
    worker()
    r = client.get(f"/revisions/{rev['id']}/download", headers=h, params={"disposition": "inline"})
    assert r.status_code == 200, r.text
    assert r.json()["content_type"] == "application/pdf"
    shown = httpx.get(r.json()["url"])
    assert shown.content == PDF and shown.headers["content-disposition"].startswith("inline")
    assert shown.headers["content-type"] == "application/pdf"
    # un formato che il browser non mostra si scarica e basta
    dwg = upload(client, h, w.containers["des_arch"], des_name(ext="dwg"), b"AC1032" + os.urandom(512)).json()
    worker()
    assert client.get(f"/revisions/{dwg['id']}/download", headers=h, params={"disposition": "inline"}).status_code == 415
    assert client.get(f"/revisions/{dwg['id']}/download", headers=h).status_code == 200
    # il modello IFC lo legge il viewer 3D del browser
    ifc = upload(client, h, w.containers["des_arch"], des_name(ext="ifc"), b"ISO-10303-21;\nHEADER;\n" + os.urandom(256)).json()
    worker()
    r = client.get(f"/revisions/{ifc['id']}/download", headers=h, params={"disposition": "inline"})
    assert r.status_code == 200 and r.json()["content_type"] == "application/x-step"
    # chi non può scaricare non può nemmeno vedere
    assert client.get(f"/revisions/{rev['id']}/download", headers=as_user("sub1_user"),
                      params={"disposition": "inline"}).status_code == 404
    with psycopg.connect(api_world[0].owner) as conn:
        assert conn.execute("SELECT count(*) FROM cde.security_events WHERE event_type = 'REVISION_VIEWED' "
                            "AND details->>'revision' = %s", [rev["id"]]).fetchone()[0] == 1


# ---------------------------------------------------------------------
# Quarantena
# ---------------------------------------------------------------------
def test_file_infetto_in_quarantena(client, api_world, as_user, worker):
    urls, w = api_world
    h = as_user("des_lead")
    infected = b"%PDF-1.4\n" + EICAR + b"\n"
    rev = upload(client, h, w.containers["des_arch"], des_name(), infected).json()
    outcomes = [o for o in worker() if o]
    assert any(o.status == "INFECTED" for o in outcomes)
    r = client.get(f"/revisions/{rev['id']}/download", headers=h)
    assert r.status_code == 423
    with psycopg.connect(urls.owner) as conn:
        n = conn.execute("SELECT count(*) FROM cde.security_events WHERE event_type = 'FILE_QUARANTINED'").fetchone()[0]
        key, version = conn.execute(
            "SELECT f.storage_key, f.storage_version_id FROM cde.file_objects f JOIN cde.document_revisions r "
            "ON r.file_object_id = f.id WHERE r.id = %s", [rev["id"]]).fetchone()
    assert n >= 1
    tags = client.app.state.services.storage.client.get_object_tagging(
        Bucket="cde-test-documents", Key=key, **({"VersionId": version} if version else {}))["TagSet"]
    assert {"Key": "cde-quarantine", "Value": "infected"} in tags


def test_hash_dichiarato_errato_blocca_il_file(client, api_world, as_user, worker):
    _, w = api_world
    h = as_user("des_lead")
    rev = upload(client, h, w.containers["des_arch"], des_name(), PDF, declared_sha="0" * 64).json()
    assert any(o and o.status == "ERROR" for o in worker())
    assert client.get(f"/revisions/{rev['id']}/download", headers=h).status_code == 423


def test_worker_idempotente(client, api_world, as_user, worker):
    _, w = api_world
    upload(client, as_user("des_lead"), w.containers["des_arch"], des_name(), PDF)
    worker()
    assert worker() == []


# ---------------------------------------------------------------------
# Nomi e regole di caricamento
# ---------------------------------------------------------------------
@pytest.mark.parametrize("filename", [
    "pianta.pdf", "PRJ01-DES-ZZ-01-DR-A.pdf", "PRJ02-DES-ZZ-01-DR-A-0001.pdf", "PRJ01-DES-ZZ-01-QQ-A-0001.pdf",
])
def test_nomi_non_conformi_rifiutati(client, api_world, as_user, filename):
    _, w = api_world
    r = upload(client, as_user("des_lead"), w.containers["des_arch"], filename, PDF, complete=False)
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_name"


def test_originatore_deve_essere_la_propria_organizzazione(client, api_world, as_user):
    _, w = api_world
    r = upload(client, as_user("sub1_user"), w.containers["sub1_root"], des_name(), PDF, complete=False)
    assert r.status_code == 422 and "Originatore" in r.json()["error"]["message"]
    ok = upload(client, as_user("sub1_user"), w.containers["sub1_root"],
                f"PRJ01-SUB1-ZZ-01-SH-E-{new_number()}.xlsx", b"PK" + os.urandom(64), title="Quadri")
    assert ok.status_code == 200, ok.text


def test_identificativo_in_altro_container(client, api_world, as_user):
    _, w = api_world
    h = as_user("des_lead")
    name = des_name()
    assert upload(client, h, w.containers["des_arch"], name, PDF).status_code == 200
    r = upload(client, h, w.containers["des_root"], name, PDF, complete=False)
    assert r.status_code == 409 and r.json()["error"]["code"] == "wrong_container"


def test_identificativo_occupato_in_container_invisibile(client, api_world, as_user):
    _, w = api_world
    num = new_number()
    assert upload(client, as_user("des_lead"), w.containers["des_private"], des_name(num), PDF).status_code == 200
    # il designer vede des_private (stessa org): costruisco un caso con org diversa e stesso numero
    r = client.post(f"/projects/{w.project_id}/naming/validate", headers=as_user("sub1_user"),
                    json={"name": f"PRJ01-SUB1-ZZ-01-DR-A-{num}.pdf"})
    assert r.json()["existing_document_id"] is None


def test_titolo_obbligatorio_per_nuovo_documento(client, api_world, as_user):
    _, w = api_world
    r = upload(client, as_user("des_lead"), w.containers["des_arch"], des_name(), PDF, title=None, complete=False)
    assert r.status_code == 422


def test_viewer_non_carica(client, api_world, as_user):
    _, w = api_world
    r = upload(client, as_user("des_viewer"), w.containers["des_arch"], des_name(), PDF, complete=False)
    assert r.status_code == 403


# ---------------------------------------------------------------------
# Visibilità e permessi
# ---------------------------------------------------------------------
def test_isolamento_documenti_tra_organizzazioni(client, api_world, as_user, worker):
    _, w = api_world
    rev = upload(client, as_user("des_lead"), w.containers["des_arch"], des_name(), PDF, title="Riservato").json()
    worker()
    h = as_user("sub1_user")
    listing = client.get(f"/projects/{w.project_id}/documents", headers=h).json()
    assert all(d["originator_code"] != "DES" for d in listing["items"])
    assert client.get(f"/documents/{rev['document_id']}", headers=h).status_code == 404
    assert client.get(f"/revisions/{rev['id']}/download", headers=h).status_code == 404


def share(client, headers, revision_id, suitability="S2"):
    r = client.post(f"/revisions/{revision_id}/transitions", headers=headers,
                    json={"to_state": "SHARED", "suitability": suitability})
    assert r.status_code == 201, r.text
    return r.json()


def test_grant_lettura_senza_download(client, api_world, as_user, worker):
    _, w = api_world
    rev = upload(client, as_user("des_lead"), w.containers["des_arch"], des_name(), PDF).json()
    worker()
    rev = share(client, as_user("des_lead"), rev["id"])        # il WIP resta invisibile alle altre org
    g = client.post(f"/containers/{w.containers['des_arch']}/grants", headers=as_user("des_admin"),
                    json={"grantee_type": "ORGANIZATION", "grantee_organization_id": str(w.orgs["SUB1"]),
                          "actions": ["READ"], "reason": "consultazione"}).json()
    try:
        h = as_user("sub1_user")
        assert client.get(f"/documents/{rev['document_id']}", headers=h).status_code == 200
        assert client.get(f"/revisions/{rev['id']}/download", headers=h).status_code == 403
    finally:
        client.delete(f"/containers/{w.containers['des_arch']}/grants/{g['id']}", headers=as_user("des_admin"))


def test_viewer_legge_ma_non_scarica(client, api_world, as_user, worker):
    _, w = api_world
    rev = upload(client, as_user("des_lead"), w.containers["des_arch"], des_name(), PDF).json()
    worker()
    h = as_user("des_viewer")
    assert client.get(f"/documents/{rev['document_id']}", headers=h).status_code == 200
    assert client.get(f"/revisions/{rev['id']}/download", headers=h).status_code == 403


# ---------------------------------------------------------------------
# Metadati e ricerca
# ---------------------------------------------------------------------
def test_schema_metadati_di_progetto(client, api_world, as_user):
    _, w = api_world
    schema = {"type": "object", "required": ["disciplina"],
              "properties": {"disciplina": {"enum": ["ARC", "STR", "MEP"]}, "lotto": {"type": "integer"}}}
    assert client.put(f"/projects/{w.project_id}/document-settings", headers=as_user("des_lead"),
                      json={"metadata_schema": schema}).status_code == 403
    r = client.put(f"/projects/{w.project_id}/document-settings", headers=as_user("com_admin"),
                   json={"metadata_schema": schema})
    assert r.status_code == 200, r.text
    try:
        h = as_user("des_lead")
        bad = upload(client, h, w.containers["des_arch"], des_name(), PDF, complete=False, attributes={"lotto": "uno"})
        assert bad.status_code == 422 and bad.json()["error"]["code"] == "invalid_attributes"
        ok = upload(client, h, w.containers["des_arch"], des_name(), PDF, attributes={"disciplina": "ARC", "lotto": 2})
        assert ok.status_code == 200
        doc_id = ok.json()["document_id"]
        patch = client.patch(f"/documents/{doc_id}", headers=h, json={"attributes": {"disciplina": "XXX"}})
        assert patch.status_code == 422
        patch = client.patch(f"/documents/{doc_id}", headers=h, json={"title": "Pianta aggiornata",
                                                                      "attributes": {"disciplina": "STR"}})
        assert patch.status_code == 200 and patch.json()["attributes"] == {"disciplina": "STR"}
        assert client.put(f"/projects/{w.project_id}/document-settings", headers=as_user("com_admin"),
                          json={"metadata_schema": {"type": "nonsense"}}).status_code == 422
    finally:
        client.put(f"/projects/{w.project_id}/document-settings", headers=as_user("com_admin"), json={})


def test_ricerca_full_text_e_paginazione(client, api_world, as_user):
    _, w = api_world
    h = as_user("des_lead")
    tag = uuid.uuid4().hex[:8]
    for i in range(3):
        assert upload(client, h, w.containers["des_arch"], des_name(), PDF,
                      title=f"Sezione trasversale {tag} {i}").status_code == 200
    found = client.get(f"/projects/{w.project_id}/documents", headers=h, params={"q": tag}).json()["items"]
    assert len(found) == 3
    by_word = client.get(f"/projects/{w.project_id}/documents", headers=h, params={"q": "sezioni trasversali"}).json()
    assert len(by_word["items"]) >= 3                     # stemming italiano
    page1 = client.get(f"/projects/{w.project_id}/documents", headers=h, params={"q": tag, "limit": 2}).json()
    assert len(page1["items"]) == 2 and page1["next_cursor"]
    page2 = client.get(f"/projects/{w.project_id}/documents", headers=h,
                       params={"q": tag, "limit": 2, "after": page1["next_cursor"]}).json()
    assert len(page2["items"]) == 1 and page2["next_cursor"] is None


def test_metadati_modificabili_solo_dall_originatore(client, api_world, as_user, worker):
    _, w = api_world
    rev = upload(client, as_user("des_lead"), w.containers["des_arch"], des_name(), PDF).json()
    worker()
    doc_id = share(client, as_user("des_lead"), rev["id"])["document_id"]
    g = client.post(f"/containers/{w.containers['des_arch']}/grants", headers=as_user("des_admin"),
                    json={"grantee_type": "ORGANIZATION", "grantee_organization_id": str(w.orgs["SUB1"]),
                          "actions": ["READ", "WRITE"], "reason": "coordinamento"}).json()
    try:
        r = client.patch(f"/documents/{doc_id}", headers=as_user("sub1_user"), json={"title": "Manomesso"})
        assert r.status_code == 403
    finally:
        client.delete(f"/containers/{w.containers['des_arch']}/grants/{g['id']}", headers=as_user("des_admin"))


# ---------------------------------------------------------------------
# Immutabilità a livello database
# ---------------------------------------------------------------------
@pytest.mark.parametrize("stmt", [
    "UPDATE cde.document_revisions SET comment = 'x'",
    "DELETE FROM cde.document_revisions",
    "TRUNCATE cde.document_revisions CASCADE",
])
def test_revisioni_immutabili_anche_per_owner(client, api_world, as_user, stmt):
    urls, w = api_world
    upload(client, as_user("des_lead"), w.containers["des_arch"], des_name(), PDF)
    with psycopg.connect(urls.owner) as conn, pytest.raises(psycopg.Error) as exc:
        conn.execute(stmt)
    assert "append-only" in str(exc.value)


def test_identita_file_immutabile_anche_per_il_worker(client, api_world, as_user):
    urls, w = api_world
    upload(client, as_user("des_lead"), w.containers["des_arch"], des_name(), PDF)
    with psycopg.connect(urls.owner) as conn, pytest.raises(errors.InsufficientPrivilege):
        conn.execute("UPDATE cde.file_objects SET storage_key = 'altro'")
    with psycopg.connect(urls.worker) as conn, pytest.raises(errors.InsufficientPrivilege):
        conn.execute("UPDATE cde.file_objects SET size_bytes = 1")
    with psycopg.connect(urls.worker) as conn, pytest.raises(errors.InsufficientPrivilege):
        conn.execute("SELECT * FROM cde.documents")


def test_job_accodato_nella_stessa_transazione(client, api_world, as_user):
    urls, w = api_world
    rev = upload(client, as_user("des_lead"), w.containers["des_arch"], des_name(), PDF).json()
    with psycopg.connect(urls.owner) as conn:
        file_id = conn.execute("SELECT file_object_id FROM cde.document_revisions WHERE id = %s",
                               [rev["id"]]).fetchone()[0]
        n = conn.execute("SELECT count(*) FROM jobs.procrastinate_jobs WHERE task_name = 'cde.verify_file' "
                         "AND args->>'file_id' = %s", [str(file_id)]).fetchone()[0]
    assert n == 1


def test_api_non_accoda_task_arbitrari(api_world):
    urls, w = api_world
    with psycopg.connect(urls.app) as conn, pytest.raises(errors.InsufficientPrivilege):
        conn.execute("SELECT set_config('app.user_id', %s, true)", [str(w.users["des_lead"])])
        conn.execute("SELECT cde.enqueue_job('procrastinate.builtin_tasks.remove_old_jobs', '{}')")
    with psycopg.connect(urls.app) as conn, pytest.raises(errors.InsufficientPrivilege):
        conn.execute("SELECT * FROM jobs.procrastinate_jobs")
