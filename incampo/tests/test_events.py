"""Eventi (outbox) e regole di notifica: ogni cambio di stato produce la riga giusta."""
import uuid

from app import events, models
from tests.conftest import push


def evs(client, db_factory, pid):
    with db_factory() as s:
        return [(e.type, e.entity_id, e.payload) for e in
                s.query(models.Event).filter(models.Event.project_id == pid).order_by(models.Event.created_at).all()]


def notifs(db_factory, user_id):
    with db_factory() as s:
        return [(n.channel, n.status, n.event.type) for n in
                s.query(models.Notification).filter(models.Notification.user_id == user_id).all()]


def test_task_events_and_notifications_from_web(client, project, pin, users):
    pid = project["project"]["id"]
    anna = users["field"]["id"]
    manager = users["manager"]
    # manager crea un task assegnato ad Anna -> task.created + task.assigned, Anna notificata su email e push
    t = client.post("/tasks", headers=manager["headers"], json={"pin_id": pin, "title": "Fix", "assigned_to": anna}).json()
    types = [e[0] for e in evs(client, client.session_factory, pid)]
    assert types == ["task.created", "task.assigned"]
    assert sorted(notifs(client.session_factory, anna)) == [("email", "pending", "task.assigned"), ("push", "pending", "task.assigned")]
    assert notifs(client.session_factory, manager["id"]) == []  # l'autore non si autonotifica

    # Anna risolve -> status_changed, il creatore (manager) notificato
    client.patch(f"/tasks/{t['id']}", headers=users["field"]["headers"], json={"status": "resolved"})
    assert evs(client, client.session_factory, pid)[-1][0] == "task.status_changed"
    assert evs(client, client.session_factory, pid)[-1][2] == {"title": "Fix", "from": "assigned", "to": "resolved"}
    assert {n[2] for n in notifs(client.session_factory, manager["id"])} == {"task.status_changed"}

    # verifica dal manager: evento sì, nessuna notifica (regola solo su resolved)
    client.patch(f"/tasks/{t['id']}", headers=manager["headers"], json={"status": "verified"})
    assert evs(client, client.session_factory, pid)[-1][2]["to"] == "verified"
    assert len(notifs(client.session_factory, manager["id"])) == 2
    # PATCH senza cambi di stato/assegnatario: nessun evento nuovo
    n = len(evs(client, client.session_factory, pid))
    client.patch(f"/tasks/{t['id']}", headers=manager["headers"], json={"description": "x"})
    assert len(evs(client, client.session_factory, pid)) == n

    # riassegnazione: task.assigned al nuovo assegnatario
    t2 = client.post("/tasks", headers=manager["headers"], json={"pin_id": pin, "title": "Altro"}).json()
    client.patch(f"/tasks/{t2['id']}", headers=manager["headers"], json={"assigned_to": anna})
    last = evs(client, client.session_factory, pid)[-2:]
    assert [e[0] for e in last] == ["task.status_changed", "task.assigned"]  # open -> assigned automatico + assegnazione


def test_submission_non_conformity_notifies_project_managers(client, project, pin, users):
    pid = project["project"]["id"]
    tpl = project["template"]["id"]
    field = users["field"]["headers"]
    client.post("/submissions", headers=field, json={"template_id": tpl, "pin_id": pin, "data_json": {"esito": "Conforme"}})
    e = evs(client, client.session_factory, pid)
    assert e[-1][0] == "submission.created" and e[-1][2]["non_conformity"] is None
    assert notifs(client.session_factory, users["manager"]["id"]) == []

    client.post("/submissions", headers=field, json={"template_id": tpl, "pin_id": pin, "data_json": {"esito": "Non conforme"}})
    e = evs(client, client.session_factory, pid)
    assert e[-1][2]["non_conformity"] == {"field": "esito", "label": "Esito", "value": "Non conforme"}
    # manager e admin membri del progetto: notificati; field (autore) no; un manager non membro: no
    assert {n[2] for n in notifs(client.session_factory, users["manager"]["id"])} == {"submission.created"}
    assert notifs(client.session_factory, users["field"]["id"]) == []
    with client.session_factory() as s:
        admin = s.query(models.User).filter(models.User.email == "admin@test.local").first().id
    assert {n[2] for n in notifs(client.session_factory, admin)} == {"submission.created"}  # creatore del progetto = membro
    outsider_mgr = client.post("/users", json={"email": "mgr2@test.local", "password": "password123", "name": "M2", "role": "manager"}).json()
    client.post("/submissions", headers=field, json={"template_id": tpl, "pin_id": pin, "data_json": {"esito": "Non conforme"}})
    assert notifs(client.session_factory, outsider_mgr["id"]) == []


def test_preferences_disable_channels(client, project, pin, users):
    anna = users["field"]
    r = client.patch("/auth/me/preferences", headers=anna["headers"], json={"notify_email": False})
    assert r.status_code == 200 and r.json()["notify_email"] is False and r.json()["notify_push"] is True
    client.post("/tasks", headers=users["manager"]["headers"], json={"pin_id": pin, "title": "Fix", "assigned_to": anna["id"]})
    assert notifs(client.session_factory, anna["id"]) == [("push", "pending", "task.assigned")]
    client.patch("/auth/me/preferences", headers=anna["headers"], json={"notify_push": False})
    client.post("/tasks", headers=users["manager"]["headers"], json={"pin_id": pin, "title": "Fix2", "assigned_to": anna["id"]})
    assert len(notifs(client.session_factory, anna["id"])) == 1
    # le vede via API
    mine = client.get("/auth/me/notifications", headers=anna["headers"]).json()
    assert len(mine) == 1 and mine[0]["event"]["type"] == "task.assigned" and mine[0]["status"] == "pending"


def test_events_from_sync_push(client, project, pin, users):
    """Il push produce gli stessi eventi del web: nuovi task/submission, cambi di stato, assegnazioni; non i retry."""
    pid = project["project"]["id"]
    anna = users["field"]["id"]
    tpl = project["template"]["id"]
    tid = str(uuid.uuid4())
    sid = str(uuid.uuid4())
    r = push(client, tasks=[{"id": tid, "pin_id": pin, "title": "Da app", "status": "assigned", "assigned_to": anna}],
             submissions=[{"id": sid, "template_id": tpl, "pin_id": pin, "data_json": {"esito": "Non conforme"}}])
    assert r["tasks"]["inserted"] == 1 and r["submissions"]["inserted"] == 1
    types = [e[0] for e in evs(client, client.session_factory, pid)]
    assert types == ["submission.created", "task.created", "task.assigned"]
    assert {n[2] for n in notifs(client.session_factory, anna)} == {"task.assigned"}

    # stesso batch di nuovo (retry): skipped -> nessun evento
    n = len(types)
    push(client, tasks=[{"id": tid, "pin_id": pin, "title": "Da app", "status": "assigned", "assigned_to": anna,
                         "updated_at": "2020-01-01T00:00:00"}])
    assert len(evs(client, client.session_factory, pid)) == n

    # risoluzione dall'app (più recente) -> status_changed, creatore (admin = chi ha pushato) notificato
    from datetime import datetime, timedelta, timezone
    later = (datetime.now(timezone.utc) + timedelta(seconds=5)).isoformat()
    push(client, tasks=[{"id": tid, "pin_id": pin, "title": "Da app", "status": "resolved", "assigned_to": anna, "updated_at": later}])
    assert evs(client, client.session_factory, pid)[-1][2] == {"title": "Da app", "from": "assigned", "to": "resolved"}
    # rifiutata: nessun evento
    n = len(evs(client, client.session_factory, pid))
    push(client, submissions=[{"template_id": tpl, "pin_id": pin, "data_json": {"esito": "Boh"}}])
    assert len(evs(client, client.session_factory, pid)) == n
    # registro eventi del progetto per il manager
    r = client.get(f"/projects/{pid}/events", headers=users["manager"]["headers"])
    assert r.status_code == 200 and len(r.json()) == n
    assert client.get(f"/projects/{pid}/events", headers=users["field"]["headers"]).status_code == 403


def test_find_non_conformity_rules():
    schema = {"fields": [{"id": "a", "type": "select", "label": "A", "options": ["Ok", "NON CONFORME"]},
                         {"id": "b", "type": "multiselect", "label": "B", "options": ["x", "Non conformità"]},
                         {"id": "c", "type": "text", "label": "C"}]}
    assert events.find_non_conformity(schema, {"a": "Ok", "b": ["x"], "c": "non conforme"}) is None
    assert events.find_non_conformity(schema, {"a": "NON CONFORME"})["value"] == "NON CONFORME"
    assert events.find_non_conformity(schema, {"b": ["x", "Non conformità"]})["field"] == "b"
