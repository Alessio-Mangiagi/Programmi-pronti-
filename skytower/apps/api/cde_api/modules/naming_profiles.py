# "><(((º> sabusabu <º)))><"
"""Naming per cartella: schemi con nome definiti dal Project Admin nella scheda Naming e assegnati alle cartelle
scelte. Una cartella senza schema usa quello della commessa (ADR-30). Con "inherit" lo schema passa anche alle
sottocartelle create dopo nelle sue cartelle (ADR-35).

  GET    /projects/{id}/naming-profiles        schemi, con le cartelle (visibili) a cui sono assegnati
  POST   /projects/{id}/naming-profiles        nuovo schema (senza schema nel corpo: copia quello della commessa)
  PUT    /naming-profiles/{id}                 nome, schema, rinomina automatica, ereditarietà
  DELETE /naming-profiles/{id}                 le sue cartelle tornano allo schema della commessa
  PUT    /naming-profiles/{id}/containers      cartelle a cui si applica: esattamente quelle indicate
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from iso19650 import AutoNumbering, NamingScheme
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field, field_validator

from ..deps import Ctx, ctx, require_project
from ..errors import ApiError, not_found
from ..events import security_event
from .documents import load_auto_number, load_settings

router = APIRouter(tags=["naming"])

PROFILE_SQL = """
    SELECT p.id, p.project_id, p.name, p.naming_scheme, p.auto_number, p.inherit, p.created_at, p.updated_at,
           coalesce(array_agg(c.id ORDER BY c.name) FILTER (WHERE c.id IS NOT NULL), '{}') AS container_ids
    FROM cde.naming_profiles p LEFT JOIN cde.containers c ON c.naming_profile_id = p.id"""


class ProfileIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    naming_scheme: NamingScheme | None = None    # in creazione: None = copia dello schema della commessa
    auto_number: AutoNumbering | None = None
    inherit: bool | None = None                  # None = invariato (in creazione: no)

    @field_validator("name")
    @classmethod
    def _strip(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Nome obbligatorio")
        return v.strip()


class ProfileContainersIn(BaseModel):
    container_ids: list[uuid.UUID] = Field(max_length=2000)


def _out(row: dict) -> dict:
    scheme = NamingScheme.model_validate(row["naming_scheme"])
    return {**row, "example": scheme.example()}


def _profile(conn, profile_id: uuid.UUID) -> dict:
    row = conn.execute(PROFILE_SQL + " WHERE p.id = %s GROUP BY p.id", [profile_id]).fetchone()
    if row is None:
        raise not_found("Schema di naming")
    return row


def _check_auto(scheme: NamingScheme, auto: AutoNumbering | None) -> None:
    if auto is None:
        return
    try:
        scheme.check_auto_numbering(auto)
    except ValueError as exc:
        raise ApiError(422, "invalid_auto_number", str(exc)) from None


def _name_taken(conn, project_id: uuid.UUID, name: str, exclude: uuid.UUID | None = None) -> None:
    if conn.execute("SELECT 1 FROM cde.naming_profiles WHERE project_id = %s AND lower(name) = lower(%s) AND id <> %s",
                    [project_id, name, exclude or uuid.UUID(int=0)]).fetchone():
        raise ApiError(409, "name_taken", f"Esiste già uno schema chiamato «{name}»")


@router.get("/projects/{project_id}/naming-profiles")
def list_profiles(project_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        require_project(conn, project_id)
        rows = conn.execute(PROFILE_SQL + " WHERE p.project_id = %s GROUP BY p.id ORDER BY p.name", [project_id]).fetchall()
        return [_out(r) for r in rows]


@router.post("/projects/{project_id}/naming-profiles", status_code=201)
def create_profile(project_id: uuid.UUID, body: ProfileIn, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        project = require_project(conn, project_id, "ADMIN", "PROJECT")
        _name_taken(conn, project_id, body.name)
        scheme = body.naming_scheme
        auto = body.auto_number
        if scheme is None:                       # parte dallo schema e dalla rinomina della commessa
            scheme, _, _ = load_settings(conn, project)
            auto = auto or load_auto_number(conn, project_id)
        _check_auto(scheme, auto)
        profile_id = uuid.uuid4()
        conn.execute(
            """INSERT INTO cde.naming_profiles (id, project_id, name, naming_scheme, auto_number, inherit, created_by,
                                              updated_by)
               VALUES (%s, %s, %s, %s, %s, %s, cde.current_app_user(), cde.current_app_user())""",
            [profile_id, project_id, body.name, Jsonb(scheme.model_dump()),
             Jsonb(auto.model_dump()) if auto else None, bool(body.inherit)])
        security_event(conn, "NAMING_PROFILE_CREATED", user_id=c.user_id, project_id=project_id, ip=c.ip,
                       profile=profile_id, name=body.name)
        return _out(_profile(conn, profile_id))


@router.put("/naming-profiles/{profile_id}")
def update_profile(profile_id: uuid.UUID, body: ProfileIn, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        current = _profile(conn, profile_id)
        require_project(conn, current["project_id"], "ADMIN", "PROJECT")
        _name_taken(conn, current["project_id"], body.name, exclude=profile_id)
        scheme = body.naming_scheme or NamingScheme.model_validate(current["naming_scheme"])
        _check_auto(scheme, body.auto_number)
        inherit = current["inherit"] if body.inherit is None else body.inherit
        conn.execute(
            """UPDATE cde.naming_profiles SET name = %s, naming_scheme = %s, auto_number = %s, inherit = %s,
                   updated_by = cde.current_app_user(), updated_at = now() WHERE id = %s""",
            [body.name, Jsonb(scheme.model_dump()), Jsonb(body.auto_number.model_dump()) if body.auto_number else None,
             inherit, profile_id])
        security_event(conn, "NAMING_PROFILE_UPDATED", user_id=c.user_id, project_id=current["project_id"], ip=c.ip,
                       profile=profile_id, name=body.name, auto_number=body.auto_number is not None, inherit=inherit)
        return _out(_profile(conn, profile_id))


@router.delete("/naming-profiles/{profile_id}", status_code=204)
def delete_profile(profile_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        current = _profile(conn, profile_id)
        require_project(conn, current["project_id"], "ADMIN", "PROJECT")
        conn.execute("DELETE FROM cde.naming_profiles WHERE id = %s", [profile_id])   # cartelle: ON DELETE SET NULL
        security_event(conn, "NAMING_PROFILE_DELETED", user_id=c.user_id, project_id=current["project_id"], ip=c.ip,
                       profile=profile_id, name=current["name"], containers=len(current["container_ids"]))
    return Response(status_code=204)


@router.put("/naming-profiles/{profile_id}/containers")
def set_profile_containers(profile_id: uuid.UUID, body: ProfileContainersIn, c: Ctx = Depends(ctx)):
    """Lo schema vale esattamente per le cartelle indicate: quelle tolte tornano allo schema della commessa, quelle
    che avevano un altro schema passano a questo. Solo cartelle visibili a chi decide."""
    with c.tx() as conn:
        current = _profile(conn, profile_id)
        project_id = current["project_id"]
        require_project(conn, project_id, "ADMIN", "PROJECT")
        wanted = set(body.container_ids)
        visible = {r["id"] for r in conn.execute("SELECT id FROM cde.containers WHERE project_id = %s AND id = ANY(%s)",
                                                 [project_id, list(wanted)]).fetchall()}
        if wanted - visible:
            raise not_found("Cartella")
        before = set(current["container_ids"])
        for container_id in before - wanted:
            conn.execute("SELECT cde.set_container_naming(%s, NULL)", [container_id])
        for container_id in wanted - before:
            conn.execute("SELECT cde.set_container_naming(%s, %s)", [container_id, profile_id])
        security_event(conn, "NAMING_PROFILE_ASSIGNED", user_id=c.user_id, project_id=project_id, ip=c.ip,
                       profile=profile_id, name=current["name"], added=len(wanted - before), removed=len(before - wanted))
        return _out(_profile(conn, profile_id))
