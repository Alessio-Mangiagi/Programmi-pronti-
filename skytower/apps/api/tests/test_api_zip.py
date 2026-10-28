# "><(((º> sabusabu <º)))><"
"""Download multiplo in ZIP: contenuto identico all'originale, elenco con impronte, filigrana, permessi, limiti."""
from __future__ import annotations

import csv
import hashlib
import io
import zipfile

import psycopg
from pypdf import PdfReader
from test_api_documents import des_name, upload, worker  # noqa: F401 - fixture riusata
from test_api_naming_auto import as_user  # noqa: F401 - fixture riusata
from test_api_watermark import real_pdf, watermark  # noqa: F401 - fixture riusata


def _zip(client, w, headers, ids):
    return client.post(f"/projects/{w.project_id}/zip", headers=headers, json={"revision_ids": [str(i) for i in ids]})


def test_zip_con_elenco_e_impronte(client, api_world, as_user, worker):  # noqa: F811
    urls, w = api_world
    h = as_user("des_lead")
    pdf, txt = real_pdf(1, "Pianta"), b"Relazione tecnica\n" * 50
    a = upload(client, h, w.containers["des_arch"], des_name(), pdf, title="Pianta").json()
    b = upload(client, h, w.containers["des_arch"], des_name(ext="txt"), txt, title="Relazione").json()
    worker()
    r = _zip(client, w, h, [a["id"], b["id"], a["id"]])          # i doppioni si ignorano
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/zip"
    assert r.headers["content-disposition"].startswith('attachment; filename="PRJ01-documenti-')
    z = zipfile.ZipFile(io.BytesIO(r.content))
    assert z.testzip() is None
    names = z.namelist()
    assert names[-1] == "elenco.csv" and len(names) == 3
    files = {n: z.read(n) for n in names[:-1]}
    assert sorted(files.values()) == sorted([pdf, txt])          # identici all'originale
    rows = list(csv.DictReader(io.StringIO(z.read("elenco.csv").decode("utf-8-sig")), delimiter=";"))
    assert {r["titolo"] for r in rows} == {"Pianta", "Relazione"}
    for row in rows:
        assert hashlib.sha256(files[row["file"]]).hexdigest() == row["sha256"] and row["filigrana"] == "no"
        assert row["stato"] == "WIP" and row["revisione"] == "P01.01"
    with psycopg.connect(urls.owner) as conn:
        ev = conn.execute("SELECT details FROM cde.security_events WHERE event_type = 'ZIP_DOWNLOADED' "
                          "ORDER BY id DESC LIMIT 1").fetchone()[0]
    assert ev["files"] == 2 and set(ev["revisions"]) == {a["id"], b["id"]}


def test_zip_filigranato_permessi_e_limiti(client, api_world, api_settings, as_user, worker, watermark):  # noqa: F811
    _, w = api_world
    h = as_user("des_lead")
    pdf = real_pdf(2, "Sezione")
    a = upload(client, h, w.containers["des_arch"], des_name(), pdf, title="Sezione").json()
    worker()
    watermark({"states": ["WIP"], "text": "Uso interno"})
    z = zipfile.ZipFile(io.BytesIO(_zip(client, w, h, [a["id"]]).content))
    stamped = z.read(z.namelist()[0])
    assert stamped != pdf
    assert all("Scaricato da" in p.extract_text() for p in PdfReader(io.BytesIO(stamped)).pages)
    row = next(csv.DictReader(io.StringIO(z.read("elenco.csv").decode("utf-8-sig")), delimiter=";"))
    assert row["filigrana"] == "si"
    # chi non può scaricare il WIP di un'altra organizzazione non ottiene nulla (nemmeno il resto dello ZIP)
    assert _zip(client, w, as_user("sub1_user"), [a["id"]]).status_code == 404
    limit = api_settings.zip_max_bytes
    api_settings.zip_max_bytes = 100
    try:
        r = _zip(client, w, h, [a["id"]])
        assert r.status_code == 413 and r.json()["error"]["code"] == "zip_too_large"
    finally:
        api_settings.zip_max_bytes = limit
    assert client.post(f"/projects/{w.project_id}/zip", headers=h, json={"revision_ids": []}).status_code == 422
