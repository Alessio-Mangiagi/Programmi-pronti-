# "><(((º> sabusabu <º)))><"
"""Ricerca nel contenuto dei file: estrazione dal worker, visibilità per revisione, estratto evidenziato."""
from __future__ import annotations

import io
import zipfile

import psycopg
from psycopg.rows import dict_row
from test_api_documents import des_name, upload, worker  # noqa: F401 - fixture riusata
from test_api_naming_auto import as_user  # noqa: F401 - fixture riusata
from test_api_states import transition
from test_api_watermark import real_pdf

from cde_api import textextract
from cde_api.worker import index_text


def docx(text: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("[Content_Types].xml", "<Types/>")
        zf.writestr("word/document.xml",
                    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
                    f'<w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:body></w:document>')
    return buf.getvalue()


def _search(client, w, headers, q, content=True):
    r = client.get(f"/projects/{w.project_id}/documents", headers=headers, params={"q": q, "content": content})
    assert r.status_code == 200, r.text
    return r.json()["items"]


def test_ricerca_nel_testo_dei_file(client, api_world, api_app, as_user, worker):  # noqa: F811
    urls, w = api_world
    lead, im = as_user("des_lead"), as_user("com_im")
    pdf = upload(client, lead, w.containers["des_arch"], des_name(),
                 real_pdf(1, "Solaio in calcestruzzo armato classe Zanzibar"), title="Relazione strutture").json()
    word = upload(client, lead, w.containers["des_arch"], des_name(ext="docx"), docx("Capitolato impianti Ornitorinco"),
                  title="Capitolato").json()
    worker()                                              # verifica + estrazione del testo
    found = _search(client, w, lead, "zanzibar")
    assert [d["id"] for d in found] == [pdf["document_id"]]
    assert "⟦Zanzibar⟧" in found[0]["match_snippet"]
    assert [d["id"] for d in _search(client, w, lead, "ornitorinco")] == [word["document_id"]]
    assert _search(client, w, lead, "zanzibar", content=False) == []     # senza l'opzione: solo titolo e codice
    # il WIP di DES non è visibile al committente: nemmeno il suo testo
    assert _search(client, w, im, "zanzibar") == []
    shared = transition(client, lead, pdf["id"], "SHARED", "S2").json()
    with psycopg.connect(urls.worker, autocommit=True) as conn:   # quello che fa il job dopo la transizione
        conn.execute("SELECT cde.text_copy_siblings(%s)", [pdf["document_id"]])
    hit = _search(client, w, im, "zanzibar")
    assert [d["id"] for d in hit] == [pdf["document_id"]] and hit[0]["current_revision"] == shared["revision_code"]


def test_recupero_dei_file_gia_caricati(client, api_world, api_app, as_user, worker):  # noqa: F811
    urls, w = api_world
    lead = as_user("des_lead")
    doc = upload(client, lead, w.containers["des_arch"], des_name(ext="txt"), b"Verbale di cantiere Quokka\n").json()
    worker()
    with psycopg.connect(urls.owner, autocommit=True) as conn:            # come prima della migrazione 0024
        conn.execute("DELETE FROM cde.revision_text WHERE revision_id = %s", [doc["id"]])
    assert _search(client, w, lead, "quokka") == []
    with psycopg.connect(urls.worker, row_factory=dict_row) as conn:
        assert index_text(conn, api_app.state.services.storage, limit=200) >= 1
    assert [d["id"] for d in _search(client, w, lead, "quokka")] == [doc["document_id"]]


def test_estrazione_robusta():
    assert textextract.extract("a.pdf", b"%PDF-1.7 rotto") == ""
    assert textextract.extract("a.docx", b"non uno zip") == ""
    bomb = io.BytesIO()
    with zipfile.ZipFile(bomb, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("word/document.xml", "<a>" + "x" * (textextract.MAX_XML + 10) + "</a>")
    assert textextract.extract("a.docx", bomb.getvalue()) == ""          # troppo grande una volta decompresso
    xxe = io.BytesIO()
    with zipfile.ZipFile(xxe, "w") as zf:
        zf.writestr("word/document.xml", '<?xml version="1.0"?><!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]><d>&x;</d>')
    assert textextract.extract("a.docx", xxe.getvalue()) == ""           # entità esterne rifiutate
    assert textextract.extract("disegno.dwg", b"AC1032") == "" and not textextract.wants("disegno.dwg")
    assert textextract.extract("note.txt", "Così è".encode()) == "Così è"


def test_testo_con_caratteri_di_controllo():
    assert textextract.extract("dump.txt", b"riga\x00uno\x07due") == "riga uno due"
