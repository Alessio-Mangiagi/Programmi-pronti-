# "><(((º> sabusabu <º)))><"
"""Libreria dei workflow dell'organizzazione (ADR-50, ``docs/workflow-grafo.md`` §5, migrazione 0041).

I modelli di workflow non stanno più solo dentro una commessa: l'amministratore dell'organizzazione li disegna una
volta nella libreria e ogni commessa di cui l'organizzazione è proprietaria li vede e li avvia direttamente
(collegamento vivo). Una nuova versione in libreria vale per gli avvii successivi; le istanze in corso restano
sulla versione con cui sono partite (puntano a un ``template_id`` preciso). Chi vuole una variante locale fa
"Copia nella commessa": diventa un modello del progetto, adattato con ``workflows._adapt``.

Nei modelli di libreria assegnatari e destinatari sono solo ruoli (``workflow_graph.library_errors``): le persone
cambiano da commessa a commessa. All'avvio in una commessa ogni compito deve avere qualcuno con quel ruolo,
altrimenti 422 con l'elenco dei nodi (``check_library_roles``; il database fa lo stesso controllo).

Rotte:
- ``GET/POST /organizations/{id}/workflow-library``: elenco; salvataggio (stesso codice ⇒ nuova versione);
- ``POST /organizations/{id}/workflow-library/validate``: validazione senza salvare, per l'editor;
- ``GET /organizations/{id}/workflow-library/roles``: i ruoli da scegliere nell'editor della libreria;
- ``POST /organizations/{id}/workflow-library/from-project``: pubblica in libreria la copia di un modello di
  una commessa (persone tolte e segnalate);
- ``PATCH /workflow-library/{template_id}``: nome, attiva/disattiva;
- ``POST /projects/{id}/workflow-templates/from-library``: copia locale nella commessa.
L'elenco dei modelli della commessa (``GET /projects/{id}/workflow-templates``) aggiunge quelli della libreria
con ``scope: "LIBRARY"`` (``library_for_project``), così Processi e il dialogo di avvio li vedono già.
"""
from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from ..deps import Ctx, ctx, require_project
from ..errors import ApiError, forbidden, not_found
from ..events import security_event
from . import workflow_graph as wg
from .workflows import TemplateIn, TemplatePatch, ValidateIn, _adapt, _normalized

router = APIRouter(tags=["workflow-library"])

# colonne di un modello come le vede la pagina (anche quelle della 0041: ambito e provenienza)
COLS = ("t.id, t.organization_id, t.project_id, t.code, t.version, t.name, t.subject, t.definition, t.is_active, "
        "t.created_at, t.source_template_id")


class CopyIn(BaseModel):
    template_id: uuid.UUID
    code: str | None = Field(default=None, pattern=r"^[A-Z][A-Z0-9_]{1,40}$")   # None = stesso codice
    name: str | None = Field(default=None, min_length=2, max_length=200)


# ---------------------------------------------------------------------
# Regole comuni
# ---------------------------------------------------------------------
def _org(conn, org_id: uuid.UUID) -> dict:
    """L'organizzazione della libreria: la propria (o qualunque per il platform admin); altrimenti 404.

    La libreria di un'altra organizzazione non si apre dalla pagina dell'organizzazione nemmeno se se ne usano i
    modelli in una sua commessa: lì si vedono dall'elenco dei modelli della commessa."""
    row = conn.execute(
        """SELECT id, legal_name, code, cde.can_manage_org(id) AS can_manage FROM cde.organizations
           WHERE id = %s AND (id = cde.current_app_org() OR cde.current_app_is_platform_admin())""", [org_id]).fetchone()
    if row is None:
        raise not_found("Organizzazione")
    return row


def _admin(conn, org_id: uuid.UUID) -> dict:
    org = _org(conn, org_id)
    if not org["can_manage"]:
        raise forbidden("Solo l'amministratore dell'organizzazione crea e modifica i modelli della libreria")
    return org


def _normalized_library(definition: dict, subject: str | None = None) -> dict:
    """Definizione validata con le regole della libreria (solo ruoli), oppure 422 con gli errori per l'editor."""
    try:
        return wg.normalize(definition, subject, library=True)
    except wg.GraphInvalid as exc:
        raise ApiError(422, "invalid_workflow", f"Workflow non valido: {exc.errors[0]['message']}",
                       extra={"errors": exc.errors}) from None


def save(conn, *, code: str, name: str, definition: dict, project_id: uuid.UUID | None = None,
         organization_id: uuid.UUID | None = None, source: uuid.UUID | None = None) -> dict:
    """Salva un modello di progetto o di libreria: stesso codice nello stesso ambito ⇒ nuova versione, le
    precedenti si disattivano (come ``workflows._save_template``, più organizzazione e provenienza)."""
    col, val = ("project_id", project_id) if project_id else ("organization_id", organization_id)
    version = conn.execute(f"SELECT coalesce(max(version), 0) + 1 AS v FROM cde.workflow_templates "
                           f"WHERE {col} = %s AND code = %s", [val, code]).fetchone()["v"]
    conn.execute(f"UPDATE cde.workflow_templates SET is_active = false WHERE {col} = %s AND code = %s AND is_active",
                 [val, code])
    tid = uuid.uuid4()
    conn.execute(
        """INSERT INTO cde.workflow_templates (id, project_id, organization_id, code, version, name, definition,
                                              source_template_id, created_by)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, cde.current_app_user())""",
        [tid, project_id, organization_id, code, version, name, Jsonb(definition), source])
    return conn.execute(f"SELECT {COLS} FROM cde.workflow_templates t WHERE t.id = %s", [tid]).fetchone()


def library_for_project(conn, project: dict, subject: str | None = None) -> list[dict]:
    """Modelli attivi della libreria dell'organizzazione proprietaria della commessa, per l'elenco della commessa.

    Solo gli attivi: una versione disattivata in libreria non si avvia più da nessuna parte (le istanze già
    partite restano sulla loro). ``scope`` e ``organization_name`` servono a Processi e al dialogo di avvio
    per il bollino "Libreria"."""
    return conn.execute(
        f"""SELECT {COLS}, 'LIBRARY' AS scope, o.legal_name AS organization_name
            FROM cde.workflow_templates t LEFT JOIN cde.organizations o ON o.id = t.organization_id
            WHERE t.organization_id = %(o)s AND t.is_active"""
        + (" AND t.subject = %(s)s" if subject else "") + " ORDER BY t.code, t.version DESC",
        {"o": project["owner_organization_id"], "s": subject}).fetchall()


def library_template(conn, template_id: uuid.UUID, project: dict) -> dict | None:
    """Il modello di libreria se appartiene all'organizzazione proprietaria della commessa, altrimenti None."""
    return conn.execute(f"SELECT {COLS} FROM cde.workflow_templates t WHERE t.id = %s AND t.organization_id = %s",
                        [template_id, project["owner_organization_id"]]).fetchone()


def check_library_roles(conn, template: dict, project_id: uuid.UUID, originator: uuid.UUID | None) -> None:
    """Modello di libreria: ogni decisione e attività deve avere qualcuno con quel ruolo nella commessa.

    Un compito senza assegnatari bloccherebbe il flusso a metà (il motore si ferma quando il nodo si attiva):
    meglio dirlo subito, con l'elenco dei nodi. Il database ripete il controllo all'avvio."""
    if template.get("organization_id") is None:
        return
    rows = conn.execute("SELECT node_id, node_name, roles FROM cde.wf_unassigned_nodes(%s, %s, %s)",
                        [project_id, originator, Jsonb(template["definition"])]).fetchall()
    if rows:
        errors = [wg.err(f"«{r['node_name']}»: nessuno ha il ruolo {r['roles'] or '—'} in questa commessa",
                         node=r["node_id"]) for r in rows]
        elenco = ", ".join(f"«{r['node_name']}» ({r['roles'] or '—'})" for r in rows)
        raise ApiError(422, "roles_missing",
                       f"Il modello di libreria «{template['name']}» non si può avviare in questa commessa: nessuno ha "
                       f"il ruolo richiesto per {elenco}. Assegnare il ruolo a qualcuno nella scheda Membri, oppure "
                       "copiare il modello nella commessa e modificarlo", extra={"errors": errors})


def _to_library(conn, definition: dict) -> tuple[dict, list[str]]:
    """Copia di un modello di commessa adattata alla libreria: persone e limiti di organizzazione tolti.

    Restituisce la definizione e le modifiche fatte, da mostrare a chi pubblica. Se un nodo resterebbe senza
    assegnatari (aveva solo persone) è un 422 che elenca i nodi: va prima aggiunto un ruolo nella commessa."""
    people = [a["id"] for n in definition["nodes"] for k in ("assignees", "recipients") for a in n.get(k) or []
              if a.get("type") == "user"] + ([definition["escalation_user_id"]] if definition.get("escalation_user_id") else [])
    names = {str(r["id"]): r["name"] for r in conn.execute(
        "SELECT id, first_name || ' ' || last_name AS name FROM cde.users WHERE id = ANY(%s::uuid[])",
        [people]).fetchall()} if people else {}
    notes: list[str] = []
    empty: list[dict] = []
    nodes = []
    for node in definition["nodes"]:
        node = dict(node)
        for key in ("assignees", "recipients"):
            if key not in node:
                continue
            kept = []
            for a in node[key]:
                if a["type"] == "user":
                    notes.append(f"«{node['name']}»: tolta {names.get(str(a['id']), 'una persona')}, nella libreria "
                                 "valgono solo i ruoli")
                    continue
                if a.get("organization_id"):
                    a = {k: v for k, v in a.items() if k != "organization_id"}
                    notes.append(f"«{node['name']}»: il ruolo {a['code']} non è più limitato a un'organizzazione")
                kept.append(a)
            if not kept:
                what = "destinatari" if key == "recipients" else "assegnatari"
                empty.append(wg.err(f"«{node['name']}» resterebbe senza {what}: nella libreria valgono solo i ruoli",
                                    node=node["id"]))
            node[key] = kept
        nodes.append(node)
    if empty:
        raise ApiError(422, "step_without_assignees",
                       f"{empty[0]['message']}. Aggiungere un ruolo al nodo nel modello della commessa e pubblicare di "
                       "nuovo", extra={"errors": empty})
    out = {**definition, "nodes": nodes}
    if out.pop("escalation_user_id", None):
        notes.append(f"Tolta l'escalation verso {names.get(str(definition['escalation_user_id']), 'una persona')}: "
                     "se un compito scade sono avvisati i Project Admin della commessa")
    return out, notes


# ---------------------------------------------------------------------
# Libreria dell'organizzazione
# ---------------------------------------------------------------------
@router.get("/organizations/{org_id}/workflow-library")
def list_library(org_id: uuid.UUID, include_inactive: bool = False,
                 subject: Literal["DOCUMENT", "PROCESS"] | None = None, c: Ctx = Depends(ctx)):
    """Modelli della libreria: li vede chi è dell'organizzazione, li gestisce l'amministratore."""
    with c.tx() as conn:
        _org(conn, org_id)
        return conn.execute(
            f"SELECT {COLS}, 'LIBRARY' AS scope FROM cde.workflow_templates t WHERE t.organization_id = %(o)s"
            + ("" if include_inactive else " AND t.is_active") + (" AND t.subject = %(s)s" if subject else "")
            + " ORDER BY t.code, t.version DESC", {"o": org_id, "s": subject}).fetchall()


@router.get("/organizations/{org_id}/workflow-library/roles")
def library_roles(org_id: uuid.UUID, c: Ctx = Depends(ctx)):
    """Ruoli da scegliere nell'editor della libreria: quelli di sistema e quelli personalizzati delle commesse
    dell'organizzazione che l'utente vede (un codice per ruolo; il nome di sistema prevale)."""
    with c.tx() as conn:
        _org(conn, org_id)
        return conn.execute(
            """SELECT DISTINCT ON (r.code) r.id, r.code, r.name, r.description, r.project_id IS NULL AS is_system
               FROM cde.roles r
               WHERE r.project_id IS NULL
                  OR r.project_id IN (SELECT p.id FROM cde.projects p WHERE p.owner_organization_id = %s)
               ORDER BY r.code, (r.project_id IS NULL) DESC""", [org_id]).fetchall()


@router.post("/organizations/{org_id}/workflow-library", status_code=201)
def create_library_template(org_id: uuid.UUID, body: TemplateIn, c: Ctx = Depends(ctx)):
    """Salva un modello in libreria (stesso codice ⇒ nuova versione, vale per gli avvii successivi)."""
    with c.tx() as conn:
        _admin(conn, org_id)
        definition = _normalized_library(body.definition, body.subject)
        row = save(conn, code=body.code, name=body.name, definition=definition, organization_id=org_id)
        security_event(conn, "WORKFLOW_LIBRARY_SAVED", user_id=c.user_id, organization_id=org_id, ip=c.ip,
                       template=row["id"], code=body.code, version=row["version"], subject=row["subject"])
        return {**row, "scope": "LIBRARY"}


@router.post("/organizations/{org_id}/workflow-library/validate")
def validate_library_template(org_id: uuid.UUID, body: ValidateIn, c: Ctx = Depends(ctx)):
    """Stessa validazione del salvataggio (grafo + solo ruoli), senza salvare: l'editor la usa mentre si disegna."""
    with c.tx() as conn:
        _admin(conn, org_id)
    try:
        definition = wg.normalize(body.definition, body.subject, library=True)
    except wg.GraphInvalid as exc:
        return {"ok": False, "errors": exc.errors}
    return {"ok": True, "errors": [], "definition": definition}


@router.post("/organizations/{org_id}/workflow-library/from-project", status_code=201)
def publish_from_project(org_id: uuid.UUID, body: CopyIn, c: Ctx = Depends(ctx)):
    """Pubblica in libreria la copia di un modello di una commessa dell'organizzazione (o di cui si è Project Admin).

    Il modello della commessa resta com'è; la copia in libreria perde persone, limiti di organizzazione ed
    escalation verso una persona (elencati in ``changes``)."""
    with c.tx() as conn:
        _admin(conn, org_id)
        src = conn.execute(
            f"""SELECT {COLS}, p.owner_organization_id FROM cde.workflow_templates t
                JOIN cde.projects p ON p.id = t.project_id WHERE t.id = %s""", [body.template_id]).fetchone()
        if src is None:
            raise not_found("Modello di workflow")
        if src["owner_organization_id"] != org_id and not conn.execute(
                "SELECT cde.has_project_permission(cde.current_app_user(), %s, 'ADMIN', 'PROJECT') ok",
                [src["project_id"]]).fetchone()["ok"]:
            raise forbidden("Si pubblicano in libreria i modelli delle commesse dell'organizzazione")
        adapted, notes = _to_library(conn, _normalized(src["definition"]))
        definition = _normalized_library(adapted)
        code, name = body.code or src["code"], body.name or src["name"]
        row = save(conn, code=code, name=name, definition=definition, organization_id=org_id, source=src["id"])
        security_event(conn, "WORKFLOW_LIBRARY_PUBLISHED", user_id=c.user_id, organization_id=org_id,
                       project_id=src["project_id"], ip=c.ip, template=row["id"], code=code, version=row["version"],
                       source=src["id"], changes=len(notes))
        return {**row, "scope": "LIBRARY", "changes": notes}


@router.patch("/workflow-library/{template_id}")
def update_library_template(template_id: uuid.UUID, body: TemplatePatch, c: Ctx = Depends(ctx)):
    """Nome o attivazione di una versione: disattivata non si avvia più (le istanze in corso proseguono)."""
    changes = body.model_dump(exclude_unset=True)
    with c.tx() as conn:
        t = conn.execute("SELECT organization_id FROM cde.workflow_templates WHERE id = %s AND organization_id IS NOT NULL",
                         [template_id]).fetchone()
        if t is None:
            raise not_found("Modello di workflow")
        _admin(conn, t["organization_id"])
        if changes:
            conn.execute("UPDATE cde.workflow_templates SET " + ", ".join(f"{k} = %({k})s" for k in changes)
                         + " WHERE id = %(_key)s", {**changes, "_key": template_id})
            security_event(conn, "WORKFLOW_LIBRARY_UPDATED", user_id=c.user_id, organization_id=t["organization_id"],
                           ip=c.ip, template=template_id, **changes)
        return {**conn.execute(f"SELECT {COLS} FROM cde.workflow_templates t WHERE t.id = %s", [template_id]).fetchone(),
                "scope": "LIBRARY"}


# ---------------------------------------------------------------------
# Copia locale nella commessa
# ---------------------------------------------------------------------
@router.post("/projects/{project_id}/workflow-templates/from-library", status_code=201)
def copy_to_project(project_id: uuid.UUID, body: CopyIn, c: Ctx = Depends(ctx)):
    """"Copia nella commessa": il modello di libreria diventa un modello del progetto, da modificare a piacere.

    Da quel momento non segue più la libreria (è una copia, ``source_template_id`` ricorda da dove viene).
    Stesso codice di un modello già nella commessa ⇒ ne diventa la nuova versione, come un import."""
    with c.tx() as conn:
        project = require_project(conn, project_id, "ADMIN", "PROJECT")
        lib = library_template(conn, body.template_id, project)
        if lib is None:
            raise not_found("Modello della libreria")
        # i ruoli che qui non esistono si segnalano (copy_roles=False: in libreria non c'è un progetto da cui copiarli)
        adapted, notes = _adapt(conn, project_id, None, _normalized(lib["definition"]), False)
        definition = _normalized(adapted)
        code, name = body.code or lib["code"], body.name or lib["name"]
        row = save(conn, code=code, name=name, definition=definition, project_id=project_id, source=lib["id"])
        security_event(conn, "WORKFLOW_TEMPLATE_FROM_LIBRARY", user_id=c.user_id, project_id=project_id, ip=c.ip,
                       template=row["id"], code=code, version=row["version"], source=lib["id"], changes=len(notes))
        return {**row, "scope": "PROJECT", "changes": notes}
