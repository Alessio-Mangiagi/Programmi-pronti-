# "><(((º> sabusabu <º)))><"
"""Workflow di approvazione multi-step (Sprint 4).

Template JSON versionati (validati qui con pydantic); esecuzione nel database tramite
`cde.workflow_start/complete_task/cancel`, che garantiscono atomicità, quorum e blocco del documento.
"""
from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field, model_validator

from ..deps import Ctx, ctx, require_project
from ..errors import ApiError, not_found
from ..events import security_event

router = APIRouter(tags=["workflows"])


# ---------------------------------------------------------------------
# Definizione dei template
# ---------------------------------------------------------------------
class Assignee(BaseModel):
    type: Literal["user", "role", "originator_role"]
    id: uuid.UUID | None = None                    # type = user
    code: str | None = Field(default=None, pattern=r"^[A-Z][A-Z0-9_]{1,40}$")   # role / originator_role
    organization_id: uuid.UUID | None = None       # role: limita a un'organizzazione

    @model_validator(mode="after")
    def _shape(self):
        if self.type == "user" and not self.id:
            raise ValueError("Assegnatario utente: indicare id")
        if self.type != "user" and not self.code:
            raise ValueError("Assegnatario per ruolo: indicare code")
        return self


class QuorumN(BaseModel):
    n: int = Field(ge=1, le=50)


class Step(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    assignees: list[Assignee] = Field(min_length=1, max_length=20)
    quorum: Literal["ALL", "ANY"] | QuorumN = "ALL"
    sla_hours: int | None = Field(default=None, ge=1, le=24 * 90)


class OnApproved(BaseModel):
    to_state: Literal["SHARED", "PUBLISHED"]
    suitability: str = Field(pattern=r"^(S[1-4]|A\d|B\d|CR)$")


class Definition(BaseModel):
    steps: list[Step] = Field(min_length=1, max_length=20)
    on_approved: OnApproved | None = None
    escalation_user_id: uuid.UUID | None = None


class TemplateIn(BaseModel):
    code: str = Field(pattern=r"^[A-Z][A-Z0-9_]{1,40}$")
    name: str = Field(min_length=2, max_length=200)
    definition: Definition


class TemplatePatch(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=200)
    is_active: bool | None = None


class StartIn(BaseModel):
    template_id: uuid.UUID
    comment: str | None = Field(default=None, max_length=2000)


class CompleteIn(BaseModel):
    outcome: Literal["APPROVED", "APPROVED_WITH_COMMENTS", "REJECTED"]
    comment: str | None = Field(default=None, max_length=4000)


class CancelIn(BaseModel):
    reason: str = Field(min_length=3, max_length=2000)


TEMPLATE_COLS = "id, project_id, code, version, name, definition, is_active, created_at"


@router.get("/projects/{project_id}/workflow-templates")
def list_templates(project_id: uuid.UUID, include_inactive: bool = False, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        require_project(conn, project_id)
        return conn.execute(
            f"SELECT {TEMPLATE_COLS} FROM cde.workflow_templates WHERE project_id = %s"
            + ("" if include_inactive else " AND is_active") + " ORDER BY code, version DESC", [project_id]).fetchall()


@router.post("/projects/{project_id}/workflow-templates", status_code=201)
def create_template(project_id: uuid.UUID, body: TemplateIn, c: Ctx = Depends(ctx)):
    """Stesso codice ⇒ nuova versione; le versioni precedenti vengono disattivate."""
    with c.tx() as conn:
        require_project(conn, project_id, "ADMIN", "PROJECT")
        version = conn.execute("SELECT coalesce(max(version), 0) + 1 AS v FROM cde.workflow_templates "
                               "WHERE project_id = %s AND code = %s", [project_id, body.code]).fetchone()["v"]
        conn.execute("UPDATE cde.workflow_templates SET is_active = false WHERE project_id = %s AND code = %s",
                     [project_id, body.code])
        tid = uuid.uuid4()
        conn.execute(
            """INSERT INTO cde.workflow_templates (id, project_id, code, version, name, definition, created_by)
               VALUES (%s, %s, %s, %s, %s, %s, cde.current_app_user())""",
            [tid, project_id, body.code, version, body.name, Jsonb(body.definition.model_dump(mode="json"))])
        security_event(conn, "WORKFLOW_TEMPLATE_SAVED", user_id=c.user_id, project_id=project_id, ip=c.ip,
                       template=tid, code=body.code, version=version)
        return conn.execute(f"SELECT {TEMPLATE_COLS} FROM cde.workflow_templates WHERE id = %s", [tid]).fetchone()


@router.patch("/workflow-templates/{template_id}")
def update_template(template_id: uuid.UUID, body: TemplatePatch, c: Ctx = Depends(ctx)):
    changes = body.model_dump(exclude_unset=True)
    with c.tx() as conn:
        t = conn.execute("SELECT project_id FROM cde.workflow_templates WHERE id = %s", [template_id]).fetchone()
        if t is None:
            raise not_found("Template")
        require_project(conn, t["project_id"], "ADMIN", "PROJECT")
        if changes:
            conn.execute("UPDATE cde.workflow_templates SET " + ", ".join(f"{k} = %({k})s" for k in changes)
                         + " WHERE id = %(_key)s", {**changes, "_key": template_id})
        return conn.execute(f"SELECT {TEMPLATE_COLS} FROM cde.workflow_templates WHERE id = %s", [template_id]).fetchone()


# ---------------------------------------------------------------------
# Istanze e compiti
# ---------------------------------------------------------------------
INSTANCE_SQL = """
    SELECT i.id, i.project_id, i.document_id, i.revision_id, i.status, i.current_step, i.started_at, i.finished_at,
           i.final_revision_id, i.outcome_comment, t.name AS template_name, t.version AS template_version,
           jsonb_array_length(t.definition -> 'steps') AS step_count, d.identifier, d.title,
           r.revision_code, u.first_name || ' ' || u.last_name AS started_by_name, i.started_by
    FROM cde.workflow_instances i
    JOIN cde.workflow_templates t ON t.id = i.template_id
    JOIN cde.documents d ON d.id = i.document_id
    JOIN cde.document_revisions r ON r.id = i.revision_id
    LEFT JOIN cde.users u ON u.id = i.started_by"""


def _instance(conn, instance_id: uuid.UUID) -> dict:
    inst = conn.execute(INSTANCE_SQL + " WHERE i.id = %s", [instance_id]).fetchone()
    if inst is None:
        raise not_found("Workflow")
    steps = conn.execute("SELECT id, step_index, name, required, status, activated_at, due_at, completed_at "
                         "FROM cde.workflow_step_runs WHERE instance_id = %s ORDER BY step_index", [instance_id]).fetchall()
    tasks = conn.execute(
        """SELECT k.id, k.step_run_id, k.assignee_id, k.status, k.outcome, k.comment, k.due_at, k.completed_at,
                  u.first_name || ' ' || u.last_name AS assignee_name
           FROM cde.tasks k LEFT JOIN cde.users u ON u.id = k.assignee_id
           WHERE k.instance_id = %s ORDER BY k.created_at""", [instance_id]).fetchall()
    for s in steps:
        s["tasks"] = [t for t in tasks if t["step_run_id"] == s["id"]]
    return {**inst, "steps": steps}


@router.post("/revisions/{revision_id}/workflows", status_code=201)
def start_workflow(revision_id: uuid.UUID, body: StartIn, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        iid = conn.execute("SELECT cde.workflow_start(%s, %s, %s) AS id",
                           [body.template_id, revision_id, body.comment]).fetchone()["id"]
        inst = _instance(conn, iid)
        security_event(conn, "WORKFLOW_STARTED", user_id=c.user_id, project_id=inst["project_id"], ip=c.ip,
                       instance=iid, revision=revision_id)
        return inst


@router.get("/workflows/{instance_id}")
def get_workflow(instance_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        return _instance(conn, instance_id)


@router.post("/workflows/{instance_id}/cancel")
def cancel_workflow(instance_id: uuid.UUID, body: CancelIn, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        conn.execute("SELECT cde.workflow_cancel(%s, %s)", [instance_id, body.reason])
        return _instance(conn, instance_id)


@router.get("/documents/{document_id}/workflows")
def document_workflows(document_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        return conn.execute(INSTANCE_SQL + " WHERE i.document_id = %s ORDER BY i.started_at DESC", [document_id]).fetchall()


@router.get("/me/tasks")
def my_tasks(status: Literal["OPEN", "DONE", "ALL"] = "OPEN", limit: int = Query(default=100, le=500),
             c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        return conn.execute(
            """SELECT k.id, k.status, k.outcome, k.comment, k.due_at, k.created_at, k.completed_at, k.instance_id,
                      s.name AS step_name, s.step_index, i.status AS workflow_status, i.project_id, i.revision_id,
                      i.document_id, d.identifier, d.title, r.revision_code, r.suitability, r.state,
                      t.name AS template_name, p.code AS project_code,
                      (k.due_at IS NOT NULL AND k.due_at < now() AND k.status = 'OPEN') AS overdue
               FROM cde.tasks k
               JOIN cde.workflow_step_runs s ON s.id = k.step_run_id
               JOIN cde.workflow_instances i ON i.id = k.instance_id
               JOIN cde.workflow_templates t ON t.id = i.template_id
               JOIN cde.documents d ON d.id = i.document_id
               JOIN cde.document_revisions r ON r.id = i.revision_id
               JOIN cde.projects p ON p.id = i.project_id
               WHERE k.assignee_id = cde.current_app_user()"""
            + ("" if status == "ALL" else " AND k.status = %(s)s")
            + " ORDER BY k.due_at NULLS LAST, k.created_at LIMIT %(l)s", {"s": status, "l": limit}).fetchall()


@router.post("/tasks/{task_id}/complete")
def complete_task(task_id: uuid.UUID, body: CompleteIn, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        status = conn.execute("SELECT cde.workflow_complete_task(%s, %s, %s)::text AS s",
                              [task_id, body.outcome, body.comment]).fetchone()["s"]
        task = conn.execute("SELECT instance_id, project_id FROM cde.tasks WHERE id = %s", [task_id]).fetchone()
        if task is None:
            raise ApiError(500, "internal", "Compito non rileggibile")
        security_event(conn, "TASK_COMPLETED", user_id=c.user_id, project_id=task["project_id"], ip=c.ip,
                       task=task_id, outcome=body.outcome, workflow_status=status)
        return {"workflow_status": status, "workflow": _instance(conn, task["instance_id"])}
