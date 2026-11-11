# "><(((º> sabusabu <º)))><"
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

from app import auth, models
from app import storage as st
from app.database import get_db
from app.main import app

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")

PASSWORD = "password123"


def make_user(session, email, role, name=None):
    u = models.User(email=email, name=name or email.split("@")[0], role=models.UserRole(role),
                    password_hash=auth.hash_password(PASSWORD))
    session.add(u)
    session.commit()
    session.refresh(u)
    return u


def login(client, email, password=PASSWORD) -> dict:
    """Header Authorization per agire come un altro utente: client.get(url, headers=login(...))."""
    r = client.post("/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


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
    with Session() as s:
        make_user(s, "admin@test.local", "admin")
    with TestClient(app) as c:
        # Di default il client agisce da admin; per altri utenti vedi login()/users
        c.headers.update(login(c, "admin@test.local"))
        c.session_factory = Session
        yield c
    app.dependency_overrides.clear()


@pytest.fixture()
def users(client, project):
    """manager e field membri del progetto, outsider senza membership."""
    with client.session_factory() as s:
        out = {}
        for role in ("manager", "field", "outsider"):
            u = make_user(s, f"{role}@test.local", "field" if role == "outsider" else role)
            out[role] = {"id": u.id, "email": u.email}
    pid = project["project"]["id"]
    for role in ("manager", "field"):
        assert client.post(f"/projects/{pid}/members", json={"user_id": out[role]["id"]}).status_code == 201
    for u in out.values():
        u["headers"] = login(client, u["email"])
    return out


@pytest.fixture(autouse=True)
def portale_password_spento(monkeypatch):
    """Il login prova la password del portale quando quella di InCampo non coincide: nei test
    il portale vero (localhost:8080) non va mai chiamato, né deve contare i tentativi sbagliati
    dei test. Di default "portale non raggiungibile"; i test della password del portale lo
    sostituiscono col loro finto."""
    from app.routers import suite as suite_router
    monkeypatch.setattr(suite_router.cosedil_sso, "verifica_password",
                        lambda *a, **k: {"ok": False, "reachable": False, "status": 0, "errore": "", "motivo": ""})


class PortaleProfiliFinto:
    """Finto ``POST /api/suite/profilo`` del portale (suite.profilo_portale): nei test il portale vero non va
    mai chiamato. Di default nessun utente del portale (ogni account è "solo InCampo", come prima dell'11/11);
    ``aggiungi`` registra un utente del portale ritrovabile per username o per email; ``giu`` lo spegne."""

    def __init__(self):
        self.profili: dict[str, dict] = {}
        self.giu = False
        self.chiamate: list[str] = []

    def aggiungi(self, username, email=None, *, ruolo="utente", nome=None, proprietario=False, disattivato=False,
                 abilitato=True):
        email = (email or f"{username}@cosedilspa.com").lower()
        p = {"username": username, "nome": nome or username, "email": email, "ruolo": ruolo,
             "admin": ruolo == "admin", "proprietario": proprietario, "disattivato": disattivato,
             "mustChange": False, "abilitato": abilitato}
        self.profili[username.lower()] = p
        self.profili[email] = p
        return p

    def togli(self, username):
        p = self.profili.pop(username.lower(), None)
        if p:
            self.profili.pop(p["email"], None)

    def __call__(self, login, timeout=3):
        self.chiamate.append(login)
        if self.giu:
            return {"raggiungibile": False, "trovato": False, "errore": "Portale non raggiungibile"}
        p = self.profili.get(str(login or "").strip().lower())
        if p is None:
            return {"raggiungibile": True, "trovato": False, "errore": ""}
        return {"raggiungibile": True, "trovato": True, "errore": "", **p}


@pytest.fixture(autouse=True)
def profili_portale(monkeypatch):
    """Il profilo del portale (login con la password di InCampo, proprietario della suite): sempre il finto."""
    from app.routers import suite as suite_router
    finto = PortaleProfiliFinto()
    monkeypatch.setattr(suite_router, "profilo_portale", finto)
    monkeypatch.setattr(suite_router, "SSO_ATTIVO", True)
    return finto


@pytest.fixture()
def proprietario(client, profili_portale):
    """L'admin del client (admin@test.local) è collegato all'utente del portale "a.mangiagi", proprietario della
    suite: può dare e togliere il ruolo di amministratore (regola dell'11/11/2026)."""
    with client.session_factory() as s:
        u = s.query(models.User).filter_by(email="admin@test.local").one()
        u.portale_username = "a.mangiagi"
        s.commit()
    return profili_portale.aggiungi("a.mangiagi", "admin@test.local", ruolo="admin", proprietario=True)


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
