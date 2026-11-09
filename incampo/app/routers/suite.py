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
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import timedelta
from pathlib import Path
from typing import Optional
from urllib.parse import quote

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

# Modulo SSO condiviso: qui serve solo verifica_password (password del portale al login).
_SSO = Path(__file__).resolve().parents[3] / "shared" / "sso"
if str(_SSO) not in sys.path:
    sys.path.insert(0, str(_SSO))
import cosedil_sso  # noqa: E402

router = APIRouter()
APERTI = (TaskStatus.open, TaskStatus.assigned)

# Portale della suite: stesso default di shared/sso/cosedil_sso.py.
PORTALE = (os.environ.get("COSEDIL_PORTAL") or "http://localhost:8080").rstrip("/")
SSO_ATTIVO = (os.environ.get("COSEDIL_SSO") or "").strip().lower() != "off"
EMAIL_DOMINIO = (os.environ.get("SUITE_EMAIL_DOMINIO") or "cosedilspa.com").strip().lstrip("@")


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
        # la parte prima della @ vale solo per le email del dominio della suite: altrimenti uno username del
        # portale uguale alla parte locale di un altro account (demo, admin di un altro dominio) lo aggancerebbe
        if email == u or (email.endswith("@" + EMAIL_DOMINIO) and email.split("@")[0] == u):
            return user
    return None


def richiede_token(x_suite_token: Optional[str] = Header(default=None)):
    if not suite_link.verifica(x_suite_token):
        raise HTTPException(403, "Token di servizio della suite non valido")


# --------------------------------------------------------------------------- login automatico dal portale

def verifica_portale(cookie: str) -> dict:
    """Chiede al portale chi è l'utente del cookie ``sid`` (``/api/verify?app=incampo``).

    Come ``cosedil_sso.verifica_sessione`` ma tiene anche l'``email`` che il portale manda
    (quella impostata dall'admin, altrimenti username@SUITE_EMAIL_DOMINIO). Ritorna sempre un
    dict: ``ok`` False con ``errore`` spiegato (portale spento, non loggato, app non abilitata).
    """
    esito = {"ok": False, "errore": "Non sei collegato al portale", "username": None, "nome": None,
             "ruolo": None, "admin": False, "email": None}
    if not SSO_ATTIVO:
        esito["errore"] = "Accesso dal portale disattivato (COSEDIL_SSO=off)"
        return esito
    if not cookie or "sid=" not in cookie:
        return esito
    req = urllib.request.Request(PORTALE + "/api/verify?" + urllib.parse.urlencode({"app": "incampo"}),
                                 headers={"Cookie": cookie, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=2) as resp:
            dati = json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        esito["errore"] = "InCampo non è abilitato per il tuo utente del portale" if e.code == 403 else "Non sei collegato al portale"
        return esito
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        esito["errore"] = "Portale non raggiungibile"
        return esito
    username = str(dati.get("username") or "").strip().lower()
    if not dati.get("ok") or not username:
        return esito
    email = str(dati.get("email") or "").strip().lower() or f"{username}@{EMAIL_DOMINIO}"
    esito.update(ok=True, errore="", username=username, nome=(dati.get("nome") or username).strip(),
                 ruolo=dati.get("ruolo"), admin=bool(dati.get("admin")), email=email)
    return esito


def _utente_esistente_dal_portale(db: Session, dati: dict) -> Optional[models.User]:
    """L'utente InCampo già esistente dell'utente del portale (email, poi parte prima della @ = username), o None."""
    email = dati["email"]
    username = dati["username"]
    user = db.query(models.User).filter(models.User.email == email).first()
    if user is None:
        # ripiego sullo username solo fra le email del dominio della suite e mai su un admin: altrimenti un
        # utente del portale chiamato come la parte locale di un account admin (es. della demo) entrerebbe
        # come quell'admin senza password (revisione di sicurezza del 03/11/2026)
        for u in db.query(models.User).all():
            em = (u.email or "").lower()
            if em.endswith("@" + EMAIL_DOMINIO) and em.split("@")[0] == username and u.role != UserRole.admin:
                user = u
                break
    return user


def allinea_admin_dal_portale(db: Session, user: models.User, dati: dict, request: Request) -> bool:
    """Amministratore del portale = admin anche in InCampo (regola della suite del 09/11/2026: "le mie
    credenziali valgono come admin ovunque"). Prima il ruolo dal portale valeva solo alla creazione dell'utente;
    ora a ogni ingresso dal portale (cookie, password del portale, apertura del web con /auth/me) un utente
    attivo il cui ruolo nel portale è ``admin`` diventa admin qui, con evento ``user.updated`` nel registro.

    Solo promozione: chi non è più admin nel portale non perde il ruolo (lo cambia un admin da Utenti), e
    l'admin per l'app concesso da una regola IP del portale (``admin`` vero ma ``ruolo`` utente) non basta,
    perché il ruolo resterebbe anche lontano da quel PC. Non fa commit: lo fa chi chiama. True se ha promosso."""
    if dati.get("ruolo") != "admin" or not user.is_active or user.role == UserRole.admin:
        return False
    prima = user.role.value
    user.role = UserRole.admin
    user.updated_at = utcnow()
    audit.record(db, "user.updated", user, entity_type="user", entity_id=user.id, request=request,
                 details={"email": user.email, "role": {"da": prima, "a": "admin"}, "origine": "admin-del-portale",
                          "utente_portale": dati.get("username")})
    return True


def _utente_dal_portale(db: Session, dati: dict) -> tuple[models.User, bool]:
    """L'utente InCampo dell'utente del portale (vedi _utente_esistente_dal_portale);
    se non c'è lo crea attivo, senza password usabile. Ritorna (utente, creato)."""
    email = dati["email"]
    username = dati["username"]
    user = _utente_esistente_dal_portale(db, dati)
    if user is not None:
        return user, False
    if dati.get("admin") or dati.get("ruolo") == "admin":
        ruolo = UserRole.admin
    else:
        try:
            ruolo = UserRole((os.environ.get("INCAMPO_RUOLO_PORTALE") or "manager").strip().lower())
        except ValueError:
            ruolo = UserRole.manager
    user = models.User(email=email, name=dati.get("nome") or username, role=ruolo,
                       password_hash=auth.hash_password(secrets.token_urlsafe(32)))
    db.add(user)
    db.flush()
    return user, True


def login_con_password_portale(db: Session, email: str, password: str, request: Request) -> Optional[models.User]:
    """Login con email e **password del portale** (POST /auth/login, anche dall'app per telefono).

    La chiama /auth/login solo quando la password di InCampo non coincide: quella resta valida
    come riserva, ma a ogni persona basta la password del portale (scelta del 06/11/2026).
    Il portale controlla la password con i suoi blocchi sui tentativi, sull'IP della persona,
    e dice se InCampo è fra i suoi programmi. L'utente InCampo è lo stesso dell'ingresso dal
    portale (_utente_dal_portale: stessa email; creato se manca).

    Ritorna l'utente, oppure None se il portale dice "credenziali non valide" o non risponde:
    allora /auth/login conta il tentativo fallito come prima. Solleva 429 se il portale ha
    bloccato i tentativi, 403 se la password è giusta ma l'accesso no (account disattivato,
    password temporanea da cambiare, InCampo non abilitato), 401 se l'utente InCampo è spento.
    """
    ip, _ = audit._client_info(request)
    v = cosedil_sso.verifica_password(email, password, "incampo", ip=ip)
    if not v["ok"]:
        if v["status"] == 429:
            raise HTTPException(429, v["errore"] or "Troppi tentativi falliti: riprova tra qualche minuto")
        if v["status"] == 403:
            raise HTTPException(403, v["errore"] or "Accesso non consentito dal portale")
        return None
    dati = {"username": v["username"], "nome": (v["nome"] or v["username"]).strip(), "ruolo": v["ruolo"],
            "admin": v["admin"], "email": v["email"] or f"{v['username']}@{EMAIL_DOMINIO}"}
    user, creato = _utente_dal_portale(db, dati)
    if not user.is_active:
        raise HTTPException(401, "Utente InCampo disattivato")
    if not creato:
        allinea_admin_dal_portale(db, user, dati, request)
    if creato:
        audit.record(db, "user.created", user, entity_type="user", entity_id=user.id, request=request,
                     details={"email": user.email, "role": user.role.value, "origine": "password-portale",
                              "utente_portale": dati["username"]})
    audit.record(db, "auth.login", user, entity_type="user", entity_id=user.id, request=request,
                 details={"origine": "password-portale", "utente_portale": dati["username"]})
    db.commit()
    db.refresh(user)
    return user


@router.post("/auth/portale", response_model=schemas.TokenResponse, responses={401: {"description": "Non collegato al portale"}})
def login_dal_portale(request: Request, db: Session = Depends(get_db)):
    """Entra con la sessione del Portale Suite Cosedil (cookie ``sid``), senza altra password.

    L'utente InCampo è quello con la stessa email del portale (o lo username prima della @);
    se manca viene creato: admin del portale → admin, altrimenti ``INCAMPO_RUOLO_PORTALE``
    (default manager); se c'è e nel portale è amministratore diventa admin (allinea_admin_dal_portale).
    401 se il portale non risponde, non si è loggati o lo SSO è spento.
    """
    dati = verifica_portale(request.headers.get("cookie") or "")
    if not dati["ok"]:
        raise HTTPException(401, dati["errore"])
    user, creato = _utente_dal_portale(db, dati)
    if not user.is_active:
        raise HTTPException(401, "Utente InCampo disattivato")
    if not creato:
        allinea_admin_dal_portale(db, user, dati, request)
    if creato:
        audit.record(db, "user.created", user, entity_type="user", entity_id=user.id, request=request,
                     details={"email": user.email, "role": user.role.value, "origine": "portale", "utente_portale": dati["username"]})
    audit.record(db, "auth.login", user, entity_type="user", entity_id=user.id, request=request,
                 details={"origine": "portale", "utente_portale": dati["username"]})
    db.commit()
    db.refresh(user)
    return schemas.TokenResponse(access_token=auth.create_access_token(user), user=user)


def _chiama(app_id: str, metodo: str, percorso: str, user: models.User, **kw):
    try:
        return suite_link.chiama(app_id, metodo, percorso, utente=user.email, nome=user.name, **kw)
    except suite_link.SuiteError as e:
        raise HTTPException(e.stato if e.stato in (400, 403, 404, 422, 409, 503) else 502, e.messaggio)


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


def _utente_suite_completo(db: Session, email: Optional[str], utente: Optional[str]) -> Optional[models.User]:
    """Email del portale prima (X-Suite-Email), poi username (X-Suite-Utente) come in _utente_suite."""
    if email:
        u = db.query(models.User).filter(models.User.email == email.strip().lower(), models.User.is_active.is_(True)).first()
        if u is not None:
            return u
    return _utente_suite(db, utente)


@router.get("/suite/da-fare", dependencies=[Depends(richiede_token)], include_in_schema=False)
def suite_da_fare(admin: int = 0, db: Session = Depends(get_db),
                  x_suite_utente: Optional[str] = Header(default=None), x_suite_email: Optional[str] = Header(default=None)):
    """Cosa aspetta l'utente del portale qui: i task assegnati a lui ancora aperti (scaduti prima) e,
    se è manager/admin, le non conformità aperte dei suoi cantieri. Per la home del portale."""
    user = _utente_suite_completo(db, x_suite_email, x_suite_utente)
    if user is None:
        return {"voci": []}
    oggi = utcnow()
    nomi = {}

    def nome_cantiere(pid):
        if pid not in nomi:
            p = db.get(models.Project, pid) if pid else None
            nomi[pid] = p.name if p else ""
        return nomi[pid]

    def project_of_task(t):
        return t.pin.plan.project_id if t.pin is not None else t.project_id

    voci = []
    miei = (db.query(models.Task).filter(models.Task.assigned_to == user.id, models.Task.deleted_at.is_(None),
                                        models.Task.status.in_(APERTI))
            .options(selectinload(models.Task.pin).selectinload(models.Pin.plan)).all())
    for t in miei:
        pid = project_of_task(t)
        scaduto = bool(t.due_date and t.due_date < oggi)
        pezzi = [nome_cantiere(pid)]
        if t.pin is not None and t.pin.label:
            pezzi.append(t.pin.label)
        if t.due_date:
            pezzi.append(("scaduto il " if scaduto else "scade il ") + t.due_date.strftime("%d/%m"))
        voci.append({"id": f"task:{t.id}", "titolo": t.title, "testo": " · ".join(p for p in pezzi if p),
                     "url": _pin_url(t.pin, pid), "tipo": "task", "priorita": 1 if scaduto else 2,
                     "data": t.due_date.date().isoformat() if t.due_date else None,
                     "_ordine": (0 if scaduto else 1, t.due_date or oggi)})
    if auth.is_manager(user):
        ids = auth.accessible_project_ids(db, user)
        if ids is None:   # admin: tutti i cantieri
            ids = [r[0] for r in db.query(models.Project.id).all()]
        for s, tpl, nc in _nc_aperte(db, list(ids)):
            pid = auth.project_of_submission(s)
            voci.append({"id": f"nc:{s.id}", "titolo": f"NC: {nc['label']} = {nc['value']}",
                         "testo": " · ".join(p for p in (nome_cantiere(pid), tpl.name if tpl else None,
                                                        s.created_at.strftime("%d/%m") if s.created_at else None) if p),
                         "url": _pin_url(s.pin, pid), "tipo": "nc", "priorita": 2,
                         "data": s.created_at.date().isoformat() if s.created_at else None,
                         "_ordine": (1, s.created_at or oggi)})
    voci.sort(key=lambda v: v["_ordine"])
    for v in voci:
        v.pop("_ordine", None)
    return {"voci": voci[:50]}


# --------------------------------------------------------------------------- verso il Magazzino

def _commessa_del_cantiere(db: Session, user: models.User, project_id: str) -> tuple[models.Project, models.Commessa]:
    project = auth.assert_project_access(db, user, project_id)
    if project.commessa is None:
        raise HTTPException(409, "Il cantiere non è collegato a una commessa: assegnala dalla barra delle commesse")
    return project, project.commessa


@router.get("/projects/{project_id}/magazzino")
def magazzino_del_cantiere(project_id: str, request: Request, db: Session = Depends(get_db),
                           user: models.User = Depends(current_user)):
    """Materiale e mezzi presenti nelle ubicazioni del Magazzino con il codice di questa commessa."""
    project, commessa = _commessa_del_cantiere(db, user, project_id)
    d = _chiama("magazzino", "GET", f"/suite/commesse/{quote(commessa.code, safe='')}/giacenze", user)
    d["commessa_code"] = commessa.code
    # link "Apri nel Magazzino" con l'host con cui il browser usa InCampo: il cookie del portale vale per l'host,
    # e un link "localhost" visto da http://127.0.0.1:5190 (o da un altro PC) farebbe ricomparire il login
    d["magazzino_url"] = suite_link.url_pubblico("magazzino", host=request.headers.get("host"))
    return d


# --------------------------------------------------------------------------- verso SkyTower

@router.get("/projects/{project_id}/skytower/documenti")
def documenti_skytower(project_id: str, q: Optional[str] = None, area: str = "PUBLISHED", db: Session = Depends(get_db),
                       user: models.User = Depends(current_user)):
    """Documenti (tavole) della commessa su SkyTower; di default solo quelli pubblicati."""
    _, commessa = _commessa_del_cantiere(db, user, project_id)
    return _chiama("skytower", "GET", f"/suite/commesse/{quote(commessa.code, safe='')}/documenti", user,
                   parametri={"q": q or "", "area": area})


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
    r = _chiama("skytower", "POST", f"/suite/commesse/{quote(commessa.code, safe='')}/documenti", user,
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
