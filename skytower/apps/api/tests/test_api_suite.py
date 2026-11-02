# "><(((º> sabusabu <º)))><"
"""Rotte /suite: le altre app della suite Cosedil (InCampo, Magazzino) entrano col token di servizio,
trovano il progetto dal codice commessa, leggono i documenti, scaricano un file e ne caricano uno.
Ogni chiamata gira come un utente SkyTower (quello dell'header, o l'utente tecnico): RLS e permessi restano suoi."""
import os
import uuid

import pytest

from cde_api.tooling.demo_seed import DEMO_PASSWORD

os.environ["SUITE_TOKEN"] = "token-di-prova-skytower"
TOKEN = {"X-Suite-Token": "token-di-prova-skytower"}
COMMESSA = "101-" + uuid.uuid4().hex[:5].upper()   # univoca: il DB di test è condiviso fra i moduli
PDF = b"%PDF-1.4\n%suite\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n"


@pytest.fixture
def as_user(client, api_world):
    _, w = api_world
    tokens: dict[str, str] = {}

    def headers(user: str) -> dict:
        if user not in tokens:
            client.app.state.services.limiter.reset()
            r = client.post("/auth/login", json={"email": w.emails[user], "password": DEMO_PASSWORD})
            assert r.status_code == 200, r.text
            tokens[user] = r.json()["access_token"]
        return {"Authorization": f"Bearer {tokens[user]}"}
    return headers


@pytest.fixture
def progetto_collegato(client, api_world, as_user):
    """Il progetto demo con il codice commessa nelle impostazioni (lo mette il Project Admin)."""
    _, w = api_world
    r = client.patch(f"/projects/{w.project_id}", headers=as_user("com_admin"), json={"settings": {"commessa": COMMESSA}})
    assert r.status_code == 200, r.text
    return w


@pytest.fixture
def worker(api_app, api_world):
    """Verifica antivirus dei file in attesa (come in test_api_documents): senza, il download resta 409."""
    import psycopg
    from psycopg.rows import dict_row

    from cde_api.scanner import EicarScanner
    from cde_api.worker import verify_file

    urls, _ = api_world

    def run() -> list:
        esiti = []
        with psycopg.connect(urls.worker, row_factory=dict_row) as conn:
            pending = [r["id"] for r in conn.execute("SELECT id FROM cde.file_objects WHERE scan_status = 'PENDING'").fetchall()]
            conn.commit()
            for fid in pending:
                esiti.append(verify_file(conn, api_app.state.services.storage, EicarScanner(), fid))
        return esiti
    return run


def come(w, user="com_admin") -> dict:
    """Header della suite: token + utente del portale (che qui coincide con un utente SkyTower)."""
    return {**TOKEN, "X-Suite-Utente": w.emails[user], "X-Suite-Nome": user}


def test_token_obbligatorio(client, progetto_collegato):
    assert client.get("/suite/commesse").status_code == 403
    assert client.get("/suite/commesse", headers={"X-Suite-Token": "sbagliato"}).status_code == 403


def test_commesse_e_progetto_per_codice(client, progetto_collegato):
    w = progetto_collegato
    r = client.get("/suite/commesse", headers=come(w))
    assert r.status_code == 200, r.text
    voce = next(v for v in r.json() if v["commessa"] == COMMESSA)
    assert voce["project_id"] == str(w.project_id) and voce["url"].endswith(f"/progetti/{w.project_id}/cartelle")
    # confronto normalizzato (spazi, minuscole) e 404 per una commessa sconosciuta
    r = client.get(f"/suite/commesse/ {COMMESSA.lower()} /documenti", headers=come(w))
    assert r.status_code == 200, r.text
    assert r.json()["project"]["project_id"] == str(w.project_id)
    assert client.get("/suite/commesse/NON-ESISTE/documenti", headers=come(w)).status_code == 404


def test_utente_sconosciuto_ripiega_sull_utente_tecnico(client, progetto_collegato, monkeypatch):
    w = progetto_collegato
    settings = client.app.state.services.settings
    # senza utente tecnico: si ripiega sul platform admin, che non è membro del progetto e quindi non lo vede
    monkeypatch.setattr(settings, "suite_user_email", None)
    r = client.get("/suite/commesse", headers={**TOKEN, "X-Suite-Utente": "mrossi"})
    assert r.status_code == 200 and COMMESSA not in [v["commessa"] for v in r.json()]
    # con l'utente tecnico (membro del progetto) la commessa si trova
    monkeypatch.setattr(settings, "suite_user_email", w.emails["com_admin"])
    r = client.get("/suite/commesse", headers={**TOKEN, "X-Suite-Utente": "mrossi"})
    assert r.status_code == 200 and COMMESSA in [v["commessa"] for v in r.json()]
    # lo username senza dominio trova l'utente con quella parte locale dell'email
    locale = w.emails["com_admin"].split("@")[0]
    r = client.get(f"/suite/commesse/{COMMESSA}/documenti", headers={**TOKEN, "X-Suite-Utente": locale})
    assert r.status_code == 200


def test_carica_elenca_e_scarica(client, progetto_collegato, as_user, worker):
    w = progetto_collegato
    r = client.post(f"/suite/commesse/{COMMESSA}/documenti",
                    headers={**come(w), "Content-Type": "application/pdf", "X-Suite-Nome-File": "giacenze%20101.pdf"},
                    content=PDF,
                    params={"title": "Giacenze e mezzi", "description": "Report del Magazzino", "tipo": "RP",
                            "attributes": '{"origine": "magazzino"}'})
    assert r.status_code == 201, r.text
    d = r.json()
    assert d["state"] == "WIP" and d["revision_code"].startswith("P") and "-RP-Z-" in d["identifier"]
    assert d["url"].endswith(f"/documenti/{d['document_id']}")

    # il documento sta nella cartella "Suite Cosedil" del committente, con attributi e nota di provenienza
    doc = client.get(f"/documents/{d['document_id']}", headers=as_user("com_admin")).json()
    assert doc["title"] == "Giacenze e mezzi" and doc["attributes"]["origine"] == "magazzino"
    assert doc["attributes"]["origine_suite"] == w.emails["com_admin"]
    cont = client.get(f"/containers/{d['container_id']}", headers=as_user("com_admin")).json()
    assert cont["name"] == "Suite Cosedil"

    # in elenco come WIP (non pubblicato), con nome file e link
    r = client.get(f"/suite/commesse/{COMMESSA}/documenti", headers=come(w), params={"area": "WIP", "q": "giacenze"})
    assert r.status_code == 200, r.text
    voce = next(v for v in r.json()["items"] if v["id"] == d["document_id"])
    assert voce["filename"] == d["filename"] and voce["content_type"] == "application/pdf" and voce["state"] == "WIP"
    pubblicati = client.get(f"/suite/commesse/{COMMESSA}/documenti", headers=come(w)).json()["items"]
    assert d["document_id"] not in [v["id"] for v in pubblicati]

    # download: prima della verifica antivirus è 409, dopo arrivano i byte
    assert client.get(f"/suite/revisioni/{d['revision_id']}/file", headers=come(w)).status_code == 409
    worker()
    r = client.get(f"/suite/revisioni/{d['revision_id']}/file", headers=come(w))
    assert r.status_code == 200, r.text
    assert r.content == PDF and r.headers["content-type"].startswith("application/pdf")
    assert r.headers["x-revision-code"] == d["revision_code"]

    # un secondo invio prende il progressivo successivo, mai lo stesso identificativo
    r2 = client.post(f"/suite/commesse/{COMMESSA}/documenti", headers={**come(w), "Content-Type": "application/pdf"},
                     content=PDF, params={"title": "Giacenze 2", "filename": "giacenze-102.pdf"})
    assert r2.status_code == 201, r2.text
    assert r2.json()["identifier"] != d["identifier"]


def test_file_vuoto_e_attributi_non_validi(client, progetto_collegato):
    w = progetto_collegato
    r = client.post(f"/suite/commesse/{COMMESSA}/documenti", headers={**come(w), "Content-Type": "application/pdf"},
                    content=b"", params={"title": "Vuoto", "filename": "x.pdf"})
    assert r.status_code == 422
    r = client.post(f"/suite/commesse/{COMMESSA}/documenti", headers={**come(w), "Content-Type": "application/pdf"},
                    content=b"%PDF", params={"title": "X", "attributes": "[1]", "filename": "x.pdf"})
    assert r.status_code == 422 and "attributes" in r.text
