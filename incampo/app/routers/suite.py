# "><(((º> sabusabu <º)))><"
"""Dialogo con le altre app della suite Cosedil (Magazzino Operativo, SkyTower).

Rotte in due direzioni, chiave comune = codice commessa (``Commessa.code``):

* ``/suite/...`` — quello che InCampo offre alle altre app. Protette dal token di
  servizio di ``shared/suite/suite_link.py`` (header X-Suite-Token), non dal JWT:
  le chiama il Magazzino (riepilogo task/NC del cantiere, apertura di un task).
* rotte utente (JWT come tutte le altre) che chiamano le altre app:
  - ``GET /projects/{id}/magazzino``: materiale e mezzi in cantiere (Magazzino);
  - ``GET /projects/{id}/skytower/documenti``: tavole pubblicate su SkyTower;
  - ``POST /plans/da-skytower``: una tavola pubblicata diventa planimetria;
  - ``POST /submissions/{id}/skytower``: il PDF del modulo (es. una NC) va su SkyTower.
"""
import json
import os
import sys
from datetime import timedelta
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session, selectinload

from .. import audit, auth, events, models, pdf, schemas, storage as st
from ..auth import current_user, require_role
from ..database import get_db
from ..models import TaskStatus, UserRole, utcnow

_SHARED = Path(__file__).resolve().parents[3] / "shared" / "suite"
if str(_SHARED) not in sys.path:
    sys.path.insert(0, str(_SHARED))
import suite_link  # noqa: E402

router = APIRouter()
APERTI = (TaskStatus.open, TaskStatus.assigned)


# --------------------------------------------------------------------------- utilità

def web_url() -> str:
    return (os.getenv("WEB_URL") or suite_link.url_pubblico("incampo")).rstrip("/")


def _commessa_per_codice(db: Session, codice: str) -> models.Commessa:
    chiave = suite_link.normalizza_commessa(codice)
    for c in db.query(models.Commessa).filter(models.Commessa.archived_at.is_(None)).all():
        if suite_link.normalizza_commessa(c.code) == chiave:
            return c
    raise HTTPException(404, f"Nessuna commessa InCampo con codice {codice}")


def _utente_suite(db: Session, utente: Optional[str]) -> Optional[models.User]:
    """L'utente InCampo che corrisponde all'utente del portale mandato dall'altra app
    (email uguale, o parte prima della @ uguale allo username). None se non c'è."""
    if not utente:
        return None
    u = utente.strip().lower()
    for user in db.query(models.User).filter(models.User.is_active.is_(True)).all():
        email = (user.email or "").lower()
        if email == u or email.split("@")[0] == u:
            return user
    return None


def richiede_token(x_suite_token: Optional[str] = Header(default=None)):
    if not suite_link.verifica(x_suite_token):
        raise HTTPException(403, "Token di servizio della suite non valido")


def _chiama(app_id: str, metodo: str, percorso: str, user: models.User, **kw):
    try:
        return suite_link.chiama(app_id, metodo, percorso, utente=user.email, nome=user.name, **kw)
    except suite_link.SuiteError as e:
        raise HTTPException(e.stato if e.stato in (400, 403, 404, 409, 422, 503) else 502, e.messaggio)


def _task_aperti(db: Session, project_ids: list[str]):
    """Task vivi e aperti dei cantieri: su pin delle loro planimetrie o direttamente sul cantiere."""
    if not project_ids:
        return []
    su_pin = (db.query(models.Task).join(models.Pin, models.Task.pin_id == models.Pin.id)
              .join(models.Plan, models.Pin.plan_id == models.Plan.id)
              .filter(models.Plan.project_id.in_(project_ids), models.Pin.deleted_at.is_(None)))
    su_cantiere = db.query(models.Task).filter(models.Task.project_id.in_(project_ids))
    out = {}
    for q in (su_pin, su_cantiere):
        for t in q.filter(models.Task.deleted_at.is_(None), models.Task.status.in_(APERTI)).options(
                selectinload(models.Task.pin).selectinload(models.Pin.plan)).all():
            out[t.id] = t
    return sorted(out.values(), key=lambda t: t.created_at or utcnow(), reverse=True)


def _nc_aperte(db: Session, project_ids: list[str], giorni: int = 180):
    """Moduli compilati con una non conformità negli ultimi ``giorni``, senza task già chiuso."""
    if not project_ids:
        return []
    da = utcnow() - timedelta(days=giorni)
    subs = (db.query(models.FormSubmission)
            .outerjoin(models.Pin, models.FormSubmission.pin_id == models.Pin.id)
            .outerjoin(models.Plan, models.Pin.plan_id == models.Plan.id)
            .outerjoin(models.WbsNode, models.FormSubmission.wbs_node_id == models.WbsNode.id)
            .filter(models.FormSubmission.deleted_at.is_(None), models.FormSubmission.created_at >= da)
            .filter((models.Plan.project_id.in_(project_ids)) | (models.FormSubmission.project_id.in_(project_ids))
                    | (models.WbsNode.project_id.in_(project_ids)))
            .options(selectinload(models.FormSubmission.pin).selectinload(models.Pin.plan),
                     selectinload(models.FormSubmission.wbs_node))
            .order_by(models.FormSubmission.created_at.desc()).all())
    templates = {}
    out = []
    for s in subs:
        tpl = templates.get(s.template_id)
        if tpl is None:
            tpl = templates[s.template_id] = db.get(models.FormTemplate, s.template_id)
        nc = events.find_non_conformity(tpl.schema_def or {}, s.data_json or {}) if tpl else None
        if not nc:
            continue
        chiuso = db.query(models.Task).filter(models.Task.submission_id == s.id, models.Task.deleted_at.is_(None),
                                              models.Task.status.in_((TaskStatus.resolved, TaskStatus.verified))).first()
        if chiuso:
            continue
        out.append((s, tpl, nc))
    return out


def _pin_url(pin: Optional[models.Pin], project_id: str) -> str:
    if pin is not None:
        return f"{web_url()}/projects/{project_id}/plans/{pin.plan_id}?pin={pin.id}"
    return f"{web_url()}/projects/{project_id}/tasks"


# --------------------------------------------------------------------------- offerto alle altre app

@router.get("/suite/commesse", dependencies=[Depends(richiede_token)], include_in_schema=False)
def suite_commesse(db: Session = Depends(get_db)):
    """Commesse attive con i loro cantieri (per il Magazzino: crea le ubicazioni-cantiere)."""
    out = []
    for c in db.query(models.Commessa).filter(models.Commessa.archived_at.is_(None)).order_by(models.Commessa.code).all():
        out.append({"id": c.id, "code": c.code, "name": c.name, "client": c.client,
                    "url": f"{web_url()}/projects",
                    "cantieri": [{"id": p.id, "name": p.name, "address": p.address,
                                  "url": f"{web_url()}/projects/{p.id}/plans"} for p in c.projects]})
    return out


@router.get("/suite/commesse/{codice}/riepilogo", dependencies=[Depends(richiede_token)], include_in_schema=False)
def suite_riepilogo(codice: str, db: Session = Depends(get_db)):
    """Cantieri, task aperti e non conformità della commessa: lo mostra il Magazzino nella scheda ubicazione."""
    c = _commessa_per_codice(db, codice)
    ids = [p.id for p in c.projects]
    nomi = {p.id: p.name for p in c.projects}
    tasks = _task_aperti(db, ids)
    nc = _nc_aperte(db, ids)
    utenti = {}

    def nome_utente(uid):
        if not uid:
            return None
        if uid not in utenti:
            u = db.get(models.User, uid)
            utenti[uid] = u.name if u else None
        return utenti[uid]

    def project_of_task(t):
        return t.pin.plan.project_id if t.pin is not None else t.project_id

    def project_of_sub(s):
        return auth.project_of_submission(s)

    per_cantiere = {pid: {"task_aperti": 0, "nc_aperte": 0} for pid in ids}
    for t in tasks:
        per_cantiere[project_of_task(t)]["task_aperti"] += 1
    for s, _, _ in nc:
        per_cantiere[project_of_sub(s)]["nc_aperte"] += 1
    return {
        "commessa": {"id": c.id, "code": c.code, "name": c.name, "client": c.client, "url": f"{web_url()}/projects"},
        "cantieri": [{"id": p.id, "name": p.name, "address": p.address, "url": f"{web_url()}/projects/{p.id}/tasks",
                      **per_cantiere[p.id]} for p in c.projects],
        "task": [{"id": t.id, "title": t.title, "status": t.status.value, "assigned_to_name": nome_utente(t.assigned_to),
                  "due_date": t.due_date.isoformat() if t.due_date else None, "created_at": t.created_at.isoformat() if t.created_at else None,
                  "project_id": project_of_task(t), "project_name": nomi.get(project_of_task(t)),
                  "plan_name": t.pin.plan.name if t.pin is not None else None, "pin_label": t.pin.label if t.pin is not None else None,
                  "url": _pin_url(t.pin, project_of_task(t))} for t in tasks],
        "nc": [{"id": s.id, "template_name": tpl.name if tpl else None, "field_label": nc_["label"], "value": nc_["value"],
                "created_at": s.created_at.isoformat() if s.created_at else None, "submitted_by_name": nome_utente(s.submitted_by),
                "project_id": project_of_sub(s), "project_name": nomi.get(project_of_sub(s)),
                "plan_name": s.pin.plan.name if s.pin is not None else None, "pin_label": s.pin.label if s.pin is not None else None,
                "url": _pin_url(s.pin, project_of_sub(s))} for s, tpl, nc_ in nc],
    }


class TaskSuiteIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=4000)
    project_id: Optional[str] = None       # cantiere; se manca e la commessa ne ha uno solo, quello


@router.post("/suite/commesse/{codice}/task", status_code=201, dependencies=[Depends(richiede_token)], include_in_schema=False)
def suite_crea_task(codice: str, payload: TaskSuiteIn, request: Request, db: Session = Depends(get_db),
                    x_suite_utente: Optional[str] = Header(default=None), x_suite_nome: Optional[str] = Header(default=None)):
    """Apre un task sul cantiere (es. dal Magazzino: mezzo fermo). Attribuito all'utente InCampo con la stessa
    email del portale, se c'è; altrimenti resta senza autore e lo dice nella descrizione."""
    c = _commessa_per_codice(db, codice)
    if payload.project_id:
        project = next((p for p in c.projects if p.id == payload.project_id), None)
        if project is None:
            raise HTTPException(404, "Cantiere non trovato in questa commessa")
    elif len(c.projects) == 1:
        project = c.projects[0]
    elif not c.projects:
        raise HTTPException(409, f"La commessa {c.code} non ha cantieri in InCampo")
    else:
        raise HTTPException(422, "Più cantieri nella commessa: indicare project_id")
    autore = _utente_suite(db, x_suite_utente)
    descrizione = payload.description or ""
    if autore is None:
        chi = x_suite_nome or x_suite_utente or "un'altra app della suite"
        descrizione = (descrizione + f"\n\nSegnalato da {chi} (Magazzino Operativo)").strip()
    task = models.Task(project_id=project.id, title=payload.title.strip(), description=descrizione or None,
                       status=TaskStatus.open, created_by=autore.id if autore else None)
    db.add(task)
    db.flush()
    events.record_task_created(db, task, project.id, autore.id if autore else None)
    audit.record(db, "task.created", autore, entity_type="task", entity_id=task.id, project_id=project.id, request=request,
                 details={"title": task.title, "origine": "suite", "utente_portale": x_suite_utente},
                 actor_email=None if autore else x_suite_utente)
    db.commit()
    db.refresh(task)
    return {"id": task.id, "title": task.title, "status": task.status.value, "project_id": project.id,
            "project_name": project.name, "url": f"{web_url()}/projects/{project.id}/tasks"}


# --------------------------------------------------------------------------- verso il Magazzino

def _commessa_del_cantiere(db: Session, user: models.User, project_id: str) -> tuple[models.Project, models.Commessa]:
    project = auth.assert_project_access(db, user, project_id)
    if project.commessa is None:
        raise HTTPException(409, "Il cantiere non è collegato a una commessa: assegnala dalla barra delle commesse")
    return project, project.commessa


@router.get("/projects/{project_id}/magazzino")
def magazzino_del_cantiere(project_id: str, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    """Materiale e mezzi presenti nelle ubicazioni del Magazzino con il codice di questa commessa."""
    project, commessa = _commessa_del_cantiere(db, user, project_id)
    d = _chiama("magazzino", "GET", f"/suite/commesse/{commessa.code}/giacenze", user)
    d["commessa_code"] = commessa.code
    d["magazzino_url"] = suite_link.url_pubblico("magazzino")
    return d


# --------------------------------------------------------------------------- verso SkyTower

@router.get("/projects/{project_id}/skytower/documenti")
def documenti_skytower(project_id: str, q: Optional[str] = None, area: str = "PUBLISHED", db: Session = Depends(get_db),
                       user: models.User = Depends(current_user)):
    """Documenti (tavole) della commessa su SkyTower; di default solo quelli pubblicati."""
    _, commessa = _commessa_del_cantiere(db, user, project_id)
    return _chiama("skytower", "GET", f"/suite/commesse/{commessa.code}/documenti", user, parametri={"q": q or "", "area": area})


class PlanDaSkyTowerIn(BaseModel):
    project_id: str
    revision_id: str
    name: str = Field(min_length=1, max_length=200)


@router.post("/plans/da-skytower", response_model=schemas.PlanOut, status_code=201)
def planimetria_da_skytower(payload: PlanDaSkyTowerIn, request: Request, db: Session = Depends(get_db),
                            user: models.User = Depends(require_role(UserRole.manager))):
    """Scarica da SkyTower la revisione scelta (PDF o immagine) e la rende una planimetria del cantiere,
    con la stessa pipeline del caricamento a mano (PDF → PNG prima pagina)."""
    project, _ = _commessa_del_cantiere(db, user, payload.project_id)
    try:
        dati, tipo = suite_link.chiama("skytower", "GET", f"/suite/revisioni/{payload.revision_id}/file", utente=user.email,
                                       nome=user.name, grezzo=True, timeout=120)
    except suite_link.SuiteError as e:
        raise HTTPException(e.stato if e.stato in (403, 404, 409, 503) else 502, e.messaggio)
    if len(dati) > st.MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"Il file di SkyTower supera i {st.MAX_UPLOAD_BYTES // (1024 * 1024)} MB")
    mime = st.sniff_mime(dati)
    if mime not in st.ALLOWED_MIME:
        raise HTTPException(415, f"Formato non adatto a una planimetria ({tipo or 'sconosciuto'}): servono PDF, PNG o JPG")
    if mime == "application/pdf":
        try:
            dati = st.pdf_first_page_to_png(dati)
        except Exception:
            raise HTTPException(422, "PDF di SkyTower non convertibile in immagine")
        ext = "png"
    else:
        ext = st.ALLOWED_MIME[mime]
    try:
        w, h = st.image_size(dati)
    except Exception:
        raise HTTPException(422, "immagine non leggibile")
    plan = models.Plan(project_id=project.id, name=payload.name.strip())
    db.add(plan)
    db.flush()
    plan.file_url = st.storage.save(f"plans/{plan.id}.{ext}", dati)
    plan.width_px, plan.height_px = float(w), float(h)
    audit.record(db, "plan.file_uploaded", user, entity_type="plan", entity_id=plan.id, project_id=project.id, request=request,
                 details={"name": plan.name, "mime": mime, "bytes": len(dati), "size": [w, h], "origine": "skytower",
                          "revision_id": payload.revision_id})
    db.commit()
    db.refresh(plan)
    return plan


class InvioSkyTowerIn(BaseModel):
    title: Optional[str] = Field(default=None, max_length=300)
    description: Optional[str] = Field(default=None, max_length=4000)


@router.post("/submissions/{submission_id}/skytower", status_code=201)
def modulo_su_skytower(submission_id: str, payload: InvioSkyTowerIn, request: Request, db: Session = Depends(get_db),
                       user: models.User = Depends(current_user)):
    """Il PDF del modulo compilato (ispezione, non conformità) diventa un documento della commessa su SkyTower."""
    sub = db.get(models.FormSubmission, submission_id)
    if sub is None or sub.deleted_at is not None:
        raise HTTPException(404, "submission not found")
    project_id = auth.project_of_submission(sub)
    project, commessa = _commessa_del_cantiere(db, user, project_id)
    template = db.get(models.FormTemplate, sub.template_id)
    dati = pdf.build_submission_pdf(db, sub, template)
    nc = events.find_non_conformity(template.schema_def or {}, sub.data_json or {}) if template else None
    titolo = (payload.title or f"{'NC ' if nc else ''}{template.name if template else 'Modulo'} {project.name} {sub.created_at:%d-%m-%Y}").strip()[:300]
    descr = payload.description or (f"Modulo InCampo compilato il {sub.created_at:%d/%m/%Y %H:%M}"
                                    + (f" — non conformità: {nc['label']} = {nc['value']}" if nc else ""))
    r = _chiama("skytower", "POST", f"/suite/commesse/{commessa.code}/documenti", user,
                parametri={"title": titolo, "description": descr, "tipo": "RP",
                           "attributes": json.dumps({"origine": "incampo", "submission_id": sub.id, "project_id": project.id,
                                                     "non_conformita": bool(nc)})},
                corpo_file=(dati, "application/pdf",
                            f"incampo-{(template.name if template else 'modulo').lower().replace(' ', '-')[:40]}-{sub.id[:8]}.pdf"),
                timeout=120)
    audit.record(db, "submission.updated", user, entity_type="submission", entity_id=sub.id, project_id=project.id, request=request,
                 details={"skytower": r.get("identifier"), "revision": r.get("revision_code")})
    db.commit()
    return r
