# "><(((º> sabusabu <º)))><"
"""Viewer DWG senza licenza (G44, ADR-41): il DXF diventa un SVG con un gruppo per layer (colori, layer spenti,
testi, blocchi e quote scomposti, Y invertito), il worker lo prepara dopo la verifica come derivato SVG, l'API lo
offre al viewer con l'elenco dei layer e la stessa visibilità del file; un DWG senza ODA File Converter resta
scaricabile, con il motivo scritto nel derivato."""
from __future__ import annotations

import re
import tempfile
import xml.etree.ElementTree as ET  # noqa: S314 - l'SVG lo produce il nostro convertitore, non un utente
from pathlib import Path

import httpx
import psycopg
import pytest
from psycopg.rows import dict_row
from test_api_documents import as_user, des_name, upload  # noqa: F401 - fixture

from cde_api import dxf2svg
from cde_api.scanner import EicarScanner
from cde_api.tooling import dxf_sample
from cde_api.worker import make_svg_derivatives, verify_file

DXF = dxf_sample.build(1, "Pianta di prova", ["Ingresso", "Ufficio 1", "Sala riunioni"])
NS = {"s": "http://www.w3.org/2000/svg"}


@pytest.fixture(scope="module")
def converted() -> tuple[ET.Element, dxf2svg.Result, str]:
    with tempfile.TemporaryDirectory() as tmp:
        src, dst = Path(tmp) / "pianta.dxf", Path(tmp) / "pianta.svg"
        src.write_bytes(DXF)
        result = dxf2svg.convert(src, dst)
        text = dst.read_text("utf-8")
    return ET.fromstring(text), result, text  # noqa: S314


def test_svg_con_un_gruppo_per_layer(converted):
    root, result, text = converted
    assert root.tag == "{http://www.w3.org/2000/svg}svg" and root.get("data-units") == "mm"
    groups = {g.get("data-layer"): g for g in root.findall("s:g", NS)}
    assert {"ARCH", "STRUT", "QUOTE", "TESTI", "ARREDI", "NASCOSTO", "Defpoints"} <= set(groups)
    assert groups["STRUT"].get("data-color") == "#ff0000" and groups["TESTI"].get("data-color") == "#0000ff"
    # layer spento nel DXF e Defpoints: presenti ma nascosti, così il viewer li può accendere
    assert "display:none" in groups["NASCOSTO"].get("style", "") and "display:none" in groups["Defpoints"].get("style", "")
    assert "display:none" not in groups["ARCH"].get("style", "")
    per_nome = {layer.name: layer for layer in result.layers}
    assert per_nome["NASCOSTO"].visible is False and per_nome["ARCH"].visible is True and per_nome["ARCH"].entities > 10
    # le quote sono blocchi anonimi con entità sul layer "0": prendono il layer dell'INSERT (regola di AutoCAD)
    assert per_nome["QUOTE"].entities >= 10 and "0" not in per_nome
    # testi con l'Y invertito, hatch dei pilastri riempiti, linee sottili a qualunque zoom
    testi = [t.text for t in root.iter("{http://www.w3.org/2000/svg}text")]
    assert "Ingresso" in testi and "Pianta di prova" in testi and "Cosedil S.p.A." in testi
    assert 'fill-opacity="0.25"' in text and 'vector-effect="non-scaling-stroke"' in text
    assert "<script" not in text and "javascript" not in text
    # viewBox in unità del disegno: la pianta è 18 x 12 m con quote fuori, l'Y del DXF è invertito
    vb = [float(v) for v in root.get("viewBox").split()]
    assert 19_000 < vb[2] < 21_000 and 15_000 < vb[3] < 17_000 and vb[1] < -12_000
    assert result.bbox[2] - result.bbox[0] > 18_000 and result.entities > 40


def test_dwg_senza_oda_spiega_cosa_manca(monkeypatch, tmp_path):
    monkeypatch.setattr(dxf2svg, "find_oda_converter", lambda configured=None: None)
    src = tmp_path / "pianta.dwg"
    src.write_bytes(b"AC1032" + b"\0" * 100)
    with pytest.raises(dxf2svg.DwgConverterMissing, match="ODA File Converter"):
        dxf2svg.convert(src, tmp_path / "pianta.svg")


def test_dxf_rotto_e_vuoto(tmp_path):
    (tmp_path / "rotto.dxf").write_bytes(b"non un dxf\n" * 50)
    with pytest.raises(Exception):  # noqa: B017 - ezdxf solleva la sua eccezione, al worker basta che sia un errore
        dxf2svg.convert(tmp_path / "rotto.dxf", tmp_path / "rotto.svg")
    import ezdxf
    vuoto = ezdxf.new("R2010")
    vuoto.saveas(tmp_path / "vuoto.dxf")
    with pytest.raises(RuntimeError, match="vuoto"):
        dxf2svg.convert(tmp_path / "vuoto.dxf", tmp_path / "vuoto.svg")


def test_oda_cercato_in_configurazione_e_path(monkeypatch, tmp_path):
    exe = tmp_path / "ODAFileConverter.exe"
    exe.write_bytes(b"")
    assert dxf2svg.find_oda_converter(str(exe)) == str(exe)
    monkeypatch.setattr(dxf2svg.shutil, "which", lambda name: None)
    monkeypatch.setattr(dxf2svg.glob, "glob", lambda pattern: [])
    assert dxf2svg.find_oda_converter(str(tmp_path / "manca.exe")) is None


# ----------------------------------------------------------------------------------------------- worker + API
@pytest.fixture(autouse=True)
def bucket(api_app):
    """I test con mock_aws (eseguiti prima in ordine alfabetico) azzerano lo stato globale di moto."""
    api_app.state.services.storage.ensure_bucket()


def _verify(urls, api_app, **kw):
    with psycopg.connect(urls.worker, row_factory=dict_row) as conn:
        pending = [r["id"] for r in conn.execute("SELECT id FROM cde.file_objects WHERE scan_status = 'PENDING'").fetchall()]
        conn.commit()
        for fid in pending:
            verify_file(conn, api_app.state.services.storage, EicarScanner(), fid, **kw)


def _derivative_row(conn, revision_id):
    return conn.execute("SELECT d.* FROM cde.file_derivatives d JOIN cde.document_revisions r "
                        "ON r.file_object_id = d.file_object_id WHERE r.id = %s AND d.kind = 'SVG'", [revision_id]).fetchone()


def test_dxf_caricato_pronto_per_il_viewer(client, api_app, api_world, as_user):  # noqa: F811
    urls, w = api_world
    h = as_user("des_lead")
    rev = upload(client, h, w.containers["des_arch"], des_name(ext="dxf"), DXF, title="Pianta DXF").json()
    _verify(urls, api_app)
    link = client.get(f"/revisions/{rev['id']}/download?disposition=inline", headers=h).json()
    assert link["content_type"] == "image/vnd.dxf"
    d = link["derivative"]
    assert d["status"] == "READY" and d["size_bytes"] > 0 and d["parts"] is None and d["detail"] is None
    nomi = {layer["name"]: layer for layer in d["layers"]}
    assert nomi["ARCH"]["visible"] is True and nomi["NASCOSTO"]["visible"] is False and nomi["STRUT"]["color"] == "#ff0000"
    with httpx.Client() as s3:
        r = s3.get(d["url"])
        assert r.status_code == 200 and r.headers["content-type"].startswith("image/svg+xml")
        assert re.search(rb'<g data-layer="ARCH"', r.content) and b"Ufficio 1" in r.content
    # stessa visibilità del file: la WIP di DES non si vede da un'altra organizzazione
    assert client.get(f"/revisions/{rev['id']}/download?disposition=inline", headers=as_user("sub1_user")).status_code in (403, 404)
    # un PDF non chiede nessun derivato SVG
    pdf = upload(client, h, w.containers["des_arch"], des_name(ext="pdf"), b"%PDF-1.7\n" + b"x" * 500, title="PDF").json()
    _verify(urls, api_app)
    with psycopg.connect(urls.owner, row_factory=dict_row) as conn:
        assert _derivative_row(conn, pdf["id"]) is None


def test_dwg_senza_convertitore_resta_scaricabile(client, api_app, api_world, as_user, monkeypatch):  # noqa: F811
    """Senza ODA File Converter il derivato fallisce subito con il motivo (FAILED al primo tentativo, migrazione 0037):
    ritentare non servirebbe e il viewer deve mostrare il motivo e il download, non "in preparazione"."""
    urls, w = api_world
    monkeypatch.setattr(dxf2svg, "find_oda_converter", lambda configured=None: None)
    h = as_user("des_lead")
    rev = upload(client, h, w.containers["des_arch"], des_name(ext="dwg"), b"AC1032" + b"\0" * 2000, title="DWG").json()
    _verify(urls, api_app)
    link = client.get(f"/revisions/{rev['id']}/download?disposition=inline", headers=h).json()
    assert link["content_type"] == "image/vnd.dwg" and link["url"]
    # la verifica prova subito il derivato: senza ODA e' FAILED al primo colpo e il job periodico non lo riprende
    assert link["derivative"]["status"] == "FAILED" and link["derivative"]["url"] is None
    storage = api_app.state.services.storage
    with psycopg.connect(urls.worker, row_factory=dict_row) as worker:
        make_svg_derivatives(worker, storage, limit=20, stale="0 seconds")
    with psycopg.connect(urls.owner, row_factory=dict_row) as conn:
        row = _derivative_row(conn, rev["id"])
    assert row["status"] == "FAILED" and row["attempts"] == 1 and "ODA File Converter" in row["detail"]
    d = client.get(f"/revisions/{rev['id']}/download?disposition=inline", headers=h).json()["derivative"]
    assert d["status"] == "FAILED" and "ODA File Converter" in d["detail"]
