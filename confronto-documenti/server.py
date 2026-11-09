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
  - Le anteprime pagina (JPEG) stanno in PREVIEWS finché il job è in RAM.
  - A fine confronto job e anteprime vanno anche su disco (storico.py): dopo
    un riavvio, o quando escono dalla RAM (MAX_JOBS_KEPT), si rileggono da lì.
  - I file caricati vanno in una cartella temporanea e sono cancellati a fine job.

OCR: testo embedded quando c'è, altrimenti Tesseract o PaddleOCR (scelta via
campo 'model'), con preprocessing scansioni e confronto tollerante al rumore
OCR. I modelli vision via Ollama restano solo nella CLI di confronta_pdf.py.

PDF firmati digitalmente (.p7m, CAdES): il worker apre la busta col motore comune
shared/firma (apri_busta), confronta il documento contenuto e mette nel job
firma_a / firma_b (esito, riepilogo, firmatari) e firma_nota (confronto fra le
firme). Una firma non valida si segnala, non blocca il confronto.

Confronti contemporanei limitati (CONFRONTO_MAX_PARALLELI, default 2): l'OCR
usa già tutti i core, oltre si va in coda invece di rallentare tutti.

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
from flask import Flask, Response, jsonify, request, send_from_directory
from PIL import Image

import storico

from confronta_pdf import (DocumentError, OcrCancelled, MIN_EMBEDDED_CHARS,
                           PADDLE_WORKER, align_pages, apply_ignore,
                           collect_texts, compile_ignore, find_tesseract,
                           line_ops, normalize_lines, numeri_cambiati,
                           ocr_needed_count, righe_ripetute, togli_ripetute,
                           open_document, preprocess_for_ocr, prune_cache,
                           _paddle_python)

if getattr(sys, "frozen", False):
    UI_DIR = Path(getattr(sys, "_MEIPASS", ".")) / "ui"   # bundle PyInstaller
else:
    UI_DIR = Path(__file__).parent / "ui"

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 200 * 1024 * 1024  # 200 MB

# Gate SSO condiviso con le altre app della suite: sta in shared/sso, cartella
# sorella del progetto, e ci si arriva aggiungendola al sys.path (l'app non è un
# pacchetto installato). Nell'exe PyInstaller il modulo è già dentro il bundle:
# lo trova pathex in ConfrontaPDF.spec, che va tenuto allineato a questo path.
if not getattr(sys, "frozen", False):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "shared" / "sso"))
SSO_SPENTO = os.environ.get("COSEDIL_SSO", "on").lower() == "off"
try:
    import cosedil_sso
except ImportError as err:
    if not SSO_SPENTO:       # gate assente = app senza login: meglio non partire
        print(f"Gate SSO non trovato ({err}): shared/sso/cosedil_sso.py manca o non è "
              "raggiungibile. Avvio annullato (COSEDIL_SSO=off per farne a meno).")
        sys.exit(1)
    cosedil_sso = None       # login spento: l'app gira anche fuori dalla suite (Docker)
# COSEDIL_SSO=off per lo sviluppo in locale o fuori dalla suite;
# COSEDIL_SSO_FAIL=open per tornare a usare l'app da sola quando il portale è spento.
# Le API del confronto (/api/compare, /api/jobs/...) le usano anche le altre app
# della suite (SkyTower: "confronta con la revisione precedente") col token di
# servizio di shared/suite, che non ha il cookie del portale: il gate SSO non le
# guarda (percorsi_liberi) e ci pensa _suite_gate qui sotto, che accetta o il
# token o una sessione valida del portale.
PERCORSI_SUITE = ("/api/compare", "/api/jobs/")
if not getattr(sys, "frozen", False):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "shared" / "suite"))
try:
    import suite_link
except ImportError:
    suite_link = None       # fuori dalla suite: nessun token, valgono solo sessione/password

if cosedil_sso is not None:
    cosedil_sso.init(app, app_id="confronta", percorsi_liberi=PERCORSI_SUITE if suite_link else ())

# PDF firmati digitalmente (.p7m, CAdES): li apre e ne verifica la firma il motore comune della suite
# (shared/firma, README lì e CONTRATTI.md §10). busta.py è solo libreria standard: le librerie di verifica stanno
# nell'ambiente shared/firma/.venv, che busta.apri richiama come processo separato. Senza il modulo (Docker fuori
# dalla suite, exe senza la cartella accanto) i .p7m danno un messaggio chiaro, il resto del confronto funziona.
# Nell'exe PyInstaller busta.py NON sta nel bundle (ConfrontaPDF.spec non lo include, apposta): si importa dal
# disco, da FIRMA_DIR o da <cartella dell'exe>\shared\firma, dove lo copia shared\firma\copia-motore.bat. Così
# busta.py trova accanto a sé firma.py e il .venv del motore, che dentro l'exe non potrebbero stare.
if getattr(sys, "frozen", False):
    sys.path.insert(0, os.environ.get("FIRMA_DIR") or str(Path(sys.executable).resolve().parent / "shared" / "firma"))
else:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "shared" / "firma"))
try:
    import busta as firma_busta
except ImportError:
    firma_busta = None


def _token_suite_valido():
    return suite_link is not None and suite_link.verifica(request.headers.get("X-Suite-Token"))


if cosedil_sso is not None and suite_link is not None and getattr(cosedil_sso, "ENABLED", True):
    from flask import g

    @app.before_request
    def _suite_gate():
        if not request.path.startswith(PERCORSI_SUITE):
            return None
        if _token_suite_valido():
            g.cosedil = {"ok": True, "suite": True, "admin": False,
                         "username": request.headers.get("X-Suite-Utente") or "suite",
                         "nome": request.headers.get("X-Suite-Nome") or "Suite Cosedil", "ruolo": "suite"}
            return None
        v = cosedil_sso.verifica_sessione(request.headers.get("Cookie", ""), "confronta")
        if v["ok"]:
            g.cosedil = v
            return None
        if v.get("vietato"):
            return jsonify(ok=False, error=cosedil_sso.MSG_NON_ABILITATO), 403
        if not v["reachable"]:
            if cosedil_sso.FAIL_OPEN:
                return None
            return jsonify(ok=False, error=cosedil_sso.MSG_PORTALE_GIU), 503
        return jsonify(ok=False, error=cosedil_sso.MSG_NON_LOGGATO), 401

# ---------------------------------------------------------------------------
# Chi sta chiamando e cosa può fare sui confronti (revisione di sicurezza del 03/11/2026).
# Prima chiunque avesse una sessione poteva annullare, cancellare o annotare qualunque confronto
# conoscendone l'id (passa negli URL e nei report): ora ogni job ricorda il proprietario.

from flask import g  # noqa: E402 - usato dalle funzioni qui sotto anche quando il gate suite non è montato

CODA_MAX_PER_UTENTE = max(1, int(os.environ.get("CONFRONTO_CODA_MAX_PER_UTENTE", "3")))


def _identita() -> tuple[str, bool]:
    """(username, è admin) di chi chiama.

    - token di servizio della suite (altre app, es. SkyTower): username dichiarato nell'header, admin;
    - sessione del portale: username e flag admin del portale;
    - password HTTP Basic o SSO spento (uso da solo, Docker, sviluppo): un solo utente, admin.
    """
    v = g.get("cosedil") if hasattr(g, "get") else None
    if v and v.get("ok"):
        if v.get("suite"):
            return (v.get("username") or "suite"), True
        return (v.get("username") or ""), bool(v.get("admin"))
    return (_UTENTE if _PASSWORD else "locale"), True


def _puo_gestire(job: dict | None) -> bool:
    """Annullare, eliminare o annotare un confronto può farlo chi l'ha avviato o un admin.
    I confronti fatti prima di questa regola non hanno proprietario: restano gestibili da tutti,
    come prima, finché scadono dallo storico (CONFRONTO_STORICO_GIORNI)."""
    if job is None:
        return False
    username, admin = _identita()
    proprietario = job.get("proprietario")
    return admin or not proprietario or proprietario == username


def _coda_piena(username: str) -> bool:
    """Più di CODA_MAX_PER_UTENTE confronti in coda per lo stesso utente: si aspetta che finiscano.
    Senza questo tetto un utente intasa il motore (OCR su file da 200 MB) per tutti gli altri."""
    with JOBS_LOCK:
        in_coda = sum(1 for j in JOBS.values()
                      if j.get("status") == "queued" and j.get("proprietario") == username)
    return in_coda >= CODA_MAX_PER_UTENTE


def _controlla_esposizione(host: str, sso_spento: bool, password: str) -> None:
    """In ascolto sulla rete (HOST diverso da loopback) senza alcun login l'app sarebbe aperta a
    chiunque in LAN: upload, storico e cancellazioni. Meglio non partire che partire così."""
    if host not in ("127.0.0.1", "localhost", "::1") and sso_spento and not password:
        raise SystemExit(
            f"HOST={host}: l'app sarebbe raggiungibile dalla rete senza login. Impostare CONFRONTO_PASSWORD "
            "oppure lasciare attivo il gate del portale (COSEDIL_SSO non a off), o ascoltare solo su 127.0.0.1.")


# Password semplice per l'uso fuori dall'ufficio (Docker / cloud, sempre dietro
# HTTPS): con CONFRONTO_PASSWORD impostata ogni richiesta chiede utente e
# password (HTTP Basic). Utente: CONFRONTO_UTENTE, default "cosedil".
_PASSWORD = os.environ.get("CONFRONTO_PASSWORD", "")
_UTENTE = os.environ.get("CONFRONTO_UTENTE", "cosedil")
if _PASSWORD:
    import hmac

    @app.before_request
    def _password_gate():
        if request.path == "/healthz":          # controllo di salute del container
            return None
        if request.path.startswith(PERCORSI_SUITE) and _token_suite_valido():
            return None                          # chiamata di un'altra app della suite
        auth = request.authorization
        if (auth and hmac.compare_digest(auth.username or "", _UTENTE)
                and hmac.compare_digest(auth.password or "", _PASSWORD)):
            return None
        return Response("Accesso riservato.", 401,
                        {"WWW-Authenticate": 'Basic realm="Confronto Documenti", charset="UTF-8"'})

# Errori del log (eccezioni nelle richieste, OCR fallito...) anche agli admin del
# portale, nella pagina Avvisi (shared/avvisi). Facoltativo: nell'exe o fuori
# dalla suite il modulo puo' mancare e l'app funziona come prima.
if not getattr(sys, "frozen", False):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "shared" / "avvisi"))
try:
    import avvisi
    avvisi.collega_log("confronta")
except ImportError:
    pass

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
# Confronti eseguiti insieme: gli altri aspettano in coda ("In coda...").
MAX_PARALLELI = max(1, int(os.environ.get("CONFRONTO_MAX_PARALLELI", "2")))
_SLOT_CONFRONTO = threading.BoundedSemaphore(MAX_PARALLELI)
MAX_JOBS_KEPT = 2   # job FINITI tenuti in RAM (sono comunque su disco)
PREVIEW_MAX_W = 1100

# Stati di revisione di una differenza (revisione.js / PUT .../revisione).
_STATI_REVISIONE = {"vista": "vista", "ok": "accettata", "dubbio": "da chiarire"}

ALLOWED_EXTS = {".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp",
                ".webp", ".gif", ".docx", ".txt", ".md", ".csv"}
# Busta firmata: "contratto.pdf.p7m". Si accetta se dentro c'è un formato di ALLOWED_EXTS (o se il nome non lo
# dice: lo stabilisce il motore dal contenuto, dopo l'apertura).
EXT_FIRMATA = ".p7m"
# Testa del file letta per riconoscere una busta anche senza estensione .p7m (DER o base64, vedi busta.py).
TESTA_BUSTA = 64 * 1024

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
    """Tiene in RAM solo gli ultimi MAX_JOBS_KEPT job finiti (anteprime
    incluse): quelli in coda o in corso restano sempre."""
    with JOBS_LOCK:
        finiti = [k for k, j in JOBS.items()
                  if j.get("status") in ("done", "error", "cancelled")]
        for k in finiti[:max(0, len(finiti) - MAX_JOBS_KEPT)]:
            JOBS.pop(k, None)
            PREVIEWS.pop(k, None)


def get_job(job_id: str) -> dict | None:
    """Copia del job: dalla RAM se c'è, altrimenti dallo storico su disco."""
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if job is not None:
            return dict(job)
    return storico.carica(job_id)


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


def _posizioni(ops: list[dict], n_a: int, n_b: int):
    """Posizione verticale approssimata (0-1) di ogni riga sulle due pagine,
    per portare l'anteprima sul punto della differenza cliccata. Stima dalla
    posizione della riga nel testo, con i margini tipici di una pagina."""
    ia = ib = 0

    def y(i: int, n: int) -> float:
        return round(0.06 + 0.88 * (i + 0.5) / max(n, 1), 4)

    for op in ops:
        t = op["type"]
        if t in ("equal", "change"):
            op["ya"], op["yb"] = y(ia, n_a), y(ib, n_b)
            ia, ib = ia + 1, ib + 1
        elif t in ("del", "moved"):
            op["ya"], op["yb"] = y(ia, n_a), y(ib, n_b)
            ia += 1
        else:  # add
            op["ya"], op["yb"] = y(ia, n_a), y(ib, n_b)
            ib += 1


# --------------------------------------------------------------------------
# PDF firmati digitalmente (.p7m)
# --------------------------------------------------------------------------

def _senza_p7m(nome: str) -> str:
    """"offerta.pdf.p7m.p7m" → "offerta.pdf" (buste annidate)."""
    base = Path(nome or "").name
    while base.lower().endswith(EXT_FIRMATA):
        base = base[:-len(EXT_FIRMATA)]
    return base


def _riassunto_firma(rapporto: dict) -> dict:
    """Il rapporto del motore ridotto a quello che serve a pagina, report e storico (niente dati superflui):
    esito della busta, riga di riepilogo e, per ogni firmatario, chi è, ente, tipo, esito, motivi e date."""
    firme = []
    for f in rapporto.get("firme") or []:
        marca = f.get("marca_temporale") or {}
        firme.append({
            "firmatario": f.get("firmatario"), "codice_fiscale": f.get("codice_fiscale"),
            "organizzazione": f.get("organizzazione"), "ente": f.get("ente_certificatore"),
            "tipo": f.get("tipo"), "esito": f.get("esito"), "motivi": f.get("motivi") or [],
            "data_firma": f.get("data_firma_dichiarata"),
            "marca_temporale": marca.get("data") if marca.get("valida") else None,
            "certificato_valido_al": f.get("certificato_valido_al"),
        })
    elenchi = rapporto.get("elenchi") or {}
    return {"esito": rapporto.get("esito"), "riepilogo": rapporto.get("riepilogo") or "",
            "livelli": rapporto.get("livelli") or 1, "documento": rapporto.get("nome_contenuto"),
            "firme": firme, "elenchi_del": elenchi.get("aggiornati_il")}


def apri_busta(path: Path, nome: str) -> tuple[Path, dict | None]:
    """Se il file caricato è una busta .p7m ne estrae il documento (accanto, nella stessa cartella temporanea) e
    rende (percorso del documento, riassunto della firma); un file non firmato torna com'è con None.

    Una firma non valida NON blocca: il confronto si fa e la firma si segnala. Bloccano solo le buste che non si
    possono aprire (DocumentError con un messaggio per l'utente): motore non installato, .p7m rotto o con la
    firma staccata, contenuto in un formato che il confronto non legge. Se la sola verifica non riesce (rete,
    processo che non risponde) il documento si estrae senza verifica e la firma resta "da verificare"."""
    with open(path, "rb") as fh:
        testa = fh.read(TESTA_BUSTA)
    if firma_busta is None:
        if nome.lower().endswith(EXT_FIRMATA):
            # busta.py non importato: exe senza la cartella shared\firma accanto, o Docker fuori dalla suite
            raise DocumentError(f"«{nome}» è firmato digitalmente (.p7m) ma questa installazione non ha il "
                                "componente della firma digitale: copiare la cartella shared\\firma della suite "
                                "accanto al programma (o indicarla con FIRMA_DIR) e riavviarlo.")
        return path, None
    if not firma_busta.e_busta_firmata(testa, nome):
        return path, None
    dati = path.read_bytes()
    try:
        contenuto, nome_doc, rapporto = firma_busta.apri(dati, nome)
    except firma_busta.FirmaNonInstallata as exc:
        # il messaggio del client dice già cosa fare: "in installazione, riprovare fra qualche minuto" (la prima
        # busta avvia da sola installa.bat in disparte) oppure quale installa.bat lanciare a mano
        raise DocumentError(f"«{nome}» è firmato digitalmente (.p7m) ma il componente della firma digitale non è "
                            f"pronto. {exc}") from None
    except firma_busta.BustaIllegibile as exc:
        raise DocumentError(f"«{nome}»: {exc}") from None
    except Exception as exc:                         # noqa: BLE001 - verifica fallita (rete, tempo scaduto)
        try:
            contenuto, nome_doc, rapporto = firma_busta.apri(dati, nome, verifica=False)
        except firma_busta.BustaIllegibile as exc2:
            raise DocumentError(f"«{nome}»: {exc2}") from None
        except Exception as exc2:                    # noqa: BLE001 - nemmeno l'estrazione: busta inservibile
            raise DocumentError(f"«{nome}»: busta firmata non apribile ({exc2}).") from None
        rapporto["esito"] = "da verificare"
        rapporto["riepilogo"] = f"Firma non verificata ({str(exc)[:120]}): " + (rapporto.get("riepilogo") or "")
    ext = Path(nome_doc).suffix.lower()
    if ext not in ALLOWED_EXTS:
        raise DocumentError(f"«{nome}» contiene un file {ext or 'senza estensione'} che il confronto non legge "
                            "(ammessi PDF, immagini, Word .docx, testo).")
    estratto = path.with_name(f"{path.stem}_contenuto{ext}")
    estratto.write_bytes(contenuto)
    return estratto, _riassunto_firma(rapporto)


def _chi_firma(firma: dict) -> set[str]:
    """Firmatari di una busta, per riconoscerli fra A e B: codice fiscale se c'è, altrimenti il nome."""
    return {(f.get("codice_fiscale") or f.get("firmatario") or "?").upper() for f in firma.get("firme") or []}


def nota_firme(firma_a: dict | None, firma_b: dict | None) -> str | None:
    """Una frase che mette a confronto le firme dei due documenti (None se nessuno dei due è firmato)."""
    if not firma_a and not firma_b:
        return None
    if firma_a and not firma_b:
        return f"Solo A è firmato digitalmente (firma {firma_a['esito'] or 'non verificata'}); B non è firmato."
    if firma_b and not firma_a:
        return f"Solo B è firmato digitalmente (firma {firma_b['esito'] or 'non verificata'}); A non è firmato."
    nomi = lambda f: ", ".join(x.get("firmatario") or "?" for x in f["firme"]) or "?"   # noqa: E731
    if _chi_firma(firma_a) == _chi_firma(firma_b):
        frase = f"A e B firmati digitalmente dagli stessi firmatari ({nomi(firma_a)})"
    else:
        frase = f"Firmatari diversi: A da {nomi(firma_a)}, B da {nomi(firma_b)}"
    if firma_a["esito"] != firma_b["esito"]:
        frase += f"; firma di A {firma_a['esito'] or 'non verificata'}, di B {firma_b['esito'] or 'non verificata'}"
    return frase + "."


def _righe_firme(job: dict) -> list[str]:
    """Righe "firma digitale" per i report scaricabili (Word, PDF, Excel): una per documento firmato + la nota."""
    righe = []
    for lato in ("a", "b"):
        f = job.get(f"firma_{lato}")
        if f:
            righe.append(f"Firma digitale {lato.upper()}: {f.get('riepilogo') or f.get('esito') or ''}")
    if job.get("firma_nota"):
        righe.append(job["firma_nota"])
    return righe


def run_compare_in_coda(job_id: str, path1: Path, path2: Path, *args):
    """Aspetta uno slot libero (MAX_PARALLELI) e poi esegue run_compare.
    Annullato mentre è in coda: niente lavoro, file caricati cancellati."""
    while not _SLOT_CONFRONTO.acquire(timeout=1):
        if is_cancelled(job_id):
            update_job(job_id, status="cancelled", message="Confronto annullato.")
            for p in (path1, path2):
                p.unlink(missing_ok=True)
            return
    try:
        run_compare(job_id, path1, path2, *args)
    finally:
        _SLOT_CONFRONTO.release()


def run_compare(job_id: str, path1: Path, path2: Path, name1: str, name2: str,
                model: str, dpi: int, lang: str, tolerant: bool,
                preprocess: bool, ignore_raw: list[str], ripetute: bool = True):
    """Worker del confronto, eseguito in un thread separato (vedi /api/compare).

    Non ritorna niente: comunica solo aggiornando il job via update_job()
    (status: rendering -> ocr -> done|error|cancelled), che il front-end legge in
    polling. Fasi: apri documenti -> anteprime -> OCR/estrazione testo ->
    allineamento pagine -> diff per riga/parola -> salva i risultati nel job.
    """
    doc1 = doc2 = None
    estratti: list[Path] = []          # documenti tirati fuori dalle buste .p7m: da cancellare a fine job
    try:
        ignore = compile_ignore(ignore_raw)

        update_job(job_id, status="rendering", message="Apertura documenti...")
        try:
            # Buste firmate (.p7m): prima si apre la busta e si verifica la firma, poi si confronta il
            # documento contenuto come qualunque altro. firma_a/firma_b restano nel job (e nello storico).
            firme, documenti = {}, {"a": path1, "b": path2}
            for lato, nome in (("a", name1), ("b", name2)):
                if nome.lower().endswith(EXT_FIRMATA):
                    update_job(job_id, message=f"Verifica della firma digitale di «{nome}»...")
                nuovo, firme[lato] = apri_busta(documenti[lato], nome)
                if nuovo != documenti[lato]:
                    estratti.append(nuovo)
                    documenti[lato] = nuovo
            firma_nota = nota_firme(firme["a"], firme["b"])
            update_job(job_id, firma_a=firme["a"], firma_b=firme["b"], firma_nota=firma_nota)
            doc1 = open_document(documenti["a"])
            doc2 = open_document(documenti["b"])
        except DocumentError as exc:
            update_job(job_id, status="error", message=str(exc))
            return

        update_job(job_id, message="Rendering anteprime...")
        prev1 = _build_previews(job_id, doc1, "a")
        prev2 = _build_previews(job_id, doc2, "b")

        if is_cancelled(job_id):
            raise OcrCancelled()

        # barra progresso: conta solo le pagine che faranno OCR vero
        ocr_total = (ocr_needed_count(doc1, model, dpi, lang, preprocess)
                     + ocr_needed_count(doc2, model, dpi, lang, preprocess))
        update_job(job_id, total_pages=ocr_total, current_page=0,
                   pages_a=doc1.count, pages_b=doc2.count, status="ocr",
                   message=("Lettura testo embedded..." if ocr_total == 0
                            else f"OCR di {ocr_total} pagina/e scansionate..."))
        progress_state = {"done": 0}

        def prog(_done, _total):
            progress_state["done"] += 1
            update_job(job_id, current_page=progress_state["done"],
                       message=f"OCR: pagina {progress_state['done']} di {ocr_total}...")

        common = dict(timeout=600, dpi=dpi, lang=lang,
                      preprocess=preprocess, progress=prog,
                      cancel=lambda: is_cancelled(job_id))
        texts1, src1 = collect_texts(doc1, model, **common)
        texts2, src2 = collect_texts(doc2, model, **common)

        update_job(job_id, message="Allineamento pagine e calcolo differenze...")
        # "><(((º> sabusabu <º)))><"
        pairs = align_pages(texts1, texts2, tolerant=tolerant)

        # righe di ogni pagina dopo i filtri "ignora" dell'utente
        righe1 = [apply_ignore(normalize_lines(t), ignore) for t in texts1]
        righe2 = [apply_ignore(normalize_lines(t), ignore) for t in texts2]
        chiavi = righe_ripetute(righe1, righe2) if ripetute else set()

        results = []
        diff_count = 0
        uncertain_count = 0   # pagine con sole differenze "incerte" (probabile rumore OCR)
        visual_count = 0      # pagine con testo uguale ma grafica diversa (PDF nativi)
        ripetute_tolte = 0
        riepilogo = []        # numeri e date cambiati, per il riquadro in cima al report
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

            lines1, tolte1 = togli_ripetute(righe1[idx_a], chiavi)
            lines2, tolte2 = togli_ripetute(righe2[idx_b], chiavi)
            ripetute_tolte += tolte1 + tolte2
            ops = line_ops(lines1, lines2, tolerant=tolerant)
            _posizioni(ops, len(lines1), len(lines2))
            has_diff = any(op["type"] not in ("equal", "moved") and not op.get("incerta")
                           for op in ops)
            only_uncertain = not has_diff and any(op.get("incerta") for op in ops)

            img_a, img_b = prev1[idx_a], prev2[idx_b]
            boxes = diff_boxes(img_a, img_b) if (img_a and img_b) else []
            # Testo uguale ma immagine diversa: timbro, firma, disegno. Solo con
            # testo embedded da entrambe le parti: sulle scansioni i pixel
            # differiscono sempre un po' e sarebbe solo rumore.
            only_visual = (not has_diff and not only_uncertain and bool(boxes)
                           and src1[idx_a] == src2[idx_b] == "testo")
            if has_diff:
                diff_count += 1
            elif only_uncertain:
                uncertain_count += 1
            elif only_visual:
                visual_count += 1

            numeri = numeri_cambiati(ops)
            label_pag = (f"{idx_a + 1}" if idx_a == idx_b else f"{idx_a + 1}↔{idx_b + 1}")
            riepilogo += [dict(n, pagina=label_pag, risultato=len(results)) for n in numeri]
            results.append({
                "page_a": idx_a + 1, "page_b": idx_b + 1,
                "status": ("diff" if has_diff else
                           "uncertain" if only_uncertain else
                           "visual" if only_visual else "equal"),
                "ops": ops, "boxes": boxes,
                "source_a": src1[idx_a], "source_b": src2[idx_b],
                "text_a": texts1[idx_a], "text_b": texts2[idx_b],
            })
            label = (f"pagina {idx_a + 1}" if idx_a == idx_b
                     else f"pagina {idx_a + 1}<->{idx_b + 1}")
            print(f"[{job_id}]   {label}: "
                  f"{'DIFFERENZE' if has_diff else 'incerte' if only_uncertain else 'identica'}",
                  flush=True)

        message = ("Nessuna differenza rilevata." if diff_count == 0
                   else f"Differenze in {diff_count} pagina/e.")
        if uncertain_count:
            message += (f" {uncertain_count} pagina/e con sole differenze incerte"
                        " (probabili errori di lettura).")
        if visual_count:
            message += (f" {visual_count} pagina/e con testo uguale ma grafica diversa"
                        " (timbri, firme, disegni).")
        if ripetute_tolte:
            message += f" Ignorate {ripetute_tolte} righe di intestazione/piè di pagina ripetute."
        if firma_nota:                  # anche nel riassunto dello storico, non solo nel riquadro delle firme
            message += f" {firma_nota}"
        update_job(job_id, results=results, status="done", diff_count=diff_count,
                   uncertain_count=uncertain_count, visual_count=visual_count,
                   riepilogo=riepilogo, message=message)
        with JOBS_LOCK:
            snap, anteprime = dict(JOBS.get(job_id, {})), dict(PREVIEWS.get(job_id, {}))
        try:
            storico.salva(job_id, snap, anteprime)
        except OSError as exc:      # disco pieno/non scrivibile: il confronto resta valido
            print(f"[{job_id}] storico non salvato: {exc}", flush=True)
        prune_old_jobs()
    except OcrCancelled:
        update_job(job_id, status="cancelled", message="Confronto annullato.")
    except Exception as exc:  # pragma: no cover
        update_job(job_id, status="error", message=f"Errore: {exc}")
    finally:
        for d in (doc1, doc2):
            try:
                if d is not None:
                    d.close()
            except Exception:
                pass
        for p in (path1, path2, *estratti):
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
        elif op["type"] == "moved":                # stessa riga, altra posizione
            rows.append([("  " + op["text"] + "   [spostata]", GREY, False)])
        elif op.get("incerta"):                    # probabile errore di lettura
            row = [("? ", GREY, False)]
            row += [(s["s"] + " ", GREY if not s["eq"] else INK, not s["eq"])
                    for s in op["b"]]
            rows.append(row)
        else:
            row = [("~ ", INK, False)]
            row += [(s["s"] + " ", GREEN if not s["eq"] else INK, not s["eq"])
                    for s in op["b"]]
            rows.append(row)
    return rows


def _righe_riepilogo(job: dict) -> list[str]:
    """Righe del riepilogo "numeri e date cambiati" per i report scaricabili."""
    out = []
    for n in job.get("riepilogo") or []:
        a, b = n.get("a") or "(assente)", n.get("b") or "(assente)"
        out.append(f'Pag. {n["pagina"]} - {n["tipo"]}: {a}  ->  {b}')
    return out


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
    elif p["status"] == "uncertain":
        right = f'pagina {p["page_b"]} - solo differenze incerte'
    elif p["status"] == "visual":
        right = f'pagina {p["page_b"]} - testo uguale, grafica diversa'
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
    for riga in _righe_firme(job):                    # firma digitale dei documenti .p7m
        par = doc.add_paragraph(riga)
        par.paragraph_format.space_after = Pt(0)
        for run in par.runs:
            run.font.size = Pt(9)
    righe_num = _righe_riepilogo(job)
    if righe_num:
        doc.add_heading("Numeri e date cambiati", level=2)
        for riga in righe_num:
            par = doc.add_paragraph(riga)
            par.paragraph_format.space_after = Pt(0)
            for run in par.runs:
                run.font.size = Pt(9)

    leg = doc.add_paragraph()
    for text, color in (("modificato   ", GREEN), ("mancante   ", RED), ("aggiunto   ", BLUE),
                        ("? incerto (probabile errore di lettura)", GREY)):
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


# --------------------------------------------------------------------------
# Elenco differenze Excel (.xlsx)
# --------------------------------------------------------------------------

_TIPO_OP = {"change": "modificata", "del": "solo in A", "add": "solo in B",
            "moved": "spostata"}


def righe_differenze(job: dict) -> list[dict]:
    """Una riga per differenza (anche pagine mancanti), base dell'export Excel.
    Le righe uguali non ci sono; le spostate sì, segnate come tali."""
    numeri = {(n["risultato"], n["idx"]) for n in job.get("riepilogo") or []}
    out = []
    for r, p in enumerate(job.get("results", [])):
        base = {"pag_a": p.get("page_a"), "pag_b": p.get("page_b"), "risultato": r}
        if p["status"] == "missing":
            out.append(dict(base, op=None, tipo=f'pagina solo in {p.get("only_in", "")}',
                            a="", b="", parole_a="", parole_b="", numeri=False))
            continue
        if p["status"] == "visual":
            out.append(dict(base, op=None, tipo="grafica diversa (timbri, firme, disegni)",
                            a="", b="", parole_a="", parole_b="", numeri=False))
        for o, op in enumerate(p.get("ops", [])):
            if op["type"] == "equal":
                continue
            if op["type"] == "change":
                a = " ".join(s["s"] for s in op["a"])
                b = " ".join(s["s"] for s in op["b"])
                pa = " ".join(s["s"] for s in op["a"] if not s["eq"])
                pb = " ".join(s["s"] for s in op["b"] if not s["eq"])
                tipo = "incerta (probabile errore di lettura)" if op.get("incerta") else "modificata"
            else:
                a = op["text"] if op["type"] in ("del", "moved") else ""
                b = op["text"] if op["type"] in ("add", "moved") else ""
                pa = pb = ""
                tipo = _TIPO_OP[op["type"]]
            out.append(dict(base, op=o, tipo=tipo, a=a, b=b, parole_a=pa, parole_b=pb,
                            numeri=(r, o) in numeri))
    return out


def build_report_xlsx(job: dict) -> bytes:
    """Elenco Excel delle differenze: filtri attivi, intestazione bloccata,
    colonna "Numeri/date" per isolare gli importi cambiati."""
    from io import BytesIO

    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill

    revisione = job.get("revisione") or {}
    wb = Workbook()
    ws = wb.active
    ws.title = "Differenze"
    head = ["Pag. A", "Pag. B", "Tipo", "Numeri/date", "Testo A", "Testo B",
            "Parole cambiate A", "Parole cambiate B", "Revisione", "Nota"]
    ws.append(head)
    for cell in ws[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="104070")
    for d in righe_differenze(job):
        rev = revisione.get(f'{d["risultato"]}:{d["op"]}', {}) if d["op"] is not None else {}
        ws.append([d["pag_a"], d["pag_b"], d["tipo"], "sì" if d["numeri"] else "",
                   d["a"], d["b"], d["parole_a"], d["parole_b"],
                   _STATI_REVISIONE.get(rev.get("stato"), ""), rev.get("nota", "")])
    for col, w in zip("ABCDEFGHIJ", (8, 8, 22, 12, 60, 60, 25, 25, 14, 40)):
        ws.column_dimensions[col].width = w
    for row in ws.iter_rows(min_row=2):
        for cell in row[4:8]:
            cell.alignment = Alignment(wrap_text=True, vertical="top")
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions

    info = wb.create_sheet("Confronto")
    # firma digitale dei .p7m: riepilogo per documento e confronto fra le firme (vedi apri_busta)
    firme = [(f"Firma {lato.upper()}", (job.get(f"firma_{lato}") or {}).get("riepilogo", ""))
             for lato in ("a", "b") if job.get(f"firma_{lato}")]
    if job.get("firma_nota"):
        firme.append(("Firme", job["firma_nota"]))
    for k, v in (("Documento A", job.get("name_a", "")), ("Documento B", job.get("name_b", "")),
                 ("Esito", job.get("message", "")), *firme,
                 ("Data", datetime.now().strftime("%d/%m/%Y %H:%M"))):
        info.append([k, v])
        info.cell(info.max_row, 1).font = Font(bold=True)
    info.column_dimensions["A"].width = 14
    info.column_dimensions["B"].width = 100

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def build_report_pdf(job: dict) -> bytes:
    """Report PDF affiancato (PyMuPDF): A4 orizzontale, due colonne per pagina.

    Colonna sinistra = pagina originale di A, colonna destra = stessa pagina di
    B con le differenze: verde = parti modificate, rosso = parti mancanti (in A
    e non in B), blu = parti aggiunte (solo in B).
    """
    import pymupdf as fitz

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
    for lbl, col in (("modificato", GREEN), ("mancante", RED), ("aggiunto", BLUE),
                     ("? incerto", GREY)):
        cover.insert_text((x, M + 94), lbl, fontname="hebo", fontsize=9, color=col)
        x += fitz.get_text_length(lbl + "     ", fontname="hebo", fontsize=9)
    cover.insert_text((M, M + 114),
                      latin("Sinistra: documento A originale. "
                            "Destra: documento B con le differenze."),
                      fontname="helv", fontsize=9, color=GREY)
    y_firme = M + 114
    for riga in _righe_firme(job):                    # firma digitale dei .p7m, sotto la legenda
        y_firme += 13
        cover.insert_text((M, y_firme), latin(riga[:170]), fontname="helv", fontsize=8.5, color=INK)
    righe_num = _righe_riepilogo(job)
    if righe_num:
        y = y_firme + 28
        cover.insert_text((M, y), latin("Numeri e date cambiati"),
                          fontname="hebo", fontsize=11, color=INK)
        massimo = int((H - M - y - 14) // 13)
        for riga in righe_num[:massimo]:
            y += 13
            cover.insert_text((M, y), latin(riga[:150]), fontname="helv",
                              fontsize=8.5, color=INK)
        if len(righe_num) > massimo:
            cover.insert_text((M, y + 13), latin(f"... e altre {len(righe_num) - massimo}"
                                                 " (vedi le pagine)"),
                              fontname="helv", fontsize=8.5, color=GREY)

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


@app.get("/healthz")
def healthz():
    """Controllo di salute (Docker HEALTHCHECK, piattaforme cloud): niente dati."""
    return jsonify({"ok": True, "tesseract": find_tesseract() is not None})


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
    """Salva il file caricato nella cartella temporanea; None se il formato non è ammesso.
    Una busta firmata (.p7m) è ammessa se dentro c'è un formato ammesso o se il nome non lo dice
    ("documento.p7m"): la apre e la controlla apri_busta nel worker."""
    ext = Path(f.filename or "").suffix.lower()
    if ext == EXT_FIRMATA:
        interna = Path(_senza_p7m(f.filename)).suffix.lower()
        if interna and interna not in ALLOWED_EXTS:
            return None
    elif ext not in ALLOWED_EXTS:
        return None
    path = tmp_dir / f"cmp_{job_id}_{side}{ext}"
    f.save(path)
    return path


@app.post("/api/compare")
def compare():
    username, _ = _identita()
    if _coda_piena(username):
        return jsonify({"error": f"Hai già {CODA_MAX_PER_UTENTE} confronti in coda: aspetta che finiscano."}), 429
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
    ripetute = request.form.get("ripetute", "1") not in ("0", "false", "off")

    tmp_dir = Path(tempfile.gettempdir())
    job_id = uuid.uuid4().hex[:12]
    path1 = _save_upload(f1, tmp_dir, job_id, "a")
    path2 = _save_upload(f2, tmp_dir, job_id, "b")
    if path1 is None or path2 is None:
        for p in (path1, path2):
            if p:
                p.unlink(missing_ok=True)
        return jsonify({"error": "Formato non supportato. Ammessi: PDF (anche firmati .p7m), "
                                 "immagini, Word (.docx), testo."}), 400

    with JOBS_LOCK:
        JOBS[job_id] = {
            "id": job_id, "creato": datetime.now().isoformat(timespec="seconds"),
            "status": "queued", "message": "In coda...", "cancel": False,
            "proprietario": username,   # chi può annullarlo, eliminarlo, annotarlo (oltre agli admin)
            "name_a": f1.filename, "name_b": f2.filename,
            "total_pages": 0, "current_page": 0, "results": [],
        }
    prune_old_jobs()

    threading.Thread(
        target=run_compare_in_coda,
        args=(job_id, path1, path2, f1.filename, f2.filename,
              model, dpi, lang, tolerant, preprocess, ignore_raw, ripetute),
        daemon=True,
    ).start()
    return jsonify({"job_id": job_id})


@app.post("/api/jobs/<job_id>/cancel")
def cancel_job(job_id: str):
    with JOBS_LOCK:
        if job_id not in JOBS:
            return jsonify({"error": "Job non trovato."}), 404
        if not _puo_gestire(JOBS[job_id]):
            return jsonify({"error": "Puoi annullare solo i confronti che hai avviato tu."}), 403
        JOBS[job_id]["cancel"] = True
    return jsonify({"ok": True})


def _done_snapshot(job_id: str) -> dict | None:
    job = get_job(job_id)
    return job if job and job.get("status") == "done" else None


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


@app.get("/api/jobs/<job_id>/report.xlsx")
def job_report_xlsx(job_id: str):
    snap = _done_snapshot(job_id)
    if snap is None:
        return jsonify({"error": "Report non disponibile."}), 404
    try:
        data = build_report_xlsx(snap)
    except ImportError:
        return jsonify({"error": "Modulo 'openpyxl' mancante. Esegui: pip install openpyxl"}), 500
    return Response(data,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="differenze_confronto.xlsx"'})


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
        mem = PREVIEWS.get(job_id)
        img = mem.get(key) if mem else None
        if mem and img is None and key.endswith("p"):   # fallback all'originale
            img = mem.get(f"{page}{side}")
    if mem is None:                                       # job uscito dalla RAM
        img = (storico.anteprima(job_id, key)
               or (storico.anteprima(job_id, f"{page}{side}") if key.endswith("p") else None))
    if img is None:
        return jsonify({"error": "Anteprima non disponibile."}), 404
    return Response(img, mimetype="image/jpeg")


@app.get("/api/jobs/<job_id>")
def job_status(job_id: str):
    job = get_job(job_id)
    if job is None:
        return jsonify({"error": "Confronto non trovato (forse eliminato o scaduto)."}), 404
    return jsonify(job)


@app.delete("/api/jobs/<job_id>")
def job_delete(job_id: str):
    """Elimina un confronto dallo storico (e dalla RAM se finito): solo chi l'ha avviato o un admin."""
    if not _puo_gestire(get_job(job_id)):
        return jsonify({"error": "Puoi eliminare solo i confronti che hai avviato tu."}), 403
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if job and job.get("status") not in ("done", "error", "cancelled"):
            return jsonify({"error": "Confronto in corso: annullalo prima."}), 409
        JOBS.pop(job_id, None)
        PREVIEWS.pop(job_id, None)
    storico.elimina(job_id)
    return jsonify({"ok": True})


@app.get("/api/storico")
def storico_lista():
    """Riassunti dei confronti di cui il browser conosce l'id (?ids=a,b,c)."""
    ids = [i for i in request.args.get("ids", "").split(",") if i]
    return jsonify({"confronti": storico.riassunti(ids)})


@app.put("/api/jobs/<job_id>/revisione")
def job_revisione(job_id: str):
    """Stato di revisione di una differenza: {"chiave": "r:o", "stato":
    "vista"|"ok"|"dubbio"|"", "nota": "..."}. Stato vuoto e nota vuota =
    tolta. Salvato nel job (RAM e storico), finisce nell'export Excel."""
    dati = request.get_json(silent=True) or {}
    chiave = str(dati.get("chiave", ""))
    stato = str(dati.get("stato") or "")
    nota = str(dati.get("nota") or "")[:1000]
    if not re.fullmatch(r"\d{1,5}:\d{1,6}", chiave) or (stato and stato not in _STATI_REVISIONE):
        return jsonify({"error": "Dati di revisione non validi."}), 400
    job = get_job(job_id)
    if job is None or job.get("status") != "done":
        return jsonify({"error": "Confronto non trovato."}), 404
    if not _puo_gestire(job):
        return jsonify({"error": "Puoi annotare solo i confronti che hai avviato tu."}), 403
    rev = dict(job.get("revisione") or {})
    if stato or nota:
        rev[chiave] = {"stato": stato, "nota": nota}
    else:
        rev.pop(chiave, None)
    with JOBS_LOCK:
        if job_id in JOBS:
            JOBS[job_id]["revisione"] = rev
    storico.aggiorna(job_id, revisione=rev)
    return jsonify({"ok": True, "revisione": rev})


if __name__ == "__main__":
    # Ascolto locale di default; in LAN il portale passa il proprio HOST alle app
    # che avvia, così i PC della rete raggiungono l'app invece di trovarsi un
    # link morto. L'accesso resta protetto dal gate SSO.
    HOST = os.environ.get("HOST", "127.0.0.1")
    _controlla_esposizione(HOST, SSO_SPENTO, _PASSWORD)
    PORT = int(os.environ.get("PORT", "5001"))
    indirizzo = f"http://{'localhost' if HOST == '0.0.0.0' else HOST}:{PORT}"
    print(f"Confronta documenti — {indirizzo}" + (" (e in LAN)" if HOST == "0.0.0.0" else ""))
    if HOST == "0.0.0.0":
        # indirizzi da dare ai colleghi (server in rete, installa-server-rete.ps1)
        import socket
        try:
            ips = sorted({a for a in socket.gethostbyname_ex(socket.gethostname())[2]
                          if not a.startswith(("127.", "169.254."))})
        except OSError:
            ips = []
        for a in [socket.gethostname()] + ips:
            print(f"  in rete: http://{a}:{PORT}")
        login = ("password (CONFRONTO_PASSWORD)" if _PASSWORD else
                 "nessuno (rete interna)" if SSO_SPENTO else "portale Suite Cosedil")
        print(f"  login: {login}"
              f" · confronti in parallelo: {MAX_PARALLELI} · dati: {storico.DATI}", flush=True)
    prune_cache(max_age_days=30)
    storico.pulisci()
    if getattr(sys, "frozen", False):
        # exe standalone: apri il browser da solo dopo l'avvio
        import webbrowser
        threading.Timer(1.5, lambda: webbrowser.open(indirizzo)).start()
    try:
        from waitress import serve
        serve(app, host=HOST, port=PORT, threads=8)
    except ImportError:
        app.run(host=HOST, port=PORT, debug=False)
