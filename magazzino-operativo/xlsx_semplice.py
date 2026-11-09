# "><(((º> sabusabu <º)))><"
"""Excel (.xlsx) di sole tabelle, scritto a mano: nessuna dipendenza, come pdf_semplice.

Serve al riepilogo giornaliero che il Magazzino manda a SkyTower (riepilogo.py): un foglio
per tabella, intestazione in grassetto e bloccata, numeri come numeri (si possono sommare in
Excel), testi come stringhe in linea (niente tabella delle stringhe condivise da tenere).
Un .xlsx è uno zip di file XML: qui ci sono solo quelli che Excel e LibreOffice pretendono.
"""
import io
import math
import re
import zipfile
from datetime import datetime
from xml.sax.saxutils import escape

_VIETATI_NOME = re.compile(r"[\[\]:*?/\\]")
# Caratteri di controllo che l'XML 1.0 non ammette (resterebbe un file che Excel rifiuta).
_CONTROLLO = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def _colonna(n):
    """0 → A, 25 → Z, 26 → AA."""
    s = ""
    n += 1
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def _cella(rif, valore, stile=0):
    s = f' s="{stile}"' if stile else ""
    if isinstance(valore, bool):
        valore = "sì" if valore else "no"
    if isinstance(valore, (int, float)):
        # NaN e infinito non sono numeri per Excel (file rifiutato): cella vuota
        return f'<c r="{rif}"{s}><v>{valore!r}</v></c>' if math.isfinite(valore) else f'<c r="{rif}"{s}/>'
    testo = _CONTROLLO.sub("", str(valore if valore is not None else ""))
    if not testo:
        return f'<c r="{rif}"{s}/>'
    return f'<c r="{rif}"{s} t="inlineStr"><is><t xml:space="preserve">{escape(testo)}</t></is></c>'


def _foglio(f):
    intest = list(f.get("intestazioni") or [])
    righe = list(f.get("righe") or [])
    larghezze = list(f.get("larghezze") or [])
    cols = "".join(f'<col min="{i + 1}" max="{i + 1}" width="{w}" customWidth="1"/>' for i, w in enumerate(larghezze))
    xml = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
           '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
           '<sheetViews><sheetView workbookViewId="0">'
           + ('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' if intest else "")
           + '</sheetView></sheetViews>']
    if cols:
        xml.append(f"<cols>{cols}</cols>")
    xml.append("<sheetData>")
    n = 1
    if intest:
        xml.append('<row r="1">' + "".join(_cella(f"{_colonna(i)}1", v, 1) for i, v in enumerate(intest)) + "</row>")
        n = 2
    for riga in righe:
        xml.append(f'<row r="{n}">' + "".join(_cella(f"{_colonna(i)}{n}", v) for i, v in enumerate(riga)) + "</row>")
        n += 1
    xml.append("</sheetData></worksheet>")
    return "".join(xml)


def nome_foglio(testo, usati):
    """Nome valido per Excel: massimo 31 caratteri, senza []:*?/\\, unico nel file."""
    base = _VIETATI_NOME.sub(" ", str(testo or "Foglio")).strip()[:31] or "Foglio"
    nome, k = base, 2
    while nome.lower() in usati:
        suffisso = f" ({k})"
        nome = base[:31 - len(suffisso)] + suffisso
        k += 1
    usati.add(nome.lower())
    return nome


def documento_xlsx(fogli, autore="Magazzino Operativo Cosedil"):
    """Bytes di un .xlsx. `fogli` = [{"nome", "intestazioni", "righe", "larghezze"?}, ...]."""
    fogli = list(fogli) or [{"nome": "Foglio", "intestazioni": [], "righe": []}]
    usati = set()
    nomi = [nome_foglio(f.get("nome"), usati) for f in fogli]
    adesso = datetime.now().strftime("%Y-%m-%dT%H:%M:%SZ")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                   '<Default Extension="xml" ContentType="application/xml"/>'
                   '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
                   '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
                   '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
                   + "".join(f'<Override PartName="/xl/worksheets/sheet{i + 1}.xml" '
                             'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
                             for i in range(len(fogli)))
                   + "</Types>")
        z.writestr("_rels/.rels",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
                   '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
                   "</Relationships>")
        z.writestr("docProps/core.xml",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
                   'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" '
                   'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
                   f"<dc:creator>{escape(autore)}</dc:creator>"
                   f'<dcterms:created xsi:type="dcterms:W3CDTF">{adesso}</dcterms:created>'
                   "</cp:coreProperties>")
        z.writestr("xl/workbook.xml",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                   'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
                   + "".join(f'<sheet name="{n}" sheetId="{i + 1}" r:id="rId{i + 1}"/>'
                             for i, n in enumerate(escape(x, {'"': "&quot;"}) for x in nomi))
                   + "</sheets></workbook>")
        z.writestr("xl/_rels/workbook.xml.rels",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   + "".join(f'<Relationship Id="rId{i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
                             f'Target="worksheets/sheet{i + 1}.xml"/>' for i in range(len(fogli)))
                   + f'<Relationship Id="rId{len(fogli) + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
                   "</Relationships>")
        # Stile 0 = normale, stile 1 = grassetto su fondo grigio chiaro (intestazioni).
        z.writestr("xl/styles.xml",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                   '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>'
                   '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
                   '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
                   '<fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF5"/><bgColor indexed="64"/></patternFill></fill></fills>'
                   '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
                   '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
                   '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
                   '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>'
                   '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
                   "</styleSheet>")
        for i, f in enumerate(fogli):
            z.writestr(f"xl/worksheets/sheet{i + 1}.xml", _foglio(f))
    return buf.getvalue()
