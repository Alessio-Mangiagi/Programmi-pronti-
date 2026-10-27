# "><(((º> sabusabu <º)))><"
"""RFI — Richieste di informazioni: numerazione progressiva per progetto, destinatari, thread, scadenza."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..deps import Ctx, ctx, require_project
from ..errors import ApiError, not_found

router = APIRouter(tags=["rfi"])


class RfiIn(BaseModel):
    subject: str = Field(min_length=3, max_length=300)
    question: str = Field(min_length=1, max_length=20_000)
    due_at: datetime | None = None
    recipient_organization_ids: list[uuid.UUID] = Field(default_factory=list, max_length=50)
    recipient_user_ids: list[uuid.UUID] = Field(default_factory=list, max_length=100)
    revision_ids: list[uuid.UUID] = Field(default_factory=list, max_length=50)


class MessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=20_000)
    is_answer: bool = False
    revision_ids: list[uuid.UUID] = Field(default_factory=list, max_length=50)


RFI_SQL = """
    SELECT f.id, f.project_id, f.number, 'RFI-' || lpad(f.number::text, 4, '0') AS code, f.subject, f.question,
           f.status, f.due_at, f.created_at, f.answered_at, f.closed_at, f.author_id, f.author_org_id,
           u.first_name || ' ' || u.last_name AS author_name, o.code AS author_org_code,
           (f.due_at IS NOT NULL AND f.due_at < now() AND f.status = 'OPEN') AS overdue,
           (SELECT count(*) FROM cde.rfi_messages m WHERE m.rfi_id = f.id) AS message_count
    FROM cde.rfis f
    LEFT JOIN cde.users u ON u.id = f.author_id
    LEFT JOIN cde.organizations o ON o.id = f.author_org_id"""


def _check_attachments(conn, revision_ids: list[uuid.UUID]) -> None:
    """Si allegano solo revisioni che chi scrive può vedere (RLS)."""
    if revision_ids:
        n = conn.execute("SELECT count(*) n FROM cde.document_revisions WHERE id = ANY(%s)",
                         [list(set(revision_ids))]).fetchone()["n"]
        if n != len(set(revision_ids)):
            raise ApiError(422, "invalid_attachment", "Allegato non trovato o non accessibile")


def _rfi(conn, rfi_id: uuid.UUID) -> dict:
    rfi = conn.execute(RFI_SQL + " WHERE f.id = %s", [rfi_id]).fetchone()
    if rfi is None:
        raise not_found("RFI")
    rfi["recipients"] = conn.execute(
        """SELECT rr.organization_id, o.code AS organization_code, o.legal_name, rr.user_id,
                  u.first_name || ' ' || u.last_name AS user_name
           FROM cde.rfi_recipients rr LEFT JOIN cde.organizations o ON o.id = rr.organization_id
           LEFT JOIN cde.users u ON u.id = rr.user_id WHERE rr.rfi_id = %s""", [rfi_id]).fetchall()
    rfi["messages"] = conn.execute(
        """SELECT m.id, m.author_id, u.first_name || ' ' || u.last_name AS author_name, m.body, m.is_answer,
                  m.created_at,
                  coalesce((SELECT json_agg(json_build_object('revision_id', r.id, 'revision_code', r.revision_code,
                                                              'identifier', d.identifier, 'document_id', d.id))
                            FROM cde.document_revisions r JOIN cde.documents d ON d.id = r.document_id
                            WHERE r.id = ANY(m.revision_ids)), '[]') AS attachments
           FROM cde.rfi_messages m LEFT JOIN cde.users u ON u.id = m.author_id
           WHERE m.rfi_id = %s ORDER BY m.created_at""", [rfi_id]).fetchall()
    rfi["i_am_recipient"] = conn.execute("SELECT cde.current_app_user() IN (SELECT cde.rfi_recipient_users(%s)) r",
                                         [rfi_id]).fetchone()["r"]
    return rfi


@router.get("/projects/{project_id}/rfis")
def list_rfis(project_id: uuid.UUID, status: Literal["OPEN", "ANSWERED", "CLOSED"] | None = None,
              c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        require_project(conn, project_id)
        return conn.execute(RFI_SQL + " WHERE f.project_id = %(p)s" + (" AND f.status = %(s)s" if status else "")
                            + " ORDER BY f.number DESC", {"p": project_id, "s": status}).fetchall()


@router.get("/me/rfis")
def my_rfis(c: Ctx = Depends(ctx)):
    """RFI non chiuse in cui l'utente deve rispondere (destinatario) o attende risposta (autore), su tutti i
    progetti: alimenta il pannello "Per me"."""
    with c.tx() as conn:
        return conn.execute(
            "SELECT r.*, p.code AS project_code, cde.current_app_user() IN (SELECT cde.rfi_recipient_users(r.id))"
            " AS i_am_recipient FROM (" + RFI_SQL + " WHERE f.status <> 'CLOSED') r"
            " JOIN cde.projects p ON p.id = r.project_id"
            " WHERE r.author_id = cde.current_app_user()"
            "    OR cde.current_app_user() IN (SELECT cde.rfi_recipient_users(r.id))"
            " ORDER BY r.due_at NULLS LAST, r.created_at DESC LIMIT 100").fetchall()


@router.post("/projects/{project_id}/rfis", status_code=201)
def create_rfi(project_id: uuid.UUID, body: RfiIn, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        require_project(conn, project_id)
        _check_attachments(conn, body.revision_ids)
        rid = conn.execute(
            "SELECT cde.rfi_create(%s, %s, %s, %s, %s::uuid[], %s::uuid[], %s::uuid[]) AS id",
            [project_id, body.subject, body.question, body.due_at, body.recipient_organization_ids,
             body.recipient_user_ids, body.revision_ids]).fetchone()["id"]
        return _rfi(conn, rid)


@router.get("/rfis/{rfi_id}")
def get_rfi(rfi_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        return _rfi(conn, rfi_id)


@router.post("/rfis/{rfi_id}/messages", status_code=201)
def post_message(rfi_id: uuid.UUID, body: MessageIn, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        _check_attachments(conn, body.revision_ids)
        conn.execute("SELECT cde.rfi_post_message(%s, %s, %s, %s::uuid[])",
                     [rfi_id, body.body, body.is_answer, body.revision_ids])
        return _rfi(conn, rfi_id)


@router.post("/rfis/{rfi_id}/close")
def close_rfi(rfi_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        conn.execute("SELECT cde.rfi_close(%s)", [rfi_id])
        return _rfi(conn, rfi_id)
