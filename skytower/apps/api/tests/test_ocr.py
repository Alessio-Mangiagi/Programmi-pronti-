# "><(((º> sabusabu <º)))><"
"""OCR dei PDF scansionati (ADR-33): le pagine senza testo si leggono con Tesseract, quelle con testo no; il testo
letto entra nella ricerca nel contenuto e in "Citato in" (anche con lo zero letto come O). Senza Tesseract nel
sistema i test che lo usano si saltano (la CI lo installa)."""
from __future__ import annotations

import psycopg
import pytest
from psycopg.rows import dict_row
from test_api_documents import as_user, upload  # noqa: F401 - fixture

from cde_api import ocr, textextract
from cde_api.modules.bim import _ocr_variant
from cde_api.scanner import EicarScanner
from cde_api.tooling.demo_content import drawing_pdf, scanned_pdf
from cde_api.worker import reocr_text, verify_file

TESSERACT = ocr.find_tesseract()
needs_tesseract = pytest.mark.skipif(TESSERACT is None, reason="Tesseract non installato")
LINES = ["Si rileva una fessura sul Muro perimetrale sud P0 vicino al pilastro.", "Il Solaio P1 risulta completato."]


def test_pdf_scansionato_senza_ocr_non_ha_testo():
    assert textextract.extract("verbale.pdf", scanned_pdf(1, "Verbale", LINES)) == ""


@needs_tesseract
def test_ocr_legge_le_pagine_scansionate():
    text = textextract.extract("verbale.pdf", scanned_pdf(1, "Verbale di sopralluogo", LINES), ocr.OcrConfig(TESSERACT))
    assert "fessura" in text and "Solaio P1" in text and "sopralluogo" in text


def test_solo_le_pagine_senza_testo(monkeypatch):
    asked: list[list[int]] = []

    def fake(data, pages, config):
        asked.append(pages)
        return {i: "testo letto" for i in pages}

    monkeypatch.setattr(textextract, "read_pages", fake)
    vector = drawing_pdf(3, "Pianta", "PRJ01-DES-ZZ-00-DR-A-0001", "P01")
    assert "Pianta" in textextract.extract("p.pdf", vector, ocr.OcrConfig("tesseract"))
    assert asked == []                                          # PDF vettoriale: niente OCR
    assert textextract.extract("s.pdf", scanned_pdf(2, "X", LINES), ocr.OcrConfig("tesseract")) == "testo letto"
    assert asked == [[0]]


def test_ocr_non_riuscito_non_perde_il_testo(monkeypatch):
    def broken(*_a, **_k):
        raise RuntimeError("tesseract esploso")

    monkeypatch.setattr(textextract, "read_pages", broken)
    assert textextract.extract("s.pdf", scanned_pdf(2, "X", LINES), ocr.OcrConfig("tesseract")) == ""


def test_variante_ocr_dei_codici():
    assert _ocr_variant("Muro perimetrale sud P0") == "Muro perimetrale sud PO"
    assert _ocr_variant("Solaio P1") == "Solaio P1"
    assert _ocr_variant("Pilastro P0-03") == "Pilastro PO-03"


def test_configurazione(monkeypatch):
    class S:
        ocr_enabled, tesseract_cmd, ocr_languages, ocr_max_pages = False, None, "ita", 5
    assert ocr.config_from(S()) is None
    S.ocr_enabled, S.tesseract_cmd = True, "/percorso/inesistente/tesseract"
    ocr.find_tesseract.cache_clear()
    monkeypatch.setattr(ocr.shutil, "which", lambda _c: None)
    monkeypatch.setattr(ocr, "WINDOWS_DEFAULT", "/non/esiste.exe")
    assert ocr.config_from(S()) is None                          # senza eseguibile l'OCR si salta
    ocr.find_tesseract.cache_clear()


def test_ri_ocr_dei_pdf_indicizzati_senza(client, api_app, api_world, as_user, monkeypatch):  # noqa: F811
    urls, w = api_world
    storage = api_app.state.services.storage
    storage.ensure_bucket()
    h = as_user("des_lead")
    name = "PRJ01-DES-ZZ-00-DR-A-7732.pdf"
    r = upload(client, h, w.containers["des_arch"], name, scanned_pdf(9, "Verbale", LINES), title="Prima dell'OCR")
    assert r.status_code == 200, r.text
    with psycopg.connect(urls.owner, row_factory=dict_row) as owner:
        fid = owner.execute("SELECT r.file_object_id FROM cde.document_revisions r WHERE r.original_filename = %s "
                            "ORDER BY r.created_at DESC LIMIT 1", [name]).fetchone()["file_object_id"]
    with psycopg.connect(urls.worker, row_factory=dict_row) as conn:
        verify_file(conn, storage, EicarScanner(), fid, ocr=None)              # come prima dell'OCR
        assert reocr_text(conn, storage, ocr=None) == 0                         # senza Tesseract non si fa nulla

        monkeypatch.setattr(textextract, "read_pages", lambda data, pages, config: {i: "fessura letta" for i in pages})
        for _ in range(20):                       # DB condiviso: anche file di altre esecuzioni, pochi per giro
            reocr_text(conn, storage, limit=100, ocr=ocr.OcrConfig("tesseract"))
            left = {x["file_id"] for x in conn.execute("SELECT file_id FROM cde.text_ocr_pending(100)").fetchall()}
            conn.commit()
            if fid not in left:
                break
    with psycopg.connect(urls.owner, row_factory=dict_row) as owner:
        row = owner.execute("SELECT t.body, t.ocr_at FROM cde.revision_text t JOIN cde.document_revisions r "
                            "ON r.id = t.revision_id WHERE r.file_object_id = %s", [fid]).fetchone()
    assert "fessura letta" in row["body"] and row["ocr_at"] is not None
    found = client.get(f"/projects/{w.project_id}/documents", headers=h, params={"q": "fessura", "content": True}).json()
    assert any(d["identifier"] == name[:-4] for d in found["items"])


@needs_tesseract
def test_ricerca_e_citato_in(client, api_app, api_world, as_user):  # noqa: F811
    urls, w = api_world
    api_app.state.services.storage.ensure_bucket()
    h = as_user("des_lead")
    name = "PRJ01-DES-ZZ-00-DR-A-7731.pdf"
    r = upload(client, h, w.containers["des_arch"], name, scanned_pdf(9, "Verbale di sopralluogo", LINES),
               title="Sopralluogo scansionato")
    assert r.status_code == 200, r.text
    with psycopg.connect(urls.worker, row_factory=dict_row) as conn:
        pending = [x["id"] for x in conn.execute("SELECT id FROM cde.file_objects WHERE scan_status = 'PENDING'").fetchall()]
        conn.commit()
        for fid in pending:
            verify_file(conn, api_app.state.services.storage, EicarScanner(), fid, ocr=ocr.OcrConfig(TESSERACT))
    found = client.get(f"/projects/{w.project_id}/documents", headers=h, params={"q": "fessura", "content": True}).json()
    assert any(d["identifier"] == name[:-4] for d in found["items"])
    cited = client.get(f"/projects/{w.project_id}/model-element/documents", headers=h,
                       params={"name": "Muro perimetrale sud P0"}).json()["cited"]
    assert any(d["identifier"] == name[:-4] for d in cited)
