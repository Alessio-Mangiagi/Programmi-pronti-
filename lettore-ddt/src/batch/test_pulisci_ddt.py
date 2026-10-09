# -*- coding: utf-8 -*-
"""
Test della classificazione delle pagine di pulisci_ddt.py.

Perche' questi test contano: un falso positivo costa frazioni di centesimo
(una pagina inutile in piu' mandata all'API), un falso negativo fa sparire un
DDT dalla contabilita' dei getti. I casi "tieni" sono quindi piu' importanti
dei casi "scarta", e sono scritti col testo sporco che esce davvero dall'OCR
su una scansione (spaziature perse, O/0 confusi, righe spezzate).

Si lancia con l'interprete del progetto OCR, che e' quello che esegue lo script:
  ..\\ocr-documenti\\.venv-gpu\\Scripts\\python.exe -m pytest src/batch/test_pulisci_ddt.py
oppure senza pytest:
  ..\\ocr-documenti\\.venv-gpu\\Scripts\\python.exe src/batch/test_pulisci_ddt.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# valuta() non tocca PaddleOCR: si importa senza caricare modelli.
from pulisci_ddt import valuta  # noqa: E402


def tieni(testo):
    ok, motivo, _ = valuta(testo)
    return ok, motivo


# ── Pagine che DEVONO essere tenute ──────────────────────────────────────────

def test_bolla_completa():
    ok, _ = tieni(
        "CALCESTRUZZI SPA\nDOCUMENTO DI TRASPORTO N. 12345 del 17/07/2026\n"
        "Targa AB123CD\nClasse C25/30 S4\nQuantita 7,00 m3\nOra carico 08:30"
    )
    assert ok


def test_basta_la_classe_di_resistenza():
    # la classe cls e' la firma inconfondibile di una bolla di calcestruzzo
    ok, motivo = tieni("pagina rovinata, si legge solo C28/35 in mezzo al niente")
    assert ok
    assert "classe cls" in motivo


def test_basta_la_targa():
    ok, motivo = tieni("scansione storta, unica cosa leggibile: EF 456 GH")
    assert ok
    assert "targa" in motivo


def test_classe_con_spazi_dell_ocr():
    # l'OCR su scansione perde spesso gli spazi o li aggiunge
    assert tieni("Classe C 25 / 30 consistenza")[0]
    assert tieni("resistenza C25/30")[0]


def test_due_indizi_deboli_bastano():
    ok, motivo = tieni("Fornitore: Italcementi\nQuantita consegnata 8,00 mc")
    assert ok
    assert "indizi" in motivo


def test_bolla_senza_targa_ne_classe():
    # bolla parziale: niente indizi forti, ma tanti deboli
    ok, _ = tieni(
        "Cliente COSEDIL cantiere VI01\nCemento kg 320 sabbia kg 850\n"
        "ora scarico 09:45\ncalcestruzzo preconfezionato"
    )
    assert ok


def test_pagina_illeggibile_ma_con_un_indizio():
    # nel dubbio si tiene: buttarla farebbe sparire un carico
    assert tieni("l|| ,, ~~ C25/30 ~~ ,,, l||")[0]


# ── Pagine che si possono scartare ───────────────────────────────────────────

def test_pagina_bianca():
    ok, motivo = tieni("")
    assert not ok
    assert "bianca" in motivo


def test_solo_rumore_di_scansione():
    ok, _ = tieni(". , ' ` -")
    assert not ok


def test_copertina():
    ok, _ = tieni("ARCHIVIO DOCUMENTI\nANNO 2026\nCantiere di Viagrande\nRaccoglitore n. 3")
    assert not ok


def test_lettera_di_accompagnamento():
    ok, _ = tieni(
        "Spett.le COSEDIL SPA\nOggetto: trasmissione documentazione\n"
        "Con la presente Vi trasmettiamo in allegato la documentazione richiesta.\n"
        "Distinti saluti"
    )
    # "trasporto/consegna" non c'e', resta al massimo un indizio debole
    assert not ok


def test_pagina_con_un_solo_indizio_debole():
    ok, motivo = tieni("Elenco fornitori accreditati per l'anno in corso")
    assert not ok
    assert "un solo indizio debole" in motivo


# ── Il confine: un certificato NON deve passare per bolla ────────────────────

def test_certificato_di_prova_senza_dati_bolla():
    # attenzione: i certificati citano la classe di resistenza. Se contiene
    # C25/30 la pagina viene tenuta: e' voluto, meglio pagare una pagina in piu'
    # che rischiare di buttare una bolla. Qui il certificato non la cita.
    ok, _ = tieni(
        "CERTIFICATO DI TARATURA\nStrumento: bilancia\nData verifica 01/2026\n"
        "Ente certificatore\nNumero registro 8891"
    )
    assert not ok


# "><(((º> sabusabu <º)))><"
def test_fattura_viene_tenuta_se_parla_di_calcestruzzo_e_mc():
    # falso positivo accettato consapevolmente: due indizi deboli bastano.
    # Costa una pagina, e il modello poi la ignora perche' non e' un DDT.
    ok, _ = tieni("FATTURA n. 55\nFornitura calcestruzzo\nTotale 120,00 mc")
    assert ok


if __name__ == '__main__':
    falliti = 0
    for nome, fn in sorted(globals().items()):
        if not nome.startswith('test_') or not callable(fn):
            continue
        try:
            fn()
            print('  ok   %s' % nome)
        except AssertionError:
            falliti += 1
            print('  FALLITO %s' % nome)
    print()
    print('%d test, %d falliti' % (len([n for n in globals() if n.startswith('test_')]), falliti))
    sys.exit(1 if falliti else 0)
