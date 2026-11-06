# "><(((º> sabusabu <º)))><"
"""
Test autenticazione, ruoli e visibilità per progetto.
Il `client` di default agisce da admin; `users` fornisce manager/field (membri
del progetto) e outsider (non membro), ognuno con i propri header.
"""
import uuid
from datetime import datetime, timezone

import jwt
import pytest

from app import auth
from tests.conftest import PASSWORD, login, push


# ---------- login / token ----------

def test_login_ok_and_me(client):
    r = client.post("/auth/login", json={"email": "ADMIN@test.local ", "password": PASSWORD})
    assert r.status_code == 200
    body = r.json()
    assert body["token_type"] == "bearer" and body["user"]["role"] == "admin"
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me.json()["email"] == "admin@test.local"


def test_login_wrong_password_or_unknown_user(client):
    assert client.post("/auth/login", json={"email": "admin@test.local", "password": "nope"}).status_code == 401
    assert client.post("/auth/login", json={"email": "nobody@test.local", "password": PASSWORD}).status_code == 401


def test_login_lockout_after_repeated_failures(client, monkeypatch):
    from app.routers import users as users_router
    monkeypatch.setattr(users_router, "LOGIN_MAX_FAILS_PER_IP", 3)
    monkeypatch.setattr(users_router, "LOGIN_MAX_FAILS_PER_EMAIL", 5)
    bad = {"email": "admin@test.local", "password": "nope"}
    good = {"email": "admin@test.local", "password": PASSWORD}
    for _ in range(3):
        assert client.post("/auth/login", json=bad).status_code == 401
    # bloccato anche con la password giusta, dallo stesso IP
    assert client.post("/auth/login", json=good).status_code == 429
    # altro IP (un altro PC: client diverso, non un header): ancora ammesso finché non si supera il limite per email
    from fastapi.testclient import TestClient
    altro_pc = TestClient(client.app, client=("10.0.0.9", 50000))
    terzo_pc = TestClient(client.app, client=("10.0.0.10", 50000))
    assert altro_pc.post("/auth/login", json=bad).status_code == 401
    assert altro_pc.post("/auth/login", json=bad).status_code == 401
    assert terzo_pc.post("/auth/login", json=good).status_code == 429
    # X-Forwarded-For mandato dal client non conta: l'IP lo decide uvicorn (--proxy-headers si fida solo
    # del proxy su 127.0.0.1), altrimenti chi parla con la porta in LAN aggirerebbe il blocco cambiandolo
    from app import audit
    from starlette.requests import Request
    req = Request({"type": "http", "headers": [(b"x-forwarded-for", b"6.6.6.6, 10.0.0.9")], "client": ("192.168.1.7", 1)})
    assert audit._client_info(req)[0] == "192.168.1.7"
    # altra email non toccata
    assert client.post("/auth/login", json={"email": "nobody@test.local", "password": "x"}).status_code == 401
    # finestra scaduta: di nuovo ammesso
    monkeypatch.setattr(users_router, "LOGIN_WINDOW", users_router.timedelta(seconds=0))
    assert client.post("/auth/login", json=good).status_code == 200


def test_no_token_or_bad_token_is_401(client):
    anon = {"Authorization": ""}
    assert client.get("/projects", headers=anon).status_code == 401
    assert client.get("/projects", headers={"Authorization": "Bearer garbage"}).status_code == 401
    expired = jwt.encode({"sub": "x", "exp": datetime(2000, 1, 1)}, auth.SECRET_KEY, algorithm="HS256")
    assert client.get("/projects", headers={"Authorization": f"Bearer {expired}"}).status_code == 401
    forged = jwt.encode({"sub": "x", "exp": datetime(2100, 1, 1)}, "other-key-" * 4, algorithm="HS256")
    assert client.get("/projects", headers={"Authorization": f"Bearer {forged}"}).status_code == 401
    assert client.get("/files/plans/x.png", headers=anon).status_code == 401
    assert client.post("/sync/push", json={}, headers=anon).status_code == 401


# ---------- utenti ----------

def test_create_user_admin_only(client, users):
    r = client.post("/users", json={"email": "New@Test.local", "name": "N", "password": "lunga-abbastanza", "role": "field"})
    assert r.status_code == 201 and r.json()["email"] == "new@test.local"
    assert client.post("/users", json={"email": "new@test.local", "name": "N", "password": "lunga-abbastanza"}).status_code == 409
    assert client.post("/users", json={"email": "a@b.c", "name": "N", "password": "short"}).status_code == 422
    assert client.post("/users", json={"email": "a@b.c", "name": "N", "password": "lunga-abbastanza", "role": "boss"}).status_code == 422
    assert client.post("/users", json={"email": "b@b.c", "name": "N", "password": "lunga-abbastanza"},
                       headers=users["manager"]["headers"]).status_code == 403
    # manager e admin leggono l'elenco completo (serve per assegnare i task)
    emails = {u["email"] for u in client.get("/users", headers=users["manager"]["headers"]).json()}
    assert {"admin@test.local", "manager@test.local", "field@test.local", "new@test.local"} <= emails
    # chi lavora in campo vede solo i colleghi dei propri cantieri (qui Cantiere A), non chi non c'è
    visti = {u["email"] for u in client.get("/users", headers=users["field"]["headers"]).json()}
    assert "manager@test.local" in visti and "field@test.local" in visti and "new@test.local" not in visti
    assert "password_hash" not in client.get("/users").json()[0]


def test_disabled_user_cannot_login(client, users):
    with client.session_factory() as s:
        from app import models
        u = s.get(models.User, users["field"]["id"])
        u.is_active = False
        s.commit()
    assert client.post("/auth/login", json={"email": "field@test.local", "password": PASSWORD}).status_code == 401
    assert client.get("/auth/me", headers=users["field"]["headers"]).status_code == 401


# ---------- progetti e membership ----------

def test_project_visibility_by_membership(client, project, users):
    pid = project["project"]["id"]
    other = client.post("/projects", json={"name": "Altro cantiere"}).json()

    assert {p["id"] for p in client.get("/projects").json()} == {pid, other["id"]}
    assert [p["id"] for p in client.get("/projects", headers=users["field"]["headers"]).json()] == [pid]
    assert client.get("/projects", headers=users["outsider"]["headers"]).json() == []

    assert client.get(f"/projects/{pid}", headers=users["field"]["headers"]).status_code == 200
    assert client.get(f"/projects/{pid}", headers=users["outsider"]["headers"]).status_code == 403
    assert client.get("/projects/nope", headers=users["outsider"]["headers"]).status_code == 404
    assert client.get(f"/projects/{pid}/plans", headers=users["outsider"]["headers"]).status_code == 403
    assert client.get(f"/projects/{pid}/tasks", headers=users["outsider"]["headers"]).status_code == 403
    assert client.get("/sync/pull", params={"project_id": pid}, headers=users["outsider"]["headers"]).status_code == 403


def test_manager_creates_project_and_becomes_member(client, users):
    r = client.post("/projects", json={"name": "Mio"}, headers=users["manager"]["headers"])
    assert r.status_code == 201
    members = client.get(f"/projects/{r.json()['id']}/members").json()
    assert [m["email"] for m in members] == ["manager@test.local"]
    assert client.post("/projects", json={"name": "No"}, headers=users["field"]["headers"]).status_code == 403


def test_members_management(client, project, users):
    pid = project["project"]["id"]
    m = users["manager"]["headers"]
    r = client.post(f"/projects/{pid}/members", json={"user_id": users["outsider"]["id"]}, headers=m)
    assert r.status_code == 201 and users["outsider"]["email"] in {u["email"] for u in r.json()}
    # idempotente
    assert client.post(f"/projects/{pid}/members", json={"user_id": users["outsider"]["id"]}, headers=m).status_code == 201
    assert client.get(f"/projects/{pid}", headers=users["outsider"]["headers"]).status_code == 200

    assert client.delete(f"/projects/{pid}/members/{users['outsider']['id']}", headers=m).status_code == 204
    assert client.delete(f"/projects/{pid}/members/{users['outsider']['id']}", headers=m).status_code == 404
    assert client.get(f"/projects/{pid}", headers=users["outsider"]["headers"]).status_code == 403

    assert client.post(f"/projects/{pid}/members", json={"user_id": "ghost"}, headers=m).status_code == 404
    assert client.post(f"/projects/{pid}/members", json={"user_id": users["outsider"]["id"]},
                       headers=users["field"]["headers"]).status_code == 403
    # un manager NON membro di un altro progetto non ne gestisce i membri
    other = client.post("/projects", json={"name": "Altro"}).json()
    assert client.post(f"/projects/{other['id']}/members", json={"user_id": users["outsider"]["id"]},
                       headers=m).status_code == 403


# ---------- ruoli sugli endpoint ----------

def test_plans_and_templates_require_manager(client, project, users):
    pid = project["project"]["id"]
    f, m = users["field"]["headers"], users["manager"]["headers"]
    assert client.post("/plans", json={"project_id": pid, "name": "P"}, headers=f).status_code == 403
    assert client.post("/plans", json={"project_id": pid, "name": "P"}, headers=m).status_code == 201
    assert client.post(f"/plans/{project['plan']['id']}/file", files={"file": ("x.png", b"\x89PNG", "image/png")},
                       headers=f).status_code == 403
    tpl = {"name": "T", "schema_def": {"fields": [{"id": "a", "type": "text", "label": "A"}]}}
    assert client.post("/form-templates", json=tpl, headers=f).status_code == 403
    # creare moduli è solo dell'amministratore (il client dei test è admin)
    assert client.post("/form-templates", json=tpl, headers=m).status_code == 403
    assert client.post("/form-templates", json=tpl).status_code == 201
    assert len(client.get("/form-templates", headers=f).json()) == 2


def test_field_user_works_only_in_own_projects(client, project, pin, users):
    f, o = users["field"]["headers"], users["outsider"]["headers"]
    tpl = project["template"]["id"]
    sub = {"template_id": tpl, "pin_id": pin, "data_json": {"esito": "Conforme"}}
    r = client.post("/submissions", json=sub, headers=f)
    assert r.status_code == 201 and r.json()["submitted_by"] == users["field"]["id"]
    assert client.post("/submissions", json=sub, headers=o).status_code == 403
    assert client.get(f"/submissions/{r.json()['id']}", headers=o).status_code == 403
    assert client.get(f"/pins/{pin}", headers=o).status_code == 403

    t = client.post("/tasks", json={"pin_id": pin, "title": "t"}, headers=f)
    assert t.status_code == 201 and t.json()["created_by"] == users["field"]["id"]
    assert client.post("/tasks", json={"pin_id": pin, "title": "t"}, headers=o).status_code == 403
    assert client.get(f"/tasks/{t.json()['id']}", headers=o).status_code == 403
    assert client.patch(f"/tasks/{t.json()['id']}", json={"title": "x"}, headers=o).status_code == 403

    att = client.post("/attachments", json={"task_id": t.json()["id"]}, headers=f)
    assert att.status_code == 201
    assert client.post("/attachments", json={"task_id": t.json()["id"]}, headers=o).status_code == 403
    assert client.post("/attachments/presign", json={"attachment_id": att.json()["id"]}, headers=o).status_code == 403


def test_only_manager_verifies_and_deletes_others_tasks(client, pin, users):
    f, m = users["field"]["headers"], users["manager"]["headers"]
    tid = client.post("/tasks", json={"pin_id": pin, "title": "t", "assigned_to": users["field"]["id"]},
                      headers=m).json()["id"]
    assert client.patch(f"/tasks/{tid}", json={"status": "resolved"}, headers=f).status_code == 200
    assert client.patch(f"/tasks/{tid}", json={"status": "verified"}, headers=f).status_code == 403
    assert client.patch(f"/tasks/{tid}", json={"status": "verified"}, headers=m).status_code == 200

    own = client.post("/tasks", json={"pin_id": pin, "title": "mine"}, headers=f).json()["id"]
    assert client.delete(f"/tasks/{tid}", headers=f).status_code == 403   # creato dal manager
    assert client.delete(f"/tasks/{own}", headers=f).status_code == 204   # proprio
    assert client.delete(f"/tasks/{tid}", headers=m).status_code == 204


# ---------- sync ----------

def test_sync_push_fills_author_and_rejects_foreign_projects(client, project, users):
    f, o = users["field"]["headers"], users["outsider"]["headers"]
    plan_id = project["plan"]["id"]
    pin_id, sub_id, task_id = (str(uuid.uuid4()) for _ in range(3))
    now = datetime.now(timezone.utc).isoformat()
    batch = {
        "pins": [{"id": pin_id, "plan_id": plan_id, "x": 0.1, "y": 0.1, "updated_at": now}],
        "submissions": [{"id": sub_id, "template_id": project["template"]["id"], "pin_id": pin_id,
                         "data_json": {"esito": "Conforme"}, "updated_at": now}],
        "tasks": [{"id": task_id, "pin_id": pin_id, "title": "t", "updated_at": now}],
    }
    # outsider: tutto rifiutato riga per riga (il pin non entra, quindi le FK figlie falliscono)
    r = client.post("/sync/push", json=batch, headers=o).json()
    assert r["pins"]["rejected"][0]["reason"].startswith("forbidden")
    assert r["submissions"]["rejected"][0]["reason"] == "pin_id not found"
    assert r["tasks"]["rejected"][0]["reason"] == "pin_id not found"

    # membro: inserito, autore preso dal token
    r = client.post("/sync/push", json=batch, headers=f).json()
    assert (r["pins"]["inserted"], r["submissions"]["inserted"], r["tasks"]["inserted"]) == (1, 1, 1)
    detail = client.get(f"/pins/{pin_id}").json()
    assert detail["created_by"] == users["field"]["id"]
    assert detail["submissions"][0]["submitted_by"] == users["field"]["id"]
    assert detail["tasks"][0]["created_by"] == users["field"]["id"]

    # outsider non può nemmeno aggiornare un task di quel progetto (via pin esistente)
    r = client.post("/sync/push", json={"tasks": [{"id": task_id, "pin_id": pin_id, "title": "hack",
                                                    "updated_at": datetime.now(timezone.utc).isoformat()}]},
                    headers=o).json()
    assert r["tasks"]["rejected"][0]["reason"].startswith("forbidden")
    assert client.get(f"/tasks/{task_id}").json()["title"] == "t"


def test_sync_push_validates_user_fks(client, pin):
    r = push(client, tasks=[{"pin_id": pin, "title": "t", "assigned_to": "ghost"}])
    assert r["tasks"]["rejected"][0]["reason"] == "assigned_to not found"
    r = push(client, attachments=[{"file_type": "photo"}])
    assert "exactly one" in r["attachments"]["rejected"][0]["reason"]


def test_password_minima_unica(client):
    """Una sola regola (schemas.PASSWORD_MIN = 12) per creazione utenti, reset e inviti; prima 8 dal web e 12
    dallo script create_admin."""
    from app.schemas import PASSWORD_MIN
    from scripts import create_admin
    assert PASSWORD_MIN == 12 and create_admin.MIN_PASSWORD == PASSWORD_MIN
    corta = "x" * (PASSWORD_MIN - 1)
    assert client.post("/users", json={"email": "c@test.local", "name": "C", "password": corta}).status_code == 422
    assert client.post("/users", json={"email": "c@test.local", "name": "C", "password": corta + "y"}).status_code == 201


def test_cambio_password_da_soli(client, users):
    """POST /auth/me/password: serve la password attuale; gli errori contano come login falliti (stesso blocco),
    rispondono 400 e non 401; la nuova vale subito e quella vecchia no; resta nel registro."""
    from tests.conftest import PASSWORD, login
    h = users["field"]["headers"]
    url = "/auth/me/password"
    assert client.post(url, json={"current_password": PASSWORD, "new_password": "corta"}, headers=h).status_code == 422
    r = client.post(url, json={"current_password": "sbagliata", "new_password": "nuova-password-1"}, headers=h)
    assert r.status_code == 400 and r.json()["detail"] == "Password attuale errata"
    assert client.post(url, json={"current_password": PASSWORD, "new_password": PASSWORD}, headers=h).status_code == 422
    assert client.post(url, json={"current_password": PASSWORD, "new_password": "nuova-password-1"}, headers=h).status_code == 204
    assert client.post("/auth/login", json={"email": "field@test.local", "password": PASSWORD}).status_code == 401
    login(client, "field@test.local", "nuova-password-1")
    azioni = [a["action"] for a in client.get("/audit").json()["items"]]
    assert "user.password_changed" in azioni
    fallito = next(a for a in client.get("/audit", params={"action": ["auth.login_failed"]}).json()["items"]
                   if a["details"].get("reason") == "password_change")
    assert fallito["actor_email"] == "field@test.local"
    # senza login niente
    assert client.post(url, json={"current_password": "x", "new_password": "nuova-password-2"},
                       headers={"Authorization": ""}).status_code == 401


def test_cambio_password_bloccato_dopo_troppi_errori(client, users, monkeypatch):
    """Il blocco anti brute force di /auth/login vale anche qui: chi ha rubato una sessione non prova password."""
    from app.routers import users as users_router
    monkeypatch.setattr(users_router, "LOGIN_MAX_FAILS_PER_IP", 2)
    h = users["field"]["headers"]
    body = {"current_password": "sbagliata", "new_password": "nuova-password-1"}
    assert [client.post("/auth/me/password", json=body, headers=h).status_code for _ in range(3)] == [400, 400, 429]
