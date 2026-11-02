# "><(((º> sabusabu <º)))><"
"""Dialogo con le altre app della suite Cosedil (InCampo, Magazzino Operativo).

Rotte ``/suite/...`` riservate alle altre app: le protegge il token di servizio di
``shared/suite/suite_link.py`` (header X-Suite-Token), non il JWT. La chiave comune è
il **codice commessa aziendale**, che per SkyTower sta in ``projects.settings.commessa``
(scheda "Suite" del progetto); in mancanza vale anche il ``code`` ISO del progetto.

Ogni chiamata gira comunque come un utente SkyTower, perché RLS e permessi sono
per utente: quello con l'email dell'utente del portale (header X-Suite-Utente), se
esiste; altrimenti l'utente tecnico ``CDE_SUITE_USER_EMAIL``; altrimenti il primo
platform admin attivo. Chi non vede il progetto non lo trova (404), come sempre.

Offerto:
  * GET  /suite/commesse                         progetti collegati a una commessa
  * GET  /suite/commesse/{codice}/documenti      documenti (default: pubblicati) con link
  * GET  /suite/revisioni/{id}/file              i byte di una revisione (InCampo → planimetria)
  * POST /suite/commesse/{codice}/documenti      carica un file come nuovo documento WIP
    (report giacenze del Magazzino, PDF dei moduli e delle NC di InCampo)
"""
from __future__ import annotations

import base64
import hashlib
import json
import mimetypes
import sys
import uuid
from pathlib import Path
from typing import Literal
from urllib.parse import quote, unquote

from fastapi import APIRouter, Depends, Header, Query, Request
from fastapi.responses import StreamingResponse

from ..deps import Ctx, Services, client_ip, require_container, require_project, services
from ..errors import ApiError
from ..events import security_event
from ..security.tokens import AccessClaims
from . import documents as docs

_SHARED = Path(__file__).resolve().parents[5] / "shared" / "suite"
if str(_SHARED) not in sys.path:
    sys.path.insert(0, str(_SHARED))
import suite_link

router = APIRouter(prefix="/suite", tags=["suite"])
CARTELLA_SUITE = "Suite Cosedil"
CAMPI_DEFAULT = {"volume": "ZZ", "level": "ZZ", "role": "Z"}   # ruolo Z = generale (non disciplinare)


# ---------------------------------------------------------------------
# Accesso: token di servizio + utente che "firma" l'azione
# ---------------------------------------------------------------------
def richiede_token(x_suite_token: str | None = Header(default=None)) -> None:
    if not suite_link.verifica(x_suite_token):
        raise ApiError(403, "suite_token", "Token di servizio della suite non valido")


def _utente(svc: Services, utente: str | None) -> dict:
    """L'utente SkyTower a nome del quale gira la chiamata (vedi docstring del modulo)."""
    candidati = [utente, svc.settings.suite_user_email]
    with svc.db.auth_tx() as conn:
        for email in candidati:
            if not email:
                continue
            email = email.strip()
            row = conn.execute("SELECT id, organization_id, email FROM cde.users WHERE lower(email) = lower(%s) "
                               "AND status = 'ACTIVE'", [email]).fetchone()
            if row is None and "@" not in email:
                row = conn.execute("SELECT id, organization_id, email FROM cde.users WHERE lower(split_part(email, '@', 1)) = lower(%s) "
                                   "AND status = 'ACTIVE' ORDER BY created_at LIMIT 1", [email]).fetchone()
            if row:
                return row
        row = conn.execute("SELECT id, organization_id, email FROM cde.users WHERE is_platform_admin AND status = 'ACTIVE' "
                           "ORDER BY created_at LIMIT 1").fetchone()
    if row is None:
        raise ApiError(403, "suite_user", "Nessun utente SkyTower a cui attribuire l'azione: invitare l'utente del portale "
                                          "oppure impostare CDE_SUITE_USER_EMAIL")
    return row


def ctx_suite(request: Request, svc: Services = Depends(services), _: None = Depends(richiede_token),
              x_suite_utente: str | None = Header(default=None)) -> Ctx:
    u = _utente(svc, x_suite_utente)
    claims = AccessClaims(user_id=u["id"], org_id=u["organization_id"], mfa=True, amr=["suite"], jti=f"suite-{uuid.uuid4()}")
    return Ctx(svc, claims, client_ip(request), request.headers.get("user-agent"))


# ---------------------------------------------------------------------
# Progetto ↔ commessa
# ---------------------------------------------------------------------
def codice_commessa(project: dict) -> str | None:
    s = project.get("settings") or {}
    return (s.get("commessa") or "").strip() or None


def progetto_per_commessa(conn, codice: str) -> dict:
    chiave = suite_link.normalizza_commessa(codice)
    if not chiave:
        raise ApiError(404, "not_found", "Codice commessa vuoto")
    for p in conn.execute("SELECT * FROM cde.projects WHERE status <> 'ARCHIVED' ORDER BY created_at").fetchall():
        if suite_link.normalizza_commessa(codice_commessa(p)) == chiave or suite_link.normalizza_commessa(p["code"]) == chiave:
            return p
    raise ApiError(404, "not_found", f"Nessun progetto SkyTower collegato alla commessa {codice}: "
                                     "il Project Admin lo imposta nella scheda Suite del progetto")


def _url_progetto(c: Ctx, project_id) -> str:
    return f"{c.svc.settings.web_base_url.rstrip('/')}/progetti/{project_id}/cartelle"


def _url_documento(c: Ctx, document_id) -> str:
    return f"{c.svc.settings.web_base_url.rstrip('/')}/documenti/{document_id}"


def _voce_progetto(c: Ctx, p: dict) -> dict:
    return {"project_id": p["id"], "code": p["code"], "name": p["name"], "status": p["status"],
            "commessa": codice_commessa(p) or p["code"], "url": _url_progetto(c, p["id"])}


# ---------------------------------------------------------------------
# Rotte
# ---------------------------------------------------------------------
@router.get("/commesse")
def suite_commesse(c: Ctx = Depends(ctx_suite)):
    """Progetti visibili all'utente, con il codice commessa (solo quelli che ce l'hanno)."""
    with c.tx() as conn:
        rows = conn.execute("SELECT * FROM cde.projects WHERE status <> 'ARCHIVED' ORDER BY code").fetchall()
    return [_voce_progetto(c, p) for p in rows if codice_commessa(p)]


@router.get("/commesse/{codice}/documenti")
def suite_documenti(codice: str, area: Literal["WIP", "SHARED", "PUBLISHED", "ARCHIVED"] | None = "PUBLISHED",
                    q: str | None = Query(default=None, max_length=200), limit: int = Query(default=100, ge=1, le=200),
                    c: Ctx = Depends(ctx_suite)):
    """Documenti della commessa, di default solo quelli PUBBLICATI (ultima revisione), con il nome del file e il link."""
    with c.tx() as conn:
        project = progetto_per_commessa(conn, codice)
        where, params = ["d.project_id = %(p)s"], {"p": project["id"], "limit": limit}
        if area == "ARCHIVED":
            where.append("d.archived_at IS NOT NULL")
        elif area:
            where.append("d.archived_at IS NULL AND lr.state = %(area)s")
            params["area"] = area
        if q:
            where.append("(d.search @@ websearch_to_tsquery('italian', %(q)s) OR d.identifier ILIKE %(like)s)")
            params |= {"q": q, "like": f"%{q.replace('%', '').replace('_', '')}%"}
        rows = conn.execute(docs.DOCUMENT_SQL + " WHERE " + " AND ".join(where)
                            + " ORDER BY d.updated_at DESC LIMIT %(limit)s", params).fetchall()
        ids = [r["current_revision_id"] for r in rows if r["current_revision_id"]]
        file_di = {}
        if ids:
            file_di = {r["id"]: r for r in conn.execute(
                """SELECT r.id, r.original_filename, f.content_type, f.size_bytes FROM cde.document_revisions r
                   JOIN cde.file_objects f ON f.id = r.file_object_id WHERE r.id = ANY(%s)""", [ids]).fetchall()}
    items = []
    for r in rows:
        f = file_di.get(r["current_revision_id"], {})
        items.append({"id": r["id"], "identifier": r["identifier"], "title": r["title"], "description": r["description"],
                      "revision_id": r["current_revision_id"], "revision_code": r["current_revision"],
                      "state": r["current_state"], "suitability": r["current_suitability"],
                      "filename": f.get("original_filename"), "content_type": f.get("content_type"),
                      "size_bytes": f.get("size_bytes"), "updated_at": r["current_revision_at"] or r["updated_at"],
                      "originator": r["originator_code"], "url": _url_documento(c, r["id"])})
    return {"commessa": codice_commessa(project) or project["code"], "project": _voce_progetto(c, project), "items": items}


@router.get("/revisioni/{revision_id}/file")
def suite_file(revision_id: uuid.UUID, c: Ctx = Depends(ctx_suite)):
    """I byte della revisione, con gli stessi controlli del download (permessi, antivirus)."""
    with c.tx() as conn:
        rev = docs._downloadable(conn, revision_id)
        f = conn.execute("SELECT content_type FROM cde.file_objects WHERE id = %s", [rev["file_id"]]).fetchone()
        security_event(conn, "REVISION_DOWNLOADED", user_id=c.user_id, project_id=rev["project_id"], ip=c.ip,
                       revision=revision_id, suite=True)
    tipo = (f and f["content_type"]) or mimetypes.guess_type(rev["original_filename"])[0] or "application/octet-stream"
    corpo = c.svc.storage.iter_object(rev["storage_key"], rev["storage_version_id"])
    return StreamingResponse(corpo, media_type=tipo, headers={
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(rev['original_filename'])}",
        "Content-Length": str(rev["size_bytes"]), "X-Revision-Code": rev["revision_code"]})


def _cartella(conn, c: Ctx, project: dict, container_id: uuid.UUID | None, nome: str) -> dict:
    """La cartella di destinazione: quella indicata, oppure "Suite Cosedil" della propria organizzazione (creata se manca)."""
    if container_id:
        cont = require_container(conn, container_id, "WRITE")
        if cont["project_id"] != project["id"]:
            raise ApiError(404, "not_found", "Cartella non trovata in questo progetto")
        return cont
    rows = conn.execute("""SELECT c.*, cde.my_container_actions(c.id)::text[] AS my_actions FROM cde.containers c
                           WHERE c.project_id = %s AND c.parent_id IS NULL AND c.name = %s
                           AND c.owner_organization_id = cde.current_app_org()""", [project["id"], nome]).fetchall()
    for r in rows:
        if "WRITE" in r["my_actions"]:
            return r
    require_project(conn, project["id"], "WRITE", None)
    cid = uuid.uuid4()
    conn.execute("""INSERT INTO cde.containers (id, project_id, parent_id, owner_organization_id, name, inherit_permissions,
                                                is_private, created_by)
                    VALUES (%s, %s, NULL, cde.current_app_org(), %s, true, false, cde.current_app_user())""",
                 [cid, project["id"], nome])
    security_event(conn, "CONTAINER_CREATED", user_id=c.user_id, project_id=project["id"], ip=c.ip, container=cid, name=nome, suite=True)
    return require_container(conn, cid, "WRITE")


def _nome_manuale(conn, project: dict, filename: str, tipo: str, container_id: uuid.UUID) -> str:
    """Senza rinomina automatica: compone un nome a norma con lo schema della cartella e il primo progressivo libero."""
    scheme, _, _ = docs.load_naming(conn, project, container_id=container_id)
    chiavi = {f.key for f in scheme.fields if f.kind != "fixed"}
    values = {k: v for k, v in CAMPI_DEFAULT.items() if k in chiavi}
    if "type" in chiavi:
        values["type"] = tipo
    if "originator" in chiavi:
        values["originator"] = docs._my_org_code(conn)
    ext = docs._extension(filename)
    campo_numero = next((f for f in scheme.fields if f.key == "number"), None)
    if campo_numero is None:
        raise ApiError(422, "naming", "Lo schema di naming del progetto non ha un campo progressivo: attivare la rinomina "
                                      "automatica (Project Admin → Naming) per ricevere documenti dalla suite")
    for n in range(1, 10 ** campo_numero.max_length):
        values["number"] = str(n).zfill(campo_numero.min_length)
        nome = scheme.compose(values, ext)
        result, _ = docs.check_name(conn, project, nome, container_id=container_id)
        if not result.valid:
            raise ApiError(422, "naming", "Nome non componibile con lo schema del progetto: "
                                          + "; ".join(f"{e.label}: {e.message}" for e in result.errors)
                                          + ". Attivare la rinomina automatica (Project Admin → Naming)")
        preso = conn.execute("SELECT cde.document_identifier_taken(%s, %s) AS t", [project["id"], result.identifier]).fetchone()["t"]
        if not preso and not docs._reserved_elsewhere(conn, project["id"], result.identifier):
            return nome
    raise ApiError(409, "numbering_exhausted", "Progressivi esauriti")


@router.post("/commesse/{codice}/documenti", status_code=201)
async def suite_carica(codice: str, request: Request, title: str = Query(..., min_length=1, max_length=300),
                       description: str | None = Query(default=None, max_length=4000), tipo: str = Query(default="RP", max_length=2),
                       attributes: str | None = Query(default=None), cartella: str = Query(default=CARTELLA_SUITE, max_length=120),
                       container_id: uuid.UUID | None = Query(default=None), filename: str | None = Query(default=None, max_length=255),
                       x_suite_nome_file: str | None = Header(default=None), c: Ctx = Depends(ctx_suite)):
    """Un file dalla suite diventa un documento WIP del progetto: nome a norma (rinomina automatica se attiva,
    altrimenti primo progressivo libero), cartella "Suite Cosedil" dell'organizzazione di chi carica.
    Il file è il corpo della richiesta (Content-Type = tipo del file), il nome nell'header X-Suite-Nome-File
    o in ?filename=; i metadati nella query. Niente multipart: nessuna dipendenza in più."""
    dati = await request.body()
    if not dati:
        raise ApiError(422, "empty_file", "File vuoto")
    nome_file = (filename or unquote(x_suite_nome_file or "") or "documento.pdf").strip()
    ctype = request.headers.get("content-type", "").split(";")[0].strip() or mimetypes.guess_type(nome_file)[0] or "application/octet-stream"
    settings = c.svc.settings
    if len(dati) > settings.upload_max_bytes:
        raise ApiError(413, "too_large", "File oltre il limite")
    try:
        attr = json.loads(attributes) if attributes else {}
    except ValueError:
        raise ApiError(422, "attributes", "attributes deve essere un oggetto JSON") from None
    if not isinstance(attr, dict):
        raise ApiError(422, "attributes", "attributes deve essere un oggetto JSON")
    attr.setdefault("origine_suite", request.headers.get(suite_link.HEADER_UTENTE) or "suite")
    tipo = (tipo or "RP").strip().upper()[:2]
    sha = hashlib.sha256(dati).hexdigest()

    with c.tx() as conn:
        project = progetto_per_commessa(conn, codice)
        cont = _cartella(conn, c, project, container_id, (cartella or CARTELLA_SUITE).strip()[:120])
    base = {"container_id": cont["id"], "size_bytes": len(dati), "sha256": sha, "content_type": ctype, "title": title,
            "description": description, "attributes": attr, "comment": "Caricato dalla suite Cosedil"}
    try:
        avvio = docs.initiate_upload(docs.UploadInitIn(filename=nome_file, auto_name=docs.AutoNameIn(fields={**CAMPI_DEFAULT, "type": tipo}),
                                                       **base), c)
    except ApiError as e:
        if e.code != "auto_number_off":
            raise
        with c.tx() as conn:
            project = progetto_per_commessa(conn, codice)
            nome = _nome_manuale(conn, project, nome_file, tipo, cont["id"])
        avvio = docs.initiate_upload(docs.UploadInitIn(filename=nome, **base), c)

    # Le parti vanno su S3 direttamente dal server (niente URL firmati: siamo già qui).
    with c.tx() as conn:
        s = docs._session(conn, avvio["upload_id"])
    storage = c.svc.storage
    part_size = s["part_size"]
    for n in range(s["part_count"]):
        pezzo = dati[n * part_size:(n + 1) * part_size]
        storage.client.upload_part(Bucket=storage.bucket, Key=s["storage_key"], UploadId=s["s3_upload_id"], PartNumber=n + 1,
                                   Body=pezzo, ChecksumSHA256=base64.b64encode(hashlib.sha256(pezzo).digest()).decode(),
                                   ChecksumAlgorithm="SHA256")
    rev = docs.complete_upload(avvio["upload_id"], c)
    return {"document_id": rev["document_id"], "revision_id": rev["id"], "identifier": avvio["identifier"],
            "filename": avvio["filename"], "revision_code": rev["revision_code"], "state": rev["state"],
            "container_id": cont["id"], "project_id": project["id"], "url": _url_documento(c, rev["document_id"])}
