# "><(((º> sabusabu <º)))><"
"""Modello IFC complesso di prova: STEP coerente (ogni #riferimento esiste), entità attese, GUID IFC validi,
stesso file a ogni generazione. Che il viewer lo apra lo verifica l'e2e (web-ifc)."""
from __future__ import annotations

import re
import uuid

from cde_api.tooling import ifc_complex


def _parse(data: bytes) -> dict[int, str]:
    body = data.decode("utf-8").split("DATA;\n", 1)[1]
    return {int(m.group(1)): m.group(2) for m in re.finditer(r"^#(\d+)=(.*);$", body, re.M)}


def test_modello_coerente_e_completo():
    data = ifc_complex.build()
    assert data.startswith(b"ISO-10303-21;") and b"FILE_SCHEMA(('IFC4'))" in data and data.endswith(b"END-ISO-10303-21;\n")
    ents = _parse(data)
    missing = {int(r) for v in ents.values() for r in re.findall(r"#(\d+)", v)} - ents.keys()
    assert not missing
    kinds = {}
    for v in ents.values():
        kinds[v.split("(", 1)[0]] = kinds.get(v.split("(", 1)[0], 0) + 1
    assert kinds["IFCBUILDINGSTOREY"] == 6
    assert kinds["IFCWALL"] >= 80 and kinds["IFCCOLUMN"] >= 100 and kinds["IFCBEAM"] >= 200
    assert kinds["IFCWINDOW"] >= 50 and kinds["IFCDOOR"] >= 50
    assert kinds["IFCOPENINGELEMENT"] == kinds["IFCWINDOW"] + kinds["IFCDOOR"]
    assert kinds["IFCRELVOIDSELEMENT"] == kinds["IFCRELFILLSELEMENT"] == kinds["IFCOPENINGELEMENT"]
    for k in ("IFCSTAIR", "IFCRAILING", "IFCROOF", "IFCSPACE", "IFCFURNISHINGELEMENT", "IFCELEMENTQUANTITY",
              "IFCMATERIAL", "IFCSTYLEDITEM"):
        assert kinds.get(k), k
    # nomi citati dalle tavole demo ("Citato in" nel viewer)
    for name in ("Muro perimetrale sud P0", "Tramezzo interno P1", "Solaio P2", "Pensilina ingresso"):
        assert f"'{name}'".encode() in data
    guids = re.findall(rb"^#\d+=IFC\w+\('([0-9A-Za-z_$]{22})'", data, re.M)
    assert len(guids) == len(set(guids)) > 1000 and all(g[:1] in b"0123" for g in guids)


def test_deterministico_e_padiglioni():
    assert ifc_complex.build() == ifc_complex.build()
    four = ifc_complex.build(padiglioni=4)
    assert four.count(b"=IFCBUILDING(") == 4 and four.count(b"=IFCBUILDINGSTOREY(") == 24


def test_guid_ifc():
    assert ifc_complex.ifc_guid(uuid.UUID(int=0)) == "0" * 22
    assert len(ifc_complex.ifc_guid(uuid.uuid4())) == 22
