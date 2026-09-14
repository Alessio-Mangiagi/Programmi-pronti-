"""
API core per il sistema tipo Field View.

Avvio locale (dalla root del progetto):
    uvicorn app.main:app --reload

Endpoint principali:
    /projects, /plans, /form-templates   -> CRUD standard, gestiti da web
    /sync/push                            -> l'app nativa manda le modifiche fatte offline
    /sync/pull?project_id=..&since=..     -> l'app nativa scarica le modifiche dal server

Strategia di sync (vedi README):
    - Ogni entità creata sul device ha un id UUID generato localmente.
    - Il push è un upsert per id: se arriva due volte (retry di rete) non crea duplicati.
    - Ordine di applicazione: pins -> submissions -> tasks -> attachments, con flush
      tra un gruppo e l'altro così le FK verso entità dello stesso batch funzionano.
    - Il pull è incrementale per progetto: il client manda l'ultimo server_time
      ricevuto e riceve solo le modifiche successive, cancellazioni comprese.
    - Conflict resolution MVP: "last write wins" basato su updated_at.
"""
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from . import models, schemas
from .forms import validate_schema
from .database import engine, get_db
from .models import utcnow
from .schemas import to_naive_utc

models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Field View Starter API")


# ---------- CRUD standard (uso da web app) ----------

@app.post("/projects", response_model=schemas.ProjectOut, status_code=201)
def create_project(payload: schemas.ProjectCreate, db: Session = Depends(get_db)):
    project = models.Project(**payload.model_dump())
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@app.get("/projects", response_model=list[schemas.ProjectOut])
def list_projects(db: Session = Depends(get_db)):
    return db.query(models.Project).all()


@app.post("/plans", response_model=schemas.PlanOut, status_code=201)
def create_plan(payload: schemas.PlanCreate, db: Session = Depends(get_db)):
    if not db.get(models.Project, payload.project_id):
        raise HTTPException(404, "project not found")
    plan = models.Plan(**payload.model_dump())
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return plan


@app.get("/projects/{project_id}/plans", response_model=list[schemas.PlanOut])
def list_plans(project_id: str, db: Session = Depends(get_db)):
    return db.query(models.Plan).filter(models.Plan.project_id == project_id).all()


@app.post("/form-templates", response_model=schemas.FormTemplateOut, status_code=201)
def create_form_template(payload: schemas.FormTemplateCreate, db: Session = Depends(get_db)):
    errors = validate_schema(payload.schema_def)
    if errors:
        raise HTTPException(422, detail=errors)
    template = models.FormTemplate(**payload.model_dump())
    db.add(template)
    db.commit()
    db.refresh(template)
    return template


@app.get("/form-templates", response_model=list[schemas.FormTemplateOut])
def list_form_templates(db: Session = Depends(get_db)):
    return db.query(models.FormTemplate).all()


# ---------- Sync offline-first (uso da app nativa) ----------

def _upsert(db: Session, model, items, fk_checks: dict, updatable: list[str]) -> schemas.SyncPushResult:
    """
    Upsert idempotente per id con "last write wins".

    fk_checks: {campo_fk: Model} — ogni FK viene verificata contro il DB
               (comprese le righe appena flushate nello stesso batch).
    updatable: campi che un push più recente può sovrascrivere.
    """
    res = schemas.SyncPushResult()
    for item in items:
        # FK: rifiuta la singola riga invece di rompere il commit dell'intero batch
        bad_fk = False
        for field, fk_model in fk_checks.items():
            fk_value = getattr(item, field)
            if fk_value is not None and db.get(fk_model, fk_value) is None:
                bad_fk = True
                break
        if bad_fk:
            res.rejected.append(item.id)
            continue

        existing = db.get(model, item.id)
        if existing is None:
            db.add(model(**item.model_dump()))
            res.inserted += 1
        elif item.updated_at > existing.updated_at:
            for f in updatable:
                setattr(existing, f, getattr(item, f))
            existing.updated_at = item.updated_at
            res.updated += 1
        else:
            res.skipped += 1
    db.flush()  # rende visibili gli insert alle fk_checks del gruppo successivo
    return res


@app.post("/sync/push", response_model=schemas.SyncPushResponse)
def sync_push(payload: schemas.SyncPushRequest, db: Session = Depends(get_db)):
    """
    Riceve un batch di modifiche fatte offline sul device e le applica
    con upsert idempotente per id. Le entità con FK verso qualcosa che
    non esiste vengono rifiutate singolarmente (id in `rejected`), il
    resto del batch viene comunque applicato.
    """
    pins = _upsert(
        db, models.Pin, payload.pins,
        fk_checks={"plan_id": models.Plan},
        updatable=["x", "y", "label", "deleted_at"],
    )
    submissions = _upsert(
        db, models.FormSubmission, payload.submissions,
        fk_checks={"template_id": models.FormTemplate, "pin_id": models.Pin},
        updatable=["data_json", "submitted_by", "deleted_at"],
    )
    tasks = _upsert(
        db, models.Task, payload.tasks,
        fk_checks={"pin_id": models.Pin},
        updatable=["title", "description", "status", "assigned_to", "due_date", "deleted_at"],
    )
    attachments = _upsert(
        db, models.Attachment, payload.attachments,
        fk_checks={"submission_id": models.FormSubmission, "task_id": models.Task},
        updatable=["file_url", "file_type", "deleted_at"],
    )
    db.commit()
    return schemas.SyncPushResponse(
        pins=pins, submissions=submissions, tasks=tasks, attachments=attachments,
        server_time=utcnow(),
    )


def _to_dict(obj):
    return {c.name: getattr(obj, c.name) for c in obj.__table__.columns}


@app.get("/sync/pull", response_model=schemas.SyncPullResponse)
def sync_pull(
    project_id: str,
    since: Optional[datetime] = Query(None, description="server_time dell'ultima sync; omesso = tutto"),
    db: Session = Depends(get_db),
):
    """
    Ritorna tutte le modifiche del progetto (fatte da chiunque, su qualsiasi
    device) successive a `since`. Il client salva il nuovo server_time e lo
    userà come `since` alla sync successiva. Le righe con deleted_at
    valorizzato vanno rimosse localmente.
    """
    if not db.get(models.Project, project_id):
        raise HTTPException(404, "project not found")

    # Catturato PRIMA delle query: se un push arriva durante il pull,
    # il prossimo since lo riprende invece di perderlo.
    server_time = utcnow()
    since = to_naive_utc(since)

    def changed(query, model):
        return query.filter(model.updated_at > since) if since else query

    plans_q = db.query(models.Plan).filter(models.Plan.project_id == project_id)
    plan_ids = [p.id for p in plans_q.all()]

    pins_q = db.query(models.Pin).filter(models.Pin.plan_id.in_(plan_ids))
    subs_q = (db.query(models.FormSubmission)
              .join(models.Pin, models.FormSubmission.pin_id == models.Pin.id)
              .filter(models.Pin.plan_id.in_(plan_ids)))
    tasks_q = (db.query(models.Task)
               .join(models.Pin, models.Task.pin_id == models.Pin.id)
               .filter(models.Pin.plan_id.in_(plan_ids)))
    att_q = (db.query(models.Attachment)
             .outerjoin(models.FormSubmission, models.Attachment.submission_id == models.FormSubmission.id)
             .outerjoin(models.Task, models.Attachment.task_id == models.Task.id)
             .join(models.Pin, (models.FormSubmission.pin_id == models.Pin.id) | (models.Task.pin_id == models.Pin.id))
             .filter(models.Pin.plan_id.in_(plan_ids)))
    templates_q = db.query(models.FormTemplate)

    return schemas.SyncPullResponse(
        plans=[_to_dict(x) for x in changed(plans_q, models.Plan).all()],
        form_templates=[_to_dict(x) for x in changed(templates_q, models.FormTemplate).all()],
        pins=[_to_dict(x) for x in changed(pins_q, models.Pin).all()],
        submissions=[_to_dict(x) for x in changed(subs_q, models.FormSubmission).all()],
        tasks=[_to_dict(x) for x in changed(tasks_q, models.Task).all()],
        attachments=[_to_dict(x) for x in changed(att_q, models.Attachment).all()],
        server_time=server_time,
    )
