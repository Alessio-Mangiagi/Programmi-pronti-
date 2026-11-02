# "><(((º> sabusabu <º)))><"
"""Dialogo con InCampo e SkyTower: rotte offerte (token di servizio) e rotte che chiamano le altre app
(InCampo/SkyTower finti con monkeypatch su suite_link.chiama)."""
import json

import pytest

import pdf_semplice
import suite_rotte

TOKEN = {"X-Suite-Token": "token-di-prova", "X-Suite-Utente": "mrossi", "X-Suite-Nome": "Mario Rossi"}


@pytest.fixture
def cantiere(client, conn):
    u = client.post("/api/ubicazioni", json={"nome": "Cantiere Augusta", "tipo": "cantiere", "commessa": "101-003",
                                             "indirizzo": "Via del Porto 1, Augusta"}).get_json()
    a = client.post("/api/articoli", json={"descrizione": "Sabbia lavata", "um": "ton"}).get_json()
    client.post("/api/movimenti", json={"tipo": "carico", "articolo_id": a["id"], "a_ubicazione_id": u["id"], "quantita": 12.5})
    m = client.post("/api/mezzi", json={"tipo_mezzo": "Escavatore", "marca": "Caterpillar", "modello": "320", "targa": "AB123CD",
                                        "ubicazione_id": u["id"], "stato": "in_uso"}).get_json()
    m = m.get("mezzo", m)   # POST /api/mezzi risponde con la scheda completa
    return {"ubicazione": u, "articolo": a, "mezzo": m}


# --------------------------------------------------------------------------- rotte offerte alle altre app

def test_suite_giacenze_richiede_token(client, cantiere):
    assert client.get("/api/suite/commesse/101-003/giacenze").status_code == 403
    assert client.get("/api/suite/commesse/101-003/giacenze", headers={"X-Suite-Token": "sbagliato"}).status_code == 403


def test_suite_giacenze_per_commessa(client, cantiere):
    r = client.get("/api/suite/commesse/ 101-003 /giacenze", headers=TOKEN)   # spazi: confronto normalizzato
    assert r.status_code == 200, r.get_json()
    d = r.get_json()
    assert d["commessa"] == "101-003" and d["totali"] == {"articoli": 1, "mezzi": 1, "mezzi_in_uso": 1}
    assert d["articoli"][0]["descrizione"] == "Sabbia lavata" and d["articoli"][0]["quantita"] == 12.5
    assert d["mezzi"][0]["targa"] == "AB123CD" and d["mezzi"][0]["url"].endswith("#scansione/" + cantiere["mezzo"]["codice"])
    assert d["ubicazioni"][0]["indirizzo"].startswith("Via del Porto")
    assert client.get("/api/suite/commesse/999/giacenze", headers=TOKEN).status_code == 404


def test_suite_commesse_raggruppate(client, cantiere):
    client.post("/api/ubicazioni", json={"nome": "Deposito Augusta", "tipo": "deposito", "commessa": "101-003"})
    client.post("/api/ubicazioni", json={"nome": "Cantiere Messina", "tipo": "cantiere", "commessa": "102-001"})
    lista = client.get("/api/suite/commesse", headers=TOKEN).get_json()
    assert [c["commessa"] for c in lista] == ["101-003", "102-001"]
    assert len(lista[0]["ubicazioni"]) == 2 and lista[0]["articoli"] == 1 and lista[0]["mezzi"] == 1


# --------------------------------------------------------------------------- chiamate verso InCampo

@pytest.fixture
def incampo_finto(monkeypatch):
    chiamate = []

    def chiama(app, metodo, percorso, **kw):
        chiamate.append((app, metodo, percorso, kw))
        if app == "incampo" and percorso == "/suite/commesse":
            return [{"code": "101-003", "name": "Porto di Augusta", "cantieri": [
                {"id": "p1", "name": "Cantiere Augusta", "address": "Via del Porto 1, Augusta"},
                {"id": "p2", "name": "Banchina nord", "address": "Molo 3, Augusta"}]},
                    {"code": "C-2026-014", "name": "Scuola Messina", "cantieri": [{"id": "p3", "name": "Scuola Messina", "address": None}]}]
        if percorso.endswith("/riepilogo"):
            return {"commessa": {"code": "101-003", "name": "Porto di Augusta"}, "cantieri": [], "task": [{"id": "t1", "title": "Gru ferma"}], "nc": []}
        if percorso.endswith("/task") and metodo == "POST":
            return {"id": "t-nuovo", "title": kw["dati"]["title"], "project_id": "p1"}
        if app == "skytower" and metodo == "POST":
            return {"document_id": "d1", "identifier": "PRJ-COS-ZZ-ZZ-RP-Z-0001", "revision_code": "P01.01", "url": "http://localhost:5195/documenti/d1"}
        if app == "skytower":
            return {"items": [{"identifier": "PRJ-COS-ZZ-01-DR-A-0001", "title": "Pianta piano terra"}]}
        raise AssertionError(percorso)

    monkeypatch.setattr(suite_rotte.suite_link, "chiama", chiama)
    return chiamate


def test_incampo_riepilogo_passa_utente(client, cantiere, incampo_finto):
    r = client.get("/api/incampo/commessa/101-003")
    assert r.status_code == 200 and r.get_json()["task"][0]["title"] == "Gru ferma"
    app, metodo, percorso, kw = incampo_finto[0]
    assert (app, metodo, percorso) == ("incampo", "GET", "/suite/commesse/101-003/riepilogo")
    assert kw["utente"] == "sviluppo"


def test_incampo_task_da_mezzo(client, cantiere, incampo_finto):
    m = cantiere["mezzo"]
    r = client.post("/api/incampo/commessa/101-003/task", json={"titolo": "Escavatore fermo", "descrizione": "Perde olio", "mezzo_id": m["id"]})
    assert r.status_code == 201, r.get_json()
    dati = incampo_finto[0][3]["dati"]
    assert dati["title"] == "Escavatore fermo" and "AB123CD" in dati["description"] and "Perde olio" in dati["description"]
    reg = client.get("/api/admin/attivita?azione=segnalazione_incampo").get_json()
    assert reg and reg[0]["descrizione"].startswith("101-003")
    assert client.post("/api/incampo/commessa/101-003/task", json={"titolo": ""}).status_code == 400


def test_importa_cantieri_da_incampo(client, cantiere, incampo_finto):
    r = client.post("/api/incampo/importa-cantieri")
    assert r.status_code == 200
    # "Cantiere Augusta" c'era già (stessa commessa e nome) → aggiornata o invariata, le altre due nuove
    assert r.get_json()["nuove"] == 2 and r.get_json()["commesse"] == 2
    ubi = client.get("/api/ubicazioni").get_json()
    nomi = sorted((u["commessa"], u["nome"]) for u in ubi if u["commessa"])
    assert nomi == [("101-003", "Banchina nord"), ("101-003", "Cantiere Augusta"), ("C-2026-014", "Scuola Messina")]
    assert next(u for u in ubi if u["nome"] == "Banchina nord")["indirizzo"] == "Molo 3, Augusta"
    # seconda importazione: niente doppioni
    r2 = client.post("/api/incampo/importa-cantieri").get_json()
    assert r2["nuove"] == 0 and len(client.get("/api/ubicazioni").get_json()) == len(ubi)


def test_incampo_spento(client, cantiere, monkeypatch):
    def giu(*a, **k):
        raise suite_rotte.suite_link.SuiteError("incampo", 503, "InCampo non raggiungibile")
    monkeypatch.setattr(suite_rotte.suite_link, "chiama", giu)
    r = client.get("/api/incampo/commessa/101-003")
    assert r.status_code == 503 and "InCampo non raggiungibile" in r.get_json()["errore"]


# --------------------------------------------------------------------------- SkyTower

def test_report_giacenze_su_skytower(client, cantiere, incampo_finto):
    r = client.post("/api/skytower/commessa/101-003/report")
    assert r.status_code == 201, r.get_json()
    assert r.get_json()["identifier"].endswith("RP-Z-0001")
    app, metodo, percorso, kw = incampo_finto[0]
    assert (app, metodo, percorso) == ("skytower", "POST", "/suite/commesse/101-003/documenti")
    dati, tipo, nome = kw["corpo_file"]
    assert nome.startswith("giacenze-101-003-") and nome.endswith(".pdf") and tipo == "application/pdf"
    assert dati.startswith(b"%PDF-1.4") and b"Sabbia lavata" in dati and b"AB123CD" in dati
    assert kw["parametri"]["tipo"] == "RP" and json.loads(kw["parametri"]["attributes"])["origine"] == "magazzino"
    assert client.post("/api/skytower/commessa/999/report").status_code == 404


def test_documenti_skytower(client, cantiere, incampo_finto):
    r = client.get("/api/skytower/commessa/101-003/documenti?q=pianta")
    assert r.status_code == 200 and r.get_json()["items"][0]["title"] == "Pianta piano terra"
    assert incampo_finto[0][3]["parametri"] == {"area": "PUBLISHED", "q": "pianta"}


# --------------------------------------------------------------------------- PDF

def test_pdf_semplice_struttura_e_pagine():
    righe = [[f"MAG-{i:05d}", f"Articolo {i} con descrizione lunga " * 3, "Deposito", f"{i} pz"] for i in range(120)]
    pdf = pdf_semplice.documento_pdf([
        {"titolo": "Giacenze — commessa 101-003", "intestazioni": ["Codice", "Articolo", "Ubicazione", "Quantità"], "righe": righe, "numeriche": (3,)},
        {"titolo": "Mezzi", "intestazioni": ["Codice", "Mezzo"], "righe": []},
    ], piede="Generato da test")
    assert pdf.startswith(b"%PDF-1.4") and pdf.rstrip().endswith(b"%%EOF")
    n_pagine = pdf.count(b"/Type /Page ")
    assert n_pagine >= 3 and b"/Count %d" % n_pagine in pdf
    assert b"Nessuna riga." in pdf and b"Pagina 1 di %d" % n_pagine in pdf
    # parentesi e caratteri accentati non rompono le stringhe PDF
    pdf2 = pdf_semplice.tabella_pdf("Prova (è)", ["A"], [["x(y) à"]])
    assert b"Prova \\(\\xe8\\)" in pdf2 or b"Prova \\(" in pdf2
