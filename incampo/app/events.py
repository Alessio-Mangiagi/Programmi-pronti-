"""
Eventi di dominio (outbox) e regole di notifica dell'MVP.

`record_*` va chiamato dentro la transazione della modifica (web o sync push),
prima del commit: l'evento e le notifiche che genera esistono solo se la
modifica è andata a buon fine. Le regole producono righe `notifications`
(pending) per ogni destinatario × canale attivo; il worker (giorno 27) le invia.

Regole:
- task.assigned          -> l'assegnatario (se non è lui stesso l'autore)
- task.status_changed    -> resolved: il creatore del task (se diverso dall'autore)
- submission.created     -> se contiene una non conformità: i manager/admin
                            membri del progetto (l'autore escluso)
- support.message        -> tutti gli admin attivi (segnalazione "Contatta l'amministratore")
"""
import re
from typing import Iterable, Optional

from sqlalchemy.orm import Session

from . import models
from .models import UserRole

NON_CONFORMITY_RE = re.compile(r"non\s*conform", re.IGNORECASE)
CHANNELS = ("email", "push")


def find_non_conformity(schema: dict, data: dict) -> Optional[dict]:
    """Prima opzione tipo 'Non conforme' scelta in un select/multiselect (stessa regola del web)."""
    for f in schema.get("fields", []):
        v = data.get(f.get("id"))
        if f.get("type") == "select" and isinstance(v, str) and NON_CONFORMITY_RE.search(v):
            return {"field": f["id"], "label": f.get("label"), "value": v}
        if f.get("type") == "multiselect" and isinstance(v, list):
            hit = next((x for x in v if isinstance(x, str) and NON_CONFORMITY_RE.search(x)), None)
            if hit:
                return {"field": f["id"], "label": f.get("label"), "value": hit}
    return None


def _event(db: Session, type_: str, entity_type: str, entity_id: str, project_id: Optional[str],
           actor_id: Optional[str], payload: dict) -> models.Event:
    ev = models.Event(type=type_, entity_type=entity_type, entity_id=entity_id,
                      project_id=project_id, actor_id=actor_id, payload=payload)
    db.add(ev)
    db.flush()
    return ev


def _notify(db: Session, ev: models.Event, user_ids: Iterable[Optional[str]]) -> int:
    """Una notifica per canale attivo, senza duplicati e senza notificare l'autore."""
    n = 0
    for uid in dict.fromkeys(u for u in user_ids if u and u != ev.actor_id):
        user = db.get(models.User, uid)
        if user is None or not user.is_active:
            continue
        for channel, enabled in (("email", user.notify_email), ("push", user.notify_push)):
            if enabled:
                db.add(models.Notification(event_id=ev.id, user_id=uid, channel=channel))
                n += 1
    return n


def project_managers(db: Session, project_id: str) -> list[str]:
    rows = (db.query(models.User.id)
            .join(models.ProjectMember, models.ProjectMember.user_id == models.User.id)
            .filter(models.ProjectMember.project_id == project_id,
                    models.User.role.in_([UserRole.manager, UserRole.admin])).all())
    return [r[0] for r in rows]


# ---------- Task ----------

def record_task_created(db: Session, task: models.Task, project_id: str, actor_id: Optional[str]) -> None:
    _event(db, "task.created", "task", task.id, project_id, actor_id,
           {"title": task.title, "status": task.status.value, "assigned_to": task.assigned_to})
    if task.assigned_to:
        record_task_assigned(db, task, project_id, actor_id)


def record_task_assigned(db: Session, task: models.Task, project_id: str, actor_id: Optional[str]) -> None:
    ev = _event(db, "task.assigned", "task", task.id, project_id, actor_id,
                {"title": task.title, "assigned_to": task.assigned_to})
    _notify(db, ev, [task.assigned_to])


def record_task_status_changed(db: Session, task: models.Task, project_id: str, actor_id: Optional[str],
                               old_status: str) -> None:
    new = task.status.value
    ev = _event(db, "task.status_changed", "task", task.id, project_id, actor_id,
                {"title": task.title, "from": old_status, "to": new})
    if new == "resolved":
        _notify(db, ev, [task.created_by])


def record_task_changes(db: Session, task: models.Task, project_id: str, actor_id: Optional[str],
                        before: Optional[dict]) -> None:
    """Confronta lo stato precedente (`before` = {status, assigned_to} o None se nuovo) e registra ciò che serve."""
    if before is None:
        record_task_created(db, task, project_id, actor_id)
        return
    if before["status"] != task.status.value:
        record_task_status_changed(db, task, project_id, actor_id, before["status"])
    if task.assigned_to and task.assigned_to != before["assigned_to"]:
        record_task_assigned(db, task, project_id, actor_id)


# ---------- Submission ----------

def record_submission_created(db: Session, sub: models.FormSubmission, project_id: str,
                              actor_id: Optional[str]) -> None:
    template = db.get(models.FormTemplate, sub.template_id)
    nc = find_non_conformity(template.schema_def, sub.data_json or {}) if template else None
    ev = _event(db, "submission.created", "submission", sub.id, project_id, actor_id,
                {"template_id": sub.template_id, "template_name": template.name if template else None,
                 "pin_id": sub.pin_id, "non_conformity": nc})
    if nc:
        _notify(db, ev, project_managers(db, project_id))


# ---------- Segnalazioni all'amministratore ----------

def record_support_message(db: Session, msg: models.SupportMessage) -> int:
    """Evento senza cantiere obbligatorio; notifica ogni admin attivo. Ritorna le consegne create."""
    ev = _event(db, "support.message", "support_message", msg.id, msg.project_id, msg.user_id,
                {"message": msg.message[:500], "page": msg.page})
    admins = db.query(models.User.id).filter(models.User.role == UserRole.admin, models.User.is_active.is_(True)).all()
    return _notify(db, ev, [a[0] for a in admins])
