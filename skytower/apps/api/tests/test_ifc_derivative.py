# "><(((º> sabusabu <º)))><"
"""Derivato .glb degli IFC pesanti (G43, ADR-31): la conversione conserva elementi (GUID), albero spaziale, quote
dei piani, Pset e trasparenze, con Y in alto; il worker lo prepara solo sopra la soglia e l'API lo offre al viewer
insieme all'IFC originale, con la stessa visibilità del file. Il worker lo divide per piano (ADR-36): un indice
con albero e proprietà e un .glb per piano, dal più basso."""
from __future__ import annotations

import math
import re
import struct
import tempfile
from pathlib import Path

import httpx
import psycopg
import pytest
from psycopg.rows import dict_row
from test_api_documents import as_user, des_name, upload  # noqa: F401 - fixture

from cde_api import ifc2glb
from cde_api.scanner import EicarScanner
from cde_api.tooling import glb_model, ifc_complex
from cde_api.worker import verify_file

IFC = ifc_complex.build()


@pytest.fixture(scope="module")
def converted() -> tuple[dict, bytes, ifc2glb.Result]:
    with tempfile.TemporaryDirectory() as tmp:
        src, dst = Path(tmp) / "m.ifc", Path(tmp) / "m.glb"
        src.write_bytes(IFC)
        result = ifc2glb.convert(src, dst, threads=2)
        data = dst.read_bytes()
    doc, blob = glb_model.parse(data)
    return doc, blob, result


def test_elementi_albero_e_proprieta(converted):
    doc, blob, result = converted
    nodes = doc["nodes"]
    parts = [n for n in nodes if n["extras"].get("part")]
    assert result.elements == len(parts) > 500 and result.size_bytes > 0
    roots = doc["scenes"][0]["nodes"]
    assert [nodes[i]["extras"]["type"] for i in roots] == ["IfcProject"]
    storeys = {n["name"]: n for n in nodes if n["extras"].get("type") == "IfcBuildingStorey"}
    assert list(storeys) == ["Piano interrato", "Piano terra", "Piano 1", "Piano 2", "Piano 3", "Copertura"]
    assert storeys["Piano 1"]["extras"]["Elevation"] > storeys["Piano terra"]["extras"]["Elevation"]
    # ogni elemento con geometria sta sotto un piano, con il GUID dell'IFC
    ifc_guids = set(re.findall(rb"^#\d+=IFC\w+\('([0-9A-Za-z_$]{22})'", IFC, re.M))
    under = {k for s in storeys.values() for k in s.get("children", [])}
    walls = [n for n in nodes if n["extras"].get("type") == "IfcWall"]
    assert walls and all(n["extras"]["GlobalId"].encode() in ifc_guids for n in walls)
    assert all(nodes.index(w) in under for w in walls)
    muro = next(n for n in nodes if n.get("name") == "Muro perimetrale sud P0")
    assert any(name.startswith("Pset_WallCommon") for name in muro["extras"]["Psets"])
    assert any(m.get("alphaMode") == "BLEND" for m in doc["materials"])          # vetri trasparenti
    # la geometria di ogni elemento sta nel suo nodo "part", con la matrice di posizionamento
    assert all(len(w["children"]) == 1 and nodes[w["children"][0]]["extras"]["part"] for w in walls)


def _part(doc, name):
    node = next(n for n in doc["nodes"] if n.get("name") == name)
    return doc["nodes"][node["children"][0]]


def test_assi_matrici_e_misure(converted):
    doc, blob, _ = converted
    # matrici glTF per colonne: traslazione in 12-14; Y in alto (sei livelli), vicino all'origine
    low, high = _part(doc, "Muro perimetrale sud P0")["matrix"], _part(doc, "Muro perimetrale sud P3")["matrix"]
    assert high[13] - low[13] > 9 and abs(low[12]) < 1000 and abs(low[14]) < 1000
    # pensilina ruotata di 15° attorno alla verticale: la rotazione sta nella matrice, la geometria resta 8 × 4,5
    m = _part(doc, "Pensilina ingresso")
    assert abs(m["matrix"][0] - math.cos(math.radians(15))) < 1e-3
    acc = doc["accessors"][doc["meshes"][m["mesh"]]["primitives"][0]["attributes"]["POSITION"]]
    size = sorted(round(hi - lo, 2) for lo, hi in zip(acc["min"], acc["max"], strict=True))
    assert size == [0.25, 4.5, 8.0]
    view = doc["bufferViews"][doc["accessors"][0]["bufferView"]]
    assert view["byteOffset"] + view["byteLength"] <= len(blob)
    struct.unpack_from("<3f", blob, view["byteOffset"])


def test_diviso_per_piano():
    with tempfile.TemporaryDirectory() as tmp:
        src, dst = Path(tmp) / "m.ifc", Path(tmp) / "m.glb"
        src.write_bytes(IFC)
        result = ifc2glb.convert(src, dst, threads=2, parts_dir=Path(tmp) / "piani")
        index, blob = glb_model.parse(dst.read_bytes())
        pieces = [glb_model.parse(p.path.read_bytes()) for p in result.parts]
    nodes = index["nodes"]
    assert blob == b"" and "meshes" not in index and not any(n["extras"].get("part") for n in nodes)
    listed = index["scenes"][0]["extras"]["parts"]
    assert [p["name"] for p in listed] == ["Piano interrato", "Piano terra", "Piano 1", "Piano 2", "Piano 3", "Copertura"]
    assert [p.name for p in result.parts] == [p["name"] for p in listed]
    assert sum(p["elements"] for p in listed) == result.elements > 500
    for meta, (doc, data) in zip(listed, pieces, strict=True):
        assert nodes[meta["storey"]]["name"] == meta["name"] and len(doc["nodes"]) == meta["elements"]
        assert all(n["extras"]["part"] and "mesh" in n for n in doc["nodes"]) and data
        # ogni pezzo porta l'elemento del suo piano: l'owner è un figlio del piano nell'indice
        assert all(n["extras"]["owner"] in nodes[meta["storey"]]["children"] for n in doc["nodes"])
    muro = nodes.index(next(n for n in nodes if n.get("name") == "Muro perimetrale sud P1"))
    assert any(n["extras"]["owner"] == muro for n in pieces[2][0]["nodes"])


@pytest.fixture(autouse=True)
def bucket(api_app):
    """I test con mock_aws (eseguiti prima in ordine alfabetico) azzerano lo stato globale di moto."""
    api_app.state.services.storage.ensure_bucket()


def _verify(urls, api_app, min_bytes):
    with psycopg.connect(urls.worker, row_factory=dict_row) as conn:
        pending = [r["id"] for r in conn.execute("SELECT id FROM cde.file_objects WHERE scan_status = 'PENDING'").fetchall()]
        conn.commit()
        for fid in pending:
            verify_file(conn, api_app.state.services.storage, EicarScanner(), fid, derivative_min_bytes=min_bytes)


def test_worker_e_api(client, api_app, api_world, as_user):  # noqa: F811
    urls, w = api_world
    h = as_user("des_lead")
    big = upload(client, h, w.containers["des_arch"], des_name(ext="ifc"), IFC, title="Modello pesante").json()
    _verify(urls, api_app, min_bytes=1)
    link = client.get(f"/revisions/{big['id']}/download?disposition=inline", headers=h).json()
    assert link["content_type"] == "application/x-step"
    d = link["derivative"]
    assert d["status"] == "READY" and d["size_bytes"] > 0
    assert [p["name"] for p in d["parts"]][:2] == ["Piano interrato", "Piano terra"] and len(d["parts"]) == 6
    with httpx.Client() as s3:
        index, _ = glb_model.parse(s3.get(d["url"]).content)
        assert len(index["scenes"][0]["extras"]["parts"]) == 6
        piece, data = glb_model.parse(s3.get(d["parts"][1]["url"]).content)
        assert len(piece["nodes"]) == d["parts"][1]["elements"] and data

    small = upload(client, h, w.containers["des_arch"], des_name(ext="ifc"), IFC, title="Modello leggero").json()
    _verify(urls, api_app, min_bytes=len(IFC) + 1)                 # sotto soglia: il viewer usa l'IFC
    assert client.get(f"/revisions/{small['id']}/download?disposition=inline", headers=h).json()["derivative"] is None
    # stessa visibilità del file: la WIP di DES non si vede da un'altra organizzazione
    assert client.get(f"/revisions/{big['id']}/download?disposition=inline", headers=as_user("sub1_user")).status_code in (403, 404)


def test_ifc_non_valido_non_blocca(client, api_app, api_world, as_user):  # noqa: F811
    urls, w = api_world
    h = as_user("des_lead")
    rev = upload(client, h, w.containers["des_arch"], des_name(ext="ifc"), b"ISO-10303-21;\nnon un modello\n" * 100,
                 title="IFC rotto").json()
    _verify(urls, api_app, min_bytes=1)
    with psycopg.connect(urls.owner, row_factory=dict_row) as conn:
        row = conn.execute("SELECT d.status, d.attempts, d.detail FROM cde.file_derivatives d JOIN cde.document_revisions r "
                           "ON r.file_object_id = d.file_object_id WHERE r.id = %s", [rev["id"]]).fetchone()
    assert row["status"] == "PENDING" and row["attempts"] == 1 and row["detail"]    # riprova il job periodico
    link = client.get(f"/revisions/{rev['id']}/download?disposition=inline", headers=h).json()
    assert link["url"] and link["derivative"]["status"] == "PENDING" and link["derivative"]["url"] is None
