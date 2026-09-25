"""Segnalazioni all'amministratore: chiunque scrive, gli admin leggono e chiudono."""
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models, schemas, auth, events, audit
from ..auth import current_user, require_role
from ..database import get_db
from ..models import utcnow

router = APIRouter()

# Anti spam: oltre questo numero di segnalazioni in un'ora dallo stesso utente → 429.
SUPPORT_MAX_PER_HOUR = 10


def _support_out(m: models.SupportMessage) -> schemas.SupportMessageOut:
    out = schemas.SupportMessageOut.model_validate(m)
    out.user_name, out.user_email = m.user.name, m.user.email
    out.project_name = m.project.name if m.project else None
    out.closed_by_name = m.closed_by.name if m.closed_by else None
    return out


@router.post("/support/messages", response_model=schemas.SupportMessageOut, status_code=201)
def create_support_message(payload: schemas.SupportMessageCreate, request: Request, db: Session = Depends(get_db),
                           user: models.User = Depends(current_user)):
    """Messaggio all'amministratore (qualsiasi utente). Il cantiere, se indicato, deve essere accessibile."""
    text = payload.message.strip()
    if not text:
        raise HTTPException(422, "message: scrivi il messaggio")
    if payload.project_id:
        auth.assert_project_access(db, user, payload.project_id)
    recent = db.query(func.count(models.SupportMessage.id)).filter(
        models.SupportMessage.user_id == user.id,
        models.SupportMessage.created_at >= utcnow() - timedelta(hours=1)).scalar()
    if recent >= SUPPORT_MAX_PER_HOUR:
        raise HTTPException(429, "Hai già inviato molte segnalazioni: riprova tra un po'")
    ua = request.headers.get("user-agent")
    msg = models.SupportMessage(user_id=user.id, project_id=payload.project_id or None, message=text,
                                page=payload.page, user_agent=ua[:200] if ua else None)
    db.add(msg)
    db.flush()
    events.record_support_message(db, msg)
    audit.record(db, "support.message_sent", user, entity_type="support_message", entity_id=msg.id,
                 project_id=msg.project_id, request=request)
    db.commit()
    db.refresh(msg)
    return _support_out(msg)


@router.get("/support/messages", response_model=list[schemas.SupportMessageOut])
def list_support_messages(status: Optional[str] = None, db: Session = Depends(get_db),
                          _: models.User = Depends(require_role())):
    """Segnalazioni (solo admin), più recenti prima; `status` = open | closed per filtrare."""
    q = db.query(models.SupportMessage)
    if status:
        q = q.filter(models.SupportMessage.status == status)
    return [_support_out(m) for m in q.order_by(models.SupportMessage.created_at.desc()).limit(500).all()]


@router.patch("/support/messages/{message_id}", response_model=schemas.SupportMessageOut)
def update_support_message(message_id: str, payload: schemas.SupportMessageUpdate, request: Request,
                           db: Session = Depends(get_db), user: models.User = Depends(require_role())):
    """Chiude (gestita) o riapre una segnalazione (solo admin)."""
    msg = db.get(models.SupportMessage, message_id)
    if msg is None:
        raise HTTPException(404, "message not found")
    if msg.status != payload.status:
        msg.status = payload.status
        closed = payload.status == "closed"
        msg.closed_at, msg.closed_by_id = (utcnow(), user.id) if closed else (None, None)
        audit.record(db, "support.message_closed" if closed else "support.message_reopened", user,
                     entity_type="support_message", entity_id=msg.id, project_id=msg.project_id, request=request)
        db.commit()
        db.refresh(msg)
    return _support_out(msg)
