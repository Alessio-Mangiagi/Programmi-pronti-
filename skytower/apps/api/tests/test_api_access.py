# "><(((º> sabusabu <º)))><"
"""Aree riservate: dentro solo admin o su richiesta approvata; anche i PUBLISHED restano chiusi."""
from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from test_api_documents import PDF, des_name, upload
from test_api_states import as_user, transition, visible, worker  # noqa: F401 - fixture riusate
from test_api_workflows import notifications


def folder_ids(client, headers, project_id) -> set[str]:
    return {c["id"] for c in client.get(f"/projects/{project_id}/containers", headers=headers).json()}


@pytest.fixture
def area(client, api_world, as_user):  # noqa: F811
    """Area riservata DES con una sottocartella, creata dall'admin dell'organizzazione."""
    _, w = api_world
    admin = as_user("des_admin")
    r = client.post(f"/projects/{w.project_id}/containers", headers=admin,
                    json={"name": f"DES - Riservato {uuid.uuid4().hex[:6]}", "is_private": True})
    assert r.status_code == 201, r.text
    root = r.json()
    sub = client.post(f"/projects/{w.project_id}/containers", headers=admin,
                      json={"name": "Offerte", "parent_id": root["id"]}).json()
    assert root["is_private"] and sub["is_private"]                       # la sottocartella eredita
    return root, sub


def test_area_riservata_solo_admin(client, api_world, as_user, area):  # noqa: F811
    _, w = api_world
    root, sub = area
    # chi non è admin non la crea
    r = client.post(f"/projects/{w.project_id}/containers", headers=as_user("des_lead"),
                    json={"name": "Mia area", "is_private": True})
    assert r.status_code == 403
    # per ruolo ci entrano solo gli admin (org proprietaria e Project Admin), non gli altri ruoli
    for user, expected in [("des_admin", True), ("com_admin", True), ("des_lead", False), ("des_designer", False),
                           ("com_im", False), ("com_dl", False), ("sub1_user", False)]:
        h = as_user(user)
        assert (root["id"] in folder_ids(client, h, w.project_id)) is expected, user
        assert (client.get(f"/containers/{sub['id']}", headers=h).status_code == 200) is expected, user
    # gli altri membri la vedono chiusa, un estraneo alla commessa no
    areas = {a["id"]: a for a in client.get(f"/projects/{w.project_id}/private-areas", headers=as_user("des_lead")).json()}
    assert root["id"] in areas and not areas[root["id"]]["has_access"] and sub["id"] not in areas
    assert client.get(f"/projects/{w.project_id}/private-areas", headers=as_user("out_user")).status_code == 404


def test_richiesta_approvata_con_scadenza(client, api_world, as_user, area):  # noqa: F811
    _, w = api_world
    root, sub = area
    lead, admin = as_user("des_lead"), as_user("des_admin")
    until = (datetime.now(UTC) + timedelta(days=7)).isoformat()
    r = client.post(f"/containers/{root['id']}/access-requests", headers=lead,
                    json={"reason": "Devo consultare le offerte", "valid_until": until})
    assert r.status_code == 201, r.text
    req = r.json()
    assert req["status"] == "PENDING" and not req["can_decide"]
    assert client.post(f"/containers/{root['id']}/access-requests", headers=lead,
                       json={"reason": "di nuovo"}).status_code == 409                     # una sola in attesa
    assert any(n["data"].get("request_id") == req["id"] for n in notifications(client, admin, "ACCESS_REQUESTED"))
    # il richiedente non decide da solo; chi non amministra l'area non vede la richiesta
    assert client.post(f"/access-requests/{req['id']}/decide", headers=lead, json={"approve": True}).status_code == 403
    assert req["id"] not in {x["id"] for x in client.get(f"/projects/{w.project_id}/access-requests",
                                                          headers=as_user("com_dl")).json()}
    pending = {x["id"]: x for x in client.get(f"/projects/{w.project_id}/access-requests?status=PENDING",
                                              headers=admin).json()}
    assert pending[req["id"]]["can_decide"]

    ok = client.post(f"/access-requests/{req['id']}/decide", headers=admin, json={"approve": True, "note": "Ok"})
    assert ok.status_code == 200 and ok.json()["status"] == "APPROVED", ok.text
    assert {root["id"], sub["id"]} <= folder_ids(client, lead, w.project_id)                # anche la sottocartella
    grant = next(g for g in client.get(f"/containers/{root['id']}/grants", headers=admin).json()
                 if g["grantee_user_name"] and g["valid_until"])
    assert grant["actions"] == ["READ", "DOWNLOAD"]
    assert any(n["data"].get("request_id") == req["id"] for n in notifications(client, lead, "ACCESS_GRANTED"))
    assert client.post(f"/access-requests/{req['id']}/decide", headers=admin,
                       json={"approve": False}).status_code == 422                          # già gestita
    assert client.post(f"/containers/{root['id']}/access-requests", headers=lead,
                       json={"reason": "ancora"}).status_code == 422                        # ha già accesso


def test_richiesta_rifiutata_e_annullata(client, api_world, as_user, area):  # noqa: F811
    _, w = api_world
    root, _ = area
    dl, admin = as_user("com_dl"), as_user("com_admin")                                    # decide anche il Project Admin
    req = client.post(f"/containers/{root['id']}/access-requests", headers=dl, json={"reason": "Verifica DL"}).json()
    r = client.post(f"/access-requests/{req['id']}/decide", headers=admin, json={"approve": False, "note": "Non serve"})
    assert r.json()["status"] == "REJECTED"
    assert root["id"] not in folder_ids(client, dl, w.project_id)
    assert any(n["data"].get("request_id") == req["id"] for n in notifications(client, dl, "ACCESS_REJECTED"))
    again = client.post(f"/containers/{root['id']}/access-requests", headers=dl, json={"reason": "Ci riprovo"}).json()
    assert client.post(f"/access-requests/{again['id']}/cancel", headers=admin).status_code == 404   # solo il richiedente
    assert client.post(f"/access-requests/{again['id']}/cancel", headers=dl).json()["status"] == "CANCELLED"


def test_nessuno_spostamento_dentro_o_fuori_area(client, api_world, as_user, area):  # noqa: F811
    _, w = api_world
    root, sub = area
    admin = as_user("des_admin")
    r = client.patch(f"/containers/{w.containers['des_arch']}", headers=admin, json={"parent_id": root["id"]})
    assert r.status_code == 422
    r = client.patch(f"/containers/{sub['id']}", headers=admin, json={"parent_id": str(w.containers["des_root"])})
    assert r.status_code == 422
    # una cartella normale non è richiedibile: si chiede la condivisione
    r = client.post(f"/containers/{w.containers['des_arch']}/access-requests", headers=as_user("sub1_user"),
                    json={"reason": "Fammi vedere"})
    assert r.status_code in (404, 422)


def test_pubblicato_in_area_riservata_resta_chiuso(client, api_world, as_user, area, worker):  # noqa: F811
    _, w = api_world
    root, _ = area
    admin = as_user("des_admin")
    rev = upload(client, admin, root["id"], des_name(), PDF, title="Offerta riservata").json()
    worker()
    shared = transition(client, admin, rev["id"], "SHARED", "S2").json()
    pub = transition(client, admin, shared["id"], "PUBLISHED", "A1", "Approvato").json()
    assert pub["state"] == "PUBLISHED", pub
    doc = pub["document_id"]
    assert visible(client, admin, doc) and visible(client, as_user("com_admin"), doc)
    for user in ("des_lead", "com_dl", "sub1_user"):
        assert not visible(client, as_user(user), doc), user
        assert client.get(f"/revisions/{pub['id']}/download", headers=as_user(user)).status_code in (403, 404)
