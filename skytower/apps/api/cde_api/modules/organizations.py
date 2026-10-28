# "><(((º> sabusabu <º)))><"
"""Organizzazioni (tenant) e loro utenti. Autorizzazione: RLS + controlli espliciti per 404/403."""
from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, EmailStr, Field

from ..deps import Ctx, ctx
from ..errors import ApiError, forbidden, not_found
from ..events import security_event
from ..security.tokens import new_opaque_token
from .me import USER_COLUMNS

router = APIRouter(prefix="/organizations", tags=["organizations"])

ORG_COLUMNS = "id, legal_name, vat_number, code, status, mfa_required, data_region, created_at, updated_at"


class OrganizationIn(BaseModel):
    legal_name: str = Field(min_length=2, max_length=200)
    vat_number: str | None = Field(default=None, max_length=32)
    code: str = Field(pattern=r"^[A-Z0-9]{3,6}$")
    mfa_required: bool = True


class OrganizationPatch(BaseModel):
    legal_name: str | None = Field(default=None, min_length=2, max_length=200)
    vat_number: str | None = Field(default=None, max_length=32)
    mfa_required: bool | None = None
    status: Literal["ACTIVE", "SUSPENDED", "ARCHIVED"] | None = None


class UserIn(BaseModel):
    email: EmailStr
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    is_org_admin: bool = False


class UserPatch(BaseModel):
    first_name: str | None = Field(default=None, min_length=1, max_length=100)
    last_name: str | None = Field(default=None, min_length=1, max_length=100)
    status: Literal["ACTIVE", "DISABLED"] | None = None
    is_org_admin: bool | None = None


def _get_org(conn, org_id: uuid.UUID) -> dict:
    row = conn.execute(f"SELECT {ORG_COLUMNS} FROM cde.organizations WHERE id = %s", [org_id]).fetchone()
    if row is None:
        raise not_found("Organizzazione")
    return row


def patch_sql(table: str, changes: dict, key: str = "id") -> str:
    return f"UPDATE {table} SET " + ", ".join(f"{k} = %({k})s" for k in changes) + f" WHERE {key} = %(_key)s"


@router.get("")
def list_organizations(c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        return conn.execute(f"SELECT {ORG_COLUMNS} FROM cde.organizations ORDER BY legal_name").fetchall()


@router.get("/lookup/{code}")
def lookup_organization(code: str, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        row = conn.execute("SELECT * FROM cde.lookup_organization(%s)", [code]).fetchone()
    if row is None:
        raise not_found("Organizzazione")
    return row


@router.post("", status_code=201)
def create_organization(body: OrganizationIn, c: Ctx = Depends(ctx)):
    org_id = uuid.uuid4()
    with c.tx() as conn:
        if not conn.execute("SELECT cde.current_app_is_platform_admin() ok").fetchone()["ok"]:
            raise forbidden("Solo il platform admin crea organizzazioni")
        conn.execute(
            "INSERT INTO cde.organizations (id, legal_name, vat_number, code, mfa_required) VALUES (%s,%s,%s,%s,%s)",
            [org_id, body.legal_name, body.vat_number, body.code, body.mfa_required],
        )
        security_event(conn, "ORGANIZATION_CREATED", user_id=c.user_id, organization_id=org_id, ip=c.ip)
        return _get_org(conn, org_id)


@router.get("/{org_id}")
def get_organization(org_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        return _get_org(conn, org_id)


@router.patch("/{org_id}")
def update_organization(org_id: uuid.UUID, body: OrganizationPatch, c: Ctx = Depends(ctx)):
    changes = body.model_dump(exclude_unset=True)
    with c.tx() as conn:
        _get_org(conn, org_id)
        if changes:
            if conn.execute(patch_sql("cde.organizations", changes), {**changes, "_key": org_id}).rowcount == 0:
                raise forbidden()
            security_event(conn, "ORGANIZATION_UPDATED", user_id=c.user_id, organization_id=org_id, ip=c.ip,
                           fields=sorted(changes))
        return _get_org(conn, org_id)


# ---------------------------------------------------------------------
# Utenti dell'organizzazione
# ---------------------------------------------------------------------
@router.get("/{org_id}/users")
def list_users(org_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        _get_org(conn, org_id)
        users = conn.execute(f"SELECT {USER_COLUMNS} FROM cde.users u WHERE u.organization_id = %s "
                             "ORDER BY u.last_name, u.first_name", [org_id]).fetchall()
        if conn.execute("SELECT cde.can_manage_org(%s) ok", [org_id]).fetchone()["ok"]:
            # solo l'admin vede chi ha il secondo fattore (metodi, mai segreti)
            mfa = {r["user_id"]: r for r in conn.execute("SELECT * FROM cde.org_users_mfa(%s)", [org_id]).fetchall()}
            for u in users:
                u["mfa_methods"] = mfa[u["id"]]["methods"] if u["id"] in mfa else []
                u["recovery_codes_left"] = mfa[u["id"]]["recovery_codes_left"] if u["id"] in mfa else 0
        return users


def _send_invitation(c: Ctx, conn, user_id: uuid.UUID, email: str, org_name: str) -> None:
    token, token_hash = new_opaque_token()
    conn.execute(
        """INSERT INTO cde.user_tokens (user_id, purpose, token_hash, expires_at, created_by)
           VALUES (%s, 'INVITATION', %s, %s, cde.current_app_user())""",
        [user_id, token_hash, datetime.now(UTC) + timedelta(hours=c.svc.settings.invitation_ttl_hours)],
    )
    c.svc.mailer.send(
        email, f"Invito al CDE — {org_name}",
        f"Sei stato invitato al Common Data Environment per {org_name}.\n"
        f"Imposta la password: {c.svc.settings.web_base_url}/invito?token={token}\n"
        f"Il link scade tra {c.svc.settings.invitation_ttl_hours} ore.",
    )


@router.post("/{org_id}/users", status_code=201)
def invite_user(org_id: uuid.UUID, body: UserIn, c: Ctx = Depends(ctx)):
    user_id = uuid.uuid4()
    with c.tx() as conn:
        org = _get_org(conn, org_id)
        conn.execute(
            """INSERT INTO cde.users (id, organization_id, email, first_name, last_name, is_org_admin, status)
               VALUES (%s, %s, %s, %s, %s, %s, 'INVITED')""",
            [user_id, org_id, body.email.lower(), body.first_name, body.last_name, body.is_org_admin],
        )
        _send_invitation(c, conn, user_id, body.email.lower(), org["legal_name"])
        security_event(conn, "USER_INVITED", user_id=c.user_id, organization_id=org_id, ip=c.ip, target=user_id)
        return conn.execute(f"SELECT {USER_COLUMNS} FROM cde.users u WHERE u.id = %s", [user_id]).fetchone()


@router.post("/{org_id}/users/{user_id}/invitation", status_code=204)
def resend_invitation(org_id: uuid.UUID, user_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        org = _get_org(conn, org_id)
        user = conn.execute("SELECT id, email, status FROM cde.users WHERE id = %s AND organization_id = %s",
                            [user_id, org_id]).fetchone()
        if user is None:
            raise not_found("Utente")
        if user["status"] != "INVITED":
            raise forbidden("L'utente ha già attivato l'account")
        _send_invitation(c, conn, user_id, user["email"], org["legal_name"])
    return Response(status_code=204)


@router.post("/{org_id}/users/{user_id}/mfa/reset")
def reset_mfa(org_id: uuid.UUID, user_id: uuid.UUID, c: Ctx = Depends(ctx)):
    """Azzera il secondo fattore di chi ha perso telefono o chiave e chiude le sue sessioni."""
    with c.tx() as conn:
        if conn.execute("SELECT 1 FROM cde.users WHERE id = %s AND organization_id = %s",
                        [user_id, org_id]).fetchone() is None:
            raise not_found("Utente")
        removed = conn.execute("SELECT cde.reset_user_mfa(%s) n", [user_id]).fetchone()["n"]
        security_event(conn, "MFA_RESET_BY_ADMIN", user_id=c.user_id, organization_id=org_id, ip=c.ip,
                       target=user_id, factors=removed)
    return {"factors_removed": removed}


@router.patch("/{org_id}/users/{user_id}")
def update_user(org_id: uuid.UUID, user_id: uuid.UUID, body: UserPatch, c: Ctx = Depends(ctx)):
    changes = body.model_dump(exclude_unset=True)
    if user_id == c.user_id and (changes.get("status") == "DISABLED" or changes.get("is_org_admin") is False):
        raise forbidden("Non puoi disabilitare o declassare te stesso")
    with c.tx() as conn:
        target = conn.execute("SELECT is_org_admin, status FROM cde.users WHERE id = %s AND organization_id = %s",
                              [user_id, org_id]).fetchone()
        if target is None:
            raise not_found("Utente")
        demoting = changes.get("is_org_admin") is False or changes.get("status") == "DISABLED"
        if demoting and target["is_org_admin"] and target["status"] == "ACTIVE" and not conn.execute(
                """SELECT EXISTS (SELECT 1 FROM cde.users WHERE organization_id = %s AND id <> %s
                       AND is_org_admin AND status = 'ACTIVE') ok""", [org_id, user_id]).fetchone()["ok"]:
            # l'organizzazione resterebbe senza nessuno che inviti o sblocchi gli utenti
            raise ApiError(409, "last_org_admin", "È l'ultimo amministratore attivo: nominarne prima un altro")
        if changes:
            if conn.execute(patch_sql("cde.users", changes), {**changes, "_key": user_id}).rowcount == 0:
                raise forbidden()
            security_event(conn, "USER_UPDATED", user_id=c.user_id, organization_id=org_id, ip=c.ip,
                           target=user_id, fields=sorted(changes))
        return conn.execute(f"SELECT {USER_COLUMNS} FROM cde.users u WHERE u.id = %s", [user_id]).fetchone()
