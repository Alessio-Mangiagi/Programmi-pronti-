"""Task (uso da web) e statistiche del cantiere."""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from .. import models, schemas, auth, events, audit, stats as st_stats
from ..auth import current_user
from ..database import get_db
from ..models import utcnow, TaskStatus, TASK_TRANSITIONS
from ..schemas import to_naive_utc
from .common import _with_attachments, _get_pin, _get_task, _get_user_or_422, _parse_status

router = APIRouter()


# ---------- Task (uso da web) ----------


@router.post("/tasks", response_model=schemas.TaskOut, status_code=201)
def create_task(payload: schemas.TaskCreate, request: Request, db: Session = Depends(get_db),
                user: models.User = Depends(current_user)):
    _get_pin(db, user, payload.pin_id)
    _get_user_or_422(db, payload.assigned_to, "assigned_to")
    task = models.Task(**payload.model_dump(), created_by=user.id)
    task.status = TaskStatus.assigned if payload.assigned_to else TaskStatus.open
    db.add(task)
    db.flush()
    project_id = auth.project_of_pin(task.pin)
    events.record_task_created(db, task, project_id, user.id)
    audit.record(db, "task.created", user, entity_type="task", entity_id=task.id, project_id=project_id,
                 request=request, details={"title": task.title, "assigned_to": task.assigned_to})
    db.commit()
    db.refresh(task)
    return _with_attachments(schemas.TaskOut, task)


@router.get("/projects/{project_id}/tasks", response_model=list[schemas.TaskListItem])
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
    out = []
    for t in q.all():
        base = _with_attachments(schemas.TaskOut, t)
        out.append(schemas.TaskListItem(**base.model_dump(), plan_id=t.pin.plan_id,
                                        plan_name=t.pin.plan.name, pin_label=t.pin.label))
    return out


@router.get("/projects/{project_id}/stats", response_model=schemas.StatsOut)
def project_stats(
    project_id: str,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    template_id: Optional[str] = None,
    plan_id: Optional[str] = None,
    assigned_to: Optional[str] = None,
    days: int = Query(30, ge=7, le=365),
    db: Session = Depends(get_db),
    user: models.User = Depends(current_user),
):
    """Numeri per la dashboard: task per stato, aperti per planimetria, moduli per template, serie giornaliera, scaduti."""
    auth.assert_project_access(db, user, project_id)
    return st_stats.project_stats(db, project_id, date_from=to_naive_utc(date_from), date_to=to_naive_utc(date_to),
                                  template_id=template_id, plan_id=plan_id, assigned_to=assigned_to, days=days)


@router.get("/tasks/{task_id}", response_model=schemas.TaskOut)
def get_task(task_id: str, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    return _with_attachments(schemas.TaskOut, _get_task(db, user, task_id))


@router.patch("/tasks/{task_id}", response_model=schemas.TaskOut)
def update_task(task_id: str, payload: schemas.TaskUpdate, request: Request, db: Session = Depends(get_db),
                user: models.User = Depends(current_user)):
    """
    Aggiornamento parziale. Cambi di stato solo lungo TASK_TRANSITIONS (409 altrimenti);
    'verified' è riservato a manager/admin. Assegnare un task 'open' senza indicare
    lo stato lo porta automaticamente ad 'assigned'.
    """
    task = _get_task(db, user, task_id)
    before = {"status": task.status.value, "assigned_to": task.assigned_to}
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
            st_stats.mark_resolved_at(task, before["status"])
    elif changes.get("assigned_to") and task.status == TaskStatus.open:
        task.status = TaskStatus.assigned

    for k, v in changes.items():
        setattr(task, k, v)
    task.updated_at = utcnow()
    events.record_task_changes(db, task, auth.project_of_task(task), user.id, before)
    audit.record(db, "task.updated", user, entity_type="task", entity_id=task.id, project_id=auth.project_of_task(task),
                 request=request, details={"title": task.title, "fields": sorted(payload.model_dump(exclude_unset=True).keys()),
                                           "status": {"from": before["status"], "to": task.status.value}
                                           if before["status"] != task.status.value else None})
    db.commit()
    db.refresh(task)
    return _with_attachments(schemas.TaskOut, task)


@router.delete("/tasks/{task_id}", status_code=204)
def delete_task(task_id: str, request: Request, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    """Soft-delete (manager/admin o creatore): viaggia nel sync come ogni altra modifica."""
    task = _get_task(db, user, task_id)
    if not auth.is_manager(user) and task.created_by != user.id:
        raise HTTPException(403, "only the creator or a manager can delete a task")
    task.deleted_at = task.updated_at = utcnow()
    audit.record(db, "task.deleted", user, entity_type="task", entity_id=task.id, project_id=auth.project_of_task(task),
                 request=request, details={"title": task.title})
    db.commit()
