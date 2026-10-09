"""Etichette d'invito (credenziali preimpostate), inviti e attività utenti."""
import re
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from .. import models, schemas, auth, audit, invites as inv_lib, notify
from ..auth import require_role
from ..database import get_db
from ..models import utcnow, UserRole

router = APIRouter()


# ---------- Etichette d'invito (credenziali preimpostate) ----------

def _label_invites(db: Session, label_id: str) -> list[models.Invite]:
    return db.query(models.Invite).filter(models.Invite.label_id == label_id).all()


def _label_out(db: Session, lab: models.InviteLabel) -> schemas.InviteLabelOut:
    pending = sum(1 for i in _label_invites(db, lab.id) if inv_lib.status_of(i) == "pending")
    return schemas.InviteLabelOut(
        id=lab.id, name=lab.name, description=lab.description, role=lab.role.value,
        project_ids=list(lab.project_ids or []), commessa_ids=list(lab.commessa_ids or []),
        notify_email=lab.notify_email, notify_push=lab.notify_push, position=lab.position,
        archived_at=lab.archived_at, created_at=lab.created_at, updated_at=lab.updated_at,
        projects_count=len(inv_lib.target_project_ids(db, lab)), pending_invites=pending,
    )


def _parse_role(value: str) -> UserRole:
    try:
        return UserRole(value)
    except ValueError:
        raise HTTPException(422, f"invalid role {value!r}")


def _check_ids(db: Session, model, ids: list[str], what: str) -> list[str]:
    """Toglie i duplicati e rifiuta gli id inesistenti: un'etichetta non punta nel vuoto."""
    clean = list(dict.fromkeys(ids or []))
    if not clean:
        return []
    found = {r[0] for r in db.query(model.id).filter(model.id.in_(clean)).all()}
    missing = [i for i in clean if i not in found]
    if missing:
        raise HTTPException(422, f"unknown {what}: {missing}")
    return clean


@router.get("/invite-labels", response_model=list[schemas.InviteLabelOut])
def list_invite_labels(include_archived: bool = False, db: Session = Depends(get_db),
                       user: models.User = Depends(require_role(UserRole.manager))):
    """Etichette disponibili: le legge anche il manager (gli servono per invitare), le scrive solo l'admin."""
    q = db.query(models.InviteLabel)
    if not include_archived:
        q = q.filter(models.InviteLabel.archived_at.is_(None))
    rows = q.order_by(models.InviteLabel.position, models.InviteLabel.created_at).all()
    return [_label_out(db, lab) for lab in rows]


@router.post("/invite-labels", response_model=schemas.InviteLabelOut, status_code=201)
def create_invite_label(payload: schemas.InviteLabelCreate, request: Request, db: Session = Depends(get_db),
                        admin: models.User = Depends(require_role())):
    """Solo admin: le credenziali preimpostate si decidono qui e da nessun'altra parte."""
    name = payload.name.strip()
    if not name:
        raise HTTPException(422, "name must not be empty")
    if db.query(models.InviteLabel).filter(models.InviteLabel.name == name).first():
        raise HTTPException(409, "label name already used")
    role = _parse_role(payload.role)
    last = db.query(func.max(models.InviteLabel.position)).scalar() or 0
    lab = models.InviteLabel(
        name=name, description=(payload.description or None), role=role,
        project_ids=_check_ids(db, models.Project, payload.project_ids, "project_ids"),
        commessa_ids=_check_ids(db, models.Commessa, payload.commessa_ids, "commessa_ids"),
        notify_email=payload.notify_email, notify_push=payload.notify_push, position=last + 1,
    )
    db.add(lab)
    db.flush()
    audit.record(db, "invite_label.created", admin, entity_type="invite_label", entity_id=lab.id, request=request,
                 details={"name": name, "role": role.value})
    db.commit()
    db.refresh(lab)
    return _label_out(db, lab)


@router.patch("/invite-labels/{label_id}", response_model=schemas.InviteLabelOut)
def update_invite_label(label_id: str, payload: schemas.InviteLabelUpdate, request: Request,
                        db: Session = Depends(get_db), admin: models.User = Depends(require_role())):
    """Solo admin. Gli inviti già accettati non cambiano: l'etichetta vale al momento in cui viene accettata."""
    lab = db.get(models.InviteLabel, label_id)
    if lab is None:
        raise HTTPException(404, "invite label not found")
    changes = payload.model_dump(exclude_unset=True)
    details: dict = {}

    if changes.get("name") is not None:
        name = changes["name"].strip()
        if not name:
            raise HTTPException(422, "name must not be empty")
        clash = db.query(models.InviteLabel).filter(models.InviteLabel.name == name,
                                                    models.InviteLabel.id != lab.id).first()
        if clash:
            raise HTTPException(409, "label name already used")
        if name != lab.name:
            details["name"] = {"from": lab.name, "to": name}
            lab.name = name
    if "description" in changes:
        lab.description = changes["description"] or None
    if changes.get("role") is not None:
        role = _parse_role(changes["role"])
        if role != lab.role:
            details["role"] = {"from": lab.role.value, "to": role.value}
            lab.role = role
    if changes.get("project_ids") is not None:
        lab.project_ids = _check_ids(db, models.Project, changes["project_ids"], "project_ids")
        details["project_ids"] = lab.project_ids
    if changes.get("commessa_ids") is not None:
        lab.commessa_ids = _check_ids(db, models.Commessa, changes["commessa_ids"], "commessa_ids")
        details["commessa_ids"] = lab.commessa_ids
    for k in ("notify_email", "notify_push", "position"):
        if changes.get(k) is not None:
            setattr(lab, k, changes[k])
    if changes.get("archived") is not None:
        lab.archived_at = utcnow() if changes["archived"] else None
        details["archived"] = bool(changes["archived"])

    if details:
        audit.record(db, "invite_label.updated", admin, entity_type="invite_label", entity_id=lab.id,
                     request=request, details={"name": lab.name, **details})
    lab.updated_at = utcnow()
    db.commit()
    db.refresh(lab)
    return _label_out(db, lab)


@router.delete("/invite-labels/{label_id}", status_code=204)
def delete_invite_label(label_id: str, request: Request, db: Session = Depends(get_db),
                        admin: models.User = Depends(require_role())):
    """Solo admin. Con inviti collegati si rifiuta (409): prima si revocano, oppure si archivia l'etichetta."""
    lab = db.get(models.InviteLabel, label_id)
    if lab is None:
        raise HTTPException(404, "invite label not found")
    used = _label_invites(db, lab.id)
    if any(inv_lib.status_of(i) == "pending" for i in used):
        raise HTTPException(409, "label has pending invites")
    if used:
        raise HTTPException(409, "label used by past invites: archive it instead")
    audit.record(db, "invite_label.deleted", admin, entity_type="invite_label", entity_id=lab.id, request=request,
                 details={"name": lab.name})
    db.delete(lab)
    db.commit()
    return Response(status_code=204)


# ---------- Inviti ----------

def _invite_out(inv: models.Invite, url: Optional[str] = None) -> schemas.InviteOut:
    return schemas.InviteOut(
        id=inv.id, email=inv.email, name=inv.name, label_id=inv.label_id, label_name=inv.label.name,
        role=inv.label.role.value, status=inv_lib.status_of(inv), invited_by_id=inv.invited_by_id,
        invited_by_name=inv.invited_by.name if inv.invited_by else None, expires_at=inv.expires_at,
        accepted_at=inv.accepted_at, revoked_at=inv.revoked_at, email_sent_at=inv.email_sent_at,
        created_at=inv.created_at, url=url,
    )


def _send_invite_email(db: Session, invite: models.Invite, url: str, inviter: models.User) -> bool:
    """Manda l'email d'invito; se SMTP manca o fallisce resta il link da consegnare a mano."""
    subject, body = inv_lib.email_body(invite, url, inviter.name)
    email_sender, _ = notify.senders_from_env()
    try:
        email_sender.send(invite.email, subject, body)
    except Exception as exc:  # noqa: BLE001 - l'invito resta valido anche senza email
        audit.record(db, "invite.email_failed", inviter, entity_type="invite", entity_id=invite.id,
                     details={"email": invite.email, "error": str(exc)[:200]})
        return False
    invite.email_sent_at = utcnow()
    return True


@router.post("/invites", response_model=schemas.InviteOut, status_code=201)
def create_invite(payload: schemas.InviteCreate, request: Request, db: Session = Depends(get_db),
                  user: models.User = Depends(require_role(UserRole.manager))):
    """
    Invita un'email con un'etichetta: ruolo, cantieri e notifiche arrivano da lì.
    Un manager non può invitare con un'etichetta di livello più alto del suo.
    La risposta contiene `url`, il link col token: è l'unica volta che esiste in
    chiaro (nel database c'è solo l'hash), quindi la UI lo mostra subito.
    """
    email = payload.email.lower().strip()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise HTTPException(422, "invalid email")
    label = db.get(models.InviteLabel, payload.label_id)
    if label is None or label.archived_at is not None:
        raise HTTPException(404, "invite label not found")
    if not inv_lib.can_invite_with(user, label):
        raise HTTPException(403, f"cannot invite with label of role {label.role.value}")
    if db.query(models.User).filter(models.User.email == email).first():
        raise HTTPException(409, "email already registered")
    pending = [i for i in db.query(models.Invite).filter(models.Invite.email == email).all()
               if inv_lib.status_of(i) == "pending"]
    if pending:
        raise HTTPException(409, "an invite for this email is already pending")

    invite, token = inv_lib.create(db, email=email, label=label, invited_by=user, name=payload.name)
    db.flush()
    url = inv_lib.invite_url(notify.WEB_URL, token)
    _send_invite_email(db, invite, url, user)
    audit.record(db, "invite.created", user, entity_type="invite", entity_id=invite.id, request=request,
                 details={"email": email, "label": label.name, "role": label.role.value})
    db.commit()
    db.refresh(invite)
    return _invite_out(invite, url=url)


@router.get("/invites", response_model=list[schemas.InviteOut])
def list_invites(include_done: bool = False, db: Session = Depends(get_db),
                 user: models.User = Depends(require_role(UserRole.manager))):
    """Inviti in sospeso (con `include_done` anche accettati/revocati/scaduti). Il manager vede i propri."""
    q = db.query(models.Invite)
    if user.role != UserRole.admin:
        q = q.filter(models.Invite.invited_by_id == user.id)
    rows = q.order_by(models.Invite.created_at.desc()).all()
    out = [_invite_out(i) for i in rows]
    return out if include_done else [i for i in out if i.status == "pending"]


@router.post("/invites/{invite_id}/resend", response_model=schemas.InviteOut)
def resend_invite(invite_id: str, request: Request, db: Session = Depends(get_db),
                  user: models.User = Depends(require_role(UserRole.manager))):
    """
    Rigenera il link (quello vecchio smette di valere) e fa ripartire la scadenza.
    Serve anche a recuperare un link perso: in chiaro non era rimasto da nessuna parte.
    """
    invite = db.get(models.Invite, invite_id)
    if invite is None or (user.role != UserRole.admin and invite.invited_by_id != user.id):
        raise HTTPException(404, "invite not found")
    if inv_lib.status_of(invite) in ("accepted", "revoked"):
        raise HTTPException(409, "invite already closed")
    token = inv_lib.new_token()
    invite.token_hash = inv_lib.token_hash(token)
    invite.expires_at = utcnow() + timedelta(days=inv_lib.INVITE_DAYS)
    invite.updated_at = utcnow()
    url = inv_lib.invite_url(notify.WEB_URL, token)
    _send_invite_email(db, invite, url, user)
    audit.record(db, "invite.resent", user, entity_type="invite", entity_id=invite.id, request=request,
                 details={"email": invite.email})
    db.commit()
    db.refresh(invite)
    return _invite_out(invite, url=url)


@router.delete("/invites/{invite_id}", status_code=204)
def revoke_invite(invite_id: str, request: Request, db: Session = Depends(get_db),
                  user: models.User = Depends(require_role(UserRole.manager))):
    """Revoca: il link smette di funzionare subito. Un invito già accettato non si revoca (si disattiva l'utente)."""
    invite = db.get(models.Invite, invite_id)
    if invite is None or (user.role != UserRole.admin and invite.invited_by_id != user.id):
        raise HTTPException(404, "invite not found")
    if invite.accepted_at:
        raise HTTPException(409, "invite already accepted")
    invite.revoked_at = utcnow()
    audit.record(db, "invite.revoked", user, entity_type="invite", entity_id=invite.id, request=request,
                 details={"email": invite.email})
    db.commit()
    return Response(status_code=204)


@router.get("/invites/token/{token}", response_model=schemas.InvitePreviewOut)
def preview_invite(token: str, db: Session = Depends(get_db)):
    """Pubblico: che cosa sto accettando. Stato non valido = 404, senza distinguere i casi."""
    invite = inv_lib.by_token(db, token)
    if invite is None or inv_lib.status_of(invite) != "pending":
        raise HTTPException(404, "invite not found or no longer valid")
    return schemas.InvitePreviewOut(
        email=invite.email, name=invite.name, label_name=invite.label.name, role=invite.label.role.value,
        projects_count=len(inv_lib.target_project_ids(db, invite.label)), expires_at=invite.expires_at,
    )


@router.post("/invites/accept", response_model=schemas.TokenResponse, status_code=201)
def accept_invite(payload: schemas.InviteAccept, request: Request, db: Session = Depends(get_db)):
    """
    Pubblico: l'invitato sceglie nome e password, l'utente nasce con il profilo
    dell'etichetta (ruolo, cantieri, notifiche) ed è già dentro.
    """
    invite = inv_lib.by_token(db, payload.token)
    if invite is None or inv_lib.status_of(invite) != "pending":
        raise HTTPException(404, "invite not found or no longer valid")
    if not payload.name.strip():
        raise HTTPException(422, "name must not be empty")
    if db.query(models.User).filter(models.User.email == invite.email).first():
        raise HTTPException(409, "email already registered")

    user = inv_lib.accept(db, invite, name=payload.name, password_hash=auth.hash_password(payload.password))
    audit.record(db, "invite.accepted", user, entity_type="invite", entity_id=invite.id, request=request,
                 details={"email": invite.email, "label": invite.label.name, "role": user.role.value})
    db.commit()
    db.refresh(user)
    return schemas.TokenResponse(access_token=auth.create_access_token(user), user=user)


@router.get("/users/activity", response_model=list[schemas.UserActivityOut])
def users_activity(db: Session = Depends(get_db), _: models.User = Depends(require_role())):
    """Solo admin: ultimo accesso e conteggio operazioni per utente (per la tabella utenti)."""
    A = models.AuditLog
    since = utcnow() - timedelta(days=30)
    rows = (db.query(A.actor_id,
                     func.max(case((A.action == "auth.login", A.created_at))),
                     func.count(A.id),
                     func.sum(case((A.created_at >= since, 1), else_=0)))
            .filter(A.actor_id.isnot(None)).group_by(A.actor_id).all())
    return [schemas.UserActivityOut(user_id=uid, last_login=last, actions_total=int(n or 0),
                                    actions_last_30d=int(n30 or 0)) for uid, last, n, n30 in rows]
