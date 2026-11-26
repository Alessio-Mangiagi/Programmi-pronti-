# "><(((º> sabusabu <º)))><"
"""Discussioni e task fra le persone della commessa (ADR-59, migrazione 0047).

Scelte dell'utente del 26/11/2026: 1b (in SkyTower, per commessa), 2a (una discussione la vedono solo gli invitati,
nemmeno il Project Admin), 3b (task con più persone, priorità, scadenza, sotto-task, commenti, bacheca), 4c (avvisi
ed email a chi è coinvolto, più il riepilogo del mattino solo a chi ha assegnato i task, per supervisionare).
Il database di test è condiviso fra i moduli: ogni test crea i suoi oggetti e filtra le email per destinatario.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import psycopg
from psycopg.rows import dict_row
from test_api_naming_auto import as_user  # noqa: F401 - fixture riusata
from test_api_suite import come

from cde_api.mail import ConsoleMailer
from cde_api.notifier import send_team_task_digests, team_digest_projects

BASE = "https://cde.example"


def _discussione(client, h, project_id, invitati, titolo=None, testo="Ci vediamo in cantiere giovedì?"):
    r = client.post(f"/projects/{project_id}/discussions", headers=h,
                    json={"title": titolo or f"Coordinamento {uuid.uuid4().hex[:6]}", "body": testo,
                          "participant_ids": [str(u) for u in invitati]})
    assert r.status_code == 201, r.text
    return r.json()


def _task(client, h, project_id, assegnati, **extra):
    body = {"title": f"Verifica {uuid.uuid4().hex[:6]}", "assignee_ids": [str(u) for u in assegnati], **extra}
    r = client.post(f"/projects/{project_id}/team-tasks", headers=h, json=body)
    assert r.status_code == 201, r.text
    return r.json()


def _avvisi(client, h, kind, chiave=None, valore=None, solo_non_letti=False):
    items = client.get("/notifications", headers=h, params={"limit": 200, "unread_only": solo_non_letti}).json()["items"]
    return [n for n in items if n["kind"] == kind and (chiave is None or n["data"].get(chiave) == str(valore))]


# ---------------------------------------------------------------------
# Discussioni
# ---------------------------------------------------------------------
def test_discussione_la_vedono_solo_gli_invitati(client, api_world, as_user):  # noqa: F811
    _, w = api_world
    lead, dl = as_user("des_lead"), as_user("com_dl")
    d = _discussione(client, lead, w.project_id, [w.users["com_dl"]])
    assert d["i_am_creator"] and d["participant_count"] == 2 and d["message_count"] == 1
    assert {p["name"] for p in d["participants"]} == {"Des Lead", "Com Dl"}

    # l'invitato (altra organizzazione) la vede e riceve l'invito
    assert client.get(f"/discussions/{d['id']}", headers=dl).status_code == 200
    assert any(x["id"] == d["id"] for x in client.get(f"/projects/{w.project_id}/discussions", headers=dl).json())
    assert _avvisi(client, dl, "DISCUSSION_ADDED", "discussion_id", d["id"])
    # nessun altro: né il Project Admin né un collega di chi l'ha aperta
    for chi in ("com_admin", "des_designer"):
        h = as_user(chi)
        assert client.get(f"/discussions/{d['id']}", headers=h).status_code == 404, chi
        assert all(x["id"] != d["id"] for x in client.get(f"/projects/{w.project_id}/discussions", headers=h).json())
        r = client.post(f"/discussions/{d['id']}/messages", headers=h, json={"body": "posso entrare?"})
        assert r.status_code == 404, chi

    # risposta: chi l'ha aperta ha un non letto e un avviso; aprendola si azzerano entrambi
    assert client.post(f"/discussions/{d['id']}/messages", headers=dl, json={"body": "Sì, alle 9"}).status_code == 201
    riga = next(x for x in client.get(f"/projects/{w.project_id}/discussions", headers=lead).json() if x["id"] == d["id"])
    assert riga["unread"] == 1 and riga["last_body"] == "Sì, alle 9" and riga["last_author"] == "Com Dl"
    assert any(x["id"] == d["id"] for x in client.get("/me/discussions", headers=lead).json())
    assert _avvisi(client, lead, "DISCUSSION_MESSAGE", "discussion_id", d["id"], solo_non_letti=True)
    assert client.post(f"/discussions/{d['id']}/read", headers=lead).status_code == 200
    riga = next(x for x in client.get(f"/projects/{w.project_id}/discussions", headers=lead).json() if x["id"] == d["id"])
    assert riga["unread"] == 0
    assert not _avvisi(client, lead, "DISCUSSION_MESSAGE", "discussion_id", d["id"], solo_non_letti=True)

    # tre messaggi di fila: un solo avviso finché non legge (niente raffica di email)
    for n in range(3):
        client.post(f"/discussions/{d['id']}/messages", headers=dl, json={"body": f"aggiornamento {n}"})
    assert len(_avvisi(client, lead, "DISCUSSION_MESSAGE", "discussion_id", d["id"], solo_non_letti=True)) == 1
    assert next(x for x in client.get(f"/projects/{w.project_id}/discussions", headers=lead).json()
                if x["id"] == d["id"])["unread"] == 3


def test_discussione_invitati_validi(client, api_world, as_user):  # noqa: F811
    _, w = api_world
    lead = as_user("des_lead")
    base = {"title": "Riunione impianti", "body": "ordine del giorno"}
    # da soli no, e solo membri della commessa
    r = client.post(f"/projects/{w.project_id}/discussions", headers=lead,
                    json={**base, "participant_ids": [str(w.users["des_lead"])]})
    assert r.status_code == 422
    r = client.post(f"/projects/{w.project_id}/discussions", headers=lead,
                    json={**base, "participant_ids": [str(w.users["sub1_nomember"])]})
    assert r.status_code == 422 and "membro della commessa" in r.json()["error"]["message"]
    # chi non è della commessa non apre discussioni lì
    r = client.post(f"/projects/{w.project_id}/discussions", headers=as_user("out_user"),
                    json={**base, "participant_ids": [str(w.users["com_dl"])]})
    assert r.status_code == 404


def test_discussione_persone_chiusura_e_uscita(client, api_world, as_user):  # noqa: F811
    _, w = api_world
    lead, dl, sub = as_user("des_lead"), as_user("com_dl"), as_user("sub1_user")
    d = _discussione(client, lead, w.project_id, [w.users["com_dl"]])
    # solo chi l'ha aperta cambia persone e titolo
    r = client.patch(f"/discussions/{d['id']}", headers=dl, json={"participant_ids": [str(w.users["sub1_user"])]})
    assert r.status_code == 403
    r = client.patch(f"/discussions/{d['id']}", headers=lead,
                     json={"title": "Canaline piano terra", "participant_ids": [str(w.users["sub1_user"])]})
    assert r.status_code == 200, r.text
    assert r.json()["title"] == "Canaline piano terra"
    assert {p["name"] for p in r.json()["participants"]} == {"Des Lead", "Sub1 User"}
    assert client.get(f"/discussions/{d['id']}", headers=dl).status_code == 404        # tolto: non la vede più
    assert client.get(f"/discussions/{d['id']}", headers=sub).status_code == 200       # aggiunto: la vede tutta
    assert len(client.get(f"/discussions/{d['id']}", headers=sub).json()["messages"]) == 1
    assert _avvisi(client, sub, "DISCUSSION_ADDED", "discussion_id", d["id"])

    # chiusa: niente messaggi; riaperta: di nuovo
    assert client.patch(f"/discussions/{d['id']}", headers=sub, json={"closed": True}).status_code == 403
    assert client.patch(f"/discussions/{d['id']}", headers=lead, json={"closed": True}).json()["closed_at"]
    r = client.post(f"/discussions/{d['id']}/messages", headers=sub, json={"body": "ancora una cosa"})
    assert r.status_code == 422 and "chiusa" in r.json()["error"]["message"]
    assert all(x["id"] != d["id"] for x in client.get(f"/projects/{w.project_id}/discussions", headers=sub).json())
    assert any(x["id"] == d["id"] for x in client.get(f"/projects/{w.project_id}/discussions?stato=chiuse",
                                                      headers=sub).json())
    assert client.patch(f"/discussions/{d['id']}", headers=lead, json={"closed": False}).json()["closed_at"] is None
    assert client.post(f"/discussions/{d['id']}/messages", headers=sub, json={"body": "ancora una cosa"}).status_code == 201

    # si esce da soli (non chi l'ha aperta)
    assert client.post(f"/discussions/{d['id']}/leave", headers=lead).status_code == 422
    assert client.post(f"/discussions/{d['id']}/leave", headers=sub).status_code == 200
    assert client.get(f"/discussions/{d['id']}", headers=sub).status_code == 404


# ---------------------------------------------------------------------
# Task
# ---------------------------------------------------------------------
def test_task_visibilita_permessi_e_storia(client, api_world, as_user):  # noqa: F811
    _, w = api_world
    im, lead, sub = as_user("com_im"), as_user("des_lead"), as_user("sub1_user")
    t = _task(client, im, w.project_id, [w.users["des_lead"], w.users["sub1_user"]], priority="HIGH",
              due_on="2031-03-15", description="Controllare quote e sezioni", items=["Piano terra", "Primo piano", " "])
    assert t["code"].startswith("TASK-") and t["status"] == "TODO" and t["priority"] == "HIGH"
    assert t["items_total"] == 2 and [i["title"] for i in t["items"]] == ["Piano terra", "Primo piano"]
    assert {a["name"] for a in t["assignees"]} == {"Des Lead", "Sub1 User"} and t["i_am_creator"]
    avviso = _avvisi(client, lead, "TEAM_TASK_ASSIGNED", "task_id", t["id"])[0]
    assert "15/03/2031" in avviso["body"] and avviso["link"].endswith(f"/task/{t['id']}")

    # lo vedono solo chi l'ha dato e chi l'ha: non il Project Admin, non un collega
    for chi in ("com_admin", "des_designer"):
        assert client.get(f"/team-tasks/{t['id']}", headers=as_user(chi)).status_code == 404, chi
        assert client.patch(f"/team-tasks/{t['id']}", headers=as_user(chi), json={"status": "DONE"}).status_code == 404

    # chi l'ha ricevuto cambia lo stato e lavora sui sotto-task, ma non titolo, scadenza o persone
    r = client.patch(f"/team-tasks/{t['id']}", headers=lead, json={"status": "IN_PROGRESS"})
    assert r.status_code == 200 and r.json()["status"] == "IN_PROGRESS"
    for campo in ({"title": "Altro titolo"}, {"due_on": "2031-12-31"}, {"assignee_ids": [str(w.users["des_lead"])]}):
        assert client.patch(f"/team-tasks/{t['id']}", headers=lead, json=campo).status_code == 403, campo
    voce = t["items"][0]
    r = client.patch(f"/team-tasks/{t['id']}/items/{voce['id']}", headers=lead, json={"done": True})
    assert r.json()["items_done"] == 1 and r.json()["items"][0]["done_by_name"] == "Des Lead"
    r = client.post(f"/team-tasks/{t['id']}/items", headers=lead, json={"title": "Copertura"})
    assert r.json()["items_total"] == 3
    # il sotto-task scritto da altri lo toglie solo chi ha dato il task
    assert client.delete(f"/team-tasks/{t['id']}/items/{voce['id']}", headers=lead).status_code == 403
    # un sotto-task di un altro task: 404
    altro = _task(client, im, w.project_id, [w.users["des_lead"]], items=["voce"])
    assert client.patch(f"/team-tasks/{t['id']}/items/{altro['items'][0]['id']}", headers=lead,
                        json={"done": True}).status_code == 404

    # commento: avvisati chi ha dato il task e l'altra persona, non chi scrive
    assert client.post(f"/team-tasks/{t['id']}/comments", headers=lead, json={"body": "Quote ok al piano terra"}).status_code == 201
    assert _avvisi(client, im, "TEAM_TASK_COMMENT", "task_id", t["id"]) and _avvisi(client, sub, "TEAM_TASK_COMMENT", "task_id", t["id"])
    assert not _avvisi(client, lead, "TEAM_TASK_COMMENT", "task_id", t["id"])

    # elenchi: "assegnati a me" e "assegnati da me", "Per me" fino a quando è fatto
    ids = lambda h, vista: [x["id"] for x in client.get(f"/projects/{w.project_id}/team-tasks?vista={vista}", headers=h).json()]
    assert t["id"] in ids(lead, "assegnati_a_me") and t["id"] not in ids(lead, "assegnati_da_me")
    assert t["id"] in ids(im, "assegnati_da_me") and t["id"] not in ids(im, "assegnati_a_me")
    assert any(x["id"] == t["id"] for x in client.get("/me/team-tasks", headers=sub).json())

    # fatto: chi l'ha dato lo sa subito
    r = client.patch(f"/team-tasks/{t['id']}", headers=lead, json={"status": "DONE"})
    assert r.json()["status"] == "DONE" and r.json()["completed_at"]
    assert "Des Lead ha completato" in _avvisi(client, im, "TEAM_TASK_COMPLETED", "task_id", t["id"])[0]["body"]
    assert all(x["id"] != t["id"] for x in client.get("/me/team-tasks", headers=sub).json())
    storia = [e["kind"] for e in client.get(f"/team-tasks/{t['id']}", headers=im).json()["events"]]
    for k in ("CREATED", "STATUS", "ITEM_DONE", "ITEM_ADDED", "COMMENT"):
        assert k in storia, k

    # chi l'ha dato toglie una persona (che non lo vede più) e lo elimina; gli altri no
    r = client.patch(f"/team-tasks/{t['id']}", headers=im, json={"assignee_ids": [str(w.users["des_lead"])]})
    assert r.status_code == 200 and [a["name"] for a in r.json()["assignees"]] == ["Des Lead"]
    assert client.get(f"/team-tasks/{t['id']}", headers=sub).status_code == 404
    assert client.delete(f"/team-tasks/{t['id']}", headers=lead).status_code == 403
    assert client.delete(f"/team-tasks/{t['id']}", headers=im).status_code == 204
    assert client.get(f"/team-tasks/{t['id']}", headers=im).status_code == 404
    assert client.get(f"/team-tasks/{t['id']}", headers=lead).status_code == 404


def test_task_valori_non_validi(client, api_world, as_user):  # noqa: F811
    _, w = api_world
    im = as_user("com_im")
    r = client.post(f"/projects/{w.project_id}/team-tasks", headers=im,
                    json={"title": "Senza persone", "assignee_ids": []})
    assert r.status_code == 422
    r = client.post(f"/projects/{w.project_id}/team-tasks", headers=im,
                    json={"title": "Fuori commessa", "assignee_ids": [str(w.users["out_user"])]})
    assert r.status_code == 422
    t = _task(client, im, w.project_id, [w.users["com_dl"]])
    assert client.patch(f"/team-tasks/{t['id']}", headers=im, json={"status": "FORSE"}).status_code == 422
    assert client.patch(f"/team-tasks/{t['id']}", headers=im, json={"priority": "ALTISSIMA"}).status_code == 422
    # null espliciti: la scadenza si toglie, gli altri campi restano com'erano
    client.patch(f"/team-tasks/{t['id']}", headers=im, json={"due_on": "2031-01-10"})
    r = client.patch(f"/team-tasks/{t['id']}", headers=im, json={"due_on": None, "title": None, "assignee_ids": None})
    assert r.status_code == 200 and r.json()["due_on"] is None and r.json()["title"] == t["title"]


def test_task_da_un_messaggio_della_discussione(client, api_world, as_user):  # noqa: F811
    _, w = api_world
    lead, dl, admin = as_user("des_lead"), as_user("com_dl"), as_user("com_admin")
    d = _discussione(client, lead, w.project_id, [w.users["com_dl"]])
    msg = client.post(f"/discussions/{d['id']}/messages", headers=dl,
                      json={"body": "Serve il dettaglio del nodo trave-pilastro"}).json()["messages"][-1]
    t = _task(client, lead, w.project_id, [w.users["com_dl"], w.users["com_admin"]], discussion_id=d["id"],
              message_id=msg["id"], description=msg["body"])
    # nella discussione il task compare sotto il messaggio e nell'elenco dei task nati lì
    dd = client.get(f"/discussions/{d['id']}", headers=dl).json()
    assert dd["tasks"][0]["id"] == t["id"] and dd["messages"][-1]["tasks"][0]["code"] == t["code"]
    # nel task la discussione la vede chi partecipa; il Project Admin assegnato vede il task ma non la discussione
    assert client.get(f"/team-tasks/{t['id']}", headers=dl).json()["discussion"]["title"] == d["title"]
    da_admin = client.get(f"/team-tasks/{t['id']}", headers=admin).json()
    assert da_admin["discussion"] is None and da_admin["discussion_id"] == d["id"]
    # chi non partecipa alla discussione non crea task dai suoi messaggi
    r = client.post(f"/projects/{w.project_id}/team-tasks", headers=admin,
                    json={"title": "Dal messaggio", "assignee_ids": [str(w.users["com_dl"])], "message_id": msg["id"]})
    assert r.status_code == 404


def test_scadenze_dei_task(client, api_world, as_user):  # noqa: F811
    urls, w = api_world
    im, lead = as_user("com_im"), as_user("des_lead")
    with psycopg.connect(urls.owner) as conn:
        oggi = conn.execute("SELECT cde.local_date(now(), 'Europe/Rome')").fetchone()[0]

    def giro():
        with psycopg.connect(urls.worker, autocommit=True) as conn:
            return conn.execute("SELECT cde.team_task_deadlines(now())").fetchone()[0]

    t = _task(client, im, w.project_id, [w.users["des_lead"]], due_on=oggi.isoformat())
    giro()
    promemoria = _avvisi(client, lead, "TEAM_TASK_REMINDER", "task_id", t["id"])
    assert len(promemoria) == 1 and "scade oggi" in promemoria[0]["title"]
    giro()
    assert len(_avvisi(client, lead, "TEAM_TASK_REMINDER", "task_id", t["id"])) == 1      # una volta sola
    # scadenza spostata a ieri da chi l'ha dato: in ritardo, avvisati in due
    client.patch(f"/team-tasks/{t['id']}", headers=im, json={"due_on": (oggi - timedelta(days=1)).isoformat()})
    assert _avvisi(client, lead, "TEAM_TASK_DUE_CHANGED", "task_id", t["id"])
    giro()
    assert _avvisi(client, lead, "TEAM_TASK_OVERDUE", "task_id", t["id"])
    assert _avvisi(client, im, "TEAM_TASK_OVERDUE", "task_id", t["id"])
    task = client.get(f"/team-tasks/{t['id']}", headers=im).json()
    assert task["overdue"] and task["events"][0]["kind"] == "OVERDUE" and task["events"][0]["actor_name"] is None
    # un task fatto non ha più scadenze
    fatto = _task(client, im, w.project_id, [w.users["des_lead"]], due_on=oggi.isoformat())
    client.patch(f"/team-tasks/{fatto['id']}", headers=lead, json={"status": "DONE"})
    giro()
    assert not _avvisi(client, lead, "TEAM_TASK_REMINDER", "task_id", fatto["id"])


def test_riepilogo_solo_a_chi_ha_assegnato(client, api_world, as_user):  # noqa: F811
    urls, w = api_world
    dl, designer, sub2 = as_user("com_dl"), as_user("des_designer"), as_user("sub2_user")
    a = _task(client, dl, w.project_id, [w.users["des_designer"]], title="Tavole del piano terra",
              items=["Pianta", "Sezione"], due_on="2031-06-30", priority="URGENT")
    b = _task(client, dl, w.project_id, [w.users["sub2_user"]], title="Montaggio carpenterie")
    proprio = _task(client, dl, w.project_id, [w.users["com_dl"]], title="Promemoria personale del DL")
    client.patch(f"/team-tasks/{a['id']}", headers=designer, json={"status": "IN_PROGRESS"})
    client.patch(f"/team-tasks/{a['id']}/items/{a['items'][0]['id']}", headers=designer, json={"done": True})
    client.post(f"/team-tasks/{a['id']}/comments", headers=designer, json={"body": "Sezione entro domani"})
    client.patch(f"/team-tasks/{b['id']}", headers=sub2, json={"status": "DONE"})

    mailer = ConsoleMailer()
    adesso = datetime.now(UTC)
    with psycopg.connect(urls.worker, row_factory=dict_row) as conn:
        send_team_task_digests(conn, mailer, BASE, now=adesso)
    mail = [m for m in mailer.outbox if m.to == w.emails["com_dl"]]
    assert len(mail) == 1 and mail[0].subject == "Avanzamento dei task che hai assegnato"
    corpo = mail[0].body
    assert "Completati (1)" in corpo and "Montaggio carpenterie" in corpo and "completato da Sub2 User" in corpo
    assert "In corso (1)" in corpo and "Tavole del piano terra — Des Designer · sotto-task 1/2" in corpo
    assert "scadenza 30/06/2031 · priorità urgente" in corpo
    assert "Des Designer l'ha spostato in «In corso»" in corpo and "Des Designer ha completato il sotto-task «Pianta»" in corpo
    assert "1 commento di Des Designer" in corpo and f"{BASE}/progetti/{w.project_id}/task/{a['id']}" in corpo
    assert proprio["title"] not in corpo                       # i task dati a sé stessi non si supervisionano
    # chi ha ricevuto i task non ha nessun riepilogo di supervisione
    assert not [m for m in mailer.outbox if m.to in (w.emails["des_designer"], w.emails["sub2_user"])]

    # una volta al giorno: lo stesso giro ripetuto non manda doppioni
    mailer = ConsoleMailer()
    with psycopg.connect(urls.worker, row_factory=dict_row) as conn:
        send_team_task_digests(conn, mailer, BASE, now=adesso + timedelta(minutes=5))
    assert not [m for m in mailer.outbox if m.to == w.emails["com_dl"]]

    # il giorno dopo: i movimenti partono dall'ultimo riepilogo, il completato di ieri non c'è più
    client.patch(f"/team-tasks/{a['id']}/items/{a['items'][1]['id']}", headers=designer, json={"done": True})
    mailer = ConsoleMailer()
    with psycopg.connect(urls.worker, row_factory=dict_row) as conn:
        send_team_task_digests(conn, mailer, BASE, now=adesso + timedelta(hours=21))
    corpo = next(m for m in mailer.outbox if m.to == w.emails["com_dl"]).body
    assert "sotto-task 2/2" in corpo and "«Sezione»" in corpo and "«Pianta»" not in corpo
    assert "Montaggio carpenterie" not in corpo

    # spento dalle preferenze: niente riepilogo
    prefs = client.get("/me/notification-preferences", headers=dl).json()
    assert prefs["team_task_digest"] is True
    try:
        r = client.put("/me/notification-preferences", headers=dl, json={**prefs, "team_task_digest": False})
        assert r.status_code == 200 and client.get("/me/notification-preferences", headers=dl).json()["team_task_digest"] is False
        mailer = ConsoleMailer()
        with psycopg.connect(urls.worker, row_factory=dict_row) as conn:
            send_team_task_digests(conn, mailer, BASE, now=adesso + timedelta(hours=45))
        assert not [m for m in mailer.outbox if m.to == w.emails["com_dl"]]
    finally:
        client.put("/me/notification-preferences", headers=dl, json=prefs)


def test_riepilogo_in_inglese():
    task = {"id": "t1", "project_id": "p1", "project_code": "PRJ01", "project_name": "Ospedale", "code": "TASK-0007",
            "title": "Check", "status": "TODO", "priority": "HIGH", "due_on": "2031-01-02", "overdue": True,
            "completed_at": None, "completed_by": None, "assignees": "Des Lead", "items_done": 0, "items_total": 0,
            "events": [{"kind": "OVERDUE", "data": {}, "actor": None}, {"kind": "COMMENT", "data": {}, "actor": "Des Lead"},
                       {"kind": "COMMENT", "data": {}, "actor": "Des Lead"}]}
    [p] = team_digest_projects([task], "en", BASE)
    [(titolo, [riga])] = p["groups"]
    assert titolo == "Overdue" and riga["line"] == "TASK-0007 Check — Des Lead · due 02/01/2031 · high priority"
    assert riga["events"] == ["deadline passed", "2 comments by Des Lead"]


def test_task_nel_da_fare_del_portale(client, api_world, as_user):  # noqa: F811
    _, w = api_world
    t = _task(client, as_user("com_im"), w.project_id, [w.users["com_admin"]], title="Firmare il verbale di consegna",
              priority="URGENT")
    r = client.get("/suite/da-fare", headers=come(w, "com_admin"))
    assert r.status_code == 200, r.text
    voce = next(v for v in r.json()["voci"] if v["id"] == f"task:{t['id']}")
    assert voce["titolo"] == "Task: Firmare il verbale di consegna" and voce["tipo"] == "task" and voce["priorita"] == 1
    assert "da Com Im" in voce["testo"] and "urgente" in voce["testo"] and voce["url"].endswith(f"/task/{t['id']}")
