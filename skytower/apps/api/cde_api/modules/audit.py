# "><(((º> sabusabu <º)))><"
"""Registro attività (audit trail, Sprint 5): consultazione, verifica della hash chain ed export CSV firmato.

Riservato al Project Admin della commessa. L'export porta nell'header X-CDE-Signature un JWS RS256
(verificabile con /.well-known/jwks.json) con SHA-256 del file e hash di testa della catena.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query, Response

from ..deps import Ctx, ctx, require_project
from ..events import security_event

router = APIRouter(tags=["audit"])

COLUMNS = ["id", "occurred_at", "event_type", "user_name", "organization_code", "ip", "user_agent", "details",
           "chain_seq", "hash"]


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
    return {**result, "ok": result["first_broken_seq"] is None}


def _cell(value) -> str:
    """Testo per CSV senza formule eseguibili da Excel."""
    if value is None:
        return ""
    text = json.dumps(value, ensure_ascii=False, sort_keys=True) if isinstance(value, dict) else str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


@router.get("/projects/{project_id}/audit/export.csv")
def export_csv(project_id: uuid.UUID, from_: datetime | None = Query(default=None, alias="from"),
               to: datetime | None = None, user_id: uuid.UUID | None = None,
               event_type: str | None = Query(default=None, max_length=60), obj: str | None = Query(default=None, alias="object", max_length=100),
               c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        project = require_project(conn, project_id, "ADMIN", "PROJECT")
        rows = _events(conn, project_id, from_=from_, to=to, user_id=user_id, event_type=event_type, obj=obj,
                       limit=50000, before=None)
        chain = conn.execute("SELECT * FROM cde.audit_verify()").fetchone()
        buf = io.StringIO()
        writer = csv.writer(buf, delimiter=";", lineterminator="\r\n")
        writer.writerow(COLUMNS)
        for r in rows:
            writer.writerow([_cell(r[k]) for k in COLUMNS])
        body = buf.getvalue().encode("utf-8-sig")
        digest = hashlib.sha256(body).hexdigest()
        signature = c.svc.tokens.sign_export({
            "sub": str(project_id), "kind": "audit-csv", "sha256": digest, "rows": len(rows),
            "chain_head_seq": chain["head_seq"], "chain_head_hash": chain["head_hash"],
            "chain_ok": chain["first_broken_seq"] is None, "exported_by": str(c.user_id),
            "filters": {"from": from_.isoformat() if from_ else None, "to": to.isoformat() if to else None,
                        "user_id": str(user_id) if user_id else None, "event_type": event_type, "object": obj},
        })
        security_event(conn, "AUDIT_EXPORTED", user_id=c.user_id, project_id=project_id, ip=c.ip,
                       rows=len(rows), sha256=digest)
    name = f"registro-{project['code']}-{datetime.now():%Y%m%d-%H%M}.csv"
    return Response(body, media_type="text/csv; charset=utf-8", headers={
        "Content-Disposition": f'attachment; filename="{name}"',
        "X-CDE-Signature": signature, "X-CDE-SHA256": digest,
        "Access-Control-Expose-Headers": "X-CDE-Signature, X-CDE-SHA256",
    })
