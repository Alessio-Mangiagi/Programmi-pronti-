# "><(((º> sabusabu <º)))><"
"""Naming per cartella: schemi con nome del Project Admin, assegnati alle cartelle scelte; caricamenti, verifica in
tempo reale e rinomina automatica seguono lo schema della cartella; le cartelle senza schema usano quello della
commessa; un documento già presente tiene il suo identificativo se lo schema cambia dopo."""
from __future__ import annotations

import os

import pytest
from test_api_documents import PDF, des_name, upload
from test_api_naming_auto import _upload_auto

from cde_api.tooling.demo_seed import DEMO_PASSWORD


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


def photo_scheme(code: str) -> dict:
    """PRJ01-<originatore>-<code>-<numero>: es. lo schema delle foto di cantiere."""
    return {"separator": "-", "fields": [
        {"key": "project", "label": "Progetto", "kind": "fixed", "min_length": 2, "max_length": 6, "value": "PRJ01"},
        {"key": "originator", "label": "Originatore", "kind": "regex", "min_length": 3, "max_length": 6,
         "pattern": "[A-Z0-9]{3,6}"},
        {"key": "kind", "label": "Tipo", "kind": "fixed", "min_length": 2, "max_length": 4, "value": code},
        {"key": "number", "label": "Numero", "kind": "regex", "min_length": 4, "max_length": 4, "pattern": r"\d{4}",
         "example": "0001"},
    ]}


@pytest.fixture
def profiles(client, api_world, as_user):
    """Crea schemi per cartelle (nomi unici: il DB di test è condiviso) e li elimina alla fine."""
    _, w = api_world
    admin = as_user("com_admin")
    made: list[str] = []

    def create(name: str, **body):
        r = client.post(f"/projects/{w.project_id}/naming-profiles", headers=admin,
                        json={"name": f"{name} {os.urandom(2).hex()}", **body})
        assert r.status_code == 201, r.text
        made.append(r.json()["id"])
        return r.json()
    yield create
    for pid in made:
        client.delete(f"/naming-profiles/{pid}", headers=admin)


def test_solo_admin_e_copia_dello_schema_della_commessa(client, api_world, as_user, profiles):
    _, w = api_world
    url = f"/projects/{w.project_id}/naming-profiles"
    assert client.post(url, headers=as_user("des_lead"), json={"name": "Mio"}).status_code == 403
    copy = profiles("Copia")
    project = client.get(f"/projects/{w.project_id}/document-settings", headers=as_user("com_admin")).json()
    assert copy["naming_scheme"] == project["naming_scheme"] and copy["example"] == project["example"]
    assert copy["container_ids"] == []
    dup = client.post(url, headers=as_user("com_admin"), json={"name": copy["name"].upper()})
    assert dup.status_code == 409
    bad = client.post(url, headers=as_user("com_admin"),
                      json={"name": "Errato", "naming_scheme": photo_scheme("FT"), "auto_number": {"field": "kind"}})
    assert bad.status_code == 422
    # visibile (in lettura) a ogni membro della commessa
    names = [p["name"] for p in client.get(url, headers=as_user("des_lead")).json()]
    assert copy["name"] in names


def test_cartella_con_schema_proprio(client, api_world, as_user, profiles):
    _, w = api_world
    admin, des = as_user("com_admin"), as_user("des_lead")
    folder = w.containers["des_arch_det"]
    prof = profiles("Foto", naming_scheme=photo_scheme("FT"))
    r = client.put(f"/naming-profiles/{prof['id']}/containers", headers=des, json={"container_ids": [str(folder)]})
    assert r.status_code == 403
    r = client.put(f"/naming-profiles/{prof['id']}/containers", headers=admin, json={"container_ids": [str(folder)]})
    assert r.status_code == 200 and r.json()["container_ids"] == [str(folder)]

    naming = client.get(f"/containers/{folder}/naming", headers=des).json()
    assert naming["profile"]["name"] == prof["name"] and naming["example"].endswith("-FT-0001")
    other = client.get(f"/containers/{w.containers['des_arch']}/naming", headers=des).json()
    assert other["profile"] is None                                   # le altre cartelle: schema della commessa

    validate = f"/projects/{w.project_id}/naming/validate"
    number = f"{int.from_bytes(os.urandom(2)) % 9000 + 1000:04d}"
    photo = f"PRJ01-DES-FT-{number}.jpg"
    assert client.post(validate, headers=des, json={"name": photo, "container_id": str(folder)}).json()["valid"]
    assert not client.post(validate, headers=des, json={"name": photo}).json()["valid"]
    assert not client.post(validate, headers=des, json={"name": des_name(), "container_id": str(folder)}).json()["valid"]

    ok = upload(client, des, folder, f"PRJ01-DES-FT-{number}.pdf", PDF, title="Foto fronte sud")
    assert ok.status_code == 200, ok.text
    wrong = upload(client, des, folder, des_name(), PDF, complete=False)
    assert wrong.status_code == 422 and wrong.json()["error"]["code"] == "invalid_name"
    assert upload(client, des, w.containers["des_arch"], f"PRJ01-DES-FT-{number}9.pdf", PDF, complete=False).status_code == 422


def test_rinomina_automatica_della_cartella(client, api_world, as_user, profiles):
    _, w = api_world
    code = "F" + os.urandom(1).hex().upper()[:1] + "X"
    prof = profiles("Rilievi", naming_scheme=photo_scheme(code), auto_number={"field": "number", "start": 7})
    folder = w.containers["des_arch_det"]
    client.put(f"/naming-profiles/{prof['id']}/containers", headers=as_user("com_admin"), json={"container_ids": [str(folder)]})
    des = as_user("des_lead")
    p = client.post(f"/projects/{w.project_id}/naming/propose", headers=des,
                    json={"filename": "IMG_2041.pdf", "fields": {}, "container_id": str(folder)}).json()
    assert p["name"] == f"PRJ01-DES-{code}-0007.pdf" and p["valid"]
    rev = _upload_auto(client, des, folder, {}, title="Rilievo", filename="IMG_2041.pdf").json()
    assert rev["original_filename"] == f"PRJ01-DES-{code}-0007.pdf"
    # prenotazioni con lo schema scelto nella scheda Naming
    res = client.post(f"/projects/{w.project_id}/naming/reservations", headers=des,
                      json={"fields": {}, "count": 2, "profile_id": prof["id"]})
    assert res.status_code == 201, res.text
    assert [r["identifier"] for r in res.json()] == [f"PRJ01-DES-{code}-0008", f"PRJ01-DES-{code}-0009"]


def test_documento_esistente_tiene_il_suo_identificativo(client, api_world, as_user, profiles):
    _, w = api_world
    des = as_user("des_lead")
    folder = w.containers["des_arch_det"]
    name = des_name()
    first = upload(client, des, folder, name, PDF, title="Dettaglio prima dello schema")
    assert first.status_code == 200, first.text
    prof = profiles("Dettagli", naming_scheme=photo_scheme("DT"))
    client.put(f"/naming-profiles/{prof['id']}/containers", headers=as_user("com_admin"), json={"container_ids": [str(folder)]})
    check = client.post(f"/projects/{w.project_id}/naming/validate", headers=des,
                        json={"name": name, "container_id": str(folder)}).json()
    assert check["valid"] and check["existing_document_id"] == first.json()["document_id"]
    again = upload(client, des, folder, name, PDF, expected=first.json()["revision_code"])
    assert again.status_code == 200, again.text
    assert again.json()["document_id"] == first.json()["document_id"]


def test_assegnazione_esatta_ed_eliminazione(client, api_world, as_user, profiles):
    _, w = api_world
    admin = as_user("com_admin")
    a, b = str(w.containers["sub1_root"]), str(w.containers["sub2_root"])
    one, two = profiles("Uno", naming_scheme=photo_scheme("U1")), profiles("Due", naming_scheme=photo_scheme("U2"))
    url = f"/naming-profiles/{one['id']}/containers"
    assert sorted(client.put(url, headers=admin, json={"container_ids": [a, b]}).json()["container_ids"]) == sorted([a, b])
    assert client.put(url, headers=admin, json={"container_ids": [b]}).json()["container_ids"] == [b]
    assert client.get(f"/containers/{a}/naming", headers=admin).json()["profile"] is None
    # una cartella passa da uno schema all'altro
    client.put(f"/naming-profiles/{two['id']}/containers", headers=admin, json={"container_ids": [b]})
    listed = {p["id"]: p for p in client.get(f"/projects/{w.project_id}/naming-profiles", headers=admin).json()}
    assert listed[one["id"]]["container_ids"] == [] and listed[two["id"]]["container_ids"] == [b]
    assert client.delete(f"/naming-profiles/{two['id']}", headers=admin).status_code == 204
    assert client.get(f"/containers/{b}/naming", headers=admin).json()["profile"] is None
    # cartella di un altro progetto
    out = client.put(url, headers=admin, json={"container_ids": [str(w.containers["out_root"])]})
    assert out.status_code == 404
    containers = client.get(f"/projects/{w.project_id}/containers", headers=admin).json()
    assert all("naming_profile_id" in c for c in containers)
