# "><(((º> sabusabu <º)))><"
"""Workflow a grafo (ADR-48, docs/workflow-grafo.md, migrazione 0039).

Conversione dalla versione 1, validazione con errori per nodo, quorum ed esito rosso, rami paralleli,
riunione ALL (che aspetta i rami in corso ma non quelli mai partiti) e ANY, ritorno indietro con tetto di
20 giri, nodo notifica, stati finali OK (passaggio di stato del documento) e KO (sblocco), processi con
documenti allegati e visibilità fra organizzazioni.
"""
from __future__ import annotations

import uuid

import psycopg
import pytest
from psycopg.types.json import Jsonb
from test_api_documents import PDF, des_name, upload
from test_api_states import as_user, transition, worker  # noqa: F401 - fixture riusate
from test_api_workflows import notifications

from cde_api.modules import workflow_graph as wg

OK = {"code": "OK", "label": "Ok", "color": "green"}
GIALLO = {"code": "IN_GARA", "label": "In gara", "color": "yellow"}
NO = {"code": "NO", "label": "Respinto", "color": "red"}


def nodo(nid, tipo, nome, col, row, **kw):
    return {"id": nid, "type": tipo, "name": nome, "cell": {"col": col, "row": row}, **kw}


def utente(w, key):
    return {"type": "user", "id": str(w.users[key])}


def decisione(nid, nome, col, row, chi, esiti=(OK, NO), **kw):
    return nodo(nid, "decision", nome, col, row, assignees=chi, outcomes=list(esiti), **kw)


def salva(client, h, w, nodes, edges, subject="PROCESS", code=None, **extra):
    r = client.post(f"/projects/{w.project_id}/workflow-templates", headers=h, json={
        "code": code or f"G_{uuid.uuid4().hex[:8].upper()}", "name": "Grafo di prova", "subject": subject,
        "definition": {"version": 2, "nodes": nodes, "edges": edges, **extra}})
    assert r.status_code == 201, r.text
    return r.json()


def avvia(client, h, w, tpl, title="RdA di prova", docs=()):
    r = client.post(f"/projects/{w.project_id}/processes", headers=h,
                    json={"template_id": tpl["id"], "title": title, "document_ids": [str(d) for d in docs]})
    assert r.status_code == 201, r.text
    return r.json()


def grafo(client, h, iid):
    r = client.get(f"/workflow-instances/{iid}", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def attivi(g):
    return {r["node_id"] for r in g["node_runs"] if r["status"] == "ACTIVE"}


def compito(client, h, iid, node_id):
    tasks = client.get("/me/tasks", headers=h).json()
    return next(t for t in tasks if t["instance_id"] == iid and t["node_id"] == node_id)


def completa(client, h, iid, node_id, esito, commento=None, atteso=200):
    t = compito(client, h, iid, node_id)
    r = client.post(f"/tasks/{t['id']}/complete", headers=h, json={"outcome": esito, "comment": commento})
    assert r.status_code == atteso, r.text
    return r.json()


# ---------------------------------------------------------------------
# Conversione e validazione
# ---------------------------------------------------------------------
V1 = {"steps": [{"name": "Verifica", "assignees": [{"type": "role", "code": "LEAD_DESIGNER"}], "sla_hours": 48},
                {"name": "Approvazione", "assignees": [{"type": "role", "code": "PROJECT_ADMIN"}], "quorum": "ANY"}],
      "on_approved": {"to_state": "PUBLISHED", "suitability": "A1"}}


def test_conversione_v1_uguale_in_python_e_nel_database(client, api_world, as_user):  # noqa: F811
    urls, w = api_world
    py = wg.convert_v1(V1)
    with psycopg.connect(urls.owner) as conn:
        db = conn.execute("SELECT cde.wf_convert_v1(%s::jsonb)", [Jsonb(V1)]).fetchone()[0]
    assert db == py
    assert [n["id"] for n in py["nodes"]] == ["inizio", "passo_1", "passo_2", "approvato", "rifiutato"]
    assert py["on_completed"] == V1["on_approved"]
    # l'API accetta ancora la versione 1 e salva il grafo convertito
    r = client.post(f"/projects/{w.project_id}/workflow-templates", headers=as_user("com_admin"),
                    json={"code": f"V1_{uuid.uuid4().hex[:6].upper()}", "name": "Da lista", "definition": V1})
    assert r.status_code == 201, r.text
    assert r.json()["definition"]["version"] == 2 and r.json()["subject"] == "DOCUMENT"
    assert wg.normalize(r.json()["definition"]) == r.json()["definition"]       # già normalizzata


def test_validazione_errori_per_nodo_e_arco(client, api_world, as_user):  # noqa: F811
    _, w = api_world
    h = as_user("com_admin")
    nodes = [nodo("a", "start", "Avvio", 0, 0), nodo("b", "start", "Altro avvio", 0, 1),
             decisione("d", "Decisione", 1, 0, [utente(w, "com_admin")]),
             nodo("orfano", "activity", "Mai raggiunto", 1, 0, assignees=[utente(w, "com_admin")]),
             nodo("fine", "end", "Fine", 2, 0, result="OK")]
    edges = [{"from": "a", "to": "d"}, {"from": "d", "outcome": "OK", "to": "fine"}, {"from": "d", "outcome": "BOH", "to": "fine"},
             {"from": "fine", "to": "d"}, {"from": "b", "to": "a"}]
    r = client.post(f"/projects/{w.project_id}/workflow-templates/validate", headers=h,
                    json={"definition": {"version": 2, "nodes": nodes, "edges": edges}})
    out = r.json()
    assert r.status_code == 200 and out["ok"] is False
    msgs = {(e["node"], e["edge"], e["message"]) for e in out["errors"]}
    testi = " | ".join(m for *_, m in msgs)
    assert "Serve esattamente un nodo di avvio" in testi
    assert any(n == "orfano" and "Casella 1,0 già occupata" in m for n, _, m in msgs)
    assert any(n == "d" and "non porta da nessuna parte" in m for n, _, m in msgs)       # esito NO senza arco
    assert any(e == 2 and "BOH" in m for _, e, m in msgs)                               # esito inesistente
    assert any(e == 3 and "esce da uno stato finale" in m for _, e, m in msgs)
    assert any(e == 4 and "entrare nel nodo di avvio" in m for _, e, m in msgs)
    # salvare la stessa definizione: 422 con lo stesso elenco nel corpo dell'errore
    r = client.post(f"/projects/{w.project_id}/workflow-templates", headers=h, json={
        "code": "NON_VALIDO", "name": "Non valido", "subject": "PROCESS", "definition": {"version": 2, "nodes": nodes, "edges": edges}})
    assert r.status_code == 422 and r.json()["error"]["errors"]
    # on_completed vale solo per i documenti; un documento serve per i workflow DOCUMENT
    ok_nodes = [nodo("a", "start", "Avvio", 0, 0), nodo("fine", "end", "Fine", 1, 0, result="OK")]
    r = client.post(f"/projects/{w.project_id}/workflow-templates/validate", headers=h, json={
        "subject": "PROCESS", "definition": {"version": 2, "nodes": ok_nodes, "edges": [{"from": "a", "to": "fine"}],
                                             "on_completed": {"to_state": "PUBLISHED", "suitability": "A1"}}})
    assert not r.json()["ok"] and "solo per i workflow sui documenti" in r.json()["errors"][0]["message"]
    # solo il Project Admin disegna i workflow
    assert client.post(f"/projects/{w.project_id}/workflow-templates/validate", headers=as_user("des_lead"),
                       json={"definition": {"version": 2, "nodes": ok_nodes, "edges": []}}).status_code == 403


# ---------------------------------------------------------------------
# Esecuzione
# ---------------------------------------------------------------------
def test_quorum_esito_rosso_e_piu_votato(client, api_world, as_user):  # noqa: F811
    _, w = api_world
    admin = as_user("com_admin")
    due = [utente(w, "des_lead"), utente(w, "des_designer")]
    tpl = salva(client, admin, w, [
        nodo("s", "start", "Avvio", 0, 0),
        decisione("d", "Doppia firma", 1, 0, due, esiti=(OK, GIALLO, NO), quorum="ALL"),
        nodo("ok", "end", "Concluso", 2, 0, result="OK"), nodo("gara", "end", "In gara", 2, 1, result="OK"),
        nodo("ko", "end", "Fallito", 2, 2, result="KO")],
        [{"from": "s", "to": "d"}, {"from": "d", "outcome": "OK", "to": "ok"}, {"from": "d", "outcome": "IN_GARA", "to": "gara"},
         {"from": "d", "outcome": "NO", "to": "ko"}])
    lead, des = as_user("des_lead"), as_user("des_designer")

    # quorum ALL: il primo voto non basta, il secondo uguale decide
    g = avvia(client, admin, w, tpl)
    assert attivi(g) == {"d"} and g["status"] == "RUNNING"
    assert completa(client, lead, g["id"], "d", "OK")["workflow_status"] == "RUNNING"
    assert completa(client, des, g["id"], "d", "OK")["workflow_status"] == "APPROVED"
    g = grafo(client, admin, g["id"])
    assert g["status"] == "COMPLETED" and g["result"] == "OK"
    assert ("d", "OK", "ok") in {(e["from"], e["outcome"], e["to"]) for e in g["edges_taken"]}

    # esito rosso: decide subito, con commento obbligatorio; l'altro compito si annulla
    g = avvia(client, admin, w, tpl)
    completa(client, lead, g["id"], "d", "NO", atteso=422)
    assert completa(client, lead, g["id"], "d", "NO", "Offerta fuori budget")["workflow_status"] == "REJECTED"
    g = grafo(client, admin, g["id"])
    assert g["result"] == "KO" and g["outcome_comment"] == "Offerta fuori budget"
    assert sorted(t["status"] for t in g["node_runs"][1]["tasks"]) == ["CANCELLED", "DONE"]
    assert any("Offerta fuori budget" in n["body"] for n in notifications(client, admin, "WORKFLOW_REJECTED")
               if n["data"].get("instance_id") == g["id"])

    # voti diversi senza quorum: vince il più votato, a parità il primo nell'elenco (OK prima di IN_GARA)
    g = avvia(client, admin, w, tpl)
    completa(client, lead, g["id"], "d", "IN_GARA")
    completa(client, des, g["id"], "d", "OK")
    g = grafo(client, admin, g["id"])
    assert next(r for r in g["node_runs"] if r["node_id"] == "d")["outcome"] == "OK"
    # esito non previsto dal nodo
    g2 = avvia(client, admin, w, tpl)
    completa(client, lead, g2["id"], "d", "APPROVED", atteso=422)


def test_rami_paralleli_e_join_all(client, api_world, as_user):  # noqa: F811
    _, w = api_world
    admin, lead, des = as_user("com_admin"), as_user("des_lead"), as_user("des_designer")
    # scelta: GARA apre due rami (lead e designer) che si riuniscono in "riunione" (ALL);
    # SOLO apre il solo ramo del lead: la riunione non deve aspettare il ramo mai partito
    gara = {"code": "GARA", "label": "In gara", "color": "yellow"}
    solo = {"code": "SOLO", "label": "Affidamento diretto", "color": "green"}
    tpl = salva(client, admin, w, [
        nodo("s", "start", "Avvio", 0, 0),
        decisione("scelta", "Scelta procedura", 1, 0, [utente(w, "com_admin")], esiti=(gara, solo)),
        decisione("b1", "Offerte buyer 1", 2, 0, [utente(w, "des_lead")], esiti=(OK,)),
        decisione("b2", "Offerte buyer 2", 2, 1, [utente(w, "des_designer")], esiti=(OK,)),
        decisione("riunione", "Redazione QdR", 3, 0, [utente(w, "com_admin")], esiti=(OK,), join="ALL"),
        nodo("fine", "end", "Affidato", 4, 0, result="OK")],
        [{"from": "s", "to": "scelta"}, {"from": "scelta", "outcome": "GARA", "to": "b1"},
         {"from": "scelta", "outcome": "GARA", "to": "b2"}, {"from": "scelta", "outcome": "SOLO", "to": "b1"},
         {"from": "b1", "outcome": "OK", "to": "riunione"}, {"from": "b2", "outcome": "OK", "to": "riunione"},
         {"from": "riunione", "outcome": "OK", "to": "fine"}])

    g = avvia(client, admin, w, tpl)
    completa(client, admin, g["id"], "scelta", "GARA")
    assert attivi(grafo(client, admin, g["id"])) == {"b1", "b2"}
    completa(client, lead, g["id"], "b1", "OK")
    assert attivi(grafo(client, admin, g["id"])) == {"b2"}            # la riunione aspetta il ramo in corso
    completa(client, des, g["id"], "b2", "OK")
    assert attivi(grafo(client, admin, g["id"])) == {"riunione"}
    assert completa(client, admin, g["id"], "riunione", "OK")["workflow_status"] == "APPROVED"

    g = avvia(client, admin, w, tpl)
    completa(client, admin, g["id"], "scelta", "SOLO")
    completa(client, lead, g["id"], "b1", "OK")
    assert attivi(grafo(client, admin, g["id"])) == {"riunione"}      # b2 mai partito: non blocca


def test_join_any_e_stato_finale_chiude_i_rami_aperti(client, api_world, as_user):  # noqa: F811
    _, w = api_world
    admin, lead, des = as_user("com_admin"), as_user("des_lead"), as_user("des_designer")
    tpl = salva(client, admin, w, [
        nodo("s", "start", "Avvio", 0, 0),
        decisione("b1", "Selezione buyer 1", 1, 0, [utente(w, "des_lead")]),
        decisione("b2", "Selezione buyer 2", 1, 1, [utente(w, "des_designer")]),
        decisione("b3", "Selezione buyer 3", 1, 2, [utente(w, "com_dl")]),
        nodo("conf", "activity", "Inserimento filigrana RIFIUTATO", 2, 3, assignees=[utente(w, "com_admin")], join="ANY"),
        nodo("ok", "end", "Affidato", 3, 0, result="OK"), nodo("ko", "end", "Fallito", 3, 3, result="KO")],
        [{"from": "s", "to": "b1"}, {"from": "s", "to": "b2"}, {"from": "s", "to": "b3"},
         {"from": "b1", "outcome": "OK", "to": "ok"}, {"from": "b2", "outcome": "OK", "to": "ok"},
         {"from": "b3", "outcome": "OK", "to": "ok"},
         {"from": "b1", "outcome": "NO", "to": "conf"}, {"from": "b2", "outcome": "NO", "to": "conf"},
         {"from": "b3", "outcome": "NO", "to": "conf"}, {"from": "conf", "outcome": "FATTO", "to": "ko"}])
    g = avvia(client, admin, w, tpl)
    assert attivi(g) == {"b1", "b2", "b3"}                            # tre rami paralleli dall'avvio
    completa(client, lead, g["id"], "b1", "NO", "Nessuna offerta")
    completa(client, des, g["id"], "b2", "NO", "Offerta fuori termine")
    g = grafo(client, admin, g["id"])
    assert attivi(g) == {"b3", "conf"}
    assert [r["round"] for r in g["node_runs"] if r["node_id"] == "conf"] == [1]   # secondo arrivo ignorato
    assert completa(client, admin, g["id"], "conf", "FATTO")["workflow_status"] == "REJECTED"
    g = grafo(client, admin, g["id"])
    assert g["result"] == "KO" and not attivi(g)
    assert [r["status"] for r in g["node_runs"] if r["node_id"] == "b3"] == ["CANCELLED"]
    assert all(t["status"] != "OPEN" for r in g["node_runs"] for t in r["tasks"])


def test_ritorno_indietro_e_tetto_dei_giri(client, api_world, as_user):  # noqa: F811
    _, w = api_world
    admin = as_user("com_admin")
    rifare = {"code": "RIFARE", "label": "Da rifare", "color": "yellow"}
    tpl = salva(client, admin, w, [
        nodo("s", "start", "Avvio", 0, 0),
        decisione("verifica", "Verifica offerte", 1, 0, [utente(w, "com_admin")], esiti=(OK, rifare)),
        nodo("fine", "end", "Concluso", 2, 0, result="OK")],
        [{"from": "s", "to": "verifica"}, {"from": "verifica", "outcome": "OK", "to": "fine"},
         {"from": "verifica", "outcome": "RIFARE", "to": "verifica"}])
    g = avvia(client, admin, w, tpl)
    completa(client, admin, g["id"], "verifica", "RIFARE")
    g = grafo(client, admin, g["id"])
    assert [(r["round"], r["status"]) for r in g["node_runs"] if r["node_id"] == "verifica"] == [(1, "DONE"), (2, "ACTIVE")]
    assert {(e["from"], e["to"], e["round"]) for e in g["edges_taken"]} >= {("verifica", "verifica", 1)}
    for _ in range(19):                                                # giri 2..20 rifatti: il 21° interrompe
        completa(client, admin, g["id"], "verifica", "RIFARE")
    g = grafo(client, admin, g["id"])
    assert g["status"] == "CANCELLED" and "20 giri" in g["outcome_comment"]
    assert max(r["round"] for r in g["node_runs"] if r["node_id"] == "verifica") == 20
    assert any(n["data"].get("instance_id") == g["id"] for n in notifications(client, admin, "WORKFLOW_CANCELLED"))


def test_notifica_automatica(client, api_world, as_user):  # noqa: F811
    _, w = api_world
    admin = as_user("com_admin")
    tpl = salva(client, admin, w, [
        nodo("s", "start", "Avvio", 0, 0),
        decisione("aut", "Autorizzazione DC", 1, 0, [utente(w, "com_admin")], esiti=(OK,)),
        nodo("avviso", "notification", "Notifica affidamento", 2, 0, recipients=[utente(w, "des_designer")],
             message="Affidamento concluso per {titolo} ({progetto})"),
        nodo("fine", "end", "Affidamento concluso", 3, 0, result="OK")],
        [{"from": "s", "to": "aut"}, {"from": "aut", "outcome": "OK", "to": "avviso"}, {"from": "avviso", "to": "fine"}])
    g = avvia(client, admin, w, tpl, title="RdA 2026/118 Ponteggi")
    assert completa(client, admin, g["id"], "aut", "OK")["workflow_status"] == "APPROVED"
    avvisi = [n for n in notifications(client, as_user("des_designer"), "WORKFLOW_NOTIFICATION")
              if n["data"].get("instance_id") == g["id"]]
    assert len(avvisi) == 1 and "Affidamento concluso per RdA 2026/118 Ponteggi" in avvisi[0]["body"]
    g = grafo(client, admin, g["id"])
    assert [r["status"] for r in g["node_runs"] if r["node_id"] == "avviso"] == ["DONE"]


@pytest.fixture
def condivisa(client, api_world, as_user, worker):  # noqa: F811
    _, w = api_world
    rev = upload(client, as_user("des_lead"), w.containers["des_arch"], des_name(), PDF, title="Pianta").json()
    worker()
    return transition(client, as_user("des_lead"), rev["id"], "SHARED", "S4").json()


def test_documento_fine_ok_pubblica_e_fine_ko_sblocca(client, api_world, as_user, condivisa, worker):  # noqa: F811
    _, w = api_world
    admin, lead = as_user("com_admin"), as_user("des_lead")
    tpl = salva(client, admin, w, [
        nodo("s", "start", "Avvio", 0, 0),
        decisione("dl", "Parere DL", 1, 0, [utente(w, "com_dl")]),
        nodo("ok", "end", "Approvato", 2, 0, result="OK"), nodo("ko", "end", "Rifiutato", 2, 1, result="KO")],
        [{"from": "s", "to": "dl"}, {"from": "dl", "outcome": "OK", "to": "ok"}, {"from": "dl", "outcome": "NO", "to": "ko"}],
        subject="DOCUMENT", on_completed={"to_state": "PUBLISHED", "suitability": "A1"})
    # un modello per documenti non si avvia come processo, e viceversa
    r = client.post(f"/projects/{w.project_id}/processes", headers=admin, json={"template_id": tpl["id"], "title": "x y"})
    assert r.status_code == 422

    # KO: il documento torna modificabile
    inst = client.post(f"/revisions/{condivisa['id']}/workflows", headers=lead, json={"template_id": tpl["id"]}).json()
    completa(client, as_user("com_dl"), inst["id"], "dl", "NO", "Quote mancanti")
    g = grafo(client, lead, inst["id"])
    assert g["subject"] == "DOCUMENT" and g["result"] == "KO" and g["document"]["id"] == condivisa["document_id"]
    doc = client.get(f"/documents/{condivisa['document_id']}", headers=lead).json()
    assert client.post(f"/revisions/{condivisa['id']}/workflows", headers=lead,
                       json={"template_id": tpl["id"]}).status_code == 201      # sbloccato: si riparte

    # OK: passaggio di stato del documento (on_completed)
    attiva = client.get(f"/documents/{condivisa['document_id']}/workflows", headers=lead).json()[0]
    completa(client, as_user("com_dl"), attiva["id"], "dl", "OK")
    doc = client.get(f"/documents/{condivisa['document_id']}", headers=lead).json()
    assert doc["current_revision"] == "C01" and doc["current_suitability"] == "A1"
    assert grafo(client, lead, attiva["id"])["document"]["final_revision_id"]

    proc = salva(client, admin, w, [nodo("s", "start", "Avvio", 0, 0), nodo("f", "end", "Fine", 1, 0, result="OK")],
                 [{"from": "s", "to": "f"}])
    r = client.post(f"/revisions/{condivisa['id']}/workflows", headers=lead, json={"template_id": proc["id"]})
    assert r.status_code == 422


def test_processo_con_documenti_allegati_e_visibilita(client, api_world, as_user, worker):  # noqa: F811
    _, w = api_world
    admin, lead = as_user("com_admin"), as_user("des_lead")
    # documento WIP dei progettisti: lo vede chi è della loro organizzazione, non il committente
    wip = upload(client, lead, w.containers["des_arch"], des_name(), PDF, title="Capitolato RdA").json()
    worker()
    tpl = salva(client, admin, w, [
        nodo("s", "start", "RdA con tutti i Buyer", 0, 0),
        decisione("pm", "Approvazione RdA (PM)", 1, 0, [utente(w, "com_admin")], esiti=(GIALLO, NO)),
        nodo("ok", "end", "Affidamento concluso", 2, 0, result="OK"), nodo("ko", "end", "Fallito", 2, 1, result="KO")],
        [{"from": "s", "to": "pm"}, {"from": "pm", "outcome": "IN_GARA", "to": "ok"}, {"from": "pm", "outcome": "NO", "to": "ko"}])
    assert tpl["subject"] == "PROCESS"
    # allegare un documento che non si vede: 404
    r = client.post(f"/projects/{w.project_id}/processes", headers=admin,
                    json={"template_id": tpl["id"], "title": "RdA", "document_ids": [wip["document_id"]]})
    assert r.status_code == 404
    g = avvia(client, lead, w, tpl, title="RdA 2026/120 Calcestruzzi", docs=[wip["document_id"]])
    assert g["subject"] == "PROCESS" and g["document"] is None and g["title"] == "RdA 2026/120 Calcestruzzi"
    assert [d["id"] for d in g["documents"]] == [wip["document_id"]]
    # il committente vede il processo (è nel progetto) ma non il documento WIP allegato
    g_admin = grafo(client, admin, g["id"])
    assert g_admin["documents"] == [] and g_admin["definition"]["version"] == 2
    task = compito(client, admin, g["id"], "pm")
    assert task["subject"] == "PROCESS" and task["identifier"] == "RdA 2026/120 Calcestruzzi"
    assert [o["code"] for o in task["outcomes"]] == ["IN_GARA", "NO"]
    elenco = client.get(f"/projects/{w.project_id}/processes", headers=lead, params={"status": "RUNNING"}).json()
    voce = next(p for p in elenco if p["id"] == g["id"])
    assert voce["active_nodes"] == ["Approvazione RdA (PM)"] and voce["documents"] == 1 and voce["status"] == "RUNNING"
    # chi non è nel progetto (altra organizzazione) non vede nulla
    out = as_user("out_user")
    assert client.get(f"/workflow-instances/{g['id']}", headers=out).status_code == 404
    assert client.get(f"/projects/{w.project_id}/processes", headers=out).status_code == 404
    # annullamento: solo chi l'ha avviato o il Project Admin
    assert client.post(f"/workflow-instances/{g['id']}/cancel", headers=as_user("des_designer"),
                       json={"reason": "non mio"}).status_code == 403
    r = client.post(f"/workflow-instances/{g['id']}/cancel", headers=admin, json={"reason": "RdA ritirata"})
    assert r.status_code == 200 and r.json()["status"] == "CANCELLED"


def test_processo_rda_gara_affidamento_completo(client, api_world, as_user):  # noqa: F811
    """Lo schema RdA dell'utente (27 nodi, cde workflow-rda) percorso fino all'affidamento."""
    from cde_api.tooling import workflow_rda

    _, w = api_world
    admin = as_user("com_admin")
    r = client.post(f"/projects/{w.project_id}/workflow-templates", headers=admin, json={
        "code": f"RDA_{uuid.uuid4().hex[:6].upper()}", "name": workflow_rda.NOME, "definition": workflow_rda.definizione()})
    assert r.status_code == 201, r.text
    tpl = r.json()
    assert tpl["subject"] == "PROCESS" and len(tpl["definition"]["nodes"]) == 27
    assert workflow_rda._uguale(tpl["definition"], workflow_rda.definizione())     # idempotenza dello strumento
    g = avvia(client, admin, w, tpl, title="RdA 2026/121 Casseforme")
    completa(client, admin, g["id"], "approvazione_pm", "IN_VALUTAZIONE")
    completa(client, admin, g["id"], "scelta_procedura", "IN_GARA")
    buyer = [workflow_rda.slug(b) for b in workflow_rda.BUYER]
    assert attivi(grafo(client, admin, g["id"])) == {f"sel_{b}" for b in buyer}
    for b in buyer:
        completa(client, admin, g["id"], f"sel_{b}", "IN_GARA")
    for i, b in enumerate(buyer):
        completa(client, admin, g["id"], f"off_{b}", "IN_GARA")
        assert ("qdr" in attivi(grafo(client, admin, g["id"]))) == (i == len(buyer) - 1)   # riunione dei 7 buyer
    completa(client, admin, g["id"], "qdr", "IN_GARA")
    aut = [f"aut_{workflow_rda.slug(a)}" for a in workflow_rda.AUTORIZZAZIONI]
    assert attivi(grafo(client, admin, g["id"])) == set(aut)
    for a in aut[:-1]:
        assert completa(client, admin, g["id"], a, "AFFIDATO")["workflow_status"] == "RUNNING"
    assert completa(client, admin, g["id"], aut[-1], "AFFIDATO")["workflow_status"] == "APPROVED"
    g = grafo(client, admin, g["id"])
    assert g["result"] == "OK" and [r["status"] for r in g["node_runs"] if r["node_id"] == "notifica"] == ["DONE"]
    assert any(n["data"].get("instance_id") == g["id"] for n in notifications(client, admin, "WORKFLOW_NOTIFICATION"))

    # un Respinto del PM porta alla conformità (filigrana RIFIUTATO) e poi a "Fallito"
    g = avvia(client, admin, w, tpl, title="RdA 2026/122 Ferro")
    completa(client, admin, g["id"], "approvazione_pm", "RESPINTO", "Manca il centro di costo")
    g = grafo(client, admin, g["id"])
    assert attivi(g) == {"conformita"}
    assert completa(client, admin, g["id"], "conformita", "FATTO")["workflow_status"] == "REJECTED"
