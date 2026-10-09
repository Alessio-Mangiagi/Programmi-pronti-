"""Planimetrie, pin per planimetria e template dei moduli."""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from .. import models, schemas, auth, audit
from ..auth import current_user, require_role
from ..database import get_db
from ..forms import validate_schema
from ..models import utcnow, TaskStatus, UserRole
from ..schemas import to_naive_utc
from .common import _alive, _parse_status

router = APIRouter()


# ---------- Planimetrie e template ----------

@router.post("/plans", response_model=schemas.PlanOut, status_code=201)
def create_plan(payload: schemas.PlanCreate, request: Request, db: Session = Depends(get_db),
                user: models.User = Depends(require_role(UserRole.manager))):
    auth.assert_project_access(db, user, payload.project_id)
    plan = models.Plan(**payload.model_dump())
    db.add(plan)
    db.flush()
    audit.record(db, "plan.created", user, entity_type="plan", entity_id=plan.id, project_id=plan.project_id,
                 request=request, details={"name": plan.name})
    db.commit()
    db.refresh(plan)
    return plan


@router.get("/projects/{project_id}/plans", response_model=list[schemas.PlanOut])
def list_plans(project_id: str, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    auth.assert_project_access(db, user, project_id)
    return db.query(models.Plan).filter(models.Plan.project_id == project_id).order_by(models.Plan.name).all()


@router.get("/plans/{plan_id}", response_model=schemas.PlanOut)
def get_plan(plan_id: str, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    plan = db.get(models.Plan, plan_id)
    if plan is None:
        raise HTTPException(404, "plan not found")
    auth.assert_project_access(db, user, plan.project_id)
    return plan


@router.get("/plans/{plan_id}/pins", response_model=list[schemas.PinSummary])
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


@router.post("/form-templates", response_model=schemas.FormTemplateOut, status_code=201)
def create_form_template(payload: schemas.FormTemplateCreate, request: Request, db: Session = Depends(get_db),
                         user: models.User = Depends(require_role(UserRole.admin))):
    """Nuovo modulo (anche duplicato o da PCQ): solo l'amministratore. I responsabili li modificano."""
    errors = validate_schema(payload.schema_def)
    if errors:
        raise HTTPException(422, detail=errors)
    template = models.FormTemplate(**payload.model_dump())
    db.add(template)
    db.flush()
    audit.record(db, "template.created", user, entity_type="template", entity_id=template.id, request=request,
                 details={"name": template.name})
    db.commit()
    db.refresh(template)
    return _template_out(db, template)


def _template_out(db: Session, template: models.FormTemplate) -> schemas.FormTemplateOut:
    out = schemas.FormTemplateOut.model_validate(template)
    out.submissions_count = (db.query(func.count(models.FormSubmission.id))
                             .filter(models.FormSubmission.template_id == template.id,
                                     models.FormSubmission.deleted_at.is_(None)).scalar())
    return out


@router.get("/form-templates", response_model=list[schemas.FormTemplateOut])
def list_form_templates(include_archived: bool = False, db: Session = Depends(get_db),
                        _: models.User = Depends(current_user)):
    """Template proponibili; con include_archived anche quelli archiviati (per leggere vecchie submission)."""
    q = db.query(models.FormTemplate)
    if not include_archived:
        q = q.filter(models.FormTemplate.archived_at.is_(None))
    return [_template_out(db, t) for t in q.order_by(models.FormTemplate.name).all()]


@router.get("/form-templates/{template_id}", response_model=schemas.FormTemplateOut)
def get_form_template(template_id: str, db: Session = Depends(get_db), _: models.User = Depends(current_user)):
    template = db.get(models.FormTemplate, template_id)
    if template is None:
        raise HTTPException(404, "template not found")
    return _template_out(db, template)


@router.patch("/form-templates/{template_id}", response_model=schemas.FormTemplateOut)
def update_form_template(template_id: str, payload: schemas.FormTemplateUpdate, request: Request,
                         db: Session = Depends(get_db),
                         user: models.User = Depends(require_role(UserRole.manager))):
    """
    Nome/categoria/archiviazione sempre; `schema_def` solo se nessuna submission
    usa ancora il template (409 altrimenti: duplicare e modificare la copia).
    """
    template = db.get(models.FormTemplate, template_id)
    if template is None:
        raise HTTPException(404, "template not found")
    changes = payload.model_dump(exclude_unset=True)
    if "schema_def" in changes:
        errors = validate_schema(changes["schema_def"])
        if errors:
            raise HTTPException(422, detail=errors)
        if _template_out(db, template).submissions_count:
            raise HTTPException(409, "template already used by submissions: duplicate it instead")
        template.schema_def = changes.pop("schema_def")
    if "archived" in changes:
        archived = changes.pop("archived")
        if archived != (template.archived_at is not None):
            audit.record(db, "template.archived" if archived else "template.restored", user, entity_type="template",
                         entity_id=template.id, request=request, details={"name": template.name})
        template.archived_at = utcnow() if archived else None
    if "name" in changes and not (changes["name"] or "").strip():
        raise HTTPException(422, "name must not be empty")
    for k, v in changes.items():
        setattr(template, k, v)
    edited = sorted(k for k in payload.model_dump(exclude_unset=True) if k != "archived")
    if edited:
        audit.record(db, "template.updated", user, entity_type="template", entity_id=template.id, request=request,
                     details={"name": template.name, "fields": edited})
    template.updated_at = utcnow()
    db.commit()
    db.refresh(template)
    return _template_out(db, template)
