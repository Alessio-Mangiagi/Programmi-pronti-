# "><(((º> sabusabu <º)))><"
"""Registro attività (audit trail, Sprint 5): consultazione, verifica della hash chain ed export CSV/PDF firmato.

Riservato al Project Admin della commessa. L'export porta nell'header X-CDE-Signature un JWS RS256
(verificabile con /.well-known/jwks.json) con SHA-256 del file e hash di testa della catena; il PDF riporta
anche nel documento la testa della catena e lo stato della verifica al momento della stampa.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import logging
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Query, Response
from fpdf import FPDF

from ..deps import Ctx, ctx, require_project
from ..events import security_event
from .transmittals import HEADING, _t, _when

log = logging.getLogger("cde.audit")
router = APIRouter(tags=["audit"])

COLUMNS = ["id", "occurred_at", "event_type", "user_name", "organization_code", "ip", "user_agent", "details",
           "chain_seq", "hash"]
PDF_MAX_ROWS = 5000          # oltre, il PDF diventa illeggibile: per volumi grandi c'è il CSV


def _events(conn, project_id: uuid.UUID, *, from_: datetime | None, to: datetime | None, user_id: uuid.UUID | None,
            event_type: str | None, obj: str | None, limit: int, before: int | None) -> list[dict]:
    return conn.execute("SELECT * FROM cde.audit_events(%s, %s, %s, %s, %s, %s, %s, %s)",
                        [project_id, from_, to, user_id, event_type, obj, limit, before]).fetchall()


@router.get("/projects/{project_id}/audit")
def list_events(project_id: uuid.UUID, from_: datetime | None = Query(default=None, alias="from"),
                to: datetime | None = None, user_id: uuid.UUID | None = None,
                event_type: str | None = Query(default=None, max_length=60), obj: str | None = Query(default=None, alias="object", max_length=100),
                limit: int = Query(default=200, ge=1, le=1000), before: int | None = None, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        require_project(conn, project_id)
        return _events(conn, project_id, from_=from_, to=to, user_id=user_id, event_type=event_type, obj=obj,
                       limit=limit, before=before)


@router.get("/projects/{project_id}/audit/verify")
def verify(project_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        require_project(conn, project_id, "ADMIN", "PROJECT")
        result = conn.execute("SELECT * FROM cde.audit_verify()").fetchone()
        anchors = conn.execute("SELECT * FROM cde.audit_anchor_check(14)").fetchall()
    for a in anchors:
        a["matches_chain"] = a["current_hash"] == a["anchored_hash"]
        a["matches_s3"] = None
        if a["s3_key"]:
            try:
                doc = json.loads(c.svc.storage.get_bytes(a["s3_key"], a["s3_version_id"]))
                a["matches_s3"] = doc.get("head_hash") == a["anchored_hash"] and doc.get("chain_seq") == a["chain_seq"]
            except Exception:
                log.exception("ancora del %s non leggibile da S3", a["day"])
                a["matches_s3"] = False
    anchors_ok = all(a["matches_chain"] and a["matches_s3"] is not False for a in anchors)
    return {**result, "ok": result["first_broken_seq"] is None and anchors_ok, "anchors_ok": anchors_ok,
            "anchors": anchors}


def _cell(value) -> str:
    """Testo per CSV senza formule eseguibili da Excel."""
    if value is None:
        return ""
    text = json.dumps(value, ensure_ascii=False, sort_keys=True) if isinstance(value, dict) else str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


def _export(c: Ctx, project_id: uuid.UUID, kind: str, filters: dict, limit: int, render) -> Response:
    """Export firmato: render(project, rows, chain, filters) -> (byte, media type, estensione)."""
    with c.tx() as conn:
        project = require_project(conn, project_id, "ADMIN", "PROJECT")
        rows = _events(conn, project_id, from_=filters["from"], to=filters["to"], user_id=filters["user_id"],
                       event_type=filters["event_type"], obj=filters["object"], limit=limit, before=None)
        chain = conn.execute("SELECT * FROM cde.audit_verify()").fetchone()
        body, media_type, ext = render(project, rows, chain, filters)
        digest = hashlib.sha256(body).hexdigest()
        signature = c.svc.tokens.sign_export({
            "sub": str(project_id), "kind": kind, "sha256": digest, "rows": len(rows),
            "chain_head_seq": chain["head_seq"], "chain_head_hash": chain["head_hash"],
            "chain_ok": chain["first_broken_seq"] is None, "exported_by": str(c.user_id),
            "filters": {k: (v.isoformat() if isinstance(v, datetime) else str(v) if v else None)
                        for k, v in filters.items()},
        })
        security_event(conn, "AUDIT_EXPORTED", user_id=c.user_id, project_id=project_id, ip=c.ip,
                       rows=len(rows), sha256=digest, format=ext)
    name = f"registro-{project['code']}-{datetime.now():%Y%m%d-%H%M}.{ext}"
    return Response(body, media_type=media_type, headers={
        "Content-Disposition": f'attachment; filename="{name}"',
        "X-CDE-Signature": signature, "X-CDE-SHA256": digest,
        "Access-Control-Expose-Headers": "X-CDE-Signature, X-CDE-SHA256",
    })


def _render_csv(project, rows, chain, filters):
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=";", lineterminator="\r\n")
    writer.writerow(COLUMNS)
    for r in rows:
        writer.writerow([_cell(r[k]) for k in COLUMNS])
    return buf.getvalue().encode("utf-8-sig"), "text/csv; charset=utf-8", "csv"


class _AuditPdf(FPDF):
    def __init__(self, project: dict):
        super().__init__(orientation="L", unit="mm", format="A4")
        self.project = project
        self.set_auto_page_break(auto=True, margin=15)
        self.set_margins(12, 12, 12)
        self.alias_nb_pages()
        self.set_title(_t(f"{project['code']} registro attività"))
        self.set_creator("CDE SkyTower")

    def header(self):
        self.set_font("Helvetica", "B", 9)
        self.set_text_color(90)
        self.cell(0, 5, _t(f"{self.project['code']} - {self.project['name']} - Registro attività"),
                  new_x="LMARGIN", new_y="NEXT")
        self.set_draw_color(12, 69, 119)
        self.set_line_width(0.6)
        self.line(12, self.get_y() + 1, 285, self.get_y() + 1)
        self.ln(4)
        self.set_text_color(0)

    def footer(self):
        self.set_y(-10)
        self.set_font("Helvetica", "", 7)
        self.set_text_color(110)
        self.cell(0, 5, _t(f"Generato il {_when(datetime.now(UTC))} - firma nell'header X-CDE-Signature del download"))
        self.cell(0, 5, f"Pagina {self.page_no()} di {{nb}}", align="R")


def _details(d) -> str:
    if not d:
        return ""
    text = ", ".join(f"{k}={v}" for k, v in sorted(d.items())) if isinstance(d, dict) else str(d)
    return text if len(text) <= 160 else text[:157] + "..."


def _render_pdf(project, rows, chain, filters):
    pdf = _AuditPdf(project)
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 15)
    pdf.cell(0, 8, "Registro attività", new_x="LMARGIN", new_y="NEXT")
    ok = chain["first_broken_seq"] is None
    active = [f"{k}: {_when(v) if isinstance(v, datetime) else v}" for k, v in filters.items() if v]
    for label, value in [
        ("Filtri", "; ".join(active) or "nessuno"),
        ("Eventi", f"{len(rows)}" + (f" (primi {PDF_MAX_ROWS}: per l'elenco completo usare il CSV)"
                                     if len(rows) >= PDF_MAX_ROWS else "")),
        ("Catena di hash", ("integra" if ok else f"ALTERATA dal record {chain['first_broken_seq']}")
         + f" - testa n. {chain['head_seq']}"),
        ("Hash di testa", chain["head_hash"] or "-"),
    ]:
        pdf.set_font("Helvetica", "B", 9)
        pdf.cell(32, 5.5, _t(label))
        pdf.set_font("Courier" if label == "Hash di testa" else "Helvetica", "", 8.5)
        pdf.multi_cell(0, 5.5, _t(value), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)
    pdf.set_font("Helvetica", "", 7)
    with pdf.table(col_widths=(26, 34, 36, 14, 22, 120, 14), headings_style=HEADING, line_height=3.8, padding=1,
                   text_align=("LEFT", "LEFT", "LEFT", "CENTER", "LEFT", "LEFT", "RIGHT")) as table:
        table.row(["Data e ora", "Evento", "Utente", "Org.", "IP", "Dettagli", "N."])
        for r in rows:
            table.row([_when(r["occurred_at"]), _t(r["event_type"]), _t(r["user_name"]), _t(r["organization_code"]),
                       _t(r["ip"]), _t(_details(r["details"])), str(r["chain_seq"] or "")])
    return bytes(pdf.output()), "application/pdf", "pdf"


def _filters(from_, to, user_id, event_type, obj) -> dict:
    return {"from": from_, "to": to, "user_id": user_id, "event_type": event_type, "object": obj}


@router.get("/projects/{project_id}/audit/export.csv")
def export_csv(project_id: uuid.UUID, from_: datetime | None = Query(default=None, alias="from"),
               to: datetime | None = None, user_id: uuid.UUID | None = None,
               event_type: str | None = Query(default=None, max_length=60), obj: str | None = Query(default=None, alias="object", max_length=100),
               c: Ctx = Depends(ctx)):
    return _export(c, project_id, "audit-csv", _filters(from_, to, user_id, event_type, obj), 50000, _render_csv)


@router.get("/projects/{project_id}/audit/export.pdf")
def export_pdf(project_id: uuid.UUID, from_: datetime | None = Query(default=None, alias="from"),
               to: datetime | None = None, user_id: uuid.UUID | None = None,
               event_type: str | None = Query(default=None, max_length=60), obj: str | None = Query(default=None, alias="object", max_length=100),
               c: Ctx = Depends(ctx)):
    return _export(c, project_id, "audit-pdf", _filters(from_, to, user_id, event_type, obj), PDF_MAX_ROWS, _render_pdf)
