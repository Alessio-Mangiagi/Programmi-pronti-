# "><(((º> sabusabu <º)))><"
"""Excel (.xlsx) di sole tabelle, scritto e letto a mano: nessuna dipendenza, come pdf_semplice.

Scrittura (documento_xlsx): serve al riepilogo giornaliero che il Magazzino manda a SkyTower
(riepilogo.py), allo stato dei mezzi e della flotta e al modello Excel delle manutenzioni
(manutenzioni.py). Un foglio per tabella, intestazione in grassetto e bloccata, numeri come
numeri (si possono sommare in Excel), testi come stringhe in linea (niente tabella delle stringhe
condivise da tenere). Un .xlsx è uno zip di file XML: qui ci sono solo quelli che Excel e
LibreOffice pretendono.

Lettura (leggi_xlsx, dal 19/11/2026): serve a caricare le manutenzioni passate dei mezzi da un
file compilato a mano. Legge valori, stringhe condivise e date (riconosciute dallo stile della
cella); ignora formule (resta il valore calcolato salvato nel file), formattazione e grafici.
Scritta qui invece di aggiungere openpyxl per non cambiare l'installazione del server.
"""
import io
import math
import re
import zipfile
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta
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
    if isinstance(valore, date) and not isinstance(valore, datetime) and not stile:
        # Data vera di Excel (seriale + stile 2 = formato data corto della lingua di Excel): si ordina,
        # si filtra e rientra come data in leggi_xlsx. Le datetime restano testo, come prima.
        return f'<c r="{rif}" s="2"><v>{(valore - date(1899, 12, 30)).days}</v></c>'
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
        # Stile 0 = normale, stile 1 = grassetto su fondo grigio chiaro (intestazioni),
        # stile 2 = data (numFmtId 14, formato data corto: gg/mm/aaaa in un Excel italiano).
        z.writestr("xl/styles.xml",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                   '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>'
                   '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
                   '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
                   '<fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF5"/><bgColor indexed="64"/></patternFill></fill></fills>'
                   '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
                   '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
                   '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
                   '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'
                   '<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>'
                   '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
                   "</styleSheet>")
        for i, f in enumerate(fogli):
            z.writestr(f"xl/worksheets/sheet{i + 1}.xml", _foglio(f))
    return buf.getvalue()


# --------------------------------------------------------------------------- lettura

class XlsxNonLeggibile(ValueError):
    """Il file non è un .xlsx valido (o è troppo grande una volta decompresso). Il testo è per l'utente."""


_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_NS_REL_DOC = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
_NS_REL_PKG = "{http://schemas.openxmlformats.org/package/2006/relationships}"
# Tetto ai byte decompressi di un singolo XML: un .xlsx di poche decine di KB può espandersi molto
# (zip bomb). Un foglio di manutenzioni vero sta abbondantemente sotto.
LETTURA_MAX_BYTE = 40 * 1024 * 1024
# Formati numerici incorporati di Excel che sono date o date e ore (ECMA-376, 18.8.30).
_FORMATI_DATA_BASE = set(range(14, 23)) | {45, 46, 47}
_RIF = re.compile(r"([A-Z]+)(\d+)")


def _leggi_membro(z, nome):
    """Un file XML dello zip come albero, con il tetto ai byte decompressi. None se manca."""
    try:
        info = z.getinfo(nome)
    except KeyError:
        return None
    if info.file_size > LETTURA_MAX_BYTE:
        raise XlsxNonLeggibile("File Excel troppo grande: dividilo in più file più piccoli.")
    try:
        return ET.fromstring(z.read(info))
    except ET.ParseError:
        raise XlsxNonLeggibile("File Excel danneggiato: aprilo e salvalo di nuovo come .xlsx.")


def _indice_colonna(lettere):
    """A → 0, Z → 25, AA → 26 (inverso di _colonna)."""
    n = 0
    for ch in lettere:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def _stili_data(z):
    """Indici degli stili di cella (cellXfs) che mostrano una data: il numero dentro quella cella è un
    seriale di Excel da convertire. Formati personalizzati: data se il codice contiene d, m o y fuori
    da virgolette e parentesi quadre (così "0.00" o "[Red]#,##0" restano numeri)."""
    radice = _leggi_membro(z, "xl/styles.xml")
    if radice is None:
        return set()
    personalizzati = set()
    num_fmts = radice.find(f"{_NS}numFmts")
    for nf in (num_fmts if num_fmts is not None else []):
        codice = re.sub(r'"[^"]*"|\[[^\]]*\]', "", nf.get("formatCode") or "").lower()
        if re.search(r"[dmy]", codice):
            personalizzati.add(int(nf.get("numFmtId") or 0))
    stili = set()
    xfs = radice.find(f"{_NS}cellXfs")
    for i, xf in enumerate(xfs if xfs is not None else []):
        fid = int(xf.get("numFmtId") or 0)
        if fid in _FORMATI_DATA_BASE or fid in personalizzati:
            stili.add(i)
    return stili


def _stringhe_condivise(z):
    """Tabella delle stringhe condivise (xl/sharedStrings.xml): ogni <si> è un testo semplice (<t>) o
    a pezzi formattati (<r><t>). La pronuncia giapponese (<rPh>) non fa parte del testo e si salta."""
    radice = _leggi_membro(z, "xl/sharedStrings.xml")
    if radice is None:
        return []
    out = []
    for si in radice.findall(f"{_NS}si"):
        pezzi = []
        for figlio in si:
            if figlio.tag == f"{_NS}t":
                pezzi.append(figlio.text or "")
            elif figlio.tag == f"{_NS}r":
                pezzi.extend(t.text or "" for t in figlio.findall(f"{_NS}t"))
        out.append("".join(pezzi))
    return out


def seriale_in_data(n):
    """Numero di serie di Excel (giorni dal 30/12/1899, sistema 1900) → date. La parte decimale
    (l'ora) si scarta: alle manutenzioni basta il giorno. None se fuori da un intervallo sensato."""
    try:
        n = float(n)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(n) or not 1 <= n < 2958466:     # 01/01/1900 – 31/12/9999
        return None
    return date(1899, 12, 30) + timedelta(days=int(n))


def _valore_cella(c, condivise, stili_data):
    tipo = c.get("t") or "n"
    if tipo == "inlineStr":
        nodo = c.find(f"{_NS}is")
        return "".join(t.text or "" for t in nodo.iter(f"{_NS}t")) if nodo is not None else ""
    v = c.find(f"{_NS}v")
    testo_v = v.text if v is not None else None
    if testo_v is None:
        return None
    if tipo == "s":
        try:
            return condivise[int(testo_v)]
        except (ValueError, IndexError):
            return ""
    if tipo in ("str", "e"):
        # str = risultato testuale di una formula; e = errore (#N/D, #VALORE!): resta il testo dell'errore
        return testo_v
    if tipo == "b":
        return testo_v.strip() == "1"
    try:
        n = float(testo_v)
    except ValueError:
        return testo_v
    if int(c.get("s") or 0) in stili_data:
        return seriale_in_data(n) or n
    return int(n) if n.is_integer() and abs(n) < 2 ** 53 else n


def leggi_xlsx(dati):
    """Bytes di un .xlsx → {nome foglio: [righe]}, fogli nell'ordine del file.

    Ogni riga è una lista di valori: str, int, float, bool, date o None per le celle vuote, con i
    buchi riempiti (la cella C3 sta sempre all'indice 2 della terza riga). Le righe vuote in mezzo
    restano come liste vuote, così il numero di riga del file si ritrova (indice + 1).
    Solleva XlsxNonLeggibile con un testo per l'utente se il file non è un .xlsx."""
    try:
        z = zipfile.ZipFile(io.BytesIO(dati))
    except (zipfile.BadZipFile, ValueError):
        raise XlsxNonLeggibile(
            "Il file non è un Excel .xlsx: se è un vecchio .xls o un altro formato, aprilo in Excel e "
            "salvalo come \"Cartella di lavoro di Excel (.xlsx)\".")
    with z:
        libro = _leggi_membro(z, "xl/workbook.xml")
        if libro is None:
            raise XlsxNonLeggibile("Il file non contiene fogli di Excel: salvalo di nuovo come .xlsx.")
        relazioni = {}
        rel = _leggi_membro(z, "xl/_rels/workbook.xml.rels")
        for r in (rel if rel is not None else []):
            if r.tag == f"{_NS_REL_PKG}Relationship":
                destinazione = r.get("Target") or ""
                # di solito "worksheets/sheet1.xml" (relativo a xl/), a volte "/xl/worksheets/sheet1.xml"
                relazioni[r.get("Id")] = destinazione.lstrip("/") if destinazione.startswith("/") else "xl/" + destinazione
        condivise = _stringhe_condivise(z)
        stili_data = _stili_data(z)
        fogli = {}
        nodo_fogli = libro.find(f"{_NS}sheets")
        for s in (nodo_fogli if nodo_fogli is not None else []):
            percorso = relazioni.get(s.get(f"{_NS_REL_DOC}id"))
            radice = _leggi_membro(z, percorso) if percorso else None
            if radice is None:
                continue
            righe = []
            dati_foglio = radice.find(f"{_NS}sheetData")
            for row in (dati_foglio if dati_foglio is not None else []):
                try:
                    n_riga = int(row.get("r") or 0) or len(righe) + 1
                except ValueError:
                    n_riga = len(righe) + 1
                while len(righe) < n_riga - 1:
                    righe.append([])
                celle = []
                for c in row.findall(f"{_NS}c"):
                    m = _RIF.fullmatch(c.get("r") or "")
                    col = _indice_colonna(m.group(1)) if m else len(celle)
                    while len(celle) < col:
                        celle.append(None)
                    celle.append(_valore_cella(c, condivise, stili_data))
                while celle and celle[-1] in (None, ""):
                    celle.pop()
                righe.append(celle)
            while righe and not righe[-1]:
                righe.pop()
            fogli[s.get("name") or f"Foglio{len(fogli) + 1}"] = righe
        return fogli
