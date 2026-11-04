# "><(((º> sabusabu <º)))><"
"""Tornare indietro da ogni nodo (ADR-51, docs/workflow-grafo.md §6, migrazione 0042).

Chiarimento andata e ritorno senza spostare il flusso (compito in attesa, scadenza sospesa e spostata avanti);
richiesta di modifiche al nodo precedente e a due nodi indietro con rifacimento dei nodi intermedi; rami paralleli
dello schema RdA (torna indietro solo quel ramo, la riunione QdR aspetta, gli altri buyer non si riattivano);
nuova revisione in un workflow per documenti (blocco, condivisione, passaggio di stato finale sulla nuova);
allegati di un processo; "chi ha avviato" come destinazione; permessi; tetto dei 20 giri; modelli di libreria.
"""
from __future__ import annotations

import os

import psycopg
from test_api_documents import PDF, des_name, upload
from test_api_states import as_user, worker  # noqa: F401 - fixture riusate
from test_api_workflows import notifications
from test_workflow_grafo import NO, OK, attivi, avvia, condivisa, decisione, grafo, nodo, salva, utente  # noqa: F401
from test_workflow_libreria import avvia as avvia_lib
from test_workflow_libreria import come, due_passi, in_libreria, lib  # noqa: F401 - fixture riusate

from cde_api.tooling import workflow_rda


# ---------------------------------------------------------------------
# Aiuti
# ---------------------------------------------------------------------
def compito(client, h, iid, node_id, kind="WORKFLOW"):
    tasks = client.get("/me/tasks", headers=h).json()
    return next(t for t in tasks if t["instance_id"] == iid and t["node_id"] == node_id and t["kind"] == kind)


def completa(client, h, iid, node_id, esito="OK", commento=None, atteso=200):
    t = compito(client, h, iid, node_id)
    r = client.post(f"/tasks/{t['id']}/complete", headers=h, json={"outcome": esito, "comment": commento})
    assert r.status_code == atteso, r.text
    return r.json()


def chiedi(client, h, iid, node_id, target, commento="Serve un chiarimento", atteso=200):
    t = compito(client, h, iid, node_id)
    r = client.post(f"/tasks/{t['id']}/clarification", headers=h, json={"target": target, "comment": commento})
    assert r.status_code == atteso, r.text
    return r.json()


def rimanda(client, h, iid, node_id, target, commento="Da rivedere", atteso=200):
    t = compito(client, h, iid, node_id)
    r = client.post(f"/tasks/{t['id']}/request-changes", headers=h, json={"target": target, "comment": commento})
    assert r.status_code == atteso, r.text
    return r.json()


def rispondi(client, h, iid, node_id, risposta, atteso=200):
    t = compito(client, h, iid, node_id, kind="CLARIFICATION")
    r = client.post(f"/tasks/{t['id']}/clarification/answer", headers=h, json={"comment": risposta})
    assert r.status_code == atteso, r.text
    return r.json()


def giri(g, node_id):
    return sorted((r["round"], r["status"]) for r in g["node_runs"] if r["node_id"] == node_id)


def tre_passi(w, **kw):
    """Avvio → a (Lead Designer) → b (Designer) → c (Project Admin) → fine; "Respinto" → fallito."""
    nodes = [nodo("s", "start", "Avvio", 0, 0),
             decisione("a", "Verifica tecnica", 1, 0, [utente(w, "des_lead")]),
             decisione("b", "Controllo qualità", 2, 0, [utente(w, "des_designer")]),
             decisione("c", "Approvazione", 3, 0, [utente(w, "com_admin")], **kw),
             nodo("ok", "end", "Concluso", 4, 0, result="OK"), nodo("ko", "end", "Fallito", 4, 1, result="KO")]
    edges = [{"from": "s", "to": "a"}]
    for x, y in (("a", "b"), ("b", "c"), ("c", "ok")):
        edges += [{"from": x, "outcome": "OK", "to": y}, {"from": x, "outcome": "NO", "to": "ko"}]
    return nodes, edges


# ---------------------------------------------------------------------
# Chiarimento
# ---------------------------------------------------------------------
def test_chiarimento_andata_e_ritorno_senza_spostare_il_flusso(client, api_world, as_user):  # noqa: F811
    urls, w = api_world
    admin, lead, des = as_user("com_admin"), as_user("des_lead"), as_user("des_designer")
    tpl = salva(client, admin, w, *tre_passi(w, sla_hours=48))
    g = avvia(client, admin, w, tpl, title="Chiarimento di prova")
    completa(client, lead, g["id"], "a")
    completa(client, des, g["id"], "b")

    # destinazioni dal compito di c: i nodi già fatti del ramo, il più vicino proposto, poi chi ha avviato
    t = compito(client, admin, g["id"], "c")
    assert t["can_send_back"] and t["waiting_for"] is None
    dest = client.get(f"/tasks/{t['id']}/send-back-targets", headers=admin).json()
    assert [d["target"] for d in dest] == ["b", "a", "ORIGINATOR"]
    assert dest[0]["default"] and dest[0]["people"] and not dest[0]["active"]

    out = chiedi(client, admin, g["id"], "c", "a", "Quale fornitore avete verificato?")
    assert out["send_back"]["kind"] == "CLARIFICATION" and out["send_back"]["status"] == "OPEN"
    assert out["send_back"]["recipients"] and out["send_back"]["target"]["name"] == "Verifica tecnica"

    # il compito di chi chiede è in attesa: non si completa, non si rimanda, non scade
    t = compito(client, admin, g["id"], "c")
    assert t["waiting_for"]["comment"] == "Quale fornitore avete verificato?"
    completa(client, admin, g["id"], "c", atteso=422)
    rimanda(client, admin, g["id"], "c", "b", atteso=422)
    chiedi(client, admin, g["id"], "c", "b", atteso=422)
    with psycopg.connect(urls.owner) as conn:
        conn.execute("UPDATE cde.tasks SET due_at = now() - interval '1 hour', hold_since = now() - interval '3 hours' "
                     "WHERE id = %s", [t["id"]])
        conn.execute("SELECT cde.process_deadlines()")
        assert conn.execute("SELECT overdue_notified_at FROM cde.tasks WHERE id = %s", [t["id"]]).fetchone()[0] is None

    # chi è interpellato ha un compito di chiarimento con la domanda; si chiude solo rispondendo
    q = compito(client, lead, g["id"], "c", kind="CLARIFICATION")
    assert q["outcomes"] == [] and q["clarification"]["comment"] == "Quale fornitore avete verificato?"
    assert any(n["data"].get("instance_id") == g["id"]
               for n in notifications(client, lead, "WORKFLOW_CLARIFICATION_REQUESTED"))
    r = client.post(f"/tasks/{q['id']}/complete", headers=lead, json={"outcome": "OK"})
    assert r.status_code == 422
    rispondi(client, lead, g["id"], "c", "   ", atteso=422)
    out = rispondi(client, lead, g["id"], "c", "Fornitore Rossi, certificato allegato")
    assert out["send_back"]["status"] == "ANSWERED" and out["send_back"]["answer"].startswith("Fornitore Rossi")

    # la risposta torna a chi ha chiesto; il suo compito è di nuovo attivo, scadenza spostata avanti delle 3 ore
    assert any("Fornitore Rossi" in n["body"] for n in notifications(client, admin, "WORKFLOW_CLARIFICATION_ANSWERED"))
    t = compito(client, admin, g["id"], "c")
    assert t["waiting_for"] is None and not t["overdue"]
    assert t["clarifications"][0]["answer"].startswith("Fornitore Rossi")

    # nulla si è rifatto: un giro per nodo, il flusso è dov'era
    g2 = grafo(client, admin, g["id"])
    assert attivi(g2) == {"c"} and giri(g2, "a") == [(1, "DONE")] and giri(g2, "b") == [(1, "DONE")]
    assert all(len(r["tasks"]) == 1 for r in g2["node_runs"] if r["node_type"] == "decision")   # niente chiarimenti fra i voti
    assert completa(client, admin, g["id"], "c")["workflow_status"] == "APPROVED"


# ---------------------------------------------------------------------
# Richiesta di modifiche
# ---------------------------------------------------------------------
def test_modifiche_al_nodo_precedente_e_due_nodi_indietro(client, api_world, as_user):  # noqa: F811
    _, w = api_world
    admin, lead, des = as_user("com_admin"), as_user("des_lead"), as_user("des_designer")
    tpl = salva(client, admin, w, *tre_passi(w))
    g = avvia(client, admin, w, tpl, title="Modifiche di prova")
    completa(client, lead, g["id"], "a")
    completa(client, des, g["id"], "b")

    # destinazione non valida: un nodo non fatto, sé stessi, un nodo inesistente
    for target in ("ok", "c", "zeta"):
        rimanda(client, admin, g["id"], "c", target, atteso=422)
    rimanda(client, admin, g["id"], "c", "Fuori!", atteso=422)                # formato non valido
    t = compito(client, admin, g["id"], "c")
    r = client.post(f"/tasks/{t['id']}/request-changes", headers=admin, json={"target": "b", "comment": ""})
    assert r.status_code == 422                                                  # commento obbligatorio

    # al nodo subito prima: b si riapre (giro 2), il giro di c si annulla con il motivo
    out = rimanda(client, admin, g["id"], "c", "b", "Manca la verifica dei carichi")
    g2 = out["workflow"]
    assert attivi(g2) == {"b"} and giri(g2, "b") == [(1, "DONE"), (2, "ACTIVE")] and giri(g2, "c") == [(1, "CANCELLED")]
    annullato = next(r for r in g2["node_runs"] if r["node_id"] == "c")["tasks"][0]
    assert annullato["status"] == "CANCELLED" and annullato["cancel_reason"].startswith("Rimandato indietro a «Controllo qualità»")
    assert out["send_back"]["status"] == "OPEN" and out["send_back"]["target"]["reopened_round"] == 2
    # chi riceve vede la richiesta e il commento; l'avviso è quello delle modifiche, non un "Compito:" generico
    tb = compito(client, des, g["id"], "b")
    assert tb["changes_request"]["comment"] == "Manca la verifica dei carichi"
    avvisi = [n for n in notifications(client, des) if n["data"].get("instance_id") == g["id"]]
    assert any(n["kind"] == "WORKFLOW_CHANGES_REQUESTED" and "Manca la verifica" in n["body"] for n in avvisi)
    completa(client, des, g["id"], "b")
    g3 = grafo(client, admin, g["id"])
    assert attivi(g3) == {"c"} and giri(g3, "c") == [(1, "CANCELLED"), (2, "ACTIVE")]
    assert g3["send_backs"][0]["status"] == "RETURNED"

    # due nodi indietro: si riapre a, poi si rifà b (nuovo giro) e si torna a c
    rimanda(client, admin, g["id"], "c", "a", "Rifare il calcolo")
    completa(client, lead, g["id"], "a")
    g4 = grafo(client, admin, g["id"])
    assert attivi(g4) == {"b"} and giri(g4, "b")[-1] == (3, "ACTIVE")
    assert next(r for r in g4["node_runs"] if r["node_id"] == "b" and r["round"] == 3)["send_back_id"]   # rifatto
    completa(client, des, g["id"], "b")
    g5 = grafo(client, admin, g["id"])
    assert attivi(g5) == {"c"} and giri(g5, "a") == [(1, "DONE"), (2, "DONE")]
    assert [b["status"] for b in g5["send_backs"]] == ["RETURNED", "RETURNED"]
    assert completa(client, admin, g["id"], "c")["workflow_status"] == "APPROVED"


def test_rami_paralleli_rda_torna_indietro_solo_quel_ramo(client, api_world, as_user):  # noqa: F811
    _, w = api_world
    admin, lead, des, dl, im = (as_user(u) for u in ("com_admin", "des_lead", "des_designer", "com_dl", "com_im"))
    d = workflow_rda.definizione(buyer=["Uno", "Due", "Tre"], autorizzazioni=["DC"])
    persona = {"_uno": "des_lead", "_due": "des_designer", "_tre": "com_dl", "aut_": "com_im"}
    for n in d["nodes"]:
        if "assignees" in n:
            chi = next((u for k, u in persona.items() if k in n["id"]), "com_admin")
            n["assignees"] = [utente(w, chi)]
    tpl = salva(client, admin, w, d["nodes"], d["edges"])
    h = {"des_lead": lead, "des_designer": des, "com_dl": dl}

    def fino_a_scelta(titolo):
        g = avvia(client, admin, w, tpl, title=titolo)
        completa(client, admin, g["id"], "approvazione_pm", "IN_VALUTAZIONE")
        completa(client, admin, g["id"], "scelta_procedura", "IN_GARA")
        assert attivi(grafo(client, admin, g["id"])) == {"sel_uno", "sel_due", "sel_tre"}
        return g["id"]

    # 1) il buyer Uno rimanda alla propria "Selezione imprese": gli altri buyer vanno avanti, la QdR lo aspetta
    iid = fino_a_scelta("RdA con ritorno al proprio passo")
    completa(client, lead, iid, "sel_uno", "IN_GARA")
    rimanda(client, lead, iid, "off_uno", "sel_uno", "Inviare la RDO anche a Bianchi")
    for b, u in (("due", "des_designer"), ("tre", "com_dl")):
        completa(client, h[u], iid, f"sel_{b}", "IN_GARA")
        completa(client, h[u], iid, f"off_{b}", "IN_GARA")
    g = grafo(client, admin, iid)
    assert attivi(g) == {"sel_uno"} and "qdr" not in {r["node_id"] for r in g["node_runs"]}
    completa(client, lead, iid, "sel_uno", "IN_GARA")
    completa(client, lead, iid, "off_uno", "IN_GARA")
    g = grafo(client, admin, iid)
    assert attivi(g) == {"qdr"} and giri(g, "qdr") == [(1, "ACTIVE")]

    # 2) il buyer Uno rimanda alla "Scelta procedura", a monte della biforcazione in 3 rami
    iid = fino_a_scelta("RdA con ritorno alla scelta")
    completa(client, lead, iid, "sel_uno", "IN_GARA")
    t = compito(client, lead, iid, "off_uno")
    dest = [x["target"] for x in client.get(f"/tasks/{t['id']}/send-back-targets", headers=lead).json()]
    assert dest == ["sel_uno", "scelta_procedura", "approvazione_pm", "ORIGINATOR"]
    rimanda(client, lead, iid, "off_uno", "scelta_procedura", "Procedura negoziata, non affidamento diretto")
    g = grafo(client, admin, iid)
    assert attivi(g) == {"scelta_procedura", "sel_due", "sel_tre"}          # gli altri rami continuano
    for b, u in (("due", "des_designer"), ("tre", "com_dl")):
        completa(client, h[u], iid, f"sel_{b}", "IN_GARA")
        completa(client, h[u], iid, f"off_{b}", "IN_GARA")
    g = grafo(client, admin, iid)
    assert attivi(g) == {"scelta_procedura"}                                  # la riunione QdR aspetta
    completa(client, admin, iid, "scelta_procedura", "IN_GARA")
    g = grafo(client, admin, iid)
    # riaperta, la scelta percorre solo l'arco verso il ramo che ha chiesto: niente nuovi giri per Due e Tre
    assert attivi(g) == {"sel_uno"}
    assert giri(g, "sel_due") == [(1, "DONE")] and giri(g, "sel_tre") == [(1, "DONE")]
    assert giri(g, "scelta_procedura") == [(1, "DONE"), (2, "DONE")]
    completa(client, lead, iid, "sel_uno", "IN_GARA")
    completa(client, lead, iid, "off_uno", "IN_GARA")
    g = grafo(client, admin, iid)
    assert attivi(g) == {"qdr"} and giri(g, "qdr") == [(1, "ACTIVE")]
    completa(client, admin, iid, "qdr", "IN_GARA")
    assert completa(client, im, iid, "aut_dc", "AFFIDATO")["workflow_status"] == "APPROVED"

    # 3) riaperta, la scelta con un esito diverso ("Respinto") segue i suoi archi come sempre
    iid = fino_a_scelta("RdA respinta al secondo giro")
    rimanda(client, lead, iid, "sel_uno", "scelta_procedura", "Budget da rivedere")
    completa(client, admin, iid, "scelta_procedura", "RESPINTO", "Fuori budget")
    assert attivi(grafo(client, admin, iid)) == {"conformita", "sel_due", "sel_tre"}


# ---------------------------------------------------------------------
# Documenti: nuova revisione
# ---------------------------------------------------------------------
def test_documento_nuova_revisione_dal_compito(client, api_world, as_user, condivisa, worker):  # noqa: F811
    _, w = api_world
    admin, lead, des, dl = as_user("com_admin"), as_user("des_lead"), as_user("des_designer"), as_user("com_dl")
    tpl = salva(client, admin, w, [
        nodo("s", "start", "Avvio", 0, 0),
        decisione("dl", "Parere DL", 1, 0, [utente(w, "com_dl")]),
        nodo("ok", "end", "Approvato", 2, 0, result="OK"), nodo("ko", "end", "Rifiutato", 2, 1, result="KO")],
        [{"from": "s", "to": "dl"}, {"from": "dl", "outcome": "OK", "to": "ok"}, {"from": "dl", "outcome": "NO", "to": "ko"}],
        subject="DOCUMENT", on_completed={"to_state": "PUBLISHED", "suitability": "A1"})
    inst = client.post(f"/revisions/{condivisa['id']}/workflows", headers=lead, json={"template_id": tpl["id"]}).json()
    nome = condivisa["original_filename"]
    nuovo_pdf = b"%PDF-1.7\n" + os.urandom(2048)
    # durante il workflow il documento è bloccato per tutti
    assert upload(client, lead, w.containers["des_arch"], nome, nuovo_pdf).status_code == 423

    # il DL rimanda a chi ha avviato: si riapre l'avvio con un compito "Modifiche fatte" per lui
    out = rimanda(client, dl, inst["id"], "dl", "ORIGINATOR", "Manca la quota del solaio")
    assert out["send_back"]["target"]["originator"] and attivi(out["workflow"]) == {"s"}
    t = compito(client, lead, inst["id"], "s")
    assert t["outcomes"] == [{"code": "FATTO", "label": "Modifiche fatte", "color": "green"}] and not t["can_send_back"]
    assert t["changes_request"]["comment"] == "Manca la quota del solaio" and t["new_revision"] is None
    # solo chi ha il compito riaperto carica la nuova revisione
    assert upload(client, des, w.containers["des_arch"], nome, nuovo_pdf).status_code == 423
    rev = upload(client, lead, w.containers["des_arch"], nome, nuovo_pdf)
    assert rev.status_code == 200, rev.text
    rev = rev.json()
    assert rev["state"] == "WIP" and rev["revision_code"] == "P02.01"
    assert compito(client, lead, inst["id"], "s")["new_revision"]["revision_code"] == "P02.01"
    # completare prima delle verifiche sul file: errore chiaro
    r = completa(client, lead, inst["id"], "s", "FATTO", atteso=422)
    assert "in verifica" in r["error"]["message"]
    worker()
    completa(client, lead, inst["id"], "s", "FATTO")

    # il workflow prosegue sulla nuova revisione, condivisa con la stessa idoneità; la vecchia resta nello storico
    g = grafo(client, dl, inst["id"])
    assert attivi(g) == {"dl"} and g["document"]["revision_code"] == "P02"
    sb = g["send_backs"][0]
    assert sb["status"] == "RETURNED" and sb["revision"]["from_code"] == "P01" and sb["revision"]["to_code"] == "P02"
    revs = client.get(f"/documents/{condivisa['document_id']}", headers=lead).json()["revisions"]
    codici = {(x["revision_code"], x["state"]) for x in revs}
    assert {("P01", "SHARED"), ("P02.01", "WIP"), ("P02", "SHARED")} <= codici
    # il blocco resta sul documento
    assert upload(client, lead, w.containers["des_arch"], nome, b"%PDF-1.7\n" + os.urandom(999)).status_code == 423
    # fine OK: il passaggio di stato va sulla revisione nuova
    completa(client, dl, inst["id"], "dl")
    doc = client.get(f"/documents/{condivisa['document_id']}", headers=lead).json()
    assert doc["current_revision"] == "C01" and doc["current_suitability"] == "A1"
    finale = next(x for x in doc["revisions"] if x["revision_code"] == "C01")
    assert finale["derived_from"] == g["document"]["revision_id"]


# ---------------------------------------------------------------------
# Processi: allegati; chi ha avviato; permessi
# ---------------------------------------------------------------------
def test_processo_allegati_e_chi_ha_avviato(client, api_world, as_user, worker):  # noqa: F811
    _, w = api_world
    admin, lead, des = as_user("com_admin"), as_user("des_lead"), as_user("des_designer")
    doc1 = upload(client, lead, w.containers["des_arch"], des_name(), PDF, title="Capitolato v1").json()
    doc2 = upload(client, lead, w.containers["des_arch"], des_name(), PDF, title="Capitolato v2").json()
    worker()
    tpl = salva(client, admin, w, *tre_passi(w))
    g = avvia(client, lead, w, tpl, title="RdA con allegati", docs=[doc1["document_id"]])

    # chi ha avviato, interpellato per un chiarimento da sé stesso: nessun altro a cui chiedere
    r = chiedi(client, lead, g["id"], "a", "ORIGINATOR", atteso=422)
    assert "Nessun altro" in r["error"]["message"]
    completa(client, lead, g["id"], "a")
    # chiarimento a chi ha avviato: risponde lui
    chiedi(client, des, g["id"], "b", "ORIGINATOR", "Il capitolato è quello definitivo?")
    rispondi(client, lead, g["id"], "b", "No, ne carico un altro")

    # modifiche ad "a": chi ha il compito riaperto cambia gli allegati, gli altri no
    rimanda(client, des, g["id"], "b", "a", "Allegare il capitolato aggiornato")
    r = client.put(f"/processes/{g['id']}/documents", headers=admin, json={"document_ids": [doc2["document_id"]]})
    assert r.status_code == 403
    r = client.put(f"/processes/{g['id']}/documents", headers=lead, json={"document_ids": [doc2["document_id"]]})
    assert r.status_code == 200, r.text
    assert [x["id"] for x in r.json()["documents"]] == [doc2["document_id"]]
    sb = next(b for b in r.json()["send_backs"] if b["kind"] == "CHANGES")
    assert sb["documents_changed_at"] and sb["documents_before"] == [doc1["document_id"]]
    completa(client, lead, g["id"], "a")
    assert attivi(grafo(client, lead, g["id"])) == {"b"}
    # finito il rifacimento, gli allegati non si cambiano più dal compito
    r = client.put(f"/processes/{g['id']}/documents", headers=lead, json={"document_ids": []})
    assert r.status_code == 403

    # modifiche a chi ha avviato in un processo: avvio riaperto, poi si riparte verso chi ha chiesto
    rimanda(client, des, g["id"], "b", "ORIGINATOR", "Rivedere la descrizione")
    completa(client, lead, g["id"], "s", "FATTO")
    g2 = grafo(client, lead, g["id"])
    assert attivi(g2) == {"a"} and giri(g2, "s") == [(1, "DONE"), (2, "DONE")] and giri(g2, "a")[-1] == (3, "ACTIVE")


def test_permessi_solo_chi_ha_il_compito(client, api_world, as_user):  # noqa: F811
    _, w = api_world
    admin, lead, des = as_user("com_admin"), as_user("des_lead"), as_user("des_designer")
    tpl = salva(client, admin, w, *tre_passi(w))
    g = avvia(client, admin, w, tpl, title="Permessi del ritorno")
    completa(client, lead, g["id"], "a")
    t = compito(client, des, g["id"], "b")
    # il compito di un altro: 404 su destinazioni, chiarimento e modifiche
    assert client.get(f"/tasks/{t['id']}/send-back-targets", headers=lead).status_code == 404
    for azione in ("clarification", "request-changes"):
        r = client.post(f"/tasks/{t['id']}/{azione}", headers=lead, json={"target": "a", "comment": "x"})
        assert r.status_code == 404
    # da un compito di chiarimento non si torna indietro; a un chiarimento non risponde chi non è interpellato
    chiedi(client, des, g["id"], "b", "a", "Dubbio")
    q = compito(client, lead, g["id"], "b", kind="CLARIFICATION")
    r = client.post(f"/tasks/{q['id']}/request-changes", headers=lead, json={"target": "a", "comment": "x"})
    assert r.status_code == 422
    r = client.post(f"/tasks/{q['id']}/clarification/answer", headers=des, json={"comment": "risposta"})
    assert r.status_code == 404
    # un compito già chiuso non torna indietro
    rispondi(client, lead, g["id"], "b", "Chiarito")
    completa(client, des, g["id"], "b")
    r = client.post(f"/tasks/{t['id']}/request-changes", headers=des, json={"target": "a", "comment": "tardi"})
    assert r.status_code == 422
    # chi interrompe il processo chiude anche i chiarimenti aperti
    chiedi(client, admin, g["id"], "c", "b", "Ultimo dubbio")
    r = client.post(f"/workflow-instances/{g['id']}/cancel", headers=admin, json={"reason": "Prova finita"})
    assert r.status_code == 200 and r.json()["send_backs"][-1]["status"] == "CLOSED"


def test_tetto_dei_20_giri(client, api_world, as_user):  # noqa: F811
    _, w = api_world
    admin, lead, des = as_user("com_admin"), as_user("des_lead"), as_user("des_designer")
    tpl = salva(client, admin, w, *tre_passi(w))
    g = avvia(client, admin, w, tpl, title="Ritorni senza fine")
    completa(client, lead, g["id"], "a")
    for _ in range(19):                     # a arriva al giro 20
        rimanda(client, des, g["id"], "b", "a", "Ancora")
        completa(client, lead, g["id"], "a")
    rimanda(client, des, g["id"], "b", "a", "Una volta di troppo")
    g2 = grafo(client, admin, g["id"])
    assert g2["status"] == "CANCELLED" and "superato 20 giri" in g2["outcome_comment"]
    assert max(r["round"] for r in g2["node_runs"] if r["node_id"] == "a") == 20


# ---------------------------------------------------------------------
# Libreria
# ---------------------------------------------------------------------
def test_ritorno_su_modello_di_libreria(client, lib, come):  # noqa: F811
    tpl = in_libreria(client, come("admin"), lib.org, due_passi())
    g = avvia_lib(client, come("pm"), lib.p1, tpl["id"], "Libreria con ritorno")
    completa(client, come("pm"), g["id"], "a")
    # b è dei Project Admin (admin e pm, quorum ANY): pm rimanda ad "a", che si riapre per entrambi
    rimanda(client, come("pm"), g["id"], "b", "a", "Verifica incompleta")
    g2 = grafo(client, come("admin"), g["id"])
    assert attivi(g2) == {"a"} and len(next(r for r in g2["node_runs"] if r["node_id"] == "a" and r["round"] == 2)["tasks"]) == 2
    completa(client, come("admin"), g["id"], "a")
    # chiarimento ad "a": lo riceve chi ha deciso nel giro 2 (admin), non chi chiede
    chiedi(client, come("pm"), g["id"], "b", "a", "Chi ha firmato?")
    rispondi(client, come("admin"), g["id"], "b", "Io, con la verifica allegata")
    assert completa(client, come("pm"), g["id"], "b")["workflow_status"] == "APPROVED"
