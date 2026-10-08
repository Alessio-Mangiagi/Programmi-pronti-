"""PCQ: lettura di Word/PDF per l'anteprima prima di ricrearlo nel cantiere."""
from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import Response
from sqlalchemy.orm import Session

from .. import models, schemas, auth, pcq_import
from ..auth import require_role
from ..database import get_db
from ..models import UserRole

router = APIRouter()

PCQ_MAX_BYTES = 20 * 1024 * 1024


async def _preview(file: UploadFile) -> schemas.PcqPreview:
    data = await file.read(PCQ_MAX_BYTES + 1)
    if len(data) > PCQ_MAX_BYTES:
        raise HTTPException(413, f"file larger than {PCQ_MAX_BYTES} bytes")
    try:
        doc = pcq_import.parse(data, file.filename or "")
    except ValueError as e:
        raise HTTPException(422, str(e))
    return schemas.PcqPreview(filename=file.filename or "", **asdict(doc))


@router.post("/pcq/preview", response_model=schemas.PcqPreview)
async def preview_pcq(file: UploadFile = File(...), user: models.User = Depends(require_role(UserRole.manager))):
    """Legge un PCQ (.docx o .pdf): titoli e tabelle (o testo, per i PDF). Non scrive nulla.
    Lo usa l'editor dei moduli per ricreare il PCQ come template."""
    return await _preview(file)


@router.get("/pcq/example.docx")
def example_pcq(user: models.User = Depends(require_role(UserRole.manager))):
    """PCQ Word di esempio: mostra il formato che l'import riconosce meglio."""
    return Response(content=pcq_import.example_docx(),
                    media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    headers={"Content-Disposition": 'attachment; filename="PCQ-esempio.docx"'})


@router.post("/projects/{project_id}/pcq/preview", response_model=schemas.PcqPreview)
async def preview_project_pcq(project_id: str, file: UploadFile = File(...), db: Session = Depends(get_db),
                              user: models.User = Depends(require_role(UserRole.manager))):
    """Come /pcq/preview, dalla pagina PCQ del cantiere (controlla l'accesso al cantiere)."""
    auth.assert_project_access(db, user, project_id)
    return await _preview(file)
