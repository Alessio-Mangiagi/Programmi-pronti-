"""
Test degli endpoint web: /submissions, /tasks, /pins/{id} e della
validazione delle submission nel sync push.
"""
import uuid
from datetime import datetime, timezone

import pytest

from tests.test_sync import client, project  # noqa: F401  (fixture)


@pytest.fixture()
def pin(client, project):  # noqa: F811
    pin_id = str(uuid.uuid4())
    r = client.post("/sync/push", json={"pins": [{
        "id": pin_id, "plan_id": project["plan"]["id"], "x": 0.5, "y": 0.5,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }]})
    assert r.json()["pins"]["inserted"] == 1
    return pin_id


def push(client, **groups):  # noqa: F811
    now = datetime.now(timezone.utc).isoformat()
    for items in groups.values():
        for it in items:
            it.setdefault("id", str(uuid.uuid4()))
            it.setdefault("updated_at", now)
    return client.post("/sync/push", json=groups).json()


# ---------- submissions ----------

def test_create_submission_valid(client, project, pin):  # noqa: F811
    r = client.post("/submissions", json={
        "template_id": project["template"]["id"], "pin_id": pin,
        "data_json": {"esito": "Conforme"}, "submitted_by": "u1",
    })
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["data_json"] == {"esito": "Conforme"} and body["attachments"] == []
    assert client.get(f"/submissions/{body['id']}").json()["id"] == body["id"]


def test_create_submission_invalid_data(client, project, pin):  # noqa: F811
    r = client.post("/submissions", json={
        "template_id": project["template"]["id"], "pin_id": pin,
        "data_json": {"esito": "Boh", "extra": 1},
    })
    assert r.status_code == 422
    assert {e["field"]: e["message"] for e in r.json()["detail"]} == {
        "esito": "not one of options", "extra": "unknown field",
    }


def test_create_submission_unknown_template_or_pin(client, project, pin):  # noqa: F811
    base = {"data_json": {}}
    assert client.post("/submissions", json={**base, "template_id": "nope", "pin_id": pin}).status_code == 404
    assert client.post("/submissions", json={**base, "template_id": project["template"]["id"], "pin_id": "nope"}).status_code == 404


def test_sync_push_rejects_invalid_submission_with_reason(client, project, pin):  # noqa: F811
    bad, good = str(uuid.uuid4()), str(uuid.uuid4())
    r = push(client, submissions=[
        {"id": bad, "template_id": project["template"]["id"], "pin_id": pin, "data_json": {"esito": "Boh"}},
        {"id": good, "template_id": project["template"]["id"], "pin_id": pin, "data_json": {"esito": "Conforme"}},
    ])
    assert r["submissions"]["inserted"] == 1
    assert r["submissions"]["rejected"] == [{"id": bad, "reason": "data_json: esito: not one of options"}]


def test_sync_push_delete_skips_validation(client, project, pin):  # noqa: F811
    """Cancellare una submission con dati ormai non validi deve funzionare."""
    sid = str(uuid.uuid4())
    push(client, submissions=[{"id": sid, "template_id": project["template"]["id"], "pin_id": pin,
                               "data_json": {"esito": "Conforme"}}])
    r = push(client, submissions=[{"id": sid, "template_id": project["template"]["id"], "pin_id": pin,
                                   "data_json": {"esito": "ROTTO"},
                                   "deleted_at": datetime.now(timezone.utc).isoformat()}])
    assert r["submissions"]["updated"] == 1 and r["submissions"]["rejected"] == []


def test_sync_push_rejects_invalid_task_status(client, pin):  # noqa: F811
    r = push(client, tasks=[{"pin_id": pin, "title": "x", "status": "done"}])
    assert r["tasks"]["rejected"][0]["reason"] == "invalid status 'done'"


# ---------- tasks ----------

def test_task_lifecycle_open_to_verified(client, project, pin):  # noqa: F811
    r = client.post("/tasks", json={"pin_id": pin, "title": "Quadro aperto"})
    assert r.status_code == 201 and r.json()["status"] == "open"
    tid = r.json()["id"]

    # open -> assigned richiede assegnatario
    assert client.patch(f"/tasks/{tid}", json={"status": "assigned"}).status_code == 409
    r = client.patch(f"/tasks/{tid}", json={"status": "assigned", "assigned_to": "mario"})
    assert r.json()["status"] == "assigned" and r.json()["assigned_to"] == "mario"

    # assigned -> verified salta un passaggio
    r = client.patch(f"/tasks/{tid}", json={"status": "verified"})
    assert r.status_code == 409 and "assigned to verified" in r.json()["detail"]

    assert client.patch(f"/tasks/{tid}", json={"status": "resolved"}).json()["status"] == "resolved"
    assert client.patch(f"/tasks/{tid}", json={"status": "verified"}).json()["status"] == "verified"
    # stato finale
    assert client.patch(f"/tasks/{tid}", json={"status": "open"}).status_code == 409
    # stesso stato = no-op
    assert client.patch(f"/tasks/{tid}", json={"status": "verified"}).status_code == 200


def test_task_reopen_from_resolved(client, pin):  # noqa: F811
    tid = client.post("/tasks", json={"pin_id": pin, "title": "t", "assigned_to": "anna"}).json()["id"]
    assert client.get(f"/tasks/{tid}").json()["status"] == "assigned"
    client.patch(f"/tasks/{tid}", json={"status": "resolved"})
    assert client.patch(f"/tasks/{tid}", json={"status": "open"}).json()["status"] == "open"


def test_task_assigning_open_task_moves_to_assigned(client, pin):  # noqa: F811
    tid = client.post("/tasks", json={"pin_id": pin, "title": "t"}).json()["id"]
    r = client.patch(f"/tasks/{tid}", json={"assigned_to": "luca", "due_date": "2026-10-01T00:00:00Z"})
    assert r.json()["status"] == "assigned" and r.json()["due_date"] == "2026-10-01T00:00:00"


def test_task_invalid_status_and_not_found(client, pin):  # noqa: F811
    tid = client.post("/tasks", json={"pin_id": pin, "title": "t"}).json()["id"]
    assert client.patch(f"/tasks/{tid}", json={"status": "done"}).status_code == 422
    assert client.patch("/tasks/nope", json={"title": "x"}).status_code == 404
    assert client.post("/tasks", json={"pin_id": "nope", "title": "t"}).status_code == 404


def test_task_delete_is_soft_and_synced(client, project, pin):  # noqa: F811
    tid = client.post("/tasks", json={"pin_id": pin, "title": "t"}).json()["id"]
    assert client.delete(f"/tasks/{tid}").status_code == 204
    assert client.get(f"/tasks/{tid}").status_code == 404
    assert client.delete(f"/tasks/{tid}").status_code == 404
    pulled = client.get("/sync/pull", params={"project_id": project["project"]["id"]}).json()["tasks"]
    assert [t["deleted_at"] is not None for t in pulled if t["id"] == tid] == [True]


def test_list_tasks_filters(client, project, pin):  # noqa: F811
    pid = project["project"]["id"]
    other_plan = client.post("/plans", json={
        "project_id": pid, "name": "P1", "file_url": "x", "width_px": 1, "height_px": 1}).json()
    other_pin = str(uuid.uuid4())
    push(client, pins=[{"id": other_pin, "plan_id": other_plan["id"], "x": 0.1, "y": 0.1}])

    a = client.post("/tasks", json={"pin_id": pin, "title": "a"}).json()["id"]
    b = client.post("/tasks", json={"pin_id": pin, "title": "b", "assigned_to": "anna"}).json()["id"]
    c = client.post("/tasks", json={"pin_id": other_pin, "title": "c", "assigned_to": "anna"}).json()["id"]
    client.delete(f"/tasks/{c}")
    d = client.post("/tasks", json={"pin_id": other_pin, "title": "d"}).json()["id"]

    ids = lambda **params: {t["id"] for t in client.get(f"/projects/{pid}/tasks", params=params).json()}
    assert ids() == {a, b, d}                       # c cancellato
    assert ids(status="open") == {a, d}
    assert ids(assigned_to="anna") == {b}
    assert ids(plan_id=other_plan["id"]) == {d}
    assert ids(status="assigned", plan_id=project["plan"]["id"]) == {b}
    assert client.get(f"/projects/{pid}/tasks", params={"status": "nope"}).status_code == 422
    assert client.get("/projects/nope/tasks").status_code == 404


# ---------- pin detail ----------

def test_pin_detail_nested(client, project, pin):  # noqa: F811
    sub = client.post("/submissions", json={
        "template_id": project["template"]["id"], "pin_id": pin, "data_json": {"esito": "Non conforme"}}).json()
    task = client.post("/tasks", json={"pin_id": pin, "title": "fix"}).json()
    deleted_task = client.post("/tasks", json={"pin_id": pin, "title": "gone"}).json()
    client.delete(f"/tasks/{deleted_task['id']}")
    att_sub, att_task, att_gone = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    push(client, attachments=[
        {"id": att_sub, "submission_id": sub["id"], "file_url": "s3://a.jpg", "file_type": "photo"},
        {"id": att_task, "task_id": task["id"], "file_url": "s3://b.jpg", "file_type": "photo"},
        {"id": att_gone, "task_id": task["id"], "file_url": "s3://c.jpg",
         "deleted_at": datetime.now(timezone.utc).isoformat()},
    ])

    r = client.get(f"/pins/{pin}")
    assert r.status_code == 200
    body = r.json()
    assert body["x"] == 0.5
    assert [s["id"] for s in body["submissions"]] == [sub["id"]]
    assert [a["id"] for a in body["submissions"][0]["attachments"]] == [att_sub]
    assert [t["id"] for t in body["tasks"]] == [task["id"]]
    assert [a["id"] for a in body["tasks"][0]["attachments"]] == [att_task]
    assert client.get("/pins/nope").status_code == 404
