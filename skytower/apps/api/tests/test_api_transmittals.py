# "><(((º> sabusabu <º)))><"
"""Sprint 6 (G54): transmittal — protocollo, destinatari, istantanea delle revisioni, ricezione, PDF."""
from __future__ import annotations

import psycopg
import pytest
from test_api_states import as_user, transition, wip, worker  # noqa: F401 - fixture riusate
from test_api_workflows import notifications, shared  # noqa: F401


def issue(client, headers, project_id, revision_ids, **extra):
    body = {"subject": "Emissione tavole architettoniche", "purpose": "APPROVAL", "revision_ids": revision_ids,
            "message": "Si trasmettono le tavole in revisione — per approvazione.", **extra}
    return client.post(f"/projects/{project_id}/transmittals", headers=headers, json=body)


@pytest.fixture
def transmittal(client, api_world, as_user, shared):  # noqa: F811
    _, w = api_world
    r = issue(client, as_user("des_lead"), w.project_id, [shared["id"]], recipient_organization_ids=[str(w.orgs["COM"])])
    assert r.status_code == 201, r.text
    return r.json()


def test_emissione_e_istantanea(client, api_world, as_user, transmittal, shared):  # noqa: F811
    _, w = api_world
    t = transmittal
    assert t["code"].startswith("TRM-") and t["purpose"] == "APPROVAL" and t["sent_by_my_org"]
    [item] = t["items"]
    assert item["revision_id"] == shared["id"] and item["state"] == "SHARED" and len(item["sha256"]) == 64
    assert t["recipients"][0]["organization_code"] == "COM" and t["receipts"] == []
    # numerazione progressiva per commessa
    again = issue(client, as_user("des_lead"), w.project_id, [shared["id"]], recipient_user_ids=[str(w.users["com_dl"])]).json()
    assert again["number"] == t["number"] + 1


def test_visibilita_e_conferma_di_ricezione(client, api_world, as_user, transmittal):  # noqa: F811
    _, w = api_world
    tid = transmittal["id"]
    dl = as_user("com_dl")
    assert any(n["data"].get("transmittal_id") == tid for n in notifications(client, dl, "TRANSMITTAL_RECEIVED"))
    assert any(x["id"] == tid for x in client.get("/me/transmittals", headers=dl).json())
    assert client.get(f"/transmittals/{tid}", headers=dl).json()["i_am_recipient"]
    for user in ("sub1_user", "out_user"):
        assert client.get(f"/transmittals/{tid}", headers=as_user(user)).status_code == 404, user
    assert not [x for x in client.get(f"/projects/{w.project_id}/transmittals", headers=as_user("sub1_user")).json()
                if x["id"] == tid]

    # solo i destinatari confermano
    assert client.post(f"/transmittals/{tid}/acknowledge", headers=as_user("des_lead")).status_code == 403
    r = client.post(f"/transmittals/{tid}/acknowledge", headers=dl)
    assert r.status_code == 200 and [k["organization_code"] for k in r.json()["receipts"]] == ["COM"]
    assert client.post(f"/transmittals/{tid}/acknowledge", headers=dl).json()["receipts"] == r.json()["receipts"]
    assert not any(x["id"] == tid for x in client.get("/me/transmittals", headers=dl).json())
    acks = notifications(client, as_user("des_lead"), "TRANSMITTAL_ACKNOWLEDGED")
    assert sum(n["data"].get("transmittal_id") == tid for n in acks) == 1

    sent = client.get(f"/projects/{w.project_id}/transmittals", headers=as_user("des_lead"), params={"direction": "sent"}).json()
    assert any(x["id"] == tid for x in sent)
    received = client.get(f"/projects/{w.project_id}/transmittals", headers=dl, params={"direction": "received"}).json()
    assert any(x["id"] == tid and x["acknowledged_by_me"] for x in received)


def test_pdf(client, as_user, transmittal):  # noqa: F811
    r = client.get(f"/transmittals/{transmittal['id']}/pdf", headers=as_user("com_dl"))
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF") and transmittal["code"] in r.headers["content-disposition"]
    assert client.get(f"/transmittals/{transmittal['id']}/pdf", headers=as_user("sub1_user")).status_code == 404


def test_validazioni(client, api_world, as_user, wip, shared):  # noqa: F811
    _, w = api_world
    lead = as_user("des_lead")
    com = [str(w.orgs["COM"])]
    assert issue(client, lead, w.project_id, [wip["id"]], recipient_organization_ids=com).status_code == 422   # WIP
    assert issue(client, lead, w.project_id, [shared["id"]]).status_code == 422                               # nessun destinatario
    assert issue(client, lead, w.project_id, [], recipient_organization_ids=com).status_code == 422
    assert issue(client, lead, w.project_id, [shared["id"], shared["id"]], recipient_organization_ids=com).status_code == 422
    assert issue(client, lead, w.project_id, [shared["id"]], recipient_organization_ids=[str(w.orgs["OUT"])]).status_code == 422
    assert issue(client, lead, w.project_id, [shared["id"]], recipient_organization_ids=com, purpose="X").status_code == 422
    # revisione che chi emette non vede
    assert issue(client, as_user("sub1_user"), w.project_id, [shared["id"]], recipient_organization_ids=com).status_code == 404


def test_registro_immutabile(api_world, transmittal):
    urls, _ = api_world
    with psycopg.connect(urls.owner) as conn:
        for sql in ("UPDATE cde.transmittals SET subject = 'x' WHERE id = %s",
                    "DELETE FROM cde.transmittal_items WHERE transmittal_id = %s"):
            with pytest.raises(psycopg.Error):
                conn.execute(sql, [transmittal["id"]])
            conn.rollback()
