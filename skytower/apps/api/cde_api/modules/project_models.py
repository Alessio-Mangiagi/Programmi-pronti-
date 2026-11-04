# "><(((º> sabusabu <º)))><"
"""Modelli di commessa dell'organizzazione (ADR-52, migrazione 0043).

Un modello è una commessa "vuota" (``projects.is_model``): struttura, naming, metadati, ruoli, filigrana, workflow,
organizzazioni, persone e documenti di modello, da cui l'amministratore dell'organizzazione apre una commessa nuova
con tutto pronto. Il modello si apre e si ritocca con le pagine di una commessa; non compare negli elenchi operativi
e non ha funzioni operative (il database rifiuta workflow avviati, RFI e transmittal e non scrive notifiche).

Chi: gli amministratori dell'organizzazione proprietaria creano, modificano e usano i modelli; diventano Project
Admin dei modelli quando ne aprono l'elenco (``cde.model_join``). Le altre organizzazioni non li vedono (RLS).

Rotte:
- ``GET /organizations/{id}/project-models``: elenco con cosa contiene ogni modello;
- ``POST /organizations/{id}/project-models``: "Salva come modello" (``source_project_id``) o modello vuoto;
- ``POST /project-models/{id}/projects``: nuova commessa dal modello (documenti di modello come prima revisione);
- ``GET/POST/DELETE /project-models/{id}/people``: persone salvate nel modello (non sono membri);
- ``GET /projects/{id}/model-documents``, ``PUT/DELETE /documents/{id}/model``: documenti "di modello";
- ``GET /projects/{id}/model-file``: "Scarica il modello", file ``.cdemodello`` (da un modello o da una commessa);
- ``POST /organizations/{id}/project-models/import``: "Carica un modello da file", con l'elenco degli adattamenti.

Formato del file ``.cdemodello`` (versione 1): uno ZIP con ``modello.json`` (tutto ciò che serve a ricostruire
struttura e workflow, più in appendice i workflow della libreria dell'organizzazione), ``files/…`` (i documenti di
modello), ``LEGGIMI.txt`` e ``manifest.json`` con lo SHA-256 di ogni altro file: un file rovinato o modificato a mano
si riconosce e si rifiuta. È un controllo di integrità, non una firma: chi modifica il file può rifare gli hash, ma
l'import ricontrolla comunque ogni dato come se arrivasse da un utente (tetti, schemi, validatore dei workflow).
"""
from __future__ import annotations

import hashlib
import json
import re
import tempfile
import uuid
import zipfile
from datetime import UTC, date, datetime
from typing import Any, Literal
from urllib.parse import quote

import jsonschema
from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from iso19650 import AutoNumbering, NamingScheme, next_wip_revision
from psycopg.types.json import Jsonb
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from ..deps import Ctx, ctx, require_project
from ..errors import ApiError, forbidden, not_found
from ..events import security_event
from ..validation import JsonObject, LargeJsonObject, check_json_size
from . import workflow_graph as wg
from . import workflow_library
from .documents import WatermarkIn, controlla_pattern, load_naming

router = APIRouter(tags=["project-models"])

FORMATO = "cdemodello"
VERSIONE = 1
ESTENSIONE = ".cdemodello"
# Tetti del file caricato (oltre alla dimensione, model_file_max_bytes): voci dello zip, JSON, elenchi
MAX_ENTRIES = 600
MAX_JSON_BYTES = 8 * 1024 * 1024
MAX_MANIFEST_BYTES = 256 * 1024
MAX_JSON_DEPTH = 64
MAX_RATIO = 200                       # compressione oltre 200:1 su file grandi = zip bomb
NOME_FILE = re.compile(r"^files/[A-Za-z0-9][A-Za-z0-9._ -]{0,180}$")
REF = Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9_-]+$")
PROJECT_CODE = r"^[A-Z0-9]{2,6}$"
ORG_CODE = r"^[A-Z0-9]{2,6}$"
ROLE_CODE = r"^[A-Z][A-Z0-9_]{1,40}$"
PartyRole = Literal["APPOINTING_PARTY", "LEAD_APPOINTED_PARTY", "APPOINTED_PARTY", "SUBCONTRACTOR", "CONSULTANT",
                    "OBSERVER"]


# ---------------------------------------------------------------------
# Corpi delle richieste
# ---------------------------------------------------------------------
class ModelIn(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    source_project_id: uuid.UUID | None = None       # "Salva come modello"; None = modello vuoto
    code: str | None = Field(default=None, pattern=PROJECT_CODE)   # solo per il modello vuoto (segnaposto nel naming)


class FromModelIn(BaseModel):
    code: str = Field(pattern=PROJECT_CODE)
    name: str = Field(min_length=2, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    start_date: date | None = None
    end_date: date | None = None
    timezone: str = "Europe/Rome"
    with_organizations: bool = False
    with_members: bool = False                       # richiede le organizzazioni
    with_documents: bool = True


class PersonIn(BaseModel):
    user_id: uuid.UUID
    role_id: uuid.UUID


# ---------------------------------------------------------------------
# Contenuto di modello.json (versione 1): ogni campo con un tetto, niente campi in più
# ---------------------------------------------------------------------
class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MPermission(_Strict):
    action: Literal["READ", "WRITE", "DOWNLOAD", "APPROVE", "ADMIN"]
    scope: Literal["OWN_ORGANIZATION", "PROJECT"]


class MRole(_Strict):
    code: str = Field(pattern=ROLE_CODE)
    name: str = Field(min_length=2, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    permissions: list[MPermission] = Field(default_factory=list, max_length=20)


class MOrg(_Strict):
    code: str = Field(pattern=ORG_CODE)
    legal_name: str = Field(max_length=300)
    party_role: PartyRole
    is_active: bool = True


class MPerson(_Strict):
    email: str = Field(min_length=3, max_length=320, pattern=r"^[^@\s]+@[^@\s]+$")
    first_name: str | None = Field(default=None, max_length=100)
    last_name: str | None = Field(default=None, max_length=100)
    organization: str = Field(pattern=ORG_CODE)
    role: str = Field(pattern=ROLE_CODE)


class MProfile(_Strict):
    ref: str = REF
    name: str = Field(min_length=1, max_length=80)
    naming_scheme: JsonObject
    auto_number: JsonObject | None = None
    inherit: bool = False


class MFolder(_Strict):
    ref: str = REF
    parent: str | None = Field(default=None, max_length=40)
    name: str = Field(min_length=1, max_length=200)
    owner: str = Field(pattern=ORG_CODE)
    is_private: bool = False
    inherit_permissions: bool = True
    naming_profile: str | None = Field(default=None, max_length=40)


class MWorkflow(_Strict):
    code: str = Field(pattern=ROLE_CODE)
    name: str = Field(min_length=2, max_length=200)
    definition: LargeJsonObject


class MDocument(_Strict):
    ref: str = REF
    folder: str = Field(max_length=40)
    identifier: str = Field(pattern=r"^[A-Z0-9][A-Z0-9._-]{3,120}$")
    naming_fields: JsonObject = Field(default_factory=dict)
    title: str = Field(min_length=1, max_length=300)
    description: str | None = Field(default=None, max_length=4000)
    attributes: JsonObject = Field(default_factory=dict)
    file: str = Field(max_length=200)
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(max_length=200)
    size_bytes: int = Field(gt=0)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class MProject(_Strict):
    code: str = Field(pattern=PROJECT_CODE)
    name: str = Field(min_length=2, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    timezone: str = Field(default="Europe/Rome", max_length=64)
    settings: JsonObject = Field(default_factory=dict)


class MDocSettings(_Strict):
    naming_scheme: JsonObject | None = None
    metadata_schema: JsonObject | None = None
    auto_number: JsonObject | None = None
    watermark: JsonObject | None = None


class ModelFile(_Strict):
    formato: Literal["cdemodello"]
    versione: int
    esportato_il: str = Field(max_length=40)
    esportato_da: str | None = Field(default=None, max_length=320)
    origine: JsonObject = Field(default_factory=dict)
    progetto: MProject
    impostazioni: MDocSettings = Field(default_factory=MDocSettings)
    schemi_cartelle: list[MProfile] = Field(default_factory=list, max_length=200)
    cartelle: list[MFolder] = Field(default_factory=list, max_length=5000)
    ruoli: list[MRole] = Field(default_factory=list, max_length=200)
    organizzazioni: list[MOrg] = Field(default_factory=list, max_length=50)
    persone: list[MPerson] = Field(default_factory=list, max_length=2000)
    workflow: list[MWorkflow] = Field(default_factory=list, max_length=200)
    libreria: list[MWorkflow] = Field(default_factory=list, max_length=200)
    documenti: list[MDocument] = Field(default_factory=list, max_length=500)
    # id → email / codice, per riportare persone e organizzazioni citate nei workflow nell'installazione di arrivo
    utenti_citati: dict[str, str] = Field(default_factory=dict, max_length=2000)
    organizzazioni_citate: dict[str, str] = Field(default_factory=dict, max_length=200)


# ---------------------------------------------------------------------
# Regole comuni
# ---------------------------------------------------------------------
def _own_org_admin(conn, org_id: uuid.UUID) -> dict:
    """L'organizzazione dei modelli: solo la propria e solo per il suo amministratore. Un'altra organizzazione è 404
    (non se ne rivela l'esistenza), chi non è admin ha 403."""
    row = conn.execute(
        """SELECT id, code, legal_name, cde.current_app_is_org_admin() AS is_admin FROM cde.organizations
           WHERE id = %s AND id = cde.current_app_org()""", [org_id]).fetchone()
    if row is None:
        raise not_found("Organizzazione")
    if not row["is_admin"]:
        raise forbidden("I modelli di commessa li gestiscono gli amministratori dell'organizzazione")
    return row


def _model(conn, model_id: uuid.UUID) -> dict:
    """Il modello, se chi chiama ne è amministratore (dopo ``model_join``); altrimenti 404."""
    conn.execute("SELECT cde.model_join()")
    row = conn.execute("SELECT * FROM cde.projects WHERE id = %s AND is_model AND owner_organization_id = cde.current_app_org()",
                       [model_id]).fetchone()
    if row is None or not conn.execute("SELECT cde.has_project_permission(cde.current_app_user(), %s, 'ADMIN', 'PROJECT') ok",
                                       [model_id]).fetchone()["ok"]:
        raise not_found("Modello di commessa")
    return row


MODEL_SQL = """
    SELECT p.id, p.code, p.name, p.description, p.status, p.created_at, p.updated_at, p.model_source_id,
           src.name AS source_name, src.code AS source_code,
           u.first_name || ' ' || u.last_name AS created_by_name,
           (SELECT count(*) FROM cde.containers c WHERE c.project_id = p.id) AS folders,
           (SELECT count(*) FROM cde.naming_profiles n WHERE n.project_id = p.id) AS naming_profiles,
           (SELECT count(DISTINCT code) FROM cde.workflow_templates w WHERE w.project_id = p.id AND w.is_active) AS workflows,
           (SELECT count(*) FROM cde.roles r WHERE r.project_id = p.id) AS roles,
           (SELECT count(*) FROM cde.project_organizations o WHERE o.project_id = p.id
              AND o.organization_id <> p.owner_organization_id) AS organizations,
           (SELECT count(*) FROM cde.project_model_people mp WHERE mp.project_id = p.id) AS people,
           (SELECT count(*) FROM cde.model_documents md WHERE md.project_id = p.id) AS documents
    FROM cde.projects p
    LEFT JOIN cde.projects src ON src.id = p.model_source_id
    LEFT JOIN cde.users u ON u.id = p.created_by
    WHERE p.is_model"""


def _model_row(conn, model_id: uuid.UUID) -> dict:
    return conn.execute(MODEL_SQL + " AND p.id = %s", [model_id]).fetchone()


def _extension(filename: str) -> str | None:
    m = re.match(r"^.*\.([A-Za-z0-9]{1,10})$", (filename or "").strip())
    return m.group(1).lower() if m else None


def _identifier(conn, project: dict, container_id: uuid.UUID, fields: dict, old_identifier: str, old_code: str,
                ext: str | None) -> tuple[str, dict]:
    """Identificativo rigenerato con lo schema della cartella di arrivo (il campo "progetto" ha già il codice nuovo):
    se i valori salvati non bastano a comporlo, si sostituisce il vecchio codice nell'identificativo di partenza."""
    scheme, _, _ = load_naming(conn, project, container_id=container_id)
    values = {k: str(v) for k, v in (fields or {}).items()}
    result = scheme.validate_name(scheme.compose(values, ext))
    if result.valid and result.identifier:
        return result.identifier, result.fields
    fallback = re.sub(rf"(?<![A-Z0-9]){re.escape(old_code)}(?![A-Z0-9])", project["code"], old_identifier, count=1)
    again = scheme.validate_name(f"{fallback}.{ext}" if ext else fallback)
    return fallback, (again.fields if again.valid else {**values, "project": project["code"]})


def _copy_documents(conn, c: Ctx, source: dict, target: dict, folders: dict, *, mark: bool, origin: str) -> list[str]:
    """Documenti di modello della sorgente come PRIMA revisione WIP nella cartella corrispondente del progetto appena
    creato, con un file nuovo su S3 (mai condiviso) e il naming rigenerato. Restituisce le cose saltate."""
    notes: list[str] = []
    seen: set[str] = set()
    for d in conn.execute("SELECT * FROM cde.model_documents_source(%s)", [source["id"]]).fetchall():
        dst = folders.get(d["container_id"])
        if dst is None:
            notes.append(f"Documento {d['identifier']} non copiato: la sua cartella (di un'organizzazione non "
                         "copiata) non c'è")
            continue
        # un file appena copiato in un modello è ancora "in verifica": la copia ne fa una sua, verificata di nuovo
        # dal worker, quindi si accetta; quelli in quarantena o con errore no
        if d["scan_status"] not in ("CLEAN", "PENDING"):
            notes.append(f"Documento {d['identifier']} non copiato: il file non ha superato la verifica antivirus")
            continue
        ext = _extension(d["original_filename"])
        identifier, fields = _identifier(conn, target, dst, d["naming_fields"], d["identifier"], source["code"], ext)
        if identifier in seen or not re.match(r"^[A-Z0-9][A-Z0-9._-]{3,120}$", identifier):
            notes.append(f"Documento {d['identifier']} non copiato: identificativo {identifier} non valido o doppio")
            continue
        seen.add(identifier)
        key = f"projects/{target['id']}/files/{uuid.uuid4()}"
        version = c.svc.storage.copy_object(d["storage_key"], d["storage_version_id"], key, d["content_type"])
        conn.execute(
            "SELECT cde.model_insert_document(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
            [target["id"], dst, identifier, Jsonb(fields), d["title"], d["description"], Jsonb(d["attributes"] or {}),
             key, version, d["size_bytes"], d["content_type"], d["sha256"],
             f"{identifier}.{ext}" if ext else identifier, next_wip_revision(None),
             f"Documento di modello da {origin} ({d['identifier']} {d['revision_code']})", mark])
    return notes


# ---------------------------------------------------------------------
# Elenco, creazione, uso
# ---------------------------------------------------------------------
@router.get("/organizations/{org_id}/project-models")
def list_models(org_id: uuid.UUID, c: Ctx = Depends(ctx)):
    """Modelli di commessa attivi dell'organizzazione, con cosa contengono (per la pagina e per "Parti da")."""
    with c.tx() as conn:
        _own_org_admin(conn, org_id)
        conn.execute("SELECT cde.model_join()")
        return conn.execute(MODEL_SQL + " AND p.owner_organization_id = %s AND p.status <> 'ARCHIVED' ORDER BY p.name",
                            [org_id]).fetchall()


@router.post("/organizations/{org_id}/project-models", status_code=201)
def create_model(org_id: uuid.UUID, body: ModelIn, c: Ctx = Depends(ctx)):
    """"Salva come modello" da una commessa (o da un altro modello) di cui si è Project Admin, oppure modello vuoto.
    La commessa di partenza non cambia. ``changes`` elenca ciò che non si è potuto copiare."""
    with c.tx() as conn:
        org = _own_org_admin(conn, org_id)
        notes: list[str] = []
        if body.source_project_id is None:
            code = body.code or org["code"][:6]
            mid = conn.execute("SELECT cde.create_project_model(%s, %s, %s) AS id",
                               [code, body.name, body.description]).fetchone()["id"]
        else:
            source = require_project(conn, body.source_project_id, "ADMIN", "PROJECT")
            rows = conn.execute("SELECT * FROM cde.save_project_as_model(%s, %s, %s)",
                                [body.source_project_id, body.name, body.description]).fetchall()
            mid = rows[0]["out_project"]
            folders = {r["out_src"]: r["out_dst"] for r in rows if r["out_src"]}
            notes = _copy_documents(conn, c, source, require_project(conn, mid), folders, mark=True,
                                    origin=f"{source['code']} — {source['name']}")
        security_event(conn, "PROJECT_MODEL_CREATED", user_id=c.user_id, organization_id=org_id, project_id=mid,
                       ip=c.ip, source=body.source_project_id, changes=len(notes))
        return {**_model_row(conn, mid), "changes": notes}


@router.post("/project-models/{model_id}/projects", status_code=201)
def create_project_from_model(model_id: uuid.UUID, body: FromModelIn, c: Ctx = Depends(ctx)):
    """Nuova commessa dal modello: struttura, naming col codice nuovo, ruoli, workflow, a scelta organizzazioni e
    persone, e i documenti di modello come prima revisione WIP. Il codice commessa della suite si sceglie dopo, dal
    registro (scheda Suite), come per ogni commessa (ADR-47)."""
    if body.with_members and not body.with_organizations:
        raise ApiError(422, "members_need_organizations", "Le persone si copiano solo insieme alle loro organizzazioni")
    with c.tx() as conn:
        model = _model(conn, model_id)
        if conn.execute("SELECT 1 FROM cde.projects WHERE owner_organization_id = cde.current_app_org() AND code = %s "
                        "AND NOT is_model", [body.code]).fetchone():
            raise ApiError(409, "code_taken", f"La tua organizzazione ha già una commessa con codice {body.code}")
        rows = conn.execute(
            "SELECT * FROM cde.create_project_from_model(%s, %s, %s, %s, %s, %s, %s, %s, %s)",
            [model_id, body.code, body.name, body.description, body.start_date, body.end_date, body.timezone,
             body.with_organizations, body.with_members]).fetchall()
        pid = rows[0]["out_project"]
        project = require_project(conn, pid)
        notes = (_copy_documents(conn, c, model, project, {r["out_src"]: r["out_dst"] for r in rows if r["out_src"]},
                                 mark=False, origin=f"modello «{model['name']}»") if body.with_documents else [])
        security_event(conn, "PROJECT_CREATED", user_id=c.user_id, project_id=pid, ip=c.ip, model=model_id,
                       organizations=body.with_organizations, members=body.with_members, changes=len(notes))
        return {**project, "changes": notes}


# ---------------------------------------------------------------------
# Persone del modello
# ---------------------------------------------------------------------
PEOPLE_SQL = """
    SELECT mp.user_id, mp.role_id, mp.added_at, r.code AS role_code, r.name AS role_name, u.email, u.first_name,
           u.last_name, u.status, u.organization_id, o.code AS organization_code, o.legal_name AS organization_name
    FROM cde.project_model_people mp
    JOIN cde.roles r ON r.id = mp.role_id
    LEFT JOIN cde.users u ON u.id = mp.user_id
    LEFT JOIN cde.organizations o ON o.id = u.organization_id
    WHERE mp.project_id = %s"""


@router.get("/project-models/{model_id}/people")
def list_people(model_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        _model(conn, model_id)
        return conn.execute(PEOPLE_SQL + " ORDER BY o.legal_name, u.last_name, r.code", [model_id]).fetchall()


@router.post("/project-models/{model_id}/people", status_code=201)
def add_person(model_id: uuid.UUID, body: PersonIn, c: Ctx = Depends(ctx)):
    """Persona salvata nel modello con un ruolo: diventa membro solo nelle commesse create "con le persone"."""
    with c.tx() as conn:
        _model(conn, model_id)
        ok = conn.execute(
            """SELECT 1 FROM cde.users u JOIN cde.project_organizations po ON po.organization_id = u.organization_id
               AND po.project_id = %s WHERE u.id = %s AND u.status IN ('ACTIVE', 'INVITED')""",
            [model_id, body.user_id]).fetchone()
        if ok is None:
            raise ApiError(422, "not_participant", "La persona deve essere di un'organizzazione del modello")
        conn.execute("""INSERT INTO cde.project_model_people (project_id, user_id, role_id, added_by)
                        VALUES (%s, %s, %s, cde.current_app_user()) ON CONFLICT DO NOTHING""",
                     [model_id, body.user_id, body.role_id])
        return conn.execute(PEOPLE_SQL + " AND mp.user_id = %s AND mp.role_id = %s",
                            [model_id, body.user_id, body.role_id]).fetchone()


@router.delete("/project-models/{model_id}/people/{user_id}/{role_id}", status_code=204)
def remove_person(model_id: uuid.UUID, user_id: uuid.UUID, role_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        _model(conn, model_id)
        if conn.execute("DELETE FROM cde.project_model_people WHERE project_id = %s AND user_id = %s AND role_id = %s",
                        [model_id, user_id, role_id]).rowcount == 0:
            raise not_found("Persona del modello")
    return Response(status_code=204)


# ---------------------------------------------------------------------
# Documenti "di modello"
# ---------------------------------------------------------------------
@router.get("/projects/{project_id}/model-documents")
def list_model_documents(project_id: uuid.UUID, c: Ctx = Depends(ctx)):
    """Documenti marcati "di modello" (quelli che chi chiama può vedere)."""
    with c.tx() as conn:
        require_project(conn, project_id)
        return conn.execute(
            """SELECT md.document_id, md.marked_at, d.identifier, d.title FROM cde.model_documents md
               JOIN cde.documents d ON d.id = md.document_id WHERE md.project_id = %s ORDER BY d.identifier""",
            [project_id]).fetchall()


def _document_project(conn, document_id: uuid.UUID) -> uuid.UUID:
    row = conn.execute("SELECT project_id FROM cde.documents WHERE id = %s", [document_id]).fetchone()
    if row is None:
        raise not_found("Documento")
    require_project(conn, row["project_id"], "ADMIN", "PROJECT")
    return row["project_id"]


@router.put("/documents/{document_id}/model", status_code=204)
def mark_model_document(document_id: uuid.UUID, c: Ctx = Depends(ctx)):
    """Il Project Admin marca un documento come "di modello": si copia nei modelli e nelle commesse che ne nascono."""
    with c.tx() as conn:
        pid = _document_project(conn, document_id)
        conn.execute("""INSERT INTO cde.model_documents (document_id, project_id, marked_by)
                        VALUES (%s, %s, cde.current_app_user()) ON CONFLICT DO NOTHING""", [document_id, pid])
        security_event(conn, "MODEL_DOCUMENT_MARKED", user_id=c.user_id, project_id=pid, ip=c.ip, document=document_id)
    return Response(status_code=204)


@router.delete("/documents/{document_id}/model", status_code=204)
def unmark_model_document(document_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        pid = _document_project(conn, document_id)
        conn.execute("DELETE FROM cde.model_documents WHERE document_id = %s", [document_id])
        security_event(conn, "MODEL_DOCUMENT_UNMARKED", user_id=c.user_id, project_id=pid, ip=c.ip, document=document_id)
    return Response(status_code=204)


# ---------------------------------------------------------------------
# "Scarica il modello": file .cdemodello
# ---------------------------------------------------------------------
LEGGIMI = """MODELLO DI COMMESSA SKYTOWER ({nome})

Questo file contiene la struttura di una commessa: cartelle con le aree riservate, naming e schemi per cartelle,
metadati, rinomina automatica, filigrana, ruoli con i permessi, workflow, organizzazioni partecipanti, persone con
i ruoli e i documenti "di modello" (cartella files/). In appendice ci sono i workflow della libreria
dell'organizzazione, che si possono ricaricare.

Esportato il {quando} da {chi}. Formato {formato}, versione {versione}.

Per usarlo: in SkyTower, menu del profilo > Modelli di commessa > "Carica un modello da file" (amministratori
dell'organizzazione). SkyTower ricrea un modello di commessa e mostra l'elenco delle cose adattate (persone o
organizzazioni che nell'installazione di arrivo non ci sono, workflow da rivedere).

Non modificare il contenuto: manifest.json contiene l'impronta SHA-256 di ogni file e un file alterato o rovinato
viene rifiutato. Tieni questo file in un posto sicuro: contiene nomi ed email delle persone del modello.
"""


def _export_payload(conn, project: dict) -> tuple[dict, list[dict]]:
    """Il contenuto di modello.json e l'elenco dei documenti da mettere nello zip."""
    pid = project["id"]
    owner = conn.execute("SELECT code, legal_name FROM cde.organizations WHERE id = %s",
                         [project["owner_organization_id"]]).fetchone()
    docset = conn.execute("SELECT naming_scheme, metadata_schema, auto_number, watermark "
                          "FROM cde.project_document_settings WHERE project_id = %s", [pid]).fetchone() or {}
    profiles = conn.execute("SELECT id, name, naming_scheme, auto_number, inherit FROM cde.naming_profiles "
                            "WHERE project_id = %s ORDER BY name", [pid]).fetchall()
    pref = {p["id"]: f"S{i + 1}" for i, p in enumerate(profiles)}
    folders = conn.execute("SELECT * FROM cde.model_folders(%s)", [pid]).fetchall()
    fref = {f["id"]: f"C{i + 1}" for i, f in enumerate(folders)}
    roles = conn.execute(
        """SELECT r.code, r.name, r.description,
                  coalesce(json_agg(json_build_object('action', rp.action, 'scope', rp.scope)
                           ORDER BY rp.action, rp.scope) FILTER (WHERE rp.role_id IS NOT NULL), '[]') AS permissions
           FROM cde.roles r LEFT JOIN cde.role_permissions rp ON rp.role_id = r.id
           WHERE r.project_id = %s GROUP BY r.id ORDER BY r.code""", [pid]).fetchall()
    orgs = conn.execute(
        """SELECT o.code, o.legal_name, po.party_role, po.is_active FROM cde.project_organizations po
           JOIN cde.organizations o ON o.id = po.organization_id
           WHERE po.project_id = %s AND po.organization_id <> %s ORDER BY o.code""",
        [pid, project["owner_organization_id"]]).fetchall()
    if project.get("is_model"):
        people = conn.execute(
            """SELECT u.email, u.first_name, u.last_name, o.code AS organization, r.code AS role
               FROM cde.project_model_people mp JOIN cde.users u ON u.id = mp.user_id
               JOIN cde.organizations o ON o.id = u.organization_id JOIN cde.roles r ON r.id = mp.role_id
               WHERE mp.project_id = %s AND u.status = 'ACTIVE' ORDER BY u.email, r.code""", [pid]).fetchall()
    else:
        people = conn.execute(
            """SELECT u.email, u.first_name, u.last_name, o.code AS organization, r.code AS role
               FROM cde.project_memberships pm JOIN cde.users u ON u.id = pm.user_id
               JOIN cde.organizations o ON o.id = u.organization_id JOIN cde.roles r ON r.id = pm.role_id
               WHERE pm.project_id = %s AND u.status = 'ACTIVE' AND (pm.expires_at IS NULL OR pm.expires_at > now())
               ORDER BY u.email, r.code""", [pid]).fetchall()
    workflows = conn.execute(
        """SELECT DISTINCT ON (code) code, name, definition FROM cde.workflow_templates
           WHERE project_id = %s AND is_active ORDER BY code, version DESC""", [pid]).fetchall()
    library = conn.execute(
        """SELECT DISTINCT ON (code) code, name, definition FROM cde.workflow_templates
           WHERE organization_id = %s AND is_active ORDER BY code, version DESC""",
        [project["owner_organization_id"]]).fetchall()
    # persone e organizzazioni citate nei workflow: nel file vanno con email e codice, gli id non valgono altrove
    users, org_ids = set(), set()
    for w in workflows:
        d = w["definition"] or {}
        if d.get("escalation_user_id"):
            users.add(str(d["escalation_user_id"]))
        for n in d.get("nodes") or []:
            for k in ("assignees", "recipients"):
                for a in n.get(k) or []:
                    if a.get("type") == "user" and a.get("id"):
                        users.add(str(a["id"]))
                    if a.get("organization_id"):
                        org_ids.add(str(a["organization_id"]))
    cited_users = {str(r["id"]): r["email"] for r in conn.execute(
        "SELECT id, email FROM cde.users WHERE id = ANY(%s::uuid[])", [list(users)]).fetchall()} if users else {}
    cited_orgs = {str(r["id"]): r["code"] for r in conn.execute(
        "SELECT id, code FROM cde.organizations WHERE id = ANY(%s::uuid[])", [list(org_ids)]).fetchall()} if org_ids else {}
    docs = conn.execute("SELECT * FROM cde.model_documents_source(%s)", [pid]).fetchall()
    docs = [d for d in docs if d["scan_status"] == "CLEAN" and d["container_id"] in fref]
    me = conn.execute("SELECT email FROM cde.users WHERE id = cde.current_app_user()").fetchone()

    documents = []
    for i, d in enumerate(docs):
        ext = _extension(d["original_filename"])
        d["zip_path"] = f"files/{i + 1:04d}{'.' + ext if ext else ''}"
        documents.append({
            "ref": f"D{i + 1}", "folder": fref[d["container_id"]], "identifier": d["identifier"],
            "naming_fields": d["naming_fields"] or {}, "title": d["title"], "description": d["description"],
            "attributes": d["attributes"] or {}, "file": d["zip_path"], "filename": d["original_filename"],
            "content_type": d["content_type"], "size_bytes": d["size_bytes"], "sha256": bytes(d["sha256"]).hex()})
    payload = {
        "formato": FORMATO, "versione": VERSIONE, "esportato_il": datetime.now(UTC).isoformat(timespec="seconds"),
        "esportato_da": me["email"] if me else None,
        "origine": {"organizzazione": owner["code"], "ragione_sociale": owner["legal_name"],
                    "modello": bool(project.get("is_model")), "progetto_id": str(pid)},
        "progetto": {"code": project["code"], "name": project["name"], "description": project["description"],
                     "timezone": project["timezone"],
                     "settings": {k: v for k, v in (project["settings"] or {}).items() if k != "commessa"}},
        "impostazioni": {k: docset.get(k) for k in ("naming_scheme", "metadata_schema", "auto_number", "watermark")},
        "schemi_cartelle": [{"ref": pref[p["id"]], "name": p["name"], "naming_scheme": p["naming_scheme"],
                             "auto_number": p["auto_number"], "inherit": p["inherit"]} for p in profiles],
        "cartelle": [{"ref": fref[f["id"]], "parent": fref.get(f["parent_id"]), "name": f["name"], "owner": f["owner_code"],
                      "is_private": f["is_private"], "inherit_permissions": f["inherit_permissions"],
                      "naming_profile": pref.get(f["naming_profile_id"])} for f in folders],
        "ruoli": [dict(r) for r in roles],
        "organizzazioni": [dict(o) for o in orgs],
        "persone": [dict(p) for p in people],
        "workflow": [dict(w) for w in workflows],
        "libreria": [dict(w) for w in library],
        "documenti": documents,
        "utenti_citati": cited_users,
        "organizzazioni_citate": cited_orgs,
    }
    return payload, docs


def _safe_name(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip("-")[:80] or "modello"


@router.get("/projects/{project_id}/model-file")
def download_model_file(project_id: uuid.UUID, c: Ctx = Depends(ctx)):
    """"Scarica il modello": tutta la struttura (e i documenti di modello) in un file ``.cdemodello`` da conservare o
    da caricare in un'altra installazione. Da un modello o da una commessa, per il suo Project Admin."""
    limit = c.svc.settings.model_file_max_bytes
    # il file vive oltre la funzione (lo legge lo stream della risposta, che lo chiude alla fine)
    out = tempfile.SpooledTemporaryFile(max_size=16 * 1024 * 1024)  # noqa: SIM115
    try:
        with c.tx() as conn:
            if conn.execute("SELECT 1 FROM cde.projects WHERE id = %s AND is_model", [project_id]).fetchone() is None:
                conn.execute("SELECT cde.model_join()")     # un modello di cui non si è ancora entrati: si entra ora
            project = require_project(conn, project_id, "ADMIN", "PROJECT")
            payload, docs = _export_payload(conn, project)
            if sum(d["size_bytes"] for d in docs) > limit:
                raise ApiError(413, "too_large", f"I documenti di modello superano {limit // 1024 ** 2} MB: il file non "
                                                 "si potrebbe ricaricare. Togliere il segno «di modello» ai più pesanti")
            hashes: dict[str, str] = {}
            with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
                body = json.dumps(payload, ensure_ascii=False, indent=1, default=str).encode()
                zf.writestr("modello.json", body)
                hashes["modello.json"] = hashlib.sha256(body).hexdigest()
                readme = LEGGIMI.format(nome=project["name"], quando=payload["esportato_il"], chi=payload["esportato_da"],
                                        formato=FORMATO, versione=VERSIONE).encode()
                zf.writestr("LEGGIMI.txt", readme)
                hashes["LEGGIMI.txt"] = hashlib.sha256(readme).hexdigest()
                for d in docs:
                    h = hashlib.sha256()
                    with zf.open(d["zip_path"], "w", force_zip64=True) as dst:
                        for chunk in c.svc.storage.iter_object(d["storage_key"], d["storage_version_id"]):
                            h.update(chunk)
                            dst.write(chunk)
                    hashes[d["zip_path"]] = h.hexdigest()
                manifest = {"formato": FORMATO, "versione": VERSIONE, "algoritmo": "SHA-256", "file": hashes}
                zf.writestr("manifest.json", json.dumps(manifest, indent=1).encode())
            security_event(conn, "PROJECT_MODEL_EXPORTED", user_id=c.user_id, project_id=project_id, ip=c.ip,
                           documents=len(docs), workflows=len(payload["workflow"]))
    except BaseException:
        out.close()
        raise
    size = out.tell()
    out.seek(0)
    name = f"Modello-{_safe_name(project['code'])}-{_safe_name(project['name'])}{ESTENSIONE}"

    def stream():
        try:
            while chunk := out.read(1024 * 1024):
                yield chunk
        finally:
            out.close()
    return StreamingResponse(stream(), media_type="application/zip", headers={
        "Content-Disposition": f"attachment; filename=\"{name}\"; filename*=UTF-8''{quote(name)}",
        "Content-Length": str(size)})


# ---------------------------------------------------------------------
# "Carica un modello da file"
# ---------------------------------------------------------------------
def _invalid(message: str) -> ApiError:
    return ApiError(422, "invalid_model_file", message)


def _depth(value: Any, level: int = 0) -> int:
    if level > MAX_JSON_DEPTH:
        return level
    if isinstance(value, dict):
        return max([_depth(v, level + 1) for v in value.values()] or [level])
    if isinstance(value, list):
        return max([_depth(v, level + 1) for v in value] or [level])
    return level


def _read_entry(zf: zipfile.ZipFile, info: zipfile.ZipInfo, limit: int) -> bytes:
    """Contenuto di una voce, senza mai leggere oltre il tetto (anche se l'intestazione dello zip mente)."""
    with zf.open(info) as f:
        data = f.read(limit + 1)
    if len(data) > limit:
        raise _invalid(f"{info.filename}: oltre il limite di {limit // 1024} KB")
    return data


def open_model_file(fileobj, max_bytes: int) -> tuple[ModelFile, zipfile.ZipFile, dict[str, zipfile.ZipInfo]]:
    """Zip valido, solo voci attese, nessun percorso strano, tetti di dimensione, impronte del manifest corrette,
    ``modello.json`` conforme alla versione 1. Altrimenti 422 con il motivo."""
    try:
        zf = zipfile.ZipFile(fileobj)
    except (zipfile.BadZipFile, OSError):
        raise _invalid("Il file non è un modello di commessa (.cdemodello) valido") from None
    infos = zf.infolist()
    if len(infos) > MAX_ENTRIES:
        raise _invalid(f"Troppi file nel modello (massimo {MAX_ENTRIES})")
    entries: dict[str, zipfile.ZipInfo] = {}
    total = 0
    for info in infos:
        name = info.filename
        if info.is_dir() and name == "files/":
            continue
        if (name.startswith(("/", "\\")) or "\\" in name or ":" in name or ".." in name.split("/")
                or name in entries or info.is_dir() or info.flag_bits & 0x1):
            raise _invalid(f"Percorso non ammesso nel modello: {name[:120]}")
        if name not in ("modello.json", "manifest.json", "LEGGIMI.txt") and not NOME_FILE.match(name):
            raise _invalid(f"File non previsto nel modello: {name[:120]}")
        total += info.file_size
        if info.file_size > max_bytes or total > max_bytes:
            raise _invalid(f"Il contenuto del modello supera {max_bytes // 1024 ** 2} MB")
        if info.file_size > 10 * 1024 * 1024 and info.file_size > MAX_RATIO * max(info.compress_size, 1):
            raise _invalid(f"{name}: compressione anomala, file rifiutato")
        entries[name] = info
    for required in ("modello.json", "manifest.json"):
        if required not in entries:
            raise _invalid(f"Manca {required}: non è un modello di commessa")
    try:
        manifest = json.loads(_read_entry(zf, entries["manifest.json"], MAX_MANIFEST_BYTES))
    except ValueError:
        raise _invalid("manifest.json illeggibile") from None
    if not isinstance(manifest, dict) or manifest.get("formato") != FORMATO:
        raise _invalid("Non è un modello di commessa SkyTower")
    if manifest.get("versione") != VERSIONE:
        raise _invalid(f"Versione del modello {manifest.get('versione')!r} non supportata (questa installazione legge la "
                       f"versione {VERSIONE})")
    hashes = manifest.get("file")
    if not isinstance(hashes, dict) or set(hashes) != set(entries) - {"manifest.json"}:
        raise _invalid("Il manifest non corrisponde ai file del modello: file aggiunti o tolti")
    for name, info in entries.items():
        if name == "manifest.json":
            continue
        h = hashlib.sha256()
        with zf.open(info) as f:
            read = 0
            while chunk := f.read(1024 * 1024):
                read += len(chunk)
                if read > info.file_size or read > max_bytes:
                    raise _invalid(f"{name}: dimensione diversa da quella dichiarata")
                h.update(chunk)
        if not isinstance(hashes.get(name), str) or h.hexdigest() != hashes[name].lower():
            raise _invalid(f"Impronta SHA-256 di {name} diversa da quella del manifest: file rovinato o modificato")
    try:
        raw = json.loads(_read_entry(zf, entries["modello.json"], MAX_JSON_BYTES))
    except ValueError:
        raise _invalid("modello.json illeggibile") from None
    if _depth(raw) > MAX_JSON_DEPTH:
        raise _invalid("modello.json troppo annidato")
    try:
        model = ModelFile.model_validate(raw)
    except ValidationError as exc:
        first = exc.errors()[0]
        where = ".".join(str(p) for p in first["loc"])
        raise _invalid(f"modello.json non valido ({where}: {first['msg']})") from None
    if model.versione != VERSIONE:
        raise _invalid("Versione di modello.json diversa da quella del manifest")
    # riferimenti interni coerenti: schemi, cartelle (albero senza cicli), documenti e loro file
    refs_p = {p.ref for p in model.schemi_cartelle}
    refs_f = [f.ref for f in model.cartelle]
    if len(refs_p) != len(model.schemi_cartelle) or len(set(refs_f)) != len(refs_f):
        raise _invalid("Riferimenti doppi in modello.json")
    parent = {f.ref: f.parent for f in model.cartelle}
    for f in model.cartelle:
        if f.parent is not None and f.parent not in parent:
            raise _invalid(f"Cartella «{f.name}»: cartella superiore inesistente")
        if f.naming_profile is not None and f.naming_profile not in refs_p:
            raise _invalid(f"Cartella «{f.name}»: schema di naming inesistente")
        seen, cur = set(), f.ref
        while cur is not None:
            if cur in seen:
                raise _invalid("Albero delle cartelle con un ciclo")
            seen.add(cur)
            cur = parent[cur]
    files = {d.file for d in model.documenti}
    for d in model.documenti:
        if d.folder not in parent:
            raise _invalid(f"Documento {d.identifier}: cartella inesistente")
        info = entries.get(d.file)
        if info is None or not d.file.startswith("files/") or info.file_size != d.size_bytes \
                or hashes[d.file].lower() != d.sha256:
            raise _invalid(f"Documento {d.identifier}: file mancante o diverso da quello descritto")
    if len(files) != len(model.documenti) or any(n.startswith("files/") and n not in files for n in entries):
        raise _invalid("File dei documenti non coerenti con modello.json")
    return model, zf, entries


def _check_settings(model: ModelFile) -> None:
    """Gli stessi controlli del salvataggio dalle pagine: naming (anche le espressioni rischiose), metadati, rinomina
    automatica, filigrana. Un errore qui ferma l'import: un modello con un naming rotto bloccherebbe ogni caricamento."""
    label = "impostazioni"
    try:
        schemes = [(model.impostazioni.naming_scheme, model.impostazioni.auto_number, "naming della commessa")]
        schemes += [(p.naming_scheme, p.auto_number, f"schema per cartelle «{p.name}»") for p in model.schemi_cartelle]
        for raw, auto, label in schemes:
            if raw is None:
                continue
            scheme = NamingScheme.model_validate(raw)
            controlla_pattern(scheme)          # espressioni regolari rischiose (ReDoS): 422 come dalle pagine
            if auto is not None:
                scheme.check_auto_numbering(AutoNumbering.model_validate(auto))
        label = "metadati"
        if model.impostazioni.metadata_schema is not None:
            jsonschema.Draft202012Validator.check_schema(model.impostazioni.metadata_schema)
        label = "filigrana"
        if model.impostazioni.watermark is not None:
            WatermarkIn.model_validate(model.impostazioni.watermark)
        check_json_size(model.progetto.settings)
    except (ValidationError, ValueError, jsonschema.SchemaError) as exc:
        raise _invalid(f"Impostazioni del modello non valide ({label}): {str(exc)[:300]}") from None


def _remap_definition(definition: dict, users: dict[str, uuid.UUID | None], orgs: dict[str, uuid.UUID | None],
                      emails: dict[str, str], name: str) -> tuple[dict, list[str]]:
    """Persone e organizzazioni del workflow portate negli id dell'installazione di arrivo. Chi non c'è si toglie;
    un nodo rimasto senza nessuno passa al ruolo Project Admin (da rivedere), così il workflow resta valido."""
    notes: list[str] = []
    out = json.loads(json.dumps(definition))
    for node in out.get("nodes") or []:
        for key in ("assignees", "recipients"):
            if key not in node:
                continue
            kept = []
            for a in node[key] or []:
                a = dict(a)
                if a.get("type") == "user":
                    new = users.get(str(a.get("id")))
                    if new is None:
                        notes.append(f"Workflow «{name}», «{node.get('name')}»: tolta "
                                     f"{emails.get(str(a.get('id')), 'una persona')}, qui non c'è")
                        continue
                    a["id"] = str(new)
                if a.get("organization_id"):
                    new = orgs.get(str(a["organization_id"]))
                    if new is None:
                        notes.append(f"Workflow «{name}», «{node.get('name')}»: il ruolo {a.get('code')} non è più "
                                     "limitato a un'organizzazione (qui non c'è)")
                        a.pop("organization_id")
                    else:
                        a["organization_id"] = str(new)
                kept.append(a)
            if not kept and node[key]:
                kept = [{"type": "role", "code": "PROJECT_ADMIN"}]
                notes.append(f"Workflow «{name}», «{node.get('name')}»: nessuno rimasto, assegnato al Project Admin "
                             "(da rivedere)")
            node[key] = kept
    esc = out.get("escalation_user_id")
    if esc:
        new = users.get(str(esc))
        if new is None:
            out.pop("escalation_user_id")
            notes.append(f"Workflow «{name}»: tolta l'escalation verso {emails.get(str(esc), 'una persona')}")
        else:
            out["escalation_user_id"] = str(new)
    return out, notes


def import_model(c: Ctx, org_id: uuid.UUID, fileobj, name: str | None, with_library: bool) -> dict:
    model, zf, entries = open_model_file(fileobj, c.svc.settings.model_file_max_bytes)
    _check_settings(model)
    notes: list[str] = []
    m = model
    with c.tx() as conn:
        org = _own_org_admin(conn, org_id)
        mid = conn.execute("SELECT cde.create_project_model(%s, %s, %s) AS id",
                           [m.progetto.code, name or m.progetto.name, m.progetto.description]).fetchone()["id"]
        settings = {k: v for k, v in m.progetto.settings.items() if k != "commessa"}
        conn.execute("UPDATE cde.projects SET settings = %s, timezone = %s WHERE id = %s",
                     [Jsonb(settings), m.progetto.timezone, mid])
        imp = m.impostazioni
        conn.execute(
            """INSERT INTO cde.project_document_settings (project_id, naming_scheme, metadata_schema, auto_number,
                   watermark, updated_by)
               VALUES (%s, %s, coalesce(%s, '{"type": "object", "additionalProperties": true}'::jsonb), %s, %s,
                       cde.current_app_user())""",
            [mid, Jsonb(imp.naming_scheme) if imp.naming_scheme else None,
             Jsonb(imp.metadata_schema) if imp.metadata_schema else None,
             Jsonb(imp.auto_number) if imp.auto_number else None, Jsonb(imp.watermark) if imp.watermark else None])

        # organizzazioni: per codice, fra quelle con cui si lavora già o con la ricerca per codice (con il suo tetto)
        org_map: dict[str, uuid.UUID] = {org["code"]: org_id, m.origine.get("organizzazione") or org["code"]: org_id}
        codes = sorted({o.code for o in m.organizzazioni} | {f.owner for f in m.cartelle} | {p.organization for p in m.persone}
                       | set(m.organizzazioni_citate.values()))
        codes = [x for x in codes if x not in org_map]
        if codes:
            for r in conn.execute("SELECT id, code FROM cde.organizations WHERE code = ANY(%s) AND status = 'ACTIVE'",
                                  [codes]).fetchall():
                org_map[r["code"]] = r["id"]
            for code in [x for x in codes if x not in org_map]:
                if not c.svc.limiter.hit(c.svc.settings.org_lookup_rate_limit, "org-lookup", str(c.user_id)):
                    notes.append(f"Organizzazione {code} non cercata: troppe ricerche di organizzazioni, riprovare più tardi")
                    continue
                row = conn.execute("SELECT * FROM cde.lookup_organization(%s)", [code]).fetchone()
                if row:
                    org_map[code] = row["id"]
        for o in m.organizzazioni:
            if org_map.get(o.code) in (None, org_id):
                if org_map.get(o.code) is None:
                    notes.append(f"Organizzazione {o.code} ({o.legal_name}) non trovata in questa installazione: non "
                                 "aggiunta, le sue cartelle passano alla tua organizzazione")
                continue
            conn.execute("""INSERT INTO cde.project_organizations (project_id, organization_id, party_role, is_active,
                                invited_by) VALUES (%s, %s, %s, %s, cde.current_app_user()) ON CONFLICT DO NOTHING""",
                         [mid, org_map[o.code], o.party_role, o.is_active])
        participants = {r["organization_id"] for r in conn.execute(
            "SELECT organization_id FROM cde.project_organizations WHERE project_id = %s", [mid]).fetchall()}

        # ruoli personalizzati (quelli di sistema ci sono già, per codice)
        roles = {r["code"]: r["id"] for r in conn.execute("SELECT id, code FROM cde.roles WHERE project_id IS NULL").fetchall()}
        for r in m.ruoli:
            if r.code in roles:
                notes.append(f"Ruolo {r.code}: c'è già un ruolo di sistema con questo codice, usato quello")
                continue
            rid = uuid.uuid4()
            conn.execute("INSERT INTO cde.roles (id, project_id, code, name, description) VALUES (%s, %s, %s, %s, %s)",
                         [rid, mid, r.code, r.name, r.description])
            for p in {(p.action, p.scope) for p in r.permissions}:
                conn.execute("INSERT INTO cde.role_permissions (role_id, action, scope) VALUES (%s, %s, %s)", [rid, *p])
            roles[r.code] = rid

        # persone: per email, solo se sono della tua organizzazione o di un'organizzazione del modello
        people_ids: dict[str, uuid.UUID] = {}
        emails = sorted({p.email.lower() for p in m.persone} | {e.lower() for e in m.utenti_citati.values()})
        found = {r["email"].lower(): r for r in conn.execute(
            "SELECT id, email, organization_id FROM cde.users WHERE lower(email) = ANY(%s) AND status = 'ACTIVE'",
            [emails]).fetchall()} if emails else {}
        for email, u in found.items():
            if u["organization_id"] in participants:
                people_ids[email] = u["id"]
        for p in m.persone:
            uid = people_ids.get(p.email.lower())
            if uid is None:
                notes.append(f"Persona {p.email} saltata: non c'è nella tua organizzazione né nelle organizzazioni "
                             "del modello")
                continue
            if p.role not in roles:
                notes.append(f"Persona {p.email} saltata: il ruolo {p.role} non c'è")
                continue
            conn.execute("""INSERT INTO cde.project_model_people (project_id, user_id, role_id, added_by)
                            VALUES (%s, %s, %s, cde.current_app_user()) ON CONFLICT DO NOTHING""",
                         [mid, uid, roles[p.role]])

        # schemi per cartelle e cartelle (quelle di organizzazioni assenti passano alla propria)
        profiles: dict[str, uuid.UUID] = {}
        for p in m.schemi_cartelle:
            pid = uuid.uuid4()
            conn.execute("""INSERT INTO cde.naming_profiles (id, project_id, name, naming_scheme, auto_number, inherit,
                                created_by, updated_by)
                            VALUES (%s, %s, %s, %s, %s, %s, cde.current_app_user(), cde.current_app_user())""",
                         [pid, mid, p.name, Jsonb(p.naming_scheme), Jsonb(p.auto_number) if p.auto_number else None,
                          p.inherit])
            profiles[p.ref] = pid
        folders: dict[str, uuid.UUID] = {}
        pending = list(m.cartelle)
        while pending:                      # padri prima dei figli (l'albero è già controllato: niente cicli)
            rest = []
            for f in pending:
                if f.parent is not None and f.parent not in folders:
                    rest.append(f)
                    continue
                owner = org_map.get(f.owner)
                if owner not in participants:
                    owner = org_id
                folders[f.ref] = conn.execute(
                    "SELECT cde.model_import_folder(%s, %s, %s, %s, %s, %s, %s) AS id",
                    [mid, folders.get(f.parent), owner, f.name, f.is_private, f.inherit_permissions,
                     profiles.get(f.naming_profile)]).fetchone()["id"]
            pending = rest

        # workflow del modello: persone e organizzazioni riportate, poi il validatore del grafo
        user_map = {old: people_ids.get(email.lower()) for old, email in m.utenti_citati.items()}
        orgs_by_id = {old: org_map.get(code) if org_map.get(code) in participants else None
                      for old, code in m.organizzazioni_citate.items()}
        for w in m.workflow:
            try:
                definition = wg.normalize(w.definition)
                definition, wnotes = _remap_definition(definition, user_map, orgs_by_id, m.utenti_citati, w.name)
                definition = wg.normalize(definition)
            except wg.GraphInvalid as exc:
                notes.append(f"Workflow «{w.name}» non caricato: {exc.errors[0]['message']}")
                continue
            notes += wnotes
            workflow_library.save(conn, code=w.code, name=w.name, definition=definition, project_id=mid)

        # appendice: workflow della libreria che qui non ci sono
        if with_library and m.libreria:
            present = {r["code"] for r in conn.execute(
                "SELECT code FROM cde.workflow_templates WHERE organization_id = %s AND is_active", [org_id]).fetchall()}
            for w in m.libreria:
                if w.code in present:
                    notes.append(f"Libreria: «{w.name}» ({w.code}) c'è già, lasciato com'è")
                    continue
                try:
                    definition = wg.normalize(w.definition, library=True)
                except wg.GraphInvalid as exc:
                    notes.append(f"Libreria: «{w.name}» non caricato: {exc.errors[0]['message']}")
                    continue
                workflow_library.save(conn, code=w.code, name=w.name, definition=definition, organization_id=org_id)
                notes.append(f"Libreria: aggiunto «{w.name}» ({w.code}), vale in tutte le commesse dell'organizzazione")

        # documenti di modello: file dallo zip a S3 con una chiave nuova, prima revisione WIP
        project = require_project(conn, mid)
        for d in m.documenti:
            dst = folders[d.folder]
            ext = _extension(d.filename)
            identifier, fields = _identifier(conn, project, dst, d.naming_fields, d.identifier, m.progetto.code, ext)
            key = f"projects/{mid}/files/{uuid.uuid4()}"
            with zf.open(entries[d.file]) as src:
                version = c.svc.storage.put_fileobj(key, src, d.content_type)
            conn.execute(
                "SELECT cde.model_insert_document(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                [mid, dst, identifier, Jsonb(fields), d.title, d.description, Jsonb(d.attributes), key, version,
                 d.size_bytes, d.content_type, bytes.fromhex(d.sha256), f"{identifier}.{ext}" if ext else identifier,
                 next_wip_revision(None), f"Documento di modello caricato da file ({d.filename})", True])
        security_event(conn, "PROJECT_MODEL_IMPORTED", user_id=c.user_id, organization_id=org_id, project_id=mid,
                       ip=c.ip, source_org=m.origine.get("organizzazione"), exported_at=m.esportato_il,
                       documents=len(m.documenti), changes=len(notes))
        return {**_model_row(conn, mid), "changes": notes}


@router.post("/organizations/{org_id}/project-models/import", status_code=201)
async def upload_model_file(org_id: uuid.UUID, request: Request, name: str | None = Query(default=None, min_length=2,
                            max_length=200), with_library: bool = True, c: Ctx = Depends(ctx)):
    """"Carica un modello da file": corpo = il file ``.cdemodello``. Ricrea un modello di commessa identico
    nell'organizzazione e restituisce in ``changes`` l'elenco delle cose adattate."""
    limit = c.svc.settings.model_file_max_bytes
    with tempfile.SpooledTemporaryFile(max_size=16 * 1024 * 1024) as buf:
        size = 0
        async for chunk in request.stream():           # tetto anche senza Content-Length (corpo "chunked")
            size += len(chunk)
            if size > limit:
                raise ApiError(413, "too_large", f"File oltre {limit // 1024 ** 2} MB")
            buf.write(chunk)
        if size == 0:
            raise _invalid("File vuoto")
        buf.seek(0)
        return await run_in_threadpool(import_model, c, org_id, buf, name, with_library)

