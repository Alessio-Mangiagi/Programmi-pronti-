# "><(((º> sabusabu <º)))><"
"""Filigrana sui PDF: stati scelti dal Project Admin, timbro con chi scarica, permessi ricontrollati."""
from __future__ import annotations

import io

import httpx
import psycopg
import pytest
from fpdf import FPDF
from pypdf import PdfReader
from test_api_documents import des_name, upload, worker  # noqa: F401 - fixture riusata
from test_api_naming_auto import as_user  # noqa: F401 - fixture riusata
from test_api_states import transition

from cde_api.watermark import WatermarkError, latin1, stamp


def real_pdf(pages: int = 2, text: str = "Tavola architettonica") -> bytes:
    pdf = FPDF()
    pdf.set_font("Helvetica", size=14)
    for i in range(pages):
        pdf.add_page(orientation="L" if i % 2 else "P")
        pdf.text(20, 20, f"{text} - pagina {i + 1}")
    return bytes(pdf.output())


@pytest.fixture
def watermark(client, api_world, as_user):  # noqa: F811
    _, w = api_world
    url = f"/projects/{w.project_id}/watermark"

    def configure(body):
        r = client.put(url, headers=as_user("com_admin"), json=body)
        assert r.status_code == 200, r.text
        return r.json()
    yield configure
    client.put(url, headers=as_user("com_admin"), json=None)


def _fetch(client, url: str) -> httpx.Response:
    assert url.startswith("/api/")
    return client.get(url.removeprefix("/api"))


def test_impostazione_solo_project_admin(client, api_world, as_user, watermark):  # noqa: F811
    _, w = api_world
    url = f"/projects/{w.project_id}/watermark"
    assert client.put(url, headers=as_user("des_lead"), json={"states": ["SHARED"]}).status_code == 403
    assert client.put(url, headers=as_user("com_admin"), json={"states": []}).status_code == 422
    assert client.put(url, headers=as_user("com_admin"), json={"states": ["BOZZA"]}).status_code == 422
    out = watermark({"states": ["PUBLISHED", "SHARED", "SHARED"], "text": "  Uso interno  "})
    assert out["watermark"] == {"states": ["SHARED", "PUBLISHED"], "text": "Uso interno"}
    # la leggono tutti i membri (la SPA avvisa che il PDF sarà filigranato); il resto delle impostazioni resta
    assert client.get(url, headers=as_user("des_lead")).json() == out
    settings = client.get(f"/projects/{w.project_id}/document-settings", headers=as_user("des_lead"))
    assert settings.status_code == 200 and "naming_scheme" in settings.json()


def test_pdf_filigranato_negli_stati_scelti(client, api_world, as_user, worker, watermark):  # noqa: F811
    urls, w = api_world
    h = as_user("des_lead")
    data = real_pdf()
    name = des_name()
    rev = upload(client, h, w.containers["des_arch"], name, data, title="Pianta").json()
    worker()
    watermark({"states": ["SHARED"], "text": "Uso interno"})

    # WIP non è tra gli stati scelti: URL firmato di S3, file originale
    r = client.get(f"/revisions/{rev['id']}/download", headers=h).json()
    assert r["watermark"] is False and httpx.get(r["url"]).content == data

    shared = transition(client, h, rev["id"], "SHARED", "S2").json()
    r = client.get(f"/revisions/{shared['id']}/download", headers=h)
    assert r.status_code == 200 and r.json()["watermark"] is True
    got = _fetch(client, r.json()["url"])
    assert got.status_code == 200, got.text
    assert got.headers["content-disposition"].startswith("attachment")
    assert got.headers["cache-control"] == "private, no-store"
    pages = PdfReader(io.BytesIO(got.content)).pages
    assert len(pages) == 2
    for page in pages:
        text = page.extract_text()
        assert "Tavola architettonica" in text                      # il contenuto originale resta
        assert "Scaricato da" in text and "@" in text and "DES" in text
        assert f"{name.removesuffix('.pdf')} rev. {shared['revision_code']} - stato SHARED - Uso interno" in text

    # nel visualizzatore: stesso timbro, mostrato inline
    r = client.get(f"/revisions/{shared['id']}/download", headers=h, params={"disposition": "inline"}).json()
    assert r["watermark"] is True and r["content_type"] == "application/pdf"
    got = _fetch(client, r["url"])
    assert got.headers["content-disposition"].startswith("inline") and b"%PDF" in got.content[:8]
    with psycopg.connect(urls.owner) as conn:
        flags = conn.execute("SELECT details->>'watermark' FROM cde.security_events WHERE details->>'revision' = %s "
                             "ORDER BY id", [shared["id"]]).fetchall()
    assert [f[0] for f in flags] == ["true", "true"]


def test_ticket_legato_a_utente_revisione_e_permessi(client, api_world, as_user, worker, watermark):  # noqa: F811
    urls, w = api_world
    h = as_user("des_lead")
    rev = upload(client, h, w.containers["des_arch"], des_name(), real_pdf(1)).json()
    other = upload(client, h, w.containers["des_arch"], des_name(), real_pdf(1)).json()
    worker()
    watermark({"states": ["WIP"]})
    url = client.get(f"/revisions/{rev['id']}/download", headers=h).json()["url"]
    ticket = url.split("ticket=")[1]
    # senza ticket, con un ticket falso o di un'altra revisione: niente file
    assert client.get(f"/revisions/{rev['id']}/watermarked").status_code == 422
    assert client.get(f"/revisions/{rev['id']}/watermarked", params={"ticket": "x.y.z"}).status_code == 401
    assert client.get(f"/revisions/{other['id']}/watermarked", params={"ticket": ticket}).status_code == 401
    # un token di accesso non vale come ticket
    access = h["Authorization"].removeprefix("Bearer ")
    assert client.get(f"/revisions/{rev['id']}/watermarked", params={"ticket": access}).status_code == 401
    # il permesso si ricontrolla: chi perde l'accesso non usa più il link già emesso
    with psycopg.connect(urls.owner) as conn:
        conn.execute("UPDATE cde.users SET status = 'DISABLED' WHERE id = %s", [w.users["des_lead"]])
    try:
        assert _fetch(client, url).status_code == 401
    finally:
        with psycopg.connect(urls.owner) as conn:
            conn.execute("UPDATE cde.users SET status = 'ACTIVE' WHERE id = %s", [w.users["des_lead"]])
    # filigrana tolta nel frattempo: il link non serve più, si riapre il documento
    watermark(None)
    assert _fetch(client, url).status_code == 409


def test_pdf_protetto_o_troppo_grande(client, api_world, api_settings, as_user, worker, watermark):  # noqa: F811
    _, w = api_world
    h = as_user("des_lead")
    bogus = upload(client, h, w.containers["des_arch"], des_name(), b"%PDF-1.7\n" + b"x" * 4096).json()
    worker()
    watermark({"states": ["WIP"]})
    url = client.get(f"/revisions/{bogus['id']}/download", headers=h).json()["url"]
    r = _fetch(client, url)
    assert r.status_code == 422 and r.json()["error"]["code"] == "watermark_failed"
    limit = api_settings.watermark_max_bytes
    api_settings.watermark_max_bytes = 1024
    try:
        r = client.get(f"/revisions/{bogus['id']}/download", headers=h)
        assert r.status_code == 413 and r.json()["error"]["code"] == "watermark_too_large"
    finally:
        api_settings.watermark_max_bytes = limit


def test_stamp_unitario():
    from pypdf import PdfWriter
    writer = PdfWriter()
    writer.add_blank_page(300, 200)
    writer.encrypt("segreta")
    buf = io.BytesIO()
    writer.write(buf)
    with pytest.raises(WatermarkError, match="password"):
        stamp(buf.getvalue(), "x", ["y"])
    with pytest.raises(WatermarkError, match="leggibile"):
        stamp(b"non un pdf", "x", ["y"])
    # pagina ruotata e mediabox con origine non nulla
    writer = PdfWriter()
    page = writer.add_blank_page(400, 300)
    page.rotate(90)
    page2 = writer.add_blank_page(400, 300)
    page2.mediabox.lower_left = (50, 50)
    buf = io.BytesIO()
    writer.write(buf)
    out = PdfReader(io.BytesIO(stamp(buf.getvalue(), "Mario Rossi - COM", ["Piè di pagina"])))
    assert all("Mario Rossi" in p.extract_text() for p in out.pages)
    assert out.metadata["/CDEWatermark"] == "Piè di pagina"
    assert latin1("Žižek — “test”") == "?i?ek - ?test?"
