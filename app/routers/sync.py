"""Sync offline-first (uso da app nativa): push e pull."""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from .. import models, schemas, auth, events, audit, stats as st_stats
from ..auth import current_user
from ..database import get_db
from ..forms import validate_submission
from ..models import utcnow, TaskStatus
from ..schemas import to_naive_utc

router = APIRouter()


# ---------- Sync offline-first (uso da app nativa) ----------

def _upsert(db: Session, model, items, fk_checks: dict,
            validate=None, defaults: Optional[dict] = None) -> schemas.SyncPushResult:
    """
    Upsert idempotente per id con "last write wins" PER CAMPO.

    fk_checks: {campo_fk: Model} — ogni FK viene verificata contro il DB
               (comprese le righe appena flushate nello stesso batch).
    validate:  fn(item) -> motivo di rifiuto (str) o None, eseguita dopo le FK.
    defaults:  valori applicati all'insert quando il campo è nullo (es. created_by).

    Campi aggiornabili = `model.SYNC_FIELDS`. Se il device manda `changed_fields`
    (i campi toccati offline) si confrontano solo quelli, ciascuno con l'ultima
    modifica nota sul server (`field_times`): un campo vince se il device l'ha
    cambiato dopo. Così web che assegna un task e app che ne cambia il titolo
    convivono. Senza `changed_fields` (client vecchi) valgono tutti i SYNC_FIELDS.
    Esito per riga: updated se almeno un campo passa (quelli persi in `lost_fields`),
    skipped se nessuno.
    """
    res = schemas.SyncPushResult()
    for item in items:
        # FK: rifiuta la singola riga invece di rompere il commit dell'intero batch
        reason = None
        for field, fk_model in fk_checks.items():
            fk_value = getattr(item, field)
            if fk_value is not None and db.get(fk_model, fk_value) is None:
                reason = f"{field} not found"
                break
        if reason is None and validate is not None:
            reason = validate(item)
        if reason is not None:
            res.rejected.append(schemas.RejectedItem(id=item.id, reason=reason))
            continue

        existing = db.get(model, item.id)
        if existing is None:
            values = item.model_dump(exclude={"changed_fields"})
            for k, v in (defaults or {}).items():
                values[k] = values.get(k) or v
            db.add(model(**values))
            res.inserted += 1
            continue

        fields = [f for f in (item.changed_fields or model.SYNC_FIELDS) if f in model.SYNC_FIELDS]
        won = [f for f in fields if item.updated_at > existing.field_time(f)]
        lost = [f for f in fields if f not in won]
        if not won:
            res.skipped += 1
            res.skipped_ids.append(item.id)
            continue
        existing._sync_ts = item.updated_at  # field_times dei campi vinti = istante del device
        for f in won:
            setattr(existing, f, getattr(item, f))
        existing.updated_at = max(existing.updated_at, item.updated_at)
        flag_modified(existing, "updated_at")  # anche se invariato: niente onupdate=utcnow
        res.updated += 1
        if lost:
            res.lost_fields[item.id] = lost
    db.flush()  # rende visibili gli insert alle fk_checks del gruppo successivo
    return res


@router.post("/sync/push", response_model=schemas.SyncPushResponse)
def sync_push(payload: schemas.SyncPushRequest, request: Request, db: Session = Depends(get_db),
              user: models.User = Depends(current_user)):
    """
    Riceve un batch di modifiche fatte offline sul device e le applica
    con upsert idempotente per id. Le entità con FK verso qualcosa che
    non esiste, non valide, o di progetti a cui l'utente non ha accesso
    vengono rifiutate singolarmente (`rejected`), il resto del batch passa.
    """
    def forbidden(project_id: str) -> Optional[str]:
        return None if auth.is_member(db, user, project_id) else "forbidden: not a project member"

    def check_pin(item):
        return forbidden(db.get(models.Plan, item.plan_id).project_id)

    def check_submission(item):
        if (r := forbidden(auth.project_of_pin(db.get(models.Pin, item.pin_id)))):
            return r
        # Una cancellazione non deve essere bloccata da dati vecchi non più validi.
        if item.deleted_at is not None:
            return None
        schema = db.get(models.FormTemplate, item.template_id).schema_def
        errors = validate_submission(schema, item.data_json)
        if errors:
            return "data_json: " + "; ".join(f"{e['field']}: {e['message']}" for e in errors)
        return None

    def check_task(item):
        if (r := forbidden(auth.project_of_pin(db.get(models.Pin, item.pin_id)))):
            return r
        try:
            TaskStatus(item.status)
        except ValueError:
            return f"invalid status {item.status!r}"
        return None

    def check_attachment(item):
        if bool(item.submission_id) == bool(item.task_id):
            return "exactly one of submission_id or task_id is required"
        parent = (db.get(models.FormSubmission, item.submission_id) if item.submission_id
                  else db.get(models.Task, item.task_id))
        return forbidden(auth.project_of_submission(parent) if item.submission_id else auth.project_of_task(parent))

    # Stato precedente dei task e submission già note: per capire cosa è cambiato davvero.
    task_before = {t.id: {"status": t.status.value, "assigned_to": t.assigned_to}
                   for t in db.query(models.Task).filter(models.Task.id.in_([t.id for t in payload.tasks])).all()} if payload.tasks else {}
    known_subs = {r[0] for r in db.query(models.FormSubmission.id)
                  .filter(models.FormSubmission.id.in_([x.id for x in payload.submissions])).all()} if payload.submissions else set()

    pins = _upsert(
        db, models.Pin, payload.pins,
        fk_checks={"plan_id": models.Plan},
        validate=check_pin, defaults={"created_by": user.id},
    )
    submissions = _upsert(
        db, models.FormSubmission, payload.submissions,
        fk_checks={"template_id": models.FormTemplate, "pin_id": models.Pin},
        validate=check_submission, defaults={"submitted_by": user.id},
    )
    tasks = _upsert(
        db, models.Task, payload.tasks,
        fk_checks={"pin_id": models.Pin, "assigned_to": models.User, "created_by": models.User},
        validate=check_task, defaults={"created_by": user.id},
    )
    attachments = _upsert(
        db, models.Attachment, payload.attachments,
        fk_checks={"submission_id": models.FormSubmission, "task_id": models.Task},
        validate=check_attachment,
    )
    # Eventi nella stessa transazione del push (solo righe accettate)
    rejected_subs = {r.id for r in submissions.rejected} | set(submissions.skipped_ids)
    for item in payload.submissions:
        if item.id in known_subs or item.id in rejected_subs or item.deleted_at:
            continue
        sub = db.get(models.FormSubmission, item.id)
        events.record_submission_created(db, sub, auth.project_of_pin(sub.pin), user.id)
    rejected_tasks = {r.id for r in tasks.rejected} | set(tasks.skipped_ids)
    for item in payload.tasks:
        if item.id in rejected_tasks or item.deleted_at:
            continue
        task = db.get(models.Task, item.id)
        st_stats.mark_resolved_at(task, (task_before.get(item.id) or {}).get("status"))
        events.record_task_changes(db, task, auth.project_of_task(task), user.id, task_before.get(item.id))
    if any((payload.pins, payload.submissions, payload.tasks, payload.attachments)):
        def _count(res, items):
            return {"sent": len(items), "inserted": res.inserted, "updated": res.updated, "skipped": res.skipped, "rejected": len(res.rejected)}
        audit.record(db, "sync.push", user, entity_type="sync", request=request, details={
            "pins": _count(pins, payload.pins), "submissions": _count(submissions, payload.submissions),
            "tasks": _count(tasks, payload.tasks), "attachments": _count(attachments, payload.attachments)})
    db.commit()
    return schemas.SyncPushResponse(
        pins=pins, submissions=submissions, tasks=tasks, attachments=attachments,
        server_time=utcnow(),
    )


def _to_dict(obj):
    return {c.name: getattr(obj, c.name) for c in obj.__table__.columns}


@router.get("/sync/pull", response_model=schemas.SyncPullResponse)
def sync_pull(
    project_id: str,
    since: Optional[datetime] = Query(None, description="server_time dell'ultima sync; omesso = tutto"),
    db: Session = Depends(get_db),
    user: models.User = Depends(current_user),
):
    """
    Ritorna tutte le modifiche del progetto (fatte da chiunque, su qualsiasi
    device) successive a `since`. Il client salva il nuovo server_time e lo
    userà come `since` alla sync successiva. Le righe con deleted_at
    valorizzato vanno rimosse localmente.
    """
    auth.assert_project_access(db, user, project_id)

    # Catturato PRIMA delle query: se un push arriva durante il pull,
    # il prossimo since lo riprende invece di perderlo.
    server_time = utcnow()
    since = to_naive_utc(since)

    def changed(query, model):
        # Entità del sync: cursore lato server (synced_at), non l'updated_at del device.
        col = model.synced_at if issubclass(model, models.SyncMixin) else model.updated_at
        return query.filter(col > since) if since else query

    plans_q = db.query(models.Plan).filter(models.Plan.project_id == project_id)
    plan_ids = [p.id for p in plans_q.all()]

    pins_q = db.query(models.Pin).filter(models.Pin.plan_id.in_(plan_ids))
    subs_q = (db.query(models.FormSubmission)
              .join(models.Pin, models.FormSubmission.pin_id == models.Pin.id)
              .filter(models.Pin.plan_id.in_(plan_ids)))
    tasks_q = (db.query(models.Task)
               .join(models.Pin, models.Task.pin_id == models.Pin.id)
               .filter(models.Pin.plan_id.in_(plan_ids)))
    att_q = (db.query(models.Attachment)
             .outerjoin(models.FormSubmission, models.Attachment.submission_id == models.FormSubmission.id)
             .outerjoin(models.Task, models.Attachment.task_id == models.Task.id)
             .join(models.Pin, (models.FormSubmission.pin_id == models.Pin.id) | (models.Task.pin_id == models.Pin.id))
             .filter(models.Pin.plan_id.in_(plan_ids)))
    templates_q = db.query(models.FormTemplate)

    return schemas.SyncPullResponse(
        plans=[_to_dict(x) for x in changed(plans_q, models.Plan).all()],
        form_templates=[_to_dict(x) for x in changed(templates_q, models.FormTemplate).all()],
        pins=[_to_dict(x) for x in changed(pins_q, models.Pin).all()],
        submissions=[_to_dict(x) for x in changed(subs_q, models.FormSubmission).all()],
        tasks=[_to_dict(x) for x in changed(tasks_q, models.Task).all()],
        attachments=[_to_dict(x) for x in changed(att_q, models.Attachment).all()],
        server_time=server_time,
    )
