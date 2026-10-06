"""
PDF di un modulo compilato (GET /submissions/{id}/pdf).

Impaginazione con reportlab/platypus: intestazione (commessa, cantiere,
planimetria, pin, chi/quando), poi un blocco per campo con la risposta,
le foto/firma allegate e, se presenti, commento e foto della nota
(data_json["_notes"]). Le immagini vengono lette dallo storage e ridotte
prima dell'inserimento per tenere il file leggero.
"""
import io
from datetime import datetime
from typing import Any
from xml.sax.saxutils import escape

from PIL import Image as PILImage
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Image, KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from sqlalchemy.orm import Session

from app import models, storage as st
from app.forms import NOTES_KEY

PRIMARY = colors.HexColor("#0c4577")   # blu Cosedil
ACCENT = colors.HexColor("#65bc7b")    # verde Cosedil
MUTED = colors.HexColor("#5b6b7a")
LINE = colors.HexColor("#d9e1e8")

PAGE_W, PAGE_H = A4
MARGIN = 18 * mm
CONTENT_W = PAGE_W - 2 * MARGIN
PHOTO_W = 60 * mm          # larghezza di ogni foto nella griglia
PHOTO_MAX_PX = 1000        # lato massimo dell'immagine incorporata
SIGNATURE_W = 70 * mm

_ss = getSampleStyleSheet()
STYLES = {
    "title": ParagraphStyle("title", parent=_ss["Title"], fontName="Helvetica-Bold", fontSize=18, leading=22,
                            textColor=PRIMARY, alignment=TA_LEFT, spaceAfter=2),
    "eyebrow": ParagraphStyle("eyebrow", parent=_ss["Normal"], fontName="Helvetica-Bold", fontSize=8, leading=10,
                              textColor=ACCENT, spaceAfter=2),
    "meta": ParagraphStyle("meta", parent=_ss["Normal"], fontSize=9, leading=12, textColor=MUTED),
    "label": ParagraphStyle("label", parent=_ss["Normal"], fontName="Helvetica-Bold", fontSize=9.5, leading=12,
                            textColor=PRIMARY),
    "value": ParagraphStyle("value", parent=_ss["Normal"], fontSize=10.5, leading=14),
    "empty": ParagraphStyle("empty", parent=_ss["Normal"], fontSize=10, leading=13, textColor=MUTED),
    "note_label": ParagraphStyle("note_label", parent=_ss["Normal"], fontName="Helvetica-Bold", fontSize=8.5,
                                 leading=11, textColor=MUTED),
    "note": ParagraphStyle("note", parent=_ss["Normal"], fontSize=9.5, leading=13, leftIndent=8),
    "caption": ParagraphStyle("caption", parent=_ss["Normal"], fontSize=8, leading=10, textColor=MUTED),
}


def _p(text: str, style: str) -> Paragraph:
    return Paragraph(escape(text).replace("\n", "<br/>"), STYLES[style])


def _fmt_dt(d: datetime | None) -> str:
    return d.strftime("%d/%m/%Y %H:%M") if d else "—"


def _fmt_date(v: str) -> str:
    try:
        return datetime.strptime(v, "%Y-%m-%d").strftime("%d/%m/%Y")
    except ValueError:
        return v


def _read_file(file_url: str | None) -> bytes | None:
    """Byte di un allegato dal suo /files/<key>; None se manca o non è leggibile."""
    if not file_url or not file_url.startswith("/files/"):
        return None
    key = file_url[len("/files/"):]
    try:
        if not st.storage.exists(key):
            return None
        if isinstance(st.storage, st.S3Storage):
            return st.storage.read(key)
        return st.storage.path(key).read_bytes()
    except Exception:
        return None


def _image_flowable(data: bytes, max_w: float) -> Image | None:
    """Immagine ridotta (max PHOTO_MAX_PX) e scalata a max_w mantenendo le proporzioni."""
    try:
        im = PILImage.open(io.BytesIO(data))
        im.load()
    except Exception:
        return None
    if im.mode not in ("RGB", "RGBA"):
        im = im.convert("RGB")
    im.thumbnail((PHOTO_MAX_PX, PHOTO_MAX_PX))
    buf = io.BytesIO()
    if im.mode == "RGBA":
        # PNG con trasparenza (firme): sfondo bianco
        bg = PILImage.new("RGB", im.size, "white")
        bg.paste(im, mask=im.split()[3])
        im = bg
    im.save(buf, format="JPEG", quality=82)
    w, h = im.size
    scale = max_w / w
    return Image(io.BytesIO(buf.getvalue()), width=w * scale, height=h * scale)


def _photo_grid(atts: dict[str, models.Attachment], ids: list[str], max_w: float = PHOTO_W):
    """Griglia di foto (3 per riga); gli allegati mancanti diventano una didascalia."""
    cells = []
    for aid in ids:
        att = atts.get(aid)
        data = _read_file(att.file_url) if att else None
        img = _image_flowable(data, max_w) if data else None
        cells.append(img or _p("foto non disponibile", "caption"))
    if not cells:
        return []
    per_row = max(1, int(CONTENT_W // (max_w + 4 * mm)))
    rows = [cells[i:i + per_row] for i in range(0, len(cells), per_row)]
    for r in rows:
        r.extend([""] * (per_row - len(r)))
    t = Table(rows, colWidths=[max_w + 4 * mm] * per_row, hAlign="LEFT")
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0),
                           ("RIGHTPADDING", (0, 0), (-1, -1), 4 * mm), ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm)]))
    return [t]


def _value_flowables(f: dict, v: Any, atts: dict[str, models.Attachment]) -> list:
    t = f["type"]
    if v is None or v == "" or v == []:
        return [_p("—", "empty")]
    if t == "checkbox":
        return [_p("Sì" if v else "No", "value")]
    if t == "multiselect":
        return [_p(", ".join(str(x) for x in v), "value")]
    if t == "date":
        return [_p(_fmt_date(str(v)), "value")]
    if t == "number":
        return [_p(f"{v:g}" if isinstance(v, float) else str(v), "value")]
    if t == "photo":
        return _photo_grid(atts, list(v)) or [_p("—", "empty")]
    if t == "signature":
        att = atts.get(str(v))
        data = _read_file(att.file_url) if att else None
        img = _image_flowable(data, SIGNATURE_W) if data else None
        return [img] if img else [_p("firma non disponibile", "caption")]
    if t == "geolocation":
        acc = f" (±{v['accuracy']:.0f} m)" if isinstance(v, dict) and v.get("accuracy") is not None else ""
        return [_p(f"{v['lat']:.6f}, {v['lng']:.6f}{acc}", "value")]
    return [_p(str(v), "value")]


def _project_of(sub: models.FormSubmission) -> models.Project:
    return sub.pin.plan.project if sub.pin_id else sub.wbs_node.project


def _header_block(sub: models.FormSubmission, template: models.FormTemplate, db: Session) -> list:
    project = _project_of(sub)
    commessa = project.commessa
    author = db.get(models.User, sub.submitted_by) if sub.submitted_by else None

    if sub.pin_id:
        pin = sub.pin
        where = [["Planimetria", pin.plan.name], ["Pin", pin.label or f"({pin.x:.2f}, {pin.y:.2f})"]]
    else:
        # voce WBS con il percorso dalla radice (es. "01 Strutture › 01.02 Solai")
        chain = []
        n = sub.wbs_node
        while n is not None:
            chain.append(f"{n.code} {n.name}".strip() if n.code else n.name)
            n = n.parent
        where = [["Voce WBS", " › ".join(reversed(chain))]]
    rows = [
        ["Commessa", f"{commessa.code} · {commessa.name}" if commessa else "—"],
        ["Cantiere", project.name],
        *where,
        ["Compilato da", f"{author.name} ({author.email})" if author else "—"],
        ["Data", _fmt_dt(sub.created_at) + (f" · modificato {_fmt_dt(sub.updated_at)}" if sub.updated_at != sub.created_at else "")],
    ]
    table = Table([[_p(k, "label"), _p(v, "meta")] for k, v in rows], colWidths=[30 * mm, CONTENT_W - 30 * mm], hAlign="LEFT")
    table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0),
                               ("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 1)]))
    return [
        _p("FIELD VIEW · COSEDIL S.P.A.", "eyebrow"),
        _p(template.name, "title"),
        table,
        Spacer(1, 4 * mm),
    ]


def _field_block(f: dict, data: dict, notes: dict, atts: dict[str, models.Attachment]) -> list:
    items: list = [_p(f["label"] + (" *" if f.get("required") else ""), "label")]
    items += _value_flowables(f, data.get(f["id"]), atts)
    note = notes.get(f["id"]) if isinstance(notes, dict) else None
    if isinstance(note, dict):
        comment = note.get("comment")
        photos = note.get("photos") or []
        if comment or photos:
            items.append(Spacer(1, 1.5 * mm))
            items.append(_p("Nota", "note_label"))
        if comment:
            items.append(_p(str(comment), "note"))
        if photos:
            items += _photo_grid(atts, list(photos), max_w=45 * mm)
    items.append(Spacer(1, 2 * mm))
    return items


def _page_decorations(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(ACCENT)
    canvas.setLineWidth(2)
    canvas.line(MARGIN, PAGE_H - MARGIN + 6 * mm, PAGE_W - MARGIN, PAGE_H - MARGIN + 6 * mm)
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(MUTED)
    canvas.drawString(MARGIN, MARGIN - 8 * mm, doc.title)
    canvas.drawRightString(PAGE_W - MARGIN, MARGIN - 8 * mm, f"Pagina {doc.page}")
    canvas.restoreState()


def build_submission_pdf(db: Session, sub: models.FormSubmission, template: models.FormTemplate) -> bytes:
    data = sub.data_json or {}
    notes = data.get(NOTES_KEY) or {}
    atts = {a.id: a for a in sub.attachments if a.deleted_at is None}

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN, topMargin=MARGIN + 4 * mm,
                            bottomMargin=MARGIN, title=f"{template.name} — {_project_of(sub).name}",
                            author="InCampo — Cosedil")
    story: list = _header_block(sub, template, db)
    for f in template.schema_def["fields"]:
        block = _field_block(f, data, notes, atts)
        # riga separatrice fra i campi
        sep = Table([[""]], colWidths=[CONTENT_W], rowHeights=[1])
        sep.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.5, LINE)]))
        story.append(KeepTogether(block + [sep, Spacer(1, 2.5 * mm)]))
    doc.build(story, onFirstPage=_page_decorations, onLaterPages=_page_decorations)
    return buf.getvalue()
