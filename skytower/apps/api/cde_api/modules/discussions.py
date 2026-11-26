# "><(((º> sabusabu <º)))><"
"""Discussioni della commessa (ADR-59, migrazione 0047): conversazioni fra persone invitate.

Una discussione la vedono solo le persone che chi l'ha aperta ha invitato (scelta 2a dell'utente del 26/11/2026):
nessuna eccezione per gli amministratori. Chi l'ha aperta cambia titolo e persone e la chiude o riapre; gli altri
scrivono, allegano revisioni di documenti della commessa (come nelle RFI) ed escono quando vogliono.
Le scritture passano dalle funzioni ``cde.discussion_*`` (controlli, avvisi con email); le letture sono sotto RLS.
"""
from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..deps import Ctx, ctx, require_project
from ..errors import not_found
from ..events import security_event
from .rfis import _check_attachments

router = APIRouter(tags=["discussioni"])


class DiscussionIn(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    body: str = Field(min_length=1, max_length=20_000)
    participant_ids: list[uuid.UUID] = Field(min_length=1, max_length=200)
    revision_ids: list[uuid.UUID] = Field(default_factory=list, max_length=50)


class MessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=20_000)
    revision_ids: list[uuid.UUID] = Field(default_factory=list, max_length=50)


class DiscussionPatch(BaseModel):
    """Solo chi ha aperta la discussione. Campi assenti = invariati; participant_ids = elenco completo degli
    invitati (chi manca viene tolto, chi è nuovo riceve l'invito)."""
    title: str | None = Field(default=None, min_length=3, max_length=200)
    participant_ids: list[uuid.UUID] | None = Field(default=None, min_length=1, max_length=200)
    closed: bool | None = None


# Riga dell'elenco: non letti = messaggi degli altri arrivati dopo l'ultima lettura di chi guarda
LIST_SQL = """
    SELECT d.id, d.project_id, d.number, d.title, d.created_by, d.created_at, d.last_message_at, d.closed_at,
           cu.first_name || ' ' || cu.last_name AS created_by_name,
           d.created_by = cde.current_app_user() AS i_am_creator,
           (SELECT count(*) FROM cde.discussion_messages m WHERE m.discussion_id = d.id) AS message_count,
           (SELECT count(*) FROM cde.discussion_messages m
             WHERE m.discussion_id = d.id AND m.author_id <> cde.current_app_user()
               AND m.created_at > coalesce(me.last_read_at, '-infinity')) AS unread,
           (SELECT string_agg(u.first_name || ' ' || u.last_name, ', ' ORDER BY p.added_at)
              FROM cde.discussion_participants p JOIN cde.users u ON u.id = p.user_id
             WHERE p.discussion_id = d.id AND p.removed_at IS NULL) AS participant_names,
           (SELECT count(*) FROM cde.discussion_participants p
             WHERE p.discussion_id = d.id AND p.removed_at IS NULL) AS participant_count,
           last.body AS last_body, last.author_name AS last_author
    FROM cde.discussions d
    JOIN cde.discussion_participants me ON me.discussion_id = d.id AND me.user_id = cde.current_app_user()
    LEFT JOIN cde.users cu ON cu.id = d.created_by
    LEFT JOIN LATERAL (
        SELECT left(m.body, 160) AS body, u.first_name || ' ' || u.last_name AS author_name
        FROM cde.discussion_messages m LEFT JOIN cde.users u ON u.id = m.author_id
        WHERE m.discussion_id = d.id ORDER BY m.created_at DESC LIMIT 1) last ON true"""


def _discussion(conn, discussion_id: uuid.UUID) -> dict:
    row = conn.execute(LIST_SQL + " WHERE d.id = %s", [discussion_id]).fetchone()
    if row is None:
        raise not_found("Discussione")
    row["participants"] = conn.execute(
        """SELECT p.user_id, u.first_name || ' ' || u.last_name AS name, o.code AS organization_code, p.added_at,
                  p.user_id = d.created_by AS is_creator
           FROM cde.discussion_participants p JOIN cde.discussions d ON d.id = p.discussion_id
           LEFT JOIN cde.users u ON u.id = p.user_id LEFT JOIN cde.organizations o ON o.id = u.organization_id
           WHERE p.discussion_id = %s AND p.removed_at IS NULL ORDER BY p.user_id = d.created_by DESC, p.added_at""",
        [discussion_id]).fetchall()
    # allegati: solo le revisioni che chi guarda può vedere (RLS sulle revisioni); le altre non compaiono
    row["messages"] = conn.execute(
        """SELECT m.id, m.author_id, u.first_name || ' ' || u.last_name AS author_name, o.code AS author_org_code,
                  m.body, m.created_at, cardinality(m.revision_ids) AS attachment_count,
                  coalesce((SELECT json_agg(json_build_object('revision_id', r.id, 'revision_code', r.revision_code,
                                                              'identifier', d.identifier, 'title', d.title,
                                                              'document_id', d.id))
                            FROM cde.document_revisions r JOIN cde.documents d ON d.id = r.document_id
                            WHERE r.id = ANY(m.revision_ids)), '[]') AS attachments,
                  coalesce((SELECT json_agg(json_build_object('id', t.id, 'code', cde.team_task_code(t.number),
                                                              'title', t.title, 'status', t.status))
                            FROM cde.team_tasks t WHERE t.message_id = m.id), '[]') AS tasks
           FROM cde.discussion_messages m LEFT JOIN cde.users u ON u.id = m.author_id
           LEFT JOIN cde.organizations o ON o.id = u.organization_id
           WHERE m.discussion_id = %s ORDER BY m.created_at""", [discussion_id]).fetchall()
    # task nati dalla discussione che chi guarda può vedere (RLS dei task: chi li ha dati e chi li ha)
    row["tasks"] = conn.execute(
        """SELECT t.id, cde.team_task_code(t.number) AS code, t.title, t.status, t.due_on, t.message_id
           FROM cde.team_tasks t WHERE t.discussion_id = %s ORDER BY t.number""", [discussion_id]).fetchall()
    return row


@router.get("/projects/{project_id}/discussions")
def list_discussions(project_id: uuid.UUID, stato: Literal["aperte", "chiuse", "tutte"] = "aperte",
                     c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        require_project(conn, project_id)
        filtro = {"aperte": " AND d.closed_at IS NULL", "chiuse": " AND d.closed_at IS NOT NULL", "tutte": ""}[stato]
        return conn.execute(LIST_SQL + " WHERE d.project_id = %s AND me.removed_at IS NULL" + filtro
                            + " ORDER BY d.last_message_at DESC LIMIT 300", [project_id]).fetchall()


@router.get("/me/discussions")
def my_discussions(c: Ctx = Depends(ctx)):
    """Discussioni aperte con messaggi non letti, su tutte le commesse: alimenta il pannello "Per me"."""
    with c.tx() as conn:
        return conn.execute(
            "SELECT x.*, p.code AS project_code FROM (" + LIST_SQL + " WHERE me.removed_at IS NULL"
            " AND d.closed_at IS NULL) x JOIN cde.projects p ON p.id = x.project_id WHERE x.unread > 0"
            " ORDER BY x.last_message_at DESC LIMIT 50").fetchall()


@router.post("/projects/{project_id}/discussions", status_code=201)
def create_discussion(project_id: uuid.UUID, body: DiscussionIn, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        require_project(conn, project_id)
        _check_attachments(conn, body.revision_ids)
        did = conn.execute("SELECT cde.discussion_create(%s, %s, %s, %s::uuid[], %s::uuid[]) AS id",
                           [project_id, body.title, body.body, body.participant_ids, body.revision_ids]).fetchone()["id"]
        # nel registro della commessa solo che la discussione esiste e quante persone ha: il contenuto resta loro
        security_event(conn, "DISCUSSION_CREATED", user_id=c.user_id, project_id=project_id, ip=c.ip,
                       discussion=did, participants=len(set(body.participant_ids) - {c.user_id}) + 1)
        return _discussion(conn, did)


@router.get("/discussions/{discussion_id}")
def get_discussion(discussion_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        return _discussion(conn, discussion_id)


@router.post("/discussions/{discussion_id}/read")
def mark_read(discussion_id: uuid.UUID, c: Ctx = Depends(ctx)):
    """Letta fin qui (la pagina della discussione lo chiama quando la mostra): azzera i non letti e segna letti
    gli avvisi della discussione, così il prossimo messaggio avvisa di nuovo."""
    with c.tx() as conn:
        conn.execute("SELECT cde.discussion_mark_read(%s)", [discussion_id])
    return {"ok": True}


@router.post("/discussions/{discussion_id}/messages", status_code=201)
def post_message(discussion_id: uuid.UUID, body: MessageIn, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        _check_attachments(conn, body.revision_ids)
        conn.execute("SELECT cde.discussion_post(%s, %s, %s::uuid[])", [discussion_id, body.body, body.revision_ids])
        return _discussion(conn, discussion_id)


@router.patch("/discussions/{discussion_id}")
def update_discussion(discussion_id: uuid.UUID, body: DiscussionPatch, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        if body.title is not None or body.participant_ids is not None:
            conn.execute("SELECT cde.discussion_update(%s, %s, %s::uuid[])",
                         [discussion_id, body.title, body.participant_ids])
        if body.closed is not None:
            conn.execute("SELECT cde.discussion_set_closed(%s, %s)", [discussion_id, body.closed])
        d = _discussion(conn, discussion_id)
        if body.participant_ids is not None:
            security_event(conn, "DISCUSSION_PARTICIPANTS_CHANGED", user_id=c.user_id, project_id=d["project_id"],
                           ip=c.ip, discussion=discussion_id, participants=d["participant_count"])
        if body.closed is not None:
            security_event(conn, "DISCUSSION_CLOSED" if body.closed else "DISCUSSION_REOPENED", user_id=c.user_id,
                           project_id=d["project_id"], ip=c.ip, discussion=discussion_id)
        return d


@router.post("/discussions/{discussion_id}/leave")
def leave_discussion(discussion_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        project_id = conn.execute("SELECT project_id FROM cde.discussions WHERE id = %s", [discussion_id]).fetchone()
        conn.execute("SELECT cde.discussion_leave(%s)", [discussion_id])
        security_event(conn, "DISCUSSION_LEFT", user_id=c.user_id, project_id=project_id and project_id["project_id"],
                       ip=c.ip, discussion=discussion_id)
    return {"ok": True}
