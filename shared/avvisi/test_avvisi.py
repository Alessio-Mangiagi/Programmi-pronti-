# -*- coding: utf-8 -*-
# "><(((º> sabusabu <º)))><"
"""Test di shared/avvisi/avvisi.py: python -m pytest shared/avvisi"""
import json
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import avvisi  # noqa: E402


def _presi(cartella):
    out = [json.loads((cartella / n).read_text(encoding="utf-8")) for n in sorted(os.listdir(cartella))]
    for n in os.listdir(cartella):
        os.unlink(cartella / n)
    return out


def test_segnala_scrive_un_file_completo(tmp_path, monkeypatch):
    monkeypatch.setenv("SUITE_AVVISI_DIR", str(tmp_path))
    assert avvisi.segnala("scadenzario", "Ciao", livello="boh") is True
    assert avvisi.segnala("", "senza app") is False
    (a,) = _presi(tmp_path)
    assert (a["app"], a["titolo"], a["livello"]) == ("scadenzario", "Ciao", "attenzione")


def test_sotto_pytest_senza_cartella_non_scrive_nel_portale(monkeypatch):
    monkeypatch.delenv("SUITE_AVVISI_DIR", raising=False)
    assert avvisi.cartella_avvisi() == ""
    assert avvisi.segnala("x", "y") is False


def test_errori_dal_log_accorpati_e_frenati(tmp_path, monkeypatch):
    monkeypatch.setenv("SUITE_AVVISI_DIR", str(tmp_path))
    log = logging.getLogger("test-avvisi")
    log.propagate = False
    h = avvisi.collega_log("vfp", log)
    assert avvisi.collega_log("vfp", log) is h  # idempotente
    try:
        log.warning("solo un warning")
        log.error(r"Job 12 fallito su C:\dati\a.pdf")
        log.error(r"Job 13 fallito su C:\dati\b.pdf")  # stessa chiave: frenato
        try:
            1 / 0
        except ZeroDivisionError:
            log.exception("Boom")
    finally:
        log.removeHandler(h)
    presi = _presi(tmp_path)
    assert sorted(a["chiave"] for a in presi) == ["log:Boom", "log:Job # fallito su <percorso>"]
    boom = next(a for a in presi if a["chiave"] == "log:Boom")
    assert "ZeroDivisionError" in boom["testo"]
