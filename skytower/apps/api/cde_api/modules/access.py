# "><(((º> sabusabu <º)))><"
"""Aree riservate e richieste di accesso: l'area la vedono (chiusa) tutti i membri della commessa,
ci entra solo chi è admin o ha una richiesta approvata (grant personale, anche a scadenza)."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..deps import Ctx, ctx, require_project
from ..events import security_event

router = APIRouter(tags=["access"])

RequestAction = Literal["READ", "WRITE", "DOWNLOAD", "APPROVE"]

REQUEST_SQL = """
    SELECT ar.id, ar.project_id, ar.container_id,
           coalesce(c.name, (SELECT a.name FROM cde.private_areas(ar.project_id) a WHERE a.id = ar.container_id))
             AS container_name, ar.requester_id,
           u.first_name || ' ' || u.last_name AS requester_name, u.email AS requester_email,
           o.code AS requester_org_code, ar.actions::text[] AS actions, ar.reason, ar.valid_until, ar.status,
           ar.decided_at, d.first_name || ' ' || d.last_name AS decided_by_name, ar.decision_note, ar.created_at,
           ar.container_id IN (SELECT cde.my_containers('ADMIN')) AS can_decide
    FROM cde.access_requests ar
    LEFT JOIN cde.containers c ON c.id = ar.container_id          -- il richiedente non la vede (RLS)
    LEFT JOIN cde.users u ON u.id = ar.requester_id
    LEFT JOIN cde.organizations o ON o.id = u.organization_id
    LEFT JOIN cde.users d ON d.id = ar.decided_by"""


class RequestIn(BaseModel):
    reason: str = Field(min_length=3, max_length=2000)
    actions: list[RequestAction] = Field(default_factory=lambda: ["READ", "DOWNLOAD"], min_length=1)
    valid_until: datetime | None = None


class DecisionIn(BaseModel):
    approve: bool
    note: str | None = Field(default=None, max_length=2000)
    valid_until: datetime | None = None
    actions: list[RequestAction] | None = Field(default=None, min_length=1)


def _request(conn, request_id: uuid.UUID) -> dict:
    return conn.execute(REQUEST_SQL + " WHERE ar.id = %s", [request_id]).fetchone()


@router.get("/projects/{project_id}/private-areas")
def private_areas(project_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        require_project(conn, project_id)
        return conn.execute("SELECT * FROM cde.private_areas(%s)", [project_id]).fetchall()


@router.get("/projects/{project_id}/access-requests")
def list_requests(project_id: uuid.UUID, status: Literal["PENDING", "APPROVED", "REJECTED", "CANCELLED"] | None = None,
                  c: Ctx = Depends(ctx)):
    """Le richieste che l'utente può vedere: le proprie e quelle delle aree che amministra (RLS)."""
    with c.tx() as conn:
        require_project(conn, project_id)
        return conn.execute(REQUEST_SQL + " WHERE ar.project_id = %(p)s" + (" AND ar.status = %(s)s" if status else "")
                            + " ORDER BY (ar.status = 'PENDING') DESC, ar.created_at DESC LIMIT 200",
                            {"p": project_id, "s": status}).fetchall()


@router.post("/containers/{container_id}/access-requests", status_code=201)
def create_request(container_id: uuid.UUID, body: RequestIn, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        rid = conn.execute("SELECT cde.access_request_create(%s, %s, %s::cde.permission_action[], %s) AS id",
                           [container_id, body.reason, body.actions, body.valid_until]).fetchone()["id"]
        req = _request(conn, rid)
        security_event(conn, "ACCESS_REQUESTED", user_id=c.user_id, project_id=req["project_id"], ip=c.ip,
                       container=container_id, request=rid)
        return req


@router.post("/access-requests/{request_id}/decide")
def decide(request_id: uuid.UUID, body: DecisionIn, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        grant_id = conn.execute(
            "SELECT cde.access_request_decide(%s, %s, %s, %s, %s::cde.permission_action[]) AS g",
            [request_id, body.approve, body.note, body.valid_until, body.actions]).fetchone()["g"]
        req = _request(conn, request_id)
        security_event(conn, "ACCESS_GRANTED" if body.approve else "ACCESS_REJECTED", user_id=c.user_id,
                       project_id=req["project_id"], ip=c.ip, request=request_id, grant=grant_id,
                       grantee=req["requester_id"], container=req["container_id"])
        return req


@router.post("/access-requests/{request_id}/cancel")
def cancel(request_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        conn.execute("SELECT cde.access_request_cancel(%s)", [request_id])
        return _request(conn, request_id)
