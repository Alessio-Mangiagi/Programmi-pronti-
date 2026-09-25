"""Moduli compilati (uso da web) e PDF."""
import re

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from .. import models, schemas, auth, events, audit, pdf
from ..auth import current_user
from ..database import get_db
from ..forms import validate_submission
from ..models import utcnow
from .common import _with_attachments, _get_pin, _get_wbs_node

router = APIRouter()


# ---------- Submissions (uso da web) ----------

@router.post("/submissions", response_model=schemas.SubmissionOut, status_code=201)
def create_submission(payload: schemas.SubmissionCreate, request: Request, db: Session = Depends(get_db),
                      user: models.User = Depends(current_user)):
    template = db.get(models.FormTemplate, payload.template_id)
    if template is None:
        raise HTTPException(404, "template not found")
    if template.archived_at is not None:
        raise HTTPException(409, "template is archived")
    if payload.pin_id:
        project_id = auth.project_of_pin(_get_pin(db, user, payload.pin_id))
    else:
        project_id = _get_wbs_node(db, user, payload.wbs_node_id).project_id
    errors = validate_submission(template.schema_def, payload.data_json)
    if errors:
        raise HTTPException(422, detail=errors)
    sub = models.FormSubmission(**payload.model_dump(exclude={"submitted_by"}), submitted_by=user.id)
    db.add(sub)
    db.flush()
    events.record_submission_created(db, sub, project_id, user.id)
    audit.record(db, "submission.created", user, entity_type="submission", entity_id=sub.id, project_id=project_id,
                 request=request, details={"template": template.name, "pin_id": sub.pin_id, "wbs_node_id": sub.wbs_node_id})
    db.commit()
    db.refresh(sub)
    return _with_attachments(schemas.SubmissionOut, sub)


@router.get("/submissions/{submission_id}", response_model=schemas.SubmissionOut)
def get_submission(submission_id: str, db: Session = Depends(get_db),
                   user: models.User = Depends(current_user)):
    sub = db.get(models.FormSubmission, submission_id)
    if sub is None or sub.deleted_at is not None:
        raise HTTPException(404, "submission not found")
    auth.assert_project_access(db, user, auth.project_of_submission(sub))
    return _with_attachments(schemas.SubmissionOut, sub)


@router.get("/submissions/{submission_id}/pdf")
def submission_pdf(submission_id: str, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    """Modulo compilato in PDF (campi, foto, firma, note per campo), scaricabile/stampabile."""
    sub = db.get(models.FormSubmission, submission_id)
    if sub is None or sub.deleted_at is not None:
        raise HTTPException(404, "submission not found")
    auth.assert_project_access(db, user, auth.project_of_submission(sub))
    template = db.get(models.FormTemplate, sub.template_id)
    data = pdf.build_submission_pdf(db, sub, template)
    slug = re.sub(r"[^A-Za-z0-9]+", "-", template.name).strip("-").lower() or "modulo"
    filename = f"{slug}-{sub.created_at:%Y%m%d}-{sub.id[:8]}.pdf"
    return Response(content=data, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.patch("/submissions/{submission_id}", response_model=schemas.SubmissionOut)
def update_submission(submission_id: str, payload: schemas.SubmissionUpdate, request: Request,
                      db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    """Modifica delle risposte (chi l'ha compilata o un manager); stesse regole di validazione della creazione."""
    sub = db.get(models.FormSubmission, submission_id)
    if sub is None or sub.deleted_at is not None:
        raise HTTPException(404, "submission not found")
    auth.assert_project_access(db, user, auth.project_of_submission(sub))
    if not auth.is_manager(user) and sub.submitted_by != user.id:
        raise HTTPException(403, "only the submitter or a manager can edit a submission")
    template = db.get(models.FormTemplate, sub.template_id)
    errors = validate_submission(template.schema_def, payload.data_json)
    if errors:
        raise HTTPException(422, detail=errors)
    changed = sorted(k for k in set(sub.data_json or {}) | set(payload.data_json)
                     if (sub.data_json or {}).get(k) != payload.data_json.get(k))
    sub.data_json = payload.data_json
    sub.updated_at = utcnow()
    audit.record(db, "submission.updated", user, entity_type="submission", entity_id=sub.id,
                 project_id=auth.project_of_submission(sub), request=request,
                 details={"template": template.name, "fields": changed})
    db.commit()
    db.refresh(sub)
    return _with_attachments(schemas.SubmissionOut, sub)
