"""
Autenticazione JWT e controllo accessi per progetto.

Ruoli (globali, colonna users.role):
- admin:   tutto, su tutti i progetti
- manager: crea progetti/planimetrie/template, gestisce membri e verifica task
           nei progetti di cui è membro
- field:   opera (pin, moduli, task) nei progetti di cui è membro

Chi non è admin vede SOLO i progetti in cui compare in project_members.
I ruoli per-progetto sono rimandati (backlog): per l'MVP il ruolo globale basta.
"""
import os
from datetime import timedelta

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pwdlib import PasswordHash
from sqlalchemy.orm import Session

from . import models
from .database import get_db
from .models import UserRole, utcnow

SECRET_KEY = os.getenv("SECRET_KEY", "dev-only-secret-key-change-me-in-production-0000")  # >= 32 byte per HS256
ACCESS_TOKEN_HOURS = int(os.getenv("ACCESS_TOKEN_HOURS", "12"))
ALGORITHM = "HS256"

_hasher = PasswordHash.recommended()  # argon2id
_bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return _hasher.verify(password, password_hash)


def create_access_token(user: models.User) -> str:
    payload = {
        "sub": user.id,
        "role": user.role.value,
        "exp": utcnow() + timedelta(hours=ACCESS_TOKEN_HOURS),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> models.User:
    if creds is None:
        raise HTTPException(401, "missing bearer token", headers={"WWW-Authenticate": "Bearer"})
    try:
        payload = jwt.decode(creds.credentials, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        raise HTTPException(401, "invalid or expired token", headers={"WWW-Authenticate": "Bearer"})
    user = db.get(models.User, payload.get("sub", ""))
    if user is None or not user.is_active:
        raise HTTPException(401, "user not found or disabled")
    return user


def require_role(*roles: UserRole):
    """Dipendenza: l'utente deve avere uno dei ruoli indicati (admin passa sempre)."""
    def dep(user: models.User = Depends(current_user)) -> models.User:
        if user.role != UserRole.admin and user.role not in roles:
            raise HTTPException(403, f"requires role {' or '.join(r.value for r in roles)}")
        return user
    return dep


def is_manager(user: models.User) -> bool:
    return user.role in (UserRole.admin, UserRole.manager)


# ---------- Accesso per progetto ----------

def is_member(db: Session, user: models.User, project_id: str) -> bool:
    if user.role == UserRole.admin:
        return True
    return db.get(models.ProjectMember, (project_id, user.id)) is not None


def accessible_project_ids(db: Session, user: models.User) -> list[str] | None:
    """None = tutti (admin)."""
    if user.role == UserRole.admin:
        return None
    rows = db.query(models.ProjectMember.project_id).filter_by(user_id=user.id).all()
    return [r[0] for r in rows]


def assert_project_access(db: Session, user: models.User, project_id: str) -> models.Project:
    """404 se il progetto non esiste, 403 se l'utente non ne è membro."""
    project = db.get(models.Project, project_id)
    if project is None:
        raise HTTPException(404, "project not found")
    if not is_member(db, user, project_id):
        raise HTTPException(403, "not a member of this project")
    return project


# Risoluzione progetto dalle entità figlie (per i controlli sugli endpoint)

def project_of_plan(plan: models.Plan) -> str:
    return plan.project_id


def project_of_pin(pin: models.Pin) -> str:
    return pin.plan.project_id


def project_of_submission(sub: models.FormSubmission) -> str:
    return project_of_pin(sub.pin)


def project_of_task(task: models.Task) -> str:
    return project_of_pin(task.pin)


def project_of_attachment(att: models.Attachment) -> str:
    return project_of_submission(att.submission) if att.submission_id else project_of_task(att.task)
