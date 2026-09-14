"""
Test end-to-end del protocollo di sync su SQLite in memoria.
Esecuzione: pytest -q
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app.database import get_db
from app.main import app


@pytest.fixture()
def client():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    models.Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)

    def override():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture()
def project(client):
    """Progetto + planimetria + template creati da web."""
    p = client.post("/projects", json={"name": "Cantiere A"}).json()
    plan = client.post("/plans", json={
        "project_id": p["id"], "name": "Piano terra",
        "file_url": "s3://x/pt.png", "width_px": 1000, "height_px": 800,
    }).json()
    tpl = client.post("/form-templates", json={
        "name": "Ispezione", "schema_json": {"fields": []},
    }).json()
    return {"project": p, "plan": plan, "template": tpl}


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
    assert second == {"inserted": 0, "updated": 0, "skipped": 1, "rejected": []}
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
    assert r["pins"]["skipped"] == 1
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
    assert r["tasks"]["rejected"] == [bad]


def test_pull_unknown_project_404(client):
    assert client.get("/sync/pull", params={"project_id": "x"}).status_code == 404


def test_pin_coords_validated(client, project):
    r = client.post("/sync/push", json={"pins": [{
        "id": str(uuid.uuid4()), "plan_id": project["plan"]["id"],
        "x": 1.5, "y": 0.1, "updated_at": iso(datetime.now(timezone.utc))}]})
    assert r.status_code == 422
