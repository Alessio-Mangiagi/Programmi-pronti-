# "><(((º> sabusabu <º)))><"
"""Correzioni della revisione di sicurezza del 03/11/2026 (ADR-47 e punti medi/bassi del rapporto).

Ogni test prova una falla chiusa: ticket OnlyOffice separato da quello dei download filigranati (M1), chiavi dei
metadati riservate all'API (M2), tetto al corpo delle richieste (M4), corpo delle email fuori dal log in staging
(M5), DXF con blocchi annidati fermato subito (M8), espressioni di naming rischiose rifiutate (M9), redirect
dell'IdP non seguiti (M11), codice commessa dal registro e univoco (A3), escalation solo verso membri (B1),
documentazione API e scanner finto spenti fuori da sviluppo e test (B2).
"""
from __future__ import annotations

import json
import logging
import uuid

import ezdxf
import psycopg
import pytest
from test_api_documents import as_user, des_name, upload  # noqa: F401 - fixture
from test_api_office import DOCX, _verify, document_server, office_on  # noqa: F401 - fixture

from cde_api import dxf2svg, mail
from cde_api.config import Settings


# ------------------------------------------------------------------ M1 OnlyOffice
def test_ticket_di_download_non_apre_il_file_office(client, api_app, api_world, as_user, office_on):  # noqa: F811
    urls, w = api_world
    h = as_user("des_lead")
    rev = upload(client, h, w.containers["des_arch"], des_name(ext="docx"), DOCX, title="Relazione M1").json()
    _verify(urls, api_app)
    tokens = api_app.state.services.tokens
    download = tokens.issue_download_ticket(w.users["des_lead"], uuid.UUID(rev["id"]), inline=True)
    r = client.get(f"/office/files/{rev['id']}", params={"ticket": download})
    assert r.status_code == 401, "il ticket dei PDF filigranati non deve dare l'originale"
    office = tokens.issue_office_ticket(w.users["des_lead"], uuid.UUID(rev["id"]))
    assert client.get(f"/office/files/{rev['id']}", params={"ticket": office}).status_code == 200


def test_file_office_spento_senza_configurazione(client, api_app, api_world):
    _, w = api_world
    t = api_app.state.services.tokens.issue_office_ticket(w.users["des_lead"], uuid.uuid4())
    r = client.get(f"/office/files/{uuid.uuid4()}", params={"ticket": t})
    assert r.status_code == 404 and r.json()["error"]["code"] == "office_disabled"


# ------------------------------------------------------------------ M2 metadati riservati
def test_confronti_e_verifiche_li_scrive_solo_l_api(client, api_app, api_world, as_user):  # noqa: F811
    _, w = api_world
    h = as_user("des_lead")
    rev = upload(client, h, w.containers["des_arch"], des_name(), b"%PDF-1.7\n" + uuid.uuid4().bytes * 64,
                 title="Tavola M2").json()
    falso = [{"job_id": "x", "url": "https://phishing.example/login", "precedente_code": "P01"}]
    r = client.patch(f"/documents/{rev['document_id']}", headers=h, json={"attributes": {"confronti": falso}})
    assert r.status_code == 422 and r.json()["error"]["code"] == "reserved_attributes", r.text
    # un esito scritto dall'API sopravvive a un PATCH degli altri metadati
    with psycopg.connect(api_world[0].owner) as conn:
        conn.execute("UPDATE cde.documents SET attributes = attributes || '{\"verifiche\": [{\"esito\": \"ok\"}]}'::jsonb "
                     "WHERE id = %s", [rev["document_id"]])
    r = client.patch(f"/documents/{rev['document_id']}", headers=h, json={"attributes": {"nota": "x"}})
    assert r.status_code == 200, r.text
    assert r.json()["attributes"]["verifiche"] == [{"esito": "ok"}] and r.json()["attributes"]["nota"] == "x"


# ------------------------------------------------------------------ M4 corpo delle richieste
def test_corpo_oltre_il_tetto_rifiutato_subito(client):
    grande = str(16 * 1024 ** 2 + 1)
    r = client.post("/auth/login", content=b"{}", headers={"Content-Type": "application/json", "Content-Length": grande})
    assert r.status_code == 413 and r.json()["error"]["code"] == "too_large"


# ------------------------------------------------------------------ M5 email nel log
def test_console_mailer_senza_corpo_fuori_da_sviluppo(caplog):
    m = mail.build_mailer(Settings(env="staging", mailer="console"))
    with caplog.at_level(logging.INFO, logger="cde.mail"):
        m.send("a@b.it", "Reimposta la password", "https://skytower/reset-password?token=SEGRETO")
    assert "SEGRETO" not in caplog.text and "Reimposta la password" in caplog.text
    assert m.outbox[0].body.endswith("SEGRETO"), "i test continuano a leggere il corpo da outbox"
    assert mail.build_mailer(Settings(env="test", mailer="console")).log_corpo is True


# ------------------------------------------------------------------ M8 DXF con blocchi annidati
def test_dxf_con_blocchi_annidati_fermato_subito(tmp_path, monkeypatch):
    """Tre livelli di blocchi da 30 inserimenti = 27.000 linee: con il tetto abbassato a 1.000 la conversione si
    ferma con DisegnoTroppoGrande senza scomporre tutto (il contatore lavora durante la scomposizione)."""
    monkeypatch.setattr(dxf2svg, "MAX_ENTITIES", 1_000)
    doc = ezdxf.new()
    a = doc.blocks.new("A")
    a.add_line((0, 0), (1, 0))
    for nome, figlio in (("B", "A"), ("C", "B"), ("D", "C")):
        blk = doc.blocks.new(nome)
        for i in range(30):
            blk.add_blockref(figlio, (i * 2, 0))
    doc.modelspace().add_blockref("D", (0, 0))
    src = tmp_path / "bomba.dxf"
    doc.saveas(src)
    with pytest.raises(dxf2svg.DisegnoTroppoGrande):
        dxf2svg.convert(src, tmp_path / "bomba.svg")


# ------------------------------------------------------------------ M9 espressioni di naming
def test_espressione_rischiosa_rifiutata_al_salvataggio(client, api_world, as_user):  # noqa: F811
    _, w = api_world
    h = as_user("com_admin")
    attuale = client.get(f"/projects/{w.project_id}/document-settings", headers=h).json()
    schema = attuale["naming_scheme"]
    campi = [dict(f) for f in schema["fields"]]
    numero = next(f for f in campi if f["key"] == "number")
    numero.update(kind="regex", pattern="(A+)+$", codes={}, value=None)
    r = client.put(f"/projects/{w.project_id}/document-settings", headers=h,
                   json={"naming_scheme": {**schema, "fields": campi}, "metadata_schema": attuale.get("metadata_schema")})
    assert r.status_code == 422 and r.json()["error"]["code"] == "unsafe_pattern", r.text


# ------------------------------------------------------------------ M11 redirect dell'IdP
def test_idp_che_reindirizza_non_viene_seguito(monkeypatch):
    import threading
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    from cde_api.security import oidc

    class Redirect(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(302)
            self.send_header("Location", "http://169.254.169.254/latest/meta-data/")
            self.end_headers()

        def log_message(self, *_):
            pass
    server = ThreadingHTTPServer(("127.0.0.1", 0), Redirect)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with pytest.raises(oidc.OidcError) as exc:
            oidc.fetch_json(f"http://127.0.0.1:{server.server_address[1]}/.well-known/openid-configuration")
        assert exc.value.code == "idp_error"
    finally:
        server.shutdown()


# ------------------------------------------------------------------ A3 codice commessa
def test_codice_commessa_dal_registro_e_univoco(client, api_world, as_user, tmp_path, monkeypatch):  # noqa: F811
    import suite_link

    _, w = api_world
    h = as_user("com_admin")
    registro = tmp_path / "registro.json"
    codice = "201-" + uuid.uuid4().hex[:5].upper()
    registro.write_text(json.dumps({"commesse": [{"code": codice, "nome": "Prova", "stato": "attiva"}]}), encoding="utf-8")
    monkeypatch.setattr(suite_link, "FILE_COMMESSE", registro)
    r = client.patch(f"/projects/{w.project_id}", headers=h, json={"settings": {"commessa": "999-NONCE"}})
    assert r.status_code == 422 and r.json()["error"]["code"] == "commessa_sconosciuta", r.text
    assert client.patch(f"/projects/{w.project_id}", headers=h, json={"settings": {"commessa": codice}}).status_code == 200
    # un secondo progetto attivo della stessa organizzazione non può prendere lo stesso codice (trigger 0038)
    with psycopg.connect(api_world[0].owner) as conn:
        altro = conn.execute("""INSERT INTO cde.projects (owner_organization_id, code, name, status, created_by)
                                VALUES (%s, %s, 'Doppione', 'ACTIVE', %s) RETURNING id""",
                             [w.orgs["COM"], "D" + uuid.uuid4().hex[:4].upper(), w.users["com_admin"]]).fetchone()[0]
        conn.commit()
        with pytest.raises(psycopg.errors.UniqueViolation):
            conn.execute("UPDATE cde.projects SET settings = jsonb_build_object('commessa', %s::text) WHERE id = %s",
                         [codice.lower().replace("-", "-") + " ", altro])
        conn.rollback()
        conn.execute("UPDATE cde.projects SET status = 'ARCHIVED' WHERE id = %s", [altro])
        conn.commit()


# ------------------------------------------------------------------ B1 escalation
def test_escalation_solo_verso_membri(client, api_world, as_user):  # noqa: F811
    _, w = api_world
    h = as_user("com_admin")
    corpo = {"code": "ESC_" + uuid.uuid4().hex[:6].upper(), "name": "Prova escalation",
             "definition": {"steps": [{"name": "Verifica", "assignees": [{"type": "role", "code": "PROJECT_ADMIN"}],
                                       "quorum": "ALL", "sla_hours": 24}],
                            "escalation_user_id": str(w.users["out_user"])}}
    r = client.post(f"/projects/{w.project_id}/workflow-templates", headers=h, json=corpo)
    assert r.status_code == 422 and r.json()["error"]["code"] == "escalation_not_member", r.text


# ------------------------------------------------------------------ B2 docs e scanner
def test_docs_e_scanner_finto_solo_in_sviluppo():
    from cde_api.scanner import build_scanner

    with pytest.raises(RuntimeError, match="sviluppo e test"):
        build_scanner(Settings(env="staging", scanner="eicar"))
    build_scanner(Settings(env="dev", scanner="eicar"))
