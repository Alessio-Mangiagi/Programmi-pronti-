# "><(((º> sabusabu <º)))><"
"""OCR delle pagine senza testo dei PDF scansionati, per la ricerca nel contenuto e "Citato in" (ADR-33).

La pagina si rende in immagine con PDFium (pypdfium2) e si legge con Tesseract (italiano + inglese) in un processo
separato, con un tempo massimo per pagina: un PDF ostile non blocca il worker. Solo le pagine che non hanno già
testo, fino a un tetto di pagine per file. Senza Tesseract installato l'OCR si salta (il resto funziona).
"""
from __future__ import annotations

import io
import logging
import os
import shutil
import subprocess  # noqa: S404 - Tesseract si chiama senza shell, con argomenti fissi
from dataclasses import dataclass
from functools import lru_cache

log = logging.getLogger("cde.ocr")

MIN_TEXT = 20            # sotto questi caratteri la pagina si considera scansionata
WINDOWS_DEFAULT = r"C:\Program Files\Tesseract-OCR\tesseract.exe"


@dataclass(frozen=True)
class OcrConfig:
    command: str
    languages: str = "ita+eng"
    max_pages: int = 30
    dpi: int = 200
    timeout_s: int = 60


@lru_cache
def find_tesseract(configured: str | None = None) -> str | None:
    for candidate in (configured, shutil.which("tesseract"), WINDOWS_DEFAULT if os.name == "nt" else None):
        if candidate and (os.path.isfile(candidate) or shutil.which(candidate)):
            return candidate
    log.warning("Tesseract non trovato: i PDF scansionati restano senza testo per la ricerca")
    return None


def config_from(settings) -> OcrConfig | None:
    if not settings.ocr_enabled:
        return None
    command = find_tesseract(settings.tesseract_cmd)
    return OcrConfig(command, settings.ocr_languages, settings.ocr_max_pages) if command else None


def needs_ocr(text: str) -> bool:
    return len(text.strip()) < MIN_TEXT


def read_pages(data: bytes, pages: list[int], config: OcrConfig) -> dict[int, str]:
    """Testo letto da Tesseract per le pagine indicate (indici da 0), al massimo ``config.max_pages``."""
    import pypdfium2 as pdfium

    out: dict[int, str] = {}
    pdf = pdfium.PdfDocument(data)
    try:
        for index in pages[:config.max_pages]:
            page = pdf[index]
            try:
                image = page.render(scale=config.dpi / 72, grayscale=True).to_pil()
            finally:
                page.close()
            png = io.BytesIO()
            image.save(png, format="PNG")
            try:
                done = subprocess.run(  # noqa: S603 - eseguibile e argomenti fissi, niente shell
                    [config.command, "stdin", "stdout", "-l", config.languages, "--psm", "3"],
                    input=png.getvalue(), capture_output=True, timeout=config.timeout_s, check=False)
            except subprocess.TimeoutExpired:
                log.warning("OCR della pagina %s oltre %ss: saltata", index + 1, config.timeout_s)
                continue
            if done.returncode == 0:
                out[index] = done.stdout.decode("utf-8", errors="replace")
            else:
                log.warning("OCR della pagina %s non riuscito: %s", index + 1, done.stderr[:200])
    finally:
        pdf.close()
    return out
