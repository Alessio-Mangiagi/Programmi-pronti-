# "><(((º> sabusabu <º)))><"
"""Generatori dei contenuti demo: file validi e riconosciuti dal controllo di tipo del worker."""
from __future__ import annotations

import filetype

from cde_api.tooling import demo_content as dc


def test_file_generati_validi():
    pdf = dc.drawing_pdf(1, "Pianta piano terra", "PRJ01-DES-ZZ-00-DR-A-0001", "P01.01", pages=2)
    assert pdf.startswith(b"%PDF") and filetype.guess(pdf).mime == "application/pdf"
    assert dc.drawing_pdf(1, "x", "c", "P01.01") != dc.drawing_pdf(1, "x", "c", "P02.01", variant=1)
    assert dc.report_pdf(2, "Relazione", "c", "P01.01", ["Premessa", "Impianti"]).startswith(b"%PDF")
    png = dc.photo_png(3, "Cantiere")
    assert filetype.guess(png).mime == "image/png"
    ifc = dc.ifc_model(4, storeys=3).decode()
    assert ifc.startswith("ISO-10303-21;") and ifc.count("IFCBUILDINGSTOREY(") == 3 and ifc.count("IFCWALL(") == 15
    assert ifc.rstrip().endswith("END-ISO-10303-21;")
    rows = dc.schedule_csv(5, [("PRJ01-DES-ZZ-00-DR-A-0001", "Pianta")]).decode().splitlines()
    assert rows[0].startswith("Codice;") and len(rows) == 2
    assert "Art. 2 - Rivestimenti" in dc.spec_txt("Capitolato", ["Pavimenti", "Rivestimenti"]).decode()
