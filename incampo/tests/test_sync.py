"""
Test end-to-end del protocollo di sync (fixture in conftest.py).
Esecuzione: pytest -q
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest


def iso(dt: datetime) -> str:
    return dt.isoformat()


def test_push_offline_batch_with_same_batch_fk(client, project):
    """Pin + submission + task + attachment creati offline nello stesso batch."""
    now = datetime.now(timezone.utc)
    pin_id, sub_id, task_id, att_id = (str(uuid.uuid4()) for _ in range(4))
    r = client.post("/sync/push", json={
        "pins": [{"id": pin_id, "plan_id": project["plan"]["id"],
                  "x": 0.5, "y": 0.25, "label": "Crepa", "updated_at": iso(now)}],
        "submissions": [{"id": sub_id, "template_id": project["template"]["id"],
                         "pin_id": pin_id, "data_json": {"esito": "Non conforme"},
                         "updated_at": iso(now)}],
        "tasks": [{"id": task_id, "pin_id": pin_id, "title": "Ripara",
                   "updated_at": iso(now)}],
        "attachments": [{"id": att_id, "task_id": task_id,
                         "file_url": "s3://x/foto.jpg", "file_type": "photo",
                         "updated_at": iso(now)}],
    })
    assert r.status_code == 200, r.text
    body = r.json()
    for key in ("pins", "submissions", "tasks", "attachments"):
        assert body[key]["inserted"] == 1, body
        assert body[key]["rejected"] == []

    # pull completo del progetto
    r = client.get("/sync/pull", params={"project_id": project["project"]["id"]})
    assert r.status_code == 200, r.text
    pull = r.json()
    assert [p["id"] for p in pull["pins"]] == [pin_id]
    assert [s["id"] for s in pull["submissions"]] == [sub_id]
    assert [t["id"] for t in pull["tasks"]] == [task_id]
    assert [a["id"] for a in pull["attachments"]] == [att_id]
    assert len(pull["plans"]) == 1 and len(pull["form_templates"]) == 1


def test_push_is_idempotent(client, project):
    now = datetime.now(timezone.utc)
    pin_id = str(uuid.uuid4())
    payload = {"pins": [{"id": pin_id, "plan_id": project["plan"]["id"],
                         "x": 0.1, "y": 0.1, "updated_at": iso(now)}]}
    assert client.post("/sync/push", json=payload).json()["pins"]["inserted"] == 1
    # retry di rete: stesso pacchetto due volte
    second = client.post("/sync/push", json=payload).json()["pins"]
    assert second == {"inserted": 0, "updated": 0, "skipped": 1, "skipped_ids": [pin_id], "lost_fields": {}, "rejected": []}
    pull = client.get("/sync/pull", params={"project_id": project["project"]["id"]}).json()
    assert len(pull["pins"]) == 1


def test_last_write_wins_and_tz_normalization(client, project):
    pin_id = str(uuid.uuid4())
    t0 = datetime(2026, 9, 14, 10, 0, tzinfo=timezone.utc)
    # device A, +02:00 (10:00Z == 12:00+02:00 → stesso istante di t0)
    client.post("/sync/push", json={"pins": [{
        "id": pin_id, "plan_id": project["plan"]["id"], "x": 0.1, "y": 0.1,
        "label": "A", "updated_at": "2026-09-14T12:00:00+02:00"}]})
    # device B, più vecchio → skipped
    r = client.post("/sync/push", json={"pins": [{
        "id": pin_id, "plan_id": project["plan"]["id"], "x": 0.9, "y": 0.9,
        "label": "OLD", "updated_at": iso(t0 - timedelta(minutes=5))}]}).json()
    assert r["pins"]["skipped"] == 1 and r["pins"]["skipped_ids"] == [pin_id]
    # device C, più nuovo → updated
    r = client.post("/sync/push", json={"pins": [{
        "id": pin_id, "plan_id": project["plan"]["id"], "x": 0.7, "y": 0.7,
        "label": "NEW", "updated_at": iso(t0 + timedelta(minutes=5))}]}).json()
    assert r["pins"]["updated"] == 1
    pin = client.get("/sync/pull", params={"project_id": project["project"]["id"]}).json()["pins"][0]
    assert pin["label"] == "NEW" and pin["x"] == 0.7


def test_pull_incremental_and_soft_delete(client, project):
    pid = project["project"]["id"]
    now = datetime.now(timezone.utc)
    pin_id = str(uuid.uuid4())
    client.post("/sync/push", json={"pins": [{
        "id": pin_id, "plan_id": project["plan"]["id"], "x": 0.1, "y": 0.1,
        "updated_at": iso(now)}]})
    since = client.get("/sync/pull", params={"project_id": pid}).json()["server_time"]

    # nulla cambiato → pull vuoto
    pull = client.get("/sync/pull", params={"project_id": pid, "since": since}).json()
    assert pull["pins"] == [] and pull["plans"] == [] and pull["form_templates"] == []

    # cancellazione offline → arriva agli altri device
    later = now + timedelta(minutes=1)
    client.post("/sync/push", json={"pins": [{
        "id": pin_id, "plan_id": project["plan"]["id"], "x": 0.1, "y": 0.1,
        "updated_at": iso(later), "deleted_at": iso(later)}]})
    pull = client.get("/sync/pull", params={"project_id": pid, "since": since}).json()
    assert len(pull["pins"]) == 1 and pull["pins"][0]["deleted_at"] is not None


def test_pull_is_scoped_to_project(client, project):
    other = client.post("/projects", json={"name": "Cantiere B"}).json()
    other_plan = client.post("/plans", json={
        "project_id": other["id"], "name": "P1",
        "file_url": "s3://y.png", "width_px": 10, "height_px": 10}).json()
    now = iso(datetime.now(timezone.utc))
    client.post("/sync/push", json={"pins": [
        {"id": str(uuid.uuid4()), "plan_id": project["plan"]["id"], "x": 0, "y": 0, "updated_at": now},
        {"id": str(uuid.uuid4()), "plan_id": other_plan["id"], "x": 0, "y": 0, "updated_at": now},
    ]})
    pull = client.get("/sync/pull", params={"project_id": other["id"]}).json()
    assert len(pull["pins"]) == 1 and pull["pins"][0]["plan_id"] == other_plan["id"]


def test_bad_fk_rejected_but_batch_applied(client, project):
    now = iso(datetime.now(timezone.utc))
    good, bad = str(uuid.uuid4()), str(uuid.uuid4())
    r = client.post("/sync/push", json={
        "pins": [{"id": good, "plan_id": project["plan"]["id"], "x": 0, "y": 0, "updated_at": now}],
        "tasks": [
            {"id": str(uuid.uuid4()), "pin_id": good, "title": "ok", "updated_at": now},
            {"id": bad, "pin_id": "non-esiste", "title": "ko", "updated_at": now},
        ],
    }).json()
    assert r["tasks"]["inserted"] == 1
    assert r["tasks"]["rejected"] == [{"id": bad, "reason": "pin_id not found"}]


def test_pull_unknown_project_404(client):
    assert client.get("/sync/pull", params={"project_id": "x"}).status_code == 404


def test_pin_coords_validated(client, project):
    r = client.post("/sync/push", json={"pins": [{
        "id": str(uuid.uuid4()), "plan_id": project["plan"]["id"],
        "x": 1.5, "y": 0.1, "updated_at": iso(datetime.now(timezone.utc))}]})
    assert r.status_code == 422


def test_field_level_merge_web_and_offline_device(client, project, pin):
    """Web assegna il task, il device (offline, prima) cambia il titolo: restano entrambi."""
    users = client.get(f"/projects/{project['project']['id']}/members").json()
    task = client.post("/tasks", json={"pin_id": pin, "title": "Originale"}).json()
    offline_edit = datetime.now(timezone.utc)
    client.patch(f"/tasks/{task['id']}", json={"assigned_to": users[0]["id"], "description": "dal web"})

    base = {"id": task["id"], "pin_id": pin, "status": "open", "assigned_to": None, "description": None}
    r = client.post("/sync/push", json={"tasks": [{
        **base, "title": "Dal telefono", "updated_at": iso(offline_edit), "changed_fields": ["title"]}]}).json()
    assert r["tasks"]["updated"] == 1 and r["tasks"]["lost_fields"] == {}
    t = client.get(f"/tasks/{task['id']}").json()
    assert (t["title"], t["status"], t["assigned_to"], t["description"]) == ("Dal telefono", "assigned", users[0]["id"], "dal web")

    # stesso campo toccato prima dal device e poi dal web: vince il web, il device lo sa
    r = client.post("/sync/push", json={"tasks": [{
        **base, "title": "x", "description": "vecchia", "updated_at": iso(offline_edit + timedelta(milliseconds=1)),
        "changed_fields": ["title", "description"]}]}).json()
    assert r["tasks"]["updated"] == 1 and r["tasks"]["lost_fields"] == {task["id"]: ["description"]}
    t = client.get(f"/tasks/{task['id']}").json()
    assert (t["title"], t["description"]) == ("x", "dal web")

    # tutti i campi persi → skipped come prima
    r = client.post("/sync/push", json={"tasks": [{
        **base, "title": "y", "description": "z", "updated_at": iso(offline_edit), "changed_fields": ["description"]}]}).json()
    assert r["tasks"]["skipped_ids"] == [task["id"]]


def test_changed_fields_ignores_unknown_and_server_only_fields(client, project, pin):
    att_id = str(uuid.uuid4())
    sub_id = str(uuid.uuid4())
    t0 = datetime.now(timezone.utc)
    client.post("/sync/push", json={"submissions": [{
        "id": sub_id, "template_id": project["template"]["id"], "pin_id": pin,
        "data_json": {"esito": "Conforme"}, "updated_at": iso(t0)}],
        "attachments": [{"id": att_id, "submission_id": sub_id, "file_type": "photo", "updated_at": iso(t0)}]})
    # file_url lo scrive solo l'upload: un push non lo tocca nemmeno se dichiarato
    r = client.post("/sync/push", json={"attachments": [{
        "id": att_id, "submission_id": sub_id, "file_url": "/files/evil", "file_type": "doc",
        "updated_at": iso(t0 + timedelta(seconds=1)), "changed_fields": ["file_url", "file_type", "id"]}]}).json()
    assert r["attachments"]["updated"] == 1
    pulled = client.get("/sync/pull", params={"project_id": project["project"]["id"]}).json()["attachments"][0]
    assert pulled["file_url"] is None and pulled["file_type"] == "doc"


def test_pull_cursor_is_server_time_not_device_time(client, project):
    """Push di un device rimasto offline a lungo (updated_at vecchio) arriva a chi ha già fatto pull dopo."""
    pid = project["project"]["id"]
    since = client.get("/sync/pull", params={"project_id": pid}).json()["server_time"]
    long_ago = datetime.now(timezone.utc) - timedelta(days=2)
    pin_id = str(uuid.uuid4())
    client.post("/sync/push", json={"pins": [{
        "id": pin_id, "plan_id": project["plan"]["id"], "x": 0.2, "y": 0.2, "updated_at": iso(long_ago)}]})
    pull = client.get("/sync/pull", params={"project_id": pid, "since": since}).json()
    assert [p["id"] for p in pull["pins"]] == [pin_id]
    assert set(pull["pins"][0]["field_times"]) == {"x", "y", "label", "deleted_at"}
