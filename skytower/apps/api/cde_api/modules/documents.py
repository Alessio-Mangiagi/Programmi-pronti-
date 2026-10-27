# "><(((º> sabusabu <º)))><"
"""Documenti ISO 19650: impostazioni di progetto, validazione nomi, upload multipart presigned,
revisioni immutabili, metadati, ricerca, download.

Flusso di upload:
  1. POST /uploads/initiate          → valida nome/metadati, apre il multipart S3
  2. POST /uploads/{id}/parts        → URL presigned per le parti (15', vincolati al checksum)
  3. PUT diretto browser → S3
  4. POST /uploads/{id}/complete     → chiude il multipart, crea file + documento + revisione,
                                       accoda la verifica (SHA-256, antivirus) nella stessa transazione
"""
from __future__ import annotations

import base64
import binascii
import uuid
from datetime import UTC, datetime, timedelta
from typing import Literal

import jsonschema
from fastapi import APIRouter, Depends, Query, Response
from iso19650 import NamingScheme, ValidationResult, default_scheme, next_wip_revision
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field, field_validator

from ..deps import Ctx, ctx, require_container, require_project
from ..errors import ApiError, forbidden, not_found
from ..events import security_event
from ..storage import Storage, plan_parts

router = APIRouter(tags=["documents"])

Suitability = Literal["S0", "S1", "S2", "S3", "S4", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "B1", "B2", "B3", "CR"]


# ---------------------------------------------------------------------
# Modelli
# ---------------------------------------------------------------------
class DocumentSettingsIn(BaseModel):
    naming_scheme: NamingScheme | None = None
    metadata_schema: dict = Field(default_factory=lambda: {"type": "object", "additionalProperties": True})

    @field_validator("metadata_schema")
    @classmethod
    def _valid_schema(cls, v: dict) -> dict:
        try:
            jsonschema.Draft202012Validator.check_schema(v)
        except jsonschema.SchemaError as exc:
            raise ValueError(f"JSON Schema non valido: {exc.message}") from None
        return v


class NameCheckIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class UploadInitIn(BaseModel):
    container_id: uuid.UUID
    filename: str = Field(min_length=3, max_length=255)
    size_bytes: int = Field(gt=0)
    sha256: str = Field(pattern=r"^[0-9a-fA-F]{64}$")
    content_type: str = Field(default="application/octet-stream", max_length=200)
    title: str | None = Field(default=None, max_length=300)
    description: str | None = Field(default=None, max_length=4000)
    suitability: Literal["S0"] = "S0"          # in WIP sempre S0 (gli altri codici col cambio di stato, Sprint 3)
    comment: str | None = Field(default=None, max_length=2000)
    attributes: dict = Field(default_factory=dict)
    expected_revision: str | None = None       # lock ottimistico: ultima revisione vista dal client


class PartRequest(BaseModel):
    part_number: int = Field(ge=1, le=10_000)
    checksum_sha256: str = Field(description="SHA-256 della parte, base64")

    @field_validator("checksum_sha256")
    @classmethod
    def _b64(cls, v: str) -> str:
        try:
            if len(base64.b64decode(v, validate=True)) != 32:
                raise ValueError
        except (binascii.Error, ValueError):
            raise ValueError("checksum_sha256 deve essere un SHA-256 in base64") from None
        return v


class PartsIn(BaseModel):
    parts: list[PartRequest] = Field(min_length=1, max_length=100)


class DocumentPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    description: str | None = Field(default=None, max_length=4000)
    attributes: dict | None = None


# ---------------------------------------------------------------------
# Impostazioni documentali e naming
# ---------------------------------------------------------------------
def _participant_codes(conn, project_id: uuid.UUID) -> dict[str, str]:
    rows = conn.execute(
        """SELECT o.code, o.legal_name FROM cde.project_organizations po
           JOIN cde.organizations o ON o.id = po.organization_id
           WHERE po.project_id = %s AND po.is_active ORDER BY o.code""", [project_id]).fetchall()
    return {r["code"]: r["legal_name"] for r in rows}


def load_settings(conn, project: dict) -> tuple[NamingScheme, dict, bool]:
    """(schema naming effettivo, JSON Schema metadati, personalizzato?)."""
    row = conn.execute("SELECT naming_scheme, metadata_schema FROM cde.project_document_settings WHERE project_id = %s",
                       [project["id"]]).fetchone()
    if row and row["naming_scheme"]:
        scheme = NamingScheme.model_validate(row["naming_scheme"])
        custom = True
    else:
        scheme = default_scheme(project["code"], _participant_codes(conn, project["id"]))
        custom = False
    metadata_schema = row["metadata_schema"] if row else {"type": "object", "additionalProperties": True}
    return scheme, metadata_schema, custom


def _validate_attributes(schema: dict, attributes: dict) -> None:
    errors = sorted(jsonschema.Draft202012Validator(schema).iter_errors(attributes), key=lambda e: list(e.path))
    if errors:
        detail = "; ".join(f"{'/'.join(map(str, e.path)) or 'attributi'}: {e.message}" for e in errors[:5])
        raise ApiError(422, "invalid_attributes", f"Metadati non conformi allo schema del progetto: {detail}")


def _my_org_code(conn) -> str:
    return conn.execute("SELECT code FROM cde.organizations WHERE id = cde.current_app_org()").fetchone()["code"]


def check_name(conn, project: dict, name: str) -> tuple[ValidationResult, NamingScheme]:
    scheme, _, _ = load_settings(conn, project)
    restrict = {"originator": {_my_org_code(conn)}} if any(f.key == "originator" for f in scheme.fields) else None
    return scheme.validate_name(name, extra_codes=restrict), scheme


@router.get("/projects/{project_id}/document-settings")
def get_document_settings(project_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        project = require_project(conn, project_id)
        scheme, metadata_schema, custom = load_settings(conn, project)
        return {"naming_scheme": scheme.model_dump(), "metadata_schema": metadata_schema, "custom_naming": custom,
                "example": scheme.example()}


@router.put("/projects/{project_id}/document-settings")
def put_document_settings(project_id: uuid.UUID, body: DocumentSettingsIn, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        require_project(conn, project_id, "ADMIN", "PROJECT")
        conn.execute(
            """INSERT INTO cde.project_document_settings (project_id, naming_scheme, metadata_schema, updated_by)
               VALUES (%(p)s, %(n)s, %(m)s, cde.current_app_user())
               ON CONFLICT (project_id) DO UPDATE SET naming_scheme = EXCLUDED.naming_scheme,
                   metadata_schema = EXCLUDED.metadata_schema, updated_by = EXCLUDED.updated_by, updated_at = now()""",
            {"p": project_id, "n": Jsonb(body.naming_scheme.model_dump()) if body.naming_scheme else None,
             "m": Jsonb(body.metadata_schema)},
        )
        security_event(conn, "DOCUMENT_SETTINGS_UPDATED", user_id=c.user_id, project_id=project_id, ip=c.ip,
                       custom_naming=body.naming_scheme is not None)
    return get_document_settings(project_id, c)


@router.post("/projects/{project_id}/naming/validate")
def validate_name(project_id: uuid.UUID, body: NameCheckIn, c: Ctx = Depends(ctx)):
    """Validazione in tempo reale per la UI: esito per campo, suggerimenti e prossima revisione."""
    with c.tx() as conn:
        project = require_project(conn, project_id)
        result, _ = check_name(conn, project, body.name)
        out = result.model_dump()
        if result.valid:
            doc = conn.execute("SELECT id, container_id, archived_at FROM cde.documents "
                               "WHERE project_id = %s AND identifier = %s", [project_id, result.identifier]).fetchone()
            latest = _latest_revision(conn, doc["id"]) if doc else None
            out["existing_document_id"] = doc["id"] if doc else None
            out["existing_container_id"] = doc["container_id"] if doc else None
            out["archived"] = bool(doc and doc["archived_at"])
            out["current_revision"] = latest["revision_code"] if latest else None
            out["next_revision"] = _next_wip(conn, doc["id"]) if doc else next_wip_revision(None)
        return out


# ---------------------------------------------------------------------
# Upload multipart
# ---------------------------------------------------------------------
def _storage(c: Ctx) -> Storage:
    return c.svc.storage


def _session(conn, upload_id: uuid.UUID) -> dict:
    row = conn.execute("SELECT * FROM cde.upload_sessions WHERE id = %s", [upload_id]).fetchone()
    if row is None:
        raise not_found("Sessione di upload")
    return row


def _open_session(conn, upload_id: uuid.UUID) -> dict:
    s = _session(conn, upload_id)
    if s["status"] != "OPEN":
        raise ApiError(409, "upload_closed", "Sessione di upload già chiusa")
    if s["expires_at"] <= datetime.now(UTC):
        raise ApiError(410, "upload_expired", "Sessione di upload scaduta")
    return s


def _latest_revision(conn, document_id: uuid.UUID) -> dict | None:
    return conn.execute("SELECT sequence, revision_code FROM cde.document_revisions WHERE document_id = %s "
                        "ORDER BY sequence DESC LIMIT 1", [document_id]).fetchone()


def _next_wip(conn, document_id: uuid.UUID) -> str:
    """Prossima WIP dall'ultima revisione preliminare (P01.03 → P01.04; P01 condivisa → P02.01)."""
    last_p = conn.execute("SELECT revision_code FROM cde.document_revisions WHERE document_id = %s "
                          "AND revision_code LIKE 'P%%' ORDER BY sequence DESC LIMIT 1", [document_id]).fetchone()
    return next_wip_revision(last_p["revision_code"] if last_p else None)


@router.post("/uploads/initiate", status_code=201)
def initiate_upload(body: UploadInitIn, c: Ctx = Depends(ctx)):
    settings = c.svc.settings
    if body.size_bytes > settings.upload_max_bytes:
        raise ApiError(413, "too_large", f"File oltre il limite di {settings.upload_max_bytes // 1024 ** 3} GB")
    upload_id = uuid.uuid4()
    with c.tx() as conn:
        container = require_container(conn, body.container_id, "WRITE")
        project = require_project(conn, container["project_id"])
        result, _ = check_name(conn, project, body.filename)
        if not result.valid:
            raise ApiError(422, "invalid_name", "; ".join(f"{e.label}: {e.message}" for e in result.errors))

        doc = conn.execute("SELECT id, container_id, originator_organization_id, title, archived_at FROM cde.documents "
                           "WHERE project_id = %s AND identifier = %s", [project["id"], result.identifier]).fetchone()
        if doc and doc["archived_at"]:
            raise ApiError(409, "archived", "Documento archiviato: non accetta nuove revisioni")
        if doc:
            conn.execute("SELECT cde.assert_not_in_review(%s)", [doc["id"]])   # 423 se in revisione
        if doc is None and conn.execute("SELECT cde.document_identifier_taken(%s, %s) AS t",
                                        [project["id"], result.identifier]).fetchone()["t"]:
            # esiste in un container che non vedo: l'identificativo è comunque univoco nel progetto
            raise ApiError(409, "identifier_taken", "Identificativo già usato nel progetto")
        if doc and doc["container_id"] != body.container_id:
            raise ApiError(409, "wrong_container", "Il documento esiste in un altro container: caricare la revisione lì")
        latest = _latest_revision(conn, doc["id"]) if doc else None
        current = latest["revision_code"] if latest else None
        if body.expected_revision is not None and body.expected_revision != current:
            raise ApiError(409, "revision_conflict", f"Nel frattempo è stata caricata la revisione {current}")
        if doc is None and not body.title:
            raise ApiError(422, "title_required", "Titolo obbligatorio per un nuovo documento")

        _, metadata_schema, _ = load_settings(conn, project)
        _validate_attributes(metadata_schema, body.attributes)

        part_size, part_count = plan_parts(body.size_bytes, settings.upload_part_size)
        key = f"projects/{project['id']}/files/{uuid.uuid4()}"
        s3_upload_id = _storage(c).create_multipart(key, body.content_type)
        expires = datetime.now(UTC) + timedelta(hours=settings.upload_session_ttl_hours)
        conn.execute(
            """INSERT INTO cde.upload_sessions (id, project_id, container_id, user_id, filename, identifier,
                   naming_fields, size_bytes, content_type, sha256, storage_key, s3_upload_id, part_size, part_count,
                   metadata, expires_at)
               VALUES (%s, %s, %s, cde.current_app_user(), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            [upload_id, project["id"], body.container_id, body.filename, result.identifier, Jsonb(result.fields),
             body.size_bytes, body.content_type, bytes.fromhex(body.sha256), key, s3_upload_id, part_size, part_count,
             Jsonb({"title": body.title, "description": body.description, "suitability": body.suitability,
                    "comment": body.comment, "attributes": body.attributes, "expected_revision": current}),
             expires],
        )
        next_code = _next_wip(conn, doc["id"]) if doc else next_wip_revision(None)
    return {"upload_id": upload_id, "identifier": result.identifier, "part_size": part_size, "part_count": part_count,
            "expires_at": expires, "document_id": doc["id"] if doc else None, "current_revision": current,
            "next_revision": next_code}


@router.post("/uploads/{upload_id}/parts")
def presign_parts(upload_id: uuid.UUID, body: PartsIn, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        s = _open_session(conn, upload_id)
    urls = []
    for p in body.parts:
        if p.part_number > s["part_count"]:
            raise ApiError(422, "invalid_part", f"Parte {p.part_number} oltre il totale previsto ({s['part_count']})")
        urls.append({"part_number": p.part_number,
                     "url": _storage(c).presign_part(s["storage_key"], s["s3_upload_id"], p.part_number,
                                                     p.checksum_sha256),
                     "headers": {"x-amz-checksum-sha256": p.checksum_sha256}})
    return {"parts": urls, "expires_in": c.svc.settings.presign_ttl_s}


@router.get("/uploads/{upload_id}")
def get_upload(upload_id: uuid.UUID, c: Ctx = Depends(ctx)):
    """Stato per la ripresa di un upload interrotto: parti già presenti su S3."""
    with c.tx() as conn:
        s = _session(conn, upload_id)
    uploaded = (_storage(c).list_parts(s["storage_key"], s["s3_upload_id"]) if s["status"] == "OPEN" else [])
    return {"upload_id": s["id"], "status": s["status"], "filename": s["filename"], "identifier": s["identifier"],
            "size_bytes": s["size_bytes"], "part_size": s["part_size"], "part_count": s["part_count"],
            "expires_at": s["expires_at"], "revision_id": s["revision_id"],
            "uploaded_parts": [{"part_number": p.part_number, "size": p.size} for p in uploaded]}


@router.post("/uploads/{upload_id}/complete")
def complete_upload(upload_id: uuid.UUID, c: Ctx = Depends(ctx)):
    storage = _storage(c)
    with c.tx() as conn:
        s = _open_session(conn, upload_id)
        parts = storage.list_parts(s["storage_key"], s["s3_upload_id"])
        numbers = sorted(p.part_number for p in parts)
        if numbers != list(range(1, s["part_count"] + 1)):
            missing = sorted(set(range(1, s["part_count"] + 1)) - set(numbers))
            raise ApiError(409, "parts_missing", f"Parti mancanti: {missing[:20]}")
        if sum(p.size for p in parts) != s["size_bytes"]:
            raise ApiError(409, "size_mismatch", "La dimensione caricata non corrisponde a quella dichiarata")

        meta = s["metadata"]
        doc = conn.execute("SELECT id FROM cde.documents WHERE project_id = %s AND identifier = %s",
                           [s["project_id"], s["identifier"]]).fetchone()
        latest = _latest_revision(conn, doc["id"]) if doc else None
        current = latest["revision_code"] if latest else None
        if current != meta.get("expected_revision"):
            raise ApiError(409, "revision_conflict", f"Nel frattempo è stata caricata la revisione {current}")

        version_id = storage.complete_multipart(s["storage_key"], s["s3_upload_id"], parts)
        file_id, revision_id = uuid.uuid4(), uuid.uuid4()
        conn.execute(
            """INSERT INTO cde.file_objects (id, project_id, storage_key, storage_version_id, size_bytes, content_type,
                   sha256, uploaded_by) VALUES (%s, %s, %s, %s, %s, %s, %s, cde.current_app_user())""",
            [file_id, s["project_id"], s["storage_key"], version_id, s["size_bytes"], s["content_type"], s["sha256"]],
        )
        if doc is None:
            doc_id = uuid.uuid4()
            conn.execute(
                """INSERT INTO cde.documents (id, project_id, container_id, identifier, naming_fields,
                       originator_organization_id, title, description, attributes, created_by)
                   VALUES (%s, %s, %s, %s, %s, cde.current_app_org(), %s, %s, %s, cde.current_app_user())""",
                [doc_id, s["project_id"], s["container_id"], s["identifier"], Jsonb(s["naming_fields"]),
                 meta["title"], meta.get("description"), Jsonb(meta.get("attributes") or {})],
            )
        else:
            doc_id = doc["id"]
        code = _next_wip(conn, doc_id)
        conn.execute(
            """INSERT INTO cde.document_revisions (id, document_id, project_id, sequence, revision_code, suitability,
                   state, file_object_id, original_filename, comment, created_by)
               VALUES (%s, %s, %s, %s, %s, %s, 'WIP', %s, %s, %s, cde.current_app_user())""",
            [revision_id, doc_id, s["project_id"], (latest["sequence"] + 1) if latest else 1, code,
             meta.get("suitability") or "S0", file_id, s["filename"], meta.get("comment")],
        )
        conn.execute("UPDATE cde.upload_sessions SET status = 'COMPLETED', revision_id = %s, completed_at = now() "
                     "WHERE id = %s", [revision_id, upload_id])
        conn.execute("SELECT cde.enqueue_job('cde.verify_file', %s)", [Jsonb({"file_id": str(file_id)})])
        security_event(conn, "REVISION_UPLOADED", user_id=c.user_id, project_id=s["project_id"], ip=c.ip,
                       document=doc_id, revision=revision_id, code=code, size=s["size_bytes"])
        return _revision(conn, revision_id)


@router.post("/uploads/{upload_id}/abort", status_code=204)
def abort_upload(upload_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        s = _open_session(conn, upload_id)
        conn.execute("UPDATE cde.upload_sessions SET status = 'ABORTED', completed_at = now() WHERE id = %s",
                     [upload_id])
    _storage(c).abort_multipart(s["storage_key"], s["s3_upload_id"])
    return Response(status_code=204)


# ---------------------------------------------------------------------
# Documenti e revisioni
# ---------------------------------------------------------------------
REVISION_SQL = """
    SELECT r.id, r.document_id, r.sequence, r.revision_code, r.suitability, r.state, r.derived_from,
           r.transition_reason, r.original_filename, r.comment,
           r.created_by, r.created_at, u.first_name || ' ' || u.last_name AS created_by_name,
           f.size_bytes, f.content_type, f.scan_status, f.sha256_verified, f.scan_detail,
           encode(f.sha256, 'hex') AS sha256
    FROM cde.document_revisions r
    JOIN cde.file_objects f ON f.id = r.file_object_id
    LEFT JOIN cde.users u ON u.id = r.created_by"""

DOCUMENT_SQL = """
    SELECT d.id, d.project_id, d.container_id, d.identifier, d.naming_fields, d.title, d.description, d.attributes,
           d.originator_organization_id, o.code AS originator_code, d.created_at, d.updated_at,
           d.archived_at, d.archive_reason,
           lr.id AS current_revision_id, lr.revision_code AS current_revision, lr.suitability AS current_suitability,
           lr.state AS current_state, lr.created_at AS current_revision_at, lr.scan_status AS current_scan_status,
           lr.size_bytes AS current_size
    FROM cde.documents d
    JOIN cde.organizations o ON o.id = d.originator_organization_id
    LEFT JOIN LATERAL (
        SELECT r.id, r.revision_code, r.suitability, r.state, r.created_at, f.scan_status, f.size_bytes
        FROM cde.document_revisions r JOIN cde.file_objects f ON f.id = r.file_object_id
        WHERE r.document_id = d.id ORDER BY r.sequence DESC LIMIT 1) lr ON true"""


def _revision(conn, revision_id: uuid.UUID) -> dict:
    row = conn.execute(REVISION_SQL + " WHERE r.id = %s", [revision_id]).fetchone()
    if row is None:
        raise not_found("Revisione")
    return row


def _document(conn, document_id: uuid.UUID) -> dict:
    row = conn.execute(DOCUMENT_SQL + " WHERE d.id = %s", [document_id]).fetchone()
    if row is None:
        raise not_found("Documento")
    return row


@router.get("/projects/{project_id}/documents")
def list_documents(project_id: uuid.UUID, container_id: uuid.UUID | None = None,
                   q: str | None = Query(default=None, max_length=200),
                   area: Literal["WIP", "SHARED", "PUBLISHED", "ARCHIVED"] | None = None,
                   after: str | None = Query(default=None, description="cursore: ultimo identificativo ricevuto"),
                   limit: int = Query(default=50, ge=1, le=200), c: Ctx = Depends(ctx)):
    where, params = ["d.project_id = %(p)s"], {"p": project_id, "limit": limit + 1}
    if container_id:
        where.append("d.container_id = %(c)s")
        params["c"] = container_id
    if q:
        where.append("(d.search @@ websearch_to_tsquery('italian', %(q)s) OR d.identifier ILIKE %(like)s)")
        params |= {"q": q, "like": f"%{q.replace('%', '').replace('_', '')}%"}
    if area == "ARCHIVED":
        where.append("d.archived_at IS NOT NULL")
    elif area:
        where.append("d.archived_at IS NULL AND lr.state = %(area)s")
        params["area"] = area
    if after:
        where.append("d.identifier > %(after)s")
        params["after"] = after
    with c.tx() as conn:
        require_project(conn, project_id)
        rows = conn.execute(DOCUMENT_SQL + " WHERE " + " AND ".join(where)
                            + " ORDER BY d.identifier LIMIT %(limit)s", params).fetchall()
    more = len(rows) > limit
    rows = rows[:limit]
    return {"items": rows, "next_cursor": rows[-1]["identifier"] if more else None}


@router.get("/documents/{document_id}")
def get_document(document_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        doc = _document(conn, document_id)          # visibile se almeno una revisione lo è (RLS)
        actions = conn.execute("SELECT cde.my_container_actions(%s)::text[] a", [doc["container_id"]]).fetchone()["a"]
        revisions = conn.execute(REVISION_SQL + " WHERE r.document_id = %s ORDER BY r.sequence DESC",
                                 [document_id]).fetchall()
        can_download_published = conn.execute(
            "SELECT cde.has_project_permission(cde.current_app_user(), %s, 'DOWNLOAD', NULL)"
            " AND (%s NOT IN (SELECT cde.private_containers()) OR 'DOWNLOAD' = ANY(%s::text[])) ok",
            [doc["project_id"], doc["container_id"], actions]).fetchone()["ok"]
        reviews = [r["id"] for r in conn.execute("SELECT cde.my_review_revisions() AS id").fetchall()]
        return {**doc, "revisions": revisions, "my_actions": actions,
                "can_download_published": can_download_published,
                "review_revision_ids": [r["id"] for r in revisions if r["id"] in reviews]}


@router.patch("/documents/{document_id}")
def update_document(document_id: uuid.UUID, body: DocumentPatch, c: Ctx = Depends(ctx)):
    changes = body.model_dump(exclude_unset=True)
    with c.tx() as conn:
        doc = _document(conn, document_id)
        require_container(conn, doc["container_id"], "WRITE")
        if "attributes" in changes:
            project = require_project(conn, doc["project_id"])
            _, metadata_schema, _ = load_settings(conn, project)
            _validate_attributes(metadata_schema, changes["attributes"] or {})
            changes["attributes"] = Jsonb(changes["attributes"] or {})
        if changes:
            n = conn.execute("UPDATE cde.documents SET " + ", ".join(f"{k} = %({k})s" for k in changes)
                             + " WHERE id = %(_key)s", {**changes, "_key": document_id}).rowcount
            if n == 0:
                raise forbidden("Solo l'organizzazione originatrice modifica i metadati")
        return _document(conn, document_id)


@router.post("/documents/{document_id}/revisions", status_code=201)
def initiate_revision(document_id: uuid.UUID, body: UploadInitIn, c: Ctx = Depends(ctx)):
    """Nuova revisione di un documento esistente: il nome file deve corrispondere all'identificativo."""
    with c.tx() as conn:
        doc = _document(conn, document_id)
    stem = body.filename.rsplit(".", 1)[0] if "." in body.filename else body.filename
    if stem != doc["identifier"]:
        raise ApiError(422, "identifier_mismatch", f"Il nome del file deve essere {doc['identifier']}")
    if body.container_id != doc["container_id"]:
        raise ApiError(409, "wrong_container", "Container diverso da quello del documento")
    return initiate_upload(body, c)


@router.get("/revisions/{revision_id}/download")
def download_revision(revision_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        rev = conn.execute(
            """SELECT r.id, r.original_filename, r.project_id, r.state, d.container_id, f.storage_key,
                      f.storage_version_id, f.scan_status, f.sha256_verified
               FROM cde.document_revisions r JOIN cde.documents d ON d.id = r.document_id
               JOIN cde.file_objects f ON f.id = r.file_object_id WHERE r.id = %s""", [revision_id]).fetchone()
        if rev is None:
            raise not_found("Revisione")
        in_review = conn.execute("SELECT %s IN (SELECT cde.my_review_revisions()) AS r",
                                 [revision_id]).fetchone()["r"]
        if in_review:
            pass                                    # il revisore assegnato può sempre scaricare
        elif rev["state"] in ("WIP", "SHARED") or conn.execute(
                "SELECT %s IN (SELECT cde.private_containers()) p", [rev["container_id"]]).fetchone()["p"]:
            # WIP e SHARED, e ogni stato in un'area riservata: permesso DOWNLOAD sul container (ruolo o grant)
            if "DOWNLOAD" not in conn.execute("SELECT cde.my_container_actions(%s)::text[] a",
                                              [rev["container_id"]]).fetchone()["a"]:
                raise forbidden()
        elif not conn.execute("SELECT cde.has_project_permission(cde.current_app_user(), %s, 'DOWNLOAD', NULL) ok",
                              [rev["project_id"]]).fetchone()["ok"]:
            raise forbidden()   # PUBLISHED: chiunque nel progetto abbia DOWNLOAD in qualsiasi ambito
        if rev["scan_status"] == "PENDING":
            raise ApiError(409, "scan_pending", "Verifica antivirus in corso: riprovare tra poco")
        if rev["scan_status"] != "CLEAN" or not rev["sha256_verified"]:
            raise ApiError(423, "quarantined", "File in quarantena: download non consentito")
        security_event(conn, "REVISION_DOWNLOADED", user_id=c.user_id, project_id=rev["project_id"], ip=c.ip,
                       revision=revision_id)
    ttl = 300
    return {"url": _storage(c).presign_get(rev["storage_key"], rev["storage_version_id"], rev["original_filename"], ttl),
            "expires_in": ttl, "filename": rev["original_filename"]}
