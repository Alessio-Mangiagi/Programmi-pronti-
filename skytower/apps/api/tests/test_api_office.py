# "><(((º> sabusabu <º)))><"
"""Modifica in piattaforma con OnlyOffice (ADR-37): la sessione si apre solo sull'ultima WIP con il permesso WRITE,
con la configurazione firmata dal segreto condiviso; il Document Server scarica il file con il ticket; alla
callback di salvataggio (firmata) il file salvato diventa la WIP successiva, dell'ultimo utente che ha modificato.
Il Document Server qui è finto: un server HTTP locale che serve il file "salvato"."""
from __future__ import annotations

import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

import jwt
import psycopg
import pytest
from psycopg.rows import dict_row
from test_api_documents import as_user, des_name, upload  # noqa: F401 - fixture

from cde_api.scanner import EicarScanner
from cde_api.worker import verify_file

SECRET = "segreto-condiviso-di-prova-0123456789"  # noqa: S105 - solo test
DOCX = b"PK\x03\x04" + os.urandom(4096)
SAVED = b"PK\x03\x04" + os.urandom(4096)


@pytest.fixture
def document_server():
    """Server HTTP che fa da Document Server: serve il file salvato all'indirizzo /cache/salvato.docx."""
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            self.send_response(200)
            self.send_header("Content-Length", str(len(SAVED)))
            self.end_headers()
            self.wfile.write(SAVED)

        def log_message(self, *_):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()


@pytest.fixture
def office_on(api_app, document_server, monkeypatch):
    s = api_app.state.services.settings
    monkeypatch.setattr(s, "onlyoffice_url", document_server)
    monkeypatch.setattr(s, "onlyoffice_jwt_secret", SECRET)
    api_app.state.services.storage.ensure_bucket()
    return document_server


def _verify(urls, api_app):
    with psycopg.connect(urls.worker, row_factory=dict_row) as conn:
        pending = [r["id"] for r in conn.execute("SELECT id FROM cde.file_objects WHERE scan_status = 'PENDING'").fetchall()]
        conn.commit()
        for fid in pending:
            verify_file(conn, api_app.state.services.storage, EicarScanner(), fid)


def _callback(client, rev_id, body: dict, secret=SECRET, header=False):
    token = jwt.encode({"payload": body} if header else body, secret, algorithm="HS256")
    if header:
        return client.post(f"/office/callback/{rev_id}", json=body, headers={"Authorization": f"Bearer {token}"})
    return client.post(f"/office/callback/{rev_id}", json={**body, "token": token})


def test_spenta_senza_configurazione(client, api_world, as_user):  # noqa: F811
    _, w = api_world
    h = as_user("des_lead")
    assert client.get("/office/config", headers=h).json() == {"enabled": False, "document_server_url": None}


def test_sessione_e_salvataggio(client, api_app, api_world, as_user, office_on):  # noqa: F811
    urls, w = api_world
    h = as_user("des_lead")
    assert client.get("/office/config", headers=h).json() == {"enabled": True, "document_server_url": office_on}
    rev = upload(client, h, w.containers["des_arch"], des_name(ext="docx"), DOCX, title="Relazione").json()
    _verify(urls, api_app)

    r = client.post(f"/revisions/{rev['id']}/office-session", headers=h)
    assert r.status_code == 200, r.text
    config = r.json()["config"]
    signed = jwt.decode(config["token"], SECRET, algorithms=["HS256"])
    assert signed["document"]["key"] == rev["id"] and config["documentType"] == "word"
    assert config["editorConfig"]["callbackUrl"].endswith(f"/office/callback/{rev['id']}")
    assert config["editorConfig"]["user"]["name"]
    # fuori dalle modifiche richieste di un workflow: niente pulsante "Salva", si salva alla chiusura (ADR-37)
    assert r.json()["in_modifica"] is False and config["editorConfig"]["customization"]["forcesave"] is False

    # il Document Server scarica il file con il ticket della sessione
    file_url = urlsplit(config["document"]["url"])
    assert file_url.path.endswith(f"/office/files/{rev['id']}")
    got = client.get(f"/office/files/{rev['id']}", params={"ticket": parse_qs(file_url.query)["ticket"][0]})
    assert got.status_code == 200 and got.content == DOCX
    assert client.get(f"/office/files/{rev['id']}", params={"ticket": "x"}).status_code == 401

    # altre organizzazioni: la WIP non si vede
    assert client.post(f"/revisions/{rev['id']}/office-session", headers=as_user("sub1_user")).status_code in (403, 404)

    # callback: firma obbligatoria e giusta; stato 1 (in modifica) solo confermato
    user = config["editorConfig"]["user"]["id"]
    body = {"key": rev["id"], "status": 1, "users": [user]}
    assert client.post(f"/office/callback/{rev['id']}", json=body).status_code == 401
    assert _callback(client, rev["id"], body, secret="altro-segreto-0123456789-abcdef").status_code == 401  # noqa: S106
    assert _callback(client, rev["id"], body).json() == {"error": 0}
    # file salvato su un indirizzo diverso dal Document Server: rifiutato (SSRF)
    bad = {"key": rev["id"], "status": 2, "users": [user], "url": "http://169.254.169.254/latest/meta-data"}
    assert _callback(client, rev["id"], bad).json() == {"error": 1}

    saved = {"key": rev["id"], "status": 2, "users": [user], "url": f"{office_on}/cache/salvato.docx"}
    assert _callback(client, rev["id"], saved, header=True).json() == {"error": 0}
    doc = client.get(f"/documents/{rev['document_id']}", headers=h).json()
    assert doc["current_revision"] == "P01.02"
    latest = next(x for x in doc["revisions"] if x["revision_code"] == "P01.02")
    assert "OnlyOffice" in latest["comment"] and "P01.01" in latest["comment"]
    assert latest["created_by_name"] == config["editorConfig"]["user"]["name"]
    _verify(urls, api_app)
    data = client.get(f"/revisions/{latest['id']}/download", headers=h).json()
    assert data["filename"].endswith(".docx")

    # callback ripetuta: nessuna revisione doppia
    assert _callback(client, rev["id"], saved).json() == {"error": 0}
    assert client.get(f"/documents/{rev['document_id']}", headers=h).json()["current_revision"] == "P01.02"
    # la revisione vecchia non si modifica più
    assert client.post(f"/revisions/{rev['id']}/office-session", headers=h).status_code == 409


def test_solo_word_excel_powerpoint(client, api_app, api_world, as_user, office_on):  # noqa: F811
    urls, w = api_world
    h = as_user("des_lead")
    rev = upload(client, h, w.containers["des_arch"], des_name(), b"%PDF-1.7\n" + os.urandom(512), title="Tavola").json()
    _verify(urls, api_app)
    assert client.post(f"/revisions/{rev['id']}/office-session", headers=h).status_code == 415


def test_modifiche_richieste_con_onlyoffice(client, api_app, api_world, as_user, office_on):  # noqa: F811
    """ADR-51 con ADR-37: durante una richiesta di modifiche il documento resta bloccato, ma chi ha il compito riaperto
    lo modifica in OnlyOffice partendo dalla revisione condivisa su cui sta il workflow; "Salva" (callback di stato 6,
    forcesave attivo solo qui) crea subito la WIP successiva, che il workflow prende al completamento del compito."""
    from test_api_states import transition
    from test_workflow_grafo import attivi, decisione, grafo, nodo, salva, utente
    from test_workflow_ritorno import compito, completa, rimanda

    urls, w = api_world
    admin, lead, des, dl = as_user("com_admin"), as_user("des_lead"), as_user("des_designer"), as_user("com_dl")
    rev = upload(client, lead, w.containers["des_arch"], des_name(ext="docx"), DOCX, title="Relazione").json()
    _verify(urls, api_app)
    shared = transition(client, lead, rev["id"], "SHARED", "S4").json()
    # fuori da un workflow una revisione condivisa non si modifica (ADR-37: solo l'ultima WIP)
    assert client.post(f"/revisions/{shared['id']}/office-session", headers=lead).status_code == 409

    tpl = salva(client, admin, w, [
        nodo("s", "start", "Avvio", 0, 0),
        decisione("dl", "Parere DL", 1, 0, [utente(w, "com_dl")]),
        nodo("ok", "end", "Approvato", 2, 0, result="OK"), nodo("ko", "end", "Rifiutato", 2, 1, result="KO")],
        [{"from": "s", "to": "dl"}, {"from": "dl", "outcome": "OK", "to": "ok"}, {"from": "dl", "outcome": "NO", "to": "ko"}],
        subject="DOCUMENT", on_completed={"to_state": "PUBLISHED", "suitability": "A1"})
    inst = client.post(f"/revisions/{shared['id']}/workflows", headers=lead, json={"template_id": tpl["id"]}).json()
    # workflow in corso: bloccato per tutti
    assert client.post(f"/revisions/{shared['id']}/office-session", headers=lead).status_code == 423

    rimanda(client, dl, inst["id"], "dl", "ORIGINATOR", "Aggiornare il capitolo 3")
    # solo chi ha il compito riaperto entra nell'editor
    assert client.post(f"/revisions/{shared['id']}/office-session", headers=des).status_code == 423
    t = compito(client, lead, inst["id"], "s")
    assert t["filename"].endswith(".docx") and t["revision_id"] == shared["id"] and t["new_revision"] is None
    r = client.post(f"/revisions/{shared['id']}/office-session", headers=lead)
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["in_modifica"] is True and s["config"]["editorConfig"]["customization"]["forcesave"] is True

    # "Salva" nell'editor: la WIP successiva nasce subito e il compito la vede
    user = s["config"]["editorConfig"]["user"]["id"]
    saved = {"key": shared["id"], "status": 6, "users": [user], "url": f"{office_on}/cache/salvato.docx"}
    assert _callback(client, shared["id"], saved).json() == {"error": 0}
    nuova = compito(client, lead, inst["id"], "s")["new_revision"]
    assert nuova["revision_code"] == "P02.01" and nuova["state"] == "WIP"
    _verify(urls, api_app)
    completa(client, lead, inst["id"], "s", "FATTO")

    # il workflow prosegue sulla revisione nuova, condivisa; il blocco torna per tutti, anche per chi ha modificato
    g = grafo(client, dl, inst["id"])
    assert attivi(g) == {"dl"} and g["document"]["revision_code"] == "P02"
    assert client.post(f"/revisions/{g['document']['revision_id']}/office-session", headers=lead).status_code == 423
