# "><(((º> sabusabu <º)))><"
"""Task fra le persone della commessa (ADR-59, migrazione 0047): bacheca da fare / in corso / fatto.

Un task ha una o più persone assegnate, priorità, scadenza, sotto-task da spuntare, commenti e la storia delle
modifiche; può nascere da un messaggio di una discussione. Lo vedono chi l'ha assegnato e le persone assegnate
(non gli altri membri, nemmeno il Project Admin). Lo stato lo cambiano tutti e due (la bacheca); titolo,
descrizione, priorità, scadenza e persone solo chi l'ha assegnato, che lo supervisiona anche con il riepilogo del
mattino (``notifier.send_team_task_digests``). Nomi tecnici "team task": ``cde.tasks`` sono i compiti dei workflow.
"""
from __future__ import annotations

import uuid
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from ..deps import Ctx, ctx, require_project
from ..errors import not_found
from ..events import security_event

router = APIRouter(tags=["task"])

Status = Literal["TODO", "IN_PROGRESS", "DONE"]
Priority = Literal["LOW", "NORMAL", "HIGH", "URGENT"]


class TaskIn(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    description: str = Field(default="", max_length=20_000)
    priority: Priority = "NORMAL"
    due_on: date | None = None
    assignee_ids: list[uuid.UUID] = Field(min_length=1, max_length=50)
    items: list[str] = Field(default_factory=list, max_length=100)
    discussion_id: uuid.UUID | None = None
    message_id: uuid.UUID | None = None


class TaskPatch(BaseModel):
    """Solo i campi da cambiare. ``status`` lo possono mandare anche le persone assegnate, il resto no."""
    title: str | None = Field(default=None, min_length=3, max_length=200)
    description: str | None = Field(default=None, max_length=20_000)
    priority: Priority | None = None
    due_on: date | None = None
    assignee_ids: list[uuid.UUID] | None = Field(default=None, min_length=1, max_length=50)
    status: Status | None = None


class ItemIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)


class ItemPatch(BaseModel):
    done: bool | None = None
    title: str | None = Field(default=None, min_length=1, max_length=300)


class CommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=20_000)


# Riga della bacheca e dell'elenco. overdue: scadenza passata nel fuso della commessa e task non fatto.
LIST_SQL = """
    SELECT t.id, t.project_id, t.number, cde.team_task_code(t.number) AS code, t.title, t.description, t.status,
           t.priority, t.due_on, t.created_by, t.created_at, t.updated_at, t.completed_at, t.discussion_id,
           cu.first_name || ' ' || cu.last_name AS created_by_name,
           t.created_by = cde.current_app_user() AS i_am_creator,
           EXISTS (SELECT 1 FROM cde.team_task_assignees a WHERE a.task_id = t.id
                   AND a.user_id = cde.current_app_user()) AS i_am_assignee,
           (t.status <> 'DONE' AND t.due_on IS NOT NULL
            AND t.due_on < cde.local_date(now(), p.timezone)) AS overdue,
           coalesce((SELECT json_agg(json_build_object('user_id', a.user_id, 'name', u.first_name || ' ' || u.last_name,
                                                       'organization_code', o.code) ORDER BY a.added_at)
                     FROM cde.team_task_assignees a LEFT JOIN cde.users u ON u.id = a.user_id
                     LEFT JOIN cde.organizations o ON o.id = u.organization_id
                     WHERE a.task_id = t.id), '[]') AS assignees,
           (SELECT count(*) FROM cde.team_task_items i WHERE i.task_id = t.id AND i.done_at IS NOT NULL) AS items_done,
           (SELECT count(*) FROM cde.team_task_items i WHERE i.task_id = t.id) AS items_total,
           (SELECT count(*) FROM cde.team_task_comments k WHERE k.task_id = t.id) AS comment_count,
           p.code AS project_code
    FROM cde.team_tasks t JOIN cde.projects p ON p.id = t.project_id
    LEFT JOIN cde.users cu ON cu.id = t.created_by"""

# ordine della bacheca: prima i più urgenti, poi la scadenza più vicina
ORDER = (" ORDER BY CASE t.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END,"
         " t.due_on NULLS LAST, t.number")


def _task(conn, task_id: uuid.UUID) -> dict:
    row = conn.execute(LIST_SQL + " WHERE t.id = %s", [task_id]).fetchone()
    if row is None:
        raise not_found("Task")
    row["items"] = conn.execute(
        """SELECT i.id, i.title, i.position, i.done_at, i.created_by, i.created_by = cde.current_app_user() AS mine,
                  u.first_name || ' ' || u.last_name AS done_by_name
           FROM cde.team_task_items i LEFT JOIN cde.users u ON u.id = i.done_by
           WHERE i.task_id = %s ORDER BY i.position""", [task_id]).fetchall()
    row["comments"] = conn.execute(
        """SELECT k.id, k.author_id, u.first_name || ' ' || u.last_name AS author_name, o.code AS author_org_code,
                  k.body, k.created_at
           FROM cde.team_task_comments k LEFT JOIN cde.users u ON u.id = k.author_id
           LEFT JOIN cde.organizations o ON o.id = u.organization_id
           WHERE k.task_id = %s ORDER BY k.created_at""", [task_id]).fetchall()
    row["events"] = conn.execute(
        """SELECT e.id, e.kind, e.data, e.created_at, u.first_name || ' ' || u.last_name AS actor_name
           FROM cde.team_task_events e LEFT JOIN cde.users u ON u.id = e.actor_id
           WHERE e.task_id = %s ORDER BY e.id DESC LIMIT 200""", [task_id]).fetchall()
    # la discussione di origine si mostra solo a chi ci partecipa (RLS delle discussioni)
    row["discussion"] = conn.execute("SELECT id, title FROM cde.discussions WHERE id = %s",
                                     [row["discussion_id"]]).fetchone() if row["discussion_id"] else None
    return row


@router.get("/projects/{project_id}/team-tasks")
def list_tasks(project_id: uuid.UUID, vista: Literal["tutti", "assegnati_a_me", "assegnati_da_me"] = "tutti",
               completati: bool = True, c: Ctx = Depends(ctx)):
    """Task della commessa che chi guarda può vedere: tutti i suoi, quelli che deve fare, quelli che ha dato."""
    where = ["t.project_id = %(p)s"]
    if vista == "assegnati_a_me":
        where.append("EXISTS (SELECT 1 FROM cde.team_task_assignees a WHERE a.task_id = t.id"
                     " AND a.user_id = cde.current_app_user())")
    elif vista == "assegnati_da_me":
        where.append("t.created_by = cde.current_app_user()")
    if not completati:
        where.append("t.status <> 'DONE'")
    with c.tx() as conn:
        require_project(conn, project_id)
        return conn.execute(LIST_SQL + " WHERE " + " AND ".join(where) + ORDER + " LIMIT 500", {"p": project_id}).fetchall()


@router.get("/me/team-tasks")
def my_tasks(c: Ctx = Depends(ctx)):
    """Task non fatti assegnati a chi guarda, su tutte le commesse: alimenta il pannello "Per me"."""
    with c.tx() as conn:
        return conn.execute(
            LIST_SQL + " WHERE t.status <> 'DONE' AND EXISTS (SELECT 1 FROM cde.team_task_assignees a"
            " WHERE a.task_id = t.id AND a.user_id = cde.current_app_user())" + ORDER + " LIMIT 100").fetchall()


@router.post("/projects/{project_id}/team-tasks", status_code=201)
def create_task(project_id: uuid.UUID, body: TaskIn, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        require_project(conn, project_id)
        tid = conn.execute(
            "SELECT cde.team_task_create(%s, %s, %s, %s, %s, %s::uuid[], %s::text[], %s, %s) AS id",
            [project_id, body.title, body.description, body.priority, body.due_on, body.assignee_ids,
             [i for i in body.items if i.strip()], body.discussion_id, body.message_id]).fetchone()["id"]
        security_event(conn, "TEAM_TASK_CREATED", user_id=c.user_id, project_id=project_id, ip=c.ip, task=tid,
                       assignees=len(set(body.assignee_ids)), from_discussion=body.discussion_id is not None
                       or body.message_id is not None)
        return _task(conn, tid)


@router.get("/team-tasks/{task_id}")
def get_task(task_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        return _task(conn, task_id)


@router.post("/team-tasks/{task_id}/read")
def mark_read(task_id: uuid.UUID, c: Ctx = Depends(ctx)):
    """Task aperto: i suoi avvisi diventano letti (il prossimo commento avvisa di nuovo, vedi cde.notify_once)."""
    with c.tx() as conn:
        _task(conn, task_id)   # 404 se non visibile
        conn.execute("UPDATE cde.notifications SET read_at = now() WHERE read_at IS NULL AND data ->> 'task_id' = %s",
                     [str(task_id)])
    return {"ok": True}


@router.patch("/team-tasks/{task_id}")
def update_task(task_id: uuid.UUID, body: TaskPatch, c: Ctx = Depends(ctx)):
    # null esplicito: vale solo per togliere scadenza o descrizione; per gli altri campi è "invariato"
    changes = {k: v for k, v in body.model_dump(mode="json", exclude_unset=True).items()
               if v is not None or k in ("due_on", "description")}
    with c.tx() as conn:
        before = _task(conn, task_id)
        if changes:
            conn.execute("SELECT cde.team_task_update(%s, %s)", [task_id, Jsonb(changes)])
        task = _task(conn, task_id)
        if changes:
            dettagli = {k: v for k, v in changes.items() if k in ("status", "priority", "due_on")}
            if "assignee_ids" in changes:
                dettagli["assignees"] = len(changes["assignee_ids"])
            security_event(conn, "TEAM_TASK_UPDATED", user_id=c.user_id, project_id=before["project_id"], ip=c.ip,
                           task=task_id, fields=sorted(changes), **dettagli)
        return task


@router.delete("/team-tasks/{task_id}", status_code=204)
def delete_task(task_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        task = _task(conn, task_id)
        conn.execute("SELECT cde.team_task_delete(%s)", [task_id])
        security_event(conn, "TEAM_TASK_DELETED", user_id=c.user_id, project_id=task["project_id"], ip=c.ip,
                       task=task_id, code=task["code"])


def _item_of(conn, task_id: uuid.UUID, item_id: uuid.UUID) -> None:
    """404 se il sotto-task non è di quel task (o il task non è visibile: RLS sui sotto-task)."""
    owner = conn.execute("SELECT task_id FROM cde.team_task_items WHERE id = %s", [item_id]).fetchone()
    if owner is None or owner["task_id"] != task_id:
        raise not_found("Sotto-task")


@router.post("/team-tasks/{task_id}/items", status_code=201)
def add_item(task_id: uuid.UUID, body: ItemIn, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        conn.execute("SELECT cde.team_task_item_add(%s, %s)", [task_id, body.title])
        return _task(conn, task_id)


@router.patch("/team-tasks/{task_id}/items/{item_id}")
def update_item(task_id: uuid.UUID, item_id: uuid.UUID, body: ItemPatch, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        _item_of(conn, task_id, item_id)
        conn.execute("SELECT cde.team_task_item_set(%s, %s, %s)", [item_id, body.done, body.title])
        return _task(conn, task_id)


@router.delete("/team-tasks/{task_id}/items/{item_id}")
def delete_item(task_id: uuid.UUID, item_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        _item_of(conn, task_id, item_id)
        conn.execute("SELECT cde.team_task_item_delete(%s)", [item_id])
        return _task(conn, task_id)


@router.post("/team-tasks/{task_id}/comments", status_code=201)
def add_comment(task_id: uuid.UUID, body: CommentIn, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        conn.execute("SELECT cde.team_task_comment(%s, %s)", [task_id, body.body])
        return _task(conn, task_id)
