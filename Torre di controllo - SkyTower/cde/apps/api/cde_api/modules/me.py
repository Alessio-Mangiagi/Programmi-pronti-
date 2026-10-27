# "><(((º> sabusabu <º)))><"
"""Profilo dell'utente corrente e progetti a cui partecipa."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from ..deps import Ctx, ctx
from ..errors import unauthorized

router = APIRouter(tags=["me"])

USER_COLUMNS = ("u.id, u.organization_id, u.email, u.first_name, u.last_name, u.status, u.is_org_admin, "
                "u.is_platform_admin, u.last_login_at, u.created_at")


@router.get("/me")
def me(c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        row = conn.execute(
            f"""SELECT {USER_COLUMNS}, o.legal_name AS organization_name, o.code AS organization_code,
                       o.mfa_required
                FROM cde.users u JOIN cde.organizations o ON o.id = u.organization_id
                WHERE u.id = cde.current_app_user() AND u.status = 'ACTIVE'"""
        ).fetchone()
    if row is None:
        raise unauthorized("Utente non attivo")
    return {**row, "mfa": c.user.mfa, "amr": c.user.amr}


@router.get("/me/projects")
def my_projects(c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        return conn.execute(
            """SELECT p.id, p.code, p.name, p.status, p.owner_organization_id, o.legal_name AS owner_name,
                      coalesce(array_agg(DISTINCT r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS my_roles
               FROM cde.projects p
               JOIN cde.organizations o ON o.id = p.owner_organization_id
               LEFT JOIN cde.project_memberships pm
                      ON pm.project_id = p.id AND pm.user_id = cde.current_app_user()
                     AND (pm.expires_at IS NULL OR pm.expires_at > now())
               LEFT JOIN cde.roles r ON r.id = pm.role_id
               GROUP BY p.id, o.legal_name
               ORDER BY p.name"""
        ).fetchall()
