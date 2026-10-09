"""PDF del modulo compilato: contenuto, note per campo, foto dallo storage, permessi."""
import io

from PIL import Image
from pypdfium2 import PdfDocument

from tests.test_files import png_bytes


def _pdf_text(data: bytes) -> str:
    doc = PdfDocument(io.BytesIO(data))
    return "\n".join(page.get_textpage().get_text_range() for page in doc)


def test_submission_pdf_with_notes_and_photos(client, project, pin, users):
    tpl = client.post("/form-templates", json={
        "name": "Verifica ponteggio",
        "schema_def": {"fields": [
            {"id": "zona", "type": "text", "label": "Zona", "required": True},
            {"id": "ok", "type": "checkbox", "label": "Conforme"},
            {"id": "foto", "type": "photo", "label": "Foto", "multiple": True},
        ]},
    }).json()
    field = users["field"]["headers"]
    photo_id = "11111111-1111-4111-8111-111111111111"
    note_photo = "22222222-2222-4222-8222-222222222222"
    sub = client.post("/submissions", headers=field, json={
        "template_id": tpl["id"], "pin_id": pin,
        "data_json": {"zona": "Lato nord", "ok": False, "foto": [photo_id],
                      "_notes": {"zona": {"comment": "Ancoraggio da rifare", "photos": [note_photo]}}},
    })
    assert sub.status_code == 201, sub.text
    sub = sub.json()
    for aid in (photo_id, note_photo):
        assert client.post("/attachments", headers=field,
                           json={"id": aid, "submission_id": sub["id"], "file_type": "photo"}).status_code == 201
        up = client.post(f"/attachments/{aid}/upload", headers=field, files={"file": ("f.png", png_bytes(), "image/png")})
        assert up.status_code == 200, up.text

    r = client.get(f"/submissions/{sub['id']}/pdf", headers=field)
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.headers["content-disposition"].startswith('attachment; filename="verifica-ponteggio-')
    assert r.content.startswith(b"%PDF")
    text = _pdf_text(r.content)
    for expected in ("Verifica ponteggio", "Cantiere A", "Piano terra", "Zona", "Lato nord", "Conforme", "No",
                     "Nota", "Ancoraggio da rifare"):
        assert expected in text, expected
    # due immagini incorporate (foto del campo + foto della nota)
    doc = PdfDocument(io.BytesIO(r.content))
    images = [o for page in doc for o in page.get_objects() if o.type == 3]  # 3 = FPDF_PAGEOBJ_IMAGE
    assert len(images) == 2


def test_submission_pdf_missing_photo_and_access(client, project, pin, users):
    sub = client.post("/submissions", json={
        "template_id": project["template"]["id"], "pin_id": pin,
        "data_json": {"esito": "Non conforme", "_notes": {"esito": {"photos": ["manca"]}}},
    }).json()
    # allegato mai caricato: il PDF si genera comunque con la didascalia
    r = client.get(f"/submissions/{sub['id']}/pdf")
    assert r.status_code == 200 and "foto non disponibile" in _pdf_text(r.content)
    assert client.get(f"/submissions/{sub['id']}/pdf", headers=users["outsider"]["headers"]).status_code == 403
    assert client.get("/submissions/nope/pdf").status_code == 404


def test_submission_notes_validated(client, project, pin):
    r = client.post("/submissions", json={
        "template_id": project["template"]["id"], "pin_id": pin,
        "data_json": {"esito": "Conforme", "_notes": {"altro": {"comment": "x"}, "esito": {"comment": 3}}},
    })
    assert r.status_code == 422
    assert {e["field"] for e in r.json()["detail"]} == {"_notes.altro", "_notes.esito"}
