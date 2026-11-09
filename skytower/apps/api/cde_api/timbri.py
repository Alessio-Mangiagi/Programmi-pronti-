# "><(((º> sabusabu <º)))><"
"""Timbri sui PDF (ADR-56): preparazione dell'immagine del timbro e PDF timbrato.

Due funzioni pure, senza database né S3, usate da ``modules/stamps.py`` e provate da sole nei test:

* ``prepara_immagine``: dal PNG/JPG caricato al PNG del timbro. Rimpicciolisce le immagini enormi e, se richiesto,
  rende trasparente lo sfondo con lo stesso algoritmo di Timbri per VFP (``timbri-vfp/script.js``): colore di
  sfondo = mediana dei pixel opachi del bordo, poi "color to alpha" (l'opacità di ogni pixel è quanto si discosta
  dallo sfondo, il colore si ricostruisce senza lo sfondo) con una tolleranza che toglie ombre e grana della carta.
  Il visualizzatore fa la stessa cosa nel browser per l'anteprima (``web/src/components/timbri/scontorno.ts``);
  quello che conta è il risultato di qui, salvato su S3.
* ``timbra_pdf``: mette le immagini sulle pagine indicate. Le posizioni arrivano dal visualizzatore in frazioni
  della pagina **come la si vede** (origine in alto a sinistra, 0..1, come le annotazioni): pdf.js mostra la
  CropBox ruotata secondo /Rotate, quindi qui si trasferisce la rotazione nel contenuto (come la filigrana) e si
  disegna una sovrapposizione grande quanto la CropBox, fusa con pypdf. Il contenuto originale non cambia.
  Sotto ogni timbro, a richiesta, la didascalia "Timbrato da Nome Cognome il gg/mm/aaaa hh:mm".
"""
from __future__ import annotations

import io
from dataclasses import dataclass

import numpy as np
from fpdf import FPDF
from PIL import Image, UnidentifiedImageError
from pypdf import PdfReader, PdfWriter, Transformation
from pypdf.errors import PdfReadError

from .watermark import latin1

LATO_MASSIMO = 2000            # pixel: oltre, il timbro si rimpicciolisce (un timbro è largo pochi centimetri)
PIXEL_MASSIMI = 40_000_000     # immagini più grandi non si aprono nemmeno (bomba di decompressione)
TOLLERANZA_MASSIMA = 0.6       # come il cursore di Timbri per VFP (0..60%)
DIDASCALIA_PT = 7.0            # corpo della didascalia sotto il timbro


class TimbroErrore(ValueError):
    """Immagine o PDF che non si possono usare: il messaggio va all'utente così com'è."""


# ---------------------------------------------------------------------
# Immagine del timbro
# ---------------------------------------------------------------------
def _sfondo(px: np.ndarray) -> np.ndarray | None:
    """Colore di sfondo = mediana per canale dei pixel opachi del bordo; None se il bordo è già in gran parte
    trasparente (PNG già scontornato: non si tocca)."""
    h, w = px.shape[:2]
    bordo = np.concatenate([px[0, :], px[h - 1, :], px[1:h - 1, 0], px[1:h - 1, w - 1]]) if h > 1 and w > 1 \
        else px.reshape(-1, 4)
    opachi = bordo[bordo[:, 3] >= 250]
    if len(opachi) < len(bordo) / 2:
        return None
    # mediana "alta" come nel browser (elemento in posizione floor(n/2) dei valori ordinati)
    ordinati = np.sort(opachi[:, :3].astype(np.int32), axis=0)
    return ordinati[len(ordinati) // 2]


def scontorna(px: np.ndarray, tolleranza: float) -> np.ndarray:
    """Sfondo trasparente con "color to alpha" (stesso calcolo di makeBackgroundTransparent di Timbri per VFP).
    ``px`` è un array RGBA uint8 (altezza × larghezza × 4); restituisce un array nuovo."""
    sfondo = _sfondo(px)
    if sfondo is None:
        return px.copy()
    t = min(max(float(tolleranza), 0.0), TOLLERANZA_MASSIMA)
    chiaro = sfondo[0] * 0.299 + sfondo[1] * 0.587 + sfondo[2] * 0.114 >= 128
    rgb = px[..., :3].astype(np.float64)
    bg = sfondo.astype(np.float64)
    diff = (bg - rgb) if chiaro else (rgb - bg)
    rango = bg if chiaro else (255.0 - bg)
    with np.errstate(divide="ignore", invalid="ignore"):
        quota = np.where((diff > 0) & (rango > 0), diff / np.where(rango > 0, rango, 1), 0.0)
    alfa = quota.max(axis=2)                              # quanto il pixel si discosta dallo sfondo, 0..1
    out = px.copy()
    trasparente = alfa <= t
    pieno = ~trasparente
    a = np.where(pieno, alfa, 1.0)[..., None]
    ricostruito = np.clip(np.rint(bg + (rgb - bg) / a), 0, 255)
    out[..., :3] = np.where(pieno[..., None], ricostruito, rgb).astype(np.uint8)
    nuova_alfa = np.rint(px[..., 3].astype(np.float64) * (alfa - t) / (1 - t))
    out[..., 3] = np.where(trasparente, 0, np.clip(nuova_alfa, 0, 255)).astype(np.uint8)
    return out


def prepara_immagine(dati: bytes, *, scontorna_sfondo: bool, tolleranza: float) -> tuple[bytes, int, int]:
    """PNG del timbro (con trasparenza) da un PNG o JPG caricato: (byte, larghezza, altezza) in pixel."""
    try:
        with Image.open(io.BytesIO(dati)) as img:
            if img.format not in ("PNG", "JPEG"):
                raise TimbroErrore("Il timbro deve essere un'immagine PNG o JPG")
            if img.width * img.height > PIXEL_MASSIMI:
                raise TimbroErrore("Immagine troppo grande: ridurla sotto i 40 milioni di pixel")
            img.load()
            rgba = img.convert("RGBA")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise TimbroErrore("Immagine non leggibile: caricare un'immagine PNG o JPG") from None
    if max(rgba.size) > LATO_MASSIMO:
        rgba.thumbnail((LATO_MASSIMO, LATO_MASSIMO), Image.Resampling.LANCZOS)
    if scontorna_sfondo:
        rgba = Image.fromarray(scontorna(np.asarray(rgba), tolleranza), "RGBA")
    # un timbro tutto trasparente (tolleranza troppo alta, immagine bianca) non si vedrebbe sul PDF
    if not np.asarray(rgba)[..., 3].any():
        raise TimbroErrore("Dopo lo scontorno l'immagine è vuota: abbassare la tolleranza")
    out = io.BytesIO()
    rgba.save(out, "PNG", optimize=True)
    return out.getvalue(), rgba.width, rgba.height


# ---------------------------------------------------------------------
# PDF timbrato
# ---------------------------------------------------------------------
@dataclass(frozen=True)
class Posizione:
    """Un timbro su una pagina, in frazioni della pagina come la si vede (origine in alto a sinistra)."""
    timbro: str          # chiave in ``immagini`` (id del timbro)
    pagina: int          # da 1
    x: float
    y: float
    larghezza: float
    altezza: float
    didascalia: bool = False


def _apri(dati: bytes) -> PdfReader:
    try:
        reader = PdfReader(io.BytesIO(dati))
        bloccato = reader.is_encrypted and not reader.decrypt("")
        if not bloccato:
            _ = len(reader.pages)
    except (PdfReadError, ValueError, KeyError):
        raise TimbroErrore("PDF non leggibile: il timbro non si può applicare") from None
    # fuori dal try: TimbroErrore è un ValueError e verrebbe riscritto come "non leggibile"
    if bloccato:
        raise TimbroErrore("PDF protetto da password: il timbro non si può applicare")
    return reader


def ha_firma_pdf(dati: bytes) -> bool:
    """True se il PDF contiene una firma digitale PAdES (campo /Sig compilato): timbrandolo, la nuova revisione
    non avrebbe più una firma valida (la revisione di partenza la conserva)."""
    reader = _apri(dati)
    try:
        campi = reader.get_fields() or {}
    except (PdfReadError, ValueError, KeyError, AttributeError):
        return False
    return any(c.get("/FT") == "/Sig" and c.get("/V") is not None for c in campi.values())


def _sovrapposizione(larghezza: float, altezza: float, timbri: list[Posizione], immagini: dict[str, bytes],
                     didascalia: str | None) -> bytes:
    """Una pagina PDF trasparente grande quanto la CropBox con i timbri disegnati (fpdf2: origine in alto)."""
    pdf = FPDF(unit="pt", format=(larghezza, altezza))
    pdf.set_auto_page_break(False)
    pdf.set_margins(0, 0, 0)
    pdf.add_page()
    for t in timbri:
        x, y = t.x * larghezza, t.y * altezza
        w, h = t.larghezza * larghezza, t.altezza * altezza
        # dentro il riquadro scelto, senza deformare l'immagine (il visualizzatore tiene già le proporzioni)
        pdf.image(io.BytesIO(immagini[t.timbro]), x=x, y=y, w=w, h=h, keep_aspect_ratio=True)
        if t.didascalia and didascalia:
            testo = latin1(didascalia)
            pdf.set_font("Helvetica", "", DIDASCALIA_PT)
            pdf.set_text_color(40, 40, 90)
            tw = pdf.get_string_width(testo)
            tx = min(max(x + w / 2 - tw / 2, 2), max(larghezza - tw - 2, 2))
            # sotto il timbro; se non c'è spazio, sopra
            ty = y + h + DIDASCALIA_PT + 1 if y + h + DIDASCALIA_PT + 3 <= altezza else max(y - 3, DIDASCALIA_PT)
            pdf.text(tx, ty, testo)
    return bytes(pdf.output())


def timbra_pdf(dati: bytes, posizioni: list[Posizione], immagini: dict[str, bytes], *,
               didascalia: str | None = None) -> bytes:
    """Il PDF con i timbri. ``immagini``: id del timbro → PNG; ``didascalia``: testo sotto i timbri che la chiedono.
    TimbroErrore se il PDF non si apre o una pagina non esiste."""
    reader = _apri(dati)
    writer = PdfWriter(clone_from=reader)
    per_pagina: dict[int, list[Posizione]] = {}
    for p in posizioni:
        if not 1 <= p.pagina <= len(writer.pages):
            raise TimbroErrore(f"Pagina {p.pagina} inesistente: il PDF ha {len(writer.pages)} pagine")
        per_pagina.setdefault(p.pagina, []).append(p)
    for numero, timbri in sorted(per_pagina.items()):
        page = writer.pages[numero - 1]
        if page.rotation % 360:
            page.transfer_rotation_to_content()   # la pagina come la si vede: i timbri seguono il verso di lettura
        # pdf.js mostra l'intersezione di CropBox e MediaBox: lì valgono le frazioni del visualizzatore
        media, crop = page.mediabox, page.cropbox
        left, bottom = max(float(media.left), float(crop.left)), max(float(media.bottom), float(crop.bottom))
        right, top = min(float(media.right), float(crop.right)), min(float(media.top), float(crop.top))
        larghezza, altezza = right - left, top - bottom
        if larghezza <= 0 or altezza <= 0:
            raise TimbroErrore(f"Pagina {numero} senza area visibile: il timbro non si può applicare")
        sopra = PdfReader(io.BytesIO(_sovrapposizione(larghezza, altezza, timbri, immagini, didascalia))).pages[0]
        if left or bottom:
            page.merge_transformed_page(sopra, Transformation().translate(left, bottom))
        else:
            page.merge_page(sopra)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()
