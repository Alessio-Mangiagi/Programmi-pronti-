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
