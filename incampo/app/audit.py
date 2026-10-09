"""
Registro delle operazioni (audit log): chi ha fatto cosa, quando, da dove.

Una riga per azione rilevante, scritta nella stessa transazione della modifica
(commit dell'endpoint) così non esistono azioni senza traccia né tracce di azioni
fallite. Diverso da `events` (outbox delle notifiche, per progetto): qui il
perimetro è l'intero sistema, compresi login e gestione utenti, e le righe non
vengono mai consumate né cancellate.
"""
from typing import Optional

from fastapi import Request
from sqlalchemy.orm import Session

from . import models

# Catalogo delle azioni: `GET /audit/actions` lo espone alla UI per il filtro.
ACTIONS = [
    "auth.login", "auth.login_failed",
    "user.created", "user.updated", "user.password_reset", "user.deactivated", "user.reactivated",
    "invite_label.created", "invite_label.updated", "invite_label.deleted",
    "invite.created", "invite.resent", "invite.revoked", "invite.accepted", "invite.email_failed",
    "project.created", "project.updated", "project.member_added", "project.member_removed",
    "commessa.created", "commessa.updated",
    "param.created", "param.updated", "param.deleted",
    "plan.created", "plan.file_uploaded",
    "template.created", "template.updated", "template.archived", "template.restored",
    "pin.created", "pin.updated", "pin.deleted",
    "wbs.created", "wbs.updated", "wbs.deleted", "wbs.imported",
    "submission.created", "submission.updated",
    "task.created", "task.updated", "task.deleted",
    "attachment.uploaded", "attachment.deleted",
    "sync.push",
    "support.message_sent", "support.message_closed", "support.message_reopened",
]

# Etichette italiane per la UI (la stessa lista, leggibile)
ACTION_LABELS = {
    "auth.login": "Accesso", "auth.login_failed": "Accesso fallito",
    "user.created": "Utente creato", "user.updated": "Utente modificato", "user.password_reset": "Password reimpostata",
    "user.deactivated": "Utente disattivato", "user.reactivated": "Utente riattivato",
    "invite_label.created": "Etichetta invito creata", "invite_label.updated": "Etichetta invito modificata",
    "invite_label.deleted": "Etichetta invito eliminata",
    "invite.created": "Invito inviato", "invite.resent": "Invito rimandato", "invite.revoked": "Invito revocato",
    "invite.accepted": "Invito accettato", "invite.email_failed": "Email d'invito non partita",
    "project.created": "Cantiere creato", "project.updated": "Cantiere modificato",
    "project.member_added": "Membro aggiunto", "project.member_removed": "Membro rimosso",
    "commessa.created": "Commessa creata", "commessa.updated": "Commessa modificata",
    "param.created": "Parametro creato", "param.updated": "Parametro modificato", "param.deleted": "Parametro eliminato",
    "plan.created": "Planimetria creata", "plan.file_uploaded": "Planimetria caricata",
    "template.created": "Modulo creato", "template.updated": "Modulo modificato",
    "template.archived": "Modulo archiviato", "template.restored": "Modulo ripristinato",
    "pin.created": "Pin creato", "pin.updated": "Pin modificato", "pin.deleted": "Pin cancellato",
    "wbs.created": "Voce WBS creata", "wbs.updated": "Voce WBS modificata", "wbs.deleted": "Voce WBS eliminata", "wbs.imported": "WBS importata da file",
    "submission.created": "Modulo compilato", "submission.updated": "Compilazione modificata",
    "task.created": "Task creato", "task.updated": "Task modificato", "task.deleted": "Task cancellato",
    "attachment.uploaded": "Foto caricata", "attachment.deleted": "Foto cancellata",
    "sync.push": "Sincronizzazione dal device",
    "support.message_sent": "Segnalazione all'amministratore", "support.message_closed": "Segnalazione chiusa",
    "support.message_reopened": "Segnalazione riaperta",
}


def _client_info(request: Optional[Request]) -> tuple[Optional[str], Optional[str]]:
    if request is None:
        return None, None
    # L'app ascolta solo su 127.0.0.1 dietro il reverse proxy, che AGGIUNGE in coda
    # a X-Forwarded-For l'IP che vede. Le voci prima le scrive il client (falsificabili:
    # aggirerebbero il blocco login per IP), quindi conta solo l'ultima.
    fwd = request.headers.get("x-forwarded-for")
    ip = fwd.split(",")[-1].strip() if fwd else (request.client.host if request.client else None)
    ua = request.headers.get("user-agent")
    return ip, (ua[:200] if ua else None)


def record(db: Session, action: str, actor: Optional[models.User] = None, *, entity_type: Optional[str] = None,
           entity_id: Optional[str] = None, project_id: Optional[str] = None, details: Optional[dict] = None,
           request: Optional[Request] = None, actor_email: Optional[str] = None) -> models.AuditLog:
    """Aggiunge la riga alla sessione corrente (nessun commit: lo fa l'endpoint)."""
    assert action in ACTIONS, f"unknown audit action {action!r}"
    ip, ua = _client_info(request)
    row = models.AuditLog(
        action=action,
        actor_id=actor.id if actor else None,
        actor_email=actor.email if actor else actor_email,
        entity_type=entity_type, entity_id=entity_id, project_id=project_id,
        details=details or {}, ip=ip, user_agent=ua,
    )
    db.add(row)
    return row
