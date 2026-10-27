# "><(((º> sabusabu <º)))><"
"""Stati del CDE (Sprint 3): transizioni singole e massive, regole, storico.

La logica di validazione e ricodifica vive in `cde.transition_revision()` (DB): un solo punto
che applica regole configurabili, permessi e immutabilità.
"""
from __future__ import annotations

import uuid
from typing import Literal

import psycopg
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..deps import Ctx, ctx, require_project
from ..errors import ApiError, not_found
from ..events import security_event
from .documents import REVISION_SQL

router = APIRouter(tags=["cde-states"])

TargetState = Literal["SHARED", "PUBLISHED", "ARCHIVED"]


class TransitionIn(BaseModel):
    to_state: TargetState
    suitability: str | None = Field(default=None, pattern=r"^(S[1-4]|A\d|B\d|CR)$")
    reason: str | None = Field(default=None, max_length=2000)


class BulkTransitionIn(TransitionIn):
    revision_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)


def _do_transition(conn, revision_id: uuid.UUID, body: TransitionIn) -> dict:
    new_id = conn.execute("SELECT cde.transition_revision(%s, %s, %s, %s) AS id",
                          [revision_id, body.to_state, body.suitability or "", body.reason]).fetchone()["id"]
    return conn.execute(REVISION_SQL + " WHERE r.id = %s", [new_id]).fetchone()


def _message(exc: psycopg.Error) -> tuple[int, str]:
    if isinstance(exc, psycopg.errors.NoDataFound):
        return 404, "Revisione non trovata"
    if isinstance(exc, psycopg.errors.InsufficientPrivilege):
        return 403, exc.diag.message_primary or "Operazione non consentita"
    if isinstance(exc, psycopg.errors.LockNotAvailable):
        return 423, exc.diag.message_primary or "Documento bloccato"
    if isinstance(exc, psycopg.errors.UniqueViolation):
        return 409, "Transizione concorrente sullo stesso documento: riprovare"
    return 422, exc.diag.message_primary or "Transizione non valida"


@router.get("/projects/{project_id}/state-transitions")
def list_transitions(project_id: uuid.UUID, c: Ctx = Depends(ctx)):
    """Regole effettive (quelle di progetto sostituiscono i default)."""
    with c.tx() as conn:
        require_project(conn, project_id)
        return conn.execute(
            """SELECT DISTINCT ON (from_state, to_state) from_state, to_state, required_action, originator_only,
                      allowed_suitability, reason_required, project_id IS NOT NULL AS project_specific
               FROM cde.state_transitions WHERE project_id = %s OR project_id IS NULL
               ORDER BY from_state, to_state, project_id NULLS LAST""", [project_id]).fetchall()


@router.post("/revisions/{revision_id}/transitions", status_code=201)
def transition(revision_id: uuid.UUID, body: TransitionIn, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        try:
            with conn.transaction():
                rev = _do_transition(conn, revision_id, body)
        except psycopg.Error as exc:
            status, msg = _message(exc)
            raise ApiError(status, "transition_failed", msg) from None
        security_event(conn, "REVISION_STATE_CHANGED", user_id=c.user_id, project_id=None, ip=c.ip,
                       from_revision=revision_id, to_state=body.to_state, suitability=body.suitability)
        return rev


@router.post("/projects/{project_id}/transitions/bulk")
def bulk_transition(project_id: uuid.UUID, body: BulkTransitionIn, c: Ctx = Depends(ctx)):
    """Transizione multipla: una sotto-transazione per elemento, esito per ciascuno (G28)."""
    results = []
    with c.tx() as conn:
        require_project(conn, project_id)
        for rid in dict.fromkeys(body.revision_ids):
            try:
                with conn.transaction():
                    if conn.execute("SELECT project_id FROM cde.document_revisions WHERE id = %s",
                                    [rid]).fetchone() not in ({"project_id": project_id},):
                        raise psycopg.errors.NoDataFound()
                    rev = _do_transition(conn, rid, body)
                results.append({"revision_id": rid, "ok": True, "new_revision_id": rev["id"],
                                "revision_code": rev["revision_code"] if body.to_state != "ARCHIVED" else None})
            except psycopg.Error as exc:
                status, msg = _message(exc)
                results.append({"revision_id": rid, "ok": False, "status": status, "error": msg})
        ok = sum(r["ok"] for r in results)
        security_event(conn, "BULK_STATE_CHANGE", user_id=c.user_id, project_id=project_id, ip=c.ip,
                       to_state=body.to_state, requested=len(results), succeeded=ok)
    return {"succeeded": ok, "failed": len(results) - ok, "results": results}


@router.get("/documents/{document_id}/history")
def document_history(document_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        if conn.execute("SELECT 1 FROM cde.documents WHERE id = %s", [document_id]).fetchone() is None:
            raise not_found("Documento")
        return conn.execute(
            """SELECT l.id, l.from_state, l.to_state, l.reason, l.changed_at, fr.revision_code AS from_revision,
                      tr.revision_code AS to_revision, tr.suitability,
                      u.first_name || ' ' || u.last_name AS changed_by_name
               FROM cde.state_change_log l
               LEFT JOIN cde.document_revisions fr ON fr.id = l.from_revision_id
               LEFT JOIN cde.document_revisions tr ON tr.id = l.to_revision_id
               LEFT JOIN cde.users u ON u.id = l.changed_by
               WHERE l.document_id = %s ORDER BY l.changed_at, l.id""", [document_id]).fetchall()
