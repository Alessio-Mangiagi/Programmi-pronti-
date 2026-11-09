# "><(((º> sabusabu <º)))><"
"""Timbri da apporre sui PDF (ADR-56, migrazione 0045): libreria dei timbri e PDF timbrato come nuova revisione.

  GET   /projects/{id}/stamps            timbri usabili nella commessa (personali, dell'organizzazione, della commessa)
                                         e quali ambiti l'utente può creare; ?disattivati=true anche quelli spenti
  POST  /projects/{id}/stamps            nuovo timbro da PNG/JPG in base64, con lo sfondo reso trasparente a richiesta
  PATCH /stamps/{id}                     rinomina, disattiva o riattiva (non si cancella: il registro resta sensato)
  GET   /stamps/{id}/image               il PNG del timbro (lo vede chi lo può usare)
  POST  /revisions/{id}/timbra           i timbri sulle pagine indicate: il PDF timbrato diventa la WIP successiva

Regole del timbro sul documento, le stesse di una revisione nuova caricata a mano: si parte dall'ultima revisione
(qualunque stato: «Approvato» su una tavola pubblicata dà una WIP da condividere e pubblicare di nuovo), serve il
permesso WRITE sulla cartella, e durante un workflow il documento è bloccato tranne per chi ha il compito riaperto da
una richiesta di modifiche, come per OnlyOffice (`cde.assert_can_add_revision`, ADR-51). Non si timbrano le buste
firmate .p7m (la firma riguarda il file originale e andrebbe persa); un PDF con firma PAdES si timbra solo dopo la
conferma esplicita (`accetta_firma_pdf`), perché la nuova revisione non avrà più una firma valida.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import io
import uuid
from datetime import UTC, datetime
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, Response
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field, model_validator

from .. import firma, timbri
from ..deps import Ctx, ctx, require_container, require_project
from ..errors import ApiError, forbidden, not_found
from ..events import security_event
from .documents import _downloadable, _latest_revision, _next_wip, _revision

router = APIRouter(tags=["timbri"])

Ambito = Literal["PERSONAL", "ORGANIZATION", "PROJECT"]
MAX_TIMBRI_PER_REVISIONE = 50

STAMP_SQL = """
    SELECT s.id, s.scope, s.organization_id, o.code AS organization_code, s.project_id, s.owner_id, s.name,
           s.size_bytes, s.width_px, s.height_px, s.created_at, s.updated_at, s.disabled_at,
           u.first_name || ' ' || u.last_name AS created_by_name,
           cde.stamp_manageable(s.scope, s.organization_id, s.project_id, s.owner_id) AS can_manage
    FROM cde.stamps s
    JOIN cde.organizations o ON o.id = s.organization_id
    LEFT JOIN cde.users u ON u.id = s.created_by"""


class StampIn(BaseModel):
    nome: str = Field(min_length=1, max_length=80)
    ambito: Ambito = "PERSONAL"
    # PNG o JPG in base64, anche come data URL ("data:image/png;base64,…")
    immagine_base64: str = Field(min_length=8)
    scontorna: bool = True
    tolleranza: float = Field(default=0.15, ge=0, le=timbri.TOLLERANZA_MASSIMA)


class StampPatch(BaseModel):
    nome: str | None = Field(default=None, min_length=1, max_length=80)
    attivo: bool | None = None


class PosizioneIn(BaseModel):
    """Un timbro su una pagina, in frazioni della pagina come la mostra il visualizzatore (origine in alto a sinistra),
    come le annotazioni (modules/markups.py)."""
    timbro_id: uuid.UUID
    pagina: int = Field(ge=1, le=100_000)
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    larghezza: float = Field(gt=0, le=1)
    altezza: float = Field(gt=0, le=1)
    didascalia: bool = False

    @model_validator(mode="after")
    def _dentro(self):
        if self.x + self.larghezza > 1.0001 or self.y + self.altezza > 1.0001:
            raise ValueError("Il timbro esce dalla pagina")
        return self


class TimbraIn(BaseModel):
    timbri: list[PosizioneIn] = Field(min_length=1, max_length=MAX_TIMBRI_PER_REVISIONE)
    commento: str | None = Field(default=None, max_length=500)
    accetta_firma_pdf: bool = False


def _stamp(conn, stamp_id: uuid.UUID) -> dict:
    row = conn.execute(STAMP_SQL + " WHERE s.id = %s", [stamp_id]).fetchone()
    if row is None:
        raise not_found("Timbro")
    return row


def _decodifica(valore: str, limite: int) -> bytes:
    if valore.startswith("data:"):
        valore = valore.split(",", 1)[-1]
    if len(valore) * 3 // 4 > limite:
        raise ApiError(413, "too_large", f"Immagine oltre {limite // 1024 ** 2} MB")
    try:
        return base64.b64decode(valore, validate=True)
    except (binascii.Error, ValueError):
        raise ApiError(422, "immagine_non_valida", "Immagine non leggibile (base64 non valido)") from None


def _puo_creare(conn, project_id: uuid.UUID) -> dict[str, bool]:
    r = conn.execute("""SELECT cde.current_app_is_org_admin() AS org,
                               cde.has_project_permission(cde.current_app_user(), %s, 'ADMIN', 'PROJECT') AS prj""",
                     [project_id]).fetchone()
    return {"PERSONAL": True, "ORGANIZATION": bool(r["org"]), "PROJECT": bool(r["prj"])}


@router.get("/projects/{project_id}/stamps")
def list_stamps(project_id: uuid.UUID, disattivati: bool = False, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        require_project(conn, project_id)
        # la RLS lascia i timbri visibili all'utente: qui si tolgono quelli di altre commesse
        rows = conn.execute(
            STAMP_SQL + """ WHERE (s.scope <> 'PROJECT' OR s.project_id = %s) AND (%s OR s.disabled_at IS NULL)
                            ORDER BY CASE s.scope WHEN 'PROJECT' THEN 0 WHEN 'ORGANIZATION' THEN 1 ELSE 2 END,
                                     lower(s.name)""", [project_id, disattivati]).fetchall()
        return {"timbri": rows, "posso_creare": _puo_creare(conn, project_id)}


@router.post("/projects/{project_id}/stamps", status_code=201)
def create_stamp(project_id: uuid.UUID, body: StampIn, c: Ctx = Depends(ctx)):
    s = c.svc.settings
    with c.tx() as conn:
        require_project(conn, project_id)
        if not _puo_creare(conn, project_id)[body.ambito]:
            raise forbidden("I timbri dell'organizzazione li crea l'amministratore dell'organizzazione, quelli "
                            "della commessa il Project Admin")
        org = conn.execute("SELECT cde.current_app_org() AS id").fetchone()["id"]
    dati = _decodifica(body.immagine_base64, s.timbro_immagine_max_bytes)
    try:
        png, w, h = timbri.prepara_immagine(dati, scontorna_sfondo=body.scontorna, tolleranza=body.tolleranza)
    except timbri.TimbroErrore as e:
        raise ApiError(422, "immagine_non_valida", str(e)) from None
    stamp_id = uuid.uuid4()
    key = f"stamps/{org}/{stamp_id}.png"
    version = c.svc.storage.put_fileobj(key, io.BytesIO(png), "image/png")
    with c.tx() as conn:
        conn.execute(
            """INSERT INTO cde.stamps (id, scope, organization_id, project_id, owner_id, name, storage_key,
                   storage_version_id, size_bytes, width_px, height_px, sha256, created_by)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, cde.current_app_user())""",
            [stamp_id, body.ambito, org, project_id if body.ambito == "PROJECT" else None,
             c.user_id if body.ambito == "PERSONAL" else None, body.nome.strip(), key, version, len(png), w, h,
             hashlib.sha256(png).digest()])
        security_event(conn, "STAMP_CREATED", user_id=c.user_id, organization_id=org,
                       project_id=project_id if body.ambito == "PROJECT" else None, ip=c.ip,
                       stamp=stamp_id, name=body.nome.strip(), scope=body.ambito, scontorno=body.scontorna)
        return _stamp(conn, stamp_id)


@router.patch("/stamps/{stamp_id}")
def update_stamp(stamp_id: uuid.UUID, body: StampPatch, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        st = _stamp(conn, stamp_id)
        if not st["can_manage"]:
            raise forbidden("Il timbro lo gestisce chi lo ha in carico: proprietario, amministratore "
                            "dell'organizzazione o Project Admin")
        if body.nome is not None:
            conn.execute("UPDATE cde.stamps SET name = %s, updated_at = now() WHERE id = %s",
                         [body.nome.strip(), stamp_id])
        if body.attivo is not None:
            conn.execute("""UPDATE cde.stamps SET disabled_at = CASE WHEN %s THEN NULL ELSE now() END,
                                   disabled_by = CASE WHEN %s THEN NULL ELSE cde.current_app_user() END,
                                   updated_at = now() WHERE id = %s""", [body.attivo, body.attivo, stamp_id])
        security_event(conn, "STAMP_UPDATED", user_id=c.user_id, organization_id=st["organization_id"],
                       project_id=st["project_id"], ip=c.ip, stamp=stamp_id,
                       **({"name": body.nome.strip()} if body.nome is not None else {}),
                       **({"active": body.attivo} if body.attivo is not None else {}))
        return _stamp(conn, stamp_id)


@router.get("/stamps/{stamp_id}/image")
def stamp_image(stamp_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        row = conn.execute("SELECT storage_key, storage_version_id FROM cde.stamps WHERE id = %s",
                           [stamp_id]).fetchone()
    if row is None:
        raise not_found("Timbro")
    return Response(c.svc.storage.get_bytes(row["storage_key"], row["storage_version_id"]), media_type="image/png",
                    headers={"Cache-Control": "private, max-age=3600"})


def _didascalia(conn, project_id: uuid.UUID) -> str:
    """ "Timbrato da Nome Cognome il gg/mm/aaaa hh:mm", nel fuso orario della commessa (lo scrive il server)."""
    r = conn.execute("""SELECT u.first_name || ' ' || u.last_name AS nome, p.timezone FROM cde.users u, cde.projects p
                        WHERE u.id = cde.current_app_user() AND p.id = %s""", [project_id]).fetchone()
    try:
        tz = ZoneInfo(r["timezone"] or "Europe/Rome")
    except ZoneInfoNotFoundError:
        tz = ZoneInfo("Europe/Rome")
    return f"Timbrato da {r['nome']} il {datetime.now(UTC).astimezone(tz):%d/%m/%Y %H:%M}"


def _controlla_base(conn, revision_id: uuid.UUID) -> tuple[dict, dict]:
    """La revisione da timbrare (scaricabile, PDF, ultima del documento) e il suo documento; i controlli di scrittura
    sono quelli di una revisione nuova: WRITE sulla cartella e blocco dei workflow (ADR-51)."""
    rev = _downloadable(conn, revision_id)
    nome = rev["original_filename"].lower()
    if firma.e_p7m(nome):
        raise ApiError(409, "firmato", "Documento firmato digitalmente (.p7m): il timbro romperebbe la firma. "
                                       "Timbrare il PDF prima di firmarlo, oppure caricarne una copia non firmata")
    if not nome.endswith(".pdf"):
        raise ApiError(415, "solo_pdf", "Si timbrano solo i PDF")
    doc = conn.execute("""SELECT r.document_id, d.archived_at, d.container_id, r.revision_code, r.state
                          FROM cde.document_revisions r JOIN cde.documents d ON d.id = r.document_id
                          WHERE r.id = %s""", [revision_id]).fetchone()
    if doc["archived_at"]:
        raise ApiError(409, "archiviato", "Documento archiviato: sola lettura")
    latest = conn.execute("SELECT id, revision_code FROM cde.document_revisions WHERE document_id = %s "
                          "ORDER BY sequence DESC LIMIT 1", [doc["document_id"]]).fetchone()
    if latest["id"] != revision_id:
        raise ApiError(409, "not_current", f"Si timbra l'ultima revisione: nel frattempo è stata caricata la "
                                           f"{latest['revision_code']}")
    require_container(conn, doc["container_id"], "WRITE")
    # 423 se il documento è in un workflow, tranne per chi ha il compito riaperto da una richiesta di modifiche
    conn.execute("SELECT cde.assert_can_add_revision(%s)", [doc["document_id"]])
    return rev, doc


@router.post("/revisions/{revision_id}/timbra", status_code=201)
def stamp_revision(revision_id: uuid.UUID, body: TimbraIn, c: Ctx = Depends(ctx)):
    s = c.svc.settings
    ids = sorted({p.timbro_id for p in body.timbri})
    with c.tx() as conn:
        rev, doc = _controlla_base(conn, revision_id)
        # timbri attivi che l'utente può usare (RLS) e validi in questa commessa
        usabili = {r["id"]: r for r in conn.execute(
            """SELECT id, name, scope, storage_key, storage_version_id FROM cde.stamps
               WHERE id = ANY(%s) AND disabled_at IS NULL AND (scope <> 'PROJECT' OR project_id = %s)""",
            [ids, rev["project_id"]]).fetchall()}
        mancanti = [i for i in ids if i not in usabili]
        if mancanti:
            raise ApiError(422, "timbro_non_disponibile", "Timbro non disponibile (disattivato, di un'altra "
                                                          "commessa o non tuo): sceglierne un altro")
        didascalia = _didascalia(conn, rev["project_id"]) if any(p.didascalia for p in body.timbri) else None
    if rev["size_bytes"] > s.timbri_pdf_max_bytes:
        raise ApiError(413, "too_large", f"PDF oltre {s.timbri_pdf_max_bytes // 1024 ** 2} MB: timbrarlo in locale")

    storage = c.svc.storage
    pdf = storage.get_bytes(rev["storage_key"], rev["storage_version_id"])
    immagini = {str(i): storage.get_bytes(usabili[i]["storage_key"], usabili[i]["storage_version_id"]) for i in ids}
    try:
        firmato = timbri.ha_firma_pdf(pdf)
        if firmato and not body.accetta_firma_pdf:
            raise ApiError(409, "pdf_firmato", "Il PDF contiene una firma digitale (PAdES): la revisione timbrata non "
                                               "avrà più una firma valida, quella di partenza la conserva. Confermare "
                                               "per timbrare comunque")
        timbrato = timbri.timbra_pdf(
            pdf, [timbri.Posizione(str(p.timbro_id), p.pagina, p.x, p.y, p.larghezza, p.altezza, p.didascalia)
                  for p in body.timbri], immagini, didascalia=didascalia)
    except timbri.TimbroErrore as e:
        raise ApiError(422, "pdf_non_timbrabile", str(e)) from None
    key = f"projects/{rev['project_id']}/files/{uuid.uuid4()}"
    version = storage.put_fileobj(key, io.BytesIO(timbrato), "application/pdf")

    with c.tx() as conn:
        rev, doc = _controlla_base(conn, revision_id)      # di nuovo: intanto può essere arrivata un'altra revisione
        latest = _latest_revision(conn, doc["document_id"])
        code = _next_wip(conn, doc["document_id"])
        nomi = sorted({usabili[p.timbro_id]["name"] for p in body.timbri})
        comment = f"Timbrata in piattaforma ({', '.join(nomi)}) a partire dalla {doc['revision_code']}"
        if body.commento and body.commento.strip():
            comment = f"{body.commento.strip()}\n\n{comment}"
        file_id, new_id = uuid.uuid4(), uuid.uuid4()
        conn.execute(
            """INSERT INTO cde.file_objects (id, project_id, storage_key, storage_version_id, size_bytes, content_type,
                   sha256, uploaded_by) VALUES (%s, %s, %s, %s, %s, 'application/pdf', %s, cde.current_app_user())""",
            [file_id, rev["project_id"], key, version, len(timbrato), hashlib.sha256(timbrato).digest()])
        # una WIP è sempre S0 (vincolo revision_code_matches_state, 0006), anche partendo da una condivisa o pubblicata
        conn.execute(
            """INSERT INTO cde.document_revisions (id, document_id, project_id, sequence, revision_code, suitability,
                   state, file_object_id, original_filename, comment, created_by)
               VALUES (%s, %s, %s, %s, %s, 'S0', 'WIP', %s, %s, %s, cde.current_app_user())""",
            [new_id, doc["document_id"], rev["project_id"], latest["sequence"] + 1, code, file_id,
             rev["original_filename"], comment])
        # antivirus, impronta, testo per la ricerca e anteprime: come per ogni file caricato
        conn.execute("SELECT cde.enqueue_job('cde.verify_file', %s)", [Jsonb({"file_id": str(file_id)})])
        security_event(conn, "REVISION_UPLOADED", user_id=c.user_id, project_id=rev["project_id"], ip=c.ip,
                       document=doc["document_id"], revision=new_id, code=code, size=len(timbrato), via="timbri")
        security_event(conn, "REVISION_STAMPED", user_id=c.user_id, project_id=rev["project_id"], ip=c.ip,
                       document=doc["document_id"], revision=new_id, code=code, from_revision=revision_id,
                       from_code=doc["revision_code"], caption=didascalia,
                       stamps=[{"id": str(p.timbro_id), "name": usabili[p.timbro_id]["name"],
                                "scope": usabili[p.timbro_id]["scope"], "page": p.pagina} for p in body.timbri],
                       pdf_signature_dropped=firmato or None)
        return _revision(conn, new_id)
