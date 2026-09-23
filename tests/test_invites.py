"""
Inviti con credenziali preimpostate: etichette (solo admin) e inviti
(admin e manager), link a uso singolo con scadenza, accettazione pubblica.
"""
from datetime import timedelta

import pytest

from app import invites as inv_lib
from app import models
from app.models import utcnow
from tests.conftest import PASSWORD, login


def make_label(client, name="Capocantiere", **kw):
    body = {"name": name, "role": "manager", **kw}
    r = client.post("/invite-labels", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def invite(client, email="nuovo@test.local", label=None, **kw):
    label = label or make_label(client)
    r = client.post("/invites", json={"email": email, "label_id": label["id"], **kw})
    assert r.status_code == 201, r.text
    return r.json()


def token_of(url: str) -> str:
    return url.rsplit("/", 1)[-1]


# ---------- Etichette ----------

def test_label_crud_admin_only(client, users):
    lab = make_label(client, project_ids=[], commessa_ids=[], description="Responsabile di cantiere")
    assert lab["role"] == "manager" and lab["pending_invites"] == 0 and lab["position"] == 1

    # il manager le legge (gli servono per invitare) ma non le tocca
    assert client.get("/invite-labels", headers=users["manager"]["headers"]).status_code == 200
    assert client.post("/invite-labels", headers=users["manager"]["headers"],
                       json={"name": "Altra", "role": "field"}).status_code == 403
    assert client.patch(f"/invite-labels/{lab['id']}", headers=users["manager"]["headers"],
                        json={"role": "admin"}).status_code == 403
    assert client.delete(f"/invite-labels/{lab['id']}", headers=users["manager"]["headers"]).status_code == 403
    # il campo non vede nemmeno l'elenco
    assert client.get("/invite-labels", headers=users["field"]["headers"]).status_code == 403

    r = client.patch(f"/invite-labels/{lab['id']}", json={"name": "Capo cantiere", "notify_push": False})
    assert r.status_code == 200 and r.json()["name"] == "Capo cantiere" and r.json()["notify_push"] is False
    assert client.delete(f"/invite-labels/{lab['id']}").status_code == 204
    assert client.get("/invite-labels").json() == []


def test_label_name_unique_and_ids_checked(client, project):
    make_label(client, "Operaio", role="field")
    assert client.post("/invite-labels", json={"name": "Operaio", "role": "field"}).status_code == 409
    assert client.post("/invite-labels", json={"name": " ", "role": "field"}).status_code == 422
    assert client.post("/invite-labels", json={"name": "X", "role": "capo"}).status_code == 422
    r = client.post("/invite-labels", json={"name": "X", "role": "field", "project_ids": ["non-esiste"]})
    assert r.status_code == 422 and "unknown project_ids" in r.text
    ok = client.post("/invite-labels", json={"name": "X", "role": "field",
                                             "project_ids": [project["project"]["id"]]})
    assert ok.status_code == 201 and ok.json()["projects_count"] == 1


def test_label_archived_is_hidden_and_not_invitable(client):
    lab = make_label(client, "Stagionale", role="field")
    client.patch(f"/invite-labels/{lab['id']}", json={"archived": True})
    assert client.get("/invite-labels").json() == []
    assert len(client.get("/invite-labels", params={"include_archived": True}).json()) == 1
    assert client.post("/invites", json={"email": "x@test.local", "label_id": lab["id"]}).status_code == 404


def test_label_with_invites_cannot_be_deleted(client):
    lab = make_label(client, "Operaio", role="field")
    inv = invite(client, "operaio@test.local", lab)
    assert client.delete(f"/invite-labels/{lab['id']}").status_code == 409  # invito in sospeso
    client.delete(f"/invites/{inv['id']}")
    assert client.delete(f"/invite-labels/{lab['id']}").status_code == 409  # resta lo storico: si archivia


# ---------- Creazione inviti ----------

def test_invite_link_only_once_and_hashed(client):
    inv = invite(client)
    assert inv["url"].startswith("http") and inv["status"] == "pending"
    token = token_of(inv["url"])
    with client.session_factory() as s:
        row = s.get(models.Invite, inv["id"])
        assert row.token_hash != token and row.token_hash == inv_lib.token_hash(token)
    # l'elenco non ripropone il link: esiste in chiaro solo nella risposta di creazione
    assert client.get("/invites").json()[0]["url"] is None


def test_invite_validations(client, users):
    lab = make_label(client, "Operaio", role="field")
    assert client.post("/invites", json={"email": "non-una-email", "label_id": lab["id"]}).status_code == 422
    assert client.post("/invites", json={"email": "x@test.local", "label_id": "boh"}).status_code == 404
    assert client.post("/invites", json={"email": users["field"]["email"], "label_id": lab["id"]}).status_code == 409
    invite(client, "doppio@test.local", lab)
    assert client.post("/invites", json={"email": "doppio@test.local", "label_id": lab["id"]}).status_code == 409


def test_manager_cannot_invite_above_own_role(client, users):
    field_label = make_label(client, "Operaio", role="field")
    admin_label = make_label(client, "Amministratore", role="admin")
    mgr = users["manager"]["headers"]
    assert client.post("/invites", headers=mgr, json={"email": "a@test.local", "label_id": field_label["id"]}).status_code == 201
    r = client.post("/invites", headers=mgr, json={"email": "b@test.local", "label_id": admin_label["id"]})
    assert r.status_code == 403
    # il campo non invita affatto
    assert client.post("/invites", headers=users["field"]["headers"],
                       json={"email": "c@test.local", "label_id": field_label["id"]}).status_code == 403


def test_manager_sees_only_own_invites(client, users):
    lab = make_label(client, "Operaio", role="field")
    invite(client, "dallammin@test.local", lab)                       # creato dall'admin
    mgr = users["manager"]["headers"]
    client.post("/invites", headers=mgr, json={"email": "dalmanager@test.local", "label_id": lab["id"]})
    mine = [i["email"] for i in client.get("/invites", headers=mgr).json()]
    assert mine == ["dalmanager@test.local"]
    assert len(client.get("/invites").json()) == 2                    # l'admin li vede tutti


# ---------- Accettazione ----------

def test_accept_applies_label_profile(client, project):
    pid = project["project"]["id"]
    lab = make_label(client, "Capocantiere", role="manager", project_ids=[pid], notify_push=False)
    inv = invite(client, "capo@test.local", lab, name="Mario Rossi")
    token = token_of(inv["url"])

    prev = client.get(f"/invites/token/{token}").json()
    assert prev == {"email": "capo@test.local", "name": "Mario Rossi", "label_name": "Capocantiere",
                    "role": "manager", "projects_count": 1, "expires_at": prev["expires_at"]}

    r = client.post("/invites/accept", json={"token": token, "name": "Mario Rossi", "password": "passwordnuova1"})
    assert r.status_code == 201, r.text
    user = r.json()["user"]
    assert user["email"] == "capo@test.local" and user["role"] == "manager" and user["notify_push"] is False

    # entra davvero, e col profilo dell'etichetta vede il cantiere previsto
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert [p["id"] for p in client.get("/projects", headers=headers).json()] == [pid]

    # token consumato: preview e riuso falliscono, l'invito risulta accettato
    assert client.get(f"/invites/token/{token}").status_code == 404
    assert client.post("/invites/accept", json={"token": token, "name": "X", "password": "passwordnuova1"}).status_code == 404
    assert client.get("/invites", params={"include_done": True}).json()[0]["status"] == "accepted"


def test_accept_expands_commessa_to_its_projects(client):
    com = client.post("/commesse", json={"code": "C-1", "name": "Commessa 1"}).json()
    a = client.post("/projects", json={"name": "Cantiere A", "commessa_id": com["id"]}).json()
    b = client.post("/projects", json={"name": "Cantiere B", "commessa_id": com["id"]}).json()
    client.post("/projects", json={"name": "Fuori commessa"})
    lab = make_label(client, "Operaio commessa", role="field", commessa_ids=[com["id"]])
    assert client.get("/invite-labels").json()[0]["projects_count"] == 2

    inv = invite(client, "operaio@test.local", lab)
    r = client.post("/invites/accept", json={"token": token_of(inv["url"]), "name": "Op", "password": "passwordnuova1"})
    headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
    assert sorted(p["id"] for p in client.get("/projects", headers=headers).json()) == sorted([a["id"], b["id"]])


def test_accept_requires_valid_state_and_password(client):
    inv = invite(client)
    token = token_of(inv["url"])
    assert client.post("/invites/accept", json={"token": token, "name": "X", "password": "corta"}).status_code == 422
    assert client.post("/invites/accept", json={"token": token, "name": " ", "password": "passwordnuova1"}).status_code == 422
    assert client.post("/invites/accept", json={"token": "inventato", "name": "X", "password": "passwordnuova1"}).status_code == 404


def test_revoked_and_expired_links_stop_working(client):
    lab = make_label(client, "Operaio", role="field")
    revoked = invite(client, "revocato@test.local", lab)
    assert client.delete(f"/invites/{revoked['id']}").status_code == 204
    assert client.get(f"/invites/token/{token_of(revoked['url'])}").status_code == 404

    expired = invite(client, "scaduto@test.local", lab)
    with client.session_factory() as s:
        row = s.get(models.Invite, expired["id"])
        row.expires_at = utcnow() - timedelta(minutes=1)
        s.commit()
    assert client.get(f"/invites/token/{token_of(expired['url'])}").status_code == 404
    done = {i["email"]: i["status"] for i in client.get("/invites", params={"include_done": True}).json()}
    assert done == {"revocato@test.local": "revoked", "scaduto@test.local": "expired"}
    assert client.get("/invites").json() == []  # nessuno dei due è più in sospeso


def test_resend_rotates_token_and_extends_expiry(client):
    inv = invite(client)
    old = token_of(inv["url"])
    again = client.post(f"/invites/{inv['id']}/resend")
    assert again.status_code == 200
    new = token_of(again.json()["url"])
    assert new != old
    assert client.get(f"/invites/token/{old}").status_code == 404
    assert client.get(f"/invites/token/{new}").status_code == 200

    client.post("/invites/accept", json={"token": new, "name": "Nuovo", "password": "passwordnuova1"})
    assert client.post(f"/invites/{inv['id']}/resend").status_code == 409
    assert client.delete(f"/invites/{inv['id']}").status_code == 409


def test_invite_actions_are_audited(client, project):
    lab = make_label(client, "Operaio", role="field", project_ids=[project["project"]["id"]])
    inv = invite(client, "tracciato@test.local", lab)
    client.post("/invites/accept", json={"token": token_of(inv["url"]), "name": "Tracciato",
                                         "password": "passwordnuova1"})
    actions = [r["action"] for r in client.get("/audit").json()["items"]]
    assert "invite_label.created" in actions and "invite.created" in actions and "invite.accepted" in actions


@pytest.mark.parametrize("role, allowed", [("admin", True), ("manager", True), ("field", False)])
def test_who_can_list_invites(client, users, role, allowed):
    headers = client.headers if role == "admin" else users[role]["headers"]
    r = client.get("/invites", headers=headers)
    assert (r.status_code == 200) is allowed


def test_email_sent_when_sender_works(client, monkeypatch):
    sent = []

    class FakeEmail:
        def send(self, to, subject, body):
            sent.append((to, subject, body))

    monkeypatch.setattr("app.notify.senders_from_env", lambda: (FakeEmail(), None))
    inv = invite(client, "conmail@test.local")
    assert inv["email_sent_at"] is not None
    to, subject, body = sent[0]
    assert to == "conmail@test.local" and "Field View" in subject and inv["url"] in body


def test_invite_survives_email_failure(client, monkeypatch):
    class BrokenEmail:
        def send(self, to, subject, body):
            raise RuntimeError("smtp down")

    monkeypatch.setattr("app.notify.senders_from_env", lambda: (BrokenEmail(), None))
    inv = invite(client, "senzamail@test.local")
    assert inv["email_sent_at"] is None and inv["status"] == "pending"
    # il link consegnato a mano funziona lo stesso
    assert client.get(f"/invites/token/{token_of(inv['url'])}").status_code == 200
    assert "invite.email_failed" in [r["action"] for r in client.get("/audit").json()["items"]]


def test_login_works_after_accept(client):
    inv = invite(client, "accesso@test.local")
    client.post("/invites/accept", json={"token": token_of(inv["url"]), "name": "Accesso",
                                         "password": PASSWORD})
    assert login(client, "accesso@test.local")
