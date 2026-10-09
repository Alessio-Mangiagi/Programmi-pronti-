"""WBS: albero per cantiere, import da Excel/CSV."""
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models, schemas, auth, audit, wbs_import
from ..auth import current_user, require_role
from ..database import get_db
from ..models import utcnow, UserRole
from .common import _alive, _with_attachments, _get_wbs_node

router = APIRouter()


# ---------- WBS (albero per cantiere) ----------


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


@router.get("/projects/{project_id}/wbs", response_model=list[schemas.WbsNodeOut])
def list_wbs(project_id: str, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    """Tutte le voci WBS del cantiere, piatte e ordinate (position, code): il client ricostruisce l'albero."""
    auth.assert_project_access(db, user, project_id)
    nodes = (db.query(models.WbsNode).filter(models.WbsNode.project_id == project_id)
             .order_by(models.WbsNode.position, models.WbsNode.code, models.WbsNode.name).all())
    return _wbs_out(nodes, db)


@router.post("/projects/{project_id}/wbs", response_model=schemas.WbsNodeOut, status_code=201)
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


WBS_IMPORT_MAX_BYTES = 5 * 1024 * 1024


@router.post("/projects/{project_id}/wbs/import", response_model=schemas.WbsImportResult)
async def import_wbs(project_id: str, request: Request, file: UploadFile = File(...), dry_run: bool = False,
                     db: Session = Depends(get_db), user: models.User = Depends(require_role(UserRole.manager))):
    """
    Importa/aggiorna l'albero da Excel o CSV (formato in app/wbs_import.py). Le voci si
    riconoscono per codice: stesso codice = aggiornamento, nuovo codice o senza codice =
    creazione. Con dry_run=true restituisce solo l'anteprima riga per riga, senza scrivere.
    """
    auth.assert_project_access(db, user, project_id)
    data = await file.read(WBS_IMPORT_MAX_BYTES + 1)
    if len(data) > WBS_IMPORT_MAX_BYTES:
        raise HTTPException(413, f"file larger than {WBS_IMPORT_MAX_BYTES} bytes")
    try:
        parsed = wbs_import.parse(data, file.filename or "")
    except ValueError as e:
        raise HTTPException(422, str(e))
    if parsed.errors:
        raise HTTPException(422, "; ".join(parsed.errors))

    existing = db.query(models.WbsNode).filter(models.WbsNode.project_id == project_id).all()
    by_code = {n.code: n for n in existing if n.code}
    file_codes = {r.code for r in parsed.rows if r.code and not r.error}

    # Chiave in memoria di ogni voce (esistente: id; nuova: ("new", riga)) e padre risultante,
    # per trovare i cicli prima di scrivere (vale anche per l'anteprima).
    key_of_code = {c: n.id for c, n in by_code.items()}
    parent_key: dict = {n.id: n.parent_id for n in existing}
    row_key = {}
    for r in parsed.rows:
        if r.error:
            continue
        if r.parent_code and r.parent_code not in file_codes and r.parent_code not in by_code:
            r.error = f"padre '{r.parent_code}' non trovato"
            continue
        k = key_of_code.get(r.code) if r.code else None
        if k is None:
            k = ("new", r.row)
            if r.code:
                key_of_code[r.code] = k
        row_key[r.row] = k
    for r in parsed.rows:
        if r.error:
            continue
        parent_key[row_key[r.row]] = key_of_code[r.parent_code] if r.parent_code else None
    for r in parsed.rows:
        if r.error:
            continue
        k = row_key[r.row]
        p, hops = parent_key.get(k), 0
        while p is not None and hops < 10_000:
            if p == k:
                r.error = "il padre è una sua sottovoce (ciclo)"
                break
            p, hops = parent_key.get(p), hops + 1

    out_rows = [
        schemas.WbsImportRow(row=r.row, code=r.code, name=r.name, parent_code=r.parent_code,
                             action="error" if r.error else ("update" if r.code in by_code else "create"), error=r.error)
        for r in parsed.rows
    ]
    result = schemas.WbsImportResult(
        dry_run=dry_run, rows=out_rows,
        created=sum(1 for x in out_rows if x.action == "create"),
        updated=sum(1 for x in out_rows if x.action == "update"),
        errors=sum(1 for x in out_rows if x.action == "error"),
    )
    if dry_run:
        return result

    # Scrittura: prima le voci (nome), poi i padri, poi le posizioni delle nuove in coda ai fratelli.
    now = utcnow()
    node_of_key: dict = {n.id: n for n in existing}
    new_nodes: list[tuple[models.WbsNode, object]] = []
    for r in parsed.rows:
        if r.error:
            continue
        k = row_key[r.row]
        if k in node_of_key:
            n = node_of_key[k]
            if n.name != r.name:
                n.name, n.updated_at = r.name, now
        else:
            n = models.WbsNode(project_id=project_id, code=r.code, name=r.name, position=0)
            db.add(n)
            node_of_key[k] = n
            new_nodes.append((n, k))
    for r in parsed.rows:
        if r.error:
            continue
        n = node_of_key[row_key[r.row]]
        parent = node_of_key[key_of_code[r.parent_code]] if r.parent_code else None
        if parent is not None:
            db.flush()   # id del padre appena creato
        pid = parent.id if parent is not None else None
        if n.parent_id != pid:
            n.parent, n.updated_at = parent, now
    db.flush()
    sibling_max: dict = {}
    for n in existing:
        sibling_max[n.parent_id] = max(sibling_max.get(n.parent_id, 0), n.position)
    for n, _ in new_nodes:
        sibling_max[n.parent_id] = sibling_max.get(n.parent_id, 0) + 1
        n.position = sibling_max[n.parent_id]
    audit.record(db, "wbs.imported", user, entity_type="project", entity_id=project_id, project_id=project_id,
                 request=request, details={"file": file.filename, "created": result.created, "updated": result.updated,
                                           "errors": result.errors})
    db.commit()
    return result


@router.get("/wbs/{node_id}", response_model=schemas.WbsNodeDetail)
def get_wbs_node(node_id: str, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    """Voce con i moduli compilati su di essa (non cancellati), dal più recente."""
    node = _get_wbs_node(db, user, node_id)
    subs = (_alive(db.query(models.FormSubmission).filter_by(wbs_node_id=node_id), models.FormSubmission)
            .order_by(models.FormSubmission.created_at.desc()).all())
    out = schemas.WbsNodeDetail.model_validate(node)
    out.submissions_count = len(subs)
    out.submissions = [_with_attachments(schemas.SubmissionOut, x) for x in subs]
    return out


@router.patch("/wbs/{node_id}", response_model=schemas.WbsNodeOut)
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


@router.delete("/wbs/{node_id}", status_code=204)
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
