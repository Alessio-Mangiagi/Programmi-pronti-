import io
import zipfile

from reportlab.pdfgen import canvas

W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'


def _p(text, style=None):
    ppr = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ""
    return f"<w:p>{ppr}<w:r><w:t>{text}</w:t></w:r></w:p>"


def _tc(text, props=""):
    return f"<w:tc>{f'<w:tcPr>{props}</w:tcPr>' if props else ''}{_p(text)}</w:tc>"


def _docx(body: str) -> bytes:
    styles = (f'<w:styles {W_NS}><w:style w:styleId="Titolo1"><w:name w:val="heading 1"/></w:style>'
              f'<w:style w:styleId="Titolo2"><w:name w:val="heading 2"/></w:style></w:styles>')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("word/document.xml", f"<w:document {W_NS}><w:body>{body}</w:body></w:document>")
        z.writestr("word/styles.xml", styles)
    return buf.getvalue()


def _preview(client, pid, content, name, headers=None, path=None):
    return client.post(path or f"/projects/{pid}/pcq/preview", headers=headers,
                       files={"file": (name, content, "application/octet-stream")})


def test_pcq_preview_docx_headings_tables_and_merges(client, project, users):
    pid = project["project"]["id"]
    body = (
        _p("PCQ Scuola Da Vinci", "Titolo1")
        + _p("01 Strutture", "Titolo2")
        + _p("Controlli sui getti")
        + "<w:tbl>"
        + "<w:tr>" + _tc("Fase") + _tc("Controllo") + _tc("Frequenza") + "</w:tr>"
        + "<w:tr>" + _tc("Getto", '<w:vMerge w:val="restart"/>') + _tc("Slump") + _tc("Ogni getto") + "</w:tr>"
        + "<w:tr>" + _tc("", "<w:vMerge/>") + _tc("Cubetti", '<w:gridSpan w:val="2"/>') + "</w:tr>"
        + "<w:tr>" + _tc("") + _tc("") + _tc("") + "</w:tr>"
        + "</w:tbl>"
    )
    r = _preview(client, pid, _docx(body), "pcq.docx")
    assert r.status_code == 200, r.text
    doc = r.json()
    assert doc["kind"] == "docx" and doc["filename"] == "pcq.docx"
    assert doc["headings"] == ["PCQ Scuola Da Vinci", "  01 Strutture"]
    [t] = doc["tables"]
    assert t["title"] == "Controlli sui getti"
    # riga vuota scartata, cella unita in verticale vuota, gridSpan riempito
    assert t["rows"] == [["Fase", "Controllo", "Frequenza"], ["Getto", "Slump", "Ogni getto"], ["", "Cubetti", ""]]
    assert doc["warnings"] == []

    # solo manager
    assert _preview(client, pid, _docx(body), "pcq.docx", users["field"]["headers"]).status_code == 403

    # stessa lettura senza cantiere (editor dei moduli)
    r = client.post("/pcq/preview", files={"file": ("pcq.docx", _docx(body), "application/octet-stream")})
    assert r.status_code == 200 and r.json()["tables"] == doc["tables"]
    r = client.post("/pcq/preview", headers=users["manager"]["headers"],
                    files={"file": ("pcq.docx", _docx(body), "application/octet-stream")})
    assert r.status_code == 403


def test_pcq_preview_pdf_text_and_errors(client, project):
    pid = project["project"]["id"]
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    c.drawString(72, 750, "Piano di controllo qualita")
    c.drawString(72, 730, "Getto calcestruzzo - slump")
    c.save()
    r = _preview(client, pid, buf.getvalue(), "pcq.pdf")
    assert r.status_code == 200, r.text
    doc = r.json()
    assert doc["kind"] == "pdf" and doc["pages"] == 1
    assert "Getto calcestruzzo - slump" in doc["lines"]

    assert _preview(client, pid, b"", "x.docx").json()["detail"] == "empty file"
    assert _preview(client, pid, b"abc", "x.doc").json()["detail"] == "doc not supported: save as docx"
    assert _preview(client, pid, b"abc", "x.txt").json()["detail"] == "only docx or pdf allowed"
    assert _preview(client, pid, b"PK broken", "x.docx").json()["detail"] == "cannot read docx"


def test_pcq_example_docx_is_readable(client, users):
    r = client.get("/pcq/example.docx")
    assert r.status_code == 200 and r.content[:2] == b"PK"
    doc = _preview(client, None, r.content, "PCQ-esempio.docx", path="/pcq/preview").json()
    assert doc["headings"][0].startswith("PCQ") and len(doc["tables"]) == 2
    assert doc["tables"][0]["rows"][0][:2] == ["Fase", "Controllo"]
    assert client.get("/pcq/example.docx", headers=users["manager"]["headers"]).status_code == 403
