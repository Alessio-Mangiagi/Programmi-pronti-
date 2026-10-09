"""GET /projects/{id}/stats: aggregati corretti, filtri, e tempo di risposta su 5.000 task."""
import random
import time
import uuid
from datetime import datetime, timedelta

from app import models
from app.models import utcnow
from tests.conftest import push


def test_stats_counts_filters_and_series(client, project, pin, users):
    pid = project["project"]["id"]
    plan_id = project["plan"]["id"]
    tpl = project["template"]["id"]
    anna = users["field"]["id"]
    other_plan = client.post("/plans", json={"project_id": pid, "name": "P1", "file_url": "x", "width_px": 1, "height_px": 1}).json()
    other_pin = str(uuid.uuid4())
    push(client, pins=[{"id": other_pin, "plan_id": other_plan["id"], "x": 0.1, "y": 0.1}])

    a = client.post("/tasks", json={"pin_id": pin, "title": "a"}).json()                       # open
    b = client.post("/tasks", json={"pin_id": pin, "title": "b", "assigned_to": anna}).json()   # assigned
    c = client.post("/tasks", json={"pin_id": other_pin, "title": "c", "assigned_to": anna,
                                    "due_date": "2020-01-01T00:00:00"}).json()                  # assigned, scaduto
    d = client.post("/tasks", json={"pin_id": other_pin, "title": "d", "assigned_to": anna}).json()
    client.patch(f"/tasks/{d['id']}", json={"status": "resolved"})                              # resolved oggi
    gone = client.post("/tasks", json={"pin_id": pin, "title": "gone"}).json()
    client.delete(f"/tasks/{gone['id']}")
    client.post("/submissions", json={"template_id": tpl, "pin_id": pin, "data_json": {"esito": "Conforme"}})
    client.post("/submissions", json={"template_id": tpl, "pin_id": other_pin, "data_json": {"esito": "Non conforme"}})

    r = client.get(f"/projects/{pid}/stats")
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["tasks_by_status"] == {"open": 1, "assigned": 2, "resolved": 1, "verified": 0}
    assert s["tasks_total"] == 4
    assert {(x["plan_name"], x["open"]) for x in s["open_by_plan"]} == {("Piano terra", 2), ("P1", 1)}
    assert s["overdue"] == 1
    assert s["closed_last_7d"] == 1
    assert s["submissions_by_template"] == [{"template_id": tpl, "template_name": "Ispezione", "count": 2}]
    assert s["pins_total"] == 2
    assert len(s["series"]) == 30
    today = utcnow().date().isoformat()
    assert s["series"][-1] == {"date": today, "created": 4, "resolved": 1}
    assert all(p["created"] == 0 and p["resolved"] == 0 for p in s["series"][:-1])
    # resolved_at esposto e azzerato alla riapertura
    assert client.get(f"/tasks/{d['id']}").json()["resolved_at"]
    client.patch(f"/tasks/{d['id']}", json={"status": "open"})
    assert client.get(f"/tasks/{d['id']}").json()["resolved_at"] is None

    # filtri
    s = client.get(f"/projects/{pid}/stats", params={"plan_id": other_plan["id"]}).json()
    assert s["tasks_total"] == 2 and [x["plan_name"] for x in s["open_by_plan"]] == ["P1"] and s["pins_total"] == 1
    s = client.get(f"/projects/{pid}/stats", params={"assigned_to": anna}).json()
    assert s["tasks_total"] == 3 and s["series"][-1]["created"] == 3
    s = client.get(f"/projects/{pid}/stats", params={"date_to": "2020-12-31"}).json()
    assert s["tasks_total"] == 0 and s["submissions_total"] == 0 and len(s["series"]) == 30
    s = client.get(f"/projects/{pid}/stats", params={"template_id": "nope"}).json()
    assert s["submissions_by_template"] == []
    s = client.get(f"/projects/{pid}/stats", params={"days": 7}).json()
    assert len(s["series"]) == 7
    assert client.get(f"/projects/{pid}/stats", params={"days": 3}).status_code == 422
    assert client.get(f"/projects/{pid}/stats", headers=users["outsider"]["headers"]).status_code == 403
    _ = (a, b, c)


def test_resolved_at_from_sync_push(client, project, pin):
    tid = str(uuid.uuid4())
    push(client, tasks=[{"id": tid, "pin_id": pin, "title": "x", "status": "open"}])
    assert client.get(f"/tasks/{tid}").json()["resolved_at"] is None
    later = (utcnow() + timedelta(seconds=5)).isoformat()
    push(client, tasks=[{"id": tid, "pin_id": pin, "title": "x", "status": "resolved", "updated_at": later}])
    assert client.get(f"/tasks/{tid}").json()["resolved_at"]


def test_stats_under_300ms_with_5000_tasks(client, project):
    pid = project["project"]["id"]
    plan_id = project["plan"]["id"]
    now = utcnow()
    with client.session_factory() as s:
        pins = [models.Pin(id=str(uuid.uuid4()), plan_id=plan_id, x=random.random(), y=random.random(),
                           created_at=now, updated_at=now) for _ in range(200)]
        s.add_all(pins)
        s.flush()
        tasks = []
        for i in range(5000):
            created = now - timedelta(days=random.randint(0, 60), hours=random.randint(0, 23))
            status = random.choice(list(models.TaskStatus))
            tasks.append(models.Task(id=str(uuid.uuid4()), pin_id=random.choice(pins).id, title=f"t{i}", status=status,
                                     due_date=now - timedelta(days=1) if i % 10 == 0 else None,
                                     resolved_at=created + timedelta(days=1) if status in (models.TaskStatus.resolved, models.TaskStatus.verified) else None,
                                     created_at=created, updated_at=created))
        s.bulk_save_objects(tasks)
        s.commit()
    client.get(f"/projects/{pid}/stats")  # warm-up
    t0 = time.perf_counter()
    r = client.get(f"/projects/{pid}/stats")
    elapsed = time.perf_counter() - t0
    assert r.status_code == 200
    assert r.json()["tasks_total"] == 5000
    assert elapsed < 0.3, f"stats in {elapsed:.3f}s"
