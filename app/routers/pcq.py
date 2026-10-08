"""PCQ: lettura di Word/PDF per l'anteprima prima di ricrearlo nel cantiere."""
from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session

from .. import models, schemas, auth, pcq_import
from ..auth import require_role
from ..database import get_db
from ..models import UserRole

router = APIRouter()

PCQ_MAX_BYTES = 20 * 1024 * 1024


@router.post("/projects/{project_id}/pcq/preview", response_model=schemas.PcqPreview)
async def preview_pcq(project_id: str, file: UploadFile = File(...), db: Session = Depends(get_db),
                      user: models.User = Depends(require_role(UserRole.manager))):
    """Legge un PCQ (.docx o .pdf) e ne restituisce titoli e tabelle (o testo, per i PDF). Non scrive nulla."""
    auth.assert_project_access(db, user, project_id)
    data = await file.read(PCQ_MAX_BYTES + 1)
    if len(data) > PCQ_MAX_BYTES:
        raise HTTPException(413, f"file larger than {PCQ_MAX_BYTES} bytes")
    try:
        doc = pcq_import.parse(data, file.filename or "")
    except ValueError as e:
        raise HTTPException(422, str(e))
    return schemas.PcqPreview(filename=file.filename or "", **asdict(doc))
