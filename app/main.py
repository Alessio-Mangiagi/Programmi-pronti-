"""
API core per il sistema tipo Field View.

Avvio locale (dalla root del progetto):
    alembic upgrade head
    uvicorn app.main:app --reload

Endpoint principali:
    /projects, /plans, /form-templates   -> CRUD standard, gestiti da web
    /pins/{id}                            -> pin con submissions/task/foto (plan view)
    /submissions, /tasks                  -> creazione e aggiornamento da web
    /plans/{id}/file, /attachments/{id}/upload, /files/{key} -> upload e download file
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

from fastapi import FastAPI, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from . import models, schemas
from .forms import validate_schema, validate_submission
from .database import get_db
from .models import utcnow, TaskStatus, TASK_TRANSITIONS
from . import storage as st
from .schemas import to_naive_utc

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


def _alive(query, model):
    return query.filter(model.deleted_at.is_(None))


def _with_attachments(schema_cls, obj):
    out = schema_cls.model_validate(obj)
    out.attachments = [schemas.AttachmentOut.model_validate(a)
                       for a in obj.attachments if a.deleted_at is None]
    return out


@app.get("/pins/{pin_id}", response_model=schemas.PinDetail)
def get_pin(pin_id: str, db: Session = Depends(get_db)):
    """Pin con submissions, task e allegati (non cancellati): apertura da plan view."""
    pin = db.get(models.Pin, pin_id)
    if pin is None or pin.deleted_at is not None:
        raise HTTPException(404, "pin not found")
    subs = _alive(db.query(models.FormSubmission).filter_by(pin_id=pin_id), models.FormSubmission).all()
    tasks = _alive(db.query(models.Task).filter_by(pin_id=pin_id), models.Task).all()
    out = schemas.PinDetail.model_validate(pin)
    out.submissions = [_with_attachments(schemas.SubmissionOut, x) for x in subs]
    out.tasks = [_with_attachments(schemas.TaskOut, x) for x in tasks]
    return out


# ---------- Submissions (uso da web) ----------

@app.post("/submissions", response_model=schemas.SubmissionOut, status_code=201)
def create_submission(payload: schemas.SubmissionCreate, db: Session = Depends(get_db)):
    template = db.get(models.FormTemplate, payload.template_id)
    if template is None:
        raise HTTPException(404, "template not found")
    pin = db.get(models.Pin, payload.pin_id)
    if pin is None or pin.deleted_at is not None:
        raise HTTPException(404, "pin not found")
    errors = validate_submission(template.schema_def, payload.data_json)
    if errors:
        raise HTTPException(422, detail=errors)
    sub = models.FormSubmission(**payload.model_dump())
    db.add(sub)
    db.commit()
    db.refresh(sub)
    return _with_attachments(schemas.SubmissionOut, sub)


@app.get("/submissions/{submission_id}", response_model=schemas.SubmissionOut)
def get_submission(submission_id: str, db: Session = Depends(get_db)):
    sub = db.get(models.FormSubmission, submission_id)
    if sub is None or sub.deleted_at is not None:
        raise HTTPException(404, "submission not found")
    return _with_attachments(schemas.SubmissionOut, sub)


# ---------- Task (uso da web) ----------

def _parse_status(value: str) -> TaskStatus:
    try:
        return TaskStatus(value)
    except ValueError:
        raise HTTPException(422, f"invalid status {value!r}")


@app.post("/tasks", response_model=schemas.TaskOut, status_code=201)
def create_task(payload: schemas.TaskCreate, db: Session = Depends(get_db)):
    pin = db.get(models.Pin, payload.pin_id)
    if pin is None or pin.deleted_at is not None:
        raise HTTPException(404, "pin not found")
    task = models.Task(**payload.model_dump())
    task.status = TaskStatus.assigned if payload.assigned_to else TaskStatus.open
    db.add(task)
    db.commit()
    db.refresh(task)
    return _with_attachments(schemas.TaskOut, task)


@app.get("/projects/{project_id}/tasks", response_model=list[schemas.TaskOut])
def list_tasks(
    project_id: str,
    status: Optional[str] = None,
    plan_id: Optional[str] = None,
    assigned_to: Optional[str] = None,
    db: Session = Depends(get_db),
):
    if not db.get(models.Project, project_id):
        raise HTTPException(404, "project not found")
    q = (db.query(models.Task)
         .join(models.Pin, models.Task.pin_id == models.Pin.id)
         .join(models.Plan, models.Pin.plan_id == models.Plan.id)
         .filter(models.Plan.project_id == project_id)
         .filter(models.Task.deleted_at.is_(None), models.Pin.deleted_at.is_(None)))
    if status:
        q = q.filter(models.Task.status == _parse_status(status))
    if plan_id:
        q = q.filter(models.Pin.plan_id == plan_id)
    if assigned_to:
        q = q.filter(models.Task.assigned_to == assigned_to)
    q = q.order_by(models.Task.created_at.desc())
    return [_with_attachments(schemas.TaskOut, t) for t in q.all()]


@app.get("/tasks/{task_id}", response_model=schemas.TaskOut)
def get_task(task_id: str, db: Session = Depends(get_db)):
    task = db.get(models.Task, task_id)
    if task is None or task.deleted_at is not None:
        raise HTTPException(404, "task not found")
    return _with_attachments(schemas.TaskOut, task)


@app.patch("/tasks/{task_id}", response_model=schemas.TaskOut)
def update_task(task_id: str, payload: schemas.TaskUpdate, db: Session = Depends(get_db)):
    """
    Aggiornamento parziale. Cambi di stato solo lungo TASK_TRANSITIONS (409 altrimenti).
    Assegnare un task 'open' senza indicare lo stato lo porta automaticamente ad 'assigned'.
    """
    task = db.get(models.Task, task_id)
    if task is None or task.deleted_at is not None:
        raise HTTPException(404, "task not found")
    changes = payload.model_dump(exclude_unset=True)

    if "status" in changes:
        new_status = _parse_status(changes.pop("status"))
        if new_status != task.status:
            if new_status not in TASK_TRANSITIONS[task.status]:
                raise HTTPException(409, f"cannot go from {task.status.value} to {new_status.value}")
            if new_status == TaskStatus.assigned and not (changes.get("assigned_to") or task.assigned_to):
                raise HTTPException(409, "assigned_to is required to move to assigned")
            task.status = new_status
    elif changes.get("assigned_to") and task.status == TaskStatus.open:
        task.status = TaskStatus.assigned

    for k, v in changes.items():
        setattr(task, k, v)
    task.updated_at = utcnow()
    db.commit()
    db.refresh(task)
    return _with_attachments(schemas.TaskOut, task)


@app.delete("/tasks/{task_id}", status_code=204)
def delete_task(task_id: str, db: Session = Depends(get_db)):
    """Soft-delete: la cancellazione deve viaggiare nel sync come ogni altra modifica."""
    task = db.get(models.Task, task_id)
    if task is None or task.deleted_at is not None:
        raise HTTPException(404, "task not found")
    task.deleted_at = task.updated_at = utcnow()
    db.commit()


# ---------- File: planimetrie e allegati ----------

async def _read_upload(file: UploadFile) -> tuple[bytes, str]:
    """Legge il file entro il limite e ne riconosce il tipo dal contenuto."""
    data = await file.read(st.MAX_UPLOAD_BYTES + 1)
    if len(data) > st.MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"file larger than {st.MAX_UPLOAD_BYTES} bytes")
    mime = st.sniff_mime(data)
    if mime not in st.ALLOWED_MIME:
        raise HTTPException(415, "only JPEG, PNG or PDF allowed")
    return data, mime


@app.post("/plans/{plan_id}/file", response_model=schemas.PlanOut)
async def upload_plan_file(plan_id: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    """
    Carica l'immagine della planimetria. Un PDF viene convertito in PNG
    (prima pagina) così tutti i client mostrano un'immagine e basta.
    Le dimensioni in pixel servono ai client per posizionare i pin (x/y relativi).
    """
    plan = db.get(models.Plan, plan_id)
    if plan is None:
        raise HTTPException(404, "plan not found")
    data, mime = await _read_upload(file)
    if mime == "application/pdf":
        try:
            data = st.pdf_first_page_to_png(data)
        except Exception:
            raise HTTPException(422, "cannot render PDF")
        ext = "png"
    else:
        ext = st.ALLOWED_MIME[mime]
    try:
        w, h = st.image_size(data)
    except Exception:
        raise HTTPException(422, "cannot read image")
    plan.file_url = st.storage.save(f"plans/{plan.id}.{ext}", data)
    plan.width_px, plan.height_px = float(w), float(h)
    plan.updated_at = utcnow()
    db.commit()
    db.refresh(plan)
    return plan


@app.post("/attachments", response_model=schemas.AttachmentOut, status_code=201)
def create_attachment(payload: schemas.AttachmentCreate, db: Session = Depends(get_db)):
    """Crea il record (da web); i byte arrivano dopo con /attachments/{id}/upload."""
    if bool(payload.submission_id) == bool(payload.task_id):
        raise HTTPException(422, "exactly one of submission_id or task_id is required")
    if payload.submission_id and not db.get(models.FormSubmission, payload.submission_id):
        raise HTTPException(404, "submission not found")
    if payload.task_id and not db.get(models.Task, payload.task_id):
        raise HTTPException(404, "task not found")
    att = models.Attachment(**payload.model_dump())
    db.add(att)
    db.commit()
    db.refresh(att)
    return att


@app.post("/attachments/presign", response_model=schemas.PresignResponse)
def presign_attachment(payload: schemas.PresignRequest, db: Session = Depends(get_db)):
    """
    L'app chiede dove caricare i byte di un allegato già sincronizzato.
    Stub per l'MVP: upload diretto sull'API. In prod restituirà un presigned URL S3.
    """
    att = db.get(models.Attachment, payload.attachment_id)
    if att is None or att.deleted_at is not None:
        raise HTTPException(404, "attachment not found")
    return schemas.PresignResponse(
        attachment_id=att.id, method="POST",
        upload_url=f"/attachments/{att.id}/upload", max_bytes=st.MAX_UPLOAD_BYTES,
    )


@app.post("/attachments/{attachment_id}/upload", response_model=schemas.AttachmentOut)
async def upload_attachment(attachment_id: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Carica i byte di un allegato. Idempotente: un retry sovrascrive lo stesso file."""
    att = db.get(models.Attachment, attachment_id)
    if att is None or att.deleted_at is not None:
        raise HTTPException(404, "attachment not found")
    data, mime = await _read_upload(file)
    ext = st.ALLOWED_MIME[mime]
    att.file_url = st.storage.save(f"attachments/{att.id}.{ext}", data)
    if not att.file_type:
        att.file_type = "doc" if mime == "application/pdf" else "photo"
    att.updated_at = utcnow()
    db.commit()
    db.refresh(att)
    return att


@app.get("/files/{key:path}")
def get_file(key: str):
    """Serve i file dello storage locale. Con S3 questo endpoint sparisce (URL diretti)."""
    if not st.storage.exists(key):
        raise HTTPException(404, "file not found")
    return FileResponse(st.storage.path(key))


# ---------- Sync offline-first (uso da app nativa) ----------

def _upsert(db: Session, model, items, fk_checks: dict, updatable: list[str],
            validate=None) -> schemas.SyncPushResult:
    """
    Upsert idempotente per id con "last write wins".

    fk_checks: {campo_fk: Model} — ogni FK viene verificata contro il DB
               (comprese le righe appena flushate nello stesso batch).
    updatable: campi che un push più recente può sovrascrivere.
    validate:  fn(item) -> motivo di rifiuto (str) o None, eseguita dopo le FK.
    """
    res = schemas.SyncPushResult()
    for item in items:
        # FK: rifiuta la singola riga invece di rompere il commit dell'intero batch
        reason = None
        for field, fk_model in fk_checks.items():
            fk_value = getattr(item, field)
            if fk_value is not None and db.get(fk_model, fk_value) is None:
                reason = f"{field} not found"
                break
        if reason is None and validate is not None:
            reason = validate(item)
        if reason is not None:
            res.rejected.append(schemas.RejectedItem(id=item.id, reason=reason))
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
    def check_submission(item):
        # Una cancellazione non deve essere bloccata da dati vecchi non più validi.
        if item.deleted_at is not None:
            return None
        schema = db.get(models.FormTemplate, item.template_id).schema_def
        errors = validate_submission(schema, item.data_json)
        if errors:
            return "data_json: " + "; ".join(f"{e['field']}: {e['message']}" for e in errors)
        return None

    def check_task(item):
        try:
            TaskStatus(item.status)
        except ValueError:
            return f"invalid status {item.status!r}"
        return None

    submissions = _upsert(
        db, models.FormSubmission, payload.submissions,
        fk_checks={"template_id": models.FormTemplate, "pin_id": models.Pin},
        updatable=["data_json", "submitted_by", "deleted_at"],
        validate=check_submission,
    )
    tasks = _upsert(
        db, models.Task, payload.tasks,
        fk_checks={"pin_id": models.Pin},
        updatable=["title", "description", "status", "assigned_to", "due_date", "deleted_at"],
        validate=check_task,
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
