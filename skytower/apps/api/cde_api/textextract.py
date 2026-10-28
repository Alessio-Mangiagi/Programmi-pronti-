# "><(((º> sabusabu <º)))><"
"""Estrazione del testo dai file caricati, per la ricerca nel contenuto (migrazione 0024).

PDF con pypdf, Word ed Excel leggendo l'XML dell'archivio OOXML (defusedxml: niente entità esterne né bombe XML),
testo semplice decodificato. Tetti su dimensione del file, pagine, voci dello ZIP e caratteri: un file ostile non
deve bloccare il worker. Formati non gestiti o illeggibili → stringa vuota (indicizzata come "niente testo").
"""
from __future__ import annotations

import io
import logging
import re
import zipfile

from defusedxml import ElementTree
from pypdf import PdfReader

log = logging.getLogger("cde.textextract")

MAX_FILE = 100 * 1024 ** 2
MAX_CHARS = 300_000
MAX_PAGES = 500
MAX_XML = 20 * 1024 ** 2          # XML decompresso letto da un'unica voce OOXML
TEXT_EXT = (".txt", ".csv", ".log", ".md", ".ifc")
_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
_S = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def _clip(text: str) -> str:
    text = re.sub(r"[\x00-\x08\x0b\x0e-\x1f]", " ", text)        # NUL e controlli: PostgreSQL non li accetta
    return re.sub(r"[ \t\r\f\v]+", " ", text).strip()[:MAX_CHARS]


def _pdf(data: bytes) -> str:
    reader = PdfReader(io.BytesIO(data))
    if reader.is_encrypted and not reader.decrypt(""):
        return ""
    out, size = [], 0
    for page in reader.pages[:MAX_PAGES]:
        text = page.extract_text() or ""
        out.append(text)
        size += len(text)
        if size > MAX_CHARS:
            break
    return "\n".join(out)


def _xml(zf: zipfile.ZipFile, name: str):
    info = zf.getinfo(name)
    if info.file_size > MAX_XML:
        raise ValueError(f"{name} troppo grande una volta decompresso")
    return ElementTree.fromstring(zf.read(name))


def _docx(data: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        root = _xml(zf, "word/document.xml")
    return "\n".join("".join(t.text or "" for t in p.iter(f"{_W}t")) for p in root.iter(f"{_W}p"))


def _xlsx(data: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        if "xl/sharedStrings.xml" not in zf.namelist():
            return ""
        root = _xml(zf, "xl/sharedStrings.xml")
    return "\n".join("".join(t.text or "" for t in si.iter(f"{_S}t")) for si in root.iter(f"{_S}si"))


def extract(filename: str, data: bytes) -> str:
    name = filename.lower()
    if len(data) > MAX_FILE:
        return ""
    try:
        if name.endswith(".pdf"):
            return _clip(_pdf(data))
        if name.endswith(".docx"):
            return _clip(_docx(data))
        if name.endswith(".xlsx"):
            return _clip(_xlsx(data))
        if name.endswith(TEXT_EXT):
            return _clip(data[: MAX_CHARS * 4].decode("utf-8", errors="replace"))
    except Exception as exc:              # noqa: BLE001 - file ostile o danneggiato: niente testo, il worker prosegue
        log.warning("testo non estratto da %s: %s", filename, str(exc)[:200])
    return ""


def wants(filename: str) -> bool:
    return filename.lower().endswith((".pdf", ".docx", ".xlsx", *TEXT_EXT))
