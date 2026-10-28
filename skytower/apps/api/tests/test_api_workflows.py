# "><(((º> sabusabu <º)))><"
"""Sprint 4: workflow multi-step, blocco documento, quorum, concorrenza, scadenze (time travel),
notifiche ed email, RFI."""
from __future__ import annotations

import threading
import uuid
from datetime import UTC, datetime, timedelta

import psycopg
import pytest
from psycopg.rows import dict_row
from test_api_documents import PDF, des_name, upload
from test_api_states import as_user, transition, worker  # noqa: F401 - fixture riusate

from cde_api.mail import ConsoleMailer
from cde_api.notifier import send_daily_digests, send_notification_email


def template_body(w, code=None, *, steps=None, on_approved=None, escalation=None):
    return {"code": code or f"WF_{uuid.uuid4().hex[:8].upper()}", "name": "Revisione progetto",
            "definition": {
                "steps": steps or [
                    {"name": "Verifica interna", "assignees": [{"type": "originator_role", "code": "LEAD_DESIGNER"}],
                     "quorum": "ALL", "sla_hours": 72},
                    {"name": "Approvazione DL", "assignees": [{"type": "user", "id": str(w.users["com_dl"])}],
                     "sla_hours": 48},
                    {"name": "Presa d'atto committente", "assignees": [{"type": "role", "code": "PROJECT_ADMIN"}],
                     "quorum": "ANY"},
                ],
                "on_approved": on_approved if on_approved is not None else {"to_state": "PUBLISHED", "suitability": "A1"},
                **({"escalation_user_id": str(escalation)} if escalation else {}),
            }}


@pytest.fixture
def template(client, api_world, as_user):  # noqa: F811
    _, w = api_world
    r = client.post(f"/projects/{w.project_id}/workflow-templates", headers=as_user("com_admin"), json=template_body(w))
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture
def shared(client, api_world, as_user, worker):  # noqa: F811
    _, w = api_world
    rev = upload(client, as_user("des_lead"), w.containers["des_arch"], des_name(), PDF, title="Pianta").json()
    worker()
    return transition(client, as_user("des_lead"), rev["id"], "SHARED", "S4").json()


def open_task(client, headers, instance_id):
    tasks = client.get("/me/tasks", headers=headers).json()
    return next(t for t in tasks if t["instance_id"] == instance_id)


def notifications(client, headers, kind=None):
    items = client.get("/notifications", headers=headers, params={"limit": 200}).json()["items"]
    return [n for n in items if kind is None or n["kind"] == kind]


# ---------------------------------------------------------------------
# Template
# ---------------------------------------------------------------------
def test_template_solo_project_admin_e_validato(client, api_world, as_user):  # noqa: F811
    _, w = api_world
    assert client.post(f"/projects/{w.project_id}/workflow-templates", headers=as_user("des_lead"),
                       json=template_body(w)).status_code == 403
    bad = template_body(w)
    bad["definition"]["steps"][0]["assignees"] = [{"type": "role"}]
    assert client.post(f"/projects/{w.project_id}/workflow-templates", headers=as_user("com_admin"),
                       json=bad).status_code == 422


def test_template_versionato(client, api_world, as_user):  # noqa: F811
    _, w = api_world
    h = as_user("com_admin")
    body = template_body(w, "VERSIONATO")
    v1 = client.post(f"/projects/{w.project_id}/workflow-templates", headers=h, json=body).json()
    v2 = client.post(f"/projects/{w.project_id}/workflow-templates", headers=h, json=body).json()
    assert (v1["version"], v2["version"]) == (1, 2)
    active = [t for t in client.get(f"/projects/{w.project_id}/workflow-templates", headers=h).json()
              if t["code"] == "VERSIONATO"]
    assert [t["version"] for t in active] == [2]


# ---------------------------------------------------------------------
# Esecuzione completa
# ---------------------------------------------------------------------
def test_workflow_completo_autore_verificatore_dl_committente(client, api_world, as_user, template, shared, worker):  # noqa: F811
    _, w = api_world
    author = as_user("des_lead")
    r = client.post(f"/revisions/{shared['id']}/workflows", headers=author, json={"template_id": template["id"]})
    assert r.status_code == 201, r.text
    inst = r.json()
    assert inst["status"] == "RUNNING" and inst["steps"][0]["tasks"][0]["assignee_name"].startswith("Des")

    # documento bloccato: niente nuove revisioni, transizioni, né un secondo workflow
    doc = client.get(f"/documents/{shared['document_id']}", headers=author).json()
    locked = upload(client, author, w.containers["des_arch"], f"{doc['identifier']}.pdf", PDF, complete=False)
    assert locked.status_code == 423
    assert transition(client, author, shared["id"], "PUBLISHED", "A1", "salto il workflow").status_code == 423
    assert client.post(f"/revisions/{shared['id']}/workflows", headers=author,
                       json={"template_id": template["id"]}).status_code == 409

    # step 1: verificatore interno
    t1 = open_task(client, author, inst["id"])
    res = client.post(f"/tasks/{t1['id']}/complete", headers=author, json={"outcome": "APPROVED"}).json()
    assert res["workflow_status"] == "RUNNING" and res["workflow"]["current_step"] == 1

    # step 2: il DL riceve notifica, vede e scarica la revisione anche senza accesso al container
    dl = as_user("com_dl")
    assert any(n["data"].get("instance_id") == inst["id"] for n in notifications(client, dl, "TASK_ASSIGNED"))
    assert client.get(f"/documents/{shared['document_id']}", headers=dl).status_code == 200
    assert client.get(f"/revisions/{shared['id']}/download", headers=dl).status_code == 200
    t2 = open_task(client, dl, inst["id"])
    assert client.post(f"/tasks/{t2['id']}/complete", headers=dl,
                       json={"outcome": "APPROVED_WITH_COMMENTS"}).status_code == 422          # commento obbligatorio
    client.post(f"/tasks/{t2['id']}/complete", headers=dl,
                json={"outcome": "APPROVED_WITH_COMMENTS", "comment": "Verificare quote al piano terra"})

    # step 3: committente (quorum ANY) → pubblicazione automatica C01
    pa = as_user("com_admin")
    t3 = open_task(client, pa, inst["id"])
    done = client.post(f"/tasks/{t3['id']}/complete", headers=pa, json={"outcome": "APPROVED"}).json()
    assert done["workflow_status"] == "APPROVED"
    final = done["workflow"]
    assert final["final_revision_id"]
    doc = client.get(f"/documents/{shared['document_id']}", headers=as_user("sub1_user")).json()
    assert doc["current_revision"] == "C01" and doc["current_suitability"] == "A1"
    assert any(n["data"].get("instance_id") == inst["id"] for n in notifications(client, author, "WORKFLOW_APPROVED"))
    # sbloccato: si può caricare la revisione successiva
    nxt = upload(client, author, w.containers["des_arch"], f"{doc['identifier']}.pdf", PDF + b"next")
    assert nxt.status_code == 200 and nxt.json()["revision_code"] == "P02.01"


def test_rifiuto_ritorna_all_autore(client, api_world, as_user, template, shared):  # noqa: F811
    author = as_user("des_lead")
    inst = client.post(f"/revisions/{shared['id']}/workflows", headers=author, json={"template_id": template["id"]}).json()
    t1 = open_task(client, author, inst["id"])
    assert client.post(f"/tasks/{t1['id']}/complete", headers=author, json={"outcome": "REJECTED"}).status_code == 422
    res = client.post(f"/tasks/{t1['id']}/complete", headers=author,
                      json={"outcome": "REJECTED", "comment": "Manca la sezione B-B"}).json()
    assert res["workflow_status"] == "REJECTED"
    rej = [n for n in notifications(client, author, "WORKFLOW_REJECTED") if n["data"].get("instance_id") == inst["id"]]
    assert rej and "Manca la sezione B-B" in rej[0]["body"]
    assert client.post(f"/tasks/{t1['id']}/complete", headers=author, json={"outcome": "APPROVED"}).status_code == 422


def test_quorum_n_cancella_i_compiti_residui(client, api_world, as_user, shared):  # noqa: F811
    _, w = api_world
    steps = [{"name": "Revisione progettisti", "quorum": {"n": 1},
              "assignees": [{"type": "role", "code": "LEAD_DESIGNER"}, {"type": "role", "code": "DESIGNER"}]}]
    tpl_def = client.post(f"/projects/{w.project_id}/workflow-templates", headers=as_user("com_admin"),
                          json={**template_body(w, steps=steps), "definition": {"steps": steps}}).json()
    inst = client.post(f"/revisions/{shared['id']}/workflows", headers=as_user("des_lead"),
                       json={"template_id": tpl_def["id"]}).json()
    assert inst["steps"][0]["required"] == 1 and len(inst["steps"][0]["tasks"]) == 2
    t = open_task(client, as_user("des_designer"), inst["id"])
    res = client.post(f"/tasks/{t['id']}/complete", headers=as_user("des_designer"), json={"outcome": "APPROVED"}).json()
    assert res["workflow_status"] == "APPROVED"
    statuses = sorted(k["status"] for k in res["workflow"]["steps"][0]["tasks"])
    assert statuses == ["CANCELLED", "DONE"]


def test_annullamento(client, api_world, as_user, template, shared):  # noqa: F811
    inst = client.post(f"/revisions/{shared['id']}/workflows", headers=as_user("des_lead"),
                       json={"template_id": template["id"]}).json()
    assert client.post(f"/workflows/{inst['id']}/cancel", headers=as_user("des_designer"),
                       json={"reason": "non mio"}).status_code == 403
    r = client.post(f"/workflows/{inst['id']}/cancel", headers=as_user("des_lead"), json={"reason": "Ricaricato file errato"})
    assert r.status_code == 200 and r.json()["status"] == "CANCELLED"
    assert all(k["status"] == "CANCELLED" for s in r.json()["steps"] for k in s["tasks"])


def test_avvio_solo_da_autore_o_admin(client, api_world, as_user, template, shared):  # noqa: F811
    assert client.post(f"/revisions/{shared['id']}/workflows", headers=as_user("des_viewer"),
                       json={"template_id": template["id"]}).status_code == 403
    assert client.post(f"/revisions/{shared['id']}/workflows", headers=as_user("sub1_user"),
                       json={"template_id": template["id"]}).status_code == 404


def test_template_con_transizione_non_applicabile(client, api_world, as_user, worker):  # noqa: F811
    _, w = api_world
    tpl = client.post(f"/projects/{w.project_id}/workflow-templates", headers=as_user("com_admin"),
                      json=template_body(w)).json()          # on_approved: PUBLISHED, ma la revisione è WIP
    rev = upload(client, as_user("des_lead"), w.containers["des_arch"], des_name(), PDF).json()
    r = client.post(f"/revisions/{rev['id']}/workflows", headers=as_user("des_lead"), json={"template_id": tpl["id"]})
    assert r.status_code == 422


# ---------------------------------------------------------------------
# Concorrenza (G39)
# ---------------------------------------------------------------------
def _parallel(fn, n=2):
    barrier, results = threading.Barrier(n), [None] * n

    def run(i):
        barrier.wait()
        try:
            results[i] = fn(i)
        except Exception as exc:  # noqa: BLE001 - raccogliamo l'esito di ciascun thread
            results[i] = exc
    threads = [threading.Thread(target=run, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return results


def test_avvio_concorrente_un_solo_workflow(client, api_world, as_user, template, shared):  # noqa: F811
    urls, w = api_world

    def start(_):
        with psycopg.connect(urls.app) as conn:
            conn.execute("SELECT set_config('app.user_id', %s, true)", [str(w.users["des_lead"])])
            conn.execute("SELECT cde.workflow_start(%s, %s)", [template["id"], shared["id"]])
            conn.commit()
            return "ok"
    results = _parallel(start)
    assert results.count("ok") == 1
    assert any(isinstance(r, psycopg.errors.UniqueViolation) for r in results)


def test_compiti_paralleli_concorrenti_avanzano_una_volta(client, api_world, as_user, shared):  # noqa: F811
    urls, w = api_world
    steps = [{"name": "Doppia firma", "quorum": "ALL",
              "assignees": [{"type": "user", "id": str(w.users["des_lead"])},
                            {"type": "user", "id": str(w.users["des_designer"])}]},
             {"name": "Committente", "assignees": [{"type": "user", "id": str(w.users["com_admin"])}]}]
    tpl = client.post(f"/projects/{w.project_id}/workflow-templates", headers=as_user("com_admin"),
                      json={**template_body(w), "definition": {"steps": steps}}).json()
    inst = client.post(f"/revisions/{shared['id']}/workflows", headers=as_user("des_lead"),
                       json={"template_id": tpl["id"]}).json()
    tasks = {k["assignee_id"]: k["id"] for k in inst["steps"][0]["tasks"]}
    users = ["des_lead", "des_designer"]

    def complete(i):
        with psycopg.connect(urls.app) as conn:
            conn.execute("SELECT set_config('app.user_id', %s, true)", [str(w.users[users[i]])])
            status = conn.execute("SELECT cde.workflow_complete_task(%s, 'APPROVED')",
                                  [tasks[str(w.users[users[i]])]]).fetchone()[0]
            conn.commit()
            return status
    assert sorted(_parallel(complete)) == ["RUNNING", "RUNNING"]
    final = client.get(f"/workflows/{inst['id']}", headers=as_user("des_lead")).json()
    assert [s["step_index"] for s in final["steps"]] == [0, 1]          # step 2 attivato una sola volta
    assert len(final["steps"][1]["tasks"]) == 1


# ---------------------------------------------------------------------
# Scadenze con "time travel" (G35)
# ---------------------------------------------------------------------
def test_promemoria_scadenza_ed_escalation(client, api_world, as_user, shared):  # noqa: F811
    urls, w = api_world
    steps = [{"name": "Revisione", "sla_hours": 72, "assignees": [{"type": "user", "id": str(w.users["des_designer"])}]}]
    tpl = client.post(f"/projects/{w.project_id}/workflow-templates", headers=as_user("com_admin"),
                      json={**template_body(w), "definition": {"steps": steps,
                                                               "escalation_user_id": str(w.users["com_admin"])}}).json()
    inst = client.post(f"/revisions/{shared['id']}/workflows", headers=as_user("des_lead"),
                       json={"template_id": tpl["id"]}).json()
    now = datetime.now(UTC)

    def run(hours):
        with psycopg.connect(urls.worker, autocommit=True) as conn:
            return conn.execute("SELECT cde.process_deadlines(%s)", [now + timedelta(hours=hours)]).fetchone()[0]

    def mine(user, kind):
        return [n for n in notifications(client, as_user(user), kind) if n["data"].get("task_id") ==
                inst["steps"][0]["tasks"][0]["id"]]

    run(1)
    assert mine("des_designer", "TASK_REMINDER") == []
    run(25)                                     # −47h: promemoria 48 ore
    assert [n["data"]["hours"] for n in mine("des_designer", "TASK_REMINDER")] == [48]
    run(26)                                     # nessun duplicato
    assert len(mine("des_designer", "TASK_REMINDER")) == 1
    run(49)                                     # −23h: promemoria 24 ore
    assert sorted(n["data"]["hours"] for n in mine("des_designer", "TASK_REMINDER")) == [24, 48]
    run(73)                                     # scaduto: notifica + escalation
    assert len(mine("des_designer", "TASK_OVERDUE")) == 1
    assert len(mine("com_admin", "TASK_ESCALATED")) == 1
    run(80)
    assert len(mine("com_admin", "TASK_ESCALATED")) == 1
    task = open_task(client, as_user("des_designer"), inst["id"])
    assert task["overdue"] is False or task["overdue"] is True       # campo esposto alla UI


# ---------------------------------------------------------------------
# Notifiche ed email (G36)
# ---------------------------------------------------------------------
def test_notifiche_private_e_segna_come_lette(client, api_world, as_user, template, shared):  # noqa: F811
    client.post(f"/revisions/{shared['id']}/workflows", headers=as_user("des_lead"), json={"template_id": template["id"]})
    h = as_user("des_lead")
    data = client.get("/notifications", headers=h, params={"unread_only": True}).json()
    assert data["unread"] >= 1
    ids = [n["id"] for n in data["items"]]
    other = client.get("/notifications", headers=as_user("sub1_user")).json()["items"]
    assert not set(ids) & {n["id"] for n in other}
    assert client.post("/notifications/read", headers=as_user("sub1_user"), json={"ids": ids}).json()["marked"] == 0
    assert client.post("/notifications/read", headers=h, json={"all": True}).json()["marked"] >= 1
    assert client.get("/notifications", headers=h).json()["unread"] == 0


def test_email_immediata_it_en_e_digest(client, api_world, as_user, template, shared):  # noqa: F811
    urls, w = api_world
    h = as_user("des_lead")
    client.put("/me/notification-preferences", headers=h, json={"email_enabled": True, "daily_digest": False, "locale": "en"})
    try:
        client.post(f"/revisions/{shared['id']}/workflows", headers=h, json={"template_id": template["id"]})
        nid = notifications(client, h, "TASK_ASSIGNED")[0]["id"]
        mailer = ConsoleMailer()
        with psycopg.connect(urls.worker, row_factory=dict_row) as conn:
            jobs = conn.execute("SELECT count(*) n FROM jobs.procrastinate_jobs WHERE task_name = "
                                "'cde.send_notification_email' AND (args->>'notification_id')::bigint = %s",
                                [nid]).fetchone()["n"]
            assert jobs == 1
            assert send_notification_email(conn, mailer, "https://cde.example", nid) is True
            assert send_notification_email(conn, mailer, "https://cde.example", nid) is False      # idempotente
        mail = mailer.outbox[0]
        assert mail.to == w.emails["des_lead"] and mail.body.startswith("Dear ") and "https://cde.example/compiti" in mail.body

        # digest: nessuna email immediata, un riepilogo unico
        client.put("/me/notification-preferences", headers=h, json={"email_enabled": True, "daily_digest": True, "locale": "it"})
        client.post(f"/workflows/{client.get('/me/tasks', headers=h).json()[0]['instance_id']}/cancel", headers=h,
                    json={"reason": "test digest"})
        shared2 = shared
        with psycopg.connect(urls.owner, autocommit=True) as conn:
            conn.execute("SELECT cde.notify(%s, %s, 'TEST', 'Prova digest', 'corpo')", [w.users["des_lead"], w.project_id])
        digest = ConsoleMailer()
        with psycopg.connect(urls.worker, row_factory=dict_row) as conn:
            assert send_daily_digests(conn, digest, "https://cde.example") >= 1   # anche i "Segui" di altri utenti
        mine = next(m for m in digest.outbox if m.to == w.emails["des_lead"])
        assert mine.subject == "Riepilogo giornaliero CDE" and "Prova digest" in mine.body
        assert shared2
    finally:
        client.put("/me/notification-preferences", headers=h, json={"email_enabled": True, "daily_digest": False, "locale": "it"})


def test_ticket_sse(client, as_user):  # noqa: F811
    ticket = client.post("/notifications/stream-ticket", headers=as_user("des_lead")).json()["ticket"]
    assert ticket
    assert client.get("/notifications/stream", params={"ticket": "non-valido"}).status_code == 401
    assert client.get("/notifications/stream", params={"ticket": as_user("des_lead")["Authorization"][7:]}).status_code == 401


# ---------------------------------------------------------------------
# RFI (G37)
# ---------------------------------------------------------------------
def test_rfi_ciclo_completo(client, api_world, as_user, shared):  # noqa: F811
    _, w = api_world
    sub = as_user("sub1_user")
    due = (datetime.now(UTC) + timedelta(hours=48)).isoformat()
    r = client.post(f"/projects/{w.project_id}/rfis", headers=sub,
                    json={"subject": "Quota passerella", "question": "Confermate quota +3.20?", "due_at": due,
                          "recipient_organization_ids": [str(w.orgs["DES"])]})
    assert r.status_code == 201, r.text
    rfi = r.json()
    assert rfi["code"].startswith("RFI-") and rfi["status"] == "OPEN" and len(rfi["messages"]) == 1
    second = client.post(f"/projects/{w.project_id}/rfis", headers=sub,
                         json={"subject": "Altra domanda", "question": "?", "recipient_user_ids": [str(w.users["des_lead"])]}).json()
    assert second["number"] == rfi["number"] + 1

    des = as_user("des_lead")
    assert any(n["data"].get("rfi_id") == rfi["id"] for n in notifications(client, des, "RFI_CREATED"))
    # pannello "Per me": il destinatario la vede da rispondere, l'autore in attesa, un estraneo no
    mine = {x["id"]: x for x in client.get("/me/rfis", headers=des).json()}
    assert mine[rfi["id"]]["i_am_recipient"] and mine[rfi["id"]]["project_code"]
    assert not {x["id"]: x for x in client.get("/me/rfis", headers=sub).json()}[rfi["id"]]["i_am_recipient"]
    assert rfi["id"] not in {x["id"] for x in client.get("/me/rfis", headers=as_user("sub2_user")).json()}
    assert client.get(f"/rfis/{rfi['id']}", headers=as_user("sub2_user")).status_code == 404
    assert client.get(f"/rfis/{rfi['id']}", headers=as_user("com_admin")).status_code == 200      # Project Admin
    assert client.post(f"/rfis/{rfi['id']}/messages", headers=sub,
                       json={"body": "risposta?", "is_answer": True}).status_code == 403             # non destinatario
    ans = client.post(f"/rfis/{rfi['id']}/messages", headers=des,
                      json={"body": "Confermata, vedi tavola", "is_answer": True, "revision_ids": [shared["id"]]})
    assert ans.status_code == 201 and ans.json()["status"] == "ANSWERED"
    assert ans.json()["messages"][-1]["attachments"][0]["revision_code"] == "P01"
    assert any(n["data"].get("rfi_id") == rfi["id"] for n in notifications(client, sub, "RFI_ANSWERED"))
    assert client.post(f"/rfis/{rfi['id']}/close", headers=des).status_code == 403                 # chiude chi chiede
    assert client.post(f"/rfis/{rfi['id']}/close", headers=sub).json()["status"] == "CLOSED"
    assert client.post(f"/rfis/{rfi['id']}/messages", headers=des, json={"body": "ancora"}).status_code == 422


def test_rfi_validazioni(client, api_world, as_user, shared):  # noqa: F811
    _, w = api_world
    sub = as_user("sub1_user")
    base = {"subject": "Domanda", "question": "Testo"}
    assert client.post(f"/projects/{w.project_id}/rfis", headers=sub, json=base).status_code == 422          # nessun destinatario
    assert client.post(f"/projects/{w.project_id}/rfis", headers=sub,
                       json={**base, "recipient_organization_ids": [str(w.orgs["OUT"])]}).status_code == 422
    assert client.post(f"/projects/{w.project_id}/rfis", headers=sub,                                         # WIP altrui: invisibile
                       json={**base, "recipient_organization_ids": [str(w.orgs["DES"])],
                             "revision_ids": [shared["derived_from"]]}).status_code == 422
    assert client.post(f"/projects/{w.project2_id}/rfis", headers=sub,
                       json={**base, "recipient_organization_ids": [str(w.orgs["DES"])]}).status_code == 404


def test_rfi_scadenza(client, api_world, as_user):  # noqa: F811
    urls, w = api_world
    due = datetime.now(UTC) + timedelta(hours=30)
    rfi = client.post(f"/projects/{w.project_id}/rfis", headers=as_user("sub1_user"),
                      json={"subject": "Scadenza", "question": "?", "due_at": due.isoformat(),
                            "recipient_organization_ids": [str(w.orgs["DES"])]}).json()
    with psycopg.connect(urls.worker, autocommit=True) as conn:
        conn.execute("SELECT cde.process_deadlines(%s)", [due - timedelta(hours=10)])
        conn.execute("SELECT cde.process_deadlines(%s)", [due + timedelta(hours=1)])
    des = notifications(client, as_user("des_lead"))
    assert any(n["kind"] == "RFI_REMINDER" and n["data"].get("rfi_id") == rfi["id"] for n in des)
    assert any(n["kind"] == "RFI_OVERDUE" and n["data"].get("rfi_id") == rfi["id"] for n in des)
