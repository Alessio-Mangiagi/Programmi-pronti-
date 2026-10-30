# "><(((º> sabusabu <º)))><"
"""
Report Excel (.xlsx) di email e trasferimenti, generato senza librerie esterne.

Fogli:
  Riepilogo      numeri del periodo e conteggi per casella
  Email          una riga per email ricevuta (ultimo tentativo), da registro_posta.csv
  Trasferimenti  una riga per file caricato/saltato/in errore, da report_trasferimento.csv
"""

import csv
import io
import re
import zipfile
from datetime import date, datetime
from pathlib import Path
from xml.sax.saxutils import escape

import pec
import protocollo
import vfp_mail
import vfp_transfer as vt

_ILLEGAL_XML = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")
_EPOCH = datetime(1899, 12, 30)

NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' \
     'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'

# stili: 0 normale, 1 intestazione (bianco su blu Cosedil), 2 data e ora, 3 testo a capo, 4 grassetto
STYLES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy hh:mm"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0C4577"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" horizontal="left"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>"""


class Sheet:
    def __init__(self, name, widths=None, header_rows=(1,), autofilter=True, freeze=True):
        self.name = re.sub(r"[\[\]:*?/\\]", "_", name)[:31]
        self.rows = []  # liste di (valore, stile)
        self.widths = widths or []
        self.header_rows = set(header_rows)
        self.autofilter = autofilter
        self.freeze = freeze

    def add(self, values, style=None):
        self.rows.append([(v, style) for v in values])


def _col(n):
    s = ""
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def _cell(ref, value, style):
    st = f' s="{style}"' if style else ""
    if value is None or value == "":
        return f'<c r="{ref}"{st}/>'
    if isinstance(value, datetime):
        serial = (value - _EPOCH).total_seconds() / 86400
        return f'<c r="{ref}" s="2"><v>{serial:.10f}</v></c>'
    if isinstance(value, bool):
        value = "Sì" if value else "No"
    if isinstance(value, (int, float)):
        return f'<c r="{ref}"{st}><v>{value}</v></c>'
    text = escape(_ILLEGAL_XML.sub("", str(value)))[:32000]
    return f'<c r="{ref}" t="inlineStr"{st}><is><t xml:space="preserve">{text}</t></is></c>'


def _sheet_xml(sheet):
    ncols = max((len(r) for r in sheet.rows), default=1)
    out = [f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet {NS}>']
    if sheet.freeze and sheet.rows:
        out.append('<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>')
    if sheet.widths:
        out.append("<cols>" + "".join(f'<col min="{i}" max="{i}" width="{w}" customWidth="1"/>' for i, w in enumerate(sheet.widths, 1)) + "</cols>")
    out.append("<sheetData>")
    for r, row in enumerate(sheet.rows, 1):
        header = r in sheet.header_rows
        height = ' ht="22" customHeight="1"' if header else ""
        out.append(f'<row r="{r}"{height}>')
        for c, (value, style) in enumerate(row, 1):
            out.append(_cell(f"{_col(c)}{r}", value, 1 if header else style))
        out.append("</row>")
    out.append("</sheetData>")
    if sheet.autofilter and len(sheet.rows) > 1:
        out.append(f'<autoFilter ref="A1:{_col(ncols)}{len(sheet.rows)}"/>')
    out.append("</worksheet>")
    return "".join(out)


def write_xlsx(sheets):
    """Restituisce i byte di un file .xlsx con i fogli indicati."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                   '<Default Extension="xml" ContentType="application/xml"/>'
                   '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
                   '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
                   + "".join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
                             for i in range(1, len(sheets) + 1))
                   + "</Types>")
        z.writestr("_rels/.rels",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
                   "</Relationships>")
        defined = "".join(
            f'<definedName name="_xlnm._FilterDatabase" localSheetId="{i}" hidden="1">\'{escape(sh.name)}\'!$A$1:${_col(max(len(r) for r in sh.rows))}${len(sh.rows)}</definedName>'
            for i, sh in enumerate(sheets) if sh.autofilter and len(sh.rows) > 1)
        z.writestr("xl/workbook.xml",
                   f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook {NS}><sheets>'
                   + "".join(f'<sheet name="{escape(sh.name)}" sheetId="{i}" r:id="rId{i}"/>' for i, sh in enumerate(sheets, 1))
                   + "</sheets>" + (f"<definedNames>{defined}</definedNames>" if defined else "") + "</workbook>")
        z.writestr("xl/_rels/workbook.xml.rels",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   + "".join(f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>'
                             for i in range(1, len(sheets) + 1))
                   + f'<Relationship Id="rId{len(sheets) + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
                   "</Relationships>")
        z.writestr("xl/styles.xml", STYLES)
        for i, sh in enumerate(sheets, 1):
            z.writestr(f"xl/worksheets/sheet{i}.xml", _sheet_xml(sh))
    return buf.getvalue()


# --------------------------------------------------------------------------- report

def _dt(value):
    try:
        return datetime.fromisoformat(value) if value else None
    except ValueError:
        return None


def _in_period(value, dal, al):
    d = _dt(value)
    if d is None:
        return dal is None and al is None
    return (dal is None or d.date() >= dal) and (al is None or d.date() <= al)


def _read_report(path):
    path = Path(path)
    if not path.exists():
        return []
    with open(path, newline="", encoding="utf-8") as f:
        return [{k: vt.csv_plain(v) for k, v in r.items()} for r in csv.DictReader(f, delimiter=";")]


def build_report(mail_log_path, report_path, archive_dir, dal=None, al=None, casella=None, area=None):
    """
    dal/al: date (estremi inclusi) o None; casella: etichetta della casella o None per tutte.
    area: None = tutto (amministratore), "documenti" = senza email, "posta" = senza trasferimenti; qualsiasi altra
    area (es. "mezzi") = ne' email ne' trasferimenti.
    """
    emails = [e for e in vfp_mail.group_mail_log(vfp_mail.read_mail_log(mail_log_path))
              if _in_period(e.get("data"), dal, al) and (not casella or e.get("casella") == casella)]
    transfers = [t for t in _read_report(report_path) if _in_period(t.get("data"), dal, al)]
    if area is not None and area != "posta":
        emails = []
    if area is not None and area != "documenti":
        transfers = []
    archive = str(Path(archive_dir).resolve()).lower()

    # ---- Riepilogo
    periodo = f"{dal.strftime('%d/%m/%Y') if dal else 'inizio'} – {al.strftime('%d/%m/%Y') if al else 'oggi'}"
    count = lambda rows, key, val: sum(1 for r in rows if r.get(key) == val)
    summary = Sheet("Riepilogo", widths=[38, 16, 16, 16, 16, 16, 16], header_rows=(1,), autofilter=False, freeze=False)
    summary.add(["Report email e trasferimenti verso Viewpoint For Projects", ""])
    summary.add(["Generato il", datetime.now()])
    summary.add(["Periodo", periodo])
    summary.add(["Casella", casella or "tutte"])
    summary.add([])
    summary.add(["Email", "Numero"], 4)
    for code, label in vfp_mail.OUTCOME_LABELS.items():
        summary.add([label, count(emails, "esito", code)])
    summary.add(["Totale email ricevute", len(emails)], 4)
    summary.add([])
    summary.add(["Documenti", "Numero"], 4)
    for code, label in (("caricato", "Caricati"), ("saltato", "Saltati"), ("errore", "In errore")):
        summary.add([label, count(transfers, "esito", code)])
    summary.add([])
    summary.add(["Casella", "Ricevute", "Trasferite", "Nuovo tentativo", "Errore", "Bloccate", "Senza allegati"], 4)
    for name in sorted({e.get("casella", "") for e in emails}):
        rows = [e for e in emails if e.get("casella") == name]
        summary.add([name, len(rows), count(rows, "esito", "trasferita"), count(rows, "esito", "riprovo"),
                     count(rows, "esito", "errore"), count(rows, "esito", "bloccata"), count(rows, "esito", "ignorata")])

    # ---- Email
    sheet_mail = Sheet("Email", widths=[17, 17, 14, 30, 32, 44, 20, 10, 48, 22, 10, 60, 22, 16, 44, 40])
    sheet_mail.add(["Ricevuta", "Elaborata", "Tipo casella", "Casella", "Mittente", "Oggetto", "Protocollo", "N. allegati",
                    "Allegati", "Esito", "Tentativi", "Dettaglio", "Tipo PEC", "Firma PEC",
                    "Identificativo PEC", "Documenti VFP (nome=ID)"])
    for e in emails:
        files = [x for x in (e.get("allegati") or "").split(" | ") if x]
        sheet_mail.add([
            _dt(e.get("ricevuta")), _dt(e.get("data")),
            {"graph": "Microsoft 365", "imap": "IMAP", "pec": "PEC"}.get(e.get("tipo_casella"), e.get("tipo_casella")),
            e.get("indirizzo_casella") or e.get("casella"), e.get("mittente"), e.get("oggetto"),
            e.get("protocollo"), len(files),
            "\n".join(files), vfp_mail.OUTCOME_LABELS.get(e.get("esito"), e.get("esito")), e.get("tentativi"),
            e.get("dettaglio"), pec.TYPE_LABELS.get(e.get("pec_tipo"), e.get("pec_tipo")), e.get("pec_firma"),
            e.get("pec_id"), (e.get("documenti") or "").replace(" | ", "\n"),
        ], 3)

    # ---- Trasferimenti
    sheet_tr = Sheet("Trasferimenti", widths=[17, 12, 60, 32, 40, 10, 12, 38, 60])
    sheet_tr.add(["Data", "Origine", "File", "Cartella VFP", "Nome documento", "Revisione", "Esito",
                  "ID documento", "Messaggio"])
    for t in transfers:
        origin = "Email" if (t.get("file") or "").lower().startswith(archive) else "Cartella"
        sheet_tr.add([_dt(t.get("data")), origin, t.get("file"), t.get("cartella"), t.get("nome"), t.get("revisione"),
                      {"caricato": "Caricato", "saltato": "Saltato", "errore": "Errore"}.get(t.get("esito"), t.get("esito")),
                      t.get("id_documento"), t.get("messaggio")], 3)

    return write_xlsx([summary, sheet_mail, sheet_tr])


def build_protocol_register(mail_log_path, year=None):
    """Registro dei protocolli PEC (uno o tutti gli anni) con il controllo della numerazione, in .xlsx."""
    emails = vfp_mail.group_mail_log(vfp_mail.read_mail_log(mail_log_path))
    rows = protocollo.register_rows(emails, year)
    sheet = Sheet("Protocolli", widths=[8, 14, 12, 17, 32, 50, 22, 22, 16, 44, 60])
    sheet.add(["Anno", "Protocollo", "Origine", "Ricevuta", "Mittente", "Oggetto", "Esito", "Tipo PEC", "Firma PEC",
               "Identificativo PEC", "Dettaglio"])
    for r in rows:
        sheet.add([r["anno"], r.get("protocollo"), "Corretto a mano" if r.get("protocollo_origine") == "manuale" else "Automatico",
                   _dt(r.get("ricevuta")), r.get("mittente"), r.get("oggetto"),
                   vfp_mail.OUTCOME_LABELS.get(r.get("esito"), r.get("esito")),
                   pec.TYPE_LABELS.get(r.get("pec_tipo"), r.get("pec_tipo")), r.get("pec_firma"), r.get("pec_id"),
                   r.get("dettaglio")], 3)
    check = Sheet("Controllo numerazione", widths=[8, 10, 10, 10, 14, 70, 70])
    check.add(["Anno", "PEC", "Primo", "Ultimo", "Mancanti", "Numeri mancanti", "Numeri doppi"])
    for y in protocollo.check(emails):
        if year and y["anno"] != year:
            continue
        missing = ", ".join(f"{n:03d}" for n in y["mancanti"]) if y["sequenza"] else "numerazione non continua: controllo non applicabile"
        if y["mancanti_totale"] > len(y["mancanti"]):
            missing += f" ... (altri {y['mancanti_totale'] - len(y['mancanti'])})"
        dup = "; ".join(f"{d['numero']:03d} ({len(d['email'])} PEC)" for d in y["doppi"])
        check.add([y["anno"], y["totale"], y["primo"], y["ultimo"], y["mancanti_totale"], missing, dup], 3)
    return write_xlsx([sheet, check])


def parse_day(value):
    try:
        return date.fromisoformat(value) if value else None
    except ValueError:
        raise ValueError(f"data non valida: {value}")
