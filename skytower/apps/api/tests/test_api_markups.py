# "><(((º> sabusabu <º)))><"
"""Sprint 5 (G45): annotazioni ancorate alla revisione, visibilità come la revisione, risoluzione."""
from __future__ import annotations

import psycopg
import pytest
from test_api_states import as_user, transition, wip, worker  # noqa: F401 - fixture riusate

RECT = {"page": 1, "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.1}


def add(client, headers, revision_id, body="Quota mancante", **anchor):
    return client.post(f"/revisions/{revision_id}/markups", headers=headers, json={"body": body, **anchor})


def test_annotazione_segue_la_visibilita_della_revisione(client, as_user, wip):  # noqa: F811
    r = add(client, as_user("des_lead"), wip["id"], **RECT)
    assert r.status_code == 201, r.text
    m = r.json()
    assert m["page"] == 1 and m["status"] == "OPEN" and m["author_org_code"] and m["can_resolve"]
    # WIP: solo l'organizzazione autrice vede le annotazioni (e la revisione)
    assert [x["id"] for x in client.get(f"/revisions/{wip['id']}/markups", headers=as_user("des_viewer")).json()] == [m["id"]]
    for user in ("com_admin", "sub1_user", "out_user"):
        assert client.get(f"/revisions/{wip['id']}/markups", headers=as_user(user)).status_code == 404, user
        assert add(client, as_user(user), wip["id"]).status_code == 404, user


def test_thread_e_risoluzione(client, as_user, wip):  # noqa: F811
    lead = as_user("des_lead")
    shared = transition(client, lead, wip["id"], "SHARED", "S2").json()
    pub = transition(client, lead, shared["id"], "PUBLISHED", "A1", "ok").json()
    sub = as_user("sub1_user")
    m = add(client, sub, pub["id"], "Manca il dettaglio del nodo", page=2, x=0.5, y=0.5).json()
    assert m["can_resolve"]                                              # autore

    r = client.post(f"/markups/{m['id']}/replies", headers=lead, json={"body": "Aggiunto in P02"})
    assert r.status_code == 201 and r.json()["replies"][0]["body"] == "Aggiunto in P02"

    # altri membri vedono ma non risolvono
    other = as_user("sub2_user")
    seen = client.get(f"/revisions/{pub['id']}/markups", headers=other).json()
    assert any(x["id"] == m["id"] and not x["can_resolve"] for x in seen)
    assert client.post(f"/markups/{m['id']}/status", headers=other, json={"status": "RESOLVED"}).status_code == 403

    # l'organizzazione che ha emesso la revisione risolve; l'autore riapre
    done = client.post(f"/markups/{m['id']}/status", headers=lead, json={"status": "RESOLVED"}).json()
    assert done["status"] == "RESOLVED" and done["resolved_by_name"] and done["resolved_at"]
    assert client.get(f"/revisions/{pub['id']}/markups", headers=sub, params={"status": "OPEN"}).json() == []
    again = client.post(f"/markups/{m['id']}/status", headers=sub, json={"status": "OPEN"}).json()
    assert again["status"] == "OPEN" and again["resolved_at"] is None


@pytest.mark.parametrize("anchor", [
    {"x": 0.1},                                         # manca y
    {"x": 0.1, "y": 0.1, "w": 0.2},                     # manca h
    {"x": 0.9, "y": 0.1, "w": 0.5, "h": 0.1},           # esce dalla pagina
    {"x": 1.5, "y": 0.1},
    {"page": 0},
    {"color": "red"},
])
def test_ancoraggio_validato(client, as_user, wip, anchor):  # noqa: F811
    assert add(client, as_user("des_lead"), wip["id"], **anchor).status_code == 422


def test_testo_immutabile_e_risposte_append_only(api_world, client, as_user, wip):  # noqa: F811
    urls, _ = api_world
    m = add(client, as_user("des_lead"), wip["id"], element_ref="2O2Fr$t4X7Zf8NOew3FLOH").json()
    assert m["element_ref"] == "2O2Fr$t4X7Zf8NOew3FLOH"
    client.post(f"/markups/{m['id']}/replies", headers=as_user("des_lead"), json={"body": "ok"})
    with psycopg.connect(urls.owner) as conn:
        with pytest.raises(psycopg.Error, match="non si modifica"):
            conn.execute("UPDATE cde.revision_markups SET body = 'altro' WHERE id = %s", [m["id"]])
        conn.rollback()
        with pytest.raises(psycopg.Error):
            conn.execute("DELETE FROM cde.markup_replies WHERE markup_id = %s", [m["id"]])


def test_task_di_altri_rifiutato(client, as_user, wip, api_world):  # noqa: F811
    r = add(client, as_user("des_lead"), wip["id"], task_id="00000000-0000-0000-0000-000000000001")
    assert r.status_code == 422
