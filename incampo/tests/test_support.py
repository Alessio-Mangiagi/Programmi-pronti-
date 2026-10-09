"""Segnalazioni all'amministratore: invio da qualsiasi utente, notifica agli admin, gestione admin."""
from app import models, notify
from app.notify import process_pending
from app.routers import support as support_router
from tests.conftest import make_user
from tests.test_notify import FakeEmail, FakePush


def test_field_user_writes_admins_get_email(client, project, users, monkeypatch):
    monkeypatch.setattr(notify, "WEB_URL", "https://fv.example")
    with client.session_factory() as s:
        make_user(s, "admin2@test.local", "admin")
        spento = make_user(s, "admin3@test.local", "admin")
        spento.is_active = False
        s.commit()
    pid = project["project"]["id"]
    r = client.post("/support/messages", headers=users["field"]["headers"],
                    json={"message": "  Non riesco a caricare le foto  ", "project_id": pid, "page": "/projects/x/plans"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["message"] == "Non riesco a caricare le foto" and body["status"] == "open"
    assert body["user_email"] == "field@test.local" and body["project_name"] == "Cantiere A"

    email = FakeEmail()
    with client.session_factory() as s:
        process_pending(s, email, FakePush())
    # email a tutti gli admin attivi (push senza token → failed, non conta qui)
    assert sorted(to for to, _, _ in email.sent) == ["admin2@test.local", "admin@test.local"]
    _, subject, text = email.sent[0]
    assert subject == "Segnalazione da field"
    assert "field (field@test.local) ha scritto all'amministratore dal cantiere Cantiere A" in text
    assert "Non riesco a caricare le foto" in text and "Pagina: /projects/x/plans" in text
    assert "https://fv.example/admin/segnalazioni" in text


def test_validation_and_project_access(client, project, users):
    h = users["outsider"]["headers"]
    assert client.post("/support/messages", headers=h, json={"message": "   "}).status_code == 422
    assert client.post("/support/messages", headers=h, json={"message": ""}).status_code == 422
    assert client.post("/support/messages", headers=h, json={"message": "x" * 4001}).status_code == 422
    # cantiere non suo: 403; senza cantiere va bene
    assert client.post("/support/messages", headers=h,
                       json={"message": "aiuto", "project_id": project["project"]["id"]}).status_code == 403
    assert client.post("/support/messages", headers=h, json={"message": "aiuto"}).status_code == 201
    assert client.post("/support/messages", headers={"Authorization": ""}, json={"message": "aiuto"}).status_code == 401


def test_rate_limit(client, users, monkeypatch):
    monkeypatch.setattr(support_router, "SUPPORT_MAX_PER_HOUR", 2)
    h = users["field"]["headers"]
    assert client.post("/support/messages", headers=h, json={"message": "1"}).status_code == 201
    assert client.post("/support/messages", headers=h, json={"message": "2"}).status_code == 201
    assert client.post("/support/messages", headers=h, json={"message": "3"}).status_code == 429
    # il limite è per utente
    assert client.post("/support/messages", headers=users["manager"]["headers"], json={"message": "1"}).status_code == 201


def test_admin_lists_and_closes(client, users):
    mid = client.post("/support/messages", headers=users["field"]["headers"], json={"message": "Problema"}).json()["id"]
    # solo admin legge e gestisce
    assert client.get("/support/messages", headers=users["manager"]["headers"]).status_code == 403
    assert client.patch(f"/support/messages/{mid}", headers=users["manager"]["headers"],
                        json={"status": "closed"}).status_code == 403
    assert [m["id"] for m in client.get("/support/messages").json()] == [mid]

    r = client.patch(f"/support/messages/{mid}", json={"status": "closed"})
    assert r.status_code == 200 and r.json()["status"] == "closed" and r.json()["closed_by_name"] == "admin"
    assert client.get("/support/messages", params={"status": "open"}).json() == []
    assert [m["id"] for m in client.get("/support/messages", params={"status": "closed"}).json()] == [mid]
    r = client.patch(f"/support/messages/{mid}", json={"status": "open"})
    assert r.json()["status"] == "open" and r.json()["closed_at"] is None
    assert client.patch(f"/support/messages/{mid}", json={"status": "boh"}).status_code == 422
    assert client.patch("/support/messages/nope", json={"status": "closed"}).status_code == 404
    actions = [a["action"] for a in client.get("/audit").json()["items"]]
    assert {"support.message_sent", "support.message_closed", "support.message_reopened"} <= set(actions)
    # la notifica al mittente admin non parte (è l'autore): qui scrive field, quindi solo admin
    with client.session_factory() as s:
        assert {n.user.email for n in s.query(models.Notification).all()} == {"admin@test.local"}
