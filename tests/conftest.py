"""
Fixture condivise. Di default SQLite in memoria; con TEST_DATABASE_URL
(es. in CI) i test girano sul DB reale ricreando le tabelle a ogni test.
"""
import os
import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app import storage as st
from app.database import get_db
from app.main import app

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")


@pytest.fixture(scope="session")
def engine():
    if TEST_DATABASE_URL:
        return create_engine(TEST_DATABASE_URL)
    return create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)


@pytest.fixture()
def client(engine):
    models.Base.metadata.drop_all(bind=engine)
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


@pytest.fixture(autouse=True)
def tmp_storage(tmp_path, monkeypatch):
    monkeypatch.setattr(st.storage, "root", tmp_path / "storage")
    return st.storage


@pytest.fixture()
def project(client):
    """Progetto + planimetria + template creati da web."""
    p = client.post("/projects", json={"name": "Cantiere A"}).json()
    plan = client.post("/plans", json={
        "project_id": p["id"], "name": "Piano terra",
        "file_url": "s3://x/pt.png", "width_px": 1000, "height_px": 800,
    }).json()
    tpl = client.post("/form-templates", json={
        "name": "Ispezione",
        "schema_def": {"fields": [{"id": "esito", "type": "select", "label": "Esito",
                                   "options": ["Conforme", "Non conforme"]}]},
    }).json()
    return {"project": p, "plan": plan, "template": tpl}


@pytest.fixture()
def pin(client, project):
    pin_id = str(uuid.uuid4())
    r = client.post("/sync/push", json={"pins": [{
        "id": pin_id, "plan_id": project["plan"]["id"], "x": 0.5, "y": 0.5,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }]})
    assert r.json()["pins"]["inserted"] == 1
    return pin_id


def push(client, **groups):
    """Push di sync con id/updated_at generati se mancanti."""
    now = datetime.now(timezone.utc).isoformat()
    for items in groups.values():
        for it in items:
            it.setdefault("id", str(uuid.uuid4()))
            it.setdefault("updated_at", now)
    return client.post("/sync/push", json=groups).json()
