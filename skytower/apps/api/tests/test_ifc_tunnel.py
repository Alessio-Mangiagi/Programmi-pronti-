# "><(((º> sabusabu <º)))><"
"""Modello IFC4 della galleria (cde genera-galleria): schema valido per IfcOpenShell, tratte come piani, conci con
rivestimento, impianti e proprietà; il derivato .glb si divide per tratta."""
from __future__ import annotations

import tempfile
from collections import Counter
from pathlib import Path

import ifcopenshell
import ifcopenshell.util.element as ue

from cde_api import ifc2glb
from cde_api.tooling import ifc_tunnel


def test_galleria():
    data = ifc_tunnel.build(lunghezza=240.)
    assert data == ifc_tunnel.build(lunghezza=240.)                      # deterministico
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "g.ifc"
        src.write_bytes(data)
        model = ifcopenshell.open(str(src))
        assert model.schema == "IFC4" and model.by_type("IfcProject")[0].Name == "141-103-2 - Galleria Fortolese"
        kinds = Counter(e.is_a() for e in model.by_type("IfcElement"))
        assert kinds["IfcFan"] > 0 and kinds["IfcLightFixture"] == 2 * 20 and kinds["IfcWall"] == 6
        storeys = [s.Name for s in model.by_type("IfcBuildingStorey")]
        assert [s.split(" (")[0] for s in storeys] == ["Imbocco Nord", "Tratta in naturale", "Imbocco Sud"]
        ring = next(e for e in model.by_type("IfcBuildingElementProxy") if e.Name == "Rivestimento definitivo C010")
        psets = ue.get_psets(ring)
        assert psets["Pset_CDE_Galleria"]["Progressiva"] == "0+108"
        assert psets["Pset_CDE_Galleria"]["Classe calcestruzzo"] == "C30/37"
        result = ifc2glb.convert(src, Path(tmp) / "g.glb", threads=2, parts_dir=Path(tmp) / "pezzi")
    assert result.elements == sum(kinds.values())                       # tutti gli elementi hanno geometria
    assert [p.name.split(" (")[0] for p in result.parts] == ["Imbocco Nord", "Tratta in naturale", "Imbocco Sud"]
