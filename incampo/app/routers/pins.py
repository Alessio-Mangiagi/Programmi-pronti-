"""Pin (uso da web)."""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .. import models, schemas, auth, audit
from ..auth import current_user
from ..database import get_db
from ..models import utcnow
from .common import _alive, _with_attachments, _get_pin

router = APIRouter()


# ---------- Pin ----------


@router.post("/pins", response_model=schemas.PinOut, status_code=201)
def create_pin(payload: schemas.PinCreate, request: Request, db: Session = Depends(get_db),
               user: models.User = Depends(current_user)):
    plan = db.get(models.Plan, payload.plan_id)
    if plan is None:
        raise HTTPException(404, "plan not found")
    auth.assert_project_access(db, user, plan.project_id)
    pin = models.Pin(**payload.model_dump(), created_by=user.id)
    db.add(pin)
    db.flush()
    audit.record(db, "pin.created", user, entity_type="pin", entity_id=pin.id, project_id=plan.project_id,
                 request=request, details={"plan_id": plan.id, "label": pin.label})
    db.commit()
    db.refresh(pin)
    return pin


@router.patch("/pins/{pin_id}", response_model=schemas.PinOut)
def update_pin(pin_id: str, payload: schemas.PinUpdate, request: Request, db: Session = Depends(get_db),
               user: models.User = Depends(current_user)):
    """Sposta (x/y) o rinomina un pin."""
    pin = _get_pin(db, user, pin_id)
    changes = payload.model_dump(exclude_unset=True)
    for k, v in changes.items():
        setattr(pin, k, v)
    pin.updated_at = utcnow()
    audit.record(db, "pin.updated", user, entity_type="pin", entity_id=pin.id, project_id=auth.project_of_pin(pin),
                 request=request, details={"fields": sorted(changes.keys()), "label": pin.label})
    db.commit()
    db.refresh(pin)
    return pin


@router.delete("/pins/{pin_id}", status_code=204)
def delete_pin(pin_id: str, request: Request, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    """
    Soft-delete del pin e di tutto ciò che contiene (submission, task, allegati),
    così il sync propaga la cancellazione completa. Solo creatore o manager.
    """
    pin = _get_pin(db, user, pin_id)
    audit.record(db, "pin.deleted", user, entity_type="pin", entity_id=pin.id, project_id=auth.project_of_pin(pin),
                 request=request, details={"label": pin.label, "submissions": len(pin.submissions), "tasks": len(pin.tasks)})
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


@router.get("/pins/{pin_id}", response_model=schemas.PinDetail)
def get_pin(pin_id: str, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    """Pin con submissions, task e allegati (non cancellati): apertura da plan view."""
    pin = _get_pin(db, user, pin_id)
    subs = _alive(db.query(models.FormSubmission).filter_by(pin_id=pin_id), models.FormSubmission).all()
    tasks = _alive(db.query(models.Task).filter_by(pin_id=pin_id), models.Task).all()
    out = schemas.PinDetail.model_validate(pin)
    out.submissions = [_with_attachments(schemas.SubmissionOut, x) for x in subs]
    out.tasks = [_with_attachments(schemas.TaskOut, x) for x in tasks]
    return out
