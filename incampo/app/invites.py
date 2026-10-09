"""
Inviti con credenziali preimpostate.

Un invito lega un'email a un'etichetta (`InviteLabel`), cioè al profilo deciso
dagli amministratori: ruolo globale, cantieri/commesse a cui iscriversi,
preferenze di notifica. Chi invita sceglie l'etichetta, non i permessi.

Il link contiene un token casuale; nel database sta solo il suo hash SHA-256,
come per le password: chi legge la tabella non può rigenerare i link. Il token
vale una volta sola e scade (INVITE_DAYS, default 7 giorni).

Funzioni pure (nessun commit): gli endpoint in main.py aprono/chiudono la
transazione e scrivono l'audit.
"""
import hashlib
import os
import secrets
from datetime import timedelta
from typing import Optional

from sqlalchemy.orm import Session

from . import models
from .models import UserRole, utcnow

INVITE_DAYS = int(os.getenv("INVITE_DAYS", "7"))

# Chi può invitare chi: un manager non crea amministratori né altri manager
# con più potere di lui; l'admin non ha limiti.
ROLE_RANK = {UserRole.field: 0, UserRole.manager: 1, UserRole.admin: 2}


def new_token() -> str:
    """Token del link: 32 byte casuali, URL-safe."""
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def invite_url(web_url: str, token: str) -> str:
    return f"{web_url.rstrip('/')}/invito/{token}"


def can_invite_with(actor: models.User, label: models.InviteLabel) -> bool:
    if actor.role == UserRole.admin:
        return True
    return ROLE_RANK[label.role] <= ROLE_RANK[actor.role]


def status_of(inv: models.Invite, now=None) -> str:
    """pending | accepted | revoked | expired — quello che la UI mostra."""
    now = now or utcnow()
    if inv.accepted_at:
        return "accepted"
    if inv.revoked_at:
        return "revoked"
    if inv.expires_at <= now:
        return "expired"
    return "pending"


def create(db: Session, *, email: str, label: models.InviteLabel, invited_by: models.User,
           name: Optional[str] = None, days: int = INVITE_DAYS) -> tuple[models.Invite, str]:
    """Crea l'invito e restituisce (riga, token in chiaro). Il token non è più recuperabile dopo."""
    token = new_token()
    inv = models.Invite(
        email=email.lower().strip(),
        label_id=label.id,
        token_hash=token_hash(token),
        name=(name or "").strip() or None,
        invited_by_id=invited_by.id,
        expires_at=utcnow() + timedelta(days=days),
    )
    db.add(inv)
    return inv, token


def by_token(db: Session, token: str) -> Optional[models.Invite]:
    return db.query(models.Invite).filter(models.Invite.token_hash == token_hash(token)).first()


def target_project_ids(db: Session, label: models.InviteLabel) -> list[str]:
    """
    Cantieri su cui iscrivere l'invitato: quelli indicati più tutti quelli delle
    commesse indicate (espanse adesso, non quando l'etichetta è stata scritta).
    """
    ids = {pid for pid in (label.project_ids or [])}
    commesse = list(label.commessa_ids or [])
    if commesse:
        rows = db.query(models.Project.id).filter(models.Project.commessa_id.in_(commesse)).all()
        ids.update(r[0] for r in rows)
    existing = db.query(models.Project.id).filter(models.Project.id.in_(ids)).all() if ids else []
    return sorted(r[0] for r in existing)


def accept(db: Session, inv: models.Invite, *, name: str, password_hash: str) -> models.User:
    """
    Crea l'utente con il profilo dell'etichetta, lo iscrive ai cantieri previsti
    e consuma l'invito. Il chiamante ha già verificato stato e email libera.
    """
    label = inv.label
    user = models.User(
        email=inv.email,
        name=name.strip(),
        password_hash=password_hash,
        role=label.role,
        notify_email=label.notify_email,
        notify_push=label.notify_push,
    )
    db.add(user)
    db.flush()

    for project_id in target_project_ids(db, label):
        if db.get(models.ProjectMember, (project_id, user.id)) is None:
            db.add(models.ProjectMember(project_id=project_id, user_id=user.id))

    inv.accepted_at = utcnow()
    inv.accepted_user_id = user.id
    return user


def email_body(inv: models.Invite, url: str, inviter_name: str) -> tuple[str, str]:
    """Oggetto e testo dell'email d'invito (italiano, link diretto)."""
    label = inv.label.name
    subject = "Invito a InCampo"
    body = (
        f"{inviter_name} ti ha invitato su InCampo come «{label}».\n\n"
        f"Apri questo link e scegli la tua password:\n{url}\n\n"
        f"Il link vale una sola volta e scade il "
        f"{inv.expires_at.strftime('%d/%m/%Y')}.\n"
        "Se non ti aspettavi questo invito, ignora il messaggio."
    )
    return subject, body
