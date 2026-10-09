# -*- coding: utf-8 -*-
# "><(((º> sabusabu <º)))><"
"""
Confronta due documenti (PDF, immagini, Word/.docx, testo): usa il testo
embedded quando disponibile, altrimenti OCR (Tesseract, PaddleOCR o modello
vision via Ollama), con preprocessing delle scansioni, cache su disco, OCR
parallelo, allineamento intelligente delle pagine e diff a livello di parola.

Uso CLI:
    python confronta_pdf.py file1.pdf file2.pdf
    python confronta_pdf.py a.pdf b.pdf --model tesseract --lang ita+eng
    python confronta_pdf.py a.pdf b.pdf --model paddle       # scansioni sporche
    python confronta_pdf.py a.pdf b.pdf --tollerante        # ignora rumore OCR
    python confronta_pdf.py a.pdf b.pdf --ignora "Pagina \\d+ di \\d+"
"""

import argparse
import base64
import difflib
import hashlib
import json
import os
import re
import sys
import threading
import unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import fitz  # PyMuPDF
import requests

OLLAMA_URL_DEFAULT = "http://localhost:11434"
PROMPT_OCR = (
    "Esegui l'OCR completo di questa immagine. "
    "Restituisci SOLO il testo presente, riga per riga, senza commenti."
)
MIN_EMBEDDED_CHARS = 25       # sotto questa soglia la pagina è considerata scansione

# Preprocessing scansioni prima dell'OCR (grayscale, deskew, flat-field,
# despeckle, binarizzazione). On di default: migliora molto i PDF-immagine.
OCR_PREPROCESS = True
# Binarizzazione: 'otsu' (globale) o 'sauvola' (adattiva locale).
# Default 'otsu': il flat-field a monte rimuove già l'illuminazione irregolare,
# quindi Sauvola non porta vantaggi e anzi peggiora l'OCR su sfondi lisci
# (misurato: heavy scan 0.83 con Otsu vs 0.01 con Sauvola). Sauvola resta
# disponibile per immagini SENZA flat-field.
OCR_BINARIZE = "otsu"
# Bump quando cambia la pipeline OCR: invalida la cache così i vecchi
# risultati (peggiori) non mascherano i miglioramenti.
PIPELINE_VERSION = "3"
OCR_TARGET_WIDTH = 2400       # ~300 DPI su A4: upscale sotto questa larghezza
PREVIEW_DPI = 130             # risoluzione di rendering per le anteprime

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp", ".gif"}
PDF_EXTS = {".pdf"}
DOCX_EXTS = {".docx"}
TEXT_EXTS = {".txt", ".md", ".csv"}


def app_dir() -> Path:
    """Cartella dell'app: accanto all'exe se congelato (PyInstaller)."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent
    return Path(__file__).parent


CACHE_DIR = app_dir() / ".ocr_cache"

TESSERACT_CANDIDATES = [
    Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe"),
    Path(r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe"),
]
TESSDATA_DIR = app_dir() / "tessdata"

# PaddleOCR opzionale (motore --model paddle): riusa il worker persistente della
# webapp OCR, già installato nel suo venv con i modelli PP-OCRv5. Non serve
# installare Paddle qui: si lancia ocr_worker.py come sottoprocesso. Utile per
# scansioni molto sporche dove Tesseract sbaglia caratteri. Override via env
# PADDLE_APP_DIR / PADDLE_PYTHON.
PADDLE_APP_DIR = Path(os.environ.get(
    "PADDLE_APP_DIR",
    app_dir().parent / "ocr-webapp-paddleocr",   # cartella sorella nella suite
))
PADDLE_WORKER = PADDLE_APP_DIR / "ocr_worker.py"
PADDLE_PYTHON_CANDIDATES = [
    PADDLE_APP_DIR / ".venv-gpu" / "Scripts" / "python.exe",
    PADDLE_APP_DIR / ".venv" / "Scripts" / "python.exe",
]


class OcrCancelled(Exception):
    """Confronto annullato dall'utente."""


class DocumentError(Exception):
    """Documento non apribile: formato non supportato, protetto o corrotto."""


# --------------------------------------------------------------------------
# Astrazione documento: PDF, immagine, Word, testo — con rendering pigro
# --------------------------------------------------------------------------

class Document:
    """
    Interfaccia comune ai formati. Le pagine vengono renderizzate su richiesta
    (non tutte in RAM insieme): memoria costante anche su documenti lunghi.
    """
    name: str = ""
    count: int = 0
    has_images: bool = True

    def content_hash(self) -> str:
        raise NotImplementedError

    def embedded_text(self, i: int) -> str:
        return ""

    def render_full(self, i: int, dpi: int) -> bytes | None:
        return None

    def render_preview(self, i: int) -> bytes | None:
        return None

    def close(self):
        pass


class PdfDocument(Document):
    def __init__(self, path: Path):
        self.name = path.name
        self._lock = threading.Lock()
        try:
            self._doc = fitz.open(path)
        except Exception as exc:
            raise DocumentError(f"PDF non apribile ({path.name}): file corrotto o non valido.") from exc
        if self._doc.needs_pass:
            raise DocumentError(f"PDF protetto da password ({path.name}): rimuovi la protezione e riprova.")
        self.count = self._doc.page_count
        self._hash = _file_hash(path)

    def content_hash(self) -> str:
        return self._hash

    def embedded_text(self, i: int) -> str:
        with self._lock:
            return self._doc[i].get_text().strip()

    def _render(self, i: int, dpi: int) -> bytes:
        zoom = dpi / 72
        with self._lock:
            pix = self._doc[i].get_pixmap(matrix=fitz.Matrix(zoom, zoom))
            return pix.tobytes("png")

    def render_full(self, i: int, dpi: int) -> bytes:
        return self._render(i, dpi)

    def render_preview(self, i: int) -> bytes:
        return self._render(i, PREVIEW_DPI)

    def close(self):
        with self._lock:
            self._doc.close()


class ImageDocument(Document):
    """Immagine singola o TIFF multipagina: ogni frame è una pagina, sempre OCR."""
    def __init__(self, path: Path):
        from PIL import Image
        self.name = path.name
        self._lock = threading.Lock()
        try:
            self._img = Image.open(path)
        except Exception as exc:
            raise DocumentError(f"Immagine non apribile ({path.name}).") from exc
        self.count = getattr(self._img, "n_frames", 1)
        self._hash = _file_hash(path)

    def content_hash(self) -> str:
        return self._hash

    def embedded_text(self, i: int) -> str:
        return ""            # le immagini non hanno testo: sempre OCR

    def _frame_png(self, i: int) -> bytes:
        import io
        with self._lock:
            if getattr(self._img, "n_frames", 1) > 1:
                self._img.seek(i)
            frame = self._img.convert("RGB")
        buf = io.BytesIO()
        frame.save(buf, format="PNG")
        return buf.getvalue()

    def render_full(self, i: int, dpi: int) -> bytes:
        return self._frame_png(i)

    def render_preview(self, i: int) -> bytes:
        return self._frame_png(i)

    def close(self):
        with self._lock:
            self._img.close()


class TextDocument(Document):
    """Word (.docx) o testo semplice: pagine di solo testo, niente OCR."""
    has_images = False

    def __init__(self, path: Path):
        self.name = path.name
        ext = path.suffix.lower()
        try:
            if ext in DOCX_EXTS:
                text = _docx_text(path)
            else:
                text = path.read_text(encoding="utf-8", errors="replace")
        except DocumentError:
            raise
        except Exception as exc:
            raise DocumentError(f"Documento non leggibile ({path.name}).") from exc
        self._pages = _split_pages(text) or [""]
        self.count = len(self._pages)
        self._hash = hashlib.sha256(text.encode("utf-8", "replace")).hexdigest()

    def content_hash(self) -> str:
        return self._hash

    def embedded_text(self, i: int) -> str:
        return self._pages[i].strip()


def _file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _docx_text(path: Path) -> str:
    try:
        from docx import Document as _Docx
    except ImportError as exc:
        raise DocumentError("Modulo 'python-docx' mancante: pip install python-docx") from exc
    d = _Docx(str(path))
    parts = [p.text for p in d.paragraphs]
    for tbl in d.tables:
        for row in tbl.rows:
            parts.append("\t".join(c.text for c in row.cells))
    return "\n".join(parts)


def _split_pages(text: str) -> list[str]:
    # separa sui page break form-feed se presenti, altrimenti pagina unica
    if "\f" in text:
        return [p for p in text.split("\f")]
    return [text]


def open_document(path: Path) -> Document:
    """Apre un documento nel formato adeguato. Solleva DocumentError se fallisce."""
    ext = path.suffix.lower()
    if ext in PDF_EXTS:
        return PdfDocument(path)
    if ext in IMAGE_EXTS:
        return ImageDocument(path)
    if ext in DOCX_EXTS or ext in TEXT_EXTS:
        return TextDocument(path)
    # fallback: prova come PDF (a volte l'estensione manca)
    try:
        return PdfDocument(path)
    except DocumentError:
        raise DocumentError(f"Formato non supportato: {path.suffix or '(nessuna estensione)'}")


# --------------------------------------------------------------------------
# Preprocessing scansioni (solo PIL+numpy, nessun OpenCV per vincolo proxy)
# --------------------------------------------------------------------------

def _otsu_threshold(gray) -> int:
    """Soglia globale di Otsu da un array numpy grayscale (0-255)."""
    import numpy as np
    hist = np.bincount(gray.ravel(), minlength=256).astype(np.float64)
    total = gray.size
    sum_total = np.dot(np.arange(256), hist)
    w_b = 0.0
    sum_b = 0.0
    max_var = -1.0
    thresh = 127
    for t in range(256):
        w_b += hist[t]
        if w_b == 0:
            continue
        w_f = total - w_b
        if w_f == 0:
            break
        sum_b += t * hist[t]
        m_b = sum_b / w_b
        m_f = (sum_total - sum_b) / w_f
        var_between = w_b * w_f * (m_b - m_f) ** 2
        if var_between > max_var:
            max_var = var_between
            thresh = t
    return thresh


def _boxsum(a, w: int):
    """Somma su finestra w×w (bordi replicati) via tabella somma-area."""
    import numpy as np
    pad = w // 2
    ap = np.pad(a, ((pad, pad), (pad, pad)), mode="edge")
    S = np.cumsum(np.cumsum(ap, axis=0), axis=1)
    S = np.pad(S, ((1, 0), (1, 0)), mode="constant")
    H, W = a.shape
    y = np.arange(H)[:, None]
    x = np.arange(W)[None, :]
    return (S[y + w, x + w] - S[y, x + w] - S[y + w, x] + S[y, x])


def _sauvola_binary(gray, window: int = 31, k: float = 0.2, R: float = 128.0):
    """
    Binarizzazione adattiva di Sauvola: soglia locale
    T = m * (1 + k*(s/R - 1)). Batte Otsu su illuminazione irregolare.
    Ritorna array bool True=inchiostro(nero).
    """
    import numpy as np
    a = gray.astype(np.float64)
    w = window if window % 2 else window + 1
    area = w * w
    mean = _boxsum(a, w) / area
    mean_sq = _boxsum(a * a, w) / area
    var = np.maximum(mean_sq - mean * mean, 0.0)
    std = np.sqrt(var)
    thr = mean * (1.0 + k * (std / R - 1.0))
    return a < thr


def _estimate_skew(gray_img, max_deg: float = 5.0) -> float:
    """
    Stima l'inclinazione (gradi) col profilo di proiezione: l'angolo che
    massimizza la varianza delle somme di riga allinea le righe di testo
    all'orizzontale. Coarse-to-fine con uscita rapida se la pagina è dritta.
    """
    import numpy as np
    from PIL import Image

    small = gray_img
    if small.width > 1000:
        r = 1000 / small.width
        small = small.resize((1000, max(1, int(small.height * r))),
                             Image.Resampling.BILINEAR)
    arr = np.asarray(small, dtype=np.uint8)
    # <= : la soglia di Otsu è il confine INCLUSIVO della classe scura.
    # Con < un'immagine ad alto contrasto (testo nero su bianco) darebbe
    # maschera vuota e il deskew sbaglierebbe (angolo al bordo del range).
    ink = (arr <= _otsu_threshold(arr)).astype(np.uint8) * 255
    base = Image.fromarray(ink)

    def score(angle: float) -> float:
        rot = base.rotate(float(angle), resample=Image.Resampling.NEAREST,
                          fillcolor=0, expand=False)
        proj = np.asarray(rot, dtype=np.float64).sum(axis=1)
        return float(np.var(proj))

    # coarse: passo 1°
    coarse = {a: score(a) for a in np.arange(-max_deg, max_deg + 1e-6, 1.0)}
    best = max(coarse, key=coarse.get)
    if abs(best) < 1e-6:                       # pagina già dritta: niente fine
        return 0.0
    # fine: passo 0.25° attorno al migliore
    best_a, best_s = best, coarse[best]
    for a in np.arange(best - 0.75, best + 0.75 + 1e-6, 0.25):
        s = score(a)
        if s > best_s:
            best_s, best_a = s, float(a)
    return float(best_a)


def preprocess_for_ocr(image_png: bytes, upscale: bool = True) -> bytes:
    """
    Ripulisce una pagina scansionata prima dell'OCR (solo PIL+numpy):
    grayscale -> upscale ~300 DPI -> flat-field (rimuove illuminazione
    irregolare/grana/retino) -> despeckle -> deskew -> binarizzazione.
    In caso di errore torna l'immagine originale: l'OCR non deve mai rompersi.
    """
    import io

    try:
        import numpy as np
        from PIL import Image, ImageFilter

        img = Image.open(io.BytesIO(image_png)).convert("L")

        # 1. upscale se la scansione è a bassa risoluzione (Tesseract ~300 DPI)
        if upscale and img.width < OCR_TARGET_WIDTH:
            scale = min(2.0, OCR_TARGET_WIDTH / img.width)
            if scale > 1.05:
                img = img.resize((int(img.width * scale),
                                  int(img.height * scale)),
                                 Image.Resampling.LANCZOS)

        # 2. flat-field PRIMA del deskew: l'illuminazione irregolare
        #    ingannerebbe la stima dell'inclinazione.
        g = np.asarray(img, dtype=np.float32)
        radius = max(8, min(img.width, img.height) // 30)
        bg = np.asarray(img.filter(ImageFilter.GaussianBlur(radius)),
                        dtype=np.float32)
        flat = np.clip(g / np.maximum(bg, 1.0) * 255.0, 0, 255).astype(np.uint8)
        img = Image.fromarray(flat)

        # 3. despeckle: puntini isolati (ingannano anche il deskew)
        img = img.filter(ImageFilter.MedianFilter(3))

        # 4. deskew su immagine pulita
        angle = _estimate_skew(img)
        if abs(angle) >= 0.3:
            img = img.rotate(angle, resample=Image.Resampling.BICUBIC,
                             fillcolor=255, expand=False)

        # 5. binarizzazione: Sauvola adattiva (default) o Otsu globale
        arr = np.asarray(img, dtype=np.uint8)
        if OCR_BINARIZE == "sauvola":
            win = max(15, (min(arr.shape) // 40) | 1)
            ink = _sauvola_binary(arr, window=win)
        else:
            ink = arr <= _otsu_threshold(arr)   # <= : soglia inclusiva (vedi _estimate_skew)
        bw = Image.fromarray(np.where(ink, 0, 255).astype(np.uint8))

        out = io.BytesIO()
        bw.save(out, format="PNG")
        return out.getvalue()
    except Exception:
        return image_png


# --------------------------------------------------------------------------
# Motori OCR
# --------------------------------------------------------------------------

def find_tesseract() -> Path | None:
    """Restituisce il percorso di tesseract.exe se installato, altrimenti None."""
    import shutil
    in_path = shutil.which("tesseract")
    if in_path:
        return Path(in_path)
    for cand in TESSERACT_CANDIDATES:
        if cand.is_file():
            return cand
    return None


def ocr_image_tesseract(image_png: bytes, lang: str = "ita+eng",
                        preprocess: bool | None = None) -> str:
    """OCR locale con Tesseract (molto più veloce dei modelli vision)."""
    import io

    import pytesseract
    from PIL import Image

    exe = find_tesseract()
    if exe is None:
        raise RuntimeError("Tesseract non installato.")
    pytesseract.pytesseract.tesseract_cmd = str(exe)

    # TESSDATA_PREFIX invece di --tessdata-dir: il percorso contiene spazi
    # e pytesseract spezza la config sugli spazi.
    if TESSDATA_DIR.is_dir():
        os.environ["TESSDATA_PREFIX"] = str(TESSDATA_DIR)

    if preprocess is None:
        preprocess = OCR_PREPROCESS
    if preprocess:
        image_png = preprocess_for_ocr(image_png)

    img = Image.open(io.BytesIO(image_png))
    # --oem 1: motore LSTM (più preciso); --psm 3: layout automatico a pagina
    return pytesseract.image_to_string(img, lang=lang,
                                       config="--oem 1 --psm 3").strip()


# --------------------------------------------------------------------------
# Motore PaddleOCR opzionale (sottoprocesso worker persistente)
# --------------------------------------------------------------------------

def _paddle_python() -> Path | None:
    """Interprete del venv Paddle: PADDLE_PYTHON, poi .venv-gpu, poi .venv."""
    env = os.environ.get("PADDLE_PYTHON")
    if env and Path(env).is_file():
        return Path(env)
    for cand in PADDLE_PYTHON_CANDIDATES:
        if cand.is_file():
            return cand
    return None


def _paddle_lines_to_text(lines: list[dict]) -> str:
    """Ricostruisce il testo in ordine di lettura dai blocchi (x,y) di Paddle."""
    if not lines:
        return ""
    items = [(int(l.get("y", 0)), int(l.get("x", 0)), int(l.get("h", 0)),
              (l.get("text") or "").strip()) for l in lines if (l.get("text") or "").strip()]
    items.sort(key=lambda t: (t[0], t[1]))
    rows: list[str] = []
    row: list[tuple[int, str]] = []
    row_y = None
    for y, x, h, txt in items:
        band = max(8, int(h * 0.6)) if h else 12
        if row_y is None or abs(y - row_y) <= band:
            row.append((x, txt))
            if row_y is None:
                row_y = y
        else:
            row.sort(key=lambda t: t[0])
            rows.append(" ".join(t for _, t in row))
            row = [(x, txt)]
            row_y = y
    if row:
        row.sort(key=lambda t: t[0])
        rows.append(" ".join(t for _, t in row))
    return "\n".join(rows).strip()


class PaddleWorker:
    """Sottoprocesso persistente che fa OCR con PaddleOCR (venv della webapp).

    Il modello si carica una sola volta (~5-10s), poi ogni pagina costa solo
    l'inferenza. Protocollo a righe JSON identico a ocr_worker.py:
      stdin  -> {"id": n, "path": "...png"}
      stdout -> {"id": n, "lines": [{"text","x","y","w","h"}, ...]}
    Serializzato con un lock: una sola istanza modello, chiamate in coda.
    """
    _instance: "PaddleWorker | None" = None
    _instance_lock = threading.Lock()

    def __init__(self, timeout: int):
        import subprocess
        py = _paddle_python()
        if py is None or not PADDLE_WORKER.is_file():
            raise RuntimeError(
                "PaddleOCR non disponibile: worker o venv non trovati in "
                f"'{PADDLE_APP_DIR}'. Imposta le variabili PADDLE_APP_DIR / "
                "PADDLE_PYTHON, oppure usa --model tesseract."
            )
        self._lock = threading.Lock()
        self._next_id = 0
        self.engine = "PaddleOCR"
        self._proc = subprocess.Popen(
            [str(py), str(PADDLE_WORKER)],
            cwd=str(PADDLE_APP_DIR),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,   # i log Paddle vanno qui, non sporcano il protocollo
            text=True,
            encoding="utf-8",
            bufsize=1,
        )
        self._await_ready()

    @classmethod
    def get(cls, timeout: int) -> "PaddleWorker":
        with cls._instance_lock:
            if cls._instance is None or cls._instance._proc.poll() is not None:
                cls._instance = cls(timeout)
            return cls._instance

    def _readline_json(self) -> dict:
        line = self._proc.stdout.readline()
        if line == "":
            raise RuntimeError(
                "Worker PaddleOCR terminato inatteso (venv/modelli mancanti?)."
            )
        return json.loads(line)

    def _await_ready(self):
        # legge finché arriva {"ready": true}; al primo avvio assoluto scarica i modelli
        while True:
            msg = self._readline_json()
            if msg.get("ready"):
                self.engine = msg.get("engine", "PaddleOCR")
                return
            if "error" in msg:
                raise RuntimeError(f"PaddleOCR avvio: {msg['error']}")

    def ocr(self, image_png: bytes) -> str:
        import tempfile
        with self._lock:
            if self._proc.poll() is not None:
                raise RuntimeError("Worker PaddleOCR non attivo.")
            self._next_id += 1
            rid = self._next_id
            fd, tmp = tempfile.mkstemp(suffix=".png")
            try:
                with os.fdopen(fd, "wb") as f:
                    f.write(image_png)
                self._proc.stdin.write(json.dumps({"id": rid, "path": tmp}) + "\n")
                self._proc.stdin.flush()
                while True:
                    msg = self._readline_json()
                    if msg.get("id") != rid:
                        continue          # scarto eventuali messaggi non pertinenti
                    if "error" in msg:
                        raise RuntimeError(f"PaddleOCR: {msg['error']}")
                    return _paddle_lines_to_text(msg.get("lines", []))
            finally:
                try:
                    os.unlink(tmp)
                except OSError:
                    pass


def ocr_image(image_png: bytes, model: str, ollama_url: str, timeout: int) -> str:
    """Manda l'immagine a Ollama e restituisce il testo estratto."""
    payload = {
        "model": model,
        "prompt": PROMPT_OCR,
        "images": [base64.b64encode(image_png).decode("ascii")],
        "stream": False,
        "options": {"temperature": 0},
    }
    resp = requests.post(f"{ollama_url}/api/generate", json=payload, timeout=timeout)
    if resp.status_code != 200:
        try:
            detail = resp.json().get("error", resp.text)
        except ValueError:
            detail = resp.text
        raise RuntimeError(f"Ollama ({model}): {detail}")
    return resp.json().get("response", "").strip()


def run_ocr(image_png: bytes, model: str, ollama_url: str, timeout: int,
            lang: str = "ita+eng", preprocess: bool | None = None) -> str:
    """Smista l'OCR: 'tesseract', 'paddle' oppure modello Ollama vision."""
    m = model.lower()
    if m.startswith("tesseract"):
        return ocr_image_tesseract(image_png, lang=lang, preprocess=preprocess)
    if m in ("paddle", "paddleocr"):
        # Paddle preferisce l'immagine originale: niente binarizzazione a monte,
        # fa da sé il preprocessing. Utile su scansioni molto sporche.
        return PaddleWorker.get(timeout).ocr(image_png)
    return ocr_image(image_png, model, ollama_url, timeout)


# --------------------------------------------------------------------------
# Cache OCR su disco (chiave su hash contenuto, senza renderizzare i pixel)
# --------------------------------------------------------------------------

def _cache_path(doc_hash: str, page: int, dpi: int, model: str, lang: str) -> Path:
    raw = f"{PIPELINE_VERSION}|{model}|{lang}|{dpi}|{doc_hash}|{page}"
    return CACHE_DIR / f"{hashlib.sha256(raw.encode()).hexdigest()}.txt"


def cache_get(doc_hash: str, page: int, dpi: int, model: str, lang: str) -> str | None:
    path = _cache_path(doc_hash, page, dpi, model, lang)
    if path.is_file():
        return path.read_text(encoding="utf-8")
    return None


def cache_put(doc_hash: str, page: int, dpi: int, model: str, lang: str, text: str):
    CACHE_DIR.mkdir(exist_ok=True)
    _cache_path(doc_hash, page, dpi, model, lang).write_text(text, encoding="utf-8")


def prune_cache(max_age_days: int = 30):
    """Elimina i risultati OCR in cache più vecchi di max_age_days."""
    import time
    if not CACHE_DIR.is_dir():
        return
    cutoff = time.time() - max_age_days * 86400
    for f in CACHE_DIR.glob("*.txt"):
        try:
            if f.stat().st_mtime < cutoff:
                f.unlink()
        except OSError:
            pass


def _needs_ocr(doc: Document, i: int) -> bool:
    if not doc.has_images:
        return False
    return len(doc.embedded_text(i)) < MIN_EMBEDDED_CHARS


def ocr_needed_count(doc: Document, model: str, dpi: int, lang: str) -> int:
    """Quante pagine richiederanno OCR vero (né embedded né cache)."""
    h = doc.content_hash()
    return sum(1 for i in range(doc.count)
               if _needs_ocr(doc, i)
               and cache_get(h, i, dpi, model, lang) is None)


# --------------------------------------------------------------------------
# Raccolta testi: embedded -> cache -> OCR (render pigro, parallelo)
# --------------------------------------------------------------------------

def collect_texts(doc: Document, model: str, ollama_url: str = OLLAMA_URL_DEFAULT,
                  timeout: int = 600, dpi: int = 200, lang: str = "ita+eng",
                  preprocess: bool | None = None,
                  progress=None, cancel=None) -> tuple[list[str], list[str]]:
    """
    Testo di ogni pagina. Ritorna (testi, fonti) dove fonte è
    'testo' (embedded), 'cache' oppure 'ocr'.
    Le pagine da OCR vengono renderizzate su richiesta (memoria costante).
    progress(fatte, totali_ocr) viene chiamato man mano; cancel() True annulla.
    """
    n = doc.count
    h = doc.content_hash()
    texts: list[str | None] = [None] * n
    sources = ["ocr"] * n

    need = []
    for i in range(n):
        if not _needs_ocr(doc, i):
            texts[i] = doc.embedded_text(i)
            sources[i] = "testo"
            continue
        cached = cache_get(h, i, dpi, model, lang)
        if cached is not None:
            texts[i] = cached
            sources[i] = "cache"
        else:
            need.append(i)

    done = 0

    def do(i: int):
        if cancel and cancel():
            raise OcrCancelled()
        png = doc.render_full(i, dpi)
        text = run_ocr(png, model, ollama_url, timeout, lang=lang,
                       preprocess=preprocess)
        cache_put(h, i, dpi, model, lang, text)
        return i, text

    if need:
        if model.lower().startswith("tesseract"):
            workers = min(8, os.cpu_count() or 4)
            with ThreadPoolExecutor(max_workers=workers) as pool:
                futures = [pool.submit(do, i) for i in need]
                for fut in as_completed(futures):
                    if cancel and cancel():
                        for f in futures:
                            f.cancel()
                        raise OcrCancelled()
                    i, text = fut.result()
                    texts[i] = text
                    done += 1
                    if progress:
                        progress(done, len(need))
        else:
            for i in need:
                if cancel and cancel():
                    raise OcrCancelled()
                _, text = do(i)
                texts[i] = text
                done += 1
                if progress:
                    progress(done, len(need))

    return [t or "" for t in texts], sources


# --------------------------------------------------------------------------
# Normalizzazione, filtri e diff
# --------------------------------------------------------------------------

def normalize_lines(text: str) -> list[str]:
    """Normalizza il testo: rimuove spazi multipli e righe vuote."""
    lines = []
    for raw in text.splitlines():
        line = " ".join(raw.split())
        if line:
            lines.append(line)
    return lines


def apply_ignore(lines: list[str], patterns: list[re.Pattern]) -> list[str]:
    """Scarta le righe che corrispondono a uno dei filtri 'ignora'."""
    if not patterns:
        return lines
    return [l for l in lines if not any(p.search(l) for p in patterns)]


# Limiti anti-ReDoS sui pattern "ignora" forniti dall'utente. Le regex utente
# vengono eseguite su OGNI riga di OGNI pagina: una regex malevola/maldestra con
# quantificatori annidati (es. "(a+)+$") può innescare backtracking catastrofico
# e bloccare la CPU. Python `re` non offre timeout, quindi ci difendiamo a monte:
# limitiamo numero e lunghezza dei pattern e rifiutiamo le forme note pericolose.
MAX_IGNORE_PATTERNS = 200
MAX_IGNORE_PATTERN_LEN = 500
# Gruppo con quantificatore interno, a sua volta quantificato: la sorgente
# principale di ReDoS. Euristica best-effort (non copre ogni caso, es. "(a|a)+").
_REDOS_RE = re.compile(r"\([^)]*[*+][^)]*\)\s*[*+{]")


def _looks_catastrophic(pattern: str) -> bool:
    """True se la regex ha una struttura a rischio backtracking esponenziale."""
    return bool(_REDOS_RE.search(pattern))


def compile_ignore(raw_patterns: list[str]) -> list[re.Pattern]:
    """Compila i filtri regex, saltando righe vuote, pattern non validi,
    troppo lunghi o a rischio ReDoS. Al più MAX_IGNORE_PATTERNS pattern."""
    compiled = []
    for raw in raw_patterns:
        raw = raw.strip()
        if not raw:
            continue
        if len(raw) > MAX_IGNORE_PATTERN_LEN or _looks_catastrophic(raw):
            continue                     # pattern troppo lungo o pericoloso: ignorato
        try:
            compiled.append(re.compile(raw, re.IGNORECASE))
        except re.error:
            continue
        if len(compiled) >= MAX_IGNORE_PATTERNS:
            break                        # tetto al numero di filtri
    return compiled


# Confusabili OCR: cifre/simboli verso la lettera visivamente equivalente.
# Usato SOLO in modo tollerante. Non fonde cifre diverse tra loro, quindi
# importi distinti restano distinti.
_OCR_CONFUSABLES = str.maketrans({
    "0": "o", "1": "l", "|": "l", "!": "l", "5": "s", "8": "b",
    "2": "z", "6": "g", "9": "g",
})


def norm_compare(s: str, tolerant: bool) -> str:
    """
    Chiave di confronto. In modo tollerante ignora il rumore OCR:
    minuscole, accenti rimossi, confusabili normalizzati, punteggiatura via.
    """
    if not tolerant:
        return s
    s = s.lower()
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.translate(_OCR_CONFUSABLES)
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return " ".join(s.split())


def word_segments(a: str, b: str, tolerant: bool = False) -> tuple[list[dict], list[dict]]:
    """
    Diff a livello parola tra due righe simili. L'uguaglianza è valutata sulle
    chiavi normalizzate (in modo tollerante), ma vengono mostrate le parole
    ORIGINALI.
    """
    aw, bw = a.split(), b.split()
    ka = [norm_compare(w, tolerant) for w in aw]
    kb = [norm_compare(w, tolerant) for w in bw]
    matcher = difflib.SequenceMatcher(a=ka, b=kb, autojunk=False)
    segs_a, segs_b = [], []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            segs_a.append({"eq": True, "s": " ".join(aw[i1:i2])})
            segs_b.append({"eq": True, "s": " ".join(bw[j1:j2])})
        else:
            if i2 > i1:
                segs_a.append({"eq": False, "s": " ".join(aw[i1:i2])})
            if j2 > j1:
                segs_b.append({"eq": False, "s": " ".join(bw[j1:j2])})
    return segs_a, segs_b


def line_ops(lines1: list[str], lines2: list[str], tolerant: bool = False) -> list[dict]:
    """
    Diff riga per riga. L'allineamento e l'uguaglianza usano le chiavi
    normalizzate (in modo tollerante), ma il report mostra il testo ORIGINALE.
    Le righe simili diventano op 'change' con evidenziazione a livello di
    parola; le altre 'del'/'add'.
    """
    keys1 = [norm_compare(l, tolerant) for l in lines1]
    keys2 = [norm_compare(l, tolerant) for l in lines2]
    ops = []
    matcher = difflib.SequenceMatcher(a=keys1, b=keys2, autojunk=False)
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            ops.extend({"type": "equal", "text": t} for t in lines1[i1:i2])
        elif tag == "replace":
            n = min(i2 - i1, j2 - j1)
            for k in range(n):
                a, b = lines1[i1 + k], lines2[j1 + k]
                if difflib.SequenceMatcher(a=keys1[i1 + k], b=keys2[j1 + k]).ratio() >= 0.5:
                    segs_a, segs_b = word_segments(a, b, tolerant)
                    ops.append({"type": "change", "a": segs_a, "b": segs_b})
                else:
                    ops.append({"type": "del", "text": a})
                    ops.append({"type": "add", "text": b})
            ops.extend({"type": "del", "text": t} for t in lines1[i1 + n:i2])
            ops.extend({"type": "add", "text": t} for t in lines2[j1 + n:j2])
        elif tag == "delete":
            ops.extend({"type": "del", "text": t} for t in lines1[i1:i2])
        else:  # insert
            ops.extend({"type": "add", "text": t} for t in lines2[j1:j2])
    return ops


# --------------------------------------------------------------------------
# Allineamento intelligente delle pagine (Needleman-Wunsch, con banda)
# --------------------------------------------------------------------------

def _page_similarity(t1: str, t2: str, tolerant: bool = False) -> float:
    if tolerant:
        t1 = norm_compare(t1, True)
        t2 = norm_compare(t2, True)
    return difflib.SequenceMatcher(a=t1[:1200], b=t2[:1200], autojunk=False).ratio()


def align_pages(texts1: list[str], texts2: list[str], gap: float = 0.35,
                tolerant: bool = False) -> list[tuple[int | None, int | None]]:
    """
    Allinea le pagine dei due documenti per similarità di contenuto.
    Gestisce pagine inserite/rimosse: ritorna coppie (i, j) di indici,
    con None sul lato in cui la pagina manca. Su documenti lunghi calcola
    la similarità solo in una banda diagonale (molto più veloce).
    """
    n, m = len(texts1), len(texts2)
    if n == 0 or m == 0:
        return [(i, None) for i in range(n)] + [(None, j) for j in range(m)]

    # banda: evita O(n*m) confronti di testo su documenti lunghi e simili
    band = None
    if max(n, m) > 60:
        band = max(20, abs(n - m) + 10)

    default = -1.0 if band is not None else 0.0
    sim = [[default] * m for _ in range(n)]
    # Stessi punteggi di _page_similarity, calcolati meno volte: testo
    # normalizzato una volta per pagina (non a ogni coppia), un SequenceMatcher
    # per pagina del secondo documento (la sua tabella b2j si costruisce una
    # volta sola) e pagine identiche risolte senza confronto (ratio = 1.0).
    # Il costo dominante resta SequenceMatcher(autojunk=False) su testo molto
    # ripetitivo: ridurlo davvero cambierebbe i punteggi, quindi non si tocca.
    k1 = [(norm_compare(t, True) if tolerant else t)[:1200] for t in texts1]
    k2 = [(norm_compare(t, True) if tolerant else t)[:1200] for t in texts2]
    for j in range(m):
        sm = difflib.SequenceMatcher(b=k2[j], autojunk=False)
        lo, hi = (0, n) if band is None else (max(0, j - band), min(n, j + band + 1))
        for i in range(lo, hi):
            if k1[i] == k2[j]:
                sim[i][j] = 1.0
            else:
                sm.set_seq1(k1[i])
                sim[i][j] = sm.ratio()

    dp = [[0.0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        dp[i][0] = -gap * i
    for j in range(1, m + 1):
        dp[0][j] = -gap * j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            dp[i][j] = max(dp[i - 1][j - 1] + sim[i - 1][j - 1],
                           dp[i - 1][j] - gap,
                           dp[i][j - 1] - gap)

    pairs = []
    i, j = n, m
    eps = 1e-9
    while i > 0 and j > 0:
        if abs(dp[i][j] - (dp[i - 1][j - 1] + sim[i - 1][j - 1])) < eps:
            pairs.append((i - 1, j - 1))
            i, j = i - 1, j - 1
        elif abs(dp[i][j] - (dp[i - 1][j] - gap)) < eps:
            pairs.append((i - 1, None))
            i -= 1
        else:
            pairs.append((None, j - 1))
            j -= 1
    while i > 0:
        i -= 1
        pairs.append((i, None))
    while j > 0:
        j -= 1
        pairs.append((None, j))
    pairs.reverse()
    return pairs


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def _format_change(op: dict) -> tuple[str, str]:
    """Riga 'change' formattata per console: parole cambiate tra [parentesi]."""
    a = " ".join(s["s"] if s["eq"] else f"[{s['s']}]" for s in op["a"])
    b = " ".join(s["s"] if s["eq"] else f"[{s['s']}]" for s in op["b"])
    return a, b


def pick_files_gui() -> tuple[Path, Path] | None:
    """Selezione interattiva dei due file se lanciato senza argomenti."""
    import tkinter as tk
    from tkinter import filedialog

    types = [("Documenti", "*.pdf *.png *.jpg *.jpeg *.tif *.tiff *.bmp *.docx *.txt"),
             ("Tutti i file", "*.*")]
    root = tk.Tk()
    root.withdraw()
    f1 = filedialog.askopenfilename(title="Seleziona il PRIMO documento", filetypes=types)
    if not f1:
        return None
    f2 = filedialog.askopenfilename(title="Seleziona il SECONDO documento", filetypes=types)
    if not f2:
        return None
    root.destroy()
    return Path(f1), Path(f2)


def main() -> int:
    parser = argparse.ArgumentParser(description="Confronta due documenti (testo/OCR).")
    parser.add_argument("file1", type=Path, nargs="?")
    parser.add_argument("file2", type=Path, nargs="?")
    parser.add_argument("--model", default="tesseract",
                        help="motore OCR: 'tesseract' (default), 'paddle' "
                             "(scansioni molto sporche), o nome modello Ollama vision")
    parser.add_argument("--lang", default="ita+eng", help="lingua/e OCR Tesseract")
    parser.add_argument("--url", default=OLLAMA_URL_DEFAULT, help="endpoint Ollama")
    parser.add_argument("--dpi", type=int, default=200, help="risoluzione rendering pagine")
    parser.add_argument("--timeout", type=int, default=600, help="timeout OCR per pagina (s)")
    parser.add_argument("--tollerante", action="store_true",
                        help="confronto tollerante: ignora il rumore OCR")
    parser.add_argument("--no-preprocess", action="store_true",
                        help="disattiva il preprocessing delle scansioni")
    parser.add_argument("--report", type=Path, default=None, help="salva report su file")
    parser.add_argument("--ignora", action="append", default=[],
                        help="regex di righe da ignorare (ripetibile)")
    args = parser.parse_args()

    if args.file1 is None or args.file2 is None:
        picked = pick_files_gui()
        if picked is None:
            print("Nessun file selezionato.", file=sys.stderr)
            return 1
        args.file1, args.file2 = picked

    for p in (args.file1, args.file2):
        if not p.is_file():
            print(f"ERRORE: file non trovato: {p}", file=sys.stderr)
            return 1

    ignore = compile_ignore(args.ignora)
    preprocess = not args.no_preprocess

    try:
        doc1 = open_document(args.file1)
        doc2 = open_document(args.file2)
    except DocumentError as exc:
        print(f"ERRORE: {exc}", file=sys.stderr)
        return 1

    print(f"  {doc1.name}: {doc1.count} pagine")
    print(f"  {doc2.name}: {doc2.count} pagine")

    def prog(done, total):
        print(f"  OCR {done}/{total}...", flush=True)

    print("Estrazione testo (embedded/cache/OCR)...")
    common = dict(ollama_url=args.url, timeout=args.timeout, dpi=args.dpi,
                  lang=args.lang, preprocess=preprocess, progress=prog)
    texts1, src1 = collect_texts(doc1, args.model, **common)
    texts2, src2 = collect_texts(doc2, args.model, **common)
    print(f"  fonti A: {', '.join(src1)}")
    print(f"  fonti B: {', '.join(src2)}")

    pairs = align_pages(texts1, texts2, tolerant=args.tollerante)
    report: list[str] = []
    diff_pages = 0

    for idx_a, idx_b in pairs:
        if idx_a is None:
            msg = f"Pagina {idx_b + 1} di {doc2.name}: senza corrispondenza"
            print(msg)
            report.append(msg)
            diff_pages += 1
            continue
        if idx_b is None:
            msg = f"Pagina {idx_a + 1} di {doc1.name}: senza corrispondenza"
            print(msg)
            report.append(msg)
            diff_pages += 1
            continue

        lines1 = apply_ignore(normalize_lines(texts1[idx_a]), ignore)
        lines2 = apply_ignore(normalize_lines(texts2[idx_b]), ignore)
        ops = line_ops(lines1, lines2, tolerant=args.tollerante)
        changed = [op for op in ops if op["type"] != "equal"]
        label = (f"pag. {idx_a + 1}" if idx_a == idx_b
                 else f"pag. {idx_a + 1} ↔ {idx_b + 1}")

        if not changed:
            print(f"{label}: identica")
            continue

        diff_pages += 1
        header = f"===== {label} ====="
        print(header)
        report.append("\n" + header)
        for op in ops:
            if op["type"] == "equal":
                continue
            if op["type"] == "change":
                a, b = _format_change(op)
                lines = [f"- {a}", f"+ {b}"]
            elif op["type"] == "del":
                lines = [f"- {op['text']}"]
            else:
                lines = [f"+ {op['text']}"]
            for line in lines:
                print(f"  {line}")
                report.append(line)

    doc1.close()
    doc2.close()

    print("\n" + "=" * 50)
    summary = ("RISULTATO: nessuna differenza rilevata."
               if diff_pages == 0
               else f"RISULTATO: differenze in {diff_pages} pagina/e.")
    print(summary)
    report.append("\n" + summary)

    if args.report:
        args.report.write_text("\n".join(report), encoding="utf-8")
        print(f"Report salvato: {args.report}")

    return 0 if diff_pages == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
