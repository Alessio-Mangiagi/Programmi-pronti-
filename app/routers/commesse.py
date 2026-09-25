"""Commesse e parametri personalizzati."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models, schemas, auth, audit
from ..auth import current_user, require_role
from ..database import get_db
from ..models import utcnow, UserRole

router = APIRouter()


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


@router.get("/commessa-params", response_model=list[schemas.CommessaParamOut])
def list_commessa_params(db: Session = Depends(get_db), _: models.User = Depends(current_user)):
    rows = db.query(models.CommessaParam).order_by(models.CommessaParam.position, models.CommessaParam.created_at).all()
    return [_param_out(db, p) for p in rows]


@router.post("/commessa-params", response_model=schemas.CommessaParamOut, status_code=201)
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


@router.patch("/commessa-params/{param_id}", response_model=schemas.CommessaParamOut)
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


@router.delete("/commessa-params/{param_id}", status_code=204)
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


@router.get("/commesse", response_model=list[schemas.CommessaOut])
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


@router.post("/commesse", response_model=schemas.CommessaOut, status_code=201)
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


@router.get("/commesse/{commessa_id}", response_model=schemas.CommessaOut)
def get_commessa(commessa_id: str, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    c = db.get(models.Commessa, commessa_id)
    if c is None:
        raise HTTPException(404, "commessa not found")
    out = _commessa_out(c, auth.accessible_project_ids(db, user))
    if not auth.is_manager(user) and not out.projects:
        raise HTTPException(403, "not a member of any project of this commessa")
    return out


@router.patch("/commesse/{commessa_id}", response_model=schemas.CommessaOut)
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
