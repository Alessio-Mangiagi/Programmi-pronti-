"""Worker notifiche: template, invio email/push con sender finti, esiti, token push."""
import json

from app import models, notify
from app.notify import process_pending


class FakeEmail:
    def __init__(self, fail_for=()):
        self.sent, self.fail_for = [], set(fail_for)

    def send(self, to, subject, body):
        if to in self.fail_for:
            raise RuntimeError("smtp down")
        self.sent.append((to, subject, body))


class FakePush:
    def __init__(self, invalid=()):
        self.sent, self.invalid = [], set(invalid)

    def send(self, tokens, title, body, data):
        self.sent.append((tuple(tokens), title, body, data))
        return [t for t in tokens if t in self.invalid]


def pending(db_factory):
    with db_factory() as s:
        return s.query(models.Notification).filter(models.Notification.status == "pending").count()


def test_email_and_push_delivery_with_links(client, project, pin, users, monkeypatch):
    monkeypatch.setattr(notify, "WEB_URL", "https://fv.example")
    anna = users["field"]
    client.post("/auth/me/push-token", headers=anna["headers"], json={"token": "ExponentPushToken[anna-1]", "platform": "android"})
    client.post("/tasks", headers=users["manager"]["headers"], json={"pin_id": pin, "title": "Fix quadro", "assigned_to": anna["id"]})
    assert pending(client.session_factory) == 2
    email, push = FakeEmail(), FakePush()
    with client.session_factory() as s:
        assert process_pending(s, email, push) == {"sent": 2, "failed": 0}
    assert len(email.sent) == 1
    to, subject, body = email.sent[0]
    assert to == "field@test.local"
    assert subject == "[Cantiere A] Task assegnato: Fix quadro"
    assert 'manager ti ha assegnato il task "Fix quadro"' in body
    assert f"https://fv.example/projects/{project['project']['id']}/plans/{project['plan']['id']}?pin={pin}" in body
    assert push.sent[0][0] == ("ExponentPushToken[anna-1]",)
    assert push.sent[0][3]["event"] == "task.assigned" and push.sent[0][3]["url"].endswith(f"?pin={pin}")
    with client.session_factory() as s:
        rows = s.query(models.Notification).all()
        assert all(r.status == "sent" and r.sent_at for r in rows)
        assert all(e.processed_at for e in s.query(models.Event).all())
    with client.session_factory() as s:
        assert process_pending(s, email, push) == {"sent": 0, "failed": 0}
    mine = client.get("/auth/me/notifications", headers=anna["headers"]).json()
    assert {m["status"] for m in mine} == {"sent"}


def test_failures_are_recorded_and_do_not_block(client, project, pin, users):
    anna = users["field"]
    # nessun token push registrato -> push fallisce; email ok
    client.post("/tasks", headers=users["manager"]["headers"], json={"pin_id": pin, "title": "A", "assigned_to": anna["id"]})
    email, push = FakeEmail(), FakePush()
    with client.session_factory() as s:
        assert process_pending(s, email, push) == {"sent": 1, "failed": 1}
        failed = s.query(models.Notification).filter(models.Notification.status == "failed").one()
        assert failed.channel == "push" and failed.error == "no push token"
        assert s.query(models.Event).filter(models.Event.type == "task.assigned").one().processed_at
    # smtp giù per Anna: email failed con errore, evento comunque processato
    client.post("/tasks", headers=users["manager"]["headers"], json={"pin_id": pin, "title": "B", "assigned_to": anna["id"]})
    with client.session_factory() as s:
        res = process_pending(s, FakeEmail(fail_for={"field@test.local"}), push)
        assert res["failed"] == 2  # email (smtp down) + push (nessun token)
        assert "smtp down" in s.query(models.Notification).filter(models.Notification.error.like("%smtp%")).one().error


def test_invalid_push_tokens_are_removed(client, project, pin, users):
    anna = users["field"]
    for tok in ("ExponentPushToken[old]", "ExponentPushToken[new]"):
        client.post("/auth/me/push-token", headers=anna["headers"], json={"token": tok})
    client.patch("/auth/me/preferences", headers=anna["headers"], json={"notify_email": False})
    client.post("/tasks", headers=users["manager"]["headers"], json={"pin_id": pin, "title": "A", "assigned_to": anna["id"]})
    push = FakePush(invalid={"ExponentPushToken[old]"})
    with client.session_factory() as s:
        assert process_pending(s, FakeEmail(), push) == {"sent": 1, "failed": 0}
        assert [t.token for t in s.query(models.PushToken).all()] == ["ExponentPushToken[new]"]
    # tutti invalidi -> failed
    client.post("/tasks", headers=users["manager"]["headers"], json={"pin_id": pin, "title": "B", "assigned_to": anna["id"]})
    with client.session_factory() as s:
        assert process_pending(s, FakeEmail(), FakePush(invalid={"ExponentPushToken[new]"})) == {"sent": 0, "failed": 1}
        assert s.query(models.PushToken).count() == 0
    # token passa a un altro utente al login su quel device; cancellazione solo dal proprietario
    client.post("/auth/me/push-token", headers=anna["headers"], json={"token": "ExponentPushToken[shared]"})
    client.post("/auth/me/push-token", headers=users["manager"]["headers"], json={"token": "ExponentPushToken[shared]", "platform": "ios"})
    with client.session_factory() as s:
        row = s.get(models.PushToken, "ExponentPushToken[shared]")
        assert row.user_id == users["manager"]["id"] and row.platform == "ios"
    assert client.delete("/auth/me/push-token/ExponentPushToken[shared]", headers=anna["headers"]).status_code == 204
    with client.session_factory() as s:
        assert s.query(models.PushToken).count() == 1  # non suo: no-op
    assert client.delete("/auth/me/push-token/ExponentPushToken[shared]", headers=users["manager"]["headers"]).status_code == 204
    with client.session_factory() as s:
        assert s.query(models.PushToken).count() == 0
    assert client.post("/auth/me/push-token", headers=anna["headers"], json={"token": "short"}).status_code == 422


def test_submission_non_conformity_email_text(client, project, pin, users):
    client.post("/submissions", headers=users["field"]["headers"],
                json={"template_id": project["template"]["id"], "pin_id": pin, "data_json": {"esito": "Non conforme"}})
    email = FakeEmail()
    with client.session_factory() as s:
        process_pending(s, email, FakePush())
    assert {e[1] for e in email.sent} == {"[Cantiere A] Non conforme — Ispezione"}
    assert any('field ha compilato "Ispezione" con esito "Non conforme" (Esito)' in e[2] for e in email.sent)


def test_expo_sender_payload(monkeypatch):
    calls = {}

    class Resp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b'{"data":[{"status":"ok"},{"status":"error","details":{"error":"DeviceNotRegistered"}}]}'

    def fake_urlopen(req, timeout):
        calls["body"], calls["headers"] = req.data, dict(req.header_items())
        return Resp()

    monkeypatch.setattr(notify.urllib.request, "urlopen", fake_urlopen)
    sender = notify.ExpoPushSender("https://exp.host/--/api/v2/push/send", access_token="tok")
    assert sender.send(["A", "B"], "Titolo", "Corpo", {"url": "x"}) == ["B"]
    body = json.loads(calls["body"])
    assert body[0] == {"to": "A", "title": "Titolo", "body": "Corpo", "data": {"url": "x"}, "sound": "default"}
    assert calls["headers"]["Authorization"] == "Bearer tok"
