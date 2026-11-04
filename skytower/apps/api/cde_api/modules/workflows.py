# "><(((º> sabusabu <º)))><"
"""Workflow a grafo (ADR-48, ``docs/workflow-grafo.md``): modelli, avvio su documenti e processi, compiti.

Un modello è un grafo (versione 2) validato in ``workflow_graph``; l'esecuzione avviene nel database
(``cde.workflow_start``, ``cde.workflow_start_process``, ``cde.workflow_complete_task``, ``cde.workflow_cancel``,
migrazione 0039), che garantisce atomicità, quorum, rami paralleli, riunioni e blocco del documento.

Rotte:
- modelli: elenco, salvataggio (anche da definizione versione 1, convertita), validazione senza salvare,
  import da un altro progetto (ADR-39);
- istanze: ``GET /workflow-instances/{id}`` con tutto ciò che serve alla vista finale (definizione, giri dei
  nodi con i compiti, archi percorsi, documenti allegati); ``/workflows/{id}`` resta con la forma di prima
  (``steps``) per le pagine che la usano;
- processi: avvio ed elenco per progetto;
- compiti: ``/me/tasks`` (con gli esiti del nodo per i pulsanti) e completamento con l'esito scelto.
"""
from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from ..deps import Ctx, ctx, require_project
from ..errors import ApiError, not_found
from ..events import security_event
from . import workflow_graph as wg

router = APIRouter(tags=["workflows"])


# ---------------------------------------------------------------------
# Versione 1 (lista di passi): ancora accettata in ingresso e convertita
# ---------------------------------------------------------------------
class Step(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    assignees: list[wg.Assignee] = Field(min_length=1, max_length=20)
    quorum: Literal["ALL", "ANY"] | wg.QuorumN = "ALL"
    sla_hours: int | None = Field(default=None, ge=1, le=24 * 90)


class DefinitionV1(BaseModel):
    steps: list[Step] = Field(min_length=1, max_length=20)
    on_approved: wg.OnCompleted | None = None
    escalation_user_id: uuid.UUID | None = None


class TemplateIn(BaseModel):
    code: str = Field(pattern=r"^[A-Z][A-Z0-9_]{1,40}$")
    name: str = Field(min_length=2, max_length=200)
    subject: Literal["DOCUMENT", "PROCESS"] | None = None     # se manca vale quello nella definizione
    definition: dict


class ValidateIn(BaseModel):
    subject: Literal["DOCUMENT", "PROCESS"] | None = None
    definition: dict


class TemplatePatch(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=200)
    is_active: bool | None = None


class StartIn(BaseModel):
    template_id: uuid.UUID
    comment: str | None = Field(default=None, max_length=2000)


class ProcessIn(BaseModel):
    template_id: uuid.UUID
    title: str = Field(min_length=2, max_length=200)
    description: str | None = Field(default=None, max_length=4000)
    document_ids: list[uuid.UUID] = Field(default_factory=list, max_length=50)


class CompleteIn(BaseModel):
    outcome: str = Field(pattern=wg.OUTCOME_CODE)
    comment: str | None = Field(default=None, max_length=4000)


class CancelIn(BaseModel):
    reason: str = Field(min_length=3, max_length=2000)


TEMPLATE_COLS = "id, project_id, code, version, name, subject, definition, is_active, created_at"


def _normalized(definition: dict, subject: str | None = None) -> dict:
    """Definizione in versione 2 validata, oppure 422 con l'elenco degli errori per l'editor."""
    try:
        return wg.normalize(definition, subject)
    except wg.GraphInvalid as exc:
        raise ApiError(422, "invalid_workflow", f"Workflow non valido: {exc.errors[0]['message']}",
                       extra={"errors": exc.errors}) from None


def _check_escalation(conn, project_id: uuid.UUID, definition: dict) -> None:
    esc = definition.get("escalation_user_id")
    if esc and conn.execute("SELECT 1 FROM cde.project_memberships WHERE project_id = %s AND user_id = %s",
                            [project_id, esc]).fetchone() is None:
        # l'escalation porta identificativi e nomi: solo verso chi è nel progetto (B1)
        raise ApiError(422, "escalation_not_member", "La persona per l'escalation deve essere membro del progetto")


def _save_template(conn, project_id: uuid.UUID, code: str, name: str, definition: dict) -> uuid.UUID:
    """Stesso codice ⇒ nuova versione; le versioni precedenti vengono disattivate."""
    version = conn.execute("SELECT coalesce(max(version), 0) + 1 AS v FROM cde.workflow_templates "
                           "WHERE project_id = %s AND code = %s", [project_id, code]).fetchone()["v"]
    conn.execute("UPDATE cde.workflow_templates SET is_active = false WHERE project_id = %s AND code = %s",
                 [project_id, code])
    tid = uuid.uuid4()
    conn.execute(
        """INSERT INTO cde.workflow_templates (id, project_id, code, version, name, definition, created_by)
           VALUES (%s, %s, %s, %s, %s, %s, cde.current_app_user())""",
        [tid, project_id, code, version, name, Jsonb(definition)])
    return tid


@router.get("/projects/{project_id}/workflow-templates")
def list_templates(project_id: uuid.UUID, include_inactive: bool = False,
                   subject: Literal["DOCUMENT", "PROCESS"] | None = None, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        require_project(conn, project_id)
        return conn.execute(
            f"SELECT {TEMPLATE_COLS} FROM cde.workflow_templates WHERE project_id = %(p)s"
            + ("" if include_inactive else " AND is_active") + (" AND subject = %(s)s" if subject else "")
            + " ORDER BY code, version DESC", {"p": project_id, "s": subject}).fetchall()


@router.post("/projects/{project_id}/workflow-templates", status_code=201)
def create_template(project_id: uuid.UUID, body: TemplateIn, c: Ctx = Depends(ctx)):
    """Salva un modello (grafo, o lista di passi della versione 1 che viene convertita)."""
    with c.tx() as conn:
        require_project(conn, project_id, "ADMIN", "PROJECT")
        definition = _normalized(body.definition, body.subject)
        _check_escalation(conn, project_id, definition)
        tid = _save_template(conn, project_id, body.code, body.name, definition)
        row = conn.execute(f"SELECT {TEMPLATE_COLS} FROM cde.workflow_templates WHERE id = %s", [tid]).fetchone()
        security_event(conn, "WORKFLOW_TEMPLATE_SAVED", user_id=c.user_id, project_id=project_id, ip=c.ip,
                       template=tid, code=body.code, version=row["version"], subject=row["subject"])
        return row


@router.post("/projects/{project_id}/workflow-templates/validate")
def validate_template(project_id: uuid.UUID, body: ValidateIn, c: Ctx = Depends(ctx)):
    """Stessa validazione del salvataggio, senza salvare: l'editor la usa mentre si disegna."""
    with c.tx() as conn:
        require_project(conn, project_id, "ADMIN", "PROJECT")
    try:
        definition = wg.normalize(body.definition, body.subject)
    except wg.GraphInvalid as exc:
        return {"ok": False, "errors": exc.errors}
    return {"ok": True, "errors": [], "definition": definition}


class ImportIn(BaseModel):
    template_id: uuid.UUID
    code: str | None = Field(default=None, pattern=r"^[A-Z][A-Z0-9_]{1,40}$")   # None = stesso codice
    name: str | None = Field(default=None, min_length=2, max_length=200)
    copy_roles: bool = True        # ruoli personalizzati usati dal workflow e assenti qui: si creano uguali


@router.get("/projects/{project_id}/workflow-templates/importable")
def importable_templates(project_id: uuid.UUID, c: Ctx = Depends(ctx)):
    """Workflow attivi di altri progetti di cui si è Project Admin, da importare in questo (ADR-39)."""
    with c.tx() as conn:
        require_project(conn, project_id, "ADMIN", "PROJECT")
        return conn.execute(
            """SELECT t.id, t.code, t.version, t.name, t.subject, t.definition, p.id AS project_id,
                      p.code AS project_code, p.name AS project_name,
                      EXISTS (SELECT 1 FROM cde.workflow_templates x WHERE x.project_id = %(p)s AND x.code = t.code)
                        AS exists_here
               FROM cde.workflow_templates t JOIN cde.projects p ON p.id = t.project_id
               WHERE t.is_active AND t.project_id <> %(p)s
                 AND cde.has_project_permission(cde.current_app_user(), t.project_id, 'ADMIN', 'PROJECT')
               ORDER BY p.name, t.code""", {"p": project_id}).fetchall()


def _adapt(conn, project_id: uuid.UUID, source_project: uuid.UUID, definition: dict,
           copy_roles: bool) -> tuple[dict, list[str]]:
    """Il workflow adattato al progetto di destinazione e l'elenco delle modifiche fatte.

    Persone e organizzazioni che qui non ci sono si tolgono (un compito darebbe accesso al documento a chi non è nel
    progetto); i ruoli personalizzati mancanti si creano uguali a quelli di partenza, oppure si segnalano.
    Vale per gli assegnatari di decisioni e attività e per i destinatari delle notifiche."""
    members = {r["user_id"] for r in conn.execute(
        "SELECT user_id FROM cde.project_memberships WHERE project_id = %s", [project_id]).fetchall()}
    orgs = {r["organization_id"] for r in conn.execute(
        "SELECT organization_id FROM cde.project_organizations WHERE project_id = %s", [project_id]).fetchall()}
    roles = {r["code"] for r in conn.execute(
        "SELECT code FROM cde.roles WHERE project_id IS NULL OR project_id = %s", [project_id]).fetchall()}
    people = [a["id"] for n in definition["nodes"] for k in ("assignees", "recipients") for a in n.get(k) or []
              if a.get("id")] + ([definition["escalation_user_id"]] if definition.get("escalation_user_id") else [])
    names = {r["id"]: r["name"] for r in conn.execute(
        "SELECT id, first_name || ' ' || last_name AS name FROM cde.users WHERE id = ANY(%s)", [people]).fetchall()}
    notes: list[str] = []
    nodes = []
    for node in definition["nodes"]:
        node = dict(node)
        for key in ("assignees", "recipients"):
            if key not in node:
                continue
            kept = []
            for a in node[key]:
                if a["type"] == "user" and uuid.UUID(str(a["id"])) not in members:
                    notes.append(f"«{node['name']}»: tolta {names.get(uuid.UUID(str(a['id'])), 'una persona')}, "
                                 "non è in questo progetto")
                    continue
                if a.get("organization_id") and uuid.UUID(str(a["organization_id"])) not in orgs:
                    notes.append(f"«{node['name']}»: tolto il ruolo {a['code']} limitato a un'organizzazione che qui "
                                 "non partecipa")
                    continue
                if a["type"] != "user" and a["code"] not in roles:
                    source = conn.execute("SELECT id, name, description FROM cde.roles WHERE project_id = %s AND code = %s",
                                          [source_project, a["code"]]).fetchone()
                    if copy_roles and source:
                        rid = uuid.uuid4()
                        conn.execute("INSERT INTO cde.roles (id, project_id, code, name, description) "
                                     "VALUES (%s, %s, %s, %s, %s)", [rid, project_id, a["code"], source["name"],
                                                                     source["description"]])
                        conn.execute("INSERT INTO cde.role_permissions (role_id, action, scope) "
                                     "SELECT %s, action, scope FROM cde.role_permissions WHERE role_id = %s",
                                     [rid, source["id"]])
                        roles.add(a["code"])
                        notes.append(f"Creato il ruolo {a['code']} ({source['name']}), uguale a quello di partenza: "
                                     "assegnarlo alle persone")
                    else:
                        notes.append(f"«{node['name']}»: il ruolo {a['code']} qui non esiste, nessuno riceverà il "
                                     "compito finché non lo si crea")
                kept.append(a)
            if not kept:
                what = "destinatari" if key == "recipients" else "assegnatari"
                raise ApiError(422, "step_without_assignees",
                               f"Lo step «{node['name']}» resterebbe senza {what} in questo progetto: "
                               "aggiungere le persone al progetto o modificarlo nel progetto di partenza")
            node[key] = kept
        nodes.append(node)
    out = {**definition, "nodes": nodes}
    esc = definition.get("escalation_user_id")
    if esc and uuid.UUID(str(esc)) not in members:
        out.pop("escalation_user_id", None)
        notes.append(f"Tolta l'escalation verso {names.get(uuid.UUID(str(esc)), 'una persona')}, non è in questo progetto")
    return out, notes


@router.post("/projects/{project_id}/workflow-templates/import", status_code=201)
def import_template(project_id: uuid.UUID, body: ImportIn, c: Ctx = Depends(ctx)):
    """Copia un workflow da un altro progetto: stesso codice ⇒ nuova versione qui, come un salvataggio."""
    with c.tx() as conn:
        require_project(conn, project_id, "ADMIN", "PROJECT")
        src = conn.execute(f"SELECT {TEMPLATE_COLS} FROM cde.workflow_templates WHERE id = %s",
                           [body.template_id]).fetchone()
        if src is None:
            raise not_found("Workflow")
        require_project(conn, src["project_id"], "ADMIN", "PROJECT")
        if src["project_id"] == project_id:
            raise ApiError(409, "same_project", "Il workflow è già in questo progetto")
        adapted, notes = _adapt(conn, project_id, src["project_id"], _normalized(src["definition"]), body.copy_roles)
        adapted = _normalized(adapted)
        code, name = body.code or src["code"], body.name or src["name"]
        tid = _save_template(conn, project_id, code, name, adapted)
        row = conn.execute(f"SELECT {TEMPLATE_COLS} FROM cde.workflow_templates WHERE id = %s", [tid]).fetchone()
        security_event(conn, "WORKFLOW_TEMPLATE_IMPORTED", user_id=c.user_id, project_id=project_id, ip=c.ip,
                       template=tid, code=code, version=row["version"], source=body.template_id, changes=len(notes))
        return {**row, "changes": notes}


@router.patch("/workflow-templates/{template_id}")
def update_template(template_id: uuid.UUID, body: TemplatePatch, c: Ctx = Depends(ctx)):
    changes = body.model_dump(exclude_unset=True)
    with c.tx() as conn:
        t = conn.execute("SELECT project_id FROM cde.workflow_templates WHERE id = %s", [template_id]).fetchone()
        if t is None:
            raise not_found("Template")
        require_project(conn, t["project_id"], "ADMIN", "PROJECT")
        if changes:
            conn.execute("UPDATE cde.workflow_templates SET " + ", ".join(f"{k} = %({k})s" for k in changes)
                         + " WHERE id = %(_key)s", {**changes, "_key": template_id})
        return conn.execute(f"SELECT {TEMPLATE_COLS} FROM cde.workflow_templates WHERE id = %s", [template_id]).fetchone()


# ---------------------------------------------------------------------
# Istanze
# ---------------------------------------------------------------------
INSTANCE_SQL = """
    SELECT i.id, i.project_id, i.template_id, i.subject, i.document_id, i.revision_id, i.status, i.result,
           i.started_at, i.finished_at, i.final_revision_id, i.outcome_comment, i.description,
           i.title AS process_title, t.name AS template_name, t.version AS template_version, t.definition,
           d.identifier, coalesce(d.title, i.title) AS title, r.revision_code,
           u.first_name || ' ' || u.last_name AS started_by_name, i.started_by
    FROM cde.workflow_instances i
    JOIN cde.workflow_templates t ON t.id = i.template_id
    LEFT JOIN cde.documents d ON d.id = i.document_id
    LEFT JOIN cde.document_revisions r ON r.id = i.revision_id
    LEFT JOIN cde.users u ON u.id = i.started_by"""

# Stato dell'istanza come lo vede il contratto: concluso (OK o KO, vedi result), in corso o annullato.
API_STATUS = {"RUNNING": "RUNNING", "APPROVED": "COMPLETED", "REJECTED": "COMPLETED", "CANCELLED": "CANCELLED"}


def _runs_and_tasks(conn, instance_id: uuid.UUID) -> tuple[list[dict], list[dict]]:
    runs = conn.execute(
        """SELECT id, node_id, node_type, name, round, status, outcome, required, activated_at, due_at, completed_at
           FROM cde.workflow_node_runs WHERE instance_id = %s ORDER BY activated_at, id""", [instance_id]).fetchall()
    tasks = conn.execute(
        """SELECT k.id, k.node_run_id, k.assignee_id, k.status, k.outcome, k.comment, k.due_at, k.completed_at,
                  u.first_name || ' ' || u.last_name AS assignee_name
           FROM cde.tasks k LEFT JOIN cde.users u ON u.id = k.assignee_id
           WHERE k.instance_id = %s ORDER BY k.created_at, u.last_name""", [instance_id]).fetchall()
    return runs, tasks


def _instance(conn, instance_id: uuid.UUID) -> dict:
    """Forma di prima (``steps`` in ordine di attivazione, ``current_step``) per le pagine che non usano il grafo."""
    inst = conn.execute(INSTANCE_SQL + " WHERE i.id = %s", [instance_id]).fetchone()
    if inst is None:
        raise not_found("Workflow")
    definition = inst.pop("definition")
    runs, tasks = _runs_and_tasks(conn, instance_id)
    steps = []
    for r in (r for r in runs if r["node_type"] in ("decision", "activity")):
        colors = {o["code"]: o["color"] for o in wg.outcomes_of(wg.node_of(definition, r["node_id"]))}
        status = r["status"] if r["status"] != "DONE" else (
            "REJECTED" if colors.get(r["outcome"]) == "red" else "APPROVED")
        steps.append({"id": r["id"], "step_index": len(steps), "node_id": r["node_id"], "round": r["round"],
                      "name": r["name"], "required": r["required"], "status": status, "outcome": r["outcome"],
                      "activated_at": r["activated_at"], "due_at": r["due_at"], "completed_at": r["completed_at"],
                      "tasks": [{**t, "step_run_id": t["node_run_id"]} for t in tasks if t["node_run_id"] == r["id"]]})
    active = [s["step_index"] for s in steps if s["status"] == "ACTIVE"]
    current = active[-1] if active else (len(steps) - 1 if steps else 0)
    return {**inst, "steps": steps, "current_step": current, "step_count": len(wg.task_nodes(definition))}


def _graph(conn, instance_id: uuid.UUID) -> dict:
    """Tutto ciò che serve alla vista finale (contratto §3): definizione, giri, compiti, archi, allegati."""
    inst = conn.execute(INSTANCE_SQL + " WHERE i.id = %s", [instance_id]).fetchone()
    if inst is None:
        raise not_found("Workflow")
    runs, tasks = _runs_and_tasks(conn, instance_id)
    edges = conn.execute(
        """SELECT from_node AS "from", outcome, to_node AS "to", round, taken_at AS at
           FROM cde.workflow_edges_taken WHERE instance_id = %s ORDER BY id""", [instance_id]).fetchall()
    docs = conn.execute(
        """SELECT d.id, d.identifier, d.title FROM cde.workflow_instance_documents x
           JOIN cde.documents d ON d.id = x.document_id WHERE x.instance_id = %s ORDER BY d.identifier""",
        [instance_id]).fetchall()
    node_runs = [{
        "id": r["id"], "node_id": r["node_id"], "node_type": r["node_type"], "name": r["name"], "round": r["round"],
        "status": r["status"], "outcome": r["outcome"], "required": r["required"],
        "activated_at": r["activated_at"], "completed_at": r["completed_at"], "due_at": r["due_at"],
        "tasks": [{"id": t["id"], "assignee": {"id": t["assignee_id"], "name": t["assignee_name"]},
                   "status": t["status"], "outcome": t["outcome"], "comment": t["comment"],
                   "due_at": t["due_at"], "completed_at": t["completed_at"]}
                  for t in tasks if t["node_run_id"] == r["id"]]} for r in runs]
    title = inst["process_title"] or " – ".join(x for x in (inst["identifier"], inst["title"]) if x)
    return {
        "id": inst["id"], "project_id": inst["project_id"], "subject": inst["subject"], "title": title,
        "description": inst["description"], "status": API_STATUS[inst["status"]], "result": inst["result"],
        "started_at": inst["started_at"], "finished_at": inst["finished_at"], "outcome_comment": inst["outcome_comment"],
        "started_by": {"id": inst["started_by"], "name": inst["started_by_name"]},
        "template": {"id": inst["template_id"], "name": inst["template_name"], "version": inst["template_version"]},
        "document": None if inst["document_id"] is None else {
            "id": inst["document_id"], "identifier": inst["identifier"], "title": inst["title"],
            "revision_id": inst["revision_id"], "revision_code": inst["revision_code"],
            "final_revision_id": inst["final_revision_id"]},
        "definition": inst["definition"], "node_runs": node_runs, "edges_taken": edges, "documents": docs,
    }


@router.post("/revisions/{revision_id}/workflows", status_code=201)
def start_workflow(revision_id: uuid.UUID, body: StartIn, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        iid = conn.execute("SELECT cde.workflow_start(%s, %s, %s) AS id",
                           [body.template_id, revision_id, body.comment]).fetchone()["id"]
        inst = _instance(conn, iid)
        security_event(conn, "WORKFLOW_STARTED", user_id=c.user_id, project_id=inst["project_id"], ip=c.ip,
                       instance=iid, revision=revision_id)
        return inst


@router.get("/workflows/{instance_id}")
def get_workflow(instance_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        return _instance(conn, instance_id)


@router.get("/workflow-instances/{instance_id}")
def get_workflow_graph(instance_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        return _graph(conn, instance_id)


def _cancel(conn, c: Ctx, instance_id: uuid.UUID, reason: str) -> None:
    conn.execute("SELECT cde.workflow_cancel(%s, %s)", [instance_id, reason])
    pid = conn.execute("SELECT project_id FROM cde.workflow_instances WHERE id = %s", [instance_id]).fetchone()
    security_event(conn, "WORKFLOW_CANCELLED", user_id=c.user_id, project_id=pid and pid["project_id"], ip=c.ip,
                   instance=instance_id, reason=reason)


@router.post("/workflows/{instance_id}/cancel")
def cancel_workflow(instance_id: uuid.UUID, body: CancelIn, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        _cancel(conn, c, instance_id, body.reason)
        return _instance(conn, instance_id)


@router.post("/workflow-instances/{instance_id}/cancel")
def cancel_workflow_graph(instance_id: uuid.UUID, body: CancelIn, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        _cancel(conn, c, instance_id, body.reason)
        return _graph(conn, instance_id)


@router.get("/documents/{document_id}/workflows")
def document_workflows(document_id: uuid.UUID, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        rows = conn.execute(INSTANCE_SQL + " WHERE i.document_id = %s ORDER BY i.started_at DESC",
                            [document_id]).fetchall()
        for r in rows:
            definition = r.pop("definition")
            r["step_count"] = len(wg.task_nodes(definition))
        return rows


# ---------------------------------------------------------------------
# Processi (modelli PROCESS: RdA, gare... senza documento, con allegati)
# ---------------------------------------------------------------------
@router.post("/projects/{project_id}/processes", status_code=201)
def start_process(project_id: uuid.UUID, body: ProcessIn, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        require_project(conn, project_id)
        t = conn.execute("SELECT project_id FROM cde.workflow_templates WHERE id = %s", [body.template_id]).fetchone()
        if t is None or t["project_id"] != project_id:
            raise not_found("Modello di workflow")
        iid = conn.execute("SELECT cde.workflow_start_process(%s, %s, %s, %s::uuid[]) AS id",
                           [body.template_id, body.title, body.description, body.document_ids]).fetchone()["id"]
        security_event(conn, "PROCESS_STARTED", user_id=c.user_id, project_id=project_id, ip=c.ip,
                       instance=iid, template=body.template_id, documents=len(body.document_ids))
        return _graph(conn, iid)


@router.get("/projects/{project_id}/processes")
def list_processes(project_id: uuid.UUID, status: Literal["RUNNING", "COMPLETED", "CANCELLED", "ALL"] = "ALL",
                   limit: int = Query(default=200, le=500), c: Ctx = Depends(ctx)):
    db_status = {"RUNNING": ["RUNNING"], "COMPLETED": ["APPROVED", "REJECTED"], "CANCELLED": ["CANCELLED"],
                 "ALL": ["RUNNING", "APPROVED", "REJECTED", "CANCELLED"]}[status]
    with c.tx() as conn:
        require_project(conn, project_id)
        rows = conn.execute(
            """SELECT i.id, i.title, i.description, i.status, i.result, i.started_at, i.finished_at, i.outcome_comment,
                      t.id AS template_id, t.name AS template_name, t.code AS template_code, t.version AS template_version,
                      i.started_by, u.first_name || ' ' || u.last_name AS started_by_name,
                      (SELECT coalesce(array_agg(s.name ORDER BY s.activated_at), '{}') FROM cde.workflow_node_runs s
                        WHERE s.instance_id = i.id AND s.status = 'ACTIVE') AS active_nodes,
                      (SELECT count(*) FROM cde.workflow_instance_documents x WHERE x.instance_id = i.id) AS documents
               FROM cde.workflow_instances i JOIN cde.workflow_templates t ON t.id = i.template_id
               LEFT JOIN cde.users u ON u.id = i.started_by
               WHERE i.project_id = %s AND i.subject = 'PROCESS' AND i.status::text = ANY(%s)
               ORDER BY i.started_at DESC LIMIT %s""", [project_id, db_status, limit]).fetchall()
        return [{**r, "status": API_STATUS[r["status"]]} for r in rows]


# ---------------------------------------------------------------------
# Compiti
# ---------------------------------------------------------------------
@router.get("/me/tasks")
def my_tasks(status: Literal["OPEN", "DONE", "ALL"] = "OPEN", limit: int = Query(default=100, le=500),
             c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        rows = conn.execute(
            """SELECT k.id, k.status, k.outcome, k.comment, k.due_at, k.created_at, k.completed_at, k.instance_id,
                      s.name AS step_name, s.node_id, s.name AS node_name, s.node_type, s.round,
                      (SELECT count(*) FROM cde.workflow_node_runs x WHERE x.instance_id = s.instance_id
                         AND x.node_type IN ('decision', 'activity')
                         AND (x.activated_at, x.id) < (s.activated_at, s.id))::int AS step_index,
                      i.status AS workflow_status, i.subject, i.project_id, i.revision_id, i.document_id,
                      coalesce(d.identifier, i.title) AS identifier, coalesce(d.title, i.title) AS title,
                      i.title AS process_title, r.revision_code, r.suitability, r.state,
                      t.name AS template_name, t.definition, p.code AS project_code,
                      (k.due_at IS NOT NULL AND k.due_at < now() AND k.status = 'OPEN') AS overdue,
                      -- escalation (migrazione 0036): quando e quante volte i responsabili sono stati avvisati
                      k.escalated_at, k.escalation_count,
                      CASE WHEN k.due_at IS NOT NULL AND k.due_at < now() AND k.status = 'OPEN'
                           THEN floor(extract(epoch FROM now() - k.due_at) / 86400)::int END AS days_late
               FROM cde.tasks k
               JOIN cde.workflow_node_runs s ON s.id = k.node_run_id
               JOIN cde.workflow_instances i ON i.id = k.instance_id
               JOIN cde.workflow_templates t ON t.id = i.template_id
               LEFT JOIN cde.documents d ON d.id = i.document_id
               LEFT JOIN cde.document_revisions r ON r.id = i.revision_id
               JOIN cde.projects p ON p.id = i.project_id
               WHERE k.assignee_id = cde.current_app_user()"""
            + ("" if status == "ALL" else " AND k.status = %(s)s")
            + " ORDER BY k.due_at NULLS LAST, k.created_at LIMIT %(l)s", {"s": status, "l": limit}).fetchall()
        for r in rows:
            # esiti del nodo per i pulsanti del compito (etichetta e colore scelti da chi ha disegnato il workflow)
            r["outcomes"] = wg.outcomes_of(wg.node_of(r.pop("definition"), r["node_id"]))
        return rows


@router.post("/tasks/{task_id}/complete")
def complete_task(task_id: uuid.UUID, body: CompleteIn, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        status = conn.execute("SELECT cde.workflow_complete_task(%s, %s, %s)::text AS s",
                              [task_id, body.outcome, body.comment]).fetchone()["s"]
        task = conn.execute("SELECT instance_id, project_id FROM cde.tasks WHERE id = %s", [task_id]).fetchone()
        if task is None:
            raise ApiError(500, "internal", "Compito non rileggibile")
        security_event(conn, "TASK_COMPLETED", user_id=c.user_id, project_id=task["project_id"], ip=c.ip,
                       task=task_id, outcome=body.outcome, workflow_status=status)
        return {"workflow_status": status, "workflow": _instance(conn, task["instance_id"])}
