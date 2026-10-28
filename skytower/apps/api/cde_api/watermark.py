# "><(((º> sabusabu <º)))><"
"""Filigrana sui PDF scaricati: su ogni pagina una scritta diagonale semitrasparente e una riga a piè di
pagina con chi ha scaricato, quando e quale revisione. La sovrapposizione si disegna con fpdf2 alla misura
di ciascuna pagina e si fonde con pypdf; il contenuto originale non cambia (testo, vettori, firme visive).
"""
from __future__ import annotations

import io
import math

from fpdf import FPDF
from pypdf import PdfReader, PdfWriter, Transformation
from pypdf.errors import PdfReadError


class WatermarkError(ValueError):
    """PDF che non si può filigranare (protetto da password o danneggiato)."""


def latin1(value: str) -> str:
    """I font standard del PDF coprono Latin-1: il resto si sostituisce senza rompere la pagina."""
    s = value.replace("—", "-").replace("–", "-").replace("’", "'").replace("…", "...")
    return s.encode("latin-1", "replace").decode("latin-1")


def _overlay(width: float, height: float, diagonal: str, footer: list[str]) -> bytes:
    pdf = FPDF(unit="pt", format=(width, height))
    pdf.set_auto_page_break(False)
    pdf.set_margins(0, 0, 0)
    pdf.add_page()
    angle = math.degrees(math.atan2(height, width))
    pdf.set_font("Helvetica", "B", 10)
    # la scritta occupa il 75% della diagonale, senza uscire dalla pagina neanche con nomi lunghi
    size = max(8.0, min(60.0, 7.5 * math.hypot(width, height) / max(pdf.get_string_width(diagonal), 1)))
    pdf.set_font("Helvetica", "B", size)
    pdf.set_text_color(200, 30, 30)
    with pdf.local_context(fill_opacity=0.18, stroke_opacity=0.18):
        with pdf.rotation(angle, x=width / 2, y=height / 2):
            w = pdf.get_string_width(diagonal)
            pdf.text(width / 2 - w / 2, height / 2 + size / 3, diagonal)
    pdf.set_font("Helvetica", "", 7)
    pdf.set_text_color(160, 20, 20)
    with pdf.local_context(fill_opacity=0.85):
        for i, line in enumerate(reversed(footer)):
            pdf.text(12, height - 8 - i * 9, line)
    return bytes(pdf.output())


def stamp(data: bytes, diagonal: str, footer: list[str]) -> bytes:
    """Restituisce il PDF con la filigrana su ogni pagina. WatermarkError se il file non si apre."""
    try:
        reader = PdfReader(io.BytesIO(data))
        locked = reader.is_encrypted and not reader.decrypt("")
        writer = None if locked else PdfWriter(clone_from=reader)
    except (PdfReadError, ValueError, KeyError):
        raise WatermarkError("PDF non leggibile: la filigrana non si può applicare") from None
    if writer is None:
        raise WatermarkError("PDF protetto da password: la filigrana non si può applicare")
    diagonal, footer = latin1(diagonal), [latin1(f) for f in footer]
    cache: dict[tuple[float, float], object] = {}
    for page in writer.pages:
        page.transfer_rotation_to_content()        # pagine ruotate: la filigrana segue il verso di lettura
        box = page.mediabox
        key = (round(float(box.width), 1), round(float(box.height), 1))
        if key not in cache:
            cache[key] = PdfReader(io.BytesIO(_overlay(*key, diagonal, footer))).pages[0]
        over = cache[key]
        if box.left or box.bottom:                 # mediabox con origine non nulla: si sposta la sovrapposizione
            page.merge_transformed_page(over, Transformation().translate(float(box.left), float(box.bottom)))
        else:
            page.merge_page(over)
    writer.add_metadata({"/CDEWatermark": footer[0] if footer else diagonal})
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()
