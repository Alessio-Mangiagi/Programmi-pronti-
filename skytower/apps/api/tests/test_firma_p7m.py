# "><(((º> sabusabu <º)))><"
"""PDF firmati digitalmente in busta .p7m (ADR-55, migrazione 0044).

La revisione conserva la busta originale; il worker la apre con il motore comune (shared/firma) e mette il
documento contenuto nel derivato P7M con il rapporto della firma. Qui il motore è quasi sempre finto (monkeypatch
di cde_api.firma.apri): si prova il flusso di SkyTower. L'ultimo test usa il motore vero con l'ente certificatore
di prova di shared/firma/test_firma.py ed è saltato se shared/firma/.venv manca (CI).
"""
from __future__ import annotations

import io
import os
import subprocess
from pathlib import Path

import httpx
import psycopg
import pytest
from fpdf import FPDF
from iso19650 import split_extension
from psycopg.rows import dict_row
from pypdf import PdfReader
from test_api_documents import as_user, upload  # noqa: F401 - fixture riusata

from cde_api import firma as firma_mod
from cde_api.scanner import EicarScanner
from cde_api.worker import make_p7m_derivatives, verify_file

MOTORE = Path(__file__).resolve().parents[4] / "shared" / "firma"
PY_MOTORE = MOTORE / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
BUSTA = b"\x30\x82\x01\x00\x06\x09\x2a\x86\x48\x86\xf7\x0d\x01\x07\x02" + os.urandom(512)   # finta: la apre il finto


def pdf_testo(testo: str = "Capitolato speciale firmato digitalmente") -> bytes:
    pdf = FPDF()
    pdf.set_font("Helvetica", size=14)
    pdf.add_page()
    pdf.text(20, 20, testo)
    return bytes(pdf.output())


PDF = pdf_testo()
_numero = iter(range(int.from_bytes(os.urandom(2)) * 10 + 30000, 10 ** 6))


def nome(ext="pdf.p7m") -> str:
    return f"PRJ01-DES-ZZ-01-DR-A-{next(_numero):06d}.{ext}"


def rapporto(esito="valida", **altro) -> dict:
    return {"firmato": True, "esito": esito, "livelli": 1, "nome_contenuto": "x.pdf",
            "riepilogo": f"Firma {esito}: Mario Rossi (Ente di Prova S.p.A.), 06/11/2026",
            "firme": [{"firmatario": "Mario Rossi", "codice_fiscale": "RSSMRA80A01H501U",
                       "ente_certificatore": "Ente di Prova S.p.A.", "tipo": "firma digitale", "esito": esito,
                       "motivi": [], "livello": 1, "marca_temporale": None}], **altro}


@pytest.fixture
def motore_finto(monkeypatch):
    """cde_api.firma.apri finto: dà PDF e un rapporto; ``stato["errore"]`` per simulare motore assente o busta rotta."""
    stato = {"chiamate": [], "errore": None, "esito": "valida"}

    def apri(dati, filename, *, rete=True, timeout=180):
        stato["chiamate"].append({"filename": filename, "rete": rete, "dati": dati})
        if stato["errore"]:
            raise stato["errore"]
        return PDF, firma_mod.nome_contenuto(filename), rapporto(stato["esito"], nome_contenuto=firma_mod.nome_contenuto(filename))
    monkeypatch.setattr(firma_mod, "apri", apri)
    return stato


@pytest.fixture
def lavora(api_app, api_world):
    """Il worker con l'apertura delle buste attiva e la rete spenta (come CDE_FIRMA_RETE=false)."""
    urls, _ = api_world

    def run():
        with psycopg.connect(urls.worker, row_factory=dict_row) as conn:
            pending = [r["id"] for r in conn.execute("SELECT id FROM cde.file_objects WHERE scan_status = 'PENDING'")]
            conn.commit()
            for fid in pending:
                verify_file(conn, api_app.state.services.storage, EicarScanner(), fid,
                            firma={"rete": False, "max_bytes": 50 * 1024 ** 2})
    return run


def documento(client, h, rev):
    return client.get(f"/documents/{rev['document_id']}", headers=h).json()


# ---------------------------------------------------------------------
# Naming
# ---------------------------------------------------------------------
def test_doppia_estensione_nel_naming(client, api_world, as_user):  # noqa: F811
    _, w = api_world
    assert split_extension("A-B-0001.pdf.p7m") == ("A-B-0001", "pdf.p7m")
    assert split_extension("A-B-0001.PDF.P7M.p7m") == ("A-B-0001", "pdf.p7m.p7m")
    assert split_extension("A-B-0001.p7m") == ("A-B-0001", "p7m")
    assert split_extension("A-B-0001.pdf") == ("A-B-0001", "pdf")
    n = nome()
    r = client.post(f"/projects/{w.project_id}/naming/validate", headers=as_user("des_lead"), json={"name": n}).json()
    assert r["valid"] and r["identifier"] == n.removesuffix(".pdf.p7m") and r["extension"] == "pdf.p7m"


# ---------------------------------------------------------------------
# Caricamento, apertura, visualizzatore, download, ricerca
# ---------------------------------------------------------------------
def test_busta_aperta_verificata_e_letta(client, api_world, as_user, motore_finto, lavora):  # noqa: F811
    _, w = api_world
    h = as_user("des_lead")
    n = nome()
    rev = upload(client, h, w.containers["des_arch"], n, BUSTA, title="Capitolato firmato").json()
    assert rev["original_filename"] == n and rev["firma_stato"] is None          # il worker non è ancora passato
    lavora()
    assert motore_finto["chiamate"][-1]["filename"] == n and motore_finto["chiamate"][-1]["rete"] is False

    r = documento(client, h, rev)["revisions"][0]
    assert r["firma_stato"] == "READY" and r["firma"]["esito"] == "valida"
    assert r["firma"]["firme"][0]["firmatario"] == "Mario Rossi" and r["firma"]["verificato_il"]

    # visualizzatore: il PDF contenuto, con il rapporto della firma per il badge
    v = client.get(f"/revisions/{rev['id']}/download", headers=h, params={"disposition": "inline"}).json()
    assert v["content_type"] == "application/pdf" and v["filename"] == n.removesuffix(".p7m")
    assert httpx.get(v["url"]).content == PDF
    assert v["firma"]["stato"] == "READY" and v["firma"]["rapporto"]["esito"] == "valida"
    assert v["firma"]["originale"] == n

    # allegato: la busta originale, integra
    a = client.get(f"/revisions/{rev['id']}/download", headers=h).json()
    assert a["filename"] == n and httpx.get(a["url"]).content == BUSTA

    # ricerca nel contenuto: il testo viene dal PDF dentro la busta
    q = client.get(f"/projects/{w.project_id}/documents", headers=h,
                   params={"q": "Capitolato speciale", "content": "true"}).json()["items"]
    assert rev["document_id"] in [d["id"] for d in q]


def test_nuova_revisione_firmata_dello_stesso_documento(client, api_world, as_user, motore_finto, lavora):  # noqa: F811
    _, w = api_world
    h = as_user("des_lead")
    n = nome("pdf")
    prima = upload(client, h, w.containers["des_arch"], n, PDF, title="Relazione").json()
    lavora()
    firmata = upload(client, h, w.containers["des_arch"], n + ".p7m", BUSTA, expected=prima["revision_code"]).json()
    assert firmata["document_id"] == prima["document_id"] and firmata["revision_code"] == "P01.02"
    r = client.post(f"/documents/{prima['document_id']}/revisions", headers=h, json={
        "container_id": str(w.containers["des_arch"]), "filename": n + ".p7m", "size_bytes": len(BUSTA),
        "sha256": "0" * 64, "content_type": "application/pkcs7-mime", "expected_revision": "P01.02"})
    assert r.status_code == 201, r.text                      # "X.pdf.p7m" ha l'identificativo di X.pdf


def test_motore_assente_e_busta_rotta_non_bloccano(client, api_world, as_user, motore_finto, lavora, monkeypatch):  # noqa: F811
    urls, w = api_world
    h = as_user("des_lead")
    motore_finto["errore"] = firma_mod.FirmaNonInstallata("Componente firma digitale non installato")
    rev = upload(client, h, w.containers["des_arch"], nome(), BUSTA).json()
    lavora()
    r = documento(client, h, rev)["revisions"][0]
    assert r["scan_status"] == "CLEAN" and r["firma_stato"] == "FAILED"
    assert r["firma_dettaglio"].startswith("FirmaNonInstallata")
    v = client.get(f"/revisions/{rev['id']}/download", headers=h, params={"disposition": "inline"})
    assert v.status_code == 200
    v = v.json()
    assert v["content_type"] == "application/pkcs7-mime" and v["firma"]["stato"] == "FAILED"
    assert "non installato" in v["firma"]["dettaglio"] and httpx.get(v["url"]).content == BUSTA

    # motore installato dopo: il giro periodico rimette in coda e apre la busta
    motore_finto["errore"] = None
    with psycopg.connect(urls.worker, row_factory=dict_row) as conn:
        assert conn.execute("SELECT cde.derivatives_retry_p7m_motore() AS n").fetchone()["n"] >= 1
        conn.commit()
        make_p7m_derivatives(conn, client.app.state.services.storage, limit=50, rete=False)
    assert documento(client, h, rev)["revisions"][0]["firma_stato"] == "READY"

    # busta rotta: FAILED con esito "non valida", il caricamento resta e il .p7m si scarica
    motore_finto["errore"] = firma_mod.BustaIllegibile("Busta firmata illeggibile: dati troncati")
    rotta = upload(client, h, w.containers["des_arch"], nome(), BUSTA[:40]).json()
    lavora()
    r = documento(client, h, rotta)["revisions"][0]
    assert r["firma_stato"] == "FAILED" and r["firma"]["esito"] == "non valida"
    assert "troncati" in r["firma"]["riepilogo"]
    # confronto, verifica e /suite leggono il contenuto: finché la busta non si apre è 409, mai 500
    from cde_api.modules import documents as docs
    with psycopg.connect(urls.owner, row_factory=dict_row) as conn:
        riga = conn.execute("SELECT r.original_filename, f.id AS file_id, f.storage_key, f.storage_version_id, "
                            "f.size_bytes FROM cde.document_revisions r JOIN cde.file_objects f ON f.id = r.file_object_id "
                            "WHERE r.id = %s", [rotta["id"]]).fetchone()
        with pytest.raises(docs.ApiError) as e:
            docs.leggi_contenuto(client.app.state.services.storage, conn, riga)
    assert e.value.status == 409


def test_verifica_di_nuovo(client, api_world, as_user, motore_finto, lavora):  # noqa: F811
    _, w = api_world
    h = as_user("des_lead")
    motore_finto["esito"] = "da verificare"
    rev = upload(client, h, w.containers["des_arch"], nome(), BUSTA).json()
    lavora()
    assert documento(client, h, rev)["revisions"][0]["firma"]["esito"] == "da verificare"
    motore_finto["esito"] = "valida"
    r = client.post(f"/revisions/{rev['id']}/firma/verifica", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["rapporto"]["esito"] == "valida"
    assert documento(client, h, rev)["revisions"][0]["firma"]["esito"] == "valida"
    # altre organizzazioni non vedono la WIP; un PDF normale non ha firma da verificare
    assert client.post(f"/revisions/{rev['id']}/firma/verifica", headers=as_user("sub1_user")).status_code in (403, 404)
    pdf = upload(client, h, w.containers["des_arch"], nome("pdf"), PDF).json()
    lavora()
    assert client.post(f"/revisions/{pdf['id']}/firma/verifica", headers=h).status_code == 422


def test_filigrana_sul_pdf_contenuto(client, api_world, as_user, motore_finto, lavora):  # noqa: F811
    _, w = api_world
    h = as_user("des_lead")
    url = f"/projects/{w.project_id}/watermark"
    assert client.put(url, headers=as_user("com_admin"), json={"states": ["WIP"], "text": "Uso interno"}).status_code == 200
    try:
        n = nome()
        rev = upload(client, h, w.containers["des_arch"], n, BUSTA).json()
        lavora()
        r = client.get(f"/revisions/{rev['id']}/download", headers=h).json()
        assert r["watermark"] is True and r["filename"] == n.removesuffix(".p7m")
        got = client.get(r["url"].removeprefix("/api"))
        assert got.status_code == 200, got.text
        testo = PdfReader(io.BytesIO(got.content)).pages[0].extract_text()
        assert "Capitolato speciale" in testo and "Scaricato da" in testo
        assert n.removesuffix(".p7m") in got.headers["content-disposition"]
    finally:
        client.put(url, headers=as_user("com_admin"), json=None)


# ---------------------------------------------------------------------
# Motore vero (shared/firma) con l'ente certificatore di prova
# ---------------------------------------------------------------------
@pytest.mark.skipif(not PY_MOTORE.exists(), reason="motore della firma non installato (shared/firma/installa.bat)")
def test_motore_vero_ente_di_prova(client, api_world, as_user, lavora, tmp_path, monkeypatch):  # noqa: F811
    _, w = api_world
    subprocess.run([str(PY_MOTORE), str(MOTORE / "test_firma.py"), "fixture", str(tmp_path / "fx")], check=True,  # noqa: S603
                   capture_output=True)
    ancore = tmp_path / "ancore"
    ancore.mkdir()
    (ancore / "ente.pem").write_bytes((tmp_path / "fx" / "ente.pem").read_bytes())
    monkeypatch.setenv("FIRMA_ANCORE_EXTRA", str(ancore))
    monkeypatch.setenv("FIRMA_CACHE_DIR", str(tmp_path / "cache"))      # niente elenchi veri: solo l'ente di prova
    h = as_user("des_lead")
    busta = (tmp_path / "fx" / "firmato.pdf.p7m").read_bytes()
    rev = upload(client, h, w.containers["des_arch"], nome(), busta).json()
    alterata = upload(client, h, w.containers["des_arch"], nome(),
                      (tmp_path / "fx" / "alterato.pdf.p7m").read_bytes()).json()
    lavora()
    r = documento(client, h, rev)["revisions"][0]
    assert r["firma_stato"] == "READY" and r["firma"]["esito"] == "valida", r["firma"]
    assert r["firma"]["firme"][0]["firmatario"] == "Mario Rossi" and r["firma"]["firme"][0]["tipo"] == "firma digitale"
    v = client.get(f"/revisions/{rev['id']}/download", headers=h, params={"disposition": "inline"}).json()
    assert httpx.get(v["url"]).content == (tmp_path / "fx" / "documento.pdf").read_bytes()
    a = documento(client, h, alterata)["revisions"][0]
    assert a["firma_stato"] == "READY" and a["firma"]["esito"] == "non valida"     # si legge, ma è segnalata
