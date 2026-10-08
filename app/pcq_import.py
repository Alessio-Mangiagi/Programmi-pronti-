"""
Lettura di un PCQ (Piano di Controllo Qualità) da Word (.docx) o PDF per l'anteprima
prima di ricrearlo nel cantiere.

Per ora estrae solo la struttura grezza, nell'ordine del documento:
- .docx: titoli (stili Titolo/Heading) e tabelle, cella per cella. Si legge
  `word/document.xml` direttamente (zip + XML), senza dipendenze extra.
- .pdf: il testo pagina per pagina (pypdfium2). Le tabelle di un PDF non hanno
  struttura: si ricostruiranno quando la mappatura PCQ → WBS/moduli sarà fissata su
  un documento reale. Un PDF senza testo è una scansione e richiede OCR.

La mappatura vera (fasi → voci WBS, controlli → campi dei moduli) si appoggerà su
questo output.
"""
import io
import re
import zipfile
from dataclasses import dataclass, field
from typing import Optional
from xml.etree import ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
HEADING_STYLE = re.compile(r"^(heading|titolo|title)\s*(\d*)$", re.IGNORECASE)
MAX_TABLES = 200
MAX_ROWS_PER_TABLE = 2000
MAX_PDF_LINES = 5000


@dataclass
class PcqTable:
    index: int
    title: Optional[str]          # ultimo titolo/paragrafo prima della tabella
    rows: list[list[str]]         # prima riga = intestazione (se il documento la ha)


@dataclass
class PcqDocument:
    kind: str                                         # docx | pdf
    headings: list[str] = field(default_factory=list)
    tables: list[PcqTable] = field(default_factory=list)
    lines: list[str] = field(default_factory=list)    # solo PDF: righe di testo
    pages: Optional[int] = None
    warnings: list[str] = field(default_factory=list)


def _text(el) -> str:
    """Testo di un paragrafo/cella: unisce i run, tab e a capo diventano spazi."""
    parts = []
    for node in el.iter():
        if node.tag == W + "t" and node.text:
            parts.append(node.text)
        elif node.tag in (W + "tab", W + "br", W + "cr"):
            parts.append(" ")
        elif node.tag == W + "p" and parts and node is not el:
            parts.append("\n")
    return re.sub(r"[ \t]+", " ", "".join(parts)).strip()


def _heading_level(p, styles: dict[str, str]) -> Optional[int]:
    ppr = p.find(W + "pPr")
    style = ppr.find(W + "pStyle") if ppr is not None else None
    if style is None:
        return None
    sid = style.get(W + "val", "")
    m = HEADING_STYLE.match(styles.get(sid, sid).replace("-", " ").strip())
    if not m:
        return None
    return int(m.group(2) or 1)


def _style_names(z: zipfile.ZipFile) -> dict[str, str]:
    """id stile → nome (gli id sono localizzati: 'Titolo1' in italiano, 'Heading1' in inglese)."""
    try:
        root = ET.fromstring(z.read("word/styles.xml"))
    except KeyError:
        return {}
    out = {}
    for s in root.iter(W + "style"):
        name = s.find(W + "name")
        if name is not None:
            out[s.get(W + "styleId", "")] = name.get(W + "val", "")
    return out


def _table_rows(tbl) -> list[list[str]]:
    rows = []
    for tr in tbl.findall(W + "tr"):
        row = []
        for tc in tr.findall(W + "tc"):
            tcpr = tc.find(W + "tcPr")
            span = 1
            merged_below = False
            if tcpr is not None:
                gs = tcpr.find(W + "gridSpan")
                if gs is not None:
                    span = int(gs.get(W + "val", "1") or 1)
                vm = tcpr.find(W + "vMerge")
                merged_below = vm is not None and vm.get(W + "val") != "restart"
            # celle unite in verticale: vuote, la riga sopra porta il testo
            row.append("" if merged_below else _text(tc))
            row.extend([""] * (span - 1))
        if any(c for c in row):
            rows.append(row)
        if len(rows) >= MAX_ROWS_PER_TABLE:
            break
    return rows


def parse_docx(data: bytes) -> PcqDocument:
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
        root = ET.fromstring(z.read("word/document.xml"))
    except (zipfile.BadZipFile, KeyError, ET.ParseError):
        raise ValueError("cannot read docx")
    styles = _style_names(z)
    doc = PcqDocument(kind="docx")
    body = root.find(W + "body")
    last_text: Optional[str] = None
    for el in list(body) if body is not None else []:
        if el.tag == W + "p":
            txt = _text(el)
            if not txt:
                continue
            level = _heading_level(el, styles)
            if level is not None:
                doc.headings.append(("  " * (level - 1)) + txt)
            last_text = txt
        elif el.tag == W + "tbl":
            if len(doc.tables) >= MAX_TABLES:
                doc.warnings.append(f"più di {MAX_TABLES} tabelle: le successive sono ignorate")
                break
            rows = _table_rows(el)
            if rows:
                doc.tables.append(PcqTable(index=len(doc.tables) + 1, title=last_text, rows=rows))
    if not doc.tables:
        doc.warnings.append("nessuna tabella trovata nel documento")
    return doc


def parse_pdf(data: bytes) -> PcqDocument:
    import pypdfium2 as pdfium
    try:
        pdf = pdfium.PdfDocument(data)
    except Exception:
        raise ValueError("cannot read pdf")
    doc = PcqDocument(kind="pdf", pages=len(pdf))
    try:
        for page in pdf:
            tp = page.get_textpage()
            for line in tp.get_text_range().splitlines():
                line = line.strip()
                if line:
                    doc.lines.append(line)
            tp.close()
            page.close()
            if len(doc.lines) >= MAX_PDF_LINES:
                doc.warnings.append(f"testo troncato a {MAX_PDF_LINES} righe")
                break
    finally:
        pdf.close()
    if not doc.lines:
        doc.warnings.append("PDF senza testo (scansione): serve l'OCR, non ancora supportato")
    else:
        doc.warnings.append("dal PDF si legge solo il testo: le tabelle si ricostruiscono meglio dal .docx")
    return doc


def parse(data: bytes, filename: str) -> PcqDocument:
    if not data:
        raise ValueError("empty file")
    name = filename.lower()
    if name.endswith(".doc"):
        raise ValueError("doc not supported: save as docx")
    if name.endswith(".pdf") or data[:5] == b"%PDF-":
        return parse_pdf(data)
    if name.endswith(".docx") or data[:2] == b"PK":
        return parse_docx(data)
    raise ValueError("only docx or pdf allowed")
