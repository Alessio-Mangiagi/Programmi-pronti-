# "><(((º> sabusabu <º)))><"
"""Dialogo con Magazzino e SkyTower: rotte offerte (token di servizio) e rotte utente che chiamano
le altre app (finte con monkeypatch su suite_link.chiama)."""
import io
import json
import os

import pytest
from PIL import Image

from app.routers import suite as suite_router

os.environ["SUITE_TOKEN"] = "token-di-prova"
TOKEN = {"X-Suite-Token": "token-di-prova", "X-Suite-Utente": "admin@test.local", "X-Suite-Nome": "Amministratore"}


def png_bytes(w=640, h=480) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), "white").save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def commessa(client, project):
    """Commessa 101-003 con il cantiere del fixture project, un pin con task aperto e una NC."""
    c = client.post("/commesse", json={"code": "101-003", "name": "Porto di Augusta", "client": "Autorità portuale"}).json()
    pid = project["project"]["id"]
    assert client.patch(f"/projects/{pid}", json={"commessa_id": c["id"]}).status_code == 200
    pin = client.post("/pins", json={"plan_id": project["plan"]["id"], "x": 0.5, "y": 0.5, "label": "Pilastro 3"}).json()
    task = client.post("/tasks", json={"pin_id": pin["id"], "title": "Gru da verificare"}).json()
    io_ = client.get("/auth/me").json()["id"]
    # open → assigned → resolved: le transizioni ammesse dal web
    chiuso = client.post("/tasks", json={"project_id": pid, "title": "Già risolto", "assigned_to": io_}).json()
    assert client.patch(f"/tasks/{chiuso['id']}", json={"status": "resolved"}).status_code == 200
    sub = client.post("/submissions", json={"template_id": project["template"]["id"], "pin_id": pin["id"],
                                            "data_json": {"esito": "Non conforme"}}).json()
    ok = client.post("/submissions", json={"template_id": project["template"]["id"], "pin_id": pin["id"],
                                           "data_json": {"esito": "Conforme"}}).json()
    return {"commessa": c, "project_id": pid, "pin": pin, "task": task, "nc": sub, "ok": ok}


# --------------------------------------------------------------------------- offerto alle altre app

def test_suite_richiede_token(client, commessa):
    assert client.get("/suite/commesse", headers={"Authorization": ""}).status_code == 403
    assert client.get("/suite/commesse/101-003/riepilogo", headers={"X-Suite-Token": "no"}).status_code == 403


def test_suite_commesse_e_cantieri(client, commessa):
    r = client.get("/suite/commesse", headers=TOKEN)
    assert r.status_code == 200
    lista = r.json()
    assert lista[0]["code"] == "101-003" and lista[0]["cantieri"][0]["name"] == "Cantiere A"
    assert lista[0]["cantieri"][0]["url"].endswith(f"/projects/{commessa['project_id']}/plans")


def test_suite_riepilogo_task_e_nc(client, commessa):
    r = client.get("/suite/commesse/ 101-003 /riepilogo", headers=TOKEN)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["commessa"]["name"] == "Porto di Augusta"
    assert d["cantieri"][0]["task_aperti"] == 1 and d["cantieri"][0]["nc_aperte"] == 1
    assert [t["title"] for t in d["task"]] == ["Gru da verificare"]
    assert d["task"][0]["plan_name"] == "Piano terra" and d["task"][0]["pin_label"] == "Pilastro 3"
    assert d["task"][0]["url"].endswith(f"/plans/{commessa['pin']['plan_id']}?pin={commessa['pin']['id']}")
    assert d["nc"][0]["value"] == "Non conforme" and d["nc"][0]["template_name"] == "Ispezione"
    assert client.get("/suite/commesse/999/riepilogo", headers=TOKEN).status_code == 404


def test_suite_nc_con_task_chiuso_sparisce(client, commessa):
    io_ = client.get("/auth/me").json()["id"]
    t = client.post("/tasks", json={"pin_id": commessa["pin"]["id"], "submission_id": commessa["nc"]["id"], "title": "Sistemare",
                                    "assigned_to": io_}).json()
    assert client.patch(f"/tasks/{t['id']}", json={"status": "resolved"}).status_code == 200
    d = client.get("/suite/commesse/101-003/riepilogo", headers=TOKEN).json()
    assert d["nc"] == [] and d["cantieri"][0]["nc_aperte"] == 0


def test_suite_crea_task_attribuito(client, commessa):
    r = client.post("/suite/commesse/101-003/task", json={"title": "Escavatore fermo", "description": "Perde olio"}, headers=TOKEN)
    assert r.status_code == 201, r.text
    t = r.json()
    assert t["status"] == "open" and t["project_id"] == commessa["project_id"] and t["url"].endswith("/tasks")
    dett = client.get(f"/tasks/{t['id']}").json()
    assert dett["created_by"] is not None and dett["description"] == "Perde olio"
    # utente del portale senza corrispondenza in InCampo: niente autore, ma resta scritto chi era
    r2 = client.post("/suite/commesse/101-003/task", json={"title": "Materiale finito"},
                     headers={"X-Suite-Token": "token-di-prova", "X-Suite-Utente": "mrossi", "X-Suite-Nome": "Mario Rossi"})
    assert r2.status_code == 201
    assert "Segnalato da Mario Rossi" in client.get(f"/tasks/{r2.json()['id']}").json()["description"]
    assert client.post("/suite/commesse/101-003/task", json={"title": "x", "project_id": "nope"}, headers=TOKEN).status_code == 404


# --------------------------------------------------------------------------- verso Magazzino e SkyTower

@pytest.fixture
def altre_app(monkeypatch):
    chiamate = []

    def chiama(app, metodo, percorso, **kw):
        chiamate.append((app, metodo, percorso, kw))
        if app == "magazzino":
            return {"commessa": "101-003", "articoli": [{"codice": "MAG-00001", "descrizione": "Sabbia", "quantita": 12, "um": "ton"}],
                    "mezzi": [], "totali": {"articoli": 1, "mezzi": 0, "mezzi_in_uso": 0}, "url": "http://localhost:5200/#giacenze"}
        if app == "skytower" and percorso.endswith("/file"):
            return png_bytes(), "image/png"
        if app == "skytower" and metodo == "POST":
            return {"document_id": "d1", "identifier": "PRJ-COS-ZZ-ZZ-RP-Z-0002", "revision_code": "P01.01", "url": "http://localhost:5195/documenti/d1"}
        if app == "skytower":
            return {"items": [{"id": "d0", "identifier": "PRJ-COS-ZZ-00-DR-A-0001", "title": "Pianta piano terra", "revision_id": "r1"}]}
        raise AssertionError((app, percorso))

    monkeypatch.setattr(suite_router.suite_link, "chiama", chiama)
    return chiamate


def test_magazzino_del_cantiere(client, commessa, altre_app):
    r = client.get(f"/projects/{commessa['project_id']}/magazzino")
    assert r.status_code == 200, r.text
    assert r.json()["articoli"][0]["descrizione"] == "Sabbia" and r.json()["commessa_code"] == "101-003"
    app, metodo, percorso, kw = altre_app[0]
    assert (app, metodo, percorso) == ("magazzino", "GET", "/suite/commesse/101-003/giacenze")
    assert kw["utente"] == "admin@test.local"


def test_cantiere_senza_commessa(client, project, altre_app):
    r = client.get(f"/projects/{project['project']['id']}/magazzino")
    assert r.status_code == 409 and "commessa" in r.json()["detail"]


def test_app_spenta(client, commessa, monkeypatch):
    def giu(*a, **k):
        raise suite_router.suite_link.SuiteError("magazzino", 503, "Magazzino Operativo non raggiungibile")
    monkeypatch.setattr(suite_router.suite_link, "chiama", giu)
    r = client.get(f"/projects/{commessa['project_id']}/magazzino")
    assert r.status_code == 503 and "non raggiungibile" in r.json()["detail"]


def test_documenti_skytower_e_planimetria(client, commessa, altre_app):
    r = client.get(f"/projects/{commessa['project_id']}/skytower/documenti?q=pianta")
    assert r.status_code == 200 and r.json()["items"][0]["title"] == "Pianta piano terra"
    assert altre_app[0][3]["parametri"] == {"q": "pianta", "area": "PUBLISHED"}
    r = client.post("/plans/da-skytower", json={"project_id": commessa["project_id"], "revision_id": "r1", "name": "Pianta da SkyTower"})
    assert r.status_code == 201, r.text
    p = r.json()
    assert p["name"] == "Pianta da SkyTower" and p["width_px"] == 640 and p["height_px"] == 480 and p["file_url"]
    assert altre_app[1][2] == "/suite/revisioni/r1/file" and altre_app[1][3]["grezzo"] is True
    nomi = [x["name"] for x in client.get(f"/projects/{commessa['project_id']}/plans").json()]
    assert "Pianta da SkyTower" in nomi


def test_planimetria_da_skytower_solo_manager(client, commessa, users, altre_app):
    r = client.post("/plans/da-skytower", json={"project_id": commessa["project_id"], "revision_id": "r1", "name": "X"},
                    headers=users["field"]["headers"])
    assert r.status_code == 403


def test_modulo_su_skytower(client, commessa, altre_app):
    r = client.post(f"/submissions/{commessa['nc']['id']}/skytower", json={})
    assert r.status_code == 201, r.text
    assert r.json()["identifier"].endswith("RP-Z-0002")
    app, metodo, percorso, kw = altre_app[0]
    assert (app, metodo, percorso) == ("skytower", "POST", "/suite/commesse/101-003/documenti")
    dati, tipo, nome = kw["corpo_file"]
    assert nome.startswith("incampo-ispezione-") and dati.startswith(b"%PDF") and tipo == "application/pdf"
    assert kw["parametri"]["title"].startswith("NC Ispezione Cantiere A") and json.loads(kw["parametri"]["attributes"])["non_conformita"] is True
    r2 = client.post(f"/submissions/{commessa['ok']['id']}/skytower", json={"title": "Ispezione pilastro 3"})
    assert r2.status_code == 201 and altre_app[1][3]["parametri"]["title"] == "Ispezione pilastro 3"
    assert json.loads(altre_app[1][3]["parametri"]["attributes"])["non_conformita"] is False
