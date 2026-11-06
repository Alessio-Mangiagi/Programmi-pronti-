# "><(((º> sabusabu <º)))><"
"""Rotte /suite: le altre app della suite Cosedil (InCampo, Magazzino) entrano col token di servizio,
trovano il progetto dal codice commessa, leggono i documenti, scaricano un file e ne caricano uno.
Ogni chiamata gira come un utente SkyTower (quello dell'header, o l'utente tecnico): RLS e permessi restano suoi."""
import hashlib
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
    # senza utente tecnico: nessuno a cui attribuire la chiamata → 403 (prima si ripiegava sul platform admin, ADR-47)
    monkeypatch.setattr(settings, "suite_user_email", None)
    r = client.get("/suite/commesse", headers={**TOKEN, "X-Suite-Utente": "mrossi"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "suite_user", r.text
    # con l'utente tecnico (membro del progetto) la commessa si trova
    monkeypatch.setattr(settings, "suite_user_email", w.emails["com_admin"])
    r = client.get("/suite/commesse", headers={**TOKEN, "X-Suite-Utente": "mrossi"})
    assert r.status_code == 200 and COMMESSA in [v["commessa"] for v in r.json()]
    # lo username senza dominio vale come <username>@CDE_SUITE_EMAIL_DOMINIO: "com.admin" non è com.admin@com.example,
    # quindi si usa l'utente tecnico (che qui vede il progetto)
    locale = w.emails["com_admin"].split("@")[0]
    r = client.get(f"/suite/commesse/{COMMESSA}/documenti", headers={**TOKEN, "X-Suite-Utente": locale})
    assert r.status_code == 200


def test_token_non_impersona_altre_organizzazioni_ne_platform_admin(client, api_world, progetto_collegato, monkeypatch):
    """Con il token della suite non si agisce a nome di utenti di altri tenant né del platform admin (A1)."""
    import psycopg
    urls, w = api_world
    settings = client.app.state.services.settings
    monkeypatch.setattr(settings, "suite_user_email", None)
    for chi in ("des_lead", "platform", "out_user"):
        r = client.get("/suite/da-fare", headers={**TOKEN, "X-Suite-Email": w.emails[chi]})
        assert r.status_code == 403, (chi, r.text)
    # la chiamata buona lascia la traccia dell'app e dell'utente dichiarato
    r = client.get("/suite/da-fare", headers={**TOKEN, "X-Suite-Email": w.emails["com_admin"], "X-Suite-App": "incampo"})
    assert r.status_code == 200, r.text
    with psycopg.connect(urls.owner) as conn:
        ev = conn.execute("""SELECT details FROM cde.security_events WHERE event_type = 'SUITE_CALL'
                             ORDER BY occurred_at DESC LIMIT 1""").fetchone()[0]
    assert ev["app"] == "incampo" and ev["utente"] == w.emails["com_admin"] and ev["path"] == "/suite/da-fare"


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



# ---------------------------------------------------------------------
# Registro commesse, "da fare", Confronto e Verifica (CONTRATTI.md §3-4, §7)
# ---------------------------------------------------------------------
def test_registro_commesse_per_il_web(client, as_user, tmp_path, monkeypatch):
    from cde_api.modules import suite
    monkeypatch.setattr(suite.suite_link, "FILE_COMMESSE", tmp_path / "commesse.json")
    assert client.get("/suite/registro").status_code == 401                       # JWT, non token
    assert client.get("/suite/registro", headers=as_user("des_lead")).json() == {"commesse": []}
    suite.suite_link.salva_commesse([{"code": "101-003", "nome": "Porto di Augusta"}, {"code": "C-1", "stato": "chiusa"}])
    r = client.get("/suite/registro", headers=as_user("des_lead"))
    assert [c["code"] for c in r.json()["commesse"]] == ["101-003"]
    assert len(client.get("/suite/registro", headers=as_user("des_lead"), params={"solo_attive": "false"}).json()["commesse"]) == 2


def test_da_fare_notifiche_e_compiti(client, api_world, progetto_collegato):
    import psycopg
    urls, w = api_world
    with psycopg.connect(urls.owner) as conn:
        conn.execute("""INSERT INTO cde.notifications (user_id, project_id, kind, title, body, link)
                        VALUES (%s, %s, 'suite', 'Prova da fare', 'corpo della notifica', '/documenti/x')""",
                     [w.users["com_admin"], w.project_id])
        conn.commit()
    r = client.get("/suite/da-fare", headers=come(w))
    assert r.status_code == 200, r.text
    voce = next(v for v in r.json()["voci"] if v["titolo"] == "Prova da fare")
    assert voce["tipo"] == "avviso" and voce["url"].endswith("/documenti/x") and voce["testo"] == "corpo della notifica"
    assert voce["priorita"] == 3 and voce["data"]
    # l'email del portale (X-Suite-Email) basta a trovare l'utente
    r = client.get("/suite/da-fare", headers={**TOKEN, "X-Suite-Email": w.emails["com_admin"], "X-Suite-Utente": "sconosciuto"})
    assert any(v["titolo"] == "Prova da fare" for v in r.json()["voci"])
    assert client.get("/suite/da-fare").status_code == 403


def _carica_revisione(client, headers, container_id, filename, data, expected=None):
    """Upload completo (initiate → parti → complete) come in test_api_documents."""
    import base64

    import httpx
    body = {"container_id": str(container_id), "filename": filename, "size_bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(), "content_type": "application/pdf", "title": "Tavola"}
    if expected:
        body["expected_revision"] = expected
    r = client.post("/uploads/initiate", headers=headers, json=body)
    assert r.status_code == 201, r.text
    up = r.json()
    size = up["part_size"]
    chunks = {i + 1: data[i * size:(i + 1) * size] for i in range(up["part_count"])}
    req = [{"part_number": n, "checksum_sha256": base64.b64encode(hashlib.sha256(c).digest()).decode()} for n, c in chunks.items()]
    r = client.post(f"/uploads/{up['upload_id']}/parts", headers=headers, json={"parts": req})
    assert r.status_code == 200, r.text
    with httpx.Client() as s3:
        for p in r.json()["parts"]:
            assert s3.put(p["url"], content=chunks[p["part_number"]], headers=p["headers"]).status_code == 200
    r = client.post(f"/uploads/{up['upload_id']}/complete", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture
def app_vicine_finte(monkeypatch):
    """Confronto Documenti e Verifica Requisiti finti: registrano le chiamate e rispondono come le app vere."""
    from cde_api.modules import suite
    chiamate = []

    def chiama(app, metodo, percorso, **kw):
        chiamate.append((app, metodo, percorso, kw))
        if app == "confronto" and percorso == "/api/compare":
            return {"job_id": "abc123"}
        if app == "verifica" and percorso == "/documenti" and metodo == "POST":
            return {"documenti": [{"id": "d1", "stato": "in_coda", "nomeFile": kw["file"][1]}], "inCoda": 1}
        if app == "verifica" and percorso == "/documenti/d1":
            return {"id": "d1", "stato": "pronto"}
        if app == "verifica" and percorso == "/requisiti":
            return {"set": [{"id": "s1", "nome": "POS", "descrizione": "Piano operativo", "requisiti": [1, 2, 3]}]}
        if app == "verifica" and percorso == "/verifiche":
            assert kw["dati"] == {"setId": "s1", "documentoIds": ["d1"]}
            return {"verifiche": [{"id": "v1", "nomeSet": "POS", "esito": "ko",
                                   "risultati": [{"esito": "ko"}, {"esito": "ok"}, {"esito": "dubbio"}]}], "scartati": []}
        raise AssertionError((app, metodo, percorso))
    monkeypatch.setattr(suite.suite_link, "chiama", chiama)
    monkeypatch.setattr(suite.time, "sleep", lambda s: None)
    return chiamate


def test_confronta_e_verifica_revisione(client, api_world, as_user, worker, app_vicine_finte):
    _, w = api_world
    h = as_user("des_lead")
    nome = f"PRJ01-DES-ZZ-01-DR-A-{uuid.uuid4().int % 9000 + 1000}.pdf"
    r1 = _carica_revisione(client, h, w.containers["des_arch"], nome, PDF)
    r2 = _carica_revisione(client, h, w.containers["des_arch"], nome, PDF + b"\n% seconda", expected=r1["revision_code"])
    assert r2["document_id"] == r1["document_id"] and r2["sequence"] == 2
    doc_id = r1["document_id"]

    # prima dell'antivirus niente byte; la prima revisione non ha una precedente
    assert client.post(f"/revisions/{r2['id']}/confronta", headers=h).status_code == 409
    worker()
    assert client.post(f"/revisions/{r1['id']}/confronta", headers=h).json()["error"]["code"] == "prima_revisione"

    r = client.post(f"/revisions/{r2['id']}/confronta", headers=h)
    assert r.status_code == 201, r.text
    d = r.json()
    assert d["job_id"] == "abc123" and d["url"].endswith("/?job=abc123") and d["precedente"] == r1["id"]
    kw = app_vicine_finte[0][3]
    corpo, ctype, _ = kw["corpo_file"]
    assert ctype.startswith("multipart/form-data; boundary=") and kw["email"] == w.emails["des_lead"]
    assert b'name="pdf1"' in corpo and b'name="pdf2"' in corpo and corpo.count(nome.encode()) == 2 and b"% seconda" in corpo
    doc = client.get(f"/documents/{doc_id}", headers=h).json()
    assert [c["job_id"] for c in doc["attributes"]["confronti"]] == ["abc123"]
    assert doc["revisions"][0]["sequence"] == 2

    # verifica requisiti: upload, attesa "pronto", verifica, esito nei metadati
    assert client.get("/suite/requisiti/set", headers=h).json()["set"] == [{"id": "s1", "nome": "POS", "descrizione": "Piano operativo", "requisiti": 3}]
    r = client.post(f"/revisions/{r2['id']}/verifica", headers=h, json={"set_id": "s1"})
    assert r.status_code == 201, r.text
    v = r.json()
    assert v["esito"] == "ko" and v["ko"] == 1 and v["dubbi"] == 1 and v["nome_set"] == "POS" and v["verifica_id"] == "v1"
    percorsi = [(a, m, p) for a, m, p, _ in app_vicine_finte if a == "verifica"]
    assert percorsi[-3:] == [("verifica", "POST", "/documenti"), ("verifica", "GET", "/documenti/d1"), ("verifica", "POST", "/verifiche")]
    doc = client.get(f"/documents/{doc_id}", headers=h).json()
    assert doc["attributes"]["verifiche"][0]["set_id"] == "s1" and doc["attributes"]["confronti"]   # i confronti restano
    assert client.post(f"/revisions/{r2['id']}/verifica", headers=h, json={"set_id": ""}).status_code == 422


def test_app_vicina_spenta(client, api_world, as_user, worker, monkeypatch):
    from cde_api.modules import suite
    _, w = api_world
    h = as_user("des_lead")
    nome = f"PRJ01-DES-ZZ-01-DR-A-{uuid.uuid4().int % 9000 + 1000}.pdf"
    r1 = _carica_revisione(client, h, w.containers["des_arch"], nome, PDF)
    worker()

    def giu(*a, **k):
        raise suite.suite_link.SuiteError("verifica", 503, "Verifica Requisiti non raggiungibile")
    monkeypatch.setattr(suite.suite_link, "chiama", giu)
    r = client.post(f"/revisions/{r1['id']}/verifica", headers=h, json={"set_id": "s1"})
    assert r.status_code == 503 and "non raggiungibile" in r.json()["error"]["message"]
    assert client.get("/suite/requisiti/set", headers=h).status_code == 503


def test_da_fare_scadenze_in_cima(client, api_world, progetto_collegato):
    """G35: scadenze superate ed escalation sono compiti (priorità 1), non avvisi, e stanno in cima al da-fare."""
    import psycopg
    urls, w = api_world
    with psycopg.connect(urls.owner) as conn:
        conn.execute("""INSERT INTO cde.notifications (user_id, project_id, kind, title, body, link)
                        VALUES (%s, %s, 'TASK_ESCALATED', 'Escalation: PRJ-X', 'in ritardo di 3 giorni', '/compiti')""",
                     [w.users["com_admin"], w.project_id])
        conn.commit()
    voci = client.get("/suite/da-fare", headers=come(w)).json()["voci"]
    voce = next(v for v in voci if v["titolo"] == "Escalation: PRJ-X")
    assert voce["tipo"] == "task" and voce["priorita"] == 1
    assert [v["priorita"] for v in voci] == sorted(v["priorita"] for v in voci)


def test_da_fare_chiarimenti_e_modifiche(client, as_user, progetto_collegato):
    """ADR-51 nel "da fare" del portale: il compito di chiarimento si legge come "Chiarimento: …" con chi lo chiede e
    la domanda; il compito fermo in attesa di risposta scende a priorità 3; il giro riaperto per una richiesta di
    modifiche si legge come "Modifiche richieste: …" con il commento. Ogni voce apre il suo compito."""
    from test_workflow_grafo import avvia, decisione, nodo, salva, utente
    from test_workflow_ritorno import chiedi, completa, rimanda, rispondi

    w = progetto_collegato
    im, dl = as_user("com_im"), as_user("com_dl")
    nodes = [nodo("s", "start", "Avvio", 0, 0),
             decisione("a", "Verifica tecnica", 1, 0, [utente(w, "com_im")]),
             decisione("b", "Parere DL", 2, 0, [utente(w, "com_dl")]),
             nodo("ok", "end", "Concluso", 3, 0, result="OK"), nodo("ko", "end", "Fallito", 3, 1, result="KO")]
    edges = [{"from": "s", "to": "a"}]
    for x, y in (("a", "b"), ("b", "ok")):
        edges += [{"from": x, "outcome": "OK", "to": y}, {"from": x, "outcome": "NO", "to": "ko"}]
    titolo = "Ordine calcestruzzo " + uuid.uuid4().hex[:6]
    g = avvia(client, as_user("com_admin"), w, salva(client, as_user("com_admin"), w, nodes, edges), title=titolo)
    completa(client, im, g["id"], "a")

    def voce(chi, titolo_voce):
        voci = client.get("/suite/da-fare", headers=come(w, chi)).json()["voci"]
        return next(v for v in voci if v["titolo"] == titolo_voce)

    chiedi(client, dl, g["id"], "b", "a", "Quale classe di resistenza?")
    v = voce("com_im", f"Chiarimento: {titolo}")
    assert "Parere DL" in v["testo"] and "«Quale classe di resistenza?»" in v["testo"] and v["priorita"] == 2
    assert f"instance={g['id']}" in v["url"] and "task=" in v["url"] and v["tipo"] == "documento"
    v = voce("com_dl", f"Parere DL: {titolo}")
    assert "in attesa di chiarimento" in v["testo"] and v["priorita"] == 3

    rispondi(client, im, g["id"], "b", "C30/37")
    assert voce("com_dl", f"Parere DL: {titolo}")["priorita"] == 2
    rimanda(client, dl, g["id"], "b", "a", "Rifare la verifica con la C30/37")
    v = voce("com_im", f"Modifiche richieste: {titolo}")
    assert "Verifica tecnica" in v["testo"] and "Parere DL" in v["testo"] and "«Rifare la verifica con la C30/37»" in v["testo"]
