"""
Test degli endpoint web: /submissions, /tasks, /pins/{id} e della
validazione delle submission nel sync push.
"""
import uuid
from datetime import datetime, timezone

import pytest

from app import models
from tests.conftest import push


# ---------- submissions ----------

def test_create_submission_valid(client, project, pin):
    r = client.post("/submissions", json={
        "template_id": project["template"]["id"], "pin_id": pin,
        "data_json": {"esito": "Conforme"}, "submitted_by": "ignored",
    })
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["data_json"] == {"esito": "Conforme"} and body["attachments"] == []
    assert body["submitted_by"] == client.get("/auth/me").json()["id"]  # dal token, non dal payload
    assert client.get(f"/submissions/{body['id']}").json()["id"] == body["id"]


def test_create_submission_invalid_data(client, project, pin):
    r = client.post("/submissions", json={
        "template_id": project["template"]["id"], "pin_id": pin,
        "data_json": {"esito": "Boh", "extra": 1},
    })
    assert r.status_code == 422
    assert {e["field"]: e["message"] for e in r.json()["detail"]} == {
        "esito": "not one of options", "extra": "unknown field",
    }


def test_create_submission_unknown_template_or_pin(client, project, pin):
    base = {"data_json": {}}
    assert client.post("/submissions", json={**base, "template_id": "nope", "pin_id": pin}).status_code == 404
    assert client.post("/submissions", json={**base, "template_id": project["template"]["id"], "pin_id": "nope"}).status_code == 404


def test_sync_push_rejects_invalid_submission_with_reason(client, project, pin):
    bad, good = str(uuid.uuid4()), str(uuid.uuid4())
    r = push(client, submissions=[
        {"id": bad, "template_id": project["template"]["id"], "pin_id": pin, "data_json": {"esito": "Boh"}},
        {"id": good, "template_id": project["template"]["id"], "pin_id": pin, "data_json": {"esito": "Conforme"}},
    ])
    assert r["submissions"]["inserted"] == 1
    assert r["submissions"]["rejected"] == [{"id": bad, "reason": "data_json: esito: not one of options"}]


def test_sync_push_delete_skips_validation(client, project, pin):
    """Cancellare una submission con dati ormai non validi deve funzionare."""
    sid = str(uuid.uuid4())
    push(client, submissions=[{"id": sid, "template_id": project["template"]["id"], "pin_id": pin,
                               "data_json": {"esito": "Conforme"}}])
    r = push(client, submissions=[{"id": sid, "template_id": project["template"]["id"], "pin_id": pin,
                                   "data_json": {"esito": "ROTTO"},
                                   "deleted_at": datetime.now(timezone.utc).isoformat()}])
    assert r["submissions"]["updated"] == 1 and r["submissions"]["rejected"] == []


def test_sync_push_rejects_invalid_task_status(client, pin):
    r = push(client, tasks=[{"pin_id": pin, "title": "x", "status": "done"}])
    assert r["tasks"]["rejected"][0]["reason"] == "invalid status 'done'"


# ---------- tasks ----------

def test_task_lifecycle_open_to_verified(client, project, pin, users):
    r = client.post("/tasks", json={"pin_id": pin, "title": "Quadro aperto"})
    assert r.status_code == 201 and r.json()["status"] == "open"
    assert r.json()["created_by"] == client.get("/auth/me").json()["id"]
    tid = r.json()["id"]
    mario = users["field"]["id"]

    # open -> assigned richiede assegnatario (esistente)
    assert client.patch(f"/tasks/{tid}", json={"status": "assigned"}).status_code == 409
    assert client.patch(f"/tasks/{tid}", json={"status": "assigned", "assigned_to": "ghost"}).status_code == 422
    r = client.patch(f"/tasks/{tid}", json={"status": "assigned", "assigned_to": mario})
    assert r.json()["status"] == "assigned" and r.json()["assigned_to"] == mario

    # assigned -> verified salta un passaggio
    r = client.patch(f"/tasks/{tid}", json={"status": "verified"})
    assert r.status_code == 409 and "assigned to verified" in r.json()["detail"]

    assert client.patch(f"/tasks/{tid}", json={"status": "resolved"}).json()["status"] == "resolved"
    assert client.patch(f"/tasks/{tid}", json={"status": "verified"}).json()["status"] == "verified"
    # stato finale
    assert client.patch(f"/tasks/{tid}", json={"status": "open"}).status_code == 409
    # stesso stato = no-op
    assert client.patch(f"/tasks/{tid}", json={"status": "verified"}).status_code == 200


def test_task_reopen_from_resolved(client, pin, users):
    anna = users["field"]["id"]
    tid = client.post("/tasks", json={"pin_id": pin, "title": "t", "assigned_to": anna}).json()["id"]
    assert client.get(f"/tasks/{tid}").json()["status"] == "assigned"
    client.patch(f"/tasks/{tid}", json={"status": "resolved"})
    assert client.patch(f"/tasks/{tid}", json={"status": "open"}).json()["status"] == "open"


def test_task_assigning_open_task_moves_to_assigned(client, pin, users):
    tid = client.post("/tasks", json={"pin_id": pin, "title": "t"}).json()["id"]
    r = client.patch(f"/tasks/{tid}", json={"assigned_to": users["field"]["id"], "due_date": "2026-10-01T00:00:00Z"})
    assert r.json()["status"] == "assigned" and r.json()["due_date"] == "2026-10-01T00:00:00"


def test_task_invalid_status_and_not_found(client, pin):
    tid = client.post("/tasks", json={"pin_id": pin, "title": "t"}).json()["id"]
    assert client.post("/tasks", json={"pin_id": pin, "title": "t", "assigned_to": "ghost"}).status_code == 422
    assert client.patch(f"/tasks/{tid}", json={"status": "done"}).status_code == 422
    assert client.patch("/tasks/nope", json={"title": "x"}).status_code == 404
    assert client.post("/tasks", json={"pin_id": "nope", "title": "t"}).status_code == 404


def test_task_delete_is_soft_and_synced(client, project, pin):
    tid = client.post("/tasks", json={"pin_id": pin, "title": "t"}).json()["id"]
    assert client.delete(f"/tasks/{tid}").status_code == 204
    assert client.get(f"/tasks/{tid}").status_code == 404
    assert client.delete(f"/tasks/{tid}").status_code == 404
    pulled = client.get("/sync/pull", params={"project_id": project["project"]["id"]}).json()["tasks"]
    assert [t["deleted_at"] is not None for t in pulled if t["id"] == tid] == [True]


def test_list_tasks_filters(client, project, pin, users):
    pid = project["project"]["id"]
    anna = users["field"]["id"]
    other_plan = client.post("/plans", json={
        "project_id": pid, "name": "P1", "file_url": "x", "width_px": 1, "height_px": 1}).json()
    other_pin = str(uuid.uuid4())
    push(client, pins=[{"id": other_pin, "plan_id": other_plan["id"], "x": 0.1, "y": 0.1}])

    a = client.post("/tasks", json={"pin_id": pin, "title": "a"}).json()["id"]
    b = client.post("/tasks", json={"pin_id": pin, "title": "b", "assigned_to": anna}).json()["id"]
    c = client.post("/tasks", json={"pin_id": other_pin, "title": "c", "assigned_to": anna}).json()["id"]
    client.delete(f"/tasks/{c}")
    d = client.post("/tasks", json={"pin_id": other_pin, "title": "d"}).json()["id"]

    ids = lambda **params: {t["id"] for t in client.get(f"/projects/{pid}/tasks", params=params).json()}
    assert ids() == {a, b, d}                       # c cancellato
    assert ids(status="open") == {a, d}
    assert ids(assigned_to=anna) == {b}
    assert ids(plan_id=other_plan["id"]) == {d}
    assert ids(status="assigned", plan_id=project["plan"]["id"]) == {b}
    by_id = {t["id"]: t for t in client.get(f"/projects/{pid}/tasks").json()}
    assert (by_id[d]["plan_id"], by_id[d]["plan_name"], by_id[d]["pin_label"]) == (other_plan["id"], "P1", None)
    assert by_id[a]["plan_name"] == "Piano terra"
    assert client.get(f"/projects/{pid}/tasks", params={"status": "nope"}).status_code == 422
    assert client.get("/projects/nope/tasks").status_code == 404


def test_update_submission_validates_and_checks_owner(client, project, pin, users):
    tpl = project["template"]["id"]
    field = users["field"]["headers"]
    sub = client.post("/submissions", headers=field,
                      json={"template_id": tpl, "pin_id": pin, "data_json": {"esito": "Conforme"}}).json()
    url = f"/submissions/{sub['id']}"
    # chi l'ha compilata modifica
    r = client.patch(url, headers=field, json={"data_json": {"esito": "Non conforme"}})
    assert r.status_code == 200 and r.json()["data_json"] == {"esito": "Non conforme"}
    assert r.json()["updated_at"] > sub["updated_at"]
    # stessa validazione della creazione
    r = client.patch(url, headers=field, json={"data_json": {"esito": "Boh"}})
    assert r.status_code == 422 and r.json()["detail"][0]["field"] == "esito"
    # manager sì, altro field no, outsider 403 per progetto
    assert client.patch(url, headers=users["manager"]["headers"], json={"data_json": {"esito": "Conforme"}}).status_code == 200
    other = client.post("/users", json={"email": "altro@test.local", "password": "password123",
                                        "name": "Altro", "role": "field"}).json()
    client.post(f"/projects/{project['project']['id']}/members", json={"user_id": other["id"]})
    from tests.conftest import login
    assert client.patch(url, headers=login(client, "altro@test.local"), json={"data_json": {}}).status_code == 403
    assert client.patch(url, headers=users["outsider"]["headers"], json={"data_json": {}}).status_code == 403
    assert client.patch("/submissions/nope", json={"data_json": {}}).status_code == 404


def test_delete_attachment_soft(client, project, pin, users):
    tpl = project["template"]["id"]
    field = users["field"]["headers"]
    sub = client.post("/submissions", headers=field,
                      json={"template_id": tpl, "pin_id": pin, "data_json": {"esito": "Conforme"}}).json()
    att = client.post("/attachments", headers=field, json={"submission_id": sub["id"], "file_type": "photo"}).json()
    assert client.delete(f"/attachments/{att['id']}", headers=users["manager"]["headers"]).status_code == 204
    assert client.delete(f"/attachments/{att['id']}").status_code == 404          # già cancellato
    assert client.get(f"/pins/{pin}").json()["submissions"][0]["attachments"] == []
    att2 = client.post("/attachments", headers=field, json={"submission_id": sub["id"]}).json()
    from tests.conftest import login
    other = client.post("/users", json={"email": "altro@test.local", "password": "password123",
                                        "name": "Altro", "role": "field"}).json()
    client.post(f"/projects/{project['project']['id']}/members", json={"user_id": other["id"]})
    assert client.delete(f"/attachments/{att2['id']}", headers=login(client, "altro@test.local")).status_code == 403
    assert client.delete(f"/attachments/{att2['id']}", headers=field).status_code == 204
    pulled = client.get("/sync/pull", params={"project_id": project["project"]["id"]}).json()
    assert any(a["id"] == att2["id"] and a["deleted_at"] for a in pulled["attachments"])


# ---------- pin detail ----------

def test_pin_detail_nested(client, project, pin):
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


# ---------- pin della planimetria ----------

def test_list_plan_pins_with_counts(client, project, pin, users):
    plan_id = project["plan"]["id"]
    tpl = project["template"]["id"]
    client.post("/submissions", json={"template_id": tpl, "pin_id": pin, "data_json": {"esito": "Conforme"}})
    client.post("/submissions", json={"template_id": tpl, "pin_id": pin, "data_json": {"esito": "Conforme"}})
    client.post("/tasks", json={"pin_id": pin, "title": "a"})
    t = client.post("/tasks", json={"pin_id": pin, "title": "b", "assigned_to": users["field"]["id"]}).json()
    client.patch(f"/tasks/{t['id']}", json={"status": "resolved"})
    gone = client.post("/tasks", json={"pin_id": pin, "title": "c"}).json()
    client.delete(f"/tasks/{gone['id']}")
    empty_pin = str(uuid.uuid4())
    deleted_pin = str(uuid.uuid4())
    push(client, pins=[{"id": empty_pin, "plan_id": plan_id, "x": 0.2, "y": 0.2},
                       {"id": deleted_pin, "plan_id": plan_id, "x": 0.3, "y": 0.3,
                        "deleted_at": datetime.now(timezone.utc).isoformat()}])

    r = client.get(f"/plans/{plan_id}/pins")
    assert r.status_code == 200
    by_id = {p["id"]: p for p in r.json()}
    assert set(by_id) == {pin, empty_pin}
    assert by_id[pin]["submissions_count"] == 2
    assert (by_id[pin]["tasks_open"], by_id[pin]["tasks_assigned"], by_id[pin]["tasks_resolved"],
            by_id[pin]["tasks_verified"]) == (1, 0, 1, 0)
    assert by_id[empty_pin]["submissions_count"] == 0 and by_id[empty_pin]["tasks_open"] == 0

    assert client.get(f"/plans/{plan_id}/pins", headers=users["outsider"]["headers"]).status_code == 403
    assert client.get("/plans/nope/pins").status_code == 404
    assert client.get(f"/plans/{plan_id}").json()["name"] == "Piano terra"
    assert client.get(f"/plans/{plan_id}", headers=users["outsider"]["headers"]).status_code == 403


def test_list_plan_pins_filters(client, project, users):
    """Filtri per stato/assegnatario (stesso task), template e intervallo date di creazione."""
    plan_id = project["plan"]["id"]
    tpl = project["template"]["id"]
    tpl2 = client.post("/form-templates", json={
        "name": "Diario", "schema_def": {"fields": [{"id": "note", "type": "text", "label": "Note"}]}}).json()["id"]
    anna = users["field"]["id"]
    p_open, p_anna, p_sub, p_old, p_empty = (str(uuid.uuid4()) for _ in range(5))
    push(client, pins=[
        {"id": p_open, "plan_id": plan_id, "x": 0.1, "y": 0.1},
        {"id": p_anna, "plan_id": plan_id, "x": 0.2, "y": 0.2},
        {"id": p_sub, "plan_id": plan_id, "x": 0.3, "y": 0.3},
        {"id": p_old, "plan_id": plan_id, "x": 0.4, "y": 0.4},
        {"id": p_empty, "plan_id": plan_id, "x": 0.5, "y": 0.5},
    ])
    with client.session_factory() as s:  # created_at non è impostabile via API: pin "vecchio" forzato sul DB
        s.query(models.Pin).filter(models.Pin.id == p_old).update({"created_at": datetime(2020, 1, 1, 10, 0)})
        s.commit()
    client.post("/tasks", json={"pin_id": p_open, "title": "aperto"})
    t = client.post("/tasks", json={"pin_id": p_anna, "title": "di anna", "assigned_to": anna}).json()
    client.patch(f"/tasks/{t['id']}", json={"status": "resolved"})
    client.post("/tasks", json={"pin_id": p_anna, "title": "altro aperto"})
    gone = client.post("/tasks", json={"pin_id": p_empty, "title": "cancellato"}).json()
    client.delete(f"/tasks/{gone['id']}")
    client.post("/submissions", json={"template_id": tpl, "pin_id": p_sub, "data_json": {"esito": "Conforme"}})
    client.post("/submissions", json={"template_id": tpl2, "pin_id": p_old, "data_json": {"note": "x"}})

    ids = lambda **params: {p["id"] for p in client.get(f"/plans/{plan_id}/pins", params=params).json()}
    assert ids() == {p_open, p_anna, p_sub, p_old, p_empty}
    assert ids(status="open") == {p_open, p_anna}
    assert ids(status=["open", "resolved"]) == {p_open, p_anna}
    assert ids(status="verified") == set()
    assert ids(assigned_to=anna) == {p_anna}
    assert ids(status="open", assigned_to=anna) == set()          # stesso task: aperto E di anna
    assert ids(status="resolved", assigned_to=anna) == {p_anna}
    assert ids(template_id=tpl) == {p_sub}
    assert ids(template_id=tpl2) == {p_old}
    assert ids(template_id=tpl, status="open") == set()
    # date: il pin vecchio ha una submission creata oggi, quindi rientra nell'intervallo recente
    assert ids(date_from="2021-01-01") == {p_open, p_anna, p_sub, p_old, p_empty}
    assert ids(date_to="2020-12-31") == {p_old}
    assert ids(date_from="2019-12-31", date_to="2020-01-01") == {p_old}   # date_to include tutto il giorno
    assert ids(date_from="2020-01-02", date_to="2020-01-03") == set()
    assert client.get(f"/plans/{plan_id}/pins", params={"status": "nope"}).status_code == 422
    assert client.get(f"/plans/{plan_id}/pins", params={"date_from": "ieri"}).status_code == 422


# ---------- CRUD pin da web ----------

def test_pin_create_update_delete(client, project, users):
    plan_id = project["plan"]["id"]
    f, m, o = users["field"]["headers"], users["manager"]["headers"], users["outsider"]["headers"]

    r = client.post("/pins", json={"plan_id": plan_id, "x": 0.4, "y": 0.6, "label": "Colonna B3"}, headers=f)
    assert r.status_code == 201, r.text
    pin = r.json()
    assert pin["created_by"] == users["field"]["id"] and pin["x"] == 0.4
    assert client.post("/pins", json={"plan_id": plan_id, "x": 1.5, "y": 0}).status_code == 422
    assert client.post("/pins", json={"plan_id": "nope", "x": 0, "y": 0}).status_code == 404
    assert client.post("/pins", json={"plan_id": plan_id, "x": 0, "y": 0}, headers=o).status_code == 403

    r = client.patch(f"/pins/{pin['id']}", json={"x": 0.45, "label": "Colonna B4"}, headers=m)
    assert (r.json()["x"], r.json()["y"], r.json()["label"]) == (0.45, 0.6, "Colonna B4")
    assert client.patch(f"/pins/{pin['id']}", json={"x": 0.1}, headers=o).status_code == 403

    # contenuto agganciato: la cancellazione del pin cancella tutto in cascata (soft)
    task = client.post("/tasks", json={"pin_id": pin["id"], "title": "t"}).json()
    sub = client.post("/submissions", json={"template_id": project["template"]["id"], "pin_id": pin["id"],
                                            "data_json": {"esito": "Conforme"}}).json()
    att = client.post("/attachments", json={"task_id": task["id"]}).json()

    assert client.delete(f"/pins/{pin['id']}", headers=o).status_code == 403
    manager_pin = client.post("/pins", json={"plan_id": plan_id, "x": 0.1, "y": 0.1}, headers=m).json()
    assert client.delete(f"/pins/{manager_pin['id']}", headers=f).status_code == 403  # non creatore
    assert client.delete(f"/pins/{pin['id']}", headers=f).status_code == 204          # creatore
    assert client.get(f"/pins/{pin['id']}").status_code == 404
    assert client.get(f"/tasks/{task['id']}").status_code == 404
    assert client.get(f"/submissions/{sub['id']}").status_code == 404
    assert client.post("/attachments/presign", json={"attachment_id": att["id"]}).status_code == 404
    assert [p["id"] for p in client.get(f"/plans/{plan_id}/pins").json()] == [manager_pin["id"]]

    pulled = client.get("/sync/pull", params={"project_id": project["project"]["id"]}).json()
    deleted = {row["id"] for group in ("pins", "tasks", "submissions", "attachments")
               for row in pulled[group] if row["deleted_at"]}
    assert {pin["id"], task["id"], sub["id"], att["id"]} <= deleted


def test_tasks_page_server_side(client, project, pin, users):
    pid = project["project"]["id"]
    anna = users["field"]["id"]
    past = "2020-01-01T00:00:00"
    made = [client.post("/tasks", json={"pin_id": pin, "title": f"Task {i:02d}",
                                        "description": "crepa nel muro" if i % 5 == 0 else None,
                                        "assigned_to": anna if i % 2 else None,
                                        "due_date": past if i % 3 == 0 else None}).json()["id"] for i in range(25)]

    def page(**params):
        r = client.get(f"/projects/{pid}/tasks/page", params=params)
        assert r.status_code == 200, r.text
        return r.json()

    first = page(limit=10)
    assert first["total"] == 25 and len(first["items"]) == 10
    assert first["counts"] == {"open": 13, "assigned": 12, "resolved": 0, "verified": 0}
    seen = [t["id"] for o in (0, 10, 20) for t in page(limit=10, offset=o)["items"]]
    assert sorted(seen) == sorted(made)  # nessuna riga ripetuta o saltata tra le pagine

    assert [t["title"] for t in page(sort="title", desc=False, limit=3)["items"]] == ["Task 00", "Task 01", "Task 02"]
    assert page(q="CREPA")["total"] == 5
    assert page(status=["assigned"], assigned_to=anna)["total"] == 12
    assert page(status=["open", "assigned"])["total"] == 25
    assert page(overdue=True)["total"] == 9
    by_due = page(sort="due_date", desc=False, limit=25)["items"]
    assert all(t["due_date"] for t in by_due[:9]) and not any(t["due_date"] for t in by_due[9:])
    by_due_desc = page(sort="due_date", limit=25)["items"]
    assert not any(t["due_date"] for t in by_due_desc[9:])  # senza scadenza in fondo anche al contrario
    assert page(sort="status", desc=False, limit=1)["items"][0]["status"] == "open"
    assert page(sort="assigned_to", desc=False, limit=1)["items"][0]["assigned_to"] == anna
    assert page(sort="plan_name")["total"] == 25
    assert client.get(f"/projects/{pid}/tasks/page", params={"sort": "drop table"}).status_code == 422
    assert client.get(f"/projects/{pid}/tasks/page", params={"limit": 1000}).status_code == 422
    assert client.get("/projects/nope/tasks/page").status_code == 404
