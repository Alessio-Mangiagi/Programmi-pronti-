"""Helper condivisi tra i router: lookup con controllo accesso e piccole utility."""
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas, auth
from ..models import TaskStatus


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


def _get_wbs_node(db: Session, user: models.User, node_id: str) -> models.WbsNode:
    node = db.get(models.WbsNode, node_id)
    if node is None:
        raise HTTPException(404, "wbs node not found")
    auth.assert_project_access(db, user, node.project_id)
    return node


def _parse_status(value: str) -> TaskStatus:
    try:
        return TaskStatus(value)
    except ValueError:
        raise HTTPException(422, f"invalid status {value!r}")
