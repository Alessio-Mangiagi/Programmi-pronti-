# -*- coding: utf-8 -*-
# "><(((º> sabusabu <º)))><"
"""Test delle funzioni pure di importer e notifiche.

L'app non aveva nessun test: le regole che decidono se una scadenza va
notificata, e come viene letto un file Excel dell'ufficio, si verificavano solo
aprendo la pagina e guardando. Qui non serve né il database né un file vero:
sono tutte funzioni che prendono valori e restituiscono valori.
"""
import sys
from datetime import date, datetime
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config  # noqa: E402
import importer  # noqa: E402
import notifiche  # noqa: E402
import scadenze  # noqa: E402


# ----- importer: intestazioni -----

def test_normalizza_header_comprime_gli_a_capo():
    # Le intestazioni Excel dell'ufficio vanno spesso a capo dentro la cella.
    assert importer._normalizza_header("Codice\nfiscale") == "CODICE FISCALE"


def test_normalizza_header_su_cella_vuota():
    assert importer._normalizza_header(None) == ""


def test_chiave_intestazione_toglie_accenti_e_spazi():
    assert importer.chiave_intestazione("Codice fiscale") == "codice_fiscale"
    assert importer.chiave_intestazione("Classe di rischio") == "classe_di_rischio"
    assert importer.chiave_intestazione("Località") == "localita"


def test_chiave_intestazione_non_lascia_trattini_ai_bordi():
    assert importer.chiave_intestazione("  (Note) ") == "note"


# ----- importer: date -----

@pytest.mark.parametrize("testo,atteso", [
    ("08/04/2026", "2026-04-08"),
    ("2026-04-08", "2026-04-08"),
    ("08-04-2026", "2026-04-08"),
    ("08/04/26", "2026-04-08"),
])
def test_cella_a_data_iso_accetta_i_formati_usati_in_ufficio(testo, atteso):
    assert importer._cella_a_data_iso(testo) == atteso


def test_cella_a_data_iso_legge_i_datetime_di_openpyxl():
    assert importer._cella_a_data_iso(datetime(2026, 4, 8, 10, 30)) == "2026-04-08"
    assert importer._cella_a_data_iso(date(2026, 4, 8)) == "2026-04-08"


def test_cella_a_data_iso_su_valore_non_data():
    assert importer._cella_a_data_iso("non una data") is None
    assert importer._cella_a_data_iso("") is None
    assert importer._cella_a_data_iso(None) is None


# ----- importer: valori -----

def test_cella_a_valore_non_lascia_il_punto_zero_sui_numeri_interi():
    # openpyxl legge le celle numeriche come float: senza questo, una matricola
    # "1234" diventava "1234.0" e non combaciava piu' con quella in archivio.
    assert importer._cella_a_valore(1234.0) == "1234"


def test_cella_a_valore_tiene_i_decimali_veri():
    assert importer._cella_a_valore(12.5) == "12.5"


def test_cella_a_valore_su_cella_vuota_o_di_soli_spazi():
    assert importer._cella_a_valore(None) is None
    assert importer._cella_a_valore("   ") is None


def test_conta_non_vuote_ignora_gli_spazi():
    assert importer._conta_non_vuote(["a", "", None, "  ", "b"]) == 2


# ----- notifiche: bande di preavviso -----

def test_banda_scaduta_si_ripete_ogni_giorno():
    assert notifiche._banda_preavviso({"giorni_rimanenti": -3}) == ("scaduta", True)


def test_banda_sceglie_la_soglia_piu_stretta():
    # Soglie: 180, 90, 60, 30, 14, 7, 1, 0. A 20 giorni la piu' stretta >= 20 e' 30.
    assert notifiche._banda_preavviso({"giorni_rimanenti": 20}) == ("soglia_30", False)
    assert notifiche._banda_preavviso({"giorni_rimanenti": 30}) == ("soglia_30", False)
    assert notifiche._banda_preavviso({"giorni_rimanenti": 31}) == ("soglia_60", False)


def test_banda_assente_oltre_la_soglia_piu_ampia():
    oltre = max(config.SOGLIE_PREAVVISO_GIORNI) + 1
    assert notifiche._banda_preavviso({"giorni_rimanenti": oltre}) == (None, False)


def test_banda_a_zero_giorni_scade_oggi():
    assert notifiche._banda_preavviso({"giorni_rimanenti": 0}) == ("soglia_0", False)


# ----- notifiche: testo del messaggio -----

def test_messaggio_scadenza_futura():
    testo = notifiche.formatta_messaggio({
        "tipo_nome": "Visita medica idoneità",
        "soggetto_nome": "Mario Rossi",
        "data_scadenza": "2026-07-01",
        "giorni_rimanenti": 18,
    })
    assert testo == "⚠ Visita medica idoneità di Mario Rossi scade il 01/07/2026 (18 giorni)"


def test_messaggio_scadenza_passata_conta_i_giorni_in_positivo():
    testo = notifiche.formatta_messaggio({
        "tipo_nome": "DURC",
        "soggetto_nome": "Edil Sud S.r.l.",
        "data_scadenza": "2026-06-01",
        "giorni_rimanenti": -12,
    })
    assert testo == "⚠ DURC di Edil Sud S.r.l. scaduta il 01/06/2026 (12 giorni fa)"


def test_messaggio_scadenza_di_oggi_ha_una_forma_sua():
    testo = notifiche.formatta_messaggio({
        "tipo_nome": "DVR",
        "soggetto_nome": "Cosedil S.p.A.",
        "data_scadenza": "2026-06-13",
        "giorni_rimanenti": 0,
    })
    assert testo == "⚠ DVR di Cosedil S.p.A. scade oggi (13/06/2026)"


def test_messaggio_senza_soggetto_usa_il_nome_azienda():
    testo = notifiche.formatta_messaggio({
        "tipo_nome": "DVR",
        "data_scadenza": "2026-07-01",
        "giorni_rimanenti": 5,
    })
    assert notifiche.NOME_AZIENDA in testo


# ----- scadenze: stato calcolato (modulo condiviso da app e notifiche) -----

OGGI = date(2026, 6, 13)


def _riga(**extra):
    base = {
        "soggetto_tipo": "azienda",
        "soggetto_nome": scadenze.NOME_AZIENDA,
        "data_scadenza": "2026-07-01",
        "preavviso_giorni": 30,
        "chiusa": 0,
    }
    base.update(extra)
    return base


def test_arricchisci_calcola_stato_e_giorni():
    s = scadenze.arricchisci_riga(_riga(), OGGI)
    assert s["giorni_rimanenti"] == 18
    assert s["stato"] == "in_scadenza"          # 18 <= preavviso 30


def test_arricchisci_scadenza_ancora_lontana_e_valida():
    s = scadenze.arricchisci_riga(_riga(data_scadenza="2026-12-31"), OGGI)
    assert s["stato"] == "valida"


def test_arricchisci_scadenza_passata():
    s = scadenze.arricchisci_riga(_riga(data_scadenza="2026-06-01"), OGGI)
    assert s["stato"] == "scaduta"
    assert s["giorni_rimanenti"] == -12


def test_arricchisci_una_chiusa_resta_chiusa_anche_se_scaduta():
    s = scadenze.arricchisci_riga(_riga(data_scadenza="2026-06-01", chiusa=1), OGGI)
    assert s["stato"] == "chiusa"


def test_arricchisci_senza_preavviso_configurato():
    # preavviso_giorni NULL in archivio: non deve diventare "in_scadenza" da sola.
    s = scadenze.arricchisci_riga(_riga(preavviso_giorni=None), OGGI)
    assert s["stato"] == "valida"
