# "><(((º> sabusabu <º)))><"
"""Libreria dei workflow dell'organizzazione (ADR-50, docs/workflow-grafo.md §5, migrazione 0041).

Visibilità per organizzazione (la libreria si vede nelle commesse di cui l'organizzazione è proprietaria, non
altrove), permessi (solo l'amministratore dell'organizzazione scrive), collegamento vivo con le versioni (una
nuova versione vale per gli avvii successivi, le istanze in corso restano sulla loro), copia locale nella
commessa, pubblicazione da una commessa, solo ruoli, ruolo assente nella commessa (422 con i nodi), isolamento
fra organizzazioni anche a livello di RLS.

Per non sporcare la libreria della COM, che i test di import e del grafo usano con PRJ01, i test lavorano su
un'organizzazione propria (``lib``) con due commesse; solo il test sui documenti usa la COM e disattiva i suoi
modelli alla fine.
"""
from __future__ import annotations

import os
import uuid
from dataclasses import dataclass

import psycopg
import pytest
from argon2 import PasswordHasher
from conftest import act_as, savepoint
from psycopg.types.json import Jsonb
from test_api_documents import PDF, des_name, upload  # noqa: F401
from test_api_states import as_user, transition, worker  # noqa: F401 - fixture riusate
from test_workflow_grafo import condivisa  # noqa: F401 - fixture riusata

from cde_api.tooling.demo_seed import DEMO_PASSWORD

OK = {"code": "OK", "label": "Ok", "color": "green"}
NO = {"code": "NO", "label": "Respinto", "color": "red"}


def nodo(nid, tipo, nome, col, row, **kw):
    return {"id": nid, "type": tipo, "name": nome, "cell": {"col": col, "row": row}, **kw}


def ruolo(code):
    return {"type": "role", "code": code}


def due_passi(primo="Verifica", ruolo_primo="PROJECT_ADMIN", ruolo_secondo="PROJECT_ADMIN"):
    """Avvio → primo passo → secondo passo → fine OK; "Respinto" → fine KO."""
    nodes = [nodo("s", "start", "Avvio", 0, 0),
             nodo("a", "decision", primo, 1, 0, assignees=[ruolo(ruolo_primo)], quorum="ANY", outcomes=[OK, NO]),
             nodo("b", "decision", "Approvazione", 2, 0, assignees=[ruolo(ruolo_secondo)], quorum="ANY", outcomes=[OK, NO]),
             nodo("ok", "end", "Concluso", 3, 0, result="OK"), nodo("ko", "end", "Fallito", 3, 1, result="KO")]
    edges = [{"from": "s", "to": "a"}, {"from": "a", "outcome": "OK", "to": "b"}, {"from": "a", "outcome": "NO", "to": "ko"},
             {"from": "b", "outcome": "OK", "to": "ok"}, {"from": "b", "outcome": "NO", "to": "ko"}]
    return {"version": 2, "nodes": nodes, "edges": edges}


@dataclass
class Lib:
    org: uuid.UUID
    p1: uuid.UUID
    p2: uuid.UUID
    users: dict[str, uuid.UUID]
    emails: dict[str, str]


@pytest.fixture(scope="module")
def lib(api_world) -> Lib:
    """Organizzazione con libreria propria: admin (org admin, PA di P1 e P2), pm (PA di P1, non org admin),
    im (Information Manager in P1); in P1 partecipa anche la DES con il suo Lead Designer."""
    urls, w = api_world
    sfx = os.urandom(2).hex().upper()
    pwd = PasswordHasher().hash(DEMO_PASSWORD)
    with psycopg.connect(urls.owner) as conn, conn.transaction():
        roles = dict(conn.execute("SELECT code, id FROM cde.roles WHERE project_id IS NULL").fetchall())
        org = conn.execute("INSERT INTO cde.organizations (legal_name, code, mfa_required) VALUES (%s, %s, false) "
                           "RETURNING id", [f"Libreria {sfx} Srl", f"L{sfx}"]).fetchone()[0]
        users, emails = {}, {}
        for key, admin in (("admin", True), ("pm", False), ("im", False)):
            emails[key] = f"{key}.{sfx.lower()}@lib.example"
            users[key] = conn.execute(
                """INSERT INTO cde.users (organization_id, email, first_name, last_name, password_hash, status,
                                          is_org_admin, password_changed_at)
                   VALUES (%s, %s, %s, 'Libreria', %s, 'ACTIVE', %s, now()) RETURNING id""",
                [org, emails[key], key.upper(), pwd, admin]).fetchone()[0]
        p1, p2 = (conn.execute("""INSERT INTO cde.projects (owner_organization_id, code, name, status, created_by)
                                  VALUES (%s, %s, %s, 'ACTIVE', %s) RETURNING id""",
                               [org, f"L{n}{sfx[:3]}", f"Commessa {n} della libreria", users["admin"]]).fetchone()[0]
                  for n in (1, 2))
        for p in (p1, p2):
            conn.execute("INSERT INTO cde.project_organizations (project_id, organization_id, party_role) "
                         "VALUES (%s, %s, 'APPOINTING_PARTY')", [p, org])
        conn.execute("INSERT INTO cde.project_organizations (project_id, organization_id, party_role) "
                     "VALUES (%s, %s, 'APPOINTED_PARTY')", [p1, w.orgs["DES"]])
        for p, u, r in ((p1, users["admin"], "PROJECT_ADMIN"), (p2, users["admin"], "PROJECT_ADMIN"),
                        (p1, users["pm"], "PROJECT_ADMIN"), (p1, users["im"], "INFORMATION_MANAGER"),
                        (p1, w.users["des_lead"], "LEAD_DESIGNER")):
            conn.execute("INSERT INTO cde.project_memberships (project_id, user_id, role_id) VALUES (%s, %s, %s)",
                         [p, u, roles[r]])
    return Lib(org, p1, p2, users, emails)


@pytest.fixture
def come(client, lib, as_user):  # noqa: F811
    """Intestazioni per gli utenti dell'organizzazione della libreria (admin, pm, im) o del dataset demo."""
    tokens: dict[str, dict] = {}

    def h(user: str) -> dict:
        if user not in lib.emails:
            return as_user(user)
        if user not in tokens:
            client.app.state.services.limiter.reset()
            r = client.post("/auth/login", json={"email": lib.emails[user], "password": DEMO_PASSWORD})
            assert r.status_code == 200, r.text
            tokens[user] = {"Authorization": f"Bearer {r.json()['access_token']}"}
        return tokens[user]
    return h


def in_libreria(client, h, org, definition, subject="PROCESS", code=None, name="Modello di libreria", atteso=201):
    r = client.post(f"/organizations/{org}/workflow-library", headers=h, json={
        "code": code or f"L_{uuid.uuid4().hex[:8].upper()}", "name": name, "subject": subject, "definition": definition})
    assert r.status_code == atteso, r.text
    return r.json()


def avvia(client, h, pid, tpl_id, title="Processo da libreria", atteso=201):
    r = client.post(f"/projects/{pid}/processes", headers=h, json={"template_id": tpl_id, "title": title})
    assert r.status_code == atteso, r.text
    return r.json()


def modelli(client, h, pid):
    r = client.get(f"/projects/{pid}/workflow-templates", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def completa(client, h, iid, node_id, esito, commento=None):
    t = next(t for t in client.get("/me/tasks", headers=h).json() if t["instance_id"] == iid and t["node_id"] == node_id)
    r = client.post(f"/tasks/{t['id']}/complete", headers=h, json={"outcome": esito, "comment": commento})
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------------
# Permessi e validazione
# ---------------------------------------------------------------------
def test_solo_admin_organizzazione_scrive_e_solo_ruoli(client, lib, come):
    admin, pm = come("admin"), come("pm")
    tpl = in_libreria(client, admin, lib.org, due_passi())
    assert tpl["scope"] == "LIBRARY" and tpl["organization_id"] == str(lib.org) and tpl["project_id"] is None
    assert tpl["version"] == 1 and tpl["subject"] == "PROCESS"

    # il Project Admin che non è amministratore dell'organizzazione vede la libreria ma non la modifica
    assert any(t["id"] == tpl["id"] for t in client.get(f"/organizations/{lib.org}/workflow-library", headers=pm).json())
    in_libreria(client, pm, lib.org, due_passi(), atteso=403)
    assert client.post(f"/organizations/{lib.org}/workflow-library/validate", headers=pm,
                       json={"definition": due_passi()}).status_code == 403
    assert client.patch(f"/workflow-library/{tpl['id']}", headers=pm, json={"is_active": False}).status_code == 403
    # le altre organizzazioni la libreria non la vedono nemmeno (404, non 403)
    for estraneo in ("des_lead", "out_user", "com_admin"):
        assert client.get(f"/organizations/{lib.org}/workflow-library", headers=come(estraneo)).status_code == 404
    in_libreria(client, come("out_user"), lib.org, due_passi(), atteso=404)
    # ruoli per l'editor della libreria: quelli di sistema (e i personalizzati delle commesse dell'organizzazione)
    ruoli = {r["code"] for r in client.get(f"/organizations/{lib.org}/workflow-library/roles", headers=pm).json()}
    assert {"PROJECT_ADMIN", "LEAD_DESIGNER"} <= ruoli
    assert client.get(f"/organizations/{lib.org}/workflow-library/roles", headers=come("des_lead")).status_code == 404

    # solo ruoli: persona, ruolo limitato a un'organizzazione, escalation verso una persona → errori per nodo
    d = due_passi()
    d["nodes"][1]["assignees"] = [{"type": "user", "id": str(lib.users["pm"])}]
    d["nodes"][2]["assignees"] = [{"type": "role", "code": "PROJECT_ADMIN", "organization_id": str(lib.org)}]
    d["escalation_user_id"] = str(lib.users["pm"])
    v = client.post(f"/organizations/{lib.org}/workflow-library/validate", headers=admin, json={"definition": d}).json()
    assert v["ok"] is False
    per_nodo = {e["node"]: e["message"] for e in v["errors"]}
    assert "per ruolo, non per persona" in per_nodo["a"] and "limitato a un'organizzazione" in per_nodo["b"]
    assert any("escalation" in e["message"] for e in v["errors"])
    r = client.post(f"/organizations/{lib.org}/workflow-library", headers=admin,
                    json={"code": "SOLO_RUOLI", "name": "No", "subject": "PROCESS", "definition": d})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_workflow"
    # nella commessa invece le persone vanno bene (stessa definizione senza escalation né limite)
    d2 = due_passi()
    d2["nodes"][1]["assignees"] = [{"type": "user", "id": str(lib.users["pm"])}]
    assert client.post(f"/projects/{lib.p1}/workflow-templates/validate", headers=admin,
                       json={"definition": d2}).json()["ok"] is True


def test_ruolo_vuoto_errore_riferito_al_nodo(client, lib, come):
    """Ruolo non scelto: un solo errore, sul nodo e in italiano; niente errori a cascata sugli archi."""
    d = due_passi()
    d["nodes"][1]["assignees"] = [{"type": "role", "code": ""}]
    for url in (f"/organizations/{lib.org}/workflow-library/validate", f"/projects/{lib.p1}/workflow-templates/validate"):
        v = client.post(url, headers=come("admin"), json={"definition": d}).json()
        assert v["errors"] == [{"node": "a", "edge": None, "message": "«Verifica»: scegliere il ruolo dell'assegnatario"}]
    r = client.post(f"/projects/{lib.p1}/workflow-templates", headers=come("admin"),
                    json={"code": "RUOLO_VUOTO", "name": "Ruolo vuoto", "subject": "PROCESS", "definition": d})
    assert r.status_code == 422
    assert r.json()["error"]["message"] == "Workflow non valido: «Verifica»: scegliere il ruolo dell'assegnatario"


# ---------------------------------------------------------------------
# Visibilità e collegamento vivo
# ---------------------------------------------------------------------
def test_visibile_nelle_commesse_dell_organizzazione(client, lib, come, api_world):
    _, w = api_world
    tpl = in_libreria(client, come("admin"), lib.org, due_passi(), name="Visibile ovunque")
    for pid, chi in ((lib.p1, "admin"), (lib.p2, "admin"), (lib.p1, "im"), (lib.p1, "des_lead")):
        voce = next((t for t in modelli(client, come(chi), pid) if t["id"] == tpl["id"]), None)
        assert voce and voce["scope"] == "LIBRARY" and voce["organization_name"].startswith("Libreria")
    # i modelli della commessa hanno scope PROJECT
    assert all(t["scope"] == "PROJECT" for t in modelli(client, come("com_admin"), w.project_id))
    # commesse di altre organizzazioni: la libreria non c'è
    assert not any(t["id"] == tpl["id"] for t in modelli(client, come("com_admin"), w.project_id))
    assert not any(t["id"] == tpl["id"] for t in modelli(client, come("out_user"), w.project2_id))
    # e non vi si avvia, nemmeno conoscendo l'id
    avvia(client, come("out_user"), w.project2_id, tpl["id"], atteso=404)
    avvia(client, come("com_admin"), w.project_id, tpl["id"], atteso=404)
    assert client.post(f"/projects/{w.project2_id}/workflow-templates/from-library", headers=come("out_user"),
                       json={"template_id": tpl["id"]}).status_code == 404


def test_collegamento_vivo_versioni_e_istanze_in_corso(client, lib, come):
    admin, im, lead = come("admin"), come("im"), come("des_lead")
    code = f"VIVO_{uuid.uuid4().hex[:6].upper()}"
    v1 = in_libreria(client, admin, lib.org, due_passi("Verifica v1"), code=code)
    # chiunque nella commessa avvia il processo dal modello di libreria (qui l'Information Manager)
    g1 = avvia(client, im, lib.p1, v1["id"], "Prima RdA")
    assert g1["project_id"] == str(lib.p1) and g1["template"] == {"id": v1["id"], "name": v1["name"], "version": 1}
    assert {r["node_id"] for r in g1["node_runs"] if r["status"] == "ACTIVE"} == {"a"}
    # la vista finale la apre anche un membro di un'altra organizzazione della commessa (definizione via RLS)
    assert client.get(f"/workflow-instances/{g1['id']}", headers=lead).status_code == 200

    # nuova versione in libreria: vale per gli avvii successivi, in tutte le commesse
    v2 = in_libreria(client, admin, lib.org, due_passi("Verifica v2"), code=code)
    assert v2["version"] == 2
    lista = [t for t in modelli(client, admin, lib.p2) if t["code"] == code]
    assert [(t["version"], t["scope"]) for t in lista] == [(2, "LIBRARY")]
    avvia(client, im, lib.p1, v1["id"], atteso=404)                     # la v1 non si avvia più
    g2 = avvia(client, admin, lib.p2, v2["id"], "RdA sulla seconda commessa")
    assert g2["template"]["version"] == 2 and g2["project_id"] == str(lib.p2)
    assert next(n for n in g2["definition"]["nodes"] if n["id"] == "a")["name"] == "Verifica v2"

    # l'istanza partita con la v1 resta sulla v1 e prosegue fino alla fine
    g1 = client.get(f"/workflow-instances/{g1['id']}", headers=admin).json()
    assert g1["template"]["version"] == 1
    assert next(n for n in g1["definition"]["nodes"] if n["id"] == "a")["name"] == "Verifica v1"
    completa(client, admin, g1["id"], "a", "OK")
    out = completa(client, admin, g1["id"], "b", "OK")
    assert out["workflow_status"] == "APPROVED"
    processi = client.get(f"/projects/{lib.p1}/processes?status=ALL", headers=im).json()
    assert any(p["id"] == g1["id"] and p["template_version"] == 1 and p["result"] == "OK" for p in processi)

    # disattivata in libreria: sparisce dalle commesse e non si avvia; riattivata torna
    r = client.patch(f"/workflow-library/{v2['id']}", headers=admin, json={"is_active": False})
    assert r.status_code == 200 and r.json()["is_active"] is False
    assert not any(t["code"] == code for t in modelli(client, admin, lib.p1))
    avvia(client, admin, lib.p1, v2["id"], atteso=404)
    assert client.get(f"/workflow-instances/{g2['id']}", headers=admin).json()["status"] == "RUNNING"
    client.patch(f"/workflow-library/{v2['id']}", headers=admin, json={"is_active": True, "name": "Rinominato"})
    assert any(t["code"] == code and t["name"] == "Rinominato" for t in modelli(client, admin, lib.p1))
    tutte = client.get(f"/organizations/{lib.org}/workflow-library?include_inactive=true", headers=admin).json()
    assert [(t["version"], t["is_active"]) for t in tutte if t["code"] == code] == [(2, True), (1, False)]


def test_ruolo_assente_nella_commessa_blocca_l_avvio(client, lib, come):
    """LEAD_DESIGNER c'è in P1 (il progettista della DES), non in P2; un ruolo inventato non c'è da nessuna parte."""
    admin = come("admin")
    tpl = in_libreria(client, admin, lib.org, due_passi("Verifica progettista", ruolo_primo="LEAD_DESIGNER"))
    r = client.post(f"/projects/{lib.p2}/processes", headers=admin, json={"template_id": tpl["id"], "title": "Senza progettista"})
    assert r.status_code == 422, r.text
    e = r.json()["error"]
    assert e["code"] == "roles_missing" and "«Verifica progettista» (LEAD_DESIGNER)" in e["message"]
    assert e["errors"] == [{"node": "a", "edge": None,
                            "message": "«Verifica progettista»: nessuno ha il ruolo LEAD_DESIGNER in questa commessa"}]
    assert not any(p["title"] == "Senza progettista"
               for p in client.get(f"/projects/{lib.p2}/processes?status=ALL", headers=admin).json())
    g = avvia(client, admin, lib.p1, tpl["id"], "Con progettista")
    giro = next(r for r in g["node_runs"] if r["node_id"] == "a")
    assert [t["assignee"]["id"] for t in giro["tasks"]] == [_uid(client, come("des_lead"))]

    inventato = in_libreria(client, admin, lib.org, due_passi(ruolo_secondo="GEOLOGO_X"))
    r = client.post(f"/projects/{lib.p1}/processes", headers=admin, json={"template_id": inventato["id"], "title": "x y"})
    assert r.status_code == 422 and "«Approvazione» (GEOLOGO_X)" in r.json()["error"]["message"]


def _uid(client, h) -> str:
    return client.get("/me", headers=h).json()["id"]


# ---------------------------------------------------------------------
# Copia nella commessa e pubblicazione da una commessa
# ---------------------------------------------------------------------
def test_copia_nella_commessa(client, lib, come):
    admin, pm, im = come("admin"), come("pm"), come("im")
    tpl = in_libreria(client, admin, lib.org, due_passi(ruolo_secondo="GEOLOGO_X"), name="Da copiare")
    # la copia la fa il Project Admin della commessa (anche se non è amministratore dell'organizzazione)
    assert client.post(f"/projects/{lib.p1}/workflow-templates/from-library", headers=im,
                       json={"template_id": tpl["id"]}).status_code == 403
    r = client.post(f"/projects/{lib.p1}/workflow-templates/from-library", headers=pm, json={"template_id": tpl["id"]})
    assert r.status_code == 201, r.text
    copia = r.json()
    assert copia["scope"] == "PROJECT" and copia["project_id"] == str(lib.p1) and copia["organization_id"] is None
    assert copia["source_template_id"] == tpl["id"] and copia["code"] == tpl["code"] and copia["version"] == 1
    assert any("GEOLOGO_X" in n and "non esiste" in n for n in copia["changes"])
    lista = [t for t in modelli(client, pm, lib.p1) if t["code"] == tpl["code"]]
    assert {t["scope"] for t in lista} == {"PROJECT", "LIBRARY"}
    # la copia è della commessa: la modifica il Project Admin, la libreria non cambia
    assert client.patch(f"/workflow-templates/{copia['id']}", headers=pm, json={"name": "Variante locale"}).status_code == 200
    assert next(t for t in lista if t["scope"] == "LIBRARY")["name"] == "Da copiare"
    # con un altro codice diventa un modello a sé; stesso codice di nuovo ⇒ versione 2
    altro = client.post(f"/projects/{lib.p1}/workflow-templates/from-library", headers=pm,
                        json={"template_id": tpl["id"], "code": tpl["code"] + "_B", "name": "Altra copia"}).json()
    assert altro["code"] == tpl["code"] + "_B" and altro["version"] == 1
    assert client.post(f"/projects/{lib.p1}/workflow-templates/from-library", headers=pm,
                       json={"template_id": tpl["id"]}).json()["version"] == 2


def test_pubblica_in_libreria_da_una_commessa(client, lib, come):
    admin, pm = come("admin"), come("pm")
    d = due_passi()
    d["nodes"][1]["assignees"] = [{"type": "user", "id": str(lib.users["pm"])}, ruolo("PROJECT_ADMIN")]
    d["escalation_user_id"] = str(lib.users["pm"])
    r = client.post(f"/projects/{lib.p1}/workflow-templates", headers=admin, json={
        "code": f"PUB_{uuid.uuid4().hex[:6].upper()}", "name": "Modello di commessa", "subject": "PROCESS", "definition": d})
    assert r.status_code == 201, r.text
    src = r.json()
    # solo l'amministratore dell'organizzazione pubblica
    assert client.post(f"/organizations/{lib.org}/workflow-library/from-project", headers=pm,
                       json={"template_id": src["id"]}).status_code == 403
    r = client.post(f"/organizations/{lib.org}/workflow-library/from-project", headers=admin, json={"template_id": src["id"]})
    assert r.status_code == 201, r.text
    pub = r.json()
    assert pub["scope"] == "LIBRARY" and pub["source_template_id"] == src["id"] and pub["code"] == src["code"]
    a = next(n for n in pub["definition"]["nodes"] if n["id"] == "a")
    assert a["assignees"] == [ruolo("PROJECT_ADMIN")] and "escalation_user_id" not in pub["definition"]
    assert any("tolta PM Libreria" in n for n in pub["changes"]) and any("escalation" in n for n in pub["changes"])
    # il modello della commessa resta com'era
    resta = next(t for t in modelli(client, admin, lib.p1) if t["id"] == src["id"])
    assert resta["definition"]["escalation_user_id"] == str(lib.users["pm"])

    # un nodo con sole persone resterebbe vuoto: 422 con il nodo
    d["nodes"][2]["assignees"] = [{"type": "user", "id": str(lib.users["pm"])}]
    solo = client.post(f"/projects/{lib.p1}/workflow-templates", headers=admin, json={
        "code": f"PUB_{uuid.uuid4().hex[:6].upper()}", "name": "Solo persone", "subject": "PROCESS", "definition": d}).json()
    r = client.post(f"/organizations/{lib.org}/workflow-library/from-project", headers=admin, json={"template_id": solo["id"]})
    assert r.status_code == 422 and r.json()["error"]["code"] == "step_without_assignees"
    assert r.json()["error"]["errors"][0]["node"] == "b"
    # un'altra organizzazione non pubblica i modelli di questa commessa nella sua libreria
    assert client.post(f"/organizations/{_org_of(client, come('out_user'))}/workflow-library/from-project",
                       headers=come("out_user"), json={"template_id": src["id"]}).status_code == 404


def _org_of(client, h) -> str:
    return client.get("/me", headers=h).json()["organization_id"]


# ---------------------------------------------------------------------
# Workflow su documento dalla libreria (COM, PRJ01)
# ---------------------------------------------------------------------
def test_workflow_su_documento_dalla_libreria(client, api_world, as_user, condivisa):  # noqa: F811
    _, w = api_world
    com, lead = as_user("com_admin"), as_user("des_lead")
    d = {"version": 2, "on_completed": {"to_state": "PUBLISHED", "suitability": "A1"},
         "nodes": [nodo("s", "start", "Avvio", 0, 0),
                   nodo("dl", "decision", "Parere DL", 1, 0, assignees=[ruolo("DIRETTORE_LAVORI")], quorum="ANY", outcomes=[OK, NO]),
                   nodo("ok", "end", "Approvato", 2, 0, result="OK"), nodo("ko", "end", "Rifiutato", 2, 1, result="KO")],
         "edges": [{"from": "s", "to": "dl"}, {"from": "dl", "outcome": "OK", "to": "ok"}, {"from": "dl", "outcome": "NO", "to": "ko"}]}
    creati = []
    try:
        tpl = in_libreria(client, com, w.orgs["COM"], d, subject="DOCUMENT", name="Parere DL di libreria")
        creati.append(tpl["id"])
        assert any(t["id"] == tpl["id"] for t in modelli(client, lead, w.project_id))   # il dialogo di avvio lo vede
        # ruolo che in PRJ01 non ha nessuno: 422 con il nodo, il documento resta libero
        d_vuoto = {**d, "nodes": [dict(n) for n in d["nodes"]]}
        d_vuoto["nodes"][1]["assignees"] = [ruolo("GEOLOGO_X")]
        vuoto = in_libreria(client, com, w.orgs["COM"], d_vuoto, subject="DOCUMENT", name="Senza geologo")
        creati.append(vuoto["id"])
        r = client.post(f"/revisions/{condivisa['id']}/workflows", headers=lead, json={"template_id": vuoto["id"]})
        assert r.status_code == 422 and r.json()["error"]["code"] == "roles_missing"
        # avvio dalla libreria: compito al DL, alla fine OK il documento è pubblicato come da on_completed
        r = client.post(f"/revisions/{condivisa['id']}/workflows", headers=lead, json={"template_id": tpl["id"]})
        assert r.status_code == 201, r.text
        inst = r.json()
        t = next(t for t in client.get("/me/tasks", headers=as_user("com_dl")).json() if t["instance_id"] == inst["id"])
        assert t["template_name"] == "Parere DL di libreria"
        assert client.post(f"/tasks/{t['id']}/complete", headers=as_user("com_dl"), json={"outcome": "OK"}).status_code == 200
        doc = client.get(f"/documents/{condivisa['document_id']}", headers=lead).json()
        assert doc["current_suitability"] == "A1"
        assert client.get(f"/documents/{condivisa['document_id']}/workflows", headers=lead).json()[0]["template_name"] \
            == "Parere DL di libreria"
    finally:
        for tid in creati:   # la libreria della COM torna vuota per gli altri test su PRJ01
            client.patch(f"/workflow-library/{tid}", headers=com, json={"is_active": False})


# ---------------------------------------------------------------------
# RLS e vincoli nel database
# ---------------------------------------------------------------------
def test_rls_e_vincoli_della_libreria(lib, api_world):
    urls, w = api_world
    d = due_passi()
    with psycopg.connect(urls.app) as conn:
        tid = uuid.uuid4()
        act_as(conn, lib.users["admin"])
        conn.execute("""INSERT INTO cde.workflow_templates (id, organization_id, code, version, name, definition, created_by)
                        VALUES (%s, %s, 'RLS_LIB', 1, 'RLS', %s, %s)""", [tid, lib.org, Jsonb(d), lib.users["admin"]])
        # chi non è amministratore dell'organizzazione non scrive in libreria
        act_as(conn, lib.users["pm"])
        with pytest.raises(psycopg.errors.InsufficientPrivilege), savepoint(conn):
            conn.execute("""INSERT INTO cde.workflow_templates (organization_id, code, version, name, definition, created_by)
                            VALUES (%s, 'RLS_LIB', 2, 'RLS', %s, %s)""", [lib.org, Jsonb(d), lib.users["pm"]])
        assert conn.execute("UPDATE cde.workflow_templates SET is_active = false WHERE id = %s", [tid]).rowcount == 0
        assert conn.execute("SELECT count(*) FROM cde.workflow_templates WHERE id = %s", [tid]).fetchone()[0] == 1
        # membro di una commessa dell'organizzazione (altra organizzazione): legge; estranei no
        act_as(conn, w.users["des_lead"])
        assert conn.execute("SELECT count(*) FROM cde.workflow_templates WHERE id = %s", [tid]).fetchone()[0] == 1
        for estraneo in ("out_user", "com_admin", "sub1_user"):
            act_as(conn, w.users[estraneo])
            assert conn.execute("SELECT count(*) FROM cde.workflow_templates WHERE id = %s", [tid]).fetchone()[0] == 0
        # immutabile anche per l'amministratore: ambito e definizione non si cambiano
        act_as(conn, lib.users["admin"])
        with pytest.raises(psycopg.errors.InsufficientPrivilege), savepoint(conn):
            conn.execute("UPDATE cde.workflow_templates SET organization_id = NULL, project_id = %s WHERE id = %s",
                         [lib.p1, tid])
        # solo ruoli anche nel database (ultima difesa dietro l'API)
        bad = due_passi()
        bad["nodes"][1]["assignees"] = [{"type": "user", "id": str(lib.users["pm"])}]
        with pytest.raises(psycopg.errors.CheckViolation), savepoint(conn):
            conn.execute("""INSERT INTO cde.workflow_templates (organization_id, code, version, name, definition, created_by)
                            VALUES (%s, 'RLS_BAD', 1, 'RLS', %s, %s)""", [lib.org, Jsonb(bad), lib.users["admin"]])
        # né in un progetto né in una libreria, o in entrambi: no
        with pytest.raises(psycopg.errors.CheckViolation), savepoint(conn):
            conn.execute("""INSERT INTO cde.workflow_templates (project_id, organization_id, code, version, name, definition,
                                                               created_by)
                            VALUES (%s, %s, 'RLS_DUE', 1, 'RLS', %s, %s)""", [lib.p1, lib.org, Jsonb(d), lib.users["admin"]])
        conn.rollback()
