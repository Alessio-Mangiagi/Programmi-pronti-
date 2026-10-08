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


# ---------- esempio scaricabile ----------

EXAMPLE_TITLE = "PCQ - Nuova scuola primaria via Roma"
EXAMPLE_PHASES = [
    ("01 Opere strutturali", "Controlli sulle strutture in c.a.", [
        ("Fase", "Controllo", "Frequenza", "Criterio di accettazione", "Responsabile", "Documento di registrazione"),
        ("Scavi", "Quota del fondo scavo", "Ogni plinto", "± 5 cm rispetto al progetto", "Direttore lavori", "Verbale di scavo"),
        ("Armature", "Diametri e passo delle barre", "Prima di ogni getto", "Conformi agli esecutivi strutturali", "Capocantiere", "Check list armature"),
        ("Armature", "Copriferro", "Prima di ogni getto", "≥ 3 cm, distanziatori ogni 1 m", "Capocantiere", "Check list armature"),
        ("Getti", "Classe del calcestruzzo sul DDT", "Ogni autobetoniera", "C25/30 XC2 come da capitolato", "Capocantiere", "DDT firmato"),
        ("Getti", "Prelievo cubetti", "Ogni 100 m³ o ogni giorno di getto", "Rck ≥ 30 MPa a 28 giorni", "Laboratorio", "Certificato di prova"),
    ]),
    ("02 Impianti", "Controlli sugli impianti", [
        ("Fase", "Controllo", "Frequenza", "Criterio di accettazione", "Responsabile"),
        ("Impianto elettrico", "Prova di continuità dei conduttori di protezione", "Ogni linea", "Resistenza ≤ 0,5 Ω", "Impresa elettrica"),
        ("Impianto idrico", "Prova di tenuta a pressione", "Ogni colonna montante", "Nessuna perdita a 1,5 × pressione di esercizio per 2 h", "Impresa idraulica"),
    ]),
]

_CT = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
       '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
       '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
       '<Default Extension="xml" ContentType="application/xml"/>'
       '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
       '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
       '</Types>')
_RELS = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
         '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
         '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
         '</Relationships>')
_DOC_RELS = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
             '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
             '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
             '</Relationships>')
_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
_STYLES = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles {_NS}>'
           '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults>'
           '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="120"/></w:pPr></w:style>'
           '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>'
           '<w:pPr><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="0C4577"/><w:sz w:val="32"/></w:rPr></w:style>'
           '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/>'
           '<w:pPr><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="0C4577"/><w:sz w:val="26"/></w:rPr></w:style>'
           '</w:styles>')


def _esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _xml_p(text: str, style: Optional[str] = None, bold: bool = False) -> str:
    ppr = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ""
    rpr = "<w:rPr><w:b/></w:rPr>" if bold else ""
    return f'<w:p>{ppr}<w:r>{rpr}<w:t xml:space="preserve">{_esc(text)}</w:t></w:r></w:p>'


def _xml_table(rows) -> str:
    border = "".join(f'<w:{b} w:val="single" w:sz="4" w:color="A0A0A0"/>' for b in ("top", "left", "bottom", "right", "insideH", "insideV"))
    out = [f'<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>{border}</w:tblBorders></w:tblPr>']
    for i, row in enumerate(rows):
        shade = '<w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="E8EEF5"/></w:tcPr>' if i == 0 else ""
        out.append("<w:tr>" + "".join(f"<w:tc>{shade}{_xml_p(c, bold=i == 0)}</w:tc>" for c in row) + "</w:tr>")
    out.append("</w:tbl>")
    return "".join(out)


def example_docx() -> bytes:
    """PCQ di esempio nel formato che l'import riconosce meglio (titoli con stile, una tabella per gruppo di fasi)."""
    body = [_xml_p(EXAMPLE_TITLE, "Heading1"),
            _xml_p("Piano di Controllo Qualità redatto ai sensi del capitolato speciale d'appalto. "
                   "Ogni riga delle tabelle è un controllo da registrare in cantiere.")]
    for heading, intro, rows in EXAMPLE_PHASES:
        body += [_xml_p(heading, "Heading2"), _xml_p(intro), _xml_table(rows)]
    document = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {_NS}><w:body>{"".join(body)}</w:body></w:document>'
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", _CT)
        z.writestr("_rels/.rels", _RELS)
        z.writestr("word/_rels/document.xml.rels", _DOC_RELS)
        z.writestr("word/document.xml", document)
        z.writestr("word/styles.xml", _STYLES)
    return buf.getvalue()
