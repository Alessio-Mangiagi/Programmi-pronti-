# "><(((º> sabusabu <º)))><"
"""Persone del cantiere: iscrivere un utente che esiste già e toglierlo (POST/DELETE /projects/{id}/members).

Prima mancava dal web: un utente registrato non si poteva aggiungere a un altro cantiere, perché l'invito
rifiuta le email già registrate (correzione emersa scrivendo la guida, 04/11/2026). Qui: chi può farlo,
utenti disattivati, effetto sull'elenco dei cantieri visibili, tracce nel registro operazioni.
"""
from tests.conftest import login, make_user


def _registro(client, azione):
    return client.get("/audit", params={"action": [azione]}).json()["items"]


def test_iscrivi_utente_esistente_e_toglilo(client, project, users):
    pid = project["project"]["id"]
    out = users["outsider"]
    # prima non vede il cantiere
    assert pid not in {p["id"] for p in client.get("/projects", headers=out["headers"]).json()}
    r = client.post(f"/projects/{pid}/members", json={"user_id": out["id"]})
    assert r.status_code == 201 and out["id"] in {m["id"] for m in r.json()}
    assert pid in {p["id"] for p in client.get("/projects", headers=out["headers"]).json()}
    voce = _registro(client, "project.member_added")[0]
    assert voce["details"]["email"] == out["email"] and voce["project_id"] == pid
    # due volte: nessun doppione e nessuna seconda riga nel registro
    assert client.post(f"/projects/{pid}/members", json={"user_id": out["id"]}).status_code == 201
    assert len([v for v in _registro(client, "project.member_added") if v["details"]["email"] == out["email"]]) == 1
    # toglierlo: non vede più il cantiere, traccia nel registro; una seconda volta 404
    assert client.delete(f"/projects/{pid}/members/{out['id']}").status_code == 204
    assert pid not in {p["id"] for p in client.get("/projects", headers=out["headers"]).json()}
    assert _registro(client, "project.member_removed")[0]["details"]["email"] == out["email"]
    assert client.delete(f"/projects/{pid}/members/{out['id']}").status_code == 404


def test_chi_puo_iscrivere(client, project, users):
    pid = project["project"]["id"]
    out = users["outsider"]
    # chi lavora in campo no; il manager del cantiere sì
    assert client.post(f"/projects/{pid}/members", json={"user_id": out["id"]},
                       headers=users["field"]["headers"]).status_code == 403
    assert client.post(f"/projects/{pid}/members", json={"user_id": out["id"]},
                       headers=users["manager"]["headers"]).status_code == 201
    # un manager che non fa parte del cantiere no
    with client.session_factory() as s:
        make_user(s, "altro.manager@test.local", "manager")
    estraneo = login(client, "altro.manager@test.local")
    assert client.post(f"/projects/{pid}/members", json={"user_id": out["id"]}, headers=estraneo).status_code == 403
    assert client.delete(f"/projects/{pid}/members/{out['id']}", headers=estraneo).status_code == 403
    # utente o cantiere inesistenti
    assert client.post(f"/projects/{pid}/members", json={"user_id": "nessuno"}).status_code == 404
    assert client.post("/projects/nessuno/members", json={"user_id": out["id"]}).status_code == 404


def test_utente_disattivato_non_si_iscrive(client, project, users):
    pid = project["project"]["id"]
    out = users["outsider"]
    assert client.patch(f"/users/{out['id']}", json={"is_active": False}).status_code == 200
    r = client.post(f"/projects/{pid}/members", json={"user_id": out["id"]})
    assert r.status_code == 409
