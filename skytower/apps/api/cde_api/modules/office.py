# "><(((º> sabusabu <º)))><"
"""Modifica in piattaforma di Word, Excel e PowerPoint con OnlyOffice Docs (ADR-37).

L'editor gira nel Document Server; il CDE gli dà il file e riceve il risultato:

  GET  /office/config                      attiva? e indirizzo del Document Server (per il frontend)
  POST /revisions/{id}/office-session      configurazione firmata dell'editor (solo WIP corrente, permesso WRITE)
  GET  /office/files/{id}?ticket=…         il file della revisione per il Document Server (ticket di 5')
  POST /office/callback/{id}               stato della sessione dal Document Server; a modifiche finite il file
                                           salvato diventa la WIP successiva (P01.02 → P01.03), firmata dall'utente

Chiave del documento = id della revisione: chi apre la stessa revisione modifica insieme agli altri (co-editing);
ogni salvataggio crea una revisione nuova, quindi una chiave nuova. La callback non ha sessione utente: vale solo
con il JWT del segreto condiviso, e la revisione nasce con i permessi (RLS) dell'ultimo utente che ha modificato.
Il file salvato si scarica solo dal Document Server configurato (niente SSRF verso altri indirizzi).
"""
from __future__ import annotations

import hashlib
import logging
import tempfile
import uuid
from pathlib import Path
from urllib.parse import quote, urlsplit

import httpx
import jwt
from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from psycopg.types.json import Jsonb
from starlette.concurrency import run_in_threadpool

from ..config import Settings
from ..deps import Ctx, Services, ctx, require_container, services
from ..errors import ApiError, not_found, unauthorized
from ..events import security_event
from .documents import _downloadable, _latest_revision, _next_wip, _revision

log = logging.getLogger("cde.office")
router = APIRouter(tags=["office"])

KINDS = {".docx": ("word", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
         ".xlsx": ("cell", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
         ".pptx": ("slide", "application/vnd.openxmlformats-officedocument.presentationml.presentation")}
SAVE_STATUSES = (2, 6)               # 2: tutti hanno chiuso, documento da salvare; 6: salvataggio forzato


def enabled(settings: Settings) -> bool:
    return bool(settings.onlyoffice_url and settings.onlyoffice_jwt_secret)


def _kind(filename: str) -> tuple[str, str, str] | None:
    ext = Path(filename.lower()).suffix
    return (ext[1:], *KINDS[ext]) if ext in KINDS else None


def _callback_base(settings: Settings) -> str:
    return (settings.onlyoffice_callback_url or f"{settings.web_base_url}{settings.public_api_prefix}").rstrip("/")


@router.get("/office/config")
def office_config(c: Ctx = Depends(ctx)):
    s = c.svc.settings
    return {"enabled": enabled(s), "document_server_url": s.onlyoffice_url.rstrip("/") if enabled(s) else None}


@router.post("/revisions/{revision_id}/office-session")
def office_session(revision_id: uuid.UUID, c: Ctx = Depends(ctx)):
    s = c.svc.settings
    if not enabled(s):
        raise ApiError(404, "office_disabled", "Modifica in piattaforma non attiva in questa installazione")
    with c.tx() as conn:
        rev = _downloadable(conn, revision_id)
        kind = _kind(rev["original_filename"])
        if kind is None:
            raise ApiError(415, "not_editable", "Si modificano in piattaforma solo file Word, Excel e PowerPoint")
        doc = conn.execute("SELECT r.document_id, d.archived_at FROM cde.document_revisions r "
                           "JOIN cde.documents d ON d.id = r.document_id WHERE r.id = %s", [revision_id]).fetchone()
        latest = conn.execute("SELECT id FROM cde.document_revisions WHERE document_id = %s ORDER BY sequence DESC "
                              "LIMIT 1", [doc["document_id"]]).fetchone()
        if doc["archived_at"] or latest["id"] != revision_id or rev["state"] != "WIP":
            raise ApiError(409, "not_current_wip", "Si modifica solo l'ultima revisione, in WIP")
        require_container(conn, rev["container_id"], "WRITE")
        conn.execute("SELECT cde.assert_not_in_review(%s)", [doc["document_id"]])          # 423 se in revisione
        me = conn.execute("SELECT first_name || ' ' || last_name AS name FROM cde.users WHERE id = %s",
                          [c.user_id]).fetchone()
        security_event(conn, "OFFICE_EDIT_OPENED", user_id=c.user_id, project_id=rev["project_id"], ip=c.ip,
                       revision=revision_id)
    if rev["size_bytes"] > s.office_edit_max_bytes:
        raise ApiError(413, "too_large", f"File oltre {s.office_edit_max_bytes // 1024 ** 2} MB: modificarlo in locale")
    ext, document_type, _ = kind
    base = _callback_base(s)
    ticket = c.svc.tokens.issue_download_ticket(c.user_id, revision_id, inline=False)
    config = {
        "documentType": document_type,
        "document": {
            "fileType": ext, "key": str(revision_id), "title": rev["original_filename"],
            "url": f"{base}/office/files/{revision_id}?ticket={ticket}",
            "permissions": {"edit": True, "download": True, "print": True, "comment": True, "review": True},
        },
        "editorConfig": {
            "callbackUrl": f"{base}/office/callback/{revision_id}",
            "lang": "it", "region": "it-IT", "mode": "edit",
            "user": {"id": str(c.user_id), "name": me["name"]},
            "customization": {"forcesave": False, "autosave": True, "compactHeader": True},
        },
    }
    config["token"] = jwt.encode(config, s.onlyoffice_jwt_secret, algorithm="HS256")
    return {"document_server_url": s.onlyoffice_url.rstrip("/"), "config": config,
            "revision_code": rev["revision_code"], "identifier": rev["identifier"]}


@router.get("/office/files/{revision_id}")
def office_file(revision_id: uuid.UUID, ticket: str, svc: Services = Depends(services)):
    """Il file per il Document Server: il ticket è quello emesso con la sessione, per quell'utente e revisione."""
    try:
        user_id, ticket_revision, _ = svc.tokens.decode_download_ticket(ticket)
    except jwt.InvalidTokenError:
        raise unauthorized("Link scaduto: riaprire l'editor") from None
    if ticket_revision != revision_id:
        raise unauthorized("Link non valido")
    with svc.db.app_tx(user_id) as conn:
        rev = _downloadable(conn, revision_id)
    return StreamingResponse(svc.storage.iter_object(rev["storage_key"], rev["storage_version_id"]),
                             media_type="application/octet-stream", headers={
                                 "Content-Disposition": f"attachment; filename*=UTF-8''{quote(rev['original_filename'])}",
                                 "Cache-Control": "private, no-store"})


def _verified(request_body: dict, authorization: str | None, secret: str) -> dict:
    """Dati della callback verificati con il segreto condiviso: token nel corpo o nell'intestazione."""
    token = request_body.get("token")
    if not token and authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:]
    if not token:
        raise unauthorized("Callback senza firma")
    try:
        data = jwt.decode(token, secret, algorithms=["HS256"])
    except jwt.InvalidTokenError:
        raise unauthorized("Firma della callback non valida") from None
    return data.get("payload", data)      # nell'intestazione il Document Server avvolge il corpo in "payload"


def _same_origin(url: str, allowed: str) -> bool:
    a, b = urlsplit(url), urlsplit(allowed)
    return (a.scheme, a.hostname, a.port) == (b.scheme, b.hostname, b.port) and a.scheme in ("http", "https")


def _fetch(url: str, limit: int, dest: Path) -> tuple[int, bytes]:
    """Scarica il file salvato dal Document Server: dimensione e SHA-256, con un tetto alla dimensione."""
    digest, size = hashlib.sha256(), 0
    with httpx.stream("GET", url, timeout=60, follow_redirects=False) as res, dest.open("wb") as out:
        res.raise_for_status()
        for chunk in res.iter_bytes(1024 * 1024):
            size += len(chunk)
            if size > limit:
                raise ApiError(413, "too_large", "File salvato oltre il limite")
            digest.update(chunk)
            out.write(chunk)
    return size, digest.digest()


@router.post("/office/callback/{revision_id}")
async def office_callback(revision_id: uuid.UUID, request: Request, svc: Services = Depends(services)):
    s = svc.settings
    if not enabled(s):
        raise not_found("Callback")
    data = _verified(await request.json(), request.headers.get("authorization"), s.onlyoffice_jwt_secret)
    if data.get("key") != str(revision_id):
        raise unauthorized("Chiave del documento non corrispondente")
    status = int(data.get("status", 0))
    if status not in SAVE_STATUSES:
        if status in (3, 7):
            log.warning("OnlyOffice: salvataggio non riuscito per la revisione %s (stato %s)", revision_id, status)
        return {"error": 0}
    url, users = data.get("url") or "", data.get("users") or []
    if not _same_origin(url, s.onlyoffice_internal_url or s.onlyoffice_url):
        log.warning("OnlyOffice: indirizzo del file salvato non ammesso (%s)", urlsplit(url).hostname)
        return {"error": 1}
    try:
        user_id = uuid.UUID(str(users[0]))
    except (IndexError, ValueError):
        return {"error": 1}
    try:
        new_id = await run_in_threadpool(save_edit, svc, revision_id, user_id, url)
    except Exception:                       # noqa: BLE001 - il Document Server ritenta e avvisa chi modifica
        log.exception("OnlyOffice: revisione da %s non salvata", revision_id)
        return {"error": 1}
    log.info("OnlyOffice: revisione %s salvata come %s", revision_id, new_id)
    return {"error": 0}


def save_edit(svc: Services, base_id: uuid.UUID, user_id: uuid.UUID, url: str) -> uuid.UUID | None:
    """Il file modificato diventa la WIP successiva del documento, con i permessi di chi l'ha modificato.
    None se il file è identico all'ultima revisione (callback ripetuta)."""
    s = svc.settings
    with svc.db.app_tx(user_id) as conn:
        base = conn.execute(
            """SELECT r.id, r.document_id, r.project_id, r.revision_code, r.suitability, r.original_filename,
                      d.container_id FROM cde.document_revisions r JOIN cde.documents d ON d.id = r.document_id
               WHERE r.id = %s""", [base_id]).fetchone()
        if base is None:
            raise not_found("Revisione")
        require_container(conn, base["container_id"], "WRITE")
    kind = _kind(base["original_filename"])
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "salvato"
        size, sha = _fetch(url, s.office_edit_max_bytes, path)
        key = f"projects/{base['project_id']}/files/{uuid.uuid4()}"
        with svc.db.app_tx(user_id) as conn:
            last = conn.execute(
                """SELECT f.sha256 FROM cde.document_revisions r JOIN cde.file_objects f ON f.id = r.file_object_id
                   WHERE r.document_id = %s ORDER BY r.sequence DESC LIMIT 1""", [base["document_id"]]).fetchone()
        if last and bytes(last["sha256"]) == sha:
            return None
        version = svc.storage.put_file(key, str(path), kind[2] if kind else "application/octet-stream")
    with svc.db.app_tx(user_id) as conn:
        conn.execute("SELECT cde.assert_not_in_review(%s)", [base["document_id"]])
        latest = _latest_revision(conn, base["document_id"])
        code = _next_wip(conn, base["document_id"])
        comment = f"Modificata in piattaforma (OnlyOffice) a partire dalla {base['revision_code']}"
        if latest["revision_code"] != base["revision_code"]:
            comment += f"; nel frattempo era stata caricata la {latest['revision_code']}"
        file_id, revision_id = uuid.uuid4(), uuid.uuid4()
        conn.execute(
            """INSERT INTO cde.file_objects (id, project_id, storage_key, storage_version_id, size_bytes, content_type,
                   sha256, uploaded_by) VALUES (%s, %s, %s, %s, %s, %s, %s, cde.current_app_user())""",
            [file_id, base["project_id"], key, version, size, kind[2] if kind else "application/octet-stream", sha])
        conn.execute(
            """INSERT INTO cde.document_revisions (id, document_id, project_id, sequence, revision_code, suitability,
                   state, file_object_id, original_filename, comment, created_by)
               VALUES (%s, %s, %s, %s, %s, %s, 'WIP', %s, %s, %s, cde.current_app_user())""",
            [revision_id, base["document_id"], base["project_id"], latest["sequence"] + 1, code, base["suitability"],
             file_id, base["original_filename"], comment])
        conn.execute("SELECT cde.enqueue_job('cde.verify_file', %s)", [Jsonb({"file_id": str(file_id)})])
        security_event(conn, "REVISION_UPLOADED", user_id=user_id, project_id=base["project_id"],
                       document=base["document_id"], revision=revision_id, code=code, size=size, via="onlyoffice")
        _revision(conn, revision_id)
    return revision_id
