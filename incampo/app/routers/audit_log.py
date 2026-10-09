"""Registro operazioni (solo admin)."""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from .. import models, schemas, audit
from ..auth import require_role
from ..database import get_db
from ..schemas import to_naive_utc

router = APIRouter()


# ---------- Registro operazioni (solo admin) ----------

@router.get("/audit/actions", response_model=list[schemas.AuditActionOut])
def audit_actions(_: models.User = Depends(require_role())):
    return [schemas.AuditActionOut(action=a, label=audit.ACTION_LABELS.get(a, a)) for a in audit.ACTIONS]


@router.get("/audit", response_model=schemas.AuditPage)
def list_audit(
    actor_id: Optional[str] = None,
    action: Optional[list[str]] = Query(default=None),
    project_id: Optional[str] = None,
    entity_id: Optional[str] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    q: Optional[str] = None,
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _: models.User = Depends(require_role()),
):
    """
    Registro operazioni, dal più recente. Filtri: utente, una o più azioni,
    progetto, entità, intervallo date (`date_to` inclusivo se solo data), testo
    libero su email attore / entità / IP. Paginato (`total` per la UI).
    """
    A = models.AuditLog
    query = db.query(A)
    if actor_id:
        query = query.filter(A.actor_id == actor_id)
    if action:
        query = query.filter(A.action.in_(action))
    if project_id:
        query = query.filter(A.project_id == project_id)
    if entity_id:
        query = query.filter(A.entity_id == entity_id)
    if date_from:
        query = query.filter(A.created_at >= to_naive_utc(date_from))
    if date_to:
        end = to_naive_utc(date_to)
        if end.time() == datetime.min.time():
            end = end + timedelta(days=1)
        query = query.filter(A.created_at < end)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(or_(A.actor_email.ilike(like), A.entity_id.ilike(like), A.ip.ilike(like),
                                 A.action.ilike(like)))
    total = query.with_entities(func.count(A.id)).scalar() or 0
    rows = query.order_by(A.created_at.desc(), A.id.desc()).offset(offset).limit(limit).all()
    names = {u.id: u.name for u in db.query(models.User).filter(models.User.id.in_({r.actor_id for r in rows if r.actor_id})).all()} if rows else {}
    projects = {p.id: p.name for p in db.query(models.Project).filter(models.Project.id.in_({r.project_id for r in rows if r.project_id})).all()} if rows else {}
    items = [schemas.AuditOut(
        id=r.id, action=r.action, actor_id=r.actor_id, actor_email=r.actor_email,
        actor_name=names.get(r.actor_id), entity_type=r.entity_type, entity_id=r.entity_id,
        project_id=r.project_id, project_name=projects.get(r.project_id), details=r.details or {},
        ip=r.ip, user_agent=r.user_agent, created_at=r.created_at) for r in rows]
    return schemas.AuditPage(items=items, total=int(total), limit=limit, offset=offset)
