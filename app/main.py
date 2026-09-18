"""
API core per il sistema tipo Field View.

Avvio locale (dalla root del progetto):
    alembic upgrade head
    python -m scripts.seed          # utenti/progetto demo (opzionale)
    uvicorn app.main:app --reload

Endpoint principali:
    /auth/login, /auth/me, /users         -> autenticazione (JWT bearer) e utenti
    /projects, /projects/{id}/members     -> progetti e membri
    /plans, /form-templates               -> CRUD standard, gestiti da web
    /pins/{id}                            -> pin con submissions/task/foto (plan view)
    /submissions, /tasks                  -> creazione e aggiornamento da web
    /plans/{id}/file, /attachments/{id}/upload, /files/{key} -> upload e download file
    /sync/push                            -> l'app nativa manda le modifiche fatte offline
    /sync/pull?project_id=..&since=..     -> l'app nativa scarica le modifiche dal server

Tutti gli endpoint tranne /auth/login richiedono `Authorization: Bearer <token>`.
Regole di accesso in app/auth.py.

Strategia di sync (vedi README):
    - Ogni entità creata sul device ha un id UUID generato localmente.
    - Il push è un upsert per id: se arriva due volte (retry di rete) non crea duplicati.
    - Ordine di applicazione: pins -> submissions -> tasks -> attachments, con flush
      tra un gruppo e l'altro così le FK verso entità dello stesso batch funzionano.
    - Il pull è incrementale per progetto: il client manda l'ultimo server_time
      ricevuto e riceve solo le modifiche successive, cancellazioni comprese.
    - Conflict resolution MVP: "last write wins" basato su updated_at.
"""
import os
import re
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, Query, Request, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from sqlalchemy import and_, case, func, or_
from sqlalchemy.orm import Session

from . import models, schemas
from . import auth
from . import storage as st
from .auth import current_user, require_role
from .database import get_db
from .forms import validate_schema, validate_submission
from . import events
from . import audit
from . import pdf
from . import stats as st_stats
from .models import utcnow, TaskStatus, TASK_TRANSITIONS, UserRole
from .schemas import to_naive_utc

@asynccontextmanager
async def _lifespan(_app: FastAPI):
    # NOTIFY_WORKER=thread: worker notifiche in-process (sviluppo). In prod: python -m app.worker
    stop = None
    if os.getenv("NOTIFY_WORKER") == "thread":
        from .worker import start_thread
        stop = start_thread()
    yield
    if stop:
        stop.set()


app = FastAPI(title="Field View Starter API", lifespan=_lifespan)

# In sviluppo il frontend gira su Vite (porta 5173) e chiama l'API su 8000.
# In produzione FastAPI serve web/dist e CORS non serve (stessa origine).
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- Auth e utenti ----------

@app.post("/auth/login", response_model=schemas.TokenResponse)
def login(payload: schemas.LoginRequest, request: Request, db: Session = Depends(get_db)):
    email = payload.email.lower().strip()
    user = db.query(models.User).filter(models.User.email == email).first()
    if user is None or not user.is_active or not auth.verify_password(payload.password, user.password_hash):
        # Traccia anche i tentativi falliti (email tentata, IP): utile per capire abusi e lockout.
        audit.record(db, "auth.login_failed", actor_email=email, request=request,
                     details={"reason": "inactive" if user is not None and not user.is_active else "invalid"})
        db.commit()
        raise HTTPException(401, "Email o password errati")
    audit.record(db, "auth.login", user, entity_type="user", entity_id=user.id, request=request)
    db.commit()
    return schemas.TokenResponse(access_token=auth.create_access_token(user), user=user)


@app.get("/auth/me", response_model=schemas.UserOut)
def me(user: models.User = Depends(current_user)):
    return user


@app.patch("/auth/me/preferences", response_model=schemas.UserOut)
def update_preferences(payload: schemas.PreferencesUpdate, db: Session = Depends(get_db),
                       user: models.User = Depends(current_user)):
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(user, k, v)
    db.commit()
    db.refresh(user)
    return user


@app.post("/auth/me/push-token", status_code=204)
def register_push_token(payload: schemas.PushTokenIn, db: Session = Depends(get_db),
                        user: models.User = Depends(current_user)):
    """L'app registra il token Expo Push del device (idempotente; un token cambia utente se serve)."""
    row = db.get(models.PushToken, payload.token)
    if row is None:
        db.add(models.PushToken(token=payload.token, user_id=user.id, platform=payload.platform))
    else:
        row.user_id, row.platform, row.last_seen_at = user.id, payload.platform or row.platform, utcnow()
    db.commit()


@app.delete("/auth/me/push-token/{token}", status_code=204)
def unregister_push_token(token: str, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    db.query(models.PushToken).filter(models.PushToken.token == token, models.PushToken.user_id == user.id).delete()
    db.commit()


@app.get("/auth/me/notifications", response_model=list[schemas.NotificationOut])
def my_notifications(limit: int = 50, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    """Le mie notifiche (più recenti prima), con l'evento che le ha generate."""
    return (db.query(models.Notification).filter(models.Notification.user_id == user.id)
            .order_by(models.Notification.created_at.desc()).limit(min(limit, 200)).all())


@app.get("/projects/{project_id}/events", response_model=list[schemas.EventOut])
def list_events(project_id: str, limit: int = 100, db: Session = Depends(get_db),
                user: models.User = Depends(require_role(UserRole.manager))):
    """Registro eventi del progetto (manager): cosa è successo e quando."""
    auth.assert_project_access(db, user, project_id)
    return (db.query(models.Event).filter(models.Event.project_id == project_id)
            .order_by(models.Event.created_at.desc()).limit(min(limit, 500)).all())


@app.post("/users", response_model=schemas.UserOut, status_code=201)
def create_user(payload: schemas.UserCreate, request: Request, db: Session = Depends(get_db),
                admin: models.User = Depends(require_role())):
    """Solo admin."""
    try:
        role = UserRole(payload.role)
    except ValueError:
        raise HTTPException(422, f"invalid role {payload.role!r}")
    email = payload.email.lower().strip()
    if db.query(models.User).filter(models.User.email == email).first():
        raise HTTPException(409, "email already registered")
    user = models.User(email=email, name=payload.name, role=role,
                       password_hash=auth.hash_password(payload.password))
    db.add(user)
    db.flush()
    audit.record(db, "user.created", admin, entity_type="user", entity_id=user.id, request=request,
                 details={"email": email, "name": payload.name, "role": role.value})
    db.commit()
    db.refresh(user)
    return user


@app.get("/users", response_model=list[schemas.UserOut])
def list_users(include_inactive: bool = False, db: Session = Depends(get_db),
               user: models.User = Depends(current_user)):
    """Elenco utenti attivi: serve a chiunque per assegnare un task. Con `include_inactive` (solo admin) anche i disattivati."""
    q = db.query(models.User)
    if include_inactive:
        if user.role != UserRole.admin:
            raise HTTPException(403, "requires role admin")
    else:
        q = q.filter(models.User.is_active.is_(True))
    return q.order_by(models.User.name).all()


@app.patch("/users/{user_id}", response_model=schemas.UserOut)
def update_user(user_id: str, payload: schemas.UserUpdate, request: Request, db: Session = Depends(get_db),
                admin: models.User = Depends(require_role())):
    """
    Solo admin: nome, ruolo, attivo/disattivo, reset password. Un admin non può
    disattivarsi né togliersi il ruolo admin (altrimenti resta un sistema senza amministratori).
    """
    target = db.get(models.User, user_id)
    if target is None:
        raise HTTPException(404, "user not found")
    changes = payload.model_dump(exclude_unset=True)
    details: dict = {}
    if "role" in changes and changes["role"] is not None:
        try:
            role = UserRole(changes["role"])
        except ValueError:
            raise HTTPException(422, f"invalid role {changes['role']!r}")
        if target.id == admin.id and role != UserRole.admin:
            raise HTTPException(409, "cannot remove your own admin role")
        if role != target.role:
            details["role"] = {"from": target.role.value, "to": role.value}
            target.role = role
    if "name" in changes and changes["name"] is not None:
        if not changes["name"].strip():
            raise HTTPException(422, "name must not be empty")
        if changes["name"] != target.name:
            details["name"] = {"from": target.name, "to": changes["name"]}
            target.name = changes["name"]
    if changes.get("password"):
        target.password_hash = auth.hash_password(changes["password"])
        audit.record(db, "user.password_reset", admin, entity_type="user", entity_id=target.id, request=request,
                     details={"email": target.email})
    if "is_active" in changes and changes["is_active"] is not None and changes["is_active"] != target.is_active:
        if target.id == admin.id:
            raise HTTPException(409, "cannot deactivate yourself")
        target.is_active = changes["is_active"]
        audit.record(db, "user.reactivated" if target.is_active else "user.deactivated", admin,
                     entity_type="user", entity_id=target.id, request=request, details={"email": target.email})
    if details:
        audit.record(db, "user.updated", admin, entity_type="user", entity_id=target.id, request=request,
                     details={"email": target.email, **details})
    target.updated_at = utcnow()
    db.commit()
    db.refresh(target)
    return target


@app.get("/users/activity", response_model=list[schemas.UserActivityOut])
def users_activity(db: Session = Depends(get_db), _: models.User = Depends(require_role())):
    """Solo admin: ultimo accesso e conteggio operazioni per utente (per la tabella utenti)."""
    A = models.AuditLog
    since = utcnow() - timedelta(days=30)
    rows = (db.query(A.actor_id,
                     func.max(case((A.action == "auth.login", A.created_at))),
                     func.count(A.id),
                     func.sum(case((A.created_at >= since, 1), else_=0)))
            .filter(A.actor_id.isnot(None)).group_by(A.actor_id).all())
    return [schemas.UserActivityOut(user_id=uid, last_login=last, actions_total=int(n or 0),
                                    actions_last_30d=int(n30 or 0)) for uid, last, n, n30 in rows]


# ---------- Registro operazioni (solo admin) ----------

@app.get("/audit/actions", response_model=list[schemas.AuditActionOut])
def audit_actions(_: models.User = Depends(require_role())):
    return [schemas.AuditActionOut(action=a, label=audit.ACTION_LABELS.get(a, a)) for a in audit.ACTIONS]


@app.get("/audit", response_model=schemas.AuditPage)
def list_audit(
    actor_id: Optional[str] = None,
    action: Optional[list[str]] = Query(default=None),
    project_id: Optional[str] = None,
    entity_id: Optional[str] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    q: Optional[str] = None,
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _: models.User = Depends(require_role()),
):
    """
    Registro operazioni, dal più recente. Filtri: utente, una o più azioni,
    progetto, entità, intervallo date (`date_to` inclusivo se solo data), testo
    libero su email attore / entità / IP. Paginato (`total` per la UI).
    """
    A = models.AuditLog
    query = db.query(A)
    if actor_id:
        query = query.filter(A.actor_id == actor_id)
    if action:
        query = query.filter(A.action.in_(action))
    if project_id:
        query = query.filter(A.project_id == project_id)
    if entity_id:
        query = query.filter(A.entity_id == entity_id)
    if date_from:
        query = query.filter(A.created_at >= to_naive_utc(date_from))
    if date_to:
        end = to_naive_utc(date_to)
        if end.time() == datetime.min.time():
            end = end + timedelta(days=1)
        query = query.filter(A.created_at < end)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(or_(A.actor_email.ilike(like), A.entity_id.ilike(like), A.ip.ilike(like),
                                 A.action.ilike(like)))
    total = query.with_entities(func.count(A.id)).scalar() or 0
    rows = query.order_by(A.created_at.desc(), A.id.desc()).offset(offset).limit(limit).all()
    names = {u.id: u.name for u in db.query(models.User).filter(models.User.id.in_({r.actor_id for r in rows if r.actor_id})).all()} if rows else {}
    projects = {p.id: p.name for p in db.query(models.Project).filter(models.Project.id.in_({r.project_id for r in rows if r.project_id})).all()} if rows else {}
    items = [schemas.AuditOut(
        id=r.id, action=r.action, actor_id=r.actor_id, actor_email=r.actor_email,
        actor_name=names.get(r.actor_id), entity_type=r.entity_type, entity_id=r.entity_id,
        project_id=r.project_id, project_name=projects.get(r.project_id), details=r.details or {},
        ip=r.ip, user_agent=r.user_agent, created_at=r.created_at) for r in rows]
    return schemas.AuditPage(items=items, total=int(total), limit=limit, offset=offset)


# ---------- Progetti e membri ----------

@app.post("/projects", response_model=schemas.ProjectOut, status_code=201)
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


@app.get("/projects", response_model=list[schemas.ProjectOut])
def list_projects(commessa_id: Optional[str] = None, db: Session = Depends(get_db),
                  user: models.User = Depends(current_user)):
    ids = auth.accessible_project_ids(db, user)
    q = db.query(models.Project)
    if ids is not None:
        q = q.filter(models.Project.id.in_(ids))
    if commessa_id is not None:
        q = q.filter(models.Project.commessa_id == (commessa_id or None))
    return q.order_by(models.Project.name).all()


@app.patch("/projects/{project_id}", response_model=schemas.ProjectOut)
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


# ---------- Commesse e parametri personalizzati ----------

def _clean_options(options: list[str]) -> list[str]:
    out: list[str] = []
    for o in options:
        o = (o or "").strip()
        if not o:
            raise HTTPException(422, "options must not contain empty values")
        if o in out:
            raise HTTPException(422, f"duplicate option {o!r}")
        out.append(o)
    if not out:
        raise HTTPException(422, "at least one option is required")
    return out


def _validate_params(db: Session, params: dict[str, list[str]]) -> dict[str, list[str]]:
    """Ogni chiave è un parametro esistente, ogni valore una sua opzione; `multi=False` → al massimo una."""
    defs = {p.id: p for p in db.query(models.CommessaParam).all()}
    clean: dict[str, list[str]] = {}
    for pid, values in params.items():
        p = defs.get(pid)
        if p is None:
            raise HTTPException(422, f"unknown param {pid!r}")
        vals = []
        for v in values:
            if v not in p.options:
                raise HTTPException(422, f"{p.name}: {v!r} is not one of the options")
            if v not in vals:
                vals.append(v)
        if not p.multi and len(vals) > 1:
            raise HTTPException(422, f"{p.name}: only one option allowed")
        if vals:
            clean[pid] = vals
    return clean


def _param_out(db: Session, p: models.CommessaParam) -> schemas.CommessaParamOut:
    used = sum(1 for c in db.query(models.Commessa.params).all() if (c[0] or {}).get(p.id))
    return schemas.CommessaParamOut(id=p.id, name=p.name, options=list(p.options or []), multi=p.multi,
                                    position=p.position, used_by=used)


@app.get("/commessa-params", response_model=list[schemas.CommessaParamOut])
def list_commessa_params(db: Session = Depends(get_db), _: models.User = Depends(current_user)):
    rows = db.query(models.CommessaParam).order_by(models.CommessaParam.position, models.CommessaParam.created_at).all()
    return [_param_out(db, p) for p in rows]


@app.post("/commessa-params", response_model=schemas.CommessaParamOut, status_code=201)
def create_commessa_param(payload: schemas.CommessaParamCreate, request: Request, db: Session = Depends(get_db),
                          admin: models.User = Depends(require_role())):
    """Solo admin: nuovo parametro a scelta multipla."""
    if not payload.name.strip():
        raise HTTPException(422, "name must not be empty")
    last = db.query(func.max(models.CommessaParam.position)).scalar() or 0
    p = models.CommessaParam(name=payload.name.strip(), options=_clean_options(payload.options), multi=payload.multi,
                             position=last + 1)
    db.add(p)
    db.flush()
    audit.record(db, "param.created", admin, entity_type="param", entity_id=p.id, request=request,
                 details={"name": p.name, "options": p.options, "multi": p.multi})
    db.commit()
    return _param_out(db, p)


@app.patch("/commessa-params/{param_id}", response_model=schemas.CommessaParamOut)
def update_commessa_param(param_id: str, payload: schemas.CommessaParamUpdate, request: Request,
                          db: Session = Depends(get_db), admin: models.User = Depends(require_role())):
    """
    Solo admin. Rinominare/rimuovere un'opzione già usata la toglie dalle commesse
    che l'avevano (i valori orfani non restano); passare a scelta singola tiene la prima.
    """
    p = db.get(models.CommessaParam, param_id)
    if p is None:
        raise HTTPException(404, "param not found")
    changes = payload.model_dump(exclude_unset=True)
    details: dict = {"name": p.name}
    if "name" in changes and changes["name"] is not None:
        if not changes["name"].strip():
            raise HTTPException(422, "name must not be empty")
        p.name = changes["name"].strip()
        details["renamed_to"] = p.name
    if "multi" in changes and changes["multi"] is not None:
        p.multi = changes["multi"]
        details["multi"] = p.multi
    if "position" in changes and changes["position"] is not None:
        p.position = changes["position"]
    if "options" in changes and changes["options"] is not None:
        p.options = _clean_options(changes["options"])
        details["options"] = p.options
    # riallinea i valori delle commesse alle opzioni/cardinalità correnti
    stripped = 0
    for c in db.query(models.Commessa).all():
        vals = [v for v in (c.params or {}).get(p.id, []) if v in p.options]
        if not p.multi:
            vals = vals[:1]
        if vals != (c.params or {}).get(p.id, []):
            new = dict(c.params or {})
            if vals:
                new[p.id] = vals
            else:
                new.pop(p.id, None)
            c.params = new
            stripped += 1
    if stripped:
        details["commesse_realigned"] = stripped
    p.updated_at = utcnow()
    audit.record(db, "param.updated", admin, entity_type="param", entity_id=p.id, request=request, details=details)
    db.commit()
    return _param_out(db, p)


@app.delete("/commessa-params/{param_id}", status_code=204)
def delete_commessa_param(param_id: str, request: Request, db: Session = Depends(get_db),
                          admin: models.User = Depends(require_role())):
    """Solo admin: elimina il parametro e i suoi valori da tutte le commesse."""
    p = db.get(models.CommessaParam, param_id)
    if p is None:
        raise HTTPException(404, "param not found")
    for c in db.query(models.Commessa).all():
        if p.id in (c.params or {}):
            c.params = {k: v for k, v in c.params.items() if k != p.id}
    audit.record(db, "param.deleted", admin, entity_type="param", entity_id=p.id, request=request,
                 details={"name": p.name})
    db.delete(p)
    db.commit()


def _commessa_out(c: models.Commessa, ids: Optional[set]) -> schemas.CommessaOut:
    projects = [p for p in c.projects if ids is None or p.id in ids]
    return schemas.CommessaOut(id=c.id, code=c.code, name=c.name, client=c.client, params=c.params or {},
                              archived_at=c.archived_at, created_at=c.created_at, projects=projects)


@app.get("/commesse", response_model=list[schemas.CommessaOut])
def list_commesse(include_archived: bool = False, db: Session = Depends(get_db),
                  user: models.User = Depends(current_user)):
    """
    Commesse con i cantieri accessibili all'utente (sottomenù della barra in alto).
    Chi non è manager vede solo le commesse in cui ha almeno un cantiere.
    """
    ids = auth.accessible_project_ids(db, user)
    q = db.query(models.Commessa)
    if not include_archived:
        q = q.filter(models.Commessa.archived_at.is_(None))
    out = [_commessa_out(c, ids) for c in q.order_by(models.Commessa.code).all()]
    if not auth.is_manager(user):
        out = [c for c in out if c.projects]
    return out


@app.post("/commesse", response_model=schemas.CommessaOut, status_code=201)
def create_commessa(payload: schemas.CommessaCreate, request: Request, db: Session = Depends(get_db),
                    user: models.User = Depends(require_role(UserRole.manager))):
    code = payload.code.strip()
    if not code or not payload.name.strip():
        raise HTTPException(422, "code and name are required")
    if db.query(models.Commessa).filter(models.Commessa.code == code).first():
        raise HTTPException(409, "commessa code already exists")
    c = models.Commessa(code=code, name=payload.name.strip(), client=(payload.client or "").strip() or None,
                        params=_validate_params(db, payload.params))
    db.add(c)
    db.flush()
    audit.record(db, "commessa.created", user, entity_type="commessa", entity_id=c.id, request=request,
                 details={"code": c.code, "name": c.name, "client": c.client, "params": c.params})
    db.commit()
    db.refresh(c)
    return _commessa_out(c, auth.accessible_project_ids(db, user))


@app.get("/commesse/{commessa_id}", response_model=schemas.CommessaOut)
def get_commessa(commessa_id: str, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    c = db.get(models.Commessa, commessa_id)
    if c is None:
        raise HTTPException(404, "commessa not found")
    out = _commessa_out(c, auth.accessible_project_ids(db, user))
    if not auth.is_manager(user) and not out.projects:
        raise HTTPException(403, "not a member of any project of this commessa")
    return out


@app.patch("/commesse/{commessa_id}", response_model=schemas.CommessaOut)
def update_commessa(commessa_id: str, payload: schemas.CommessaUpdate, request: Request, db: Session = Depends(get_db),
                    user: models.User = Depends(require_role(UserRole.manager))):
    c = db.get(models.Commessa, commessa_id)
    if c is None:
        raise HTTPException(404, "commessa not found")
    changes = payload.model_dump(exclude_unset=True)
    if "code" in changes and changes["code"] is not None:
        code = changes["code"].strip()
        if not code:
            raise HTTPException(422, "code must not be empty")
        other = db.query(models.Commessa).filter(models.Commessa.code == code, models.Commessa.id != c.id).first()
        if other:
            raise HTTPException(409, "commessa code already exists")
        c.code = code
    if "name" in changes and changes["name"] is not None:
        if not changes["name"].strip():
            raise HTTPException(422, "name must not be empty")
        c.name = changes["name"].strip()
    if "client" in changes:
        c.client = (changes["client"] or "").strip() or None
    if "params" in changes and changes["params"] is not None:
        c.params = _validate_params(db, changes["params"])
    if "archived" in changes and changes["archived"] is not None:
        c.archived_at = utcnow() if changes["archived"] else None
    c.updated_at = utcnow()
    audit.record(db, "commessa.updated", user, entity_type="commessa", entity_id=c.id, request=request,
                 details={"code": c.code, "name": c.name, "fields": sorted(changes.keys()), "params": c.params})
    db.commit()
    db.refresh(c)
    return _commessa_out(c, auth.accessible_project_ids(db, user))


@app.get("/projects/{project_id}", response_model=schemas.ProjectOut)
def get_project(project_id: str, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    return auth.assert_project_access(db, user, project_id)


@app.get("/projects/{project_id}/members", response_model=list[schemas.UserOut])
def list_members(project_id: str, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    auth.assert_project_access(db, user, project_id)
    return (db.query(models.User).join(models.ProjectMember, models.ProjectMember.user_id == models.User.id)
            .filter(models.ProjectMember.project_id == project_id).order_by(models.User.name).all())


@app.post("/projects/{project_id}/members", response_model=list[schemas.UserOut], status_code=201)
def add_member(project_id: str, payload: schemas.MemberAdd, db: Session = Depends(get_db),
               user: models.User = Depends(require_role(UserRole.manager))):
    auth.assert_project_access(db, user, project_id)
    if not db.get(models.User, payload.user_id):
        raise HTTPException(404, "user not found")
    if db.get(models.ProjectMember, (project_id, payload.user_id)) is None:
        db.add(models.ProjectMember(project_id=project_id, user_id=payload.user_id))
        db.commit()
    return list_members(project_id, db, user)


@app.delete("/projects/{project_id}/members/{user_id}", status_code=204)
def remove_member(project_id: str, user_id: str, db: Session = Depends(get_db),
                  user: models.User = Depends(require_role(UserRole.manager))):
    auth.assert_project_access(db, user, project_id)
    row = db.get(models.ProjectMember, (project_id, user_id))
    if row is None:
        raise HTTPException(404, "member not found")
    db.delete(row)
    db.commit()


# ---------- Planimetrie e template ----------

@app.post("/plans", response_model=schemas.PlanOut, status_code=201)
def create_plan(payload: schemas.PlanCreate, request: Request, db: Session = Depends(get_db),
                user: models.User = Depends(require_role(UserRole.manager))):
    auth.assert_project_access(db, user, payload.project_id)
    plan = models.Plan(**payload.model_dump())
    db.add(plan)
    db.flush()
    audit.record(db, "plan.created", user, entity_type="plan", entity_id=plan.id, project_id=plan.project_id,
                 request=request, details={"name": plan.name})
    db.commit()
    db.refresh(plan)
    return plan


@app.get("/projects/{project_id}/plans", response_model=list[schemas.PlanOut])
def list_plans(project_id: str, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    auth.assert_project_access(db, user, project_id)
    return db.query(models.Plan).filter(models.Plan.project_id == project_id).order_by(models.Plan.name).all()


@app.get("/plans/{plan_id}", response_model=schemas.PlanOut)
def get_plan(plan_id: str, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    plan = db.get(models.Plan, plan_id)
    if plan is None:
        raise HTTPException(404, "plan not found")
    auth.assert_project_access(db, user, plan.project_id)
    return plan


@app.get("/plans/{plan_id}/pins", response_model=list[schemas.PinSummary])
def list_plan_pins(
    plan_id: str,
    status: Optional[list[str]] = Query(default=None),
    template_id: Optional[str] = None,
    assigned_to: Optional[str] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    db: Session = Depends(get_db),
    user: models.User = Depends(current_user),
):
    """
    Pin (non cancellati) della planimetria con conteggi di submission e task per stato.

    Filtri (in AND tra loro, tutti sui soli record non cancellati):
    - `status` (ripetibile) + `assigned_to`: il pin ha almeno un task che soddisfa
      ENTRAMBE le condizioni (es. "task aperti assegnati a Mario");
    - `template_id`: il pin ha almeno una submission di quel template;
    - `date_from` / `date_to`: il pin, o una sua submission/task, è stato creato
      nell'intervallo (estremi inclusi; `date_to` con sola data copre tutto il giorno).
    I conteggi restano quelli totali del pin, non filtrati.
    """
    plan = db.get(models.Plan, plan_id)
    if plan is None:
        raise HTTPException(404, "plan not found")
    auth.assert_project_access(db, user, plan.project_id)

    q = _alive(db.query(models.Pin).filter(models.Pin.plan_id == plan_id), models.Pin)
    if status or assigned_to:
        task_q = db.query(models.Task.id).filter(
            models.Task.pin_id == models.Pin.id, models.Task.deleted_at.is_(None))
        if status:
            task_q = task_q.filter(models.Task.status.in_([_parse_status(v) for v in status]))
        if assigned_to:
            task_q = task_q.filter(models.Task.assigned_to == assigned_to)
        q = q.filter(task_q.exists())
    if template_id:
        q = q.filter(db.query(models.FormSubmission.id).filter(
            models.FormSubmission.pin_id == models.Pin.id,
            models.FormSubmission.deleted_at.is_(None),
            models.FormSubmission.template_id == template_id).exists())
    if date_from or date_to:
        lo = to_naive_utc(date_from) if date_from else None
        hi = to_naive_utc(date_to) if date_to else None
        if hi is not None and hi.time() == datetime.min.time():
            hi = hi.replace(hour=23, minute=59, second=59, microsecond=999999)

        def in_range(col):
            conds = []
            if lo is not None:
                conds.append(col >= lo)
            if hi is not None:
                conds.append(col <= hi)
            return and_(*conds)

        q = q.filter(or_(
            in_range(models.Pin.created_at),
            db.query(models.FormSubmission.id).filter(
                models.FormSubmission.pin_id == models.Pin.id, models.FormSubmission.deleted_at.is_(None),
                in_range(models.FormSubmission.created_at)).exists(),
            db.query(models.Task.id).filter(
                models.Task.pin_id == models.Pin.id, models.Task.deleted_at.is_(None),
                in_range(models.Task.created_at)).exists(),
        ))

    pins = q.all()
    if not pins:
        return []
    pin_ids = [p.id for p in pins]

    sub_counts = dict(
        db.query(models.FormSubmission.pin_id, func.count())
        .filter(models.FormSubmission.pin_id.in_(pin_ids), models.FormSubmission.deleted_at.is_(None))
        .group_by(models.FormSubmission.pin_id).all()
    )
    task_counts: dict[tuple[str, TaskStatus], int] = {
        (pid, status): n for pid, status, n in
        db.query(models.Task.pin_id, models.Task.status, func.count())
        .filter(models.Task.pin_id.in_(pin_ids), models.Task.deleted_at.is_(None))
        .group_by(models.Task.pin_id, models.Task.status).all()
    }
    out = []
    for p in pins:
        item = schemas.PinSummary.model_validate(p)
        item.submissions_count = sub_counts.get(p.id, 0)
        for status in TaskStatus:
            setattr(item, f"tasks_{status.value}", task_counts.get((p.id, status), 0))
        out.append(item)
    return out


@app.post("/form-templates", response_model=schemas.FormTemplateOut, status_code=201)
def create_form_template(payload: schemas.FormTemplateCreate, request: Request, db: Session = Depends(get_db),
                         user: models.User = Depends(require_role(UserRole.manager))):
    errors = validate_schema(payload.schema_def)
    if errors:
        raise HTTPException(422, detail=errors)
    template = models.FormTemplate(**payload.model_dump())
    db.add(template)
    db.flush()
    audit.record(db, "template.created", user, entity_type="template", entity_id=template.id, request=request,
                 details={"name": template.name})
    db.commit()
    db.refresh(template)
    return _template_out(db, template)


def _template_out(db: Session, template: models.FormTemplate) -> schemas.FormTemplateOut:
    out = schemas.FormTemplateOut.model_validate(template)
    out.submissions_count = (db.query(func.count(models.FormSubmission.id))
                             .filter(models.FormSubmission.template_id == template.id,
                                     models.FormSubmission.deleted_at.is_(None)).scalar())
    return out


@app.get("/form-templates", response_model=list[schemas.FormTemplateOut])
def list_form_templates(include_archived: bool = False, db: Session = Depends(get_db),
                        _: models.User = Depends(current_user)):
    """Template proponibili; con include_archived anche quelli archiviati (per leggere vecchie submission)."""
    q = db.query(models.FormTemplate)
    if not include_archived:
        q = q.filter(models.FormTemplate.archived_at.is_(None))
    return [_template_out(db, t) for t in q.order_by(models.FormTemplate.name).all()]


@app.get("/form-templates/{template_id}", response_model=schemas.FormTemplateOut)
def get_form_template(template_id: str, db: Session = Depends(get_db), _: models.User = Depends(current_user)):
    template = db.get(models.FormTemplate, template_id)
    if template is None:
        raise HTTPException(404, "template not found")
    return _template_out(db, template)


@app.patch("/form-templates/{template_id}", response_model=schemas.FormTemplateOut)
def update_form_template(template_id: str, payload: schemas.FormTemplateUpdate, request: Request,
                         db: Session = Depends(get_db),
                         user: models.User = Depends(require_role(UserRole.manager))):
    """
    Nome/categoria/archiviazione sempre; `schema_def` solo se nessuna submission
    usa ancora il template (409 altrimenti: duplicare e modificare la copia).
    """
    template = db.get(models.FormTemplate, template_id)
    if template is None:
        raise HTTPException(404, "template not found")
    changes = payload.model_dump(exclude_unset=True)
    if "schema_def" in changes:
        errors = validate_schema(changes["schema_def"])
        if errors:
            raise HTTPException(422, detail=errors)
        if _template_out(db, template).submissions_count:
            raise HTTPException(409, "template already used by submissions: duplicate it instead")
        template.schema_def = changes.pop("schema_def")
    if "archived" in changes:
        archived = changes.pop("archived")
        if archived != (template.archived_at is not None):
            audit.record(db, "template.archived" if archived else "template.restored", user, entity_type="template",
                         entity_id=template.id, request=request, details={"name": template.name})
        template.archived_at = utcnow() if archived else None
    if "name" in changes and not (changes["name"] or "").strip():
        raise HTTPException(422, "name must not be empty")
    for k, v in changes.items():
        setattr(template, k, v)
    edited = sorted(k for k in payload.model_dump(exclude_unset=True) if k != "archived")
    if edited:
        audit.record(db, "template.updated", user, entity_type="template", entity_id=template.id, request=request,
                     details={"name": template.name, "fields": edited})
    template.updated_at = utcnow()
    db.commit()
    db.refresh(template)
    return _template_out(db, template)


# ---------- Pin ----------

def _alive(query, model):
    return query.filter(model.deleted_at.is_(None))


def _with_attachments(schema_cls, obj):
    out = schema_cls.model_validate(obj)
    out.attachments = [schemas.AttachmentOut.model_validate(a)
                       for a in obj.attachments if a.deleted_at is None]
    return out


def _get_pin(db: Session, user: models.User, pin_id: str) -> models.Pin:
    pin = db.get(models.Pin, pin_id)
    if pin is None or pin.deleted_at is not None:
        raise HTTPException(404, "pin not found")
    auth.assert_project_access(db, user, auth.project_of_pin(pin))
    return pin


def _get_task(db: Session, user: models.User, task_id: str) -> models.Task:
    task = db.get(models.Task, task_id)
    if task is None or task.deleted_at is not None:
        raise HTTPException(404, "task not found")
    auth.assert_project_access(db, user, auth.project_of_task(task))
    return task


def _get_user_or_422(db: Session, user_id: Optional[str], field: str) -> None:
    if user_id is not None and db.get(models.User, user_id) is None:
        raise HTTPException(422, f"{field}: user not found")


@app.post("/pins", response_model=schemas.PinOut, status_code=201)
def create_pin(payload: schemas.PinCreate, request: Request, db: Session = Depends(get_db),
               user: models.User = Depends(current_user)):
    plan = db.get(models.Plan, payload.plan_id)
    if plan is None:
        raise HTTPException(404, "plan not found")
    auth.assert_project_access(db, user, plan.project_id)
    pin = models.Pin(**payload.model_dump(), created_by=user.id)
    db.add(pin)
    db.flush()
    audit.record(db, "pin.created", user, entity_type="pin", entity_id=pin.id, project_id=plan.project_id,
                 request=request, details={"plan_id": plan.id, "label": pin.label})
    db.commit()
    db.refresh(pin)
    return pin


@app.patch("/pins/{pin_id}", response_model=schemas.PinOut)
def update_pin(pin_id: str, payload: schemas.PinUpdate, request: Request, db: Session = Depends(get_db),
               user: models.User = Depends(current_user)):
    """Sposta (x/y) o rinomina un pin."""
    pin = _get_pin(db, user, pin_id)
    changes = payload.model_dump(exclude_unset=True)
    for k, v in changes.items():
        setattr(pin, k, v)
    pin.updated_at = utcnow()
    audit.record(db, "pin.updated", user, entity_type="pin", entity_id=pin.id, project_id=auth.project_of_pin(pin),
                 request=request, details={"fields": sorted(changes.keys()), "label": pin.label})
    db.commit()
    db.refresh(pin)
    return pin


@app.delete("/pins/{pin_id}", status_code=204)
def delete_pin(pin_id: str, request: Request, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    """
    Soft-delete del pin e di tutto ciò che contiene (submission, task, allegati),
    così il sync propaga la cancellazione completa. Solo creatore o manager.
    """
    pin = _get_pin(db, user, pin_id)
    audit.record(db, "pin.deleted", user, entity_type="pin", entity_id=pin.id, project_id=auth.project_of_pin(pin),
                 request=request, details={"label": pin.label, "submissions": len(pin.submissions), "tasks": len(pin.tasks)})
    if not auth.is_manager(user) and pin.created_by != user.id:
        raise HTTPException(403, "only the creator or a manager can delete a pin")
    now = utcnow()
    for sub in pin.submissions:
        for att in sub.attachments:
            att.deleted_at = att.updated_at = now
        sub.deleted_at = sub.updated_at = now
    for task in pin.tasks:
        for att in task.attachments:
            att.deleted_at = att.updated_at = now
        task.deleted_at = task.updated_at = now
    pin.deleted_at = pin.updated_at = now
    db.commit()


@app.get("/pins/{pin_id}", response_model=schemas.PinDetail)
def get_pin(pin_id: str, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    """Pin con submissions, task e allegati (non cancellati): apertura da plan view."""
    pin = _get_pin(db, user, pin_id)
    subs = _alive(db.query(models.FormSubmission).filter_by(pin_id=pin_id), models.FormSubmission).all()
    tasks = _alive(db.query(models.Task).filter_by(pin_id=pin_id), models.Task).all()
    out = schemas.PinDetail.model_validate(pin)
    out.submissions = [_with_attachments(schemas.SubmissionOut, x) for x in subs]
    out.tasks = [_with_attachments(schemas.TaskOut, x) for x in tasks]
    return out


# ---------- WBS (albero per cantiere) ----------

def _get_wbs_node(db: Session, user: models.User, node_id: str) -> models.WbsNode:
    node = db.get(models.WbsNode, node_id)
    if node is None:
        raise HTTPException(404, "wbs node not found")
    auth.assert_project_access(db, user, node.project_id)
    return node


def _wbs_out(nodes: list[models.WbsNode], db: Session) -> list[schemas.WbsNodeOut]:
    ids = [n.id for n in nodes]
    counts = dict(
        db.query(models.FormSubmission.wbs_node_id, func.count())
        .filter(models.FormSubmission.wbs_node_id.in_(ids), models.FormSubmission.deleted_at.is_(None))
        .group_by(models.FormSubmission.wbs_node_id).all()
    ) if ids else {}
    out = []
    for n in nodes:
        o = schemas.WbsNodeOut.model_validate(n)
        o.submissions_count = counts.get(n.id, 0)
        out.append(o)
    return out


@app.get("/projects/{project_id}/wbs", response_model=list[schemas.WbsNodeOut])
def list_wbs(project_id: str, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    """Tutte le voci WBS del cantiere, piatte e ordinate (position, code): il client ricostruisce l'albero."""
    auth.assert_project_access(db, user, project_id)
    nodes = (db.query(models.WbsNode).filter(models.WbsNode.project_id == project_id)
             .order_by(models.WbsNode.position, models.WbsNode.code, models.WbsNode.name).all())
    return _wbs_out(nodes, db)


@app.post("/projects/{project_id}/wbs", response_model=schemas.WbsNodeOut, status_code=201)
def create_wbs_node(project_id: str, payload: schemas.WbsNodeCreate, request: Request, db: Session = Depends(get_db),
                    user: models.User = Depends(require_role(UserRole.manager))):
    """Nuova voce (radice o figlia di parent_id, che deve stare nello stesso cantiere); va in coda tra i fratelli."""
    auth.assert_project_access(db, user, project_id)
    if payload.parent_id is not None:
        parent = db.get(models.WbsNode, payload.parent_id)
        if parent is None or parent.project_id != project_id:
            raise HTTPException(422, "parent_id: wbs node not found in this project")
    last = (db.query(func.max(models.WbsNode.position))
            .filter(models.WbsNode.project_id == project_id, models.WbsNode.parent_id == payload.parent_id).scalar())
    node = models.WbsNode(project_id=project_id, position=(last or 0) + 1, **payload.model_dump())
    db.add(node)
    db.flush()
    audit.record(db, "wbs.created", user, entity_type="wbs_node", entity_id=node.id, project_id=project_id,
                 request=request, details={"code": node.code, "name": node.name, "parent_id": node.parent_id})
    db.commit()
    db.refresh(node)
    return _wbs_out([node], db)[0]


@app.get("/wbs/{node_id}", response_model=schemas.WbsNodeDetail)
def get_wbs_node(node_id: str, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    """Voce con i moduli compilati su di essa (non cancellati), dal più recente."""
    node = _get_wbs_node(db, user, node_id)
    subs = (_alive(db.query(models.FormSubmission).filter_by(wbs_node_id=node_id), models.FormSubmission)
            .order_by(models.FormSubmission.created_at.desc()).all())
    out = schemas.WbsNodeDetail.model_validate(node)
    out.submissions_count = len(subs)
    out.submissions = [_with_attachments(schemas.SubmissionOut, x) for x in subs]
    return out


@app.patch("/wbs/{node_id}", response_model=schemas.WbsNodeOut)
def update_wbs_node(node_id: str, payload: schemas.WbsNodeUpdate, request: Request, db: Session = Depends(get_db),
                    user: models.User = Depends(require_role(UserRole.manager))):
    """Rinomina, ricodifica, sposta sotto un altro padre (non un proprio discendente) o riordina."""
    node = _get_wbs_node(db, user, node_id)
    changes = payload.model_dump(exclude_unset=True)
    if "parent_id" in changes and changes["parent_id"] != node.parent_id:
        new_parent = changes["parent_id"]
        if new_parent is not None:
            p = db.get(models.WbsNode, new_parent)
            if p is None or p.project_id != node.project_id:
                raise HTTPException(422, "parent_id: wbs node not found in this project")
            while p is not None:
                if p.id == node.id:
                    raise HTTPException(422, "parent_id: cannot move a node under itself")
                p = p.parent
    for k, v in changes.items():
        setattr(node, k, v)
    node.updated_at = utcnow()
    audit.record(db, "wbs.updated", user, entity_type="wbs_node", entity_id=node.id, project_id=node.project_id,
                 request=request, details={"fields": sorted(changes.keys()), "code": node.code, "name": node.name})
    db.commit()
    db.refresh(node)
    return _wbs_out([node], db)[0]


@app.delete("/wbs/{node_id}", status_code=204)
def delete_wbs_node(node_id: str, request: Request, db: Session = Depends(get_db),
                    user: models.User = Depends(require_role(UserRole.manager))):
    """Elimina una voce senza figli e senza moduli compilati (409 altrimenti)."""
    node = _get_wbs_node(db, user, node_id)
    if node.children:
        raise HTTPException(409, "wbs node has children")
    if any(s.deleted_at is None for s in node.submissions):
        raise HTTPException(409, "wbs node has submissions")
    audit.record(db, "wbs.deleted", user, entity_type="wbs_node", entity_id=node.id, project_id=node.project_id,
                 request=request, details={"code": node.code, "name": node.name})
    # le submission soft-deleted restano referenziate: stacchiamole prima
    for s in node.submissions:
        s.wbs_node_id = None
    db.delete(node)
    db.commit()


# ---------- Submissions (uso da web) ----------

@app.post("/submissions", response_model=schemas.SubmissionOut, status_code=201)
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


@app.get("/submissions/{submission_id}", response_model=schemas.SubmissionOut)
def get_submission(submission_id: str, db: Session = Depends(get_db),
                   user: models.User = Depends(current_user)):
    sub = db.get(models.FormSubmission, submission_id)
    if sub is None or sub.deleted_at is not None:
        raise HTTPException(404, "submission not found")
    auth.assert_project_access(db, user, auth.project_of_submission(sub))
    return _with_attachments(schemas.SubmissionOut, sub)


@app.get("/submissions/{submission_id}/pdf")
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


@app.patch("/submissions/{submission_id}", response_model=schemas.SubmissionOut)
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


# ---------- Task (uso da web) ----------

def _parse_status(value: str) -> TaskStatus:
    try:
        return TaskStatus(value)
    except ValueError:
        raise HTTPException(422, f"invalid status {value!r}")


@app.post("/tasks", response_model=schemas.TaskOut, status_code=201)
def create_task(payload: schemas.TaskCreate, request: Request, db: Session = Depends(get_db),
                user: models.User = Depends(current_user)):
    _get_pin(db, user, payload.pin_id)
    _get_user_or_422(db, payload.assigned_to, "assigned_to")
    task = models.Task(**payload.model_dump(), created_by=user.id)
    task.status = TaskStatus.assigned if payload.assigned_to else TaskStatus.open
    db.add(task)
    db.flush()
    project_id = auth.project_of_pin(task.pin)
    events.record_task_created(db, task, project_id, user.id)
    audit.record(db, "task.created", user, entity_type="task", entity_id=task.id, project_id=project_id,
                 request=request, details={"title": task.title, "assigned_to": task.assigned_to})
    db.commit()
    db.refresh(task)
    return _with_attachments(schemas.TaskOut, task)


@app.get("/projects/{project_id}/tasks", response_model=list[schemas.TaskListItem])
def list_tasks(
    project_id: str,
    status: Optional[str] = None,
    plan_id: Optional[str] = None,
    assigned_to: Optional[str] = None,
    db: Session = Depends(get_db),
    user: models.User = Depends(current_user),
):
    auth.assert_project_access(db, user, project_id)
    q = (db.query(models.Task)
         .join(models.Pin, models.Task.pin_id == models.Pin.id)
         .join(models.Plan, models.Pin.plan_id == models.Plan.id)
         .filter(models.Plan.project_id == project_id)
         .filter(models.Task.deleted_at.is_(None), models.Pin.deleted_at.is_(None)))
    if status:
        q = q.filter(models.Task.status == _parse_status(status))
    if plan_id:
        q = q.filter(models.Pin.plan_id == plan_id)
    if assigned_to:
        q = q.filter(models.Task.assigned_to == assigned_to)
    q = q.order_by(models.Task.created_at.desc())
    out = []
    for t in q.all():
        base = _with_attachments(schemas.TaskOut, t)
        out.append(schemas.TaskListItem(**base.model_dump(), plan_id=t.pin.plan_id,
                                        plan_name=t.pin.plan.name, pin_label=t.pin.label))
    return out


@app.get("/projects/{project_id}/stats", response_model=schemas.StatsOut)
def project_stats(
    project_id: str,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    template_id: Optional[str] = None,
    plan_id: Optional[str] = None,
    assigned_to: Optional[str] = None,
    days: int = Query(30, ge=7, le=365),
    db: Session = Depends(get_db),
    user: models.User = Depends(current_user),
):
    """Numeri per la dashboard: task per stato, aperti per planimetria, moduli per template, serie giornaliera, scaduti."""
    auth.assert_project_access(db, user, project_id)
    return st_stats.project_stats(db, project_id, date_from=to_naive_utc(date_from), date_to=to_naive_utc(date_to),
                                  template_id=template_id, plan_id=plan_id, assigned_to=assigned_to, days=days)


@app.get("/tasks/{task_id}", response_model=schemas.TaskOut)
def get_task(task_id: str, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    return _with_attachments(schemas.TaskOut, _get_task(db, user, task_id))


@app.patch("/tasks/{task_id}", response_model=schemas.TaskOut)
def update_task(task_id: str, payload: schemas.TaskUpdate, request: Request, db: Session = Depends(get_db),
                user: models.User = Depends(current_user)):
    """
    Aggiornamento parziale. Cambi di stato solo lungo TASK_TRANSITIONS (409 altrimenti);
    'verified' è riservato a manager/admin. Assegnare un task 'open' senza indicare
    lo stato lo porta automaticamente ad 'assigned'.
    """
    task = _get_task(db, user, task_id)
    before = {"status": task.status.value, "assigned_to": task.assigned_to}
    changes = payload.model_dump(exclude_unset=True)
    _get_user_or_422(db, changes.get("assigned_to"), "assigned_to")

    if "status" in changes:
        new_status = _parse_status(changes.pop("status"))
        if new_status != task.status:
            if new_status not in TASK_TRANSITIONS[task.status]:
                raise HTTPException(409, f"cannot go from {task.status.value} to {new_status.value}")
            if new_status == TaskStatus.assigned and not (changes.get("assigned_to") or task.assigned_to):
                raise HTTPException(409, "assigned_to is required to move to assigned")
            if new_status == TaskStatus.verified and not auth.is_manager(user):
                raise HTTPException(403, "only manager or admin can verify a task")
            task.status = new_status
            st_stats.mark_resolved_at(task, before["status"])
    elif changes.get("assigned_to") and task.status == TaskStatus.open:
        task.status = TaskStatus.assigned

    for k, v in changes.items():
        setattr(task, k, v)
    task.updated_at = utcnow()
    events.record_task_changes(db, task, auth.project_of_task(task), user.id, before)
    audit.record(db, "task.updated", user, entity_type="task", entity_id=task.id, project_id=auth.project_of_task(task),
                 request=request, details={"title": task.title, "fields": sorted(payload.model_dump(exclude_unset=True).keys()),
                                           "status": {"from": before["status"], "to": task.status.value}
                                           if before["status"] != task.status.value else None})
    db.commit()
    db.refresh(task)
    return _with_attachments(schemas.TaskOut, task)


@app.delete("/tasks/{task_id}", status_code=204)
def delete_task(task_id: str, request: Request, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    """Soft-delete (manager/admin o creatore): viaggia nel sync come ogni altra modifica."""
    task = _get_task(db, user, task_id)
    if not auth.is_manager(user) and task.created_by != user.id:
        raise HTTPException(403, "only the creator or a manager can delete a task")
    task.deleted_at = task.updated_at = utcnow()
    audit.record(db, "task.deleted", user, entity_type="task", entity_id=task.id, project_id=auth.project_of_task(task),
                 request=request, details={"title": task.title})
    db.commit()


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


@app.post("/plans/{plan_id}/file", response_model=schemas.PlanOut)
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


@app.post("/attachments", response_model=schemas.AttachmentOut, status_code=201)
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


@app.delete("/attachments/{attachment_id}", status_code=204)
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


@app.post("/attachments/presign", response_model=schemas.PresignResponse)
def presign_attachment(payload: schemas.PresignRequest, db: Session = Depends(get_db),
                       user: models.User = Depends(current_user)):
    """
    L'app chiede dove caricare i byte di un allegato già sincronizzato.
    Stub per l'MVP: upload diretto sull'API. In prod restituirà un presigned URL S3.
    """
    att = _get_attachment(db, user, payload.attachment_id)
    return schemas.PresignResponse(
        attachment_id=att.id, method="POST",
        upload_url=f"/attachments/{att.id}/upload", max_bytes=st.MAX_UPLOAD_BYTES,
    )


@app.post("/attachments/{attachment_id}/upload", response_model=schemas.AttachmentOut)
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


@app.get("/files/{key:path}")
def get_file(key: str, _: models.User = Depends(current_user)):
    """Serve i file dello storage (filesystem o S3) con il JWT: gli URL nel DB sono sempre /files/<key>."""
    if not st.storage.exists(key):
        raise HTTPException(404, "file not found")
    if isinstance(st.storage, st.S3Storage):
        data = st.storage.read(key)
        return Response(content=data, media_type=st.sniff_mime(data) or "application/octet-stream")
    return FileResponse(st.storage.path(key))


# ---------- Sync offline-first (uso da app nativa) ----------

def _upsert(db: Session, model, items, fk_checks: dict, updatable: list[str],
            validate=None, defaults: Optional[dict] = None) -> schemas.SyncPushResult:
    """
    Upsert idempotente per id con "last write wins".

    fk_checks: {campo_fk: Model} — ogni FK viene verificata contro il DB
               (comprese le righe appena flushate nello stesso batch).
    updatable: campi che un push più recente può sovrascrivere.
    validate:  fn(item) -> motivo di rifiuto (str) o None, eseguita dopo le FK.
    defaults:  valori applicati all'insert quando il campo è nullo (es. created_by).
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
            values = item.model_dump()
            for k, v in (defaults or {}).items():
                values[k] = values.get(k) or v
            db.add(model(**values))
            res.inserted += 1
        elif item.updated_at > existing.updated_at:
            for f in updatable:
                setattr(existing, f, getattr(item, f))
            existing.updated_at = item.updated_at
            res.updated += 1
        else:
            res.skipped += 1
            res.skipped_ids.append(item.id)
    db.flush()  # rende visibili gli insert alle fk_checks del gruppo successivo
    return res


@app.post("/sync/push", response_model=schemas.SyncPushResponse)
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
        updatable=["x", "y", "label", "deleted_at"],
        validate=check_pin, defaults={"created_by": user.id},
    )
    submissions = _upsert(
        db, models.FormSubmission, payload.submissions,
        fk_checks={"template_id": models.FormTemplate, "pin_id": models.Pin},
        updatable=["data_json", "submitted_by", "deleted_at"],
        validate=check_submission, defaults={"submitted_by": user.id},
    )
    tasks = _upsert(
        db, models.Task, payload.tasks,
        fk_checks={"pin_id": models.Pin, "assigned_to": models.User, "created_by": models.User},
        updatable=["title", "description", "status", "assigned_to", "due_date", "deleted_at"],
        validate=check_task, defaults={"created_by": user.id},
    )
    attachments = _upsert(
        db, models.Attachment, payload.attachments,
        fk_checks={"submission_id": models.FormSubmission, "task_id": models.Task},
        updatable=["file_url", "file_type", "deleted_at"],
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


@app.get("/sync/pull", response_model=schemas.SyncPullResponse)
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
        return query.filter(model.updated_at > since) if since else query

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
