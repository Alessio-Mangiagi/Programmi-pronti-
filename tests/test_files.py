"""
Test upload/download file: planimetrie (PNG/JPG/PDF -> immagine con dimensioni)
e allegati (record + byte), con storage su directory temporanea.
"""
import io
import uuid
from datetime import datetime, timezone

import pytest
from PIL import Image

from app import storage as st
from tests.conftest import push


def png_bytes(w=300, h=200) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), "white").save(buf, format="PNG")
    return buf.getvalue()


def jpg_bytes(w=120, h=80) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), "gray").save(buf, format="JPEG")
    return buf.getvalue()


def pdf_bytes(w_pt=842, h_pt=595) -> bytes:
    """PDF A4 orizzontale generato con Pillow (una pagina, immagine)."""
    buf = io.BytesIO()
    # Pillow scrive il PDF a 72 dpi: pixel = punti
    Image.new("RGB", (w_pt, h_pt), "white").save(buf, format="PDF", resolution=72)
    return buf.getvalue()


def upload(client, url, data, name="f.bin", content_type="application/octet-stream"):
    return client.post(url, files={"file": (name, data, content_type)})


# ---------- storage ----------

def test_sniff_mime():
    assert st.sniff_mime(png_bytes()) == "image/png"
    assert st.sniff_mime(jpg_bytes()) == "image/jpeg"
    assert st.sniff_mime(pdf_bytes()) == "application/pdf"
    assert st.sniff_mime(b"GIF89a....") is None


def test_storage_rejects_path_traversal(tmp_storage):
    with pytest.raises(ValueError):
        tmp_storage.path("../../etc/passwd")
    assert tmp_storage.exists("../x") is False


# ---------- plans ----------

def test_plan_created_without_file(client, project):
    r = client.post("/plans", json={"project_id": project["project"]["id"], "name": "Piano 1"})
    assert r.status_code == 201
    assert r.json()["file_url"] is None and r.json()["width_px"] is None


def test_upload_plan_png(client, project):
    plan_id = project["plan"]["id"]
    r = upload(client, f"/plans/{plan_id}/file", png_bytes(300, 200), "pt.png")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["file_url"] == f"/files/plans/{plan_id}.png"
    assert (body["width_px"], body["height_px"]) == (300, 200)

    f = client.get(body["file_url"])
    assert f.status_code == 200 and f.content == png_bytes(300, 200)
    # il pull espone il nuovo url
    pulled = client.get("/sync/pull", params={"project_id": project["project"]["id"]}).json()
    assert pulled["plans"][0]["file_url"] == body["file_url"]


def test_upload_plan_jpg_keeps_format(client, project):
    r = upload(client, f"/plans/{project['plan']['id']}/file", jpg_bytes(120, 80), "x.jpg")
    assert r.json()["file_url"].endswith(".jpg") and r.json()["width_px"] == 120


def test_upload_plan_pdf_is_rendered_to_png(client, project):
    r = upload(client, f"/plans/{project['plan']['id']}/file", pdf_bytes(842, 595), "plan.pdf", "application/pdf")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["file_url"].endswith(".png")
    # 842x595 pt scalati a 4x (max) = 3368x2380, sotto PDF_RENDER_MAX_SIDE
    assert (body["width_px"], body["height_px"]) == (3368, 2380)
    png = client.get(body["file_url"]).content
    assert st.sniff_mime(png) == "image/png"
    assert st.image_size(png) == (3368, 2380)


def test_upload_plan_pdf_large_page_is_capped(client, project):
    r = upload(client, f"/plans/{project['plan']['id']}/file", pdf_bytes(2384, 1684), "a1.pdf")  # A1
    assert r.json()["width_px"] == st.PDF_RENDER_MAX_SIDE


def test_upload_plan_rejects_bad_type_and_size(client, project):
    url = f"/plans/{project['plan']['id']}/file"
    assert upload(client, url, b"GIF89a" + b"\x00" * 100, "x.gif", "image/gif").status_code == 415
    assert upload(client, url, b"<html>", "x.png", "image/png").status_code == 415  # header mente
    assert upload(client, url, b"\x89PNG\r\n\x1a\n" + b"\x00" * st.MAX_UPLOAD_BYTES, "big.png").status_code == 413
    assert upload(client, url, b"\x89PNG\r\n\x1a\n" + b"garbage", "corrupt.png").status_code == 422
    assert upload(client, url, b"%PDF-1.4 garbage", "corrupt.pdf").status_code == 422
    assert upload(client, "/plans/nope/file", png_bytes()).status_code == 404


def test_reupload_overwrites_same_key(client, project):
    url = f"/plans/{project['plan']['id']}/file"
    upload(client, url, png_bytes(300, 200))
    r = upload(client, url, png_bytes(50, 50))
    assert r.json()["width_px"] == 50
    assert st.image_size(client.get(r.json()["file_url"]).content) == (50, 50)


# ---------- attachments ----------

def test_attachment_web_flow(client, project, pin):
    task = client.post("/tasks", json={"pin_id": pin, "title": "t"}).json()
    r = client.post("/attachments", json={"task_id": task["id"]})
    assert r.status_code == 201 and r.json()["file_url"] is None
    att_id = r.json()["id"]

    r = upload(client, f"/attachments/{att_id}/upload", jpg_bytes(), "foto.jpg", "image/jpeg")
    assert r.status_code == 200, r.text
    assert r.json()["file_url"] == f"/files/attachments/{att_id}.jpg"
    assert r.json()["file_type"] == "photo"
    assert client.get(r.json()["file_url"]).content == jpg_bytes()

    # visibile nel dettaglio pin
    detail = client.get(f"/pins/{pin}").json()
    assert detail["tasks"][0]["attachments"][0]["file_url"].endswith(".jpg")


def test_attachment_create_validation(client, project, pin):
    task = client.post("/tasks", json={"pin_id": pin, "title": "t"}).json()
    sub = client.post("/submissions", json={
        "template_id": project["template"]["id"], "pin_id": pin, "data_json": {"esito": "Conforme"}}).json()
    assert client.post("/attachments", json={}).status_code == 422
    assert client.post("/attachments", json={"task_id": task["id"], "submission_id": sub["id"]}).status_code == 422
    assert client.post("/attachments", json={"task_id": "nope"}).status_code == 404
    assert client.post("/attachments", json={"submission_id": "nope"}).status_code == 404
    assert client.post("/attachments", json={"submission_id": sub["id"], "file_type": "signature"}).status_code == 201


def test_attachment_mobile_flow_sync_then_presign_then_upload(client, project, pin):
    """Il device crea il record offline (file_url nullo), poi carica i byte."""
    task_id, att_id = str(uuid.uuid4()), str(uuid.uuid4())
    r = push(client,
             tasks=[{"id": task_id, "pin_id": pin, "title": "t"}],
             attachments=[{"id": att_id, "task_id": task_id, "file_type": "signature"}])
    assert r["attachments"]["inserted"] == 1

    p = client.post("/attachments/presign", json={"attachment_id": att_id})
    assert p.status_code == 200
    assert p.json()["upload_url"] == f"/attachments/{att_id}/upload" and p.json()["method"] == "POST"

    r = upload(client, p.json()["upload_url"], png_bytes(200, 100), "firma.png", "image/png")
    assert r.status_code == 200
    assert r.json()["file_type"] == "signature"  # non sovrascritto
    assert r.json()["file_url"].endswith(".png")

    # retry idempotente: stesso key
    r2 = upload(client, p.json()["upload_url"], png_bytes(200, 100), "firma.png", "image/png")
    assert r2.json()["file_url"] == r.json()["file_url"]

    # il pull espone file_url aggiornato
    pulled = client.get("/sync/pull", params={"project_id": project["project"]["id"]}).json()
    assert [a["file_url"] for a in pulled["attachments"] if a["id"] == att_id] == [r.json()["file_url"]]


def test_attachment_upload_pdf_becomes_doc(client, pin):
    task = client.post("/tasks", json={"pin_id": pin, "title": "t"}).json()
    att = client.post("/attachments", json={"task_id": task["id"]}).json()
    r = upload(client, f"/attachments/{att['id']}/upload", pdf_bytes(), "x.pdf")
    assert r.json()["file_type"] == "doc" and r.json()["file_url"].endswith(".pdf")


def test_attachment_upload_errors(client, pin):
    assert upload(client, "/attachments/nope/upload", png_bytes()).status_code == 404
    assert client.post("/attachments/presign", json={"attachment_id": "nope"}).status_code == 404
    task = client.post("/tasks", json={"pin_id": pin, "title": "t"}).json()
    att = client.post("/attachments", json={"task_id": task["id"]}).json()
    assert upload(client, f"/attachments/{att['id']}/upload", b"not an image").status_code == 415
    # allegato cancellato: niente upload
    push(client, attachments=[{"id": att["id"], "task_id": task["id"],
                               "deleted_at": datetime.now(timezone.utc).isoformat()}])
    assert upload(client, f"/attachments/{att['id']}/upload", png_bytes()).status_code == 404


def test_get_file_not_found_and_traversal(client):
    assert client.get("/files/plans/nope.png").status_code == 404
    assert client.get("/files/../requirements.txt").status_code in (404, 422)


def test_get_file_only_for_project_members(client, project, pin, users):
    plan_url = upload(client, f"/plans/{project['plan']['id']}/file", png_bytes(30, 20), "p.png").json()["file_url"]
    task = client.post("/tasks", json={"pin_id": pin, "title": "t"}).json()
    att = client.post("/attachments", json={"task_id": task["id"]}).json()
    att_url = upload(client, f"/attachments/{att['id']}/upload", jpg_bytes(), "a.jpg").json()["file_url"]
    for url in (plan_url, att_url):
        assert client.get(url, headers=users["field"]["headers"]).status_code == 200
        assert client.get(url, headers=users["outsider"]["headers"]).status_code == 404
    # file_url impostato dal client su un file altrui non dà accesso: conta la key, non il DB
    other = client.post("/projects", json={"name": "Cantiere dell'outsider"}).json()
    client.post(f"/projects/{other['id']}/members", json={"user_id": users["outsider"]["id"]})
    r = client.post("/plans", json={"project_id": other["id"], "name": "esca", "file_url": att_url})
    assert r.status_code == 201 and r.json()["file_url"] == att_url
    assert client.get(att_url, headers=users["outsider"]["headers"]).status_code == 404
    # allegato cancellato: file non più servito
    push(client, attachments=[{"id": att["id"], "task_id": task["id"],
                               "deleted_at": datetime.now(timezone.utc).isoformat()}])
    assert client.get(att_url).status_code == 404


def test_attachment_create_with_client_id(client, project, pin):
    sub = client.post("/submissions", json={
        "template_id": project["template"]["id"], "pin_id": pin, "data_json": {"esito": "Conforme"}}).json()
    att_id = str(uuid.uuid4())
    r = client.post("/attachments", json={"id": att_id, "submission_id": sub["id"], "file_type": "photo"})
    assert r.status_code == 201 and r.json()["id"] == att_id
    assert client.post("/attachments", json={"id": att_id, "submission_id": sub["id"]}).status_code == 409
    r = upload(client, f"/attachments/{att_id}/upload", png_bytes(10, 10), "a.png")
    assert r.status_code == 200 and r.json()["file_url"] == f"/files/attachments/{att_id}.png"


def test_s3_storage_with_fake_client(monkeypatch, client, project):
    """S3Storage: put/head/get sul client boto3 (finto) e file servito dall'API da /files."""
    from app import storage as stmod

    class FakeS3:
        def __init__(self):
            self.objects = {}

        def put_object(self, Bucket, Key, Body, ContentType):
            self.objects[(Bucket, Key)] = (Body, ContentType)

        def head_object(self, Bucket, Key):
            if (Bucket, Key) not in self.objects:
                raise Exception("404")

        def get_object(self, Bucket, Key):
            import io
            return {"Body": io.BytesIO(self.objects[(Bucket, Key)][0])}

    s3 = stmod.S3Storage.__new__(stmod.S3Storage)
    s3.bucket, s3.prefix, s3.client = "fv", "prod", FakeS3()
    monkeypatch.setattr(stmod, "storage", s3)
    url = s3.save("plans/x.png", png_bytes(10, 10))
    assert url == "/files/plans/x.png"
    assert ("fv", "prod/plans/x.png") in s3.client.objects
    assert s3.client.objects[("fv", "prod/plans/x.png")][1] == "image/png"
    assert s3.exists("plans/x.png") and not s3.exists("plans/nope.png")
    # file senza planimetria/allegato che lo referenzi: non servito
    assert client.get("/files/plans/x.png").status_code == 404
    assert client.get("/files/plans/nope.png").status_code == 404
    import pytest
    with pytest.raises(ValueError):
        s3.save("../etc/passwd", b"x")
    # upload planimetria end-to-end su S3, poi servita da /files
    r = upload(client, f"/plans/{project['plan']['id']}/file", png_bytes(30, 20), "p.png")
    assert r.status_code == 200 and ("fv", f"prod/plans/{project['plan']['id']}.png") in s3.client.objects
    r = client.get(r.json()["file_url"])
    assert r.status_code == 200 and r.headers["content-type"] == "image/png" and r.content[:8] == b"\x89PNG\r\n\x1a\n"
