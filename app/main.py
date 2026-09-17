"""
API core per il sistema tipo Field View.

Avvio locale (dalla root del progetto):
    alembic upgrade head
    python -m scripts.seed          # utenti/progetto demo (opzionale)
    uvicorn app.main:app --reload

Endpoint principali:
    /auth/login, /auth/me, /users         -> autenticazione (JWT bearer) e utenti
    /projects, /projects/{id}/members     -> progetti e membri
    /plans, /form-templates               -> CRUD standard, gestiti da web
    /pins/{id}                            -> pin con submissions/task/foto (plan view)
    /submissions, /tasks                  -> creazione e aggiornamento da web
    /plans/{id}/file, /attachments/{id}/upload, /files/{key} -> upload e download file
    /sync/push                            -> l'app nativa manda le modifiche fatte offline
    /sync/pull?project_id=..&since=..     -> l'app nativa scarica le modifiche dal server

Tutti gli endpoint tranne /auth/login richiedono `Authorization: Bearer <token>`.
Regole di accesso in app/auth.py.

Strategia di sync (vedi README):
    - Ogni entità creata sul device ha un id UUID generato localmente.
    - Il push è un upsert per id: se arriva due volte (retry di rete) non crea duplicati.
    - Ordine di applicazione: pins -> submissions -> tasks -> attachments, con flush
      tra un gruppo e l'altro così le FK verso entità dello stesso batch funzionano.
    - Il pull è incrementale per progetto: il client manda l'ultimo server_time
      ricevuto e riceve solo le modifiche successive, cancellazioni comprese.
    - Conflict resolution MVP: "last write wins" basato su updated_at.
"""
import os
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, Query, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from . import models, schemas
from . import auth
from . import storage as st
from .auth import current_user, require_role
from .database import get_db
from .forms import validate_schema, validate_submission
from .models import utcnow, TaskStatus, TASK_TRANSITIONS, UserRole
from .schemas import to_naive_utc

app = FastAPI(title="Field View Starter API")

# In sviluppo il frontend gira su Vite (porta 5173) e chiama l'API su 8000.
# In produzione FastAPI serve web/dist e CORS non serve (stessa origine).
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- Auth e utenti ----------

@app.post("/auth/login", response_model=schemas.TokenResponse)
def login(payload: schemas.LoginRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == payload.email.lower().strip()).first()
    if user is None or not user.is_active or not auth.verify_password(payload.password, user.password_hash):
        raise HTTPException(401, "invalid credentials")
    return schemas.TokenResponse(access_token=auth.create_access_token(user), user=user)


@app.get("/auth/me", response_model=schemas.UserOut)
def me(user: models.User = Depends(current_user)):
    return user


@app.post("/users", response_model=schemas.UserOut, status_code=201)
def create_user(payload: schemas.UserCreate, db: Session = Depends(get_db),
                _: models.User = Depends(require_role())):
    """Solo admin."""
    try:
        role = UserRole(payload.role)
    except ValueError:
        raise HTTPException(422, f"invalid role {payload.role!r}")
    email = payload.email.lower().strip()
    if db.query(models.User).filter(models.User.email == email).first():
        raise HTTPException(409, "email already registered")
    user = models.User(email=email, name=payload.name, role=role,
                       password_hash=auth.hash_password(payload.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@app.get("/users", response_model=list[schemas.UserOut])
def list_users(db: Session = Depends(get_db), _: models.User = Depends(current_user)):
    """Elenco utenti attivi: serve a chiunque per assegnare un task."""
    return db.query(models.User).filter(models.User.is_active.is_(True)).order_by(models.User.name).all()


# ---------- Progetti e membri ----------

@app.post("/projects", response_model=schemas.ProjectOut, status_code=201)
def create_project(payload: schemas.ProjectCreate, db: Session = Depends(get_db),
                   user: models.User = Depends(require_role(UserRole.manager))):
    project = models.Project(**payload.model_dump())
    db.add(project)
    db.flush()
    db.add(models.ProjectMember(project_id=project.id, user_id=user.id))  # il creatore è membro
    db.commit()
    db.refresh(project)
    return project


@app.get("/projects", response_model=list[schemas.ProjectOut])
def list_projects(db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    ids = auth.accessible_project_ids(db, user)
    q = db.query(models.Project)
    if ids is not None:
        q = q.filter(models.Project.id.in_(ids))
    return q.order_by(models.Project.name).all()


@app.get("/projects/{project_id}", response_model=schemas.ProjectOut)
def get_project(project_id: str, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    return auth.assert_project_access(db, user, project_id)


@app.get("/projects/{project_id}/members", response_model=list[schemas.UserOut])
def list_members(project_id: str, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    auth.assert_project_access(db, user, project_id)
    return (db.query(models.User).join(models.ProjectMember, models.ProjectMember.user_id == models.User.id)
            .filter(models.ProjectMember.project_id == project_id).order_by(models.User.name).all())


@app.post("/projects/{project_id}/members", response_model=list[schemas.UserOut], status_code=201)
def add_member(project_id: str, payload: schemas.MemberAdd, db: Session = Depends(get_db),
               user: models.User = Depends(require_role(UserRole.manager))):
    auth.assert_project_access(db, user, project_id)
    if not db.get(models.User, payload.user_id):
        raise HTTPException(404, "user not found")
    if db.get(models.ProjectMember, (project_id, payload.user_id)) is None:
        db.add(models.ProjectMember(project_id=project_id, user_id=payload.user_id))
        db.commit()
    return list_members(project_id, db, user)


@app.delete("/projects/{project_id}/members/{user_id}", status_code=204)
def remove_member(project_id: str, user_id: str, db: Session = Depends(get_db),
                  user: models.User = Depends(require_role(UserRole.manager))):
    auth.assert_project_access(db, user, project_id)
    row = db.get(models.ProjectMember, (project_id, user_id))
    if row is None:
        raise HTTPException(404, "member not found")
    db.delete(row)
    db.commit()


# ---------- Planimetrie e template ----------

@app.post("/plans", response_model=schemas.PlanOut, status_code=201)
def create_plan(payload: schemas.PlanCreate, db: Session = Depends(get_db),
                user: models.User = Depends(require_role(UserRole.manager))):
    auth.assert_project_access(db, user, payload.project_id)
    plan = models.Plan(**payload.model_dump())
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return plan


@app.get("/projects/{project_id}/plans", response_model=list[schemas.PlanOut])
def list_plans(project_id: str, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    auth.assert_project_access(db, user, project_id)
    return db.query(models.Plan).filter(models.Plan.project_id == project_id).order_by(models.Plan.name).all()


@app.get("/plans/{plan_id}", response_model=schemas.PlanOut)
def get_plan(plan_id: str, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    plan = db.get(models.Plan, plan_id)
    if plan is None:
        raise HTTPException(404, "plan not found")
    auth.assert_project_access(db, user, plan.project_id)
    return plan


@app.get("/plans/{plan_id}/pins", response_model=list[schemas.PinSummary])
def list_plan_pins(
    plan_id: str,
    status: Optional[list[str]] = Query(default=None),
    template_id: Optional[str] = None,
    assigned_to: Optional[str] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    db: Session = Depends(get_db),
    user: models.User = Depends(current_user),
):
    """
    Pin (non cancellati) della planimetria con conteggi di submission e task per stato.

    Filtri (in AND tra loro, tutti sui soli record non cancellati):
    - `status` (ripetibile) + `assigned_to`: il pin ha almeno un task che soddisfa
      ENTRAMBE le condizioni (es. "task aperti assegnati a Mario");
    - `template_id`: il pin ha almeno una submission di quel template;
    - `date_from` / `date_to`: il pin, o una sua submission/task, è stato creato
      nell'intervallo (estremi inclusi; `date_to` con sola data copre tutto il giorno).
    I conteggi restano quelli totali del pin, non filtrati.
    """
    plan = db.get(models.Plan, plan_id)
    if plan is None:
        raise HTTPException(404, "plan not found")
    auth.assert_project_access(db, user, plan.project_id)

    q = _alive(db.query(models.Pin).filter(models.Pin.plan_id == plan_id), models.Pin)
    if status or assigned_to:
        task_q = db.query(models.Task.id).filter(
            models.Task.pin_id == models.Pin.id, models.Task.deleted_at.is_(None))
        if status:
            task_q = task_q.filter(models.Task.status.in_([_parse_status(v) for v in status]))
        if assigned_to:
            task_q = task_q.filter(models.Task.assigned_to == assigned_to)
        q = q.filter(task_q.exists())
    if template_id:
        q = q.filter(db.query(models.FormSubmission.id).filter(
            models.FormSubmission.pin_id == models.Pin.id,
            models.FormSubmission.deleted_at.is_(None),
            models.FormSubmission.template_id == template_id).exists())
    if date_from or date_to:
        lo = to_naive_utc(date_from) if date_from else None
        hi = to_naive_utc(date_to) if date_to else None
        if hi is not None and hi.time() == datetime.min.time():
            hi = hi.replace(hour=23, minute=59, second=59, microsecond=999999)

        def in_range(col):
            conds = []
            if lo is not None:
                conds.append(col >= lo)
            if hi is not None:
                conds.append(col <= hi)
            return and_(*conds)

        q = q.filter(or_(
            in_range(models.Pin.created_at),
            db.query(models.FormSubmission.id).filter(
                models.FormSubmission.pin_id == models.Pin.id, models.FormSubmission.deleted_at.is_(None),
                in_range(models.FormSubmission.created_at)).exists(),
            db.query(models.Task.id).filter(
                models.Task.pin_id == models.Pin.id, models.Task.deleted_at.is_(None),
                in_range(models.Task.created_at)).exists(),
        ))

    pins = q.all()
    if not pins:
        return []
    pin_ids = [p.id for p in pins]

    sub_counts = dict(
        db.query(models.FormSubmission.pin_id, func.count())
        .filter(models.FormSubmission.pin_id.in_(pin_ids), models.FormSubmission.deleted_at.is_(None))
        .group_by(models.FormSubmission.pin_id).all()
    )
    task_counts: dict[tuple[str, TaskStatus], int] = {
        (pid, status): n for pid, status, n in
        db.query(models.Task.pin_id, models.Task.status, func.count())
        .filter(models.Task.pin_id.in_(pin_ids), models.Task.deleted_at.is_(None))
        .group_by(models.Task.pin_id, models.Task.status).all()
    }
    out = []
    for p in pins:
        item = schemas.PinSummary.model_validate(p)
        item.submissions_count = sub_counts.get(p.id, 0)
        for status in TaskStatus:
            setattr(item, f"tasks_{status.value}", task_counts.get((p.id, status), 0))
        out.append(item)
    return out


@app.post("/form-templates", response_model=schemas.FormTemplateOut, status_code=201)
def create_form_template(payload: schemas.FormTemplateCreate, db: Session = Depends(get_db),
                         _: models.User = Depends(require_role(UserRole.manager))):
    errors = validate_schema(payload.schema_def)
    if errors:
        raise HTTPException(422, detail=errors)
    template = models.FormTemplate(**payload.model_dump())
    db.add(template)
    db.commit()
    db.refresh(template)
    return template


@app.get("/form-templates", response_model=list[schemas.FormTemplateOut])
def list_form_templates(db: Session = Depends(get_db), _: models.User = Depends(current_user)):
    return db.query(models.FormTemplate).order_by(models.FormTemplate.name).all()


# ---------- Pin ----------

def _alive(query, model):
    return query.filter(model.deleted_at.is_(None))


def _with_attachments(schema_cls, obj):
    out = schema_cls.model_validate(obj)
    out.attachments = [schemas.AttachmentOut.model_validate(a)
                       for a in obj.attachments if a.deleted_at is None]
    return out


def _get_pin(db: Session, user: models.User, pin_id: str) -> models.Pin:
    pin = db.get(models.Pin, pin_id)
    if pin is None or pin.deleted_at is not None:
        raise HTTPException(404, "pin not found")
    auth.assert_project_access(db, user, auth.project_of_pin(pin))
    return pin


def _get_task(db: Session, user: models.User, task_id: str) -> models.Task:
    task = db.get(models.Task, task_id)
    if task is None or task.deleted_at is not None:
        raise HTTPException(404, "task not found")
    auth.assert_project_access(db, user, auth.project_of_task(task))
    return task


def _get_user_or_422(db: Session, user_id: Optional[str], field: str) -> None:
    if user_id is not None and db.get(models.User, user_id) is None:
        raise HTTPException(422, f"{field}: user not found")


@app.post("/pins", response_model=schemas.PinOut, status_code=201)
def create_pin(payload: schemas.PinCreate, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    plan = db.get(models.Plan, payload.plan_id)
    if plan is None:
        raise HTTPException(404, "plan not found")
    auth.assert_project_access(db, user, plan.project_id)
    pin = models.Pin(**payload.model_dump(), created_by=user.id)
    db.add(pin)
    db.commit()
    db.refresh(pin)
    return pin


@app.patch("/pins/{pin_id}", response_model=schemas.PinOut)
def update_pin(pin_id: str, payload: schemas.PinUpdate, db: Session = Depends(get_db),
               user: models.User = Depends(current_user)):
    """Sposta (x/y) o rinomina un pin."""
    pin = _get_pin(db, user, pin_id)
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(pin, k, v)
    pin.updated_at = utcnow()
    db.commit()
    db.refresh(pin)
    return pin


@app.delete("/pins/{pin_id}", status_code=204)
def delete_pin(pin_id: str, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    """
    Soft-delete del pin e di tutto ciò che contiene (submission, task, allegati),
    così il sync propaga la cancellazione completa. Solo creatore o manager.
    """
    pin = _get_pin(db, user, pin_id)
    if not auth.is_manager(user) and pin.created_by != user.id:
        raise HTTPException(403, "only the creator or a manager can delete a pin")
    now = utcnow()
    for sub in pin.submissions:
        for att in sub.attachments:
            att.deleted_at = att.updated_at = now
        sub.deleted_at = sub.updated_at = now
    for task in pin.tasks:
        for att in task.attachments:
            att.deleted_at = att.updated_at = now
        task.deleted_at = task.updated_at = now
    pin.deleted_at = pin.updated_at = now
    db.commit()


@app.get("/pins/{pin_id}", response_model=schemas.PinDetail)
def get_pin(pin_id: str, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    """Pin con submissions, task e allegati (non cancellati): apertura da plan view."""
    pin = _get_pin(db, user, pin_id)
    subs = _alive(db.query(models.FormSubmission).filter_by(pin_id=pin_id), models.FormSubmission).all()
    tasks = _alive(db.query(models.Task).filter_by(pin_id=pin_id), models.Task).all()
    out = schemas.PinDetail.model_validate(pin)
    out.submissions = [_with_attachments(schemas.SubmissionOut, x) for x in subs]
    out.tasks = [_with_attachments(schemas.TaskOut, x) for x in tasks]
    return out


# ---------- Submissions (uso da web) ----------

@app.post("/submissions", response_model=schemas.SubmissionOut, status_code=201)
def create_submission(payload: schemas.SubmissionCreate, db: Session = Depends(get_db),
                      user: models.User = Depends(current_user)):
    template = db.get(models.FormTemplate, payload.template_id)
    if template is None:
        raise HTTPException(404, "template not found")
    _get_pin(db, user, payload.pin_id)
    errors = validate_submission(template.schema_def, payload.data_json)
    if errors:
        raise HTTPException(422, detail=errors)
    sub = models.FormSubmission(**payload.model_dump(exclude={"submitted_by"}), submitted_by=user.id)
    db.add(sub)
    db.commit()
    db.refresh(sub)
    return _with_attachments(schemas.SubmissionOut, sub)


@app.get("/submissions/{submission_id}", response_model=schemas.SubmissionOut)
def get_submission(submission_id: str, db: Session = Depends(get_db),
                   user: models.User = Depends(current_user)):
    sub = db.get(models.FormSubmission, submission_id)
    if sub is None or sub.deleted_at is not None:
        raise HTTPException(404, "submission not found")
    auth.assert_project_access(db, user, auth.project_of_submission(sub))
    return _with_attachments(schemas.SubmissionOut, sub)


# ---------- Task (uso da web) ----------

def _parse_status(value: str) -> TaskStatus:
    try:
        return TaskStatus(value)
    except ValueError:
        raise HTTPException(422, f"invalid status {value!r}")


@app.post("/tasks", response_model=schemas.TaskOut, status_code=201)
def create_task(payload: schemas.TaskCreate, db: Session = Depends(get_db),
                user: models.User = Depends(current_user)):
    _get_pin(db, user, payload.pin_id)
    _get_user_or_422(db, payload.assigned_to, "assigned_to")
    task = models.Task(**payload.model_dump(), created_by=user.id)
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
    user: models.User = Depends(current_user),
):
    auth.assert_project_access(db, user, project_id)
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
def get_task(task_id: str, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    return _with_attachments(schemas.TaskOut, _get_task(db, user, task_id))


@app.patch("/tasks/{task_id}", response_model=schemas.TaskOut)
def update_task(task_id: str, payload: schemas.TaskUpdate, db: Session = Depends(get_db),
                user: models.User = Depends(current_user)):
    """
    Aggiornamento parziale. Cambi di stato solo lungo TASK_TRANSITIONS (409 altrimenti);
    'verified' è riservato a manager/admin. Assegnare un task 'open' senza indicare
    lo stato lo porta automaticamente ad 'assigned'.
    """
    task = _get_task(db, user, task_id)
    changes = payload.model_dump(exclude_unset=True)
    _get_user_or_422(db, changes.get("assigned_to"), "assigned_to")

    if "status" in changes:
        new_status = _parse_status(changes.pop("status"))
        if new_status != task.status:
            if new_status not in TASK_TRANSITIONS[task.status]:
                raise HTTPException(409, f"cannot go from {task.status.value} to {new_status.value}")
            if new_status == TaskStatus.assigned and not (changes.get("assigned_to") or task.assigned_to):
                raise HTTPException(409, "assigned_to is required to move to assigned")
            if new_status == TaskStatus.verified and not auth.is_manager(user):
                raise HTTPException(403, "only manager or admin can verify a task")
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
def delete_task(task_id: str, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    """Soft-delete (manager/admin o creatore): viaggia nel sync come ogni altra modifica."""
    task = _get_task(db, user, task_id)
    if not auth.is_manager(user) and task.created_by != user.id:
        raise HTTPException(403, "only the creator or a manager can delete a task")
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
async def upload_plan_file(plan_id: str, file: UploadFile = File(...), db: Session = Depends(get_db),
                           user: models.User = Depends(require_role(UserRole.manager))):
    """
    Carica l'immagine della planimetria. Un PDF viene convertito in PNG
    (prima pagina) così tutti i client mostrano un'immagine e basta.
    Le dimensioni in pixel servono ai client per posizionare i pin (x/y relativi).
    """
    plan = db.get(models.Plan, plan_id)
    if plan is None:
        raise HTTPException(404, "plan not found")
    auth.assert_project_access(db, user, plan.project_id)
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


def _get_attachment(db: Session, user: models.User, attachment_id: str) -> models.Attachment:
    att = db.get(models.Attachment, attachment_id)
    if att is None or att.deleted_at is not None:
        raise HTTPException(404, "attachment not found")
    auth.assert_project_access(db, user, auth.project_of_attachment(att))
    return att


@app.post("/attachments", response_model=schemas.AttachmentOut, status_code=201)
def create_attachment(payload: schemas.AttachmentCreate, db: Session = Depends(get_db),
                      user: models.User = Depends(current_user)):
    """Crea il record (da web); i byte arrivano dopo con /attachments/{id}/upload."""
    if bool(payload.submission_id) == bool(payload.task_id):
        raise HTTPException(422, "exactly one of submission_id or task_id is required")
    if payload.submission_id:
        sub = db.get(models.FormSubmission, payload.submission_id)
        if sub is None:
            raise HTTPException(404, "submission not found")
        auth.assert_project_access(db, user, auth.project_of_submission(sub))
    else:
        _get_task(db, user, payload.task_id)
    if payload.id and db.get(models.Attachment, payload.id) is not None:
        raise HTTPException(409, "attachment id already exists")
    att = models.Attachment(**payload.model_dump(exclude_none=True))
    db.add(att)
    db.commit()
    db.refresh(att)
    return att


@app.post("/attachments/presign", response_model=schemas.PresignResponse)
def presign_attachment(payload: schemas.PresignRequest, db: Session = Depends(get_db),
                       user: models.User = Depends(current_user)):
    """
    L'app chiede dove caricare i byte di un allegato già sincronizzato.
    Stub per l'MVP: upload diretto sull'API. In prod restituirà un presigned URL S3.
    """
    att = _get_attachment(db, user, payload.attachment_id)
    return schemas.PresignResponse(
        attachment_id=att.id, method="POST",
        upload_url=f"/attachments/{att.id}/upload", max_bytes=st.MAX_UPLOAD_BYTES,
    )


@app.post("/attachments/{attachment_id}/upload", response_model=schemas.AttachmentOut)
async def upload_attachment(attachment_id: str, file: UploadFile = File(...), db: Session = Depends(get_db),
                            user: models.User = Depends(current_user)):
    """Carica i byte di un allegato. Idempotente: un retry sovrascrive lo stesso file."""
    att = _get_attachment(db, user, attachment_id)
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
def get_file(key: str, _: models.User = Depends(current_user)):
    """Serve i file dello storage locale. Con S3 questo endpoint sparisce (URL diretti)."""
    if not st.storage.exists(key):
        raise HTTPException(404, "file not found")
    return FileResponse(st.storage.path(key))


# ---------- Sync offline-first (uso da app nativa) ----------

def _upsert(db: Session, model, items, fk_checks: dict, updatable: list[str],
            validate=None, defaults: Optional[dict] = None) -> schemas.SyncPushResult:
    """
    Upsert idempotente per id con "last write wins".

    fk_checks: {campo_fk: Model} — ogni FK viene verificata contro il DB
               (comprese le righe appena flushate nello stesso batch).
    updatable: campi che un push più recente può sovrascrivere.
    validate:  fn(item) -> motivo di rifiuto (str) o None, eseguita dopo le FK.
    defaults:  valori applicati all'insert quando il campo è nullo (es. created_by).
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
            values = item.model_dump()
            for k, v in (defaults or {}).items():
                values[k] = values.get(k) or v
            db.add(model(**values))
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
def sync_push(payload: schemas.SyncPushRequest, db: Session = Depends(get_db),
              user: models.User = Depends(current_user)):
    """
    Riceve un batch di modifiche fatte offline sul device e le applica
    con upsert idempotente per id. Le entità con FK verso qualcosa che
    non esiste, non valide, o di progetti a cui l'utente non ha accesso
    vengono rifiutate singolarmente (`rejected`), il resto del batch passa.
    """
    def forbidden(project_id: str) -> Optional[str]:
        return None if auth.is_member(db, user, project_id) else "forbidden: not a project member"

    def check_pin(item):
        return forbidden(db.get(models.Plan, item.plan_id).project_id)

    def check_submission(item):
        if (r := forbidden(auth.project_of_pin(db.get(models.Pin, item.pin_id)))):
            return r
        # Una cancellazione non deve essere bloccata da dati vecchi non più validi.
        if item.deleted_at is not None:
            return None
        schema = db.get(models.FormTemplate, item.template_id).schema_def
        errors = validate_submission(schema, item.data_json)
        if errors:
            return "data_json: " + "; ".join(f"{e['field']}: {e['message']}" for e in errors)
        return None

    def check_task(item):
        if (r := forbidden(auth.project_of_pin(db.get(models.Pin, item.pin_id)))):
            return r
        try:
            TaskStatus(item.status)
        except ValueError:
            return f"invalid status {item.status!r}"
        return None

    def check_attachment(item):
        if bool(item.submission_id) == bool(item.task_id):
            return "exactly one of submission_id or task_id is required"
        parent = (db.get(models.FormSubmission, item.submission_id) if item.submission_id
                  else db.get(models.Task, item.task_id))
        return forbidden(auth.project_of_pin(parent.pin))

    pins = _upsert(
        db, models.Pin, payload.pins,
        fk_checks={"plan_id": models.Plan},
        updatable=["x", "y", "label", "deleted_at"],
        validate=check_pin, defaults={"created_by": user.id},
    )
    submissions = _upsert(
        db, models.FormSubmission, payload.submissions,
        fk_checks={"template_id": models.FormTemplate, "pin_id": models.Pin},
        updatable=["data_json", "submitted_by", "deleted_at"],
        validate=check_submission, defaults={"submitted_by": user.id},
    )
    tasks = _upsert(
        db, models.Task, payload.tasks,
        fk_checks={"pin_id": models.Pin, "assigned_to": models.User, "created_by": models.User},
        updatable=["title", "description", "status", "assigned_to", "due_date", "deleted_at"],
        validate=check_task, defaults={"created_by": user.id},
    )
    attachments = _upsert(
        db, models.Attachment, payload.attachments,
        fk_checks={"submission_id": models.FormSubmission, "task_id": models.Task},
        updatable=["file_url", "file_type", "deleted_at"],
        validate=check_attachment,
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
    user: models.User = Depends(current_user),
):
    """
    Ritorna tutte le modifiche del progetto (fatte da chiunque, su qualsiasi
    device) successive a `since`. Il client salva il nuovo server_time e lo
    userà come `since` alla sync successiva. Le righe con deleted_at
    valorizzato vanno rimosse localmente.
    """
    auth.assert_project_access(db, user, project_id)

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
