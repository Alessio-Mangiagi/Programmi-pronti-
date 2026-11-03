# "><(((º> sabusabu <º)))><"
"""Demo parlante (tooling/demo_commesse.py): i file generati sono validi e la logica non chiama l'API dai test."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import filetype

_PATH = Path(__file__).resolve().parents[3] / "tooling" / "demo_commesse.py"
_spec = importlib.util.spec_from_file_location("demo_commesse", _PATH)
demo = importlib.util.module_from_spec(_spec)
sys.modules["demo_commesse"] = demo
_spec.loader.exec_module(demo)


def test_file_generati_validi():
    s = demo.COMMESSE[0]
    tav = demo.tavola_pdf(1, "101-003 - Sede Acireale", "Pianta piano terra", "ACI003-DES-ZZ-00-DR-A-0001", "P01.01", s["locali"], pages=2)
    assert tav.startswith(b"%PDF") and filetype.guess(tav).mime == "application/pdf"
    assert demo.tavola_pdf(1, "p", "t", "c", "P01.01", s["locali"], "strutt") != demo.tavola_pdf(1, "p", "t", "c", "P02.01", s["locali"], "strutt", variant=1)
    assert demo.tavola_pdf(2, "p", "t", "c", "P01.01", s["locali"], "imp").startswith(b"%PDF")
    rel = demo.relazione_pdf(3, "p", "Relazione", "c", "P01.01", ["Premessa", "Soggetti"], "intro",
                             righe_fisse={"Soggetti": ["Committente: Cosedil S.p.A."]})
    assert filetype.guess(rel).mime == "application/pdf"
    assert filetype.guess(demo.computo_pdf("p", "c", "P01.01", s["voci"])).mime == "application/pdf"
    assert filetype.guess(demo.cronoprogramma_pdf("p", "c", "P01.01", s["fasi"], 9, "2026-09-01")).mime == "application/pdf"


def test_commesse_coerenti_con_la_suite():
    codici = [c["commessa"] for c in demo.COMMESSE]
    assert codici == ["101-003", "C-2024-015"]                   # stessi codici di InCampo, Magazzino e registro
    for c in demo.COMMESSE:
        assert c["codice"].isalnum() and 2 <= len(c["codice"]) <= 6 and c["codice"].isupper()
        assert c["piani"] and c["voci"] and c["fasi"] and c["locali"]
        assert max(a for _, _, a in c["fasi"]) >= 1
