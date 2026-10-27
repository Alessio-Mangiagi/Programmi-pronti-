# "><(((º> sabusabu <º)))><"
"""Markup — annotazioni ancorate a una revisione (pagina e rettangolo, o elemento del modello) con thread
di risposte; si risolvono o si riaprono, il testo non si modifica. La visibilità è quella della revisione (RLS)."""
from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, model_validator

from ..deps import Ctx, ctx
from ..errors import ApiError, forbidden, not_found
from ..events import security_event

router = APIRouter(tags=["markup"])


class MarkupIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
    page: int | None = Field(default=None, ge=1, le=100_000)
    x: float | None = Field(default=None, ge=0, le=1)
    y: float | None = Field(default=None, ge=0, le=1)
    w: float | None = Field(default=None, ge=0, le=1)
    h: float | None = Field(default=None, ge=0, le=1)
    element_ref: str | None = Field(default=None, min_length=1, max_length=128)
    color: str = Field(default="#e53935", pattern=r"^#[0-9a-fA-F]{6}$")
    task_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _anchor(self):
        if (self.x is None) != (self.y is None) or (self.w is None) != (self.h is None) or (self.w is not None and self.x is None):
            raise ValueError("Ancoraggio incompleto: servono x e y (e w con h)")
        if self.x is not None and (self.x + (self.w or 0) > 1.0001 or self.y + (self.h or 0) > 1.0001):
            raise ValueError("Il rettangolo esce dalla pagina")
        return self


class ReplyIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


class StatusIn(BaseModel):
    status: Literal["OPEN", "RESOLVED"]


MARKUP_SQL = """
    SELECT m.id, m.project_id, m.revision_id, m.task_id, m.page, m.x, m.y, m.w, m.h, m.element_ref, m.color,
           m.body, m.status, m.created_at, m.resolved_at, m.author_id,
           u.first_name || ' ' || u.last_name AS author_name, o.code AS author_org_code,
           ru.first_name || ' ' || ru.last_name AS resolved_by_name,
           coalesce((SELECT json_agg(json_build_object('id', p.id, 'author_name', pu.first_name || ' ' || pu.last_name,
                                                       'body', p.body, 'created_at', p.created_at) ORDER BY p.created_at)
                     FROM cde.markup_replies p LEFT JOIN cde.users pu ON pu.id = p.author_id
                     WHERE p.markup_id = m.id), '[]') AS replies,
           (m.author_id = cde.current_app_user()
            OR r.originator_organization_id = cde.current_app_org()
            OR cde.has_project_permission(cde.current_app_user(), m.project_id, 'ADMIN', 'PROJECT')) AS can_resolve
    FROM cde.revision_markups m
    JOIN cde.document_revisions r ON r.id = m.revision_id
    LEFT JOIN cde.users u ON u.id = m.author_id
    LEFT JOIN cde.organizations o ON o.id = m.author_org_id
    LEFT JOIN cde.users ru ON ru.id = m.resolved_by"""


def _markup(conn, markup_id: uuid.UUID) -> dict:
    row = conn.execute(MARKUP_SQL + " WHERE m.id = %s", [markup_id]).fetchone()
    if row is None:
        raise not_found("Annotazione")
    return row


def _revision(conn, revision_id: uuid.UUID) -> dict:
    rev = conn.execute("SELECT id, project_id, document_id FROM cde.document_revisions WHERE id = %s",
                       [revision_id]).fetchone()
    if rev is None:
        raise not_found("Revisione")
    return rev


@router.get("/revisions/{revision_id}/markups")
def list_markups(revision_id: uuid.UUID, status: Literal["OPEN", "RESOLVED"] | None = None, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        _revision(conn, revision_id)
        return conn.execute(MARKUP_SQL + " WHERE m.revision_id = %(r)s" + (" AND m.status = %(s)s" if status else "")
                            + " ORDER BY m.page NULLS FIRST, m.created_at", {"r": revision_id, "s": status}).fetchall()


@router.post("/revisions/{revision_id}/markups", status_code=201)
def create_markup(revision_id: uuid.UUID, body: MarkupIn, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        rev = _revision(conn, revision_id)
        if body.task_id and conn.execute(
                "SELECT 1 FROM cde.tasks WHERE id = %s AND assignee_id = cde.current_app_user()", [body.task_id]).fetchone() is None:
            raise ApiError(422, "invalid_task", "Task non trovato o non assegnato a te")
        mid = conn.execute(
            """INSERT INTO cde.revision_markups (project_id, revision_id, task_id, author_id, author_org_id, page,
                                                 x, y, w, h, element_ref, color, body)
               VALUES (%s, %s, %s, cde.current_app_user(), cde.current_app_org(), %s, %s, %s, %s, %s, %s, %s, %s)
               RETURNING id""",
            [rev["project_id"], revision_id, body.task_id, body.page, body.x, body.y, body.w, body.h,
             body.element_ref, body.color, body.body]).fetchone()["id"]
        security_event(conn, "MARKUP_CREATED", user_id=c.user_id, project_id=rev["project_id"], ip=c.ip,
                       revision=revision_id, markup=mid)
        return _markup(conn, mid)


@router.post("/markups/{markup_id}/replies", status_code=201)
def reply(markup_id: uuid.UUID, body: ReplyIn, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        m = _markup(conn, markup_id)
        conn.execute("INSERT INTO cde.markup_replies (markup_id, author_id, body) VALUES (%s, cde.current_app_user(), %s)",
                     [markup_id, body.body])
        security_event(conn, "MARKUP_REPLIED", user_id=c.user_id, project_id=m["project_id"], ip=c.ip, markup=markup_id)
        return _markup(conn, markup_id)


@router.post("/markups/{markup_id}/status")
def set_status(markup_id: uuid.UUID, body: StatusIn, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        m = _markup(conn, markup_id)
        if not m["can_resolve"]:
            raise forbidden("Risolve l'autore, chi ha emesso la revisione o il Project Admin")
        if m["status"] != body.status:
            resolved = body.status == "RESOLVED"
            conn.execute("""UPDATE cde.revision_markups SET status = %s,
                                   resolved_by = CASE WHEN %s THEN cde.current_app_user() END,
                                   resolved_at = CASE WHEN %s THEN now() END
                            WHERE id = %s""", [body.status, resolved, resolved, markup_id])
            security_event(conn, "MARKUP_RESOLVED" if resolved else "MARKUP_REOPENED", user_id=c.user_id,
                           project_id=m["project_id"], ip=c.ip, markup=markup_id)
        return _markup(conn, markup_id)
