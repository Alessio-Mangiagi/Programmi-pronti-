"""Spazio admin: gestione utenti (PATCH /users/{id}) e registro operazioni (GET /audit)."""
import uuid


def audit(client, **params):
    r = client.get("/audit", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def actions(client, **params):
    return [i["action"] for i in audit(client, **params)["items"]]


def test_login_is_audited_including_failures(client, users):
    field = users["field"]
    client.post("/auth/login", json={"email": field["email"], "password": "nope"})
    client.post("/auth/login", json={"email": "ghost@test.local", "password": "whatever"})
    rows = audit(client, action=["auth.login_failed"])["items"]
    assert {r["actor_email"] for r in rows} >= {field["email"], "ghost@test.local"}
    assert all(r["actor_id"] is None and r["details"]["reason"] == "invalid" for r in rows)
    ok = audit(client, actor_id=field["id"], action=["auth.login"])
    assert ok["total"] >= 1 and ok["items"][0]["actor_name"] == "field"


def test_user_management_and_self_protection(client, users):
    r = client.post("/users", json={"email": "Nuovo@Test.local", "name": "Nuovo", "password": "12345678", "role": "field"})
    assert r.status_code == 201
    uid = r.json()["id"]
    # aggiorna nome+ruolo, reset password, disattiva
    r = client.patch(f"/users/{uid}", json={"name": "Nuovo Nome", "role": "manager", "password": "87654321"})
    assert r.status_code == 200 and r.json()["role"] == "manager" and r.json()["name"] == "Nuovo Nome"
    assert client.post("/auth/login", json={"email": "nuovo@test.local", "password": "87654321"}).status_code == 200
    r = client.patch(f"/users/{uid}", json={"is_active": False})
    assert r.status_code == 200 and r.json()["is_active"] is False
    assert client.post("/auth/login", json={"email": "nuovo@test.local", "password": "87654321"}).status_code == 401
    assert audit(client, action=["auth.login_failed"])["items"][0]["details"]["reason"] == "inactive"
    # lista: i disattivati solo con include_inactive (admin)
    assert uid not in {u["id"] for u in client.get("/users").json()}
    assert uid in {u["id"] for u in client.get("/users", params={"include_inactive": True}).json()}
    assert client.get("/users", params={"include_inactive": True}, headers=users["manager"]["headers"]).status_code == 403
    # traccia completa sull'entità
    got = [a for a in actions(client, entity_id=uid) if a != "auth.login"]  # il login dell'utente stesso è sulla stessa entità
    # password_reset e updated nascono nella stessa richiesta (stesso istante): ordine tra loro non garantito
    assert got[0] == "user.deactivated" and set(got[1:3]) == {"user.password_reset", "user.updated"} and got[3] == "user.created"
    upd = audit(client, entity_id=uid, action=["user.updated"])["items"][0]["details"]
    assert upd["role"] == {"from": "field", "to": "manager"} and upd["name"]["to"] == "Nuovo Nome"
    # riattiva
    assert client.patch(f"/users/{uid}", json={"is_active": True}).json()["is_active"] is True
    assert actions(client, entity_id=uid)[0] == "user.reactivated"
    # protezioni: non posso disattivarmi né togliermi admin; ruolo invalido; 404; non-admin 403
    me = client.get("/auth/me").json()["id"]
    assert client.patch(f"/users/{me}", json={"is_active": False}).status_code == 409
    assert client.patch(f"/users/{me}", json={"role": "field"}).status_code == 409
    assert client.patch(f"/users/{uid}", json={"role": "boss"}).status_code == 422
    assert client.patch(f"/users/{uid}", json={"password": "short"}).status_code == 422
    assert client.patch("/users/nope", json={"name": "x"}).status_code == 404
    assert client.patch(f"/users/{uid}", json={"name": "x"}, headers=users["manager"]["headers"]).status_code == 403
    assert client.get("/audit", headers=users["manager"]["headers"]).status_code == 403
    assert client.get("/audit/actions", headers=users["field"]["headers"]).status_code == 403


def test_domain_operations_are_audited_with_project_and_filters(client, project, pin, users):
    pid = project["project"]["id"]
    tpl = project["template"]["id"]
    field = users["field"]
    web_pin = client.post("/pins", json={"plan_id": project["plan"]["id"], "x": 0.2, "y": 0.2, "label": "Web"}).json()
    assert actions(client, entity_id=web_pin["id"]) == ["pin.created"]
    t = client.post("/tasks", json={"pin_id": pin, "title": "Fix", "assigned_to": field["id"]}, headers=users["manager"]["headers"]).json()
    client.patch(f"/tasks/{t['id']}", json={"status": "resolved"}, headers=field["headers"])
    client.post("/submissions", json={"template_id": tpl, "pin_id": pin, "data_json": {"esito": "Conforme"}}, headers=field["headers"])
    client.delete(f"/tasks/{t['id']}")
    # sync push da device: una riga riassuntiva
    r = client.post("/sync/push", headers=field["headers"], json={"pins": [
        {"id": str(uuid.uuid4()), "plan_id": project["plan"]["id"], "x": 0.5, "y": 0.5, "updated_at": "2026-09-17T10:00:00Z"}]})
    assert r.status_code == 200, r.text

    page = audit(client, project_id=pid)
    got = [i["action"] for i in page["items"]]
    for a in ("project.created", "plan.created", "task.created", "task.updated", "submission.created", "task.deleted"):
        assert a in got, a
    assert all(i["project_name"] == project["project"]["name"] for i in page["items"])
    upd = next(i for i in page["items"] if i["action"] == "task.updated")
    assert upd["actor_id"] == field["id"] and upd["details"]["status"] == {"from": "assigned", "to": "resolved"}
    sync = audit(client, action=["sync.push"])["items"][0]
    assert sync["actor_id"] == field["id"] and sync["details"]["pins"]["inserted"] == 1 and sync["project_id"] is None

    # filtri: attore, più azioni, entità, testo libero, date, paginazione
    assert set(actions(client, actor_id=field["id"])) <= {"auth.login", "task.updated", "submission.created", "sync.push"}
    assert set(actions(client, action=["task.created", "task.deleted"])) == {"task.created", "task.deleted"}
    assert actions(client, entity_id=t["id"]) == ["task.deleted", "task.updated", "task.created"]
    assert all(i["actor_email"] == field["email"] for i in audit(client, q="field@")["items"])
    assert audit(client, date_from="2030-01-01")["total"] == 0
    assert audit(client, date_to="2020-01-01")["total"] == 0
    assert audit(client, date_from="2020-01-01", date_to="2030-01-01")["total"] == audit(client)["total"]
    p1 = audit(client, limit=2, offset=0)
    p2 = audit(client, limit=2, offset=2)
    assert len(p1["items"]) == 2 and len(p2["items"]) == 2 and p1["items"][0]["id"] != p2["items"][0]["id"]
    assert p1["total"] == audit(client)["total"] and p1["total"] > 4
    assert client.get("/audit", params={"limit": 0}).status_code == 422

    # catalogo azioni con etichette, attività per utente
    cat = client.get("/audit/actions").json()
    assert {"action": "auth.login", "label": "Accesso"} in cat
    act = {a["user_id"]: a for a in client.get("/users/activity").json()}
    assert act[field["id"]]["last_login"] and act[field["id"]]["actions_total"] >= 4
    assert act[field["id"]]["actions_last_30d"] == act[field["id"]]["actions_total"]
    assert client.get("/users/activity", headers=field["headers"]).status_code == 403
