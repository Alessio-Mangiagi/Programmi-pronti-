# "><(((º> sabusabu <º)))><"
"""Nuova commessa da una esistente come template (ADR-38): si copiano configurazione, naming con il codice nuovo,
schemi per cartelle con le assegnazioni, albero delle cartelle, ruoli e workflow; organizzazioni e persone solo se
richiesto; mai i documenti. Serve essere admin della propria organizzazione e Project Admin della commessa di
partenza."""
from __future__ import annotations

import os
import uuid

from test_api_documents import as_user  # noqa: F401 - fixture


def _code() -> str:
    return "T" + os.urandom(2).hex().upper()


def _names(client, h, project_id) -> set[str]:
    return {c["name"] for c in client.get(f"/projects/{project_id}/containers", headers=h).json()}


def test_copia_completa(client, api_world, as_user):  # noqa: F811
    _, w = api_world
    admin = as_user("com_admin")
    src = str(w.project_id)
    profile = client.post(f"/projects/{src}/naming-profiles", headers=admin,
                          json={"name": f"Foto {os.urandom(2).hex()}", "inherit": True}).json()
    folder = str(w.containers["des_arch"])
    client.put(f"/naming-profiles/{profile['id']}/containers", headers=admin, json={"container_ids": [folder]})
    try:
        templates = client.get("/projects/templates", headers=admin).json()
        assert any(t["id"] == src and t["folders"] > 0 for t in templates)
        code = _code()
        r = client.post("/projects", headers=admin, json={"code": code, "name": "Da template", "template_id": src,
                                                          "with_organizations": True, "with_members": True})
        assert r.status_code == 201, r.text
        new = r.json()["id"]

        assert _names(client, admin, new) == _names(client, admin, src)
        settings = client.get(f"/projects/{new}/document-settings", headers=admin).json()
        project_field = next((f for f in settings["naming_scheme"]["fields"] if f["key"] == "project"), None)
        if project_field and project_field["kind"] == "fixed":
            assert project_field["value"] == code                  # il codice nuovo nel naming
        orgs = lambda p: {o["code"] for o in client.get(f"/projects/{p}/organizations", headers=admin).json()}  # noqa: E731
        assert orgs(new) == orgs(src)
        # schema per cartelle copiato e assegnato alla copia della stessa cartella, con la sua ereditarietà
        copied = next(p for p in client.get(f"/projects/{new}/naming-profiles", headers=admin).json()
                      if p["name"] == profile["name"])
        assert copied["inherit"] and len(copied["container_ids"]) == 1
        new_folder = next(c for c in client.get(f"/projects/{new}/containers", headers=admin).json()
                          if c["id"] == copied["container_ids"][0])
        assert new_folder["name"] == client.get(f"/containers/{folder}", headers=admin).json()["name"]
        # persone con i ruoli: il progettista vede la nuova commessa; nessun documento copiato
        lead = as_user("des_lead")
        assert client.get(f"/projects/{new}", headers=lead).status_code == 200
        assert client.get(f"/projects/{new}/documents", headers=admin).json()["items"] == []
        roles = lambda p: {r["code"] for r in client.get(f"/projects/{p}/roles", headers=admin).json()}  # noqa: E731
        assert roles(new) == roles(src)
    finally:
        client.delete(f"/naming-profiles/{profile['id']}", headers=admin)


def test_solo_configurazione_e_proprie_cartelle(client, api_world, as_user):  # noqa: F811
    _, w = api_world
    admin = as_user("com_admin")
    r = client.post("/projects", headers=admin, json={"code": _code(), "name": "Solo struttura",
                                                      "template_id": str(w.project_id)})
    assert r.status_code == 201, r.text
    new = r.json()["id"]
    mine = {c["name"] for c in client.get(f"/projects/{w.project_id}/containers", headers=admin).json()
            if c["owner_organization_code"] == "COM"}
    assert _names(client, admin, new) == mine and mine
    assert {o["code"] for o in client.get(f"/projects/{new}/organizations", headers=admin).json()} == {"COM"}
    assert client.get(f"/projects/{new}", headers=as_user("des_lead")).status_code == 404


def test_permessi_e_opzioni(client, api_world, as_user):  # noqa: F811
    _, w = api_world
    src = str(w.project_id)
    body = {"code": _code(), "name": "Non ammessa", "template_id": src}
    assert client.post("/projects", headers=as_user("sub1_admin"), json=body).status_code == 403   # non Project Admin
    assert client.post("/projects", headers=as_user("des_lead"), json=body).status_code == 403     # non admin di org.
    admin = as_user("com_admin")
    assert client.post("/projects", headers=admin, json={**body, "with_members": True}).status_code == 422
    assert client.post("/projects", headers=admin, json={"code": _code(), "name": "X", "with_organizations": True}
                       ).status_code == 422
    assert client.post("/projects", headers=admin, json={**body, "template_id": str(uuid.uuid4())}).status_code == 404
