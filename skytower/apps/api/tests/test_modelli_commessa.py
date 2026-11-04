# "><(((º> sabusabu <º)))><"
"""Modelli di commessa dell'organizzazione (ADR-52, migrazione 0043).

"Salva come modello" crea un modello separato (la commessa di partenza non cambia) che non compare negli elenchi
operativi e non ha funzioni operative; lo usano e lo modificano solo gli admin dell'organizzazione (le altre
organizzazioni non lo vedono); dal modello nasce una commessa con struttura, organizzazioni, persone e documenti di
modello (prima revisione WIP, file copiato); "Scarica il modello" produce un .cdemodello che "Carica un modello da
file" ricrea identico nella stessa organizzazione o adattato in un'altra; file manomessi, percorsi strani e file
troppo grandi sono rifiutati.

I test lavorano su un'organizzazione propria (``mdl``) per non toccare COM e PRJ01, che altri test usano.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import uuid
import zipfile
from dataclasses import dataclass

import psycopg
import pytest
from argon2 import PasswordHasher
from psycopg.rows import dict_row
from test_api_documents import PDF, new_number, upload
from test_api_states import as_user, worker  # noqa: F401 - fixture riusate

from cde_api.tooling.demo_seed import DEMO_PASSWORD


@dataclass
class Mdl:
    org: uuid.UUID
    code: str                       # codice organizzazione (originatore)
    source: uuid.UUID               # commessa di partenza
    source_code: str
    folders: dict[str, uuid.UUID]
    users: dict[str, uuid.UUID]
    emails: dict[str, str]


def nodo(nid, tipo, nome, col, row, **kw):
    return {"id": nid, "type": tipo, "name": nome, "cell": {"col": col, "row": row}, **kw}


def workflow_con_persona(user_id):
    """Avvio → verifica di una persona (il Lead Designer della DES) → fine."""
    ok, no = {"code": "OK", "label": "Ok", "color": "green"}, {"code": "NO", "label": "Respinto", "color": "red"}
    nodes = [nodo("s", "start", "Avvio", 0, 0),
             nodo("a", "decision", "Verifica", 1, 0, assignees=[{"type": "user", "id": str(user_id)}],
                  quorum="ANY", outcomes=[ok, no]),
             nodo("ok", "end", "Concluso", 2, 0, result="OK"), nodo("ko", "end", "Fallito", 2, 1, result="KO")]
    edges = [{"from": "s", "to": "a"}, {"from": "a", "outcome": "OK", "to": "ok"}, {"from": "a", "outcome": "NO", "to": "ko"}]
    return {"version": 2, "subject": "PROCESS", "nodes": nodes, "edges": edges}


@pytest.fixture(scope="module")
def mdl(api_world) -> Mdl:
    """Organizzazione con due admin (admin, admin2), un Project Admin non admin dell'organizzazione (pm) e una
    commessa di partenza con la DES partecipante, cartelle proprie e della DES (una riservata), un ruolo
    personalizzato, uno schema per cartelle e il Lead Designer della DES fra i membri."""
    urls, w = api_world
    sfx = os.urandom(2).hex().upper()
    pwd = PasswordHasher().hash(DEMO_PASSWORD)
    code = f"M{sfx}"
    with psycopg.connect(urls.owner) as conn, conn.transaction():
        roles = dict(conn.execute("SELECT code, id FROM cde.roles WHERE project_id IS NULL").fetchall())
        org = conn.execute("INSERT INTO cde.organizations (legal_name, code, mfa_required) VALUES (%s, %s, false) "
                           "RETURNING id", [f"Modelli {sfx} Srl", code]).fetchone()[0]
        users, emails = {}, {}
        for key, admin in (("admin", True), ("admin2", True), ("pm", False)):
            emails[key] = f"{key}.{sfx.lower()}@mdl.example"
            users[key] = conn.execute(
                """INSERT INTO cde.users (organization_id, email, first_name, last_name, password_hash, status,
                                          is_org_admin, password_changed_at)
                   VALUES (%s, %s, %s, 'Modelli', %s, 'ACTIVE', %s, now()) RETURNING id""",
                [org, emails[key], key.upper(), pwd, admin]).fetchone()[0]
        source_code = f"S{sfx}"
        src = conn.execute("""INSERT INTO cde.projects (owner_organization_id, code, name, status, created_by, settings)
                              VALUES (%s, %s, 'Commessa di partenza', 'ACTIVE', %s, %s) RETURNING id""",
                           [org, source_code, users["admin"], json.dumps({"commessa": f"C-{sfx}", "nota": "x"})]
                           ).fetchone()[0]
        conn.execute("INSERT INTO cde.project_organizations (project_id, organization_id, party_role) VALUES "
                     "(%s, %s, 'APPOINTING_PARTY'), (%s, %s, 'APPOINTED_PARTY')", [src, org, src, w.orgs["DES"]])
        for u, r in ((users["admin"], "PROJECT_ADMIN"), (users["pm"], "PROJECT_ADMIN"),
                     (w.users["des_lead"], "LEAD_DESIGNER")):
            conn.execute("INSERT INTO cde.project_memberships (project_id, user_id, role_id) VALUES (%s, %s, %s)",
                         [src, u, roles[r]])
        rid = conn.execute("INSERT INTO cde.roles (project_id, code, name) VALUES (%s, 'GEOLOGO', 'Geologo') "
                           "RETURNING id", [src]).fetchone()[0]
        conn.execute("INSERT INTO cde.role_permissions (role_id, action, scope) VALUES (%s, 'READ', 'PROJECT')", [rid])
        prof = conn.execute(
            """INSERT INTO cde.naming_profiles (project_id, name, naming_scheme, inherit, created_by)
               VALUES (%s, 'Foto', %s, true, %s) RETURNING id""",
            [src, json.dumps({"separator": "-", "fields": [
                {"key": "project", "label": "Progetto", "kind": "fixed", "min_length": 2, "max_length": 6,
                 "value": source_code},
                {"key": "type", "label": "Tipo", "kind": "fixed", "min_length": 2, "max_length": 2, "value": "FT"},
                {"key": "number", "label": "Numero", "kind": "regex", "min_length": 4, "max_length": 6,
                 "pattern": r"\d{4,6}"}]}), users["admin"]]).fetchone()[0]
        folders = {}
        for key, owner, parent, name, private, profile in (
                ("root", org, None, "Documenti di gara", False, None),
                ("sub", org, "root", "Capitolati", False, None),
                ("foto", org, "root", "Foto di cantiere", False, prof),
                ("des", w.orgs["DES"], None, "DES - Progetto", False, None),
                ("des_priv", w.orgs["DES"], "des", "Calcoli riservati", True, None)):
            folders[key] = conn.execute(
                """INSERT INTO cde.containers (project_id, parent_id, owner_organization_id, name, is_private,
                       naming_profile_id, created_by) VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id""",
                [src, folders.get(parent), owner, name, private, profile, users["admin"]]).fetchone()[0]
        conn.execute("""INSERT INTO cde.workflow_templates (project_id, code, version, name, definition, created_by)
                        VALUES (%s, 'VERIFICA_DES', 1, 'Verifica del progettista', %s, %s)""",
                     [src, json.dumps(workflow_con_persona(w.users["des_lead"])), users["admin"]])
    return Mdl(org, code, src, source_code, folders, users, emails)


@pytest.fixture
def come(client, mdl, as_user):  # noqa: F811
    tokens: dict[str, dict] = {}

    def h(user: str) -> dict:
        if user not in mdl.emails:
            return as_user(user)
        if user not in tokens:
            client.app.state.services.limiter.reset()
            r = client.post("/auth/login", json={"email": mdl.emails[user], "password": DEMO_PASSWORD})
            assert r.status_code == 200, r.text
            tokens[user] = {"Authorization": f"Bearer {r.json()['access_token']}"}
        return tokens[user]
    return h


@pytest.fixture(scope="module")
def stato() -> dict:
    """Ciò che i test successivi riusano (modello salvato, file esportato)."""
    return {}


def _modello(client, mdl, come, worker, stato):  # noqa: F811
    """Commessa con due documenti propri (uno "di modello"), salvata come modello una volta per il modulo."""
    if "model" in stato:
        return stato["model"]
    h = come("admin")
    doc = upload(client, h, mdl.folders["sub"], f"{mdl.source_code}-{mdl.code}-ZZ-01-SP-A-{new_number()}.pdf", PDF,
                 title="Capitolato tipo")
    assert doc.status_code == 200, doc.text
    other = upload(client, h, mdl.folders["root"], f"{mdl.source_code}-{mdl.code}-ZZ-01-DR-A-{new_number()}.pdf",
                   PDF + b"x", title="Tavola della commessa")
    assert other.status_code == 200, other.text
    worker()
    stato["doc"], stato["other"] = doc.json()["document_id"], other.json()["document_id"]
    assert client.put(f"/documents/{stato['doc']}/model", headers=h).status_code == 204
    r = client.post(f"/organizations/{mdl.org}/project-models", headers=h,
                    json={"source_project_id": str(mdl.source), "name": "Modello – Infrastrutture"})
    assert r.status_code == 201, r.text
    stato["model"] = r.json()
    worker()                                  # verifica dei file copiati nel modello
    return stato["model"]


def _zip(files: dict[str, bytes], manifest: dict | None = None) -> bytes:
    """Un .cdemodello costruito a mano: con ``manifest`` None le impronte sono quelle giuste."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in files.items():
            zf.writestr(name, data)
        if manifest is None:
            manifest = {"formato": "cdemodello", "versione": 1, "algoritmo": "SHA-256",
                        "file": {n: hashlib.sha256(d).hexdigest() for n, d in files.items()}}
        zf.writestr("manifest.json", json.dumps(manifest))
    return buf.getvalue()


def _unzip(data: bytes) -> dict[str, bytes]:
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        return {n: zf.read(n) for n in zf.namelist()}


def _importa(client, h, org, data: bytes, **params):
    return client.post(f"/organizations/{org}/project-models/import", headers={**h, "Content-Type": "application/zip"},
                       content=data, params=params)


def _struttura(client, h, pid) -> dict:
    """Ciò che deve coincidere fra un modello e la sua copia."""
    names = sorted(c["name"] for c in client.get(f"/projects/{pid}/containers", headers=h).json())
    roles = sorted(r["code"] for r in client.get(f"/projects/{pid}/roles", headers=h).json() if not r["is_system"])
    wfs = sorted(t["code"] for t in client.get(f"/projects/{pid}/workflow-templates", headers=h).json()
                 if t["scope"] == "PROJECT")
    profiles = sorted(p["name"] for p in client.get(f"/projects/{pid}/naming-profiles", headers=h).json())
    orgs = sorted(o["code"] for o in client.get(f"/projects/{pid}/organizations", headers=h).json() if not o["is_owner"])
    docs = sorted(d["identifier"] for d in client.get(f"/projects/{pid}/documents", headers=h).json()["items"])
    return {"folders": names, "roles": roles, "workflows": wfs, "profiles": profiles, "orgs": orgs, "docs": docs}


# ---------------------------------------------------------------------
# Salva come modello, esclusioni, commessa dal modello
# ---------------------------------------------------------------------
def test_salva_come_modello(client, mdl, come, worker, stato, api_world):  # noqa: F811
    _, w = api_world
    m = _modello(client, mdl, come, worker, stato)
    h = come("admin")
    assert m["changes"] == [] and m["code"] == mdl.source_code and m["model_source_id"] == str(mdl.source)
    assert (m["folders"], m["naming_profiles"], m["workflows"], m["roles"], m["organizations"], m["documents"]) \
        == (5, 1, 1, 1, 1, 1)
    assert m["people"] == 3                                   # admin, pm, Lead Designer DES
    # la commessa di partenza resta com'è
    assert len(client.get(f"/projects/{mdl.source}/documents", headers=h).json()["items"]) == 2
    assert [d["document_id"] for d in client.get(f"/projects/{mdl.source}/model-documents", headers=h).json()] \
        == [stato["doc"]]
    # il modello: senza codice commessa della suite, struttura completa, documento di modello in WIP
    model = client.get(f"/projects/{m['id']}", headers=h).json()
    assert model["is_model"] and "commessa" not in model["settings"] and model["settings"]["nota"] == "x"
    people = client.get(f"/project-models/{m['id']}/people", headers=h).json()
    assert {p["email"] for p in people} >= {mdl.emails["admin"], w.emails["des_lead"]}
    docs = client.get(f"/projects/{m['id']}/documents", headers=h).json()["items"]
    assert len(docs) == 1 and docs[0]["title"] == "Capitolato tipo" and docs[0]["current_revision"] == "P01.01"
    assert [d["document_id"] for d in client.get(f"/projects/{m['id']}/model-documents", headers=h).json()] \
        == [docs[0]["id"]]


def test_modello_fuori_dagli_elenchi_e_senza_funzioni_operative(client, mdl, come, worker, stato, api_world):  # noqa: F811
    urls, _ = api_world
    m = _modello(client, mdl, come, worker, stato)
    h = come("admin")
    assert m["id"] not in {p["id"] for p in client.get("/me/projects", headers=h).json()}
    assert m["id"] not in {p["id"] for p in client.get("/projects", headers=h).json()}
    assert m["id"] not in {p["id"] for p in client.get("/projects/templates", headers=h).json()}
    assert m["id"] in {x["id"] for x in client.get(f"/organizations/{mdl.org}/project-models", headers=h).json()}
    # le persone del modello non sono membri: il Lead Designer non lo vede
    assert client.get(f"/projects/{m['id']}", headers=come("des_lead")).status_code == 404
    r = client.post(f"/projects/{m['id']}/rfis", headers=h, json={"subject": "Domanda", "question": "?",
                                                                    "recipient_organization_ids": [str(mdl.org)]})
    assert r.status_code == 422 and "modello" in r.json()["error"]["message"]
    r = client.patch(f"/projects/{m['id']}", headers=h, json={"settings": {"commessa": "X1"}})
    assert r.status_code == 422
    with psycopg.connect(urls.owner, row_factory=dict_row) as conn:
        assert conn.execute("SELECT cde.notify(%s, %s, 'TEST', 't', 'b') AS n", [mdl.users["admin"], m["id"]]
                            ).fetchone()["n"] is None
        assert conn.execute("SELECT count(*) n FROM cde.notifications WHERE project_id = %s", [m["id"]]).fetchone()["n"] == 0
        conn.rollback()


def test_commessa_dal_modello(client, mdl, come, worker, stato, api_world):  # noqa: F811
    urls, _ = api_world
    m = _modello(client, mdl, come, worker, stato)
    h = come("admin")
    code = f"N{os.urandom(2).hex().upper()}"
    r = client.post(f"/project-models/{m['id']}/projects", headers=h, json={
        "code": code, "name": "Commessa dal modello", "with_organizations": True, "with_members": True})
    assert r.status_code == 201, r.text
    new = r.json()
    assert new["changes"] == [] and not new["is_model"] and "commessa" not in new["settings"]
    s_new, s_model = _struttura(client, h, new["id"]), _struttura(client, h, m["id"])
    assert {k: v for k, v in s_new.items() if k != "docs"} == {k: v for k, v in s_model.items() if k != "docs"}
    # documento di modello: prima revisione WIP, identificativo col codice nuovo, file nuovo su S3
    docs = client.get(f"/projects/{new['id']}/documents", headers=h).json()["items"]
    assert len(docs) == 1 and docs[0]["identifier"].startswith(f"{code}-") and docs[0]["current_revision"] == "P01.01"
    assert docs[0]["current_state"] == "WIP"
    with psycopg.connect(urls.owner, row_factory=dict_row) as conn:
        keys = conn.execute("""SELECT f.storage_key FROM cde.file_objects f JOIN cde.document_revisions r
                               ON r.file_object_id = f.id WHERE r.project_id = ANY(%s)""",
                            [[m["id"], new["id"], str(mdl.source)]]).fetchall()
    assert len({k["storage_key"] for k in keys}) == len(keys) == 4
    # naming col codice nuovo, persone con i ruoli (il Lead Designer ora vede la commessa)
    scheme = client.get(f"/projects/{new['id']}/naming-profiles", headers=h).json()[0]["naming_scheme"]
    assert next(f for f in scheme["fields"] if f["key"] == "project")["value"] == code
    assert client.get(f"/projects/{new['id']}", headers=come("des_lead")).status_code == 200
    assert new["id"] in {p["id"] for p in client.get("/me/projects", headers=h).json()}
    # senza organizzazioni né persone: solo i rami della propria organizzazione, documenti a scelta
    r = client.post(f"/project-models/{m['id']}/projects", headers=h, json={
        "code": f"N{os.urandom(2).hex().upper()}", "name": "Solo struttura", "with_documents": False})
    assert r.status_code == 201, r.text
    assert _struttura(client, h, r.json()["id"])["folders"] == ["Capitolati", "Documenti di gara", "Foto di cantiere"]
    assert client.get(f"/projects/{r.json()['id']}/documents", headers=h).json()["items"] == []
    # stesso codice di una commessa esistente: 409; il modello può avere il codice della commessa di partenza
    r = client.post(f"/project-models/{m['id']}/projects", headers=h, json={"code": code, "name": "Doppione"})
    assert r.status_code == 409


# ---------------------------------------------------------------------
# Permessi
# ---------------------------------------------------------------------
def test_permessi(client, mdl, come, worker, stato, api_world):  # noqa: F811
    urls, _ = api_world
    m = _modello(client, mdl, come, worker, stato)
    # il secondo admin dell'organizzazione vede il modello, lo apre e lo usa
    a2 = come("admin2")
    assert m["id"] in {x["id"] for x in client.get(f"/organizations/{mdl.org}/project-models", headers=a2).json()}
    assert client.get(f"/projects/{m['id']}", headers=a2).json()["my_permissions"]["ADMIN"]["PROJECT"]
    r = client.post(f"/project-models/{m['id']}/projects", headers=a2,
                    json={"code": f"P{os.urandom(2).hex().upper()}", "name": "Del secondo admin"})
    assert r.status_code == 201, r.text
    # il Project Admin che non è admin dell'organizzazione: né elenco, né uso, né salvataggio
    pm = come("pm")
    assert client.get(f"/organizations/{mdl.org}/project-models", headers=pm).status_code == 403
    assert client.post(f"/project-models/{m['id']}/projects", headers=pm,
                       json={"code": "ZZ99", "name": "No"}).status_code == 404
    assert client.post(f"/organizations/{mdl.org}/project-models", headers=pm,
                       json={"source_project_id": str(mdl.source), "name": "No"}).status_code == 403
    # altre organizzazioni: 404 ovunque
    other = come("des_admin")
    assert client.get(f"/organizations/{mdl.org}/project-models", headers=other).status_code == 404
    assert client.get(f"/projects/{m['id']}", headers=other).status_code == 404
    assert client.post(f"/project-models/{m['id']}/projects", headers=other,
                       json={"code": "ZZ98", "name": "No"}).status_code == 404
    assert client.get(f"/projects/{m['id']}/model-file", headers=other).status_code == 404
    # chi smette di essere admin esce dai modelli alla prossima apertura dell'elenco
    with psycopg.connect(urls.owner) as conn:
        conn.execute("UPDATE cde.users SET is_org_admin = false WHERE id = %s", [mdl.users["admin2"]])
    try:
        client.get(f"/organizations/{mdl.org}/project-models", headers=come("admin"))
        assert client.get(f"/projects/{m['id']}", headers=a2).status_code == 404
    finally:
        with psycopg.connect(urls.owner) as conn:
            conn.execute("UPDATE cde.users SET is_org_admin = true WHERE id = %s", [mdl.users["admin2"]])
    # documenti di modello: li marca solo il Project Admin
    assert client.put(f"/documents/{stato['other']}/model", headers=come("des_lead")).status_code == 404


def test_persone_del_modello(client, mdl, come, worker, stato, api_world):  # noqa: F811
    _, w = api_world
    m = _modello(client, mdl, come, worker, stato)
    h = come("admin")
    role = next(r for r in client.get(f"/projects/{m['id']}/roles", headers=h).json() if r["code"] == "GEOLOGO")
    r = client.post(f"/project-models/{m['id']}/people", headers=h,
                    json={"user_id": str(w.users["des_designer"]), "role_id": role["id"]})
    assert r.status_code == 201 and r.json()["role_code"] == "GEOLOGO"
    # una persona di un'organizzazione che nel modello non c'è: no
    assert client.post(f"/project-models/{m['id']}/people", headers=h, json={
        "user_id": str(w.users["sub1_user"]), "role_id": role["id"]}).status_code == 422
    assert client.delete(f"/project-models/{m['id']}/people/{w.users['des_designer']}/{role['id']}",
                         headers=h).status_code == 204


# ---------------------------------------------------------------------
# File .cdemodello
# ---------------------------------------------------------------------
def test_scarica_e_ricarica_nella_stessa_organizzazione(client, mdl, come, worker, stato):  # noqa: F811
    m = _modello(client, mdl, come, worker, stato)
    h = come("admin")
    r = client.get(f"/projects/{m['id']}/model-file", headers=h)
    assert r.status_code == 200, r.text
    assert r.headers["content-disposition"].startswith("attachment;") and ".cdemodello" in r.headers["content-disposition"]
    files = _unzip(r.content)
    assert set(files) == {"modello.json", "manifest.json", "LEGGIMI.txt", "files/0001.pdf"}
    manifest = json.loads(files["manifest.json"])
    assert manifest["file"]["files/0001.pdf"] == hashlib.sha256(files["files/0001.pdf"]).hexdigest()
    payload = json.loads(files["modello.json"])
    assert payload["formato"] == "cdemodello" and payload["versione"] == 1
    assert "commessa" not in payload["progetto"]["settings"]
    assert len(payload["cartelle"]) == 5 and payload["workflow"][0]["code"] == "VERIFICA_DES"
    stato["file"] = r.content
    # anche da una commessa: le persone sono i membri, i documenti di modello quelli marcati
    r = client.get(f"/projects/{mdl.source}/model-file", headers=h)
    assert r.status_code == 200 and "files/0001.pdf" in _unzip(r.content)

    r = _importa(client, h, mdl.org, stato["file"], name="Modello ricaricato")
    assert r.status_code == 201, r.text
    copia = r.json()
    assert copia["name"] == "Modello ricaricato" and copia["code"] == m["code"]
    assert _struttura(client, h, copia["id"]) == _struttura(client, h, m["id"])
    assert sorted((p["email"], p["role_code"]) for p in client.get(f"/project-models/{copia['id']}/people", headers=h).json()) \
        == sorted((p["email"], p["role_code"]) for p in client.get(f"/project-models/{m['id']}/people", headers=h).json())
    # il workflow con la persona è rimasto identico (stessa persona, qui c'è)
    wf = lambda pid: next(t for t in client.get(f"/projects/{pid}/workflow-templates", headers=h).json()
                          if t["code"] == "VERIFICA_DES")["definition"]
    assert wf(copia["id"]) == wf(m["id"])
    assert not [x for x in copia["changes"] if "saltat" in x or "tolta" in x]


def test_ricarica_in_un_altra_organizzazione(client, mdl, come, worker, stato, api_world):  # noqa: F811
    _, w = api_world
    _modello(client, mdl, come, worker, stato)
    if "file" not in stato:
        stato["file"] = client.get(f"/projects/{stato['model']['id']}/model-file", headers=come("admin")).content
    files = _unzip(stato["file"])
    payload = json.loads(files["modello.json"])
    # una persona che in questa installazione non esiste: saltata e segnalata
    payload["persone"].append({"email": "nessuno@altrove.example", "first_name": "Nessuno", "last_name": "Altrove",
                               "organization": payload["persone"][0]["organization"], "role": "PROJECT_ADMIN"})
    files["modello.json"] = json.dumps(payload).encode()
    data = _zip({k: v for k, v in files.items() if k != "manifest.json"})
    out = come("out_user")                                   # admin dell'organizzazione OUT
    r = _importa(client, out, w.orgs["OUT"], data, with_library=False)
    assert r.status_code == 201, r.text
    res = r.json()
    assert any("nessuno@altrove.example" in x for x in res["changes"])
    # il modello è della OUT: la COM-modelli non lo vede, i documenti ci sono, le cartelle anche
    assert client.get(f"/projects/{res['id']}", headers=come("admin")).status_code == 404
    st = _struttura(client, out, res["id"])
    assert len(st["folders"]) == 5 and len(st["docs"]) == 1
    # e il modello della prima organizzazione resta invisibile alla OUT
    assert client.get(f"/projects/{stato['model']['id']}", headers=out).status_code == 404


def test_file_manomesso_o_strano_rifiutato(client, mdl, come, worker, stato):  # noqa: F811
    _modello(client, mdl, come, worker, stato)
    h = come("admin")
    data = stato.get("file") or client.get(f"/projects/{stato['model']['id']}/model-file", headers=h).content
    files = _unzip(data)
    manifest = json.loads(files.pop("manifest.json"))
    # contenuto cambiato senza aggiornare le impronte
    files_bad = {**files, "modello.json": files["modello.json"].replace(b"Capitolato tipo", b"Capitolato TIPO")}
    r = _importa(client, h, mdl.org, _zip(files_bad, manifest))
    assert r.status_code == 422 and "SHA-256" in r.json()["error"]["message"]
    # file del documento rovinato
    r = _importa(client, h, mdl.org, _zip({**files, "files/0001.pdf": files["files/0001.pdf"][:-10]}, manifest))
    assert r.status_code == 422
    # percorsi strani nello zip
    for evil in ("../fuori.txt", "files/../../x.pdf", "/assoluto.txt", "C:/win.txt", "files/sotto/cartella.pdf"):
        r = _importa(client, h, mdl.org, _zip({**files, evil: b"x"}))
        assert r.status_code == 422, (evil, r.text)
        assert "non ammesso" in r.json()["error"]["message"] or "non previsto" in r.json()["error"]["message"]
    # versione sconosciuta, JSON con campi in più, non uno zip
    r = _importa(client, h, mdl.org, _zip(files, {**manifest, "versione": 9}))
    assert r.status_code == 422 and "Versione" in r.json()["error"]["message"]
    payload = json.loads(files["modello.json"])
    r = _importa(client, h, mdl.org, _zip({**files, "modello.json": json.dumps({**payload, "extra": 1}).encode()}))
    assert r.status_code == 422
    assert _importa(client, h, mdl.org, b"non sono uno zip").status_code == 422
    # naming con un'espressione regolare rischiosa (ReDoS): stessi controlli delle pagine
    payload["schemi_cartelle"][0]["naming_scheme"]["fields"][2]["pattern"] = r"(a+)+$"
    r = _importa(client, h, mdl.org, _zip({**files, "modello.json": json.dumps(payload).encode()}))
    assert r.status_code == 422


def test_tetti_di_dimensione(client, mdl, come, worker, stato):  # noqa: F811
    _modello(client, mdl, come, worker, stato)
    h = come("admin")
    settings = client.app.state.services.settings
    data = stato.get("file") or client.get(f"/projects/{stato['model']['id']}/model-file", headers=h).content
    old = settings.model_file_max_bytes
    settings.model_file_max_bytes = 2048
    try:
        r = _importa(client, h, mdl.org, data)                         # Content-Length oltre il tetto: 413 subito
        assert r.status_code == 413
        r = client.get(f"/projects/{stato['model']['id']}/model-file", headers=h)   # documenti oltre: niente file
        assert r.status_code == 413
    finally:
        settings.model_file_max_bytes = old
    # zip bomb: un file enorme di zeri compresso in pochi KB
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("modello.json", b"{}")
        zf.writestr("files/0001.pdf", b"\0" * (30 * 1024 * 1024))
        zf.writestr("manifest.json", b"{}")
    r = _importa(client, h, mdl.org, buf.getvalue())
    assert r.status_code == 422 and "compressione" in r.json()["error"]["message"]
    # troppe voci
    many = {f"files/{i:04d}.txt": b"x" for i in range(700)}
    r = _importa(client, h, mdl.org, _zip({"modello.json": b"{}", **many}))
    assert r.status_code == 422 and "Troppi" in r.json()["error"]["message"]
