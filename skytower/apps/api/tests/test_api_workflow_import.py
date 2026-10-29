# "><(((º> sabusabu <º)))><"
"""Import di un workflow sviluppato in un altro progetto (ADR-39): solo tra progetti di cui si è Project Admin;
persone e organizzazioni assenti nel progetto di destinazione si tolgono (con nota), i ruoli personalizzati
mancanti si creano uguali; stesso codice ⇒ nuova versione."""
from __future__ import annotations

import os

from test_api_documents import as_user  # noqa: F401 - fixture


def _target(client, admin) -> str:
    r = client.post("/projects", headers=admin, json={"code": "W" + os.urandom(2).hex().upper(), "name": "Destinazione"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_import_adattato_al_progetto(client, api_world, as_user):  # noqa: F811
    _, w = api_world
    admin = as_user("com_admin")
    src = str(w.project_id)
    role = "VERIF_" + os.urandom(2).hex().upper()
    r = client.post(f"/projects/{src}/roles", headers=admin,
                    json={"code": role, "name": "Verificatore esterno", "permissions": [{"action": "APPROVE", "scope": "PROJECT"}]})
    assert r.status_code == 201, r.text
    code = "IMP_" + os.urandom(2).hex().upper()
    lead = str(w.users["des_lead"])
    wf = client.post(f"/projects/{src}/workflow-templates", headers=admin, json={"code": code, "name": "Verifica e DL", "definition": {
        "steps": [{"name": "Verifica", "assignees": [{"type": "role", "code": role}], "quorum": "ALL"},
                  {"name": "Direzione lavori", "assignees": [{"type": "user", "id": lead},
                                                            {"type": "role", "code": "DIRETTORE_LAVORI"}], "quorum": "ANY"}],
        "escalation_user_id": lead}})
    assert wf.status_code == 201, wf.text
    target = _target(client, admin)

    listed = client.get(f"/projects/{target}/workflow-templates/importable", headers=admin).json()
    item = next(t for t in listed if t["id"] == wf.json()["id"])
    assert item["project_code"] == "PRJ01" and item["exists_here"] is False

    r = client.post(f"/projects/{target}/workflow-templates/import", headers=admin, json={"template_id": item["id"]})
    assert r.status_code == 201, r.text
    out = r.json()
    assert out["code"] == code and out["version"] == 1 and out["project_id"] == target
    steps = out["definition"]["steps"]
    assert steps[1]["assignees"] == [{"type": "role", "code": "DIRETTORE_LAVORI", "id": None, "organization_id": None}]
    assert out["definition"]["escalation_user_id"] is None
    assert any("non è in questo progetto" in n for n in out["changes"])
    assert any(f"Creato il ruolo {role}" in n for n in out["changes"])
    assert role in {x["code"] for x in client.get(f"/projects/{target}/roles", headers=admin).json()}

    # di nuovo: stesso codice ⇒ versione 2, la 1 disattivata; con un altro codice ⇒ workflow a sé
    again = client.post(f"/projects/{target}/workflow-templates/import", headers=admin, json={"template_id": item["id"]}).json()
    assert again["version"] == 2 and not any("Creato il ruolo" in n for n in again["changes"])
    other = client.post(f"/projects/{target}/workflow-templates/import", headers=admin,
                        json={"template_id": item["id"], "code": code + "_B", "name": "Copia"}).json()
    assert other["code"] == code + "_B" and other["version"] == 1
    active = client.get(f"/projects/{target}/workflow-templates", headers=admin).json()
    assert {(t["code"], t["version"]) for t in active} == {(code, 2), (code + "_B", 1)}


def test_step_senza_assegnatari_e_permessi(client, api_world, as_user):  # noqa: F811
    _, w = api_world
    admin = as_user("com_admin")
    src = str(w.project_id)
    wf = client.post(f"/projects/{src}/workflow-templates", headers=admin, json={
        "code": "SOLO_" + os.urandom(2).hex().upper(), "name": "Solo una persona", "definition": {
            "steps": [{"name": "Firma", "assignees": [{"type": "user", "id": str(w.users["des_lead"])}]}]}}).json()
    target = _target(client, admin)
    r = client.post(f"/projects/{target}/workflow-templates/import", headers=admin, json={"template_id": wf["id"]})
    assert r.status_code == 422 and "senza assegnatari" in r.json()["error"]["message"]
    # serve il Project Admin di destinazione (e di partenza)
    assert client.post(f"/projects/{src}/workflow-templates/import", headers=as_user("des_lead"),
                       json={"template_id": wf["id"]}).status_code in (403, 404)
    assert client.get(f"/projects/{src}/workflow-templates/importable", headers=as_user("des_lead")).status_code == 403
    assert client.post(f"/projects/{src}/workflow-templates/import", headers=admin,
                       json={"template_id": wf["id"]}).status_code == 409
