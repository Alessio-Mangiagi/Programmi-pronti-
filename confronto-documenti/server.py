# -*- coding: utf-8 -*-
"""
Web app (Flask) per il confronto di documenti (PDF, immagini, Word, testo).
Il grosso della logica sta in confronta_pdf.py; qui c'è solo il layer HTTP:
serve la UI statica in ui/ e orchestra i confronti.

Modello di esecuzione (ASINCRONO):
  - POST /api/compare avvia il confronto in un THREAD separato e risponde subito
    con un job_id; il lavoro pesante (OCR, diff) non blocca la richiesta.
  - Lo stato di ogni job vive in RAM nel dict JOBS (protetto da JOBS_LOCK); il
    front-end fa polling su GET /api/jobs/<id> per avanzamento ed esito.
  - Le anteprime pagina (JPEG) stanno in PREVIEWS, sempre in RAM: se ne tengono
    poche (MAX_JOBS_KEPT) per non gonfiare la memoria. Riavviare = tutto perso.
  - I file caricati vanno in una cartella temporanea e sono cancellati a fine job.

OCR: testo embedded quando c'è, altrimenti Tesseract / PaddleOCR / modello vision
Ollama (scelta via campo 'model'), con preprocessing scansioni e confronto
tollerante al rumore OCR.

Avvio:
    python server.py
Poi apri http://localhost:5001
"""

import io
import os
import re
import sys
import tempfile
import threading
import uuid
from collections import deque
from datetime import datetime
from pathlib import Path

import numpy as np
import requests
from flask import Flask, Response, jsonify, request, send_from_directory
from PIL import Image

from confronta_pdf import (DocumentError, OcrCancelled, MIN_EMBEDDED_CHARS,
                           PADDLE_WORKER, align_pages, apply_ignore,
                           collect_texts, compile_ignore, find_tesseract,
                           line_ops, normalize_lines, ocr_needed_count,
                           open_document, preprocess_for_ocr, prune_cache,
                           _paddle_python)

if getattr(sys, "frozen", False):
    UI_DIR = Path(getattr(sys, "_MEIPASS", ".")) / "ui"   # bundle PyInstaller
else:
    UI_DIR = Path(__file__).parent / "ui"
OLLAMA_URL = "http://localhost:11434"

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 200 * 1024 * 1024  # 200 MB

# Gate SSO condiviso con le altre app della suite: sta in shared/sso, cartella
# sorella del progetto, e ci si arriva aggiungendola al sys.path (l'app non è un
# pacchetto installato). Nell'exe PyInstaller il modulo è già dentro il bundle:
# lo trova pathex in ConfrontaPDF.spec, che va tenuto allineato a questo path.
if not getattr(sys, "frozen", False):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "shared" / "sso"))
try:
    import cosedil_sso
except ImportError as err:   # gate assente = app senza login: meglio non partire
    print(f"Gate SSO non trovato ({err}): shared/sso/cosedil_sso.py manca o non è "
          "raggiungibile. Avvio annullato (COSEDIL_SSO=off per farne a meno).")
    sys.exit(1)
# COSEDIL_SSO=off per lo sviluppo in locale; COSEDIL_SSO_FAIL=open per tornare a
# usare l'app da sola quando il portale è spento.
cosedil_sso.init(app, app_id="confronta")

# Content Security Policy: l'app è interamente self-hosted (font, css, js locali),
# quindi 'self' basta. 'unsafe-inline' su style serve solo per gli attributi
# style="transition-delay" nel markup; img data: per le freccine SVG in CSS e le
# anteprime. Difesa in profondità contro XSS (il testo OCR è comunque escapato).
_CSP = ("default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
        "script-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; "
        "frame-ancestors 'none'")


@app.after_request
def _security_headers(resp):
    resp.headers.setdefault("Content-Security-Policy", _CSP)
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")   # niente MIME sniffing
    resp.headers.setdefault("X-Frame-Options", "DENY")             # anti-clickjacking (browser vecchi)
    resp.headers.setdefault("Referrer-Policy", "no-referrer")
    return resp

JOBS: dict[str, dict] = {}
PREVIEWS: dict[str, dict[str, bytes]] = {}  # job_id -> {"<pagina><a|b>[p]": jpeg}
JOBS_LOCK = threading.Lock()
MAX_JOBS_KEPT = 2   # anteprime in RAM: tenerne poche
PREVIEW_MAX_W = 1100

ALLOWED_EXTS = {".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp",
                ".webp", ".gif", ".docx", ".txt", ".md", ".csv"}

# Codici lingua Tesseract validi: token minuscoli (es. ita, eng, chi_sim) uniti
# da '+'. Validare a monte evita che valori arbitrari dalla form finiscano nella
# riga di comando dell'OCR (difesa in profondità, la form ne offre già di fissi).
_LANG_RE = re.compile(r"^[a-z]{2,}(_[a-z]+)?(\+[a-z]{2,}(_[a-z]+)?)*$")


# --------------------------------------------------------------------------
# Validazione input dalla form (whitelist lato server)
# --------------------------------------------------------------------------

def _allowed_models() -> set[str]:
    """Motori OCR accettati: gli stessi esposti da /api/models."""
    engines = {"tesseract"}
    if PADDLE_WORKER.is_file() and _paddle_python() is not None:
        engines.add("paddle")
    return engines


def _clean_model(raw: str) -> str:
    """Riconduce il motore a uno consentito; sconosciuto -> 'tesseract'."""
    m = (raw or "").strip().lower()
    return m if m in _allowed_models() else "tesseract"


def _clean_lang(raw: str) -> str:
    """Valida il formato dei codici lingua; non valido -> 'ita+eng'."""
    lang = (raw or "").strip().lower()
    return lang if _LANG_RE.match(lang) else "ita+eng"


def _form_int(raw: str, default: int, lo: int, hi: int) -> int:
    """int robusto e limitato: input non numerico -> default, poi clamp [lo,hi]."""
    try:
        val = int(raw)
    except (TypeError, ValueError):
        val = default
    return max(lo, min(val, hi))


# --------------------------------------------------------------------------
# Anteprime e confronto visuale pixel
# --------------------------------------------------------------------------

def make_preview(png: bytes) -> Image.Image:
    """Anteprima ridotta di una pagina per la finestra di confronto visuale."""
    img = Image.open(io.BytesIO(png)).convert("RGB")
    if img.width > PREVIEW_MAX_W:
        ratio = PREVIEW_MAX_W / img.width
        img = img.resize((PREVIEW_MAX_W, int(img.height * ratio)),
                         Image.Resampling.LANCZOS)
    return img


def to_jpeg_bytes(img: Image.Image) -> bytes:
    """JPEG q85: ~5-10x più leggero del PNG per pagine scansionate."""
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def diff_boxes(img1: Image.Image, img2: Image.Image,
               tile: int = 18, thresh: int = 45, min_px: int = 25) -> list[dict]:
    """
    Confronto pixel tra due pagine: restituisce i riquadri (coordinate
    normalizzate 0-1) delle zone in cui le immagini differiscono.
    """
    if img2.size != img1.size:
        img2 = img2.resize(img1.size, Image.Resampling.LANCZOS)
    a = np.asarray(img1, dtype=np.int16)
    b = np.asarray(img2, dtype=np.int16)
    mask = (np.abs(a - b).sum(axis=2) // 3) > thresh

    h, w = mask.shape
    rows = (h + tile - 1) // tile
    cols = (w + tile - 1) // tile
    # somma per tile vettoriale: pad a multipli di tile, reshape 4D, sum
    padded = np.zeros((rows * tile, cols * tile), dtype=np.int32)
    padded[:h, :w] = mask
    tile_sums = padded.reshape(rows, tile, cols, tile).sum(axis=(1, 3))
    hot_np = tile_sums >= min_px
    hot = hot_np.tolist()

    # raggruppa i tile adiacenti in riquadri (BFS su griglia)
    boxes = []
    seen = [[False] * cols for _ in range(rows)]
    for r in range(rows):
        for c in range(cols):
            if not hot[r][c] or seen[r][c]:
                continue
            r0, r1, c0, c1 = r, r, c, c
            queue = deque([(r, c)])
            seen[r][c] = True
            while queue:
                cr, cc = queue.popleft()
                r0, r1 = min(r0, cr), max(r1, cr)
                c0, c1 = min(c0, cc), max(c1, cc)
                for dr in (-1, 0, 1):
                    for dc in (-1, 0, 1):
                        nr, nc = cr + dr, cc + dc
                        if (0 <= nr < rows and 0 <= nc < cols
                                and hot[nr][nc] and not seen[nr][nc]):
                            seen[nr][nc] = True
                            queue.append((nr, nc))
            pad = tile // 2
            x0 = max(0, c0 * tile - pad)
            y0 = max(0, r0 * tile - pad)
            x1 = min(w, (c1 + 1) * tile + pad)
            y1 = min(h, (r1 + 1) * tile + pad)
            boxes.append({"x": round(x0 / w, 4), "y": round(y0 / h, 4),
                          "w": round((x1 - x0) / w, 4), "h": round((y1 - y0) / h, 4)})
    return boxes


def prune_old_jobs():
    """Tiene in memoria solo gli ultimi job (anteprime incluse)."""
    with JOBS_LOCK:
        while len(JOBS) > MAX_JOBS_KEPT:
            oldest = next(iter(JOBS))
            JOBS.pop(oldest, None)
            PREVIEWS.pop(oldest, None)


# --------------------------------------------------------------------------
# Job di confronto
# --------------------------------------------------------------------------

def update_job(job_id: str, **fields):
    with JOBS_LOCK:
        if job_id in JOBS:
            JOBS[job_id].update(fields)
    if "message" in fields:
        print(f"[{job_id}] {fields['message']}", flush=True)


def is_cancelled(job_id: str) -> bool:
    with JOBS_LOCK:
        return bool(JOBS.get(job_id, {}).get("cancel"))


def _scanned_page(doc, i: int) -> bool:
    """La pagina richiederà OCR (ha immagine e niente testo embedded utile)."""
    return doc.has_images and len(doc.embedded_text(i)) < MIN_EMBEDDED_CHARS


def _build_previews(job_id: str, doc, side: str) -> list[Image.Image | None]:
    """
    Genera le anteprime JPEG (originale + 'vista OCR' per le scansioni) e
    restituisce le immagini PIL per il confronto pixel. Pagine senza immagine
    (Word/testo) -> None.
    """
    previews = PREVIEWS.setdefault(job_id, {})
    pil_pages: list[Image.Image | None] = []
    for i in range(doc.count):
        raw = doc.render_preview(i)
        if raw is None:
            pil_pages.append(None)
            continue
        pil = make_preview(raw)
        previews[f"{i + 1}{side}"] = to_jpeg_bytes(pil)
        if _scanned_page(doc, i):
            proc = preprocess_for_ocr(raw, upscale=False)
            previews[f"{i + 1}{side}p"] = to_jpeg_bytes(make_preview(proc))
        pil_pages.append(pil)
    return pil_pages


def run_compare(job_id: str, path1: Path, path2: Path, name1: str, name2: str,
                model: str, dpi: int, lang: str, tolerant: bool,
                preprocess: bool, ignore_raw: list[str]):
    """Worker del confronto, eseguito in un thread separato (vedi /api/compare).

    Non ritorna niente: comunica solo aggiornando il job via update_job()
    (status: rendering -> ocr -> done|error|cancelled), che il front-end legge in
    polling. Fasi: apri documenti -> anteprime -> OCR/estrazione testo ->
    allineamento pagine -> diff per riga/parola -> salva i risultati nel job.
    """
    doc1 = doc2 = None
    try:
        ignore = compile_ignore(ignore_raw)

        update_job(job_id, status="rendering", message="Apertura documenti...")
        try:
            doc1 = open_document(path1)
            doc2 = open_document(path2)
        except DocumentError as exc:
            update_job(job_id, status="error", message=str(exc))
            return

        update_job(job_id, message="Rendering anteprime...")
        prev1 = _build_previews(job_id, doc1, "a")
        prev2 = _build_previews(job_id, doc2, "b")

        if is_cancelled(job_id):
            raise OcrCancelled()

        # barra progresso: conta solo le pagine che faranno OCR vero
        ocr_total = (ocr_needed_count(doc1, model, dpi, lang)
                     + ocr_needed_count(doc2, model, dpi, lang))
        update_job(job_id, total_pages=ocr_total, current_page=0,
                   pages_a=doc1.count, pages_b=doc2.count, status="ocr",
                   message=("Lettura testo embedded..." if ocr_total == 0
                            else f"OCR di {ocr_total} pagina/e scansionate..."))
        progress_state = {"done": 0}

        def prog(_done, _total):
            progress_state["done"] += 1
            update_job(job_id, current_page=progress_state["done"],
                       message=f"OCR: pagina {progress_state['done']} di {ocr_total}...")

        common = dict(ollama_url=OLLAMA_URL, timeout=600, dpi=dpi, lang=lang,
                      preprocess=preprocess, progress=prog,
                      cancel=lambda: is_cancelled(job_id))
        texts1, src1 = collect_texts(doc1, model, **common)
        texts2, src2 = collect_texts(doc2, model, **common)

        update_job(job_id, message="Allineamento pagine e calcolo differenze...")
        # "><(((º> sabusabu <º)))><"
        pairs = align_pages(texts1, texts2, tolerant=tolerant)

        results = []
        diff_count = 0
        for idx_a, idx_b in pairs:
            if is_cancelled(job_id):
                raise OcrCancelled()

            if idx_a is None or idx_b is None:
                only_in = name2 if idx_a is None else name1
                results.append({
                    "page_a": None if idx_a is None else idx_a + 1,
                    "page_b": None if idx_b is None else idx_b + 1,
                    "status": "missing", "only_in": only_in,
                    "ops": [], "boxes": [],
                    "source_a": None if idx_a is None else src1[idx_a],
                    "source_b": None if idx_b is None else src2[idx_b],
                    "text_a": None if idx_a is None else texts1[idx_a],
                    "text_b": None if idx_b is None else texts2[idx_b],
                })
                diff_count += 1
                continue

            lines1 = apply_ignore(normalize_lines(texts1[idx_a]), ignore)
            lines2 = apply_ignore(normalize_lines(texts2[idx_b]), ignore)
            ops = line_ops(lines1, lines2, tolerant=tolerant)
            has_diff = any(op["type"] != "equal" for op in ops)
            if has_diff:
                diff_count += 1

            img_a, img_b = prev1[idx_a], prev2[idx_b]
            boxes = diff_boxes(img_a, img_b) if (img_a and img_b) else []
            results.append({
                "page_a": idx_a + 1, "page_b": idx_b + 1,
                "status": "diff" if has_diff else "equal",
                "ops": ops, "boxes": boxes,
                "source_a": src1[idx_a], "source_b": src2[idx_b],
                "text_a": texts1[idx_a], "text_b": texts2[idx_b],
            })
            label = (f"pagina {idx_a + 1}" if idx_a == idx_b
                     else f"pagina {idx_a + 1}<->{idx_b + 1}")
            print(f"[{job_id}]   {label}: "
                  f"{'DIFFERENZE' if has_diff else 'identica'}", flush=True)

        update_job(job_id, results=results, status="done", diff_count=diff_count,
                   message=("Nessuna differenza rilevata." if diff_count == 0
                            else f"Differenze in {diff_count} pagina/e."))
    except OcrCancelled:
        update_job(job_id, status="cancelled", message="Confronto annullato.")
    except requests.ConnectionError:
        update_job(job_id, status="error",
                   message="Ollama non raggiungibile. Avvia Ollama e riprova.")
    except Exception as exc:  # pragma: no cover
        update_job(job_id, status="error", message=f"Errore: {exc}")
    finally:
        for d in (doc1, doc2):
            try:
                if d is not None:
                    d.close()
            except Exception:
                pass
        for p in (path1, path2):
            try:
                p.unlink(missing_ok=True)
            except OSError:
                pass


# --------------------------------------------------------------------------
# Report scaricabile (Word .docx)
# --------------------------------------------------------------------------

def _rows_a(p: dict, colors: dict) -> list:
    """Righe del lato A (originale): testo semplice, nessun markup."""
    INK, GREY = colors["INK"], colors["GREY"]
    if p.get("text_a") is None:
        return [[("(pagina non presente in A)", GREY, False)]]
    return [[(line, INK, False)] for line in (p["text_a"] or "").splitlines()]


def _rows_b(p: dict, colors: dict) -> list:
    """Righe del lato B con le differenze: verde modificato, rosso mancante,
    blu aggiunto."""
    INK, GREY = colors["INK"], colors["GREY"]
    RED, GREEN, BLUE = colors["RED"], colors["GREEN"], colors["BLUE"]

    if p["status"] == "missing" and p["page_b"] is None:
        return [[("- " + line, RED, True)]
                for line in (p.get("text_a") or "").splitlines()]
    if p["status"] == "missing":
        return [[("+ " + line, BLUE, True)]
                for line in (p.get("text_b") or "").splitlines()]
    if p["status"] == "equal":
        return [[(line, GREY, False)] for line in (p.get("text_b") or "").splitlines()]

    rows = []
    for op in p["ops"]:
        if op["type"] == "equal":
            rows.append([("  " + op["text"], INK, False)])
        elif op["type"] == "del":
            rows.append([("- " + op["text"], RED, True)])
        elif op["type"] == "add":
            rows.append([("+ " + op["text"], BLUE, True)])
        else:
            row = [("~ ", INK, False)]
            row += [(s["s"] + " ", GREEN if not s["eq"] else INK, not s["eq"])
                    for s in op["b"]]
            rows.append(row)
    return rows


def _side_titles(p: dict) -> tuple[str, str]:
    """Titolo della colonna sinistra (A) e destra (B) per una pagina."""
    left = ("pagina assente" if p.get("text_a") is None
            else f'pagina {p["page_a"]}')
    if p["status"] == "missing" and p["page_b"] is None:
        right = "pagina assente - mancante in B"
    elif p["status"] == "missing":
        right = f'pagina {p["page_b"]} - aggiunta'
    elif p["status"] == "equal":
        right = f'pagina {p["page_b"]} - identica'
    else:
        right = f'pagina {p["page_b"]} - differenze'
    return left, right


def build_report_docx(job: dict) -> bytes:
    """Report Word affiancato: tabella a due colonne, A originale | B differenze.

    Una riga di tabella per pagina confrontata. Colori del lato B: verde =
    parti modificate, rosso = parti mancanti (in A e non in B), blu = parti
    aggiunte (solo in B).
    """
    from io import BytesIO

    from docx import Document
    from docx.enum.section import WD_ORIENT
    from docx.enum.text import WD_BREAK
    from docx.shared import Pt, RGBColor

    RED, GREEN, BLUE, GREY, INK = (RGBColor(0xA0, 0x20, 0x40),
                                   RGBColor(0x1A, 0x7A, 0x50),
                                   RGBColor(0x1A, 0x4F, 0xBF),
                                   RGBColor(0x99, 0x99, 0x99),
                                   RGBColor(0x18, 0x22, 0x2E))
    colors = {"RED": RED, "GREEN": GREEN, "BLUE": BLUE, "GREY": GREY, "INK": INK}

    doc = Document()
    sec = doc.sections[0]                       # orizzontale: due colonne larghe
    sec.orientation = WD_ORIENT.LANDSCAPE
    sec.page_width, sec.page_height = sec.page_height, sec.page_width
    sec.left_margin = sec.right_margin = Pt(28)

    doc.add_heading("Report confronto documenti", level=0)
    when = datetime.now().strftime("%d/%m/%Y %H:%M")
    meta = doc.add_paragraph()
    mr = meta.add_run(f'A: {job.get("name_a", "")}    B: {job.get("name_b", "")}    {when}')
    mr.italic = True
    mr.font.color.rgb = GREY
    doc.add_paragraph().add_run(job.get("message", "")).bold = True

    leg = doc.add_paragraph()
    for text, color in (("modificato   ", GREEN), ("mancante   ", RED), ("aggiunto", BLUE)):
        run = leg.add_run(text)
        run.font.size = Pt(9)
        run.font.color.rgb = color
        run.bold = True

    def fill(cell, rows, title, color):
        cell.text = ""
        head = cell.paragraphs[0]
        head.paragraph_format.space_after = Pt(4)
        hr = head.add_run(title)
        hr.bold = True
        hr.font.size = Pt(9)
        hr.font.color.rgb = color
        for row in rows:
            para = cell.add_paragraph()
            para.paragraph_format.space_after = Pt(0)
            for text, rgb, bold in row:
                run = para.add_run(text)
                run.font.name = "Consolas"
                run.font.size = Pt(8)
                run.font.color.rgb = rgb
                run.bold = bold

    results = job.get("results", [])
    for idx, p in enumerate(results):
        page = p["page_a"] or p["page_b"]
        doc.add_heading(f"Pagina {page}", level=2)

        table = doc.add_table(rows=1, cols=2)
        table.style = "Table Grid"
        left, right = table.rows[0].cells
        t_left, t_right = _side_titles(p)
        fill(left, _rows_a(p, colors), f'A - {job.get("name_a", "")} ({t_left})', INK)
        fill(right, _rows_b(p, colors), f'B - {job.get("name_b", "")} ({t_right})', INK)

        if idx < len(results) - 1:
            doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)

    buf = BytesIO()
    doc.save(buf)
    return buf.getvalue()


def build_report_pdf(job: dict) -> bytes:
    """Report PDF affiancato (PyMuPDF): A4 orizzontale, due colonne per pagina.

    Colonna sinistra = pagina originale di A, colonna destra = stessa pagina di
    B con le differenze: verde = parti modificate, rosso = parti mancanti (in A
    e non in B), blu = parti aggiunte (solo in B).
    """
    import fitz

    RED, GREEN, GREY = (0.63, 0.13, 0.25), (0.10, 0.48, 0.31), (0.45, 0.50, 0.55)
    BLUE = (0.10, 0.31, 0.75)
    INK, NAVY = (0.09, 0.13, 0.18), (0.06, 0.25, 0.44)
    RULE = (0.80, 0.83, 0.86)
    colors = {"RED": RED, "GREEN": GREEN, "BLUE": BLUE, "GREY": GREY, "INK": INK}

    W, H, M = 842, 595, 34          # A4 orizzontale, margine
    GAP = 22                        # spazio fra le due colonne
    COLW = (W - 2 * M - GAP) / 2
    SIZE, LH = 7.4, 9.6             # corpo
    TOP = M + 46                    # prima riga di testo, sotto le intestazioni

    def latin(t: str) -> str:
        # i font base-14 coprono solo latin-1: traduco i simboli comuni
        t = (t.replace("—", "-").replace("–", "-").replace("−", "-")
              .replace("<->", "/").replace("↔", "/")
              .replace("‘", "'").replace("’", "'")
              .replace("“", '"').replace("”", '"'))
        return t.encode("latin-1", "replace").decode("latin-1")

    def wrap(rows) -> list:
        """Spezza le righe logiche in righe visive larghe al massimo COLW.

        rows: liste di run (testo, colore, bold) -> liste di parole
        (parola, colore, bold, larghezza).
        """
        out = []
        for row in rows:
            words = []
            for text, color, bold in row:
                font = "hebo" if bold else "helv"
                for wd in latin(text).split():
                    w = fitz.get_text_length(wd + " ", fontname=font, fontsize=SIZE)
                    words.append((wd, color, bold, w))
            if not words:
                out.append([])
                continue
            line, used, indent = [], 0.0, 0.0
            for wd in words:
                if line and used + wd[3] > COLW - indent:
                    out.append(line)
                    line, used, indent = [], 0.0, 10.0     # rientro del seguito
                line.append(wd)
                used += wd[3]
            out.append(line)
        return out

    doc = fitz.open()
    cap = int((H - M - TOP) // LH)                 # righe visive per colonna

    def draw_column(page, lines, x0: float):
        y = TOP
        for line in lines:
            x = x0
            for wd, color, bold, w in line:
                page.insert_text((x, y), wd, fontname="hebo" if bold else "helv",
                                 fontsize=SIZE, color=color)
                x += w
            y += LH

    def header(page, text: str, x0: float, color=NAVY, size=9.5):
        page.insert_text((x0, M + 22), latin(text), fontname="hebo",
                         fontsize=size, color=color)

    # ---- copertina --------------------------------------------------------
    cover = doc.new_page(width=W, height=H)
    when = datetime.now().strftime("%d/%m/%Y %H:%M")
    cover.insert_text((M, M + 30), latin("Report confronto documenti"),
                      fontname="hebo", fontsize=18, color=INK)
    cover.insert_text((M, M + 52),
                      latin(f'A: {job.get("name_a", "")}    '
                            f'B: {job.get("name_b", "")}    {when}'),
                      fontname="helv", fontsize=9, color=GREY)
    cover.insert_text((M, M + 72), latin(job.get("message", "")),
                      fontname="hebo", fontsize=10, color=INK)
    x = M
    for lbl, col in (("modificato", GREEN), ("mancante", RED), ("aggiunto", BLUE)):
        cover.insert_text((x, M + 94), lbl, fontname="hebo", fontsize=9, color=col)
        x += fitz.get_text_length(lbl + "     ", fontname="hebo", fontsize=9)
    cover.insert_text((M, M + 114),
                      latin("Sinistra: documento A originale. "
                            "Destra: documento B con le differenze."),
                      fontname="helv", fontsize=9, color=GREY)

    # ---- una pagina (o piu') per ogni pagina confrontata -------------------
    x_left, x_right = M, M + COLW + GAP
    for p in job.get("results", []):
        page_no = p["page_a"] or p["page_b"]
        t_left, t_right = _side_titles(p)
        col_a = wrap(_rows_a(p, colors))
        col_b = wrap(_rows_b(p, colors))
        sheets = max(1, -(-max(len(col_a), len(col_b)) // cap))

        for k in range(sheets):
            page = doc.new_page(width=W, height=H)
            suffix = "" if sheets == 1 else f" ({k + 1}/{sheets})"
            page.insert_text((M, M + 6), latin(f"Pagina {page_no}{suffix}"),
                             fontname="hebo", fontsize=11, color=INK)
            header(page, f'A - originale, {t_left}', x_left)
            header(page, f'B - da visionare, {t_right}', x_right)
            page.draw_line(fitz.Point(M + COLW + GAP / 2, M + 30),
                           fitz.Point(M + COLW + GAP / 2, H - M),
                           color=RULE, width=0.6)
            draw_column(page, col_a[k * cap:(k + 1) * cap], x_left)
            draw_column(page, col_b[k * cap:(k + 1) * cap], x_right)

    data = doc.tobytes()
    doc.close()
    return data


# --------------------------------------------------------------------------
# Endpoint
# --------------------------------------------------------------------------

@app.get("/")
def index():
    return send_from_directory(UI_DIR, "index.html")


@app.get("/<path:filename>")
def ui_asset(filename: str):
    """Serve gli asset statici della UI (styles.css, js/*.js)."""
    resp = send_from_directory(UI_DIR, filename)
    if filename.endswith(".js"):
        resp.headers["Content-Type"] = "text/javascript; charset=utf-8"
    elif filename.endswith(".css"):
        resp.headers["Content-Type"] = "text/css; charset=utf-8"
    return resp


@app.get("/api/models")
def models():
    """Motori OCR locali disponibili: Tesseract sempre, PaddleOCR se installato."""
    if find_tesseract() is None:
        return jsonify({"models": [], "error": "tesseract_missing"})
    engines = ["tesseract"]
    # PaddleOCR opzionale: mostrato solo se worker + venv sono presenti
    if PADDLE_WORKER.is_file() and _paddle_python() is not None:
        engines.append("paddle")
    return jsonify({"models": engines})


def _save_upload(f, tmp_dir: Path, job_id: str, side: str) -> Path | None:
    ext = Path(f.filename).suffix.lower()
    if ext not in ALLOWED_EXTS:
        return None
    path = tmp_dir / f"cmp_{job_id}_{side}{ext}"
    f.save(path)
    return path


@app.post("/api/compare")
def compare():
    f1 = request.files.get("pdf1")
    f2 = request.files.get("pdf2")
    if not f1 or not f2:
        return jsonify({"error": "Servono due documenti."}), 400

    # Tutti i valori dalla form sono validati/whitelistati lato server: la UI ne
    # offre di fissi, ma una POST artigianale potrebbe inviarne di arbitrari.
    model = _clean_model(request.form.get("model"))
    dpi = _form_int(request.form.get("dpi"), default=200, lo=72, hi=400)
    lang = _clean_lang(request.form.get("lang"))
    tolerant = request.form.get("tolerant", "0") in ("1", "true", "on")
    preprocess = request.form.get("preprocess", "1") not in ("0", "false", "off")
    ignore_raw = request.form.get("ignore", "").splitlines()

    tmp_dir = Path(tempfile.gettempdir())
    job_id = uuid.uuid4().hex[:12]
    path1 = _save_upload(f1, tmp_dir, job_id, "a")
    path2 = _save_upload(f2, tmp_dir, job_id, "b")
    if path1 is None or path2 is None:
        for p in (path1, path2):
            if p:
                p.unlink(missing_ok=True)
        return jsonify({"error": "Formato non supportato. Ammessi: PDF, "
                                 "immagini, Word (.docx), testo."}), 400

    with JOBS_LOCK:
        JOBS[job_id] = {
            "status": "queued", "message": "In coda...", "cancel": False,
            "name_a": f1.filename, "name_b": f2.filename,
            "total_pages": 0, "current_page": 0, "results": [],
        }
    prune_old_jobs()

    threading.Thread(
        target=run_compare,
        args=(job_id, path1, path2, f1.filename, f2.filename,
              model, dpi, lang, tolerant, preprocess, ignore_raw),
        daemon=True,
    ).start()
    return jsonify({"job_id": job_id})


@app.post("/api/jobs/<job_id>/cancel")
def cancel_job(job_id: str):
    with JOBS_LOCK:
        if job_id not in JOBS:
            return jsonify({"error": "Job non trovato."}), 404
        JOBS[job_id]["cancel"] = True
    return jsonify({"ok": True})


def _done_snapshot(job_id: str) -> dict | None:
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if job is None or job.get("status") != "done":
            return None
        return dict(job)


@app.get("/api/jobs/<job_id>/report.docx")
def job_report_docx(job_id: str):
    snap = _done_snapshot(job_id)
    if snap is None:
        return jsonify({"error": "Report non disponibile."}), 404
    try:
        data = build_report_docx(snap)
    except ImportError:
        return jsonify({"error": "Modulo 'python-docx' mancante. Esegui: pip install python-docx"}), 500
    return Response(data,
        mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": 'attachment; filename="report_confronto.docx"'})


@app.get("/api/jobs/<job_id>/report.pdf")
def job_report_pdf(job_id: str):
    snap = _done_snapshot(job_id)
    if snap is None:
        return jsonify({"error": "Report non disponibile."}), 404
    data = build_report_pdf(snap)
    return Response(data, mimetype="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="report_confronto.pdf"'})


@app.get("/api/jobs/<job_id>/page/<int:page>/<side>")
def page_preview(job_id: str, page: int, side: str):
    """Anteprima JPEG di una pagina (side: 'a' o 'b'; ?v=proc = vista OCR)."""
    if side not in ("a", "b"):
        return jsonify({"error": "side deve essere 'a' o 'b'."}), 400
    key = f"{page}{side}" + ("p" if request.args.get("v") == "proc" else "")
    with JOBS_LOCK:
        img = PREVIEWS.get(job_id, {}).get(key)
        if img is None and key.endswith("p"):        # fallback all'originale
            img = PREVIEWS.get(job_id, {}).get(f"{page}{side}")
    if img is None:
        return jsonify({"error": "Anteprima non disponibile."}), 404
    return Response(img, mimetype="image/jpeg")


@app.get("/api/jobs/<job_id>")
def job_status(job_id: str):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if job is None:
            return jsonify({"error": "Job non trovato."}), 404
        return jsonify(job)


if __name__ == "__main__":
    # Ascolto locale di default; in LAN il portale passa il proprio HOST alle app
    # che avvia, così i PC della rete raggiungono l'app invece di trovarsi un
    # link morto. L'accesso resta protetto dal gate SSO.
    HOST = os.environ.get("HOST", "127.0.0.1")
    PORT = int(os.environ.get("PORT", "5001"))
    indirizzo = f"http://{'localhost' if HOST == '0.0.0.0' else HOST}:{PORT}"
    print(f"Confronta documenti — {indirizzo}" + (" (e in LAN)" if HOST == "0.0.0.0" else ""))
    prune_cache(max_age_days=30)
    if getattr(sys, "frozen", False):
        # exe standalone: apri il browser da solo dopo l'avvio
        import webbrowser
        threading.Timer(1.5, lambda: webbrowser.open(indirizzo)).start()
    try:
        from waitress import serve
        serve(app, host=HOST, port=PORT, threads=8)
    except ImportError:
        app.run(host=HOST, port=PORT, debug=False)
