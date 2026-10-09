"""Progetti (cantieri) e membri."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .. import models, schemas, auth, audit
from ..auth import current_user, require_role
from ..database import get_db
from ..models import UserRole

router = APIRouter()


# ---------- Progetti e membri ----------

@router.post("/projects", response_model=schemas.ProjectOut, status_code=201)
def create_project(payload: schemas.ProjectCreate, request: Request, db: Session = Depends(get_db),
                   user: models.User = Depends(require_role(UserRole.manager))):
    if payload.commessa_id and db.get(models.Commessa, payload.commessa_id) is None:
        raise HTTPException(404, "commessa not found")
    project = models.Project(**payload.model_dump())
    project.commessa_id = payload.commessa_id or None
    db.add(project)
    db.flush()
    db.add(models.ProjectMember(project_id=project.id, user_id=user.id))  # il creatore è membro
    audit.record(db, "project.created", user, entity_type="project", entity_id=project.id, project_id=project.id,
                 request=request, details={"name": project.name, "commessa_id": project.commessa_id})
    db.commit()
    db.refresh(project)
    return project


@router.get("/projects", response_model=list[schemas.ProjectOut])
def list_projects(commessa_id: Optional[str] = None, db: Session = Depends(get_db),
                  user: models.User = Depends(current_user)):
    ids = auth.accessible_project_ids(db, user)
    q = db.query(models.Project)
    if ids is not None:
        q = q.filter(models.Project.id.in_(ids))
    if commessa_id is not None:
        q = q.filter(models.Project.commessa_id == (commessa_id or None))
    return q.order_by(models.Project.name).all()


@router.patch("/projects/{project_id}", response_model=schemas.ProjectOut)
def update_project(project_id: str, payload: schemas.ProjectUpdate, request: Request, db: Session = Depends(get_db),
                   user: models.User = Depends(require_role(UserRole.manager))):
    """Nome, indirizzo, commessa di appartenenza (manager/admin membri del progetto)."""
    project = auth.assert_project_access(db, user, project_id)
    changes = payload.model_dump(exclude_unset=True)
    if "commessa_id" in changes:
        changes["commessa_id"] = changes["commessa_id"] or None
        if changes["commessa_id"] and db.get(models.Commessa, changes["commessa_id"]) is None:
            raise HTTPException(404, "commessa not found")
    if "name" in changes and not (changes["name"] or "").strip():
        raise HTTPException(422, "name must not be empty")
    for k, v in changes.items():
        setattr(project, k, v)
    audit.record(db, "project.updated", user, entity_type="project", entity_id=project.id, project_id=project.id,
                 request=request, details={"name": project.name, "fields": sorted(changes.keys())})
    db.commit()
    db.refresh(project)
    return project


@router.get("/projects/{project_id}", response_model=schemas.ProjectOut)
def get_project(project_id: str, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    return auth.assert_project_access(db, user, project_id)


@router.get("/projects/{project_id}/members", response_model=list[schemas.UserOut])
def list_members(project_id: str, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    auth.assert_project_access(db, user, project_id)
    return (db.query(models.User).join(models.ProjectMember, models.ProjectMember.user_id == models.User.id)
            .filter(models.ProjectMember.project_id == project_id).order_by(models.User.name).all())


@router.post("/projects/{project_id}/members", response_model=list[schemas.UserOut], status_code=201)
def add_member(project_id: str, payload: schemas.MemberAdd, db: Session = Depends(get_db),
               user: models.User = Depends(require_role(UserRole.manager))):
    auth.assert_project_access(db, user, project_id)
    if not db.get(models.User, payload.user_id):
        raise HTTPException(404, "user not found")
    if db.get(models.ProjectMember, (project_id, payload.user_id)) is None:
        db.add(models.ProjectMember(project_id=project_id, user_id=payload.user_id))
        db.commit()
    return list_members(project_id, db, user)


@router.delete("/projects/{project_id}/members/{user_id}", status_code=204)
def remove_member(project_id: str, user_id: str, db: Session = Depends(get_db),
                  user: models.User = Depends(require_role(UserRole.manager))):
    auth.assert_project_access(db, user, project_id)
    row = db.get(models.ProjectMember, (project_id, user_id))
    if row is None:
        raise HTTPException(404, "member not found")
    db.delete(row)
    db.commit()
