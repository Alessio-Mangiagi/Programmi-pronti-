# -*- coding: utf-8 -*-
"""Test delle funzioni pure di confronta_pdf (nessun Tesseract richiesto)."""
import io
import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import confronta_pdf as c


# ----- normalizzazione tollerante -----

def test_norm_compare_folds_ocr_noise():
    # O->0, l->1, punteggiatura via, minuscole: "1O0,OO" e "100.00" coincidono
    assert c.norm_compare("Importo: 1O0,OO €", True) == c.norm_compare("importo 100.00 €", True)
    # accenti rimossi
    assert c.norm_compare("Città", True) == c.norm_compare("Citta", True)
    # letture tipiche delle scansioni
    assert c.norm_compare("Il getto", True) == c.norm_compare("ll getto", True)
    assert c.norm_compare("classe", True) == c.norm_compare("ciasse", True)
    assert c.norm_compare("E.12.118", True) == c.norm_compare("€.12.118", True)
    for unita in ("m3", "m?", "m°", "m²"):
        assert c.norm_compare(f"{unita} 736,00", True) == c.norm_compare("m³ 736,00", True)


def test_norm_compare_exact_is_identity():
    assert c.norm_compare("Ciao 0O1l", False) == "Ciao 0O1l"


def test_distinct_numbers_stay_distinct():
    # importi diversi non devono diventare uguali in modo tollerante
    assert c.norm_compare("100", True) != c.norm_compare("200", True)
    assert c.norm_compare("1.245.900", True) != c.norm_compare("1.245.901", True)
    # nessuna coppia di cifre diverse può coincidere (prima 6 e 9 -> "g")
    for x in "0123456789":
        for y in "0123456789":
            if x != y:
                assert c.norm_compare(f"385.{x}49,80", True) != c.norm_compare(f"385.{y}49,80", True)


# ----- diff riga -----

# "><(((º> sabusabu <º)))><"
def test_line_ops_tolerant_hides_ocr_noise():
    a = ["Contratto numero 2024/187", "Importo 1.000,00 euro"]
    b = ["Contratto numero 2O24/l87", "Importo 1.OOO,OO euro"]   # solo rumore OCR
    ops = c.line_ops(a, b, tolerant=True)
    assert all(op["type"] == "equal" for op in ops)


def test_line_ops_exact_shows_ocr_noise_as_diff():
    a = ["Importo 1.000,00 euro"]
    b = ["Importo 1.OOO,OO euro"]
    ops = c.line_ops(a, b, tolerant=False)
    assert any(op["type"] != "equal" for op in ops)


def test_line_ops_real_difference_survives_tolerant():
    a = ["Importo 1.000,00 euro"]
    b = ["Importo 2.000,00 euro"]      # differenza vera
    ops = c.line_ops(a, b, tolerant=True)
    assert any(op["type"] in ("change", "del", "add") for op in ops)


def test_word_segments_display_original_text():
    segs_a, segs_b = c.word_segments("Totale 1000 EUR", "Totale 2000 EUR", tolerant=False)
    joined_a = " ".join(s["s"] for s in segs_a)
    assert joined_a == "Totale 1000 EUR"       # testo originale preservato
    changed = [s["s"] for s in segs_a if not s["eq"]]
    assert "1000" in changed


# ----- allineamento pagine -----

def test_align_identical_pages():
    t = ["alpha " * 30, "beta " * 30, "gamma " * 30]
    pairs = c.align_pages(t, t)
    assert pairs == [(0, 0), (1, 1), (2, 2)]


def test_align_detects_inserted_page():
    t1 = ["alpha " * 30, "gamma " * 30]
    t2 = ["alpha " * 30, "beta " * 30, "gamma " * 30]
    pairs = c.align_pages(t1, t2)
    assert (None, 1) in pairs                    # 'beta' inserita in B
    assert (0, 0) in pairs and (1, 2) in pairs


def test_align_banded_long_docs():
    # 80 pagine (> 60: banda attiva) che si differenziano solo per il numero:
    # la banda deve comunque allineare 1:1. Testo corto apposta: con "* 40" il
    # test da solo durava oltre due minuti (SequenceMatcher su testo ripetitivo).
    pages = [f"pagina numero {i} " * 4 for i in range(80)]
    pairs = c.align_pages(pages, list(pages))
    assert pairs == [(i, i) for i in range(80)]


# ----- soglie / binarizzazione -----

def test_otsu_threshold_bimodal():
    arr = np.concatenate([np.full(500, 30, np.uint8), np.full(500, 220, np.uint8)])
    thr = c._otsu_threshold(arr)
    # soglia inclusiva: separa i due modi (30 = confine della classe scura)
    assert 30 <= thr < 220
    assert (arr <= thr).sum() == 500          # esattamente il modo scuro è "inchiostro"


def test_boxsum_matches_naive():
    a = np.arange(36, dtype=np.float64).reshape(6, 6)
    w = 3
    got = c._boxsum(a, w)
    # confronto con padding 'edge' esplicito
    pad = w // 2
    ap = np.pad(a, pad, mode="edge")
    naive = np.zeros_like(a)
    for i in range(6):
        for j in range(6):
            naive[i, j] = ap[i:i + w, j:j + w].sum()
    assert np.allclose(got, naive)


def test_sauvola_binary_separates_text():
    # Sauvola rileva i tratti (contrasto locale), non i grandi pieni uniformi:
    # righe sottili scure su sfondo chiaro devono risultare inchiostro.
    img = np.full((80, 80), 225, np.uint8)
    img[::8, :] = 40                  # righe orizzontali sottili scure
    ink = c._sauvola_binary(img, window=15)
    assert ink[0, 40]                 # su una riga scura = inchiostro
    assert not ink[4, 40]            # tra le righe (sfondo chiaro) = sfondo


# ----- preprocessing -----

def _png(arr) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, format="PNG")
    return buf.getvalue()


def test_preprocess_returns_valid_png():
    arr = np.full((200, 400), 240, np.uint8)
    arr[80:120, 40:360] = 30                 # una banda di "testo"
    out = c.preprocess_for_ocr(_png(arr))
    im = Image.open(io.BytesIO(out))
    im.load()
    assert im.width >= 400                     # upscala verso ~300 DPI


def test_preprocess_never_raises_on_garbage():
    assert c.preprocess_for_ocr(b"not-an-image") == b"not-an-image"


def test_estimate_skew_on_straight_page_is_zero():
    arr = np.full((200, 600), 255, np.uint8)
    for y in range(20, 180, 30):
        arr[y:y + 8, 30:570] = 0             # righe orizzontali dritte
    ang = c._estimate_skew(Image.fromarray(arr))
    assert abs(ang) < 0.6


# ----- documenti -----

def test_open_text_document(tmp_path):
    p = tmp_path / "a.txt"
    p.write_text("riga uno\nriga due", encoding="utf-8")
    doc = c.open_document(p)
    assert isinstance(doc, c.TextDocument)
    assert doc.count == 1
    assert "riga uno" in doc.embedded_text(0)
    assert doc.has_images is False


def test_open_image_document(tmp_path):
    p = tmp_path / "a.png"
    Image.fromarray(np.full((50, 50, 3), 200, np.uint8)).save(p)
    doc = c.open_document(p)
    assert isinstance(doc, c.ImageDocument)
    assert doc.count == 1
    assert doc.embedded_text(0) == ""        # immagine: sempre OCR
    assert doc.render_full(0, 200)[:4] == b"\x89PNG"


def test_unsupported_format_raises(tmp_path):
    p = tmp_path / "a.xyz"
    p.write_bytes(b"garbage bytes not a pdf")
    with pytest.raises(c.DocumentError):
        c.open_document(p)


def test_needs_ocr_logic(tmp_path):
    p = tmp_path / "a.txt"
    p.write_text("un testo abbastanza lungo da superare la soglia minima", encoding="utf-8")
    doc = c.open_document(p)
    assert c._needs_ocr(doc, 0) is False        # testo, niente OCR


# ----- cache -----

def test_cache_roundtrip():
    h = "deadbeef" * 8
    c.cache_put(h, 0, 200, "tesseract", "ita", "testo di prova")
    assert c.cache_get(h, 0, 200, "tesseract", "ita") == "testo di prova"
    # chiave diversa (lang) -> miss
    assert c.cache_get(h, 0, 200, "tesseract", "eng") is None
    c._cache_path(h, 0, 200, "tesseract", "ita").unlink(missing_ok=True)


# ----- righe da ignorare (testo in chiaro, jolly # e *) -----

def _ignora(filtri, testo):
    return c.apply_ignore(c.normalize_lines(testo), c.compile_ignore(filtri))


def test_ignore_plain_text_contains_case_insensitive():
    righe = "Computo metrico\nDOCUMENTO RISERVATO - copia\nImporto 1.200,00"
    assert _ignora(["Documento riservato"], righe) == ["Computo metrico", "Importo 1.200,00"]


def test_ignore_hash_matches_any_number():
    righe = "Pagina 3 di 12\nData 21/10/2026\nrev. 15\nImporto 1.200,00\nPagina finale"
    filtri = ["Pagina # di #", "Data #/#/#", "Rev. #"]
    assert _ignora(filtri, righe) == ["Importo 1.200,00", "Pagina finale"]


def test_ignore_star_and_spaces():
    righe = "Timbro   ufficio tecnico del 12\nTimbro mancante"
    assert _ignora(["Timbro * del #"], righe) == ["Timbro mancante"]


def test_ignore_regex_chars_are_literal():
    # niente regex: punti, parentesi e quadre valgono per quello che sono
    righe = "Rev. (A) [bozza]\nRevXAX bozza"
    assert _ignora(["Rev. (A) [bozza]"], righe) == ["RevXAX bozza"]
    assert c.compile_ignore(["(a+)+$", "[rotta"])   # compilano senza errori


def test_ignore_skips_blank_and_too_long():
    assert c.compile_ignore(["", "   ", "x" * (c.MAX_IGNORE_PATTERN_LEN + 1)]) == []


# ----- differenze incerte (probabile rumore OCR) -----

def _change(a, b):
    return [op for op in c.line_ops([a], [b], tolerant=True) if op["type"] != "equal"]


def test_incerta_for_similar_word_misread():
    ops = _change("Commessa 2024/75 - foglio 1", "Commessa 2024/75 - toglio 1")
    assert len(ops) == 1 and ops[0].get("incerta") is True


def test_never_incerta_for_numbers_negations_or_real_words():
    for a, b in [
        ("Importo euro 385.649,80", "Importo euro 385.949,80"),       # cifra
        ("L'impresa deve mantenere pulite le aree", "L'impresa non deve mantenere pulite le aree"),
        ("Lavori nei giorni feriali", "Lavori nei giorni festivi"),
        ("Fornitura di calcestruzzo armato", "Fornitura di conglomerato armato"),
    ]:
        ops = _change(a, b)
        assert ops and not any(op.get("incerta") for op in ops), (a, b)


def test_incerta_only_in_tolerant_mode():
    ops = c.line_ops(["foglio 1"], ["toglio 1"], tolerant=False)
    assert not any(op.get("incerta") for op in ops)


def test_cache_key_depends_on_preprocess():
    h = "cafebabe" * 8
    c.cache_put(h, 0, 200, "tesseract", "ita", "pulito", True)
    assert c.cache_get(h, 0, 200, "tesseract", "ita", False) is None
    c.cache_put(h, 0, 200, "tesseract", "ita", "grezzo", False)
    assert c.cache_get(h, 0, 200, "tesseract", "ita", True) == "pulito"
    assert c.cache_get(h, 0, 200, "tesseract", "ita", False) == "grezzo"
    for pre in (True, False):
        c._cache_path(h, 0, 200, "tesseract", "ita", pre).unlink(missing_ok=True)


# ----- intestazioni/piè di pagina ripetuti -----

def test_righe_ripetute_trovate_e_tolte_solo_ai_bordi():
    def corpo(i):
        return [f"riga {k} del capitolo {'abcde'[i - 1]}" for k in range(6)]
    pagine = [["Cosedil S.p.A. - Commessa 2026/12", f"Capitolo {i}: {'abcde'[i - 1]}"]
              + corpo(i) + [f"Totale foglio {i}: euro {i}.345,67", f"Pagina {i} di 5"]
              for i in range(1, 6)]
    chiavi = c.righe_ripetute(pagine, pagine)
    righe, tolte = c.togli_ripetute(pagine[2], chiavi)
    assert tolte == 2                    # intestazione e "Pagina 3 di 5"
    assert "Totale foglio 3: euro 3.345,67" in righe   # gli importi restano sempre
    assert righe[0] == "Capitolo 3: c"


def test_righe_ripetute_non_su_pochi_documenti():
    assert c.righe_ripetute([["Pagina 1 di 1", "testo"]], [["Pagina 1 di 1", "altro"]]) == set()


# ----- righe spostate e voci con lo stesso codice -----

def test_riga_spostata_non_e_differenza():
    a = ["uno", "due", "tre", "quattro"]
    b = ["due", "tre", "quattro", "uno"]
    ops = c.line_ops(a, b)
    assert [op["type"] for op in ops if op["type"] != "equal"] == ["moved"]


def test_voce_stesso_codice_diventa_change():
    a = ["A.01.003 Scavo di sbancamento", "B.02.010 Muratura in blocchi"]
    b = ["B.02.010 Muratura in blocchi", "A.01.003 Scavo a sezione obbligata per fondazioni"]
    ops = [op for op in c.line_ops(a, b) if op["type"] not in ("equal", "moved")]
    assert len(ops) == 1 and ops[0]["type"] == "change" and ops[0]["voce"] == "A.01.003"


def test_numeri_cambiati_nel_riepilogo():
    ops = c.line_ops(["Importo euro 1.250,00", "Data 21/10/2026", "Testo uguale", "Penale alta"],
                     ["Importo euro 1.280,00", "Data 22/10/2026", "Testo uguale", "Penale bassa"])
    tipi = [n["tipo"] for n in c.numeri_cambiati(ops)]
    assert tipi == ["numero", "data"]               # "Penale" non ha cifre


def test_data_cambiata_in_intestazione_non_e_nascosta():
    # "Rev. ... del <data>" uguale in A e cambiata in B: le due versioni non
    # devono fondersi in un'unica intestazione ignorata
    corpo = ["testo uno", "testo due", "testo tre", "testo quattro", "testo cinque"]
    a = [["Rev. 2 del 01/10/2026"] + corpo + [f"Pagina {i} di 3"] for i in range(1, 4)]
    b = [["Rev. 2 del 15/10/2026"] + corpo + [f"Pagina {i} di 3"] for i in range(1, 4)]
    chiavi = c.righe_ripetute(a, b)
    assert c._chiave_ripetuta("Rev. 2 del 01/10/2026") not in chiavi
    assert c._chiave_ripetuta("Rev. 2 del 15/10/2026") not in chiavi
    assert c._chiave_ripetuta("Pagina 1 di 3") in chiavi
    ops = c.line_ops(c.togli_ripetute(a[0], chiavi)[0], c.togli_ripetute(b[0], chiavi)[0])
    assert any(op["type"] == "change" for op in ops)    # la data cambiata si vede
