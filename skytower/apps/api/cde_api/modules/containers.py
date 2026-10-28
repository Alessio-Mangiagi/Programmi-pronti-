# "><(((º> sabusabu <º)))><"
"""Container informativi e grant espliciti."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field, model_validator

from ..deps import Ctx, ctx, require_container, require_project
from ..errors import ApiError, not_found
from ..events import security_event

router = APIRouter(tags=["containers"])

GrantAction = Literal["READ", "WRITE", "DOWNLOAD", "APPROVE"]

CONTAINER_SQL = """
    SELECT c.id, c.project_id, c.parent_id, c.owner_organization_id, o.code AS owner_organization_code,
           c.name, c.inherit_permissions, c.is_private, c.naming_profile_id, c.created_by, c.created_at, c.updated_at,
           cde.my_container_actions(c.id)::text[] AS my_actions
    FROM cde.containers c
    JOIN cde.organizations o ON o.id = c.owner_organization_id"""


class ContainerIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    parent_id: uuid.UUID | None = None
    inherit_permissions: bool = True
    is_private: bool = False      # area riservata: solo radice, solo admin (le sottocartelle la ereditano)


class ContainerPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    parent_id: uuid.UUID | None = None
    inherit_permissions: bool | None = None


class GrantIn(BaseModel):
    grantee_type: Literal["USER", "ORGANIZATION"]
    grantee_user_id: uuid.UUID | None = None
    grantee_organization_id: uuid.UUID | None = None
    actions: list[GrantAction] = Field(min_length=1)
    reason: str = Field(min_length=3, max_length=500)
    valid_until: datetime | None = None

    @model_validator(mode="after")
    def _grantee(self):
        if (self.grantee_type == "USER") != (self.grantee_user_id is not None) or \
           (self.grantee_type == "ORGANIZATION") != (self.grantee_organization_id is not None):
            raise ValueError("Indicare esattamente il destinatario coerente con grantee_type")
        return self


def _container(conn, container_id: uuid.UUID) -> dict:
    row = conn.execute(CONTAINER_SQL + " WHERE c.id = %s", [container_id]).fetchone()
    if row is None:
        raise not_found("Container")
    return row


@router.get("/projects/{project_id}/containers")
def list_containers(project_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        require_project(conn, project_id)
        return conn.execute(CONTAINER_SQL + " WHERE c.project_id = %s ORDER BY c.name", [project_id]).fetchall()


@router.post("/projects/{project_id}/containers", status_code=201)
def create_container(project_id: uuid.UUID, body: ContainerIn, c: Ctx = Depends(ctx)):
    container_id = uuid.uuid4()   # niente RETURNING: la policy SELECT non vede la riga nello stesso comando
    with c.tx() as conn:
        require_project(conn, project_id)
        if body.parent_id:
            parent = require_container(conn, body.parent_id, "WRITE")
            if parent["project_id"] != project_id:
                raise not_found("Container padre")
        else:
            require_project(conn, project_id, "WRITE", None)
        conn.execute(
            """INSERT INTO cde.containers (id, project_id, parent_id, owner_organization_id, name,
                                           inherit_permissions, is_private, created_by)
               VALUES (%s, %s, %s, cde.current_app_org(), %s, %s, %s, cde.current_app_user())""",
            [container_id, project_id, body.parent_id, body.name, body.inherit_permissions, body.is_private],
        )
        security_event(conn, "CONTAINER_CREATED", user_id=c.user_id, project_id=project_id, ip=c.ip,
                       container=container_id, name=body.name, private=body.is_private)
        return _container(conn, container_id)


@router.get("/containers/{container_id}")
def get_container(container_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        return _container(conn, container_id)


@router.patch("/containers/{container_id}")
def update_container(container_id: uuid.UUID, body: ContainerPatch, c: Ctx = Depends(ctx)):
    changes = body.model_dump(exclude_unset=True)
    with c.tx() as conn:
        require_container(conn, container_id, "ADMIN")
        if changes.get("parent_id"):
            require_container(conn, changes["parent_id"], "WRITE")
        if changes:
            conn.execute("UPDATE cde.containers SET " + ", ".join(f"{k} = %({k})s" for k in changes)
                         + " WHERE id = %(_key)s", {**changes, "_key": container_id})
            security_event(conn, "CONTAINER_UPDATED", user_id=c.user_id, ip=c.ip, container=container_id,
                           fields=sorted(changes))
        return _container(conn, container_id)


# ---------------------------------------------------------------------
# Grant
# ---------------------------------------------------------------------
GRANTS_SQL = """
    SELECT g.id, g.container_id, g.grantee_type, g.grantee_user_id, g.grantee_organization_id,
           g.actions::text[] AS actions, g.reason, g.valid_from, g.valid_until, g.granted_by, g.created_at,
           g.revoked_at, g.revoked_by,
           coalesce(o.code, uo.code) AS grantee_organization_code,
           CASE WHEN u.id IS NOT NULL THEN u.first_name || ' ' || u.last_name END AS grantee_user_name
    FROM cde.access_grants g
    LEFT JOIN cde.organizations o ON o.id = g.grantee_organization_id
    LEFT JOIN cde.users u ON u.id = g.grantee_user_id
    LEFT JOIN cde.organizations uo ON uo.id = u.organization_id"""


@router.get("/containers/{container_id}/grants")
def list_grants(container_id: uuid.UUID, include_revoked: bool = False, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        require_container(conn, container_id, "READ")
        where = " WHERE g.container_id = %s" + ("" if include_revoked else " AND g.revoked_at IS NULL")
        return conn.execute(GRANTS_SQL + where + " ORDER BY g.created_at DESC", [container_id]).fetchall()


@router.post("/containers/{container_id}/grants", status_code=201)
def create_grant(container_id: uuid.UUID, body: GrantIn, c: Ctx = Depends(ctx)):
    grant_id = uuid.uuid4()
    with c.tx() as conn:
        container = require_container(conn, container_id, "ADMIN")
        conn.execute(
            """INSERT INTO cde.access_grants (id, project_id, container_id, grantee_type, grantee_user_id,
                   grantee_organization_id, actions, reason, valid_until, granted_by)
               VALUES (%s, %s, %s, %s, %s, %s, %s::cde.permission_action[], %s, %s, cde.current_app_user())""",
            [grant_id, container["project_id"], container_id, body.grantee_type, body.grantee_user_id,
             body.grantee_organization_id, sorted(set(body.actions)), body.reason, body.valid_until],
        )
        security_event(conn, "GRANT_CREATED", user_id=c.user_id, project_id=container["project_id"], ip=c.ip,
                       grant=grant_id, container=container_id, grantee_type=body.grantee_type,
                       grantee=body.grantee_user_id or body.grantee_organization_id, actions=sorted(set(body.actions)))
        return conn.execute(GRANTS_SQL + " WHERE g.id = %s", [grant_id]).fetchone()


@router.delete("/containers/{container_id}/grants/{grant_id}", status_code=204)
def revoke_grant(container_id: uuid.UUID, grant_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        container = require_container(conn, container_id, "ADMIN")
        n = conn.execute(
            """UPDATE cde.access_grants SET revoked_at = now(), revoked_by = cde.current_app_user()
               WHERE id = %s AND container_id = %s AND revoked_at IS NULL""",
            [grant_id, container_id],
        ).rowcount
        if n == 0:
            raise ApiError(404, "not_found", "Grant non trovato o già revocato")
        security_event(conn, "GRANT_REVOKED", user_id=c.user_id, project_id=container["project_id"], ip=c.ip,
                       grant=grant_id, container=container_id)
    return Response(status_code=204)
