# "><(((º> sabusabu <º)))><"
"""Modello glTF binario di prova: contenitore GLB valido, riferimenti coerenti, cubo chiuso con le facce verso
l'esterno (il viewer ne ricava il volume), nomi citati dalle tavole demo, texture PNG incorporata, determinismo.
Che il viewer lo apra lo verifica l'e2e (three.js); che si veda in piattaforma, il tipo servito inline."""
from __future__ import annotations

import struct

import pytest

from cde_api.modules.documents import viewable_type
from cde_api.tooling import glb_model


def _floats(blob: bytes, view: dict, n: int) -> list[tuple[float, ...]]:
    raw = struct.unpack_from(f"<{view['byteLength'] // 4}f", blob, view["byteOffset"])
    return [raw[i:i + n] for i in range(0, len(raw), n)]


def test_glb_valido_e_coerente():
    data = glb_model.build()
    doc, blob = glb_model.parse(data)
    assert doc["asset"]["version"] == "2.0" and doc["buffers"][0]["byteLength"] == len(blob)
    for v in doc["bufferViews"]:
        assert v["byteOffset"] % 4 == 0 and v["byteOffset"] + v["byteLength"] <= len(blob)
    for node in doc["nodes"]:
        assert node.get("mesh", 0) < len(doc["meshes"])
        assert all(c < len(doc["nodes"]) for c in node.get("children", []))
    names = {n["name"] for n in doc["nodes"]}
    for name in ("Piano terra", "Piano 1", "Copertura", "Muro perimetrale sud P0", "Solaio P1", "Tramezzo interno P0",
                 "Pensilina ingresso"):
        assert name in names
    png = doc["bufferViews"][doc["images"][0]["bufferView"]]
    assert blob[png["byteOffset"]:png["byteOffset"] + 8] == b"\x89PNG\r\n\x1a\n"
    pensilina = next(n for n in doc["nodes"] if n["name"] == "Pensilina ingresso")
    assert pensilina["scale"] == [8, 0.25, 4.5] and pensilina["rotation"][1] == pytest.approx(0.130526, abs=1e-6)


def test_cubo_chiuso_con_volume_unitario():
    doc, blob = glb_model.parse(glb_model.build())
    pos = _floats(blob, doc["bufferViews"][0], 3)
    idx_view = doc["bufferViews"][3]
    idx = struct.unpack_from(f"<{doc['accessors'][3]['count']}H", blob, idx_view["byteOffset"])
    vol = 0.0
    for t in range(0, len(idx), 3):
        a, b, c = (pos[i] for i in idx[t:t + 3])
        vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0])
                + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
    assert vol == pytest.approx(1.0)            # positivo: facce rivolte all'esterno


def test_deterministico_e_errori():
    assert glb_model.build() == glb_model.build()
    with pytest.raises(ValueError):
        glb_model.parse(b"glTF" + struct.pack("<II", 1, 12))


def test_glb_e_gltf_visualizzabili():
    assert viewable_type("MODELLO.GLB") == "model/gltf-binary"
    assert viewable_type("scena.gltf") == "model/gltf+json"
    assert viewable_type("progetto.blend") is None
