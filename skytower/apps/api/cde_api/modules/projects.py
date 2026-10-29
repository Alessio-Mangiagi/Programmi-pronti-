# "><(((º> sabusabu <º)))><"
"""Progetti, organizzazioni partecipanti, membri e ruoli (matrice ruolo × azione × scope)."""
from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal

from fastapi import APIRouter, Depends, Response
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from ..deps import ACTIONS, Ctx, ctx, require_project
from ..errors import ApiError, forbidden, not_found
from ..events import security_event
from .organizations import patch_sql

router = APIRouter(prefix="/projects", tags=["projects"])

PartyRole = Literal["APPOINTING_PARTY", "LEAD_APPOINTED_PARTY", "APPOINTED_PARTY", "SUBCONTRACTOR",
                    "CONSULTANT", "OBSERVER"]
Action = Literal["READ", "WRITE", "DOWNLOAD", "APPROVE", "ADMIN"]
Scope = Literal["OWN_ORGANIZATION", "PROJECT"]


class ProjectIn(BaseModel):
    code: str = Field(pattern=r"^[A-Z0-9]{2,6}$")
    name: str = Field(min_length=2, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    start_date: date | None = None
    end_date: date | None = None
    timezone: str = "Europe/Rome"
    # commessa esistente da usare come template (ADR-38): se ne copia la configurazione, non i documenti
    template_id: uuid.UUID | None = None
    with_organizations: bool = False     # anche organizzazioni partecipanti e loro cartelle
    with_members: bool = False           # anche persone e ruoli (richiede le organizzazioni)


class ProjectPatch(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    status: Literal["SETUP", "ACTIVE", "ON_HOLD", "CLOSED", "ARCHIVED"] | None = None
    start_date: date | None = None
    end_date: date | None = None
    timezone: str | None = None
    settings: dict | None = None


class ProjectOrgIn(BaseModel):
    organization_id: uuid.UUID
    party_role: PartyRole


class ProjectOrgPatch(BaseModel):
    party_role: PartyRole | None = None
    is_active: bool | None = None


class MemberIn(BaseModel):
    user_id: uuid.UUID
    role_id: uuid.UUID
    expires_at: datetime | None = None


class PermissionIn(BaseModel):
    action: Action
    scope: Scope


class RoleIn(BaseModel):
    code: str = Field(pattern=r"^[A-Z][A-Z0-9_]{1,40}$")
    name: str = Field(min_length=2, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    permissions: list[PermissionIn] = Field(default_factory=list)


class RolePatch(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    permissions: list[PermissionIn] | None = None


# ---------------------------------------------------------------------
# Progetti
# ---------------------------------------------------------------------
@router.post("", status_code=201)
def create_project(body: ProjectIn, c: Ctx = Depends(ctx)):
    if body.with_members and not body.with_organizations:
        raise ApiError(422, "members_need_organizations", "Le persone si copiano solo insieme alle loro organizzazioni")
    if (body.with_organizations or body.with_members) and body.template_id is None:
        raise ApiError(422, "template_required", "Organizzazioni e persone si copiano solo da una commessa template")
    with c.tx() as conn:
        if conn.execute("SELECT 1 FROM cde.projects WHERE owner_organization_id = cde.current_app_org() AND code = %s",
                        [body.code]).fetchone():
            raise ApiError(409, "code_taken", f"La tua organizzazione ha già una commessa con codice {body.code}")
        args = [body.code, body.name, body.description, body.start_date, body.end_date, body.timezone]
        if body.template_id is None:
            pid = conn.execute("SELECT cde.create_project(%s, %s, %s, %s, %s, %s) AS id", args).fetchone()["id"]
        else:
            if conn.execute("SELECT 1 FROM cde.projects WHERE id = %s", [body.template_id]).fetchone() is None:
                raise not_found("Commessa template")
            pid = conn.execute("SELECT cde.create_project_from_template(%s, %s, %s, %s, %s, %s, %s, %s, %s) AS id",
                               [body.template_id, *args, body.with_organizations, body.with_members]).fetchone()["id"]
        security_event(conn, "PROJECT_CREATED", user_id=c.user_id, project_id=pid, ip=c.ip,
                       template=body.template_id, organizations=body.with_organizations, members=body.with_members)
        return require_project(conn, pid)


@router.get("")
def list_projects(c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        return conn.execute("SELECT * FROM cde.projects ORDER BY name").fetchall()


@router.get("/templates")
def list_templates(c: Ctx = Depends(ctx)):
    """Commesse utilizzabili come template: quelle di cui si è Project Admin, con cosa contengono."""
    with c.tx() as conn:
        return conn.execute(
            """SELECT p.id, p.code, p.name, p.status,
                      (SELECT count(*) FROM cde.containers c WHERE c.project_id = p.id) AS folders,
                      (SELECT count(*) FROM cde.naming_profiles n WHERE n.project_id = p.id) AS naming_profiles,
                      (SELECT count(DISTINCT code) FROM cde.workflow_templates w
                        WHERE w.project_id = p.id AND w.is_active) AS workflows,
                      (SELECT count(*) FROM cde.project_organizations o WHERE o.project_id = p.id) AS organizations
               FROM cde.projects p
               WHERE cde.has_project_permission(cde.current_app_user(), p.id, 'ADMIN', 'PROJECT')
               ORDER BY p.name""").fetchall()


@router.get("/{project_id}")
def get_project(project_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        project = require_project(conn, project_id)
        perms = conn.execute(
            """SELECT a::text AS action,
                      cde.has_project_permission(cde.current_app_user(), %(p)s, a, 'PROJECT') AS project,
                      cde.has_project_permission(cde.current_app_user(), %(p)s, a, 'OWN_ORGANIZATION') AS own
               FROM unnest(enum_range(NULL::cde.permission_action)) a""",
            {"p": project_id},
        ).fetchall()
        return {**project, "my_permissions": {r["action"]: {"PROJECT": r["project"], "OWN_ORGANIZATION": r["own"]}
                                              for r in perms}}


@router.patch("/{project_id}")
def update_project(project_id: uuid.UUID, body: ProjectPatch, c: Ctx = Depends(ctx)):
    changes = body.model_dump(exclude_unset=True)
    if "settings" in changes:
        changes["settings"] = Jsonb(changes["settings"] or {})
    with c.tx() as conn:
        require_project(conn, project_id, "ADMIN", "PROJECT")
        if changes:
            conn.execute(patch_sql("cde.projects", changes), {**changes, "_key": project_id})
            security_event(conn, "PROJECT_UPDATED", user_id=c.user_id, project_id=project_id, ip=c.ip,
                           fields=sorted(changes))
        return require_project(conn, project_id)


# ---------------------------------------------------------------------
# Organizzazioni partecipanti
# ---------------------------------------------------------------------
PROJECT_ORGS_SQL = """
    SELECT po.organization_id, po.party_role, po.is_active, po.joined_at, o.legal_name, o.code,
           (o.id = p.owner_organization_id) AS is_owner
    FROM cde.project_organizations po
    JOIN cde.organizations o ON o.id = po.organization_id
    JOIN cde.projects p ON p.id = po.project_id
    WHERE po.project_id = %s"""


@router.get("/{project_id}/organizations")
def list_project_organizations(project_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        require_project(conn, project_id)
        return conn.execute(PROJECT_ORGS_SQL + " ORDER BY o.legal_name", [project_id]).fetchall()


@router.post("/{project_id}/organizations", status_code=201)
def add_project_organization(project_id: uuid.UUID, body: ProjectOrgIn, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        require_project(conn, project_id, "ADMIN", "PROJECT")
        conn.execute(
            """INSERT INTO cde.project_organizations (project_id, organization_id, party_role, invited_by)
               VALUES (%s, %s, %s, cde.current_app_user())""",
            [project_id, body.organization_id, body.party_role],
        )
        security_event(conn, "PROJECT_ORGANIZATION_ADDED", user_id=c.user_id, project_id=project_id, ip=c.ip,
                       organization=body.organization_id, party_role=body.party_role)
        return conn.execute(PROJECT_ORGS_SQL + " AND po.organization_id = %s",
                            [project_id, body.organization_id]).fetchone()


@router.patch("/{project_id}/organizations/{org_id}")
def update_project_organization(project_id: uuid.UUID, org_id: uuid.UUID, body: ProjectOrgPatch,
                                c: Ctx = Depends(ctx)):
    changes = body.model_dump(exclude_unset=True)
    with c.tx() as conn:
        require_project(conn, project_id, "ADMIN", "PROJECT")
        if changes:
            n = conn.execute(
                "UPDATE cde.project_organizations SET " + ", ".join(f"{k} = %({k})s" for k in changes)
                + " WHERE project_id = %(p)s AND organization_id = %(o)s",
                {**changes, "p": project_id, "o": org_id},
            ).rowcount
            if n == 0:
                raise forbidden("Organizzazione non modificabile (il committente non si modifica)")
            security_event(conn, "PROJECT_ORGANIZATION_UPDATED", user_id=c.user_id, project_id=project_id,
                           ip=c.ip, organization=org_id, fields=sorted(changes))
        row = conn.execute(PROJECT_ORGS_SQL + " AND po.organization_id = %s", [project_id, org_id]).fetchone()
        if row is None:
            raise not_found("Organizzazione del progetto")
        return row


@router.delete("/{project_id}/organizations/{org_id}", status_code=204)
def remove_project_organization(project_id: uuid.UUID, org_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        require_project(conn, project_id, "ADMIN", "PROJECT")
        # rimuovere un'organizzazione con dati o membri la disattiva soltanto (storico preservato)
        in_use = conn.execute(
            """SELECT EXISTS (SELECT 1 FROM cde.containers WHERE project_id = %(p)s AND owner_organization_id = %(o)s)
                   OR EXISTS (SELECT 1 FROM cde.project_memberships pm JOIN cde.users u ON u.id = pm.user_id
                              WHERE pm.project_id = %(p)s AND u.organization_id = %(o)s) AS used""",
            {"p": project_id, "o": org_id},
        ).fetchone()["used"]
        sql = ("UPDATE cde.project_organizations SET is_active = false" if in_use
               else "DELETE FROM cde.project_organizations")
        if conn.execute(sql + " WHERE project_id = %s AND organization_id = %s", [project_id, org_id]).rowcount == 0:
            raise forbidden("Organizzazione non rimovibile")
        security_event(conn, "PROJECT_ORGANIZATION_REMOVED", user_id=c.user_id, project_id=project_id, ip=c.ip,
                       organization=org_id, deactivated_only=in_use)
    return Response(status_code=204)


# ---------------------------------------------------------------------
# Membri
# ---------------------------------------------------------------------
MEMBERS_SQL = """
    SELECT pm.user_id, pm.role_id, pm.granted_at, pm.expires_at, r.code AS role_code, r.name AS role_name,
           u.email, u.first_name, u.last_name, u.status, u.organization_id, o.code AS organization_code,
           o.legal_name AS organization_name
    FROM cde.project_memberships pm
    JOIN cde.roles r ON r.id = pm.role_id
    JOIN cde.users u ON u.id = pm.user_id
    JOIN cde.organizations o ON o.id = u.organization_id
    WHERE pm.project_id = %s"""


@router.get("/{project_id}/members")
def list_members(project_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        require_project(conn, project_id)
        return conn.execute(MEMBERS_SQL + " ORDER BY o.legal_name, u.last_name, r.code", [project_id]).fetchall()


@router.get("/{project_id}/candidates")
def list_candidates(project_id: uuid.UUID, c: Ctx = Depends(ctx)):
    """Utenti attivi delle organizzazioni partecipanti che posso aggiungere al progetto."""
    with c.tx() as conn:
        require_project(conn, project_id, "ADMIN", None)
        return conn.execute(
            """SELECT u.id, u.email, u.first_name, u.last_name, u.organization_id, o.code AS organization_code
               FROM cde.users u
               JOIN cde.project_organizations po ON po.organization_id = u.organization_id
                                                AND po.project_id = %(p)s AND po.is_active
               JOIN cde.organizations o ON o.id = u.organization_id
               WHERE u.status IN ('ACTIVE', 'INVITED')
                 AND (cde.has_project_permission(cde.current_app_user(), %(p)s, 'ADMIN', 'PROJECT')
                      OR u.organization_id = cde.current_app_org())
               ORDER BY o.code, u.last_name""",
            {"p": project_id},
        ).fetchall()


@router.post("/{project_id}/members", status_code=201)
def add_member(project_id: uuid.UUID, body: MemberIn, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        require_project(conn, project_id, "ADMIN", None)
        conn.execute(
            """INSERT INTO cde.project_memberships (project_id, user_id, role_id, granted_by, expires_at)
               VALUES (%s, %s, %s, cde.current_app_user(), %s)""",
            [project_id, body.user_id, body.role_id, body.expires_at],
        )
        security_event(conn, "MEMBER_ADDED", user_id=c.user_id, project_id=project_id, ip=c.ip,
                       target=body.user_id, role=body.role_id)
        return conn.execute(MEMBERS_SQL + " AND pm.user_id = %s AND pm.role_id = %s",
                            [project_id, body.user_id, body.role_id]).fetchone()


@router.delete("/{project_id}/members/{user_id}/{role_id}", status_code=204)
def remove_member(project_id: uuid.UUID, user_id: uuid.UUID, role_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        require_project(conn, project_id, "ADMIN", None)
        if user_id == c.user_id and conn.execute(
            "SELECT code FROM cde.roles WHERE id = %s", [role_id]
        ).fetchone() == {"code": "PROJECT_ADMIN"}:
            remaining = conn.execute(
                """SELECT count(*) n FROM cde.project_memberships pm JOIN cde.roles r ON r.id = pm.role_id
                   WHERE pm.project_id = %s AND r.code = 'PROJECT_ADMIN' AND r.project_id IS NULL""",
                [project_id]).fetchone()["n"]
            if remaining <= 1:
                raise ApiError(409, "last_admin", "Il progetto deve avere almeno un amministratore")
        n = conn.execute("DELETE FROM cde.project_memberships WHERE project_id = %s AND user_id = %s AND role_id = %s",
                         [project_id, user_id, role_id]).rowcount
        if n == 0:
            raise not_found("Membership")
        security_event(conn, "MEMBER_REMOVED", user_id=c.user_id, project_id=project_id, ip=c.ip,
                       target=user_id, role=role_id)
    return Response(status_code=204)


# ---------------------------------------------------------------------
# Ruoli e matrice
# ---------------------------------------------------------------------
ROLES_SQL = """
    SELECT r.id, r.project_id, r.code, r.name, r.description, r.is_system,
           coalesce(json_agg(json_build_object('action', rp.action, 'scope', rp.scope)
                             ORDER BY rp.action, rp.scope) FILTER (WHERE rp.role_id IS NOT NULL), '[]') AS permissions
    FROM cde.roles r
    LEFT JOIN cde.role_permissions rp ON rp.role_id = r.id
    WHERE (r.project_id IS NULL OR r.project_id = %s)"""


def _role(conn, project_id: uuid.UUID, role_id: uuid.UUID) -> dict:
    row = conn.execute(ROLES_SQL + " AND r.id = %s GROUP BY r.id", [project_id, role_id]).fetchone()
    if row is None:
        raise not_found("Ruolo")
    return row


def _replace_permissions(conn, role_id: uuid.UUID, permissions: list[PermissionIn]) -> None:
    conn.execute("DELETE FROM cde.role_permissions WHERE role_id = %s", [role_id])
    unique = {(p.action, p.scope) for p in permissions}
    with conn.cursor() as cur:
        cur.executemany("INSERT INTO cde.role_permissions (role_id, action, scope) VALUES (%s, %s, %s)",
                        [(role_id, a, s) for a, s in sorted(unique)])


@router.get("/{project_id}/roles")
def list_roles(project_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        require_project(conn, project_id)
        return conn.execute(ROLES_SQL + " GROUP BY r.id ORDER BY r.is_system DESC, r.code", [project_id]).fetchall()


@router.get("/{project_id}/permission-matrix")
def permission_matrix(project_id: uuid.UUID, c: Ctx = Depends(ctx)):
    """Matrice per la UI: per ogni ruolo e azione, lo scope concesso (PROJECT ◆ / OWN_ORGANIZATION ●)."""
    with c.tx() as conn:
        require_project(conn, project_id)
        roles = conn.execute(ROLES_SQL + " GROUP BY r.id ORDER BY r.is_system DESC, r.code", [project_id]).fetchall()
    matrix = []
    for r in roles:
        granted = {(p["action"], p["scope"]) for p in r["permissions"]}
        cells = {}
        for a in ACTIONS:
            scopes = [s for s in ("PROJECT", "OWN_ORGANIZATION")
                      if (a, s) in granted or ("ADMIN", s) in granted]
            cells[a] = scopes[0] if scopes else None
        matrix.append({"role_id": r["id"], "code": r["code"], "name": r["name"], "is_system": r["is_system"],
                       "cells": cells})
    return {"actions": list(ACTIONS), "roles": matrix}


@router.post("/{project_id}/roles", status_code=201)
def create_role(project_id: uuid.UUID, body: RoleIn, c: Ctx = Depends(ctx)):
    role_id = uuid.uuid4()
    with c.tx() as conn:
        require_project(conn, project_id, "ADMIN", "PROJECT")
        conn.execute("INSERT INTO cde.roles (id, project_id, code, name, description) VALUES (%s, %s, %s, %s, %s)",
                     [role_id, project_id, body.code, body.name, body.description])
        _replace_permissions(conn, role_id, body.permissions)
        security_event(conn, "ROLE_CREATED", user_id=c.user_id, project_id=project_id, ip=c.ip, role=role_id,
                       permissions=[p.model_dump() for p in body.permissions])
        return _role(conn, project_id, role_id)


@router.patch("/{project_id}/roles/{role_id}")
def update_role(project_id: uuid.UUID, role_id: uuid.UUID, body: RolePatch, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        require_project(conn, project_id, "ADMIN", "PROJECT")
        role = _role(conn, project_id, role_id)
        if role["is_system"]:
            raise forbidden("I ruoli di sistema non sono modificabili")
        changes = body.model_dump(exclude_unset=True, exclude={"permissions"})
        if changes:
            conn.execute(patch_sql("cde.roles", changes), {**changes, "_key": role_id})
        if body.permissions is not None:
            _replace_permissions(conn, role_id, body.permissions)
        security_event(conn, "ROLE_UPDATED", user_id=c.user_id, project_id=project_id, ip=c.ip, role=role_id,
                       permissions=[p.model_dump() for p in body.permissions] if body.permissions is not None else None)
        return _role(conn, project_id, role_id)


@router.delete("/{project_id}/roles/{role_id}", status_code=204)
def delete_role(project_id: uuid.UUID, role_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        require_project(conn, project_id, "ADMIN", "PROJECT")
        if _role(conn, project_id, role_id)["is_system"]:
            raise forbidden("I ruoli di sistema non sono eliminabili")
        if conn.execute("SELECT 1 FROM cde.project_memberships WHERE role_id = %s LIMIT 1", [role_id]).fetchone():
            raise ApiError(409, "role_in_use", "Ruolo assegnato a membri del progetto")
        conn.execute("DELETE FROM cde.roles WHERE id = %s", [role_id])
        security_event(conn, "ROLE_DELETED", user_id=c.user_id, project_id=project_id, ip=c.ip, role=role_id)
    return Response(status_code=204)
