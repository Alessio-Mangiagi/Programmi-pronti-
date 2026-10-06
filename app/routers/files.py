"""File: upload planimetrie e allegati, download autorizzato per progetto."""
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from .. import models, schemas, auth, storage as st, audit
from ..auth import current_user, require_role
from ..database import get_db
from ..models import utcnow, UserRole
from .common import _get_task

router = APIRouter()


# ---------- File: planimetrie e allegati ----------

async def _read_upload(file: UploadFile) -> tuple[bytes, str]:
    """Legge il file entro il limite e ne riconosce il tipo dal contenuto."""
    data = await file.read(st.MAX_UPLOAD_BYTES + 1)
    if len(data) > st.MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"file larger than {st.MAX_UPLOAD_BYTES} bytes")
    mime = st.sniff_mime(data)
    if mime not in st.ALLOWED_MIME:
        raise HTTPException(415, "only JPEG, PNG or PDF allowed")
    return data, mime


@router.post("/plans/{plan_id}/file", response_model=schemas.PlanOut)
async def upload_plan_file(plan_id: str, request: Request, file: UploadFile = File(...), db: Session = Depends(get_db),
                           user: models.User = Depends(require_role(UserRole.manager))):
    """
    Carica l'immagine della planimetria. Un PDF viene convertito in PNG
    (prima pagina) così tutti i client mostrano un'immagine e basta.
    Le dimensioni in pixel servono ai client per posizionare i pin (x/y relativi).
    """
    plan = db.get(models.Plan, plan_id)
    if plan is None:
        raise HTTPException(404, "plan not found")
    auth.assert_project_access(db, user, plan.project_id)
    data, mime = await _read_upload(file)
    if mime == "application/pdf":
        try:
            data = st.pdf_first_page_to_png(data)
        except Exception:
            raise HTTPException(422, "cannot render PDF")
        ext = "png"
    else:
        ext = st.ALLOWED_MIME[mime]
    try:
        w, h = st.image_size(data)
    except Exception:
        raise HTTPException(422, "cannot read image")
    plan.file_url = st.storage.save(f"plans/{plan.id}.{ext}", data)
    plan.width_px, plan.height_px = float(w), float(h)
    plan.updated_at = utcnow()
    audit.record(db, "plan.file_uploaded", user, entity_type="plan", entity_id=plan.id, project_id=plan.project_id,
                 request=request, details={"name": plan.name, "mime": mime, "bytes": len(data), "size": [w, h]})
    db.commit()
    db.refresh(plan)
    return plan


def _get_attachment(db: Session, user: models.User, attachment_id: str) -> models.Attachment:
    att = db.get(models.Attachment, attachment_id)
    if att is None or att.deleted_at is not None:
        raise HTTPException(404, "attachment not found")
    auth.assert_project_access(db, user, auth.project_of_attachment(att))
    return att


@router.post("/attachments", response_model=schemas.AttachmentOut, status_code=201)
def create_attachment(payload: schemas.AttachmentCreate, db: Session = Depends(get_db),
                      user: models.User = Depends(current_user)):
    """Crea il record (da web); i byte arrivano dopo con /attachments/{id}/upload."""
    if bool(payload.submission_id) == bool(payload.task_id):
        raise HTTPException(422, "exactly one of submission_id or task_id is required")
    if payload.submission_id:
        sub = db.get(models.FormSubmission, payload.submission_id)
        if sub is None:
            raise HTTPException(404, "submission not found")
        auth.assert_project_access(db, user, auth.project_of_submission(sub))
    else:
        _get_task(db, user, payload.task_id)
    if payload.id and db.get(models.Attachment, payload.id) is not None:
        raise HTTPException(409, "attachment id already exists")
    att = models.Attachment(**payload.model_dump(exclude_none=True))
    db.add(att)
    db.commit()
    db.refresh(att)
    return att


@router.delete("/attachments/{attachment_id}", status_code=204)
def delete_attachment(attachment_id: str, request: Request, db: Session = Depends(get_db),
                      user: models.User = Depends(current_user)):
    """Soft-delete di foto/firma (chi ha compilato il modulo o creato il task, oppure un manager)."""
    att = _get_attachment(db, user, attachment_id)
    parent = att.submission if att.submission_id else att.task
    owner = att.submission.submitted_by if att.submission_id else att.task.created_by
    if not auth.is_manager(user) and owner != user.id:
        raise HTTPException(403, "only the owner or a manager can delete an attachment")
    att.deleted_at = att.updated_at = utcnow()
    audit.record(db, "attachment.deleted", user, entity_type="attachment", entity_id=att.id,
                 project_id=auth.project_of_pin(parent.pin), request=request, details={"file_type": att.file_type})
    db.commit()


def _direct_s3() -> bool:
    return isinstance(st.storage, st.S3Storage) and st.storage.direct


@router.post("/attachments/presign", response_model=schemas.PresignResponse)
def presign_attachment(payload: schemas.PresignRequest, db: Session = Depends(get_db),
                       user: models.User = Depends(current_user)):
    """
    L'app chiede dove caricare i byte di un allegato già sincronizzato.
    Con S3 direct: presigned POST sul bucket (tipo e dimensione imposti da S3),
    poi /attachments/{id}/complete. Altrimenti upload multipart sull'API.
    """
    att = _get_attachment(db, user, payload.attachment_id)
    if not _direct_s3():
        return schemas.PresignResponse(
            attachment_id=att.id, method="POST",
            upload_url=f"/attachments/{att.id}/upload", max_bytes=st.MAX_UPLOAD_BYTES,
        )
    mime = payload.content_type or "image/jpeg"
    if mime not in st.ALLOWED_MIME:
        raise HTTPException(415, "only JPEG, PNG or PDF allowed")
    post = st.storage.presign_post(f"attachments/{att.id}.{st.ALLOWED_MIME[mime]}", mime, st.MAX_UPLOAD_BYTES)
    return schemas.PresignResponse(
        attachment_id=att.id, method="POST", upload_url=post["url"], fields=post["fields"],
        complete_url=f"/attachments/{att.id}/complete", max_bytes=st.MAX_UPLOAD_BYTES,
    )


@router.post("/attachments/{attachment_id}/complete", response_model=schemas.AttachmentOut)
def complete_attachment(attachment_id: str, db: Session = Depends(get_db),
                        user: models.User = Depends(current_user)):
    """
    Chiude un upload diretto su S3: verifica nel bucket che il file esista, che il
    contenuto (magic bytes, non il Content-Type dichiarato) sia JPEG/PNG/PDF e
    coerente con l'estensione, poi valorizza file_url. Idempotente.
    """
    att = _get_attachment(db, user, attachment_id)
    if not _direct_s3():
        raise HTTPException(409, "direct upload not enabled: use upload_url")
    for mime, ext in st.ALLOWED_MIME.items():
        key = f"attachments/{att.id}.{ext}"
        if not st.storage.exists(key):
            continue
        if st.storage.size(key) > st.MAX_UPLOAD_BYTES:
            st.storage.delete(key)
            raise HTTPException(413, f"file larger than {st.MAX_UPLOAD_BYTES} bytes")
        if st.sniff_mime(st.storage.read_head(key)) != mime:
            st.storage.delete(key)
            raise HTTPException(415, "file content does not match its type")
        att.file_url = f"/files/{key}"
        if not att.file_type:
            att.file_type = "doc" if mime == "application/pdf" else "photo"
        att.updated_at = utcnow()
        db.commit()
        db.refresh(att)
        return att
    raise HTTPException(404, "uploaded file not found")


@router.post("/attachments/{attachment_id}/upload", response_model=schemas.AttachmentOut)
async def upload_attachment(attachment_id: str, file: UploadFile = File(...), db: Session = Depends(get_db),
                            user: models.User = Depends(current_user)):
    """Carica i byte di un allegato. Idempotente: un retry sovrascrive lo stesso file."""
    att = _get_attachment(db, user, attachment_id)
    data, mime = await _read_upload(file)
    ext = st.ALLOWED_MIME[mime]
    att.file_url = st.storage.save(f"attachments/{att.id}.{ext}", data)
    if not att.file_type:
        att.file_type = "doc" if mime == "application/pdf" else "photo"
    att.updated_at = utcnow()
    db.commit()
    db.refresh(att)
    return att


def _file_project_id(db: Session, key: str) -> str | None:
    """
    Progetto proprietario del file, ricavato dalla key scritta dal server
    ("plans/<plan_id>.<ext>", "attachments/<attachment_id>.<ext>"). Non si usa
    file_url del DB: il client può valorizzarlo (POST /plans, sync push).
    """
    folder, _, name = key.partition("/")
    entity_id = name.rsplit(".", 1)[0]
    if not entity_id or "/" in name:
        return None
    if folder == "plans":
        plan = db.get(models.Plan, entity_id)
        return auth.project_of_plan(plan) if plan is not None else None
    if folder == "attachments":
        att = db.get(models.Attachment, entity_id)
        return auth.project_of_attachment(att) if att is not None and att.deleted_at is None else None
    return None


def _authorize_file(db: Session, user: models.User, key: str) -> None:
    project_id = _file_project_id(db, key)
    if project_id is None or not st.storage.exists(key):
        raise HTTPException(404, "file not found")
    if not auth.is_member(db, user, project_id):
        raise HTTPException(404, "file not found")  # 404, non 403: non rivela che il file esiste


@router.get("/file-links/{key:path}", response_model=schemas.FileLink)
def get_file_link(key: str, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    """
    Come leggere un file (stessi permessi di GET /files): con S3 direct un URL
    firmato a scadenza da usare così com'è (anche in <img src>, senza JWT);
    altrimenti /files/<key> da chiamare con il JWT.
    """
    _authorize_file(db, user, key)
    if _direct_s3():
        return schemas.FileLink(url=st.storage.presign_get(key), direct=True, expires_in=st.PRESIGN_SECONDS)
    return schemas.FileLink(url=f"/files/{key}", direct=False)


@router.get("/files/{key:path}")
def get_file(key: str, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    """
    Serve i file dello storage (filesystem o S3) con il JWT: gli URL nel DB sono sempre /files/<key>.
    Solo ai membri del progetto a cui appartiene il file; file non referenziati → 404.
    """
    _authorize_file(db, user, key)
    if isinstance(st.storage, st.S3Storage):
        data = st.storage.read(key)
        return Response(content=data, media_type=st.sniff_mime(data) or "application/octet-stream")
    return FileResponse(st.storage.path(key))
