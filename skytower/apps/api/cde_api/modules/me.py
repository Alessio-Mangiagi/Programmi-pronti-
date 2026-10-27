# "><(((º> sabusabu <º)))><"
"""Profilo dell'utente corrente e progetti a cui partecipa."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..deps import Ctx, ctx
from ..errors import unauthorized

router = APIRouter(tags=["me"])

USER_COLUMNS = ("u.id, u.organization_id, u.email, u.first_name, u.last_name, u.status, u.is_org_admin, "
                "u.is_platform_admin, u.last_login_at, u.created_at, u.phone, u.job_title, u.locale")


class ProfileIn(BaseModel):
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    phone: str | None = Field(default=None, max_length=30, pattern=r"^(\+?[0-9 ./()-]{5,30})?$")
    job_title: str | None = Field(default=None, max_length=120)


@router.get("/me")
def me(c: Ctx = Depends(ctx)):
    return _me(c)


@router.patch("/me")
def update_me(body: ProfileIn, c: Ctx = Depends(ctx)):
    """Dati anagrafici modificabili dall'utente stesso (email e organizzazione no: le gestisce l'admin)."""
    with c.tx() as conn:
        conn.execute("SELECT cde.update_my_profile(%s, %s, %s, %s)",
                     [body.first_name, body.last_name, body.phone, body.job_title])
    return _me(c)


def _me(c: Ctx) -> dict:
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
