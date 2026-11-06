# "><(((º> sabusabu <º)))><"
"""Dialogo con le altre app della suite Cosedil (InCampo, Magazzino Operativo).

Rotte ``/suite/...`` riservate alle altre app: le protegge il token di servizio di
``shared/suite/suite_link.py`` (header X-Suite-Token), non il JWT. La chiave comune è
il **codice commessa aziendale**, che per SkyTower sta in ``projects.settings.commessa``
(scheda "Suite" del progetto); in mancanza vale anche il ``code`` ISO del progetto.

Ogni chiamata gira comunque come un utente SkyTower, perché RLS e permessi sono
per utente: quello con l'email dell'utente del portale (header X-Suite-Email, oppure
X-Suite-Utente come ``<username>@CDE_SUITE_EMAIL_DOMINIO``), **purché sia un utente attivo
dell'organizzazione della suite e non un platform admin** (ADR-47); altrimenti l'utente
tecnico ``CDE_SUITE_USER_EMAIL`` (stesse regole); altrimenti 403. Il token di servizio è
condiviso fra le app: non deve poter impersonare tutti i tenant. Ogni chiamata lascia un
evento di sicurezza con l'app chiamante (X-Suite-App) e l'utente dichiarato.
Chi non vede il progetto non lo trova (404), come sempre.

Offerto:
  * GET  /suite/commesse                         progetti collegati a una commessa
  * GET  /suite/commesse/{codice}/documenti      documenti (default: pubblicati) con link
  * GET  /suite/revisioni/{id}/file              i byte di una revisione (InCampo → planimetria)
  * POST /suite/commesse/{codice}/documenti      carica un file come nuovo documento WIP
    (report giacenze del Magazzino, PDF dei moduli e delle NC di InCampo)
  * GET  /suite/da-fare                          cosa aspetta l'utente del portale (notifiche, approvazioni)
Per il web di SkyTower (JWT):
  * GET  /suite/registro                         registro unico delle commesse (shared/suite/commesse.json)
  * GET  /suite/requisiti/set                    i set di Verifica Requisiti
  * POST /revisions/{id}/confronta               confronta con la revisione precedente (Confronto Documenti)
  * POST /revisions/{id}/verifica                checklist di Verifica Requisiti sul file
Regole comuni in shared/suite/CONTRATTI.md.
"""
from __future__ import annotations

import base64
import hashlib
import json
import mimetypes
import sys
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Literal
from urllib.parse import quote, unquote

from fastapi import APIRouter, Depends, Header, Query, Request
from fastapi.responses import StreamingResponse
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from ..deps import Ctx, Services, client_ip, ctx, require_container, require_project, services
from ..errors import ApiError
from ..events import security_event
from ..security.tokens import AccessClaims
from ..validation import check_json_size
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


def _utente(svc: Services, utente: str | None, email: str | None = None) -> dict:
    """L'utente SkyTower a nome del quale gira la chiamata (vedi docstring del modulo).

    Candidati, in ordine: l'email del portale (X-Suite-Email); lo username (X-Suite-Utente) come email esatta se
    contiene la ``@``, altrimenti ``<username>@CDE_SUITE_EMAIL_DOMINIO``; l'utente tecnico ``CDE_SUITE_USER_EMAIL``.
    Ognuno vale solo se è attivo, dell'organizzazione della suite e non platform admin (ADR-47): il token è
    condiviso fra le app e chi lo ha non deve poter agire a nome di utenti di altri tenant. Nessun candidato → 403."""
    from .portale import organizzazione_suite

    dominio = svc.settings.suite_email_dominio
    candidati = []
    for chi in (email, utente):
        chi = (chi or "").strip().lower()
        if chi:
            candidati.append(chi if "@" in chi else f"{chi}@{dominio}")
    if svc.settings.suite_user_email:
        candidati.append(svc.settings.suite_user_email.strip().lower())
    with svc.db.auth_tx() as conn:
        org = organizzazione_suite(svc, conn)
        for chi in candidati:
            row = conn.execute("""SELECT id, organization_id, email, is_platform_admin FROM cde.users
                                  WHERE lower(email) = %s AND status = 'ACTIVE'""", [chi]).fetchone()
            if row is None:
                continue
            if row["organization_id"] != org or row["is_platform_admin"]:
                # un utente di un altro tenant (o il platform admin) non si impersona da un'app della suite
                continue
            return row
    raise ApiError(403, "suite_user", "Nessun utente SkyTower dell'organizzazione della suite a cui attribuire l'azione: "
                                      "invitare l'utente del portale oppure impostare CDE_SUITE_USER_EMAIL")


def ctx_suite(request: Request, svc: Services = Depends(services), _: None = Depends(richiede_token),
              x_suite_utente: str | None = Header(default=None), x_suite_email: str | None = Header(default=None),
              x_suite_app: str | None = Header(default=None)) -> Ctx:
    u = _utente(svc, x_suite_utente, x_suite_email)
    ip = client_ip(request)
    with svc.db.auth_tx() as conn:
        # traccia di chi ha usato il token condiviso: app dichiarata, utente dichiarato, rotta (ADR-47)
        security_event(conn, "SUITE_CALL", user_id=u["id"], organization_id=u["organization_id"], ip=ip,
                       app=(x_suite_app or "")[:40] or None, utente=(x_suite_email or x_suite_utente or "")[:120] or None,
                       method=request.method, path=request.url.path[:200])
    claims = AccessClaims(user_id=u["id"], org_id=u["organization_id"], mfa=True, amr=["suite"], jti=f"suite-{uuid.uuid4()}")
    return Ctx(svc, claims, ip, request.headers.get("user-agent"))


# ---------------------------------------------------------------------
# Progetto ↔ commessa
# ---------------------------------------------------------------------
def codice_commessa(project: dict) -> str | None:
    s = project.get("settings") or {}
    return (s.get("commessa") or "").strip() or None


def progetto_per_commessa(conn, codice: str, org_suite: uuid.UUID | None = None) -> dict:
    """Il progetto con quel codice commessa (o codice ISO). A parità, vince quello di proprietà dell'organizzazione
    della suite (``org_suite``): un Project Admin di un altro tenant non può dirottare i documenti della suite
    mettendo lo stesso codice sul proprio progetto (A3)."""
    chiave = suite_link.normalizza_commessa(codice)
    if not chiave:
        raise ApiError(404, "not_found", "Codice commessa vuoto")
    # i modelli di commessa (ADR-52) non ricevono mai documenti dalla suite, nemmeno a parità di codice ISO
    trovati = [p for p in conn.execute("SELECT * FROM cde.projects WHERE status <> 'ARCHIVED' AND NOT is_model "
                                       "ORDER BY created_at").fetchall()
               if suite_link.normalizza_commessa(codice_commessa(p)) == chiave or suite_link.normalizza_commessa(p["code"]) == chiave]
    if trovati:
        if org_suite is not None:
            trovati.sort(key=lambda p: p["owner_organization_id"] != org_suite)
        return trovati[0]
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
        rows = conn.execute("SELECT * FROM cde.projects WHERE status <> 'ARCHIVED' AND NOT is_model ORDER BY code").fetchall()
    return [_voce_progetto(c, p) for p in rows if codice_commessa(p)]


@router.get("/commesse/{codice}/documenti")
def suite_documenti(codice: str, area: Literal["WIP", "SHARED", "PUBLISHED", "ARCHIVED"] | None = "PUBLISHED",
                    q: str | None = Query(default=None, max_length=200), limit: int = Query(default=100, ge=1, le=200),
                    c: Ctx = Depends(ctx_suite)):
    """Documenti della commessa, di default solo quelli PUBBLICATI (ultima revisione), con il nome del file e il link."""
    with c.tx() as conn:
        project = progetto_per_commessa(conn, codice, c.user.org_id)
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
    limite = c.svc.settings.suite_upload_max_bytes
    dati = bytearray()
    async for pezzo in request.stream():           # anche senza Content-Length: ci si ferma al tetto (B12)
        dati += pezzo
        if len(dati) > limite:
            raise ApiError(413, "too_large", f"File oltre {limite // 1024 ** 2} MB: caricarlo da SkyTower")
    dati = bytes(dati)
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
    try:   # stesso tetto dei metadati caricati da SkyTower (revisione di sicurezza del 03/11/2026, B5)
        check_json_size(attr)
    except ValueError as exc:
        raise ApiError(422, "attributes", str(exc)) from None
    docs.rifiuta_attributi_riservati(attr)
    attr.setdefault("origine_suite", request.headers.get(suite_link.HEADER_UTENTE) or "suite")
    tipo = (tipo or "RP").strip().upper()[:2]
    sha = hashlib.sha256(dati).hexdigest()

    with c.tx() as conn:
        project = progetto_per_commessa(conn, codice, c.user.org_id)
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
            project = progetto_per_commessa(conn, codice, c.user.org_id)
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


# ---------------------------------------------------------------------
# Registro commesse e "da fare" (CONTRATTI.md §3-4)
# ---------------------------------------------------------------------
@router.get("/registro")
def suite_registro(solo_attive: bool = True, c: Ctx = Depends(ctx)):
    """Il registro unico delle commesse della suite, per il menu a tendina della scheda Suite Cosedil."""
    return {"commesse": suite_link.commesse(solo_attive=solo_attive)}


def _url_web(c: Ctx, percorso: str) -> str:
    if percorso.startswith("http"):
        return percorso
    return c.svc.settings.web_base_url.rstrip("/") + "/" + percorso.lstrip("/")


def _data_iso(v) -> str | None:
    if isinstance(v, datetime):
        return v.date().isoformat()
    return None


def _voce_compito(c: Ctx, k: dict) -> dict:
    """Un compito aperto come voce del "da fare" del portale (CONTRATTI.md §4).

    Il titolo dice che cosa serve, perché nella home del portale non c'è altro contesto:
    - compito di chiarimento → "Chiarimento: <documento>" e nel testo chi lo chiede, da quale passo, la domanda;
    - giro riaperto da una richiesta di modifiche → "Modifiche richieste: <documento>" con chi le chiede e il commento;
    - compito fermo in attesa di un chiarimento chiesto da chi lo ha → priorità bassa, senza "in ritardo"
      (la scadenza è sospesa finché arriva la risposta);
    - altrimenti "Approvare <documento> <revisione>" (documenti) o "<passo>: <processo>" (processi).
    L'indirizzo apre direttamente il compito nella posta "Compiti" (parametri instance e task di quella pagina).
    """
    oggetto = k["identifier"] if k["processo"] else f"{k['identifier']} {k['revision_code']}"
    da_chi = f"{k['richiesta_da']} (passo «{k['richiesta_dal_passo']}»)" if k["richiesta_da"] else None
    testo_richiesta = (k["richiesta_testo"] or "").strip()
    if len(testo_richiesta) > 120:
        testo_richiesta = testo_richiesta[:119] + "…"
    in_ritardo = k["overdue"] and not k["in_attesa"]
    if k["kind"] == "CLARIFICATION":
        titolo = f"Chiarimento: {oggetto}"
        parti = [f"Chiesto da {da_chi}" if da_chi else "Chiarimento chiesto", k["project_code"], f"«{testo_richiesta}»"]
    elif k["richiesta"] == "CHANGES":
        titolo = f"Modifiche richieste: {oggetto}"
        parti = [k["step_name"], f"chieste da {da_chi}" if da_chi else None, k["project_code"], f"«{testo_richiesta}»"]
    else:
        titolo = f"{k['step_name']}: {k['identifier']}" if k["processo"] else f"Approvare {oggetto}"
        parti = [k["step_name"], k["project_code"], k["title"], "in attesa di chiarimento" if k["in_attesa"] else None]
    if in_ritardo:
        parti.append("in ritardo")
    return {"id": f"compito:{k['id']}", "titolo": titolo, "testo": " · ".join(p for p in parti if p),
            "url": _url_web(c, f"/compiti?instance={k['instance_id']}&task={k['id']}"), "tipo": "documento",
            "priorita": 3 if k["in_attesa"] else 1 if in_ritardo else 2, "data": _data_iso(k["due_at"])}


@router.get("/da-fare")
def suite_da_fare(c: Ctx = Depends(ctx_suite)):
    """Cosa aspetta l'utente del portale in SkyTower: approvazioni assegnate (compiti aperti) e notifiche non lette."""
    voci = []
    with c.tx() as conn:
        compiti = conn.execute(
            # compiti dei nodi del workflow a grafo (0039): su un documento o su un processo (senza documento).
            # Tornare indietro (0042, ADR-51): la richiesta collegata al compito è il chiarimento da dare
            # (k.send_back_id, compito di chiarimento) oppure le modifiche per cui il giro è stato riaperto o va
            # rifatto (s.send_back_id); waiting_send_back_id = il compito aspetta un chiarimento chiesto da chi lo ha.
            """SELECT k.id, k.instance_id, k.due_at, k.kind, s.name AS step_name,
                      coalesce(d.identifier, i.title) AS identifier,
                      coalesce(d.title, i.title) AS title, r.revision_code, p.code AS project_code,
                      i.document_id IS NULL AS processo,
                      (k.due_at IS NOT NULL AND k.due_at < now()) AS overdue,
                      k.waiting_send_back_id IS NOT NULL AS in_attesa,
                      b.kind AS richiesta, b.comment AS richiesta_testo, fr.name AS richiesta_dal_passo,
                      ua.first_name || ' ' || ua.last_name AS richiesta_da
               FROM cde.tasks k JOIN cde.workflow_node_runs s ON s.id = k.node_run_id
               JOIN cde.workflow_instances i ON i.id = k.instance_id LEFT JOIN cde.documents d ON d.id = i.document_id
               LEFT JOIN cde.document_revisions r ON r.id = i.revision_id JOIN cde.projects p ON p.id = i.project_id
               LEFT JOIN cde.workflow_send_backs b ON b.id = coalesce(k.send_back_id, s.send_back_id)
               LEFT JOIN cde.workflow_node_runs fr ON fr.id = b.from_run_id
               LEFT JOIN cde.users ua ON ua.id = b.asked_by
               WHERE k.assignee_id = cde.current_app_user() AND k.status = 'OPEN'
               ORDER BY k.due_at NULLS LAST, k.created_at LIMIT 30""").fetchall()
        notifiche = conn.execute(
            """SELECT id, kind, title, body, link, created_at FROM cde.notifications
               WHERE user_id = cde.current_app_user() AND read_at IS NULL ORDER BY id DESC LIMIT 30""").fetchall()
    for k in compiti:
        voci.append(_voce_compito(c, k))
    # Scadenze superate ed escalation (G35) sono compiti da sollecitare, non semplici avvisi:
    # vanno in cima al "da fare" del portale con la data del compito, come chiede CONTRATTI.md §4.
    URGENTI = {"TASK_OVERDUE", "TASK_ESCALATED", "RFI_OVERDUE"}
    for n in notifiche:
        urgente = n["kind"] in URGENTI
        voci.append({"id": f"notifica:{n['id']}", "titolo": n["title"], "testo": (n["body"] or "")[:200],
                     "url": _url_web(c, n["link"] or "/"), "tipo": "task" if urgente else "avviso",
                     "priorita": 1 if urgente else 3, "data": _data_iso(n["created_at"])})
    voci.sort(key=lambda v: (v["priorita"], v["data"] or "9999"))
    return {"voci": voci[:50]}


# ---------------------------------------------------------------------
# Confronto Documenti e Verifica Requisiti su una revisione (CONTRATTI.md §7)
# ---------------------------------------------------------------------
revisioni = APIRouter(tags=["suite"])


def _errore_suite(e: suite_link.SuiteError) -> ApiError:
    return ApiError(503 if e.stato == 503 else 502, "suite_app", e.messaggio)


def _revisione_scaricabile(conn, revision_id: uuid.UUID) -> tuple[dict, dict]:
    """La revisione (scaricabile dall'utente) con ``sequence`` e ``document_id``, e il documento."""
    rev = docs._downloadable(conn, revision_id)
    riga = conn.execute("SELECT document_id, sequence FROM cde.document_revisions WHERE id = %s", [revision_id]).fetchone()
    doc = conn.execute("SELECT id, project_id, container_id, identifier, title, attributes FROM cde.documents WHERE id = %s",
                       [riga["document_id"]]).fetchone()
    return {**rev, "sequence": riga["sequence"], "document_id": riga["document_id"]}, doc


def _byte_revisione(c: Ctx, rev: dict) -> bytes:
    return c.svc.storage.get_bytes(rev["storage_key"], rev["storage_version_id"])


def _controlla_dimensione(c: Ctx, rev: dict) -> None:
    """Confronto e verifica leggono il file intero in memoria per mandarlo all'altra app: vale lo stesso tetto della
    filigrana (``watermark_max_bytes``), altrimenti un file da gigabyte manda in OOM l'API per tutti (M7)."""
    limite = c.svc.settings.watermark_max_bytes
    if rev["size_bytes"] > limite:
        raise ApiError(413, "too_large", f"File oltre {limite // 1024 ** 2} MB: confronto e verifica si fanno in locale")


def _limite_per_utente(c: Ctx, cosa: str) -> None:
    """Poche chiamate al minuto per utente: ognuna tiene occupato un thread dell'API e l'app vicina."""
    if not c.svc.limiter.hit("10/minute", f"suite-{cosa}", str(c.user_id)):
        raise ApiError(429, "rate_limited", "Troppe richieste: riprovare tra un minuto", {"Retry-After": "60"})


def _multipart_file(campi: dict, file: list[tuple[str, str, bytes, str]]) -> tuple[bytes, str]:
    """multipart/form-data con più file (suite_link._multipart ne accetta uno solo)."""
    confine = "----skytower" + uuid.uuid4().hex
    corpo = bytearray()
    for k, v in campi.items():
        if v is None:
            continue
        corpo += f'--{confine}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n'.encode() + str(v).encode("utf-8") + b"\r\n"
    for campo, nome, dati, ctype in file:
        nome = nome.replace('"', "'")
        corpo += (f'--{confine}\r\nContent-Disposition: form-data; name="{campo}"; filename="{nome}"\r\n'
                  f"Content-Type: {ctype or 'application/octet-stream'}\r\n\r\n").encode() + dati + b"\r\n"
    corpo += f"--{confine}--\r\n".encode()
    return bytes(corpo), f"multipart/form-data; boundary={confine}"


def _aggiungi_attributo(svc: Services, document_id: uuid.UUID, chiave: str, voce: dict) -> None:
    """Appende ``voce`` a ``documents.attributes[chiave]`` fuori da RLS: chi legge il documento può annotarci
    l'esito di un confronto o di una verifica, senza il permesso WRITE e senza lo schema dei metadati."""
    with svc.db.auth_tx() as conn:
        conn.execute("""UPDATE cde.documents SET attributes = attributes || jsonb_build_object(%s::text,
                            coalesce(attributes -> %s::text, '[]'::jsonb) || %s::jsonb) WHERE id = %s""",
                     [chiave, chiave, Jsonb([voce]), document_id])


def _utente_portale(c: Ctx) -> tuple[str, str]:
    with c.tx() as conn:
        u = conn.execute("SELECT email, first_name || ' ' || last_name AS nome FROM cde.users WHERE id = %s", [c.user_id]).fetchone()
    return (u["email"], u["nome"]) if u else ("", "")


def _tipo_file(nome: str) -> str:
    return mimetypes.guess_type(nome)[0] or "application/pdf"


@revisioni.post("/revisions/{revision_id}/confronta", status_code=201)
def confronta_revisione(revision_id: uuid.UUID, c: Ctx = Depends(ctx)):
    """Manda questa revisione e la precedente dello stesso documento a Confronto Documenti; l'esito (job) resta
    nei metadati del documento (``attributes.confronti``) e si apre con ``url``."""
    _limite_per_utente(c, "confronto")
    with c.tx() as conn:
        rev, doc = _revisione_scaricabile(conn, revision_id)
        if rev["sequence"] <= 1:
            raise ApiError(409, "prima_revisione", "È la prima revisione: non c'è niente con cui confrontarla")
        prec_id = conn.execute("SELECT id FROM cde.document_revisions WHERE document_id = %s AND sequence = %s",
                               [rev["document_id"], rev["sequence"] - 1]).fetchone()["id"]
        prec = docs._downloadable(conn, prec_id)
        _controlla_dimensione(c, rev)
        _controlla_dimensione(c, prec)
    corpo, ctype = _multipart_file({}, [("pdf1", prec["original_filename"], _byte_revisione(c, prec), _tipo_file(prec["original_filename"])),
                                        ("pdf2", rev["original_filename"], _byte_revisione(c, rev), _tipo_file(rev["original_filename"]))])
    email, nome = _utente_portale(c)
    try:
        esito = suite_link.chiama("confronto", "POST", "/api/compare", corpo_file=(corpo, ctype, "confronto"),
                                  utente=email, nome=nome, email=email, timeout=60)
    except suite_link.SuiteError as e:
        raise _errore_suite(e) from None
    job = (esito or {}).get("job_id")
    if not job:
        raise ApiError(502, "suite_app", "Confronto Documenti non ha restituito un job")
    voce = {"revision_id": str(revision_id), "revision_code": rev["revision_code"], "precedente": str(prec_id),
            "precedente_code": prec["revision_code"], "job_id": job,
            "url": f"{suite_link.url_pubblico('confronto')}/?job={quote(str(job))}",
            "data": datetime.now().isoformat(timespec="seconds"), "stato": "avviato", "utente": email}
    _aggiungi_attributo(c.svc, doc["id"], "confronti", voce)
    with c.tx() as conn:
        security_event(conn, "REVISION_COMPARED", user_id=c.user_id, project_id=rev["project_id"], ip=c.ip,
                       revision=revision_id, previous=prec_id, job=job)
    return voce


class VerificaIn(BaseModel):
    set_id: str = Field(min_length=1, max_length=120)


@revisioni.post("/revisions/{revision_id}/verifica", status_code=201)
def verifica_revisione(revision_id: uuid.UUID, body: VerificaIn, c: Ctx = Depends(ctx)):
    """Checklist di Verifica Requisiti sul file della revisione: carica, aspetta l'estrazione del testo, verifica;
    l'esito resta in ``attributes.verifiche``."""
    _limite_per_utente(c, "verifica")
    with c.tx() as conn:
        rev, doc = _revisione_scaricabile(conn, revision_id)
        _controlla_dimensione(c, rev)
    dati = _byte_revisione(c, rev)
    email, nome = _utente_portale(c)
    chi = {"utente": email, "nome": nome, "email": email}
    try:
        caricato = suite_link.chiama("verifica", "POST", "/documenti", dati={},
                                     file=("files", rev["original_filename"], dati, _tipo_file(rev["original_filename"])),
                                     timeout=60, **chi)
        documenti = (caricato or {}).get("documenti") or []
        if not documenti:
            raise ApiError(502, "suite_app", "Verifica Requisiti non ha accettato il file")
        doc_id = documenti[0]["id"]
        stato = documenti[0].get("stato")
        for _ in range(60):                       # estrazione del testo asincrona: fino a 30 s
            if stato == "pronto":
                break
            if stato in ("errore", "error"):
                raise ApiError(502, "suite_app", "Verifica Requisiti non è riuscita a leggere il file")
            time.sleep(0.5)
            stato = (suite_link.chiama("verifica", "GET", f"/documenti/{quote(str(doc_id))}", **chi) or {}).get("stato")
        else:
            raise ApiError(504, "suite_app", "Verifica Requisiti sta ancora leggendo il file: riprovare tra poco")
        esito = suite_link.chiama("verifica", "POST", "/verifiche", dati={"setId": body.set_id, "documentoIds": [doc_id]},
                                  timeout=120, **chi)
    except suite_link.SuiteError as e:
        raise _errore_suite(e) from None
    verifiche = (esito or {}).get("verifiche") or []
    if not verifiche:
        scarti = (esito or {}).get("scartati") or []
        raise ApiError(502, "suite_app", "Verifica non eseguita: " + (scarti[0].get("motivo", "") if scarti else "nessun esito"))
    v = verifiche[0]
    risultati = v.get("risultati") or []
    voce = {"revision_id": str(revision_id), "revision_code": rev["revision_code"], "set_id": body.set_id,
            "nome_set": v.get("nomeSet") or body.set_id, "esito": v.get("esito"),
            "ko": sum(1 for r in risultati if r.get("esito") == "ko"), "dubbi": sum(1 for r in risultati if r.get("esito") == "dubbio"),
            "verifica_id": v.get("id"), "url": suite_link.url_pubblico("verifica"),
            "data": datetime.now().isoformat(timespec="seconds"), "utente": email}
    _aggiungi_attributo(c.svc, doc["id"], "verifiche", voce)
    with c.tx() as conn:
        security_event(conn, "REVISION_VERIFIED", user_id=c.user_id, project_id=rev["project_id"], ip=c.ip,
                       revision=revision_id, set=body.set_id, esito=v.get("esito"))
    return voce


@router.get("/requisiti/set")
def suite_requisiti_set(c: Ctx = Depends(ctx)):
    """I set di Verifica Requisiti fra cui scegliere."""
    email, nome = _utente_portale(c)
    try:
        r = suite_link.chiama("verifica", "GET", "/requisiti", utente=email, nome=nome, email=email)
    except suite_link.SuiteError as e:
        raise _errore_suite(e) from None
    return {"set": [{"id": s["id"], "nome": s.get("nome") or s["id"], "descrizione": s.get("descrizione") or "",
                     "requisiti": len(s.get("requisiti") or [])} for s in (r or {}).get("set") or []]}
