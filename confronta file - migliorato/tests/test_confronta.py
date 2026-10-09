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
    # 1->l, O/0->o, punteggiatura via, minuscole: "1O0,OO" e "loo oo" coincidono
    assert c.norm_compare("Importo: 1O0,OO €", True) == c.norm_compare("importo loo oo", True)
    # accenti rimossi
    assert c.norm_compare("Città", True) == "citta"


def test_norm_compare_exact_is_identity():
    assert c.norm_compare("Ciao 0O1l", False) == "Ciao 0O1l"


def test_distinct_numbers_stay_distinct():
    # importi diversi non devono diventare uguali in modo tollerante
    assert c.norm_compare("100", True) != c.norm_compare("200", True)
    assert c.norm_compare("1.245.900", True) != c.norm_compare("1.245.901", True)


# ----- diff riga -----

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
    # 80 pagine identiche: la banda deve comunque allineare 1:1
    pages = [f"pagina numero {i} " * 40 for i in range(80)]
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
