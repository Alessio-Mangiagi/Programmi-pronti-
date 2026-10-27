# "><(((º> sabusabu <º)))><"
"""Transmittal — registro di protocollo delle emissioni: numerazione per commessa, destinatari, revisioni
trasmesse (fotografate all'emissione), conferma di ricezione e PDF con intestazione della commessa."""
from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from fpdf import FPDF
from fpdf.fonts import FontFace
from pydantic import BaseModel, Field

from ..deps import Ctx, ctx, require_project
from ..errors import not_found
from ..events import security_event

router = APIRouter(tags=["transmittal"])

Purpose = Literal["INFORMATION", "COMMENT", "APPROVAL", "CONSTRUCTION", "TENDER", "RECORD"]
PURPOSE_LABEL = {
    "INFORMATION": "Per informazione", "COMMENT": "Per commenti", "APPROVAL": "Per approvazione",
    "CONSTRUCTION": "Per costruzione", "TENDER": "Per gara", "RECORD": "Per archivio",
}
STATE_LABEL = {"SHARED": "Condiviso", "PUBLISHED": "Pubblicato", "ARCHIVED": "Archiviato", "WIP": "WIP"}
TZ = ZoneInfo("Europe/Rome")
HEADING = FontFace(emphasis="BOLD", color=255, fill_color=(12, 69, 119))


class TransmittalIn(BaseModel):
    subject: str = Field(min_length=3, max_length=300)
    purpose: Purpose
    message: str | None = Field(default=None, max_length=10_000)
    response_due_at: datetime | None = None
    recipient_organization_ids: list[uuid.UUID] = Field(default_factory=list, max_length=50)
    recipient_user_ids: list[uuid.UUID] = Field(default_factory=list, max_length=100)
    revision_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)


LIST_SQL = """
    SELECT t.id, t.project_id, t.number, 'TRM-' || lpad(t.number::text, 4, '0') AS code, t.subject, t.purpose,
           t.issued_at, t.response_due_at, t.sender_id, u.first_name || ' ' || u.last_name AS sender_name,
           o.code AS sender_org_code,
           (SELECT count(*) FROM cde.transmittal_items i WHERE i.transmittal_id = t.id) AS item_count,
           (SELECT string_agg(coalesce(ro.code, ru.first_name || ' ' || ru.last_name), ', ')
              FROM cde.transmittal_recipients r LEFT JOIN cde.organizations ro ON ro.id = r.organization_id
              LEFT JOIN cde.users ru ON ru.id = r.user_id WHERE r.transmittal_id = t.id) AS recipients_label,
           t.sender_org_id = cde.current_app_org() AS sent_by_my_org,
           cde.current_app_user() IN (SELECT cde.transmittal_recipient_users(t.id)) AS i_am_recipient,
           EXISTS (SELECT 1 FROM cde.transmittal_receipts k WHERE k.transmittal_id = t.id
                   AND k.user_id = cde.current_app_user()) AS acknowledged_by_me
    FROM cde.transmittals t
    LEFT JOIN cde.users u ON u.id = t.sender_id
    LEFT JOIN cde.organizations o ON o.id = t.sender_org_id"""


def _transmittal(conn, tid: uuid.UUID) -> dict:
    t = conn.execute(
        "SELECT x.*, t.message, p.code AS project_code, p.name AS project_name, so.legal_name AS sender_org_name"
        " FROM (" + LIST_SQL + " WHERE t.id = %(id)s) x JOIN cde.transmittals t ON t.id = x.id"
        " JOIN cde.projects p ON p.id = t.project_id JOIN cde.organizations so ON so.id = t.sender_org_id",
        {"id": tid}).fetchone()
    if t is None:
        raise not_found("Trasmissione")
    t["recipients"] = conn.execute(
        """SELECT r.organization_id, o.code AS organization_code, o.legal_name, r.user_id,
                  u.first_name || ' ' || u.last_name AS user_name, uo.code AS user_org_code
           FROM cde.transmittal_recipients r LEFT JOIN cde.organizations o ON o.id = r.organization_id
           LEFT JOIN cde.users u ON u.id = r.user_id LEFT JOIN cde.organizations uo ON uo.id = u.organization_id
           WHERE r.transmittal_id = %s ORDER BY o.code NULLS LAST, user_name""", [tid]).fetchall()
    t["items"] = conn.execute(
        """SELECT i.position, i.revision_id, i.document_id, i.identifier, i.title, i.revision_code, i.suitability,
                  i.state, i.original_filename, i.size_bytes, encode(i.sha256, 'hex') AS sha256,
                  EXISTS (SELECT 1 FROM cde.document_revisions r WHERE r.id = i.revision_id) AS visible
           FROM cde.transmittal_items i WHERE i.transmittal_id = %s ORDER BY i.position""", [tid]).fetchall()
    t["receipts"] = conn.execute(
        """SELECT k.user_id, u.first_name || ' ' || u.last_name AS user_name, o.code AS organization_code,
                  k.acknowledged_at
           FROM cde.transmittal_receipts k JOIN cde.users u ON u.id = k.user_id
           JOIN cde.organizations o ON o.id = u.organization_id
           WHERE k.transmittal_id = %s ORDER BY k.acknowledged_at""", [tid]).fetchall()
    return t


@router.get("/projects/{project_id}/transmittals")
def list_transmittals(project_id: uuid.UUID, direction: Literal["sent", "received"] | None = None,
                      c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        require_project(conn, project_id)
        where = {"sent": " AND t.sender_org_id = cde.current_app_org()",
                 "received": " AND cde.current_app_user() IN (SELECT cde.transmittal_recipient_users(t.id))"}
        return conn.execute(LIST_SQL + " WHERE t.project_id = %s" + where.get(direction or "", "")
                            + " ORDER BY t.number DESC LIMIT 500", [project_id]).fetchall()


@router.get("/me/transmittals")
def my_pending_transmittals(c: Ctx = Depends(ctx)):
    """Trasmissioni ricevute e non ancora confermate, su tutti i progetti: alimenta il pannello "Per me"."""
    with c.tx() as conn:
        return conn.execute(
            "SELECT x.*, p.code AS project_code FROM (" + LIST_SQL + ") x JOIN cde.projects p ON p.id = x.project_id"
            " WHERE x.i_am_recipient AND NOT x.acknowledged_by_me ORDER BY x.issued_at DESC LIMIT 100").fetchall()


@router.post("/projects/{project_id}/transmittals", status_code=201)
def issue(project_id: uuid.UUID, body: TransmittalIn, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        require_project(conn, project_id)
        tid = conn.execute(
            "SELECT cde.transmittal_issue(%s, %s, %s, %s, %s, %s::uuid[], %s::uuid[], %s::uuid[]) AS id",
            [project_id, body.subject, body.purpose, body.message, body.response_due_at,
             body.recipient_organization_ids, body.recipient_user_ids, body.revision_ids]).fetchone()["id"]
        security_event(conn, "TRANSMITTAL_ISSUED", user_id=c.user_id, project_id=project_id, ip=c.ip,
                       transmittal=tid, revisions=len(body.revision_ids))
        return _transmittal(conn, tid)


@router.get("/transmittals/{transmittal_id}")
def get_transmittal(transmittal_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        return _transmittal(conn, transmittal_id)


@router.post("/transmittals/{transmittal_id}/acknowledge")
def acknowledge(transmittal_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        conn.execute("SELECT cde.transmittal_acknowledge(%s)", [transmittal_id])
        t = _transmittal(conn, transmittal_id)
        security_event(conn, "TRANSMITTAL_ACKNOWLEDGED", user_id=c.user_id, project_id=t["project_id"], ip=c.ip,
                       transmittal=transmittal_id)
        return t


@router.get("/transmittals/{transmittal_id}/pdf")
def transmittal_pdf(transmittal_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        t = _transmittal(conn, transmittal_id)
        security_event(conn, "TRANSMITTAL_PRINTED", user_id=c.user_id, project_id=t["project_id"], ip=c.ip,
                       transmittal=transmittal_id)
    pdf = render_pdf(t)
    name = f"{t['project_code']}-{t['code']}.pdf"
    return Response(pdf, media_type="application/pdf", headers={
        "Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store"})


# ---------------------------------------------------------------------
# PDF
# ---------------------------------------------------------------------
def _t(value) -> str:
    """I font standard del PDF coprono Latin-1: il resto si sostituisce senza rompere il documento."""
    s = "" if value is None else str(value)
    s = s.replace("—", "-").replace("–", "-").replace("’", "'").replace("“", '"').replace("”", '"').replace("…", "...")
    return s.encode("latin-1", "replace").decode("latin-1")


def _when(ts: datetime | None, with_time: bool = True) -> str:
    if ts is None:
        return "-"
    return ts.astimezone(TZ).strftime("%d/%m/%Y %H:%M" if with_time else "%d/%m/%Y")


class _Doc(FPDF):
    def __init__(self, t: dict):
        super().__init__(orientation="P", unit="mm", format="A4")
        self.t = t
        self.set_auto_page_break(auto=True, margin=18)
        self.set_margins(15, 15, 15)
        self.alias_nb_pages()
        self.set_title(_t(f"{t['project_code']} {t['code']}"))
        self.set_creator("CDE SkyTower")

    def header(self):
        t = self.t
        self.set_font("Helvetica", "B", 9)
        self.set_text_color(90)
        self.cell(0, 5, _t(f"{t['project_code']} - {t['project_name']}"), new_x="LMARGIN", new_y="NEXT")
        self.set_draw_color(12, 69, 119)
        self.set_line_width(0.6)
        self.line(15, self.get_y() + 1, 195, self.get_y() + 1)
        self.ln(4)
        self.set_text_color(0)

    def footer(self):
        self.set_y(-12)
        self.set_font("Helvetica", "", 7.5)
        self.set_text_color(110)
        self.cell(0, 5, _t(f"{self.t['code']} - generato il {_when(datetime.now(UTC))}"), align="L")
        self.cell(0, 5, f"Pagina {self.page_no()} di {{nb}}", align="R")


def render_pdf(t: dict) -> bytes:
    pdf = _Doc(t)
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 9, _t(f"Trasmissione {t['code']}"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 11)
    pdf.multi_cell(0, 6, _t(t["subject"]), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)

    recipients = "; ".join(
        f"{r['organization_code']} - {r['legal_name']}" if r["organization_id"] else f"{r['user_name']} ({r['user_org_code']})"
        for r in t["recipients"])
    rows = [
        ("Data di emissione", _when(t["issued_at"])),
        ("Mittente", f"{t['sender_name']} - {t['sender_org_code']} {t['sender_org_name']}"),
        ("Destinatari", recipients),
        ("Scopo", PURPOSE_LABEL.get(t["purpose"], t["purpose"])),
        ("Risposta entro", _when(t["response_due_at"], with_time=False)),
        ("Documenti", str(len(t["items"]))),
    ]
    for label, value in rows:
        pdf.set_font("Helvetica", "B", 9)
        pdf.cell(38, 6, _t(label))
        pdf.set_font("Helvetica", "", 9)
        pdf.multi_cell(0, 6, _t(value), new_x="LMARGIN", new_y="NEXT")
    if t.get("message"):
        pdf.ln(2)
        pdf.set_font("Helvetica", "B", 9)
        pdf.cell(0, 6, "Note", new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", "", 9)
        pdf.multi_cell(0, 5, _t(t["message"]), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(0, 7, "Elenco dei documenti trasmessi", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 8)
    with pdf.table(col_widths=(7, 52, 58, 11, 10, 18), text_align=("RIGHT", "LEFT", "LEFT", "CENTER", "CENTER", "LEFT"),
                   headings_style=HEADING, line_height=4.6, padding=1.2) as table:
        table.row(["N.", "Identificativo", "Titolo / file", "Rev.", "Idon.", "Stato"])
        for i in t["items"]:
            table.row([str(i["position"]), _t(i["identifier"]), _t(f"{i['title']}\n{i['original_filename']}"),
                       _t(i["revision_code"]), _t(i["suitability"]), _t(STATE_LABEL.get(i["state"], i["state"]))])
    pdf.ln(4)

    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(0, 6, "Impronte dei file (SHA-256)", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Courier", "", 7)
    for i in t["items"]:
        pdf.cell(0, 4, _t(f"{i['position']:>3}  {i['sha256']}  {i['size_bytes']:,} byte".replace(",", ".")),
                 new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(0, 6, "Conferme di ricezione", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 9)
    if t["receipts"]:
        for k in t["receipts"]:
            pdf.cell(0, 5, _t(f"{k['user_name']} ({k['organization_code']}) - {_when(k['acknowledged_at'])}"),
                     new_x="LMARGIN", new_y="NEXT")
    else:
        pdf.cell(0, 5, "Nessuna conferma alla data di stampa.", new_x="LMARGIN", new_y="NEXT")
    return bytes(pdf.output())
