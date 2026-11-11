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
    # prima il collegamento stabile col portale (users.portale_username, dall'11/11/2026)
    collegato = db.query(models.User).filter(models.User.portale_username == u, models.User.is_active.is_(True)).first()
    if collegato is not None:
        return collegato
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


# Utente del portale e utente InCampo (regola della suite dell'11/11/2026: "il profilo del portale vale in ogni
# programma"; scelte dell'utente 2b 3b 4a e "gli admin li creo e li cancello solo io"):
# - l'account InCampo di una persona del portale è collegato al suo username (users.portale_username);
# - nome ed email seguono il portale a ogni ingresso;
# - amministratore = ruolo admin nel portale, DATO E TOLTO a ogni ingresso (la regola IP del portale non basta);
# - gli altri ruoli (manager, field) restano decisi in InCampo;
# - disattivato o InCampo tolto nel portale → niente login, controllato SOLO al login (scelta 2b: il JWT da 12 h
#   non richiede il portale a ogni richiesta);
# - la password di InCampo resta valida (scelta 3b), ma anche lei passa dal controllo del portale;
# - dare o togliere l'amministratore dentro InCampo: solo il proprietario della suite (oggi a.mangiagi).
# Contratto delle rotte del portale: shared/suite/CONTRATTI.md.

MSG_SOLO_PROPRIETARIO = "Solo il proprietario della suite gestisce gli amministratori"


def _ruolo_predefinito_portale() -> UserRole:
    """Ruolo di chi arriva dal portale senza essere admin (INCAMPO_RUOLO_PORTALE, default manager; mai admin)."""
    try:
        ruolo = UserRole((os.environ.get("INCAMPO_RUOLO_PORTALE") or "manager").strip().lower())
    except ValueError:
        return UserRole.manager
    return UserRole.manager if ruolo == UserRole.admin else ruolo


def _utente_esistente_dal_portale(db: Session, dati: dict) -> Optional[models.User]:
    """L'utente InCampo già esistente dell'utente del portale, o None.

    Prima il collegamento stabile (``portale_username``), poi, per chi non è ancora collegato, come prima
    dell'11/11: email uguale, oppure parte prima della @ = username fra le email del dominio della suite. Un
    account già collegato a un ALTRO utente del portale non si aggancia mai (sarebbe un'altra persona)."""
    username = dati["username"]
    user = db.query(models.User).filter(models.User.portale_username == username).first()
    if user is not None:
        return user
    email = dati["email"]
    user = db.query(models.User).filter(models.User.email == email).first()
    if user is not None:
        return user if user.portale_username in (None, username) else None
    # ripiego sullo username solo fra le email del dominio della suite e mai su un admin: altrimenti un
    # utente del portale chiamato come la parte locale di un account admin (es. della demo) entrerebbe
    # come quell'admin senza password (revisione di sicurezza del 03/11/2026)
    for u in db.query(models.User).filter(models.User.portale_username.is_(None)).all():
        em = (u.email or "").lower()
        if em.endswith("@" + EMAIL_DOMINIO) and em.split("@")[0] == username and u.role != UserRole.admin:
            return u
    return None


def allinea_admin_dal_portale(db: Session, user: models.User, dati: dict, request: Request) -> bool:
    """Amministratore di InCampo = ruolo ``admin`` nel portale, nei due sensi (regola dell'11/11/2026).

    Vale solo per un account COLLEGATO a quell'utente del portale (``portale_username``): gli account solo di
    InCampo non si toccano. Promozione: il ruolo di prima va in ``ruolo_prima_admin``; quando il portale toglie
    l'admin l'account riprende quel ruolo (o INCAMPO_RUOLO_PORTALE se è nato admin dal portale). L'admin per
    l'app concesso da una regola IP del portale (``admin`` vero ma ``ruolo`` utente) non conta: il ruolo
    resterebbe anche lontano da quel PC. Registro: ``user.updated`` con origine ``admin-del-portale`` o
    ``admin-tolto-dal-portale``. Non fa commit: lo fa chi chiama. True se ha cambiato il ruolo."""
    if not user.is_active or not user.portale_username or user.portale_username != dati.get("username"):
        return False
    admin_portale = dati.get("ruolo") == "admin"
    prima = user.role
    if admin_portale and user.role != UserRole.admin:
        user.ruolo_prima_admin = user.role.value
        user.role = UserRole.admin
        origine = "admin-del-portale"
    elif not admin_portale and user.role == UserRole.admin:
        try:
            ripreso = UserRole(user.ruolo_prima_admin) if user.ruolo_prima_admin else _ruolo_predefinito_portale()
        except ValueError:
            ripreso = _ruolo_predefinito_portale()
        user.role = UserRole.manager if ripreso == UserRole.admin else ripreso
        user.ruolo_prima_admin = None
        origine = "admin-tolto-dal-portale"
    else:
        return False
    user.updated_at = utcnow()
    audit.record(db, "user.updated", user, entity_type="user", entity_id=user.id, request=request,
                 details={"email": user.email, "role": {"da": prima.value, "a": user.role.value}, "origine": origine,
                          "utente_portale": dati.get("username")})
    return True


def allinea_profilo_dal_portale(db: Session, user: models.User, dati: dict, request: Request) -> bool:
    """Il profilo del portale (``dati``: username, nome, email, ruolo) vale per l'account InCampo ``user``.

    1. collega l'account allo username del portale se non lo è (solo se nessun altro account lo è già);
    2. nome ed email come nel portale: un'email già usata da un altro account InCampo non si prende (resta
       quella di prima, scritto nel registro);
    3. amministratore come nel portale (allinea_admin_dal_portale).
    Non fa commit. True se è cambiato qualcosa."""
    username = dati.get("username")
    if not username:
        return False
    cambiato = False
    if not user.portale_username:
        altro = db.query(models.User).filter(models.User.portale_username == username).first()
        if altro is not None and altro.id != user.id:
            return False          # quell'utente del portale ha già il suo account InCampo: questo resta com'è
        user.portale_username = username
        cambiato = True
    elif user.portale_username != username:
        return False
    modifiche: dict = {}
    nome = (dati.get("nome") or "").strip()
    if nome and nome != user.name:
        modifiche["name"] = {"from": user.name, "to": nome}
        user.name = nome
    email = (dati.get("email") or "").strip().lower()
    if email and email != user.email:
        occupata = db.query(models.User).filter(models.User.email == email, models.User.id != user.id).first()
        if occupata is None:
            modifiche["email_cambiata"] = {"from": user.email, "to": email}
            user.email = email
        else:
            modifiche["email_non_aggiornata"] = {"portale": email, "motivo": "già usata da un altro utente InCampo"}
    if modifiche:
        user.updated_at = utcnow()
        audit.record(db, "user.updated", user, entity_type="user", entity_id=user.id, request=request,
                     details={"email": user.email, **modifiche, "origine": "profilo-del-portale",
                              "utente_portale": username})
        cambiato = True
    return allinea_admin_dal_portale(db, user, dati, request) or cambiato


def _utente_dal_portale(db: Session, dati: dict) -> tuple[models.User, bool]:
    """L'utente InCampo dell'utente del portale (vedi _utente_esistente_dal_portale); se non c'è lo crea attivo,
    collegato allo username del portale, senza password usabile. Admin solo se il RUOLO nel portale è admin
    (la regola IP del portale non basta, come per la promozione). Ritorna (utente, creato).
    409 se l'email del portale è già di un account InCampo collegato a un altro utente del portale."""
    email = dati["email"]
    username = dati["username"]
    user = _utente_esistente_dal_portale(db, dati)
    if user is not None:
        return user, False
    if db.query(models.User).filter(models.User.email == email).first() is not None:
        raise HTTPException(409, f"L'email {email} è già di un altro utente del portale in InCampo: "
                                 "chiedi all'amministratore di sistemare l'email nel Portale")
    predefinito = _ruolo_predefinito_portale()
    admin = dati.get("ruolo") == "admin"
    user = models.User(email=email, name=dati.get("nome") or username, role=UserRole.admin if admin else predefinito,
                       ruolo_prima_admin=predefinito.value if admin else None, portale_username=username,
                       password_hash=auth.hash_password(secrets.token_urlsafe(32)))
    db.add(user)
    db.flush()
    return user, True


def _entra_dal_portale(db: Session, dati: dict, request: Request, origine: str) -> models.User:
    """Parte comune di /auth/portale e del login con la password del portale: trova o crea l'utente, applica il
    profilo del portale, scrive il registro e fa commit. 401 se l'utente InCampo è disattivato."""
    user, creato = _utente_dal_portale(db, dati)
    if not user.is_active:
        raise HTTPException(401, "Utente InCampo disattivato")
    if creato:
        audit.record(db, "user.created", user, entity_type="user", entity_id=user.id, request=request,
                     details={"email": user.email, "role": user.role.value, "origine": origine,
                              "utente_portale": dati["username"]})
    else:
        allinea_profilo_dal_portale(db, user, dati, request)
    audit.record(db, "auth.login", user, entity_type="user", entity_id=user.id, request=request,
                 details={"origine": origine, "utente_portale": dati["username"]})
    db.commit()
    db.refresh(user)
    return user


def profilo_portale(login: str, timeout: float = 3) -> dict:
    """Il profilo del portale di ``login`` (username o email), chiesto dal server con il token della suite:
    ``POST <portale>/api/suite/profilo`` {login, app: "incampo"} (contratto: shared/suite/CONTRATTI.md).

    Non solleva mai. Ritorna sempre ``raggiungibile`` (False: portale spento, token rifiutato, risposta strana,
    COSEDIL_SSO=off) ed ``errore``; se raggiungibile anche ``trovato`` e, se trovato, username, nome, email,
    ruolo, admin, proprietario, disattivato, mustChange, abilitato (a InCampo)."""
    esito = {"raggiungibile": False, "trovato": False, "errore": ""}
    if not SSO_ATTIVO:
        esito["errore"] = "Verifica col portale spenta (COSEDIL_SSO=off)"
        return esito
    corpo = json.dumps({"login": login or "", "app": "incampo"}).encode("utf-8")
    req = urllib.request.Request(PORTALE + "/api/suite/profilo", data=corpo, method="POST",
                                 headers={"Content-Type": "application/json", "Accept": "application/json",
                                          "X-Suite-Token": suite_link.token()})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            dati = json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        esito["errore"] = ("Il portale ha rifiutato il token della suite" if e.code == 403
                           else f"Il portale ha risposto {e.code}")
        return esito
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        esito["errore"] = "Portale non raggiungibile"
        return esito
    if not isinstance(dati, dict) or not dati.get("ok"):
        esito["errore"] = "Risposta del portale non valida"
        return esito
    esito["raggiungibile"] = True
    if not dati.get("trovato") or not str(dati.get("username") or "").strip():
        return esito
    username = str(dati["username"]).strip().lower()
    esito.update(trovato=True, username=username, nome=str(dati.get("nome") or username).strip(),
                 email=str(dati.get("email") or "").strip().lower() or f"{username}@{EMAIL_DOMINIO}",
                 ruolo=dati.get("ruolo"), admin=bool(dati.get("admin")), proprietario=bool(dati.get("proprietario")),
                 disattivato=bool(dati.get("disattivato")), mustChange=bool(dati.get("mustChange")),
                 abilitato=bool(dati.get("abilitato")))
    return esito


def controlla_login_locale(db: Session, user: models.User, request: Request) -> Optional[dict]:
    """Login con la password DI INCAMPO (web e app per telefono, POST /auth/login): il portale dice ancora sì?

    Scelte dell'utente dell'11/11/2026: 3b (la password di InCampo resta valida) e 2b (il portale si controlla
    al login, non a ogni richiesta). Si chiede il profilo per lo username collegato, o per l'email se l'account
    non è ancora collegato:
    - account del portale disattivato o InCampo non fra i suoi programmi → 403 col motivo (e tentativo fallito
      nel registro, così conta per il blocco anti brute force);
    - account collegato il cui utente del portale non esiste più → 403 (la persona è stata tolta dal portale);
    - trovato e attivo → collegamento, nome, email e amministratore come nel portale;
    - nessun utente del portale (account solo di InCampo) → si entra come prima;
    - portale irraggiungibile → si entra lo stesso (la password di InCampo serve proprio quando il portale è
      giù), e il registro lo dice.
    Ritorna i dettagli da scrivere nel registro dell'accesso (o None). Non fa commit, tranne prima di un 403."""
    if not SSO_ATTIVO:
        return None
    p = profilo_portale(user.portale_username or user.email)
    if not p["raggiungibile"]:
        return {"portale": "non verificato", "motivo": p["errore"] or "Portale non raggiungibile"}
    motivo = None
    if not p["trovato"]:
        if not user.portale_username:
            return None
        motivo = "Il tuo utente del Portale non esiste più: rivolgiti a un amministratore"
    elif p["disattivato"]:
        motivo = "Il tuo account del Portale è disattivato: rivolgiti a un amministratore"
    elif not p["abilitato"]:
        motivo = "InCampo non è fra i tuoi programmi del Portale: chiedi l'abilitazione a un amministratore"
    if motivo:
        audit.record(db, "auth.login_failed", actor_email=user.email, request=request,
                     details={"reason": "portale", "motivo": motivo,
                              "utente_portale": p.get("username") or user.portale_username})
        db.commit()
        raise HTTPException(403, motivo)
    allinea_profilo_dal_portale(db, user, p, request)
    return {"origine": "password-incampo", "utente_portale": p["username"]}


def verifica_proprietario(user: models.User) -> tuple[bool, str]:
    """Chi agisce è il proprietario della suite? Chiesto al portale DAL VIVO (mai dal ruolo salvato qui).

    Serve un account InCampo collegato al portale il cui utente sia attivo e ``proprietario``. Portale
    irraggiungibile → no (non si dà o toglie un amministratore senza poterlo verificare). Con COSEDIL_SSO=off
    (InCampo installato senza portale) vale la regola di prima: ogni admin. Ritorna (sì/no, motivo del no)."""
    if not SSO_ATTIVO:
        return user.role == UserRole.admin, ""
    if not user.portale_username:
        return False, MSG_SOLO_PROPRIETARIO + ": il tuo utente InCampo non è collegato al Portale"
    p = profilo_portale(user.portale_username)
    if not p["raggiungibile"]:
        return False, MSG_SOLO_PROPRIETARIO + ": portale non raggiungibile, non posso verificarlo (riprova più tardi)"
    if not p["trovato"] or p["disattivato"] or not p["proprietario"]:
        return False, MSG_SOLO_PROPRIETARIO
    return True, ""


def richiedi_proprietario(user: models.User) -> None:
    """403 se chi agisce non è il proprietario della suite (vedi verifica_proprietario)."""
    ok, motivo = verifica_proprietario(user)
    if not ok:
        raise HTTPException(403, motivo or MSG_SOLO_PROPRIETARIO)


def login_con_password_portale(db: Session, email: str, password: str, request: Request) -> Optional[models.User]:
    """Login con email e **password del portale** (POST /auth/login, anche dall'app per telefono).

    La chiama /auth/login solo quando la password di InCampo non coincide: quella resta valida
    come riserva, ma a ogni persona basta la password del portale (scelta del 06/11/2026).
    Il portale controlla la password con i suoi blocchi sui tentativi, sull'IP della persona,
    e dice se InCampo è fra i suoi programmi. L'utente InCampo è lo stesso dell'ingresso dal
    portale (_utente_dal_portale: collegato per username; creato se manca) e ne prende il profilo.

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
    dati = {"username": str(v["username"]).strip().lower(), "nome": (v["nome"] or v["username"]).strip(),
            "ruolo": v["ruolo"], "admin": v["admin"],
            "email": (v["email"] or f"{v['username']}@{EMAIL_DOMINIO}").strip().lower()}
    return _entra_dal_portale(db, dati, request, "password-portale")


@router.post("/auth/portale", response_model=schemas.TokenResponse, responses={401: {"description": "Non collegato al portale"}})
def login_dal_portale(request: Request, db: Session = Depends(get_db)):
    """Entra con la sessione del Portale Suite Cosedil (cookie ``sid``), senza altra password.

    L'utente InCampo è quello collegato allo username del portale (la prima volta: stessa email o
    username prima della @); se manca viene creato: ruolo admin nel portale → admin, altrimenti
    ``INCAMPO_RUOLO_PORTALE`` (default manager). Nome, email e amministratore seguono il portale a ogni
    ingresso (allinea_profilo_dal_portale). Disattivato o InCampo non abilitato nel portale: /api/verify
    risponde 401/403 e qui 401. 401 anche se il portale non risponde, non si è loggati o lo SSO è spento.
    """
    dati = verifica_portale(request.headers.get("cookie") or "")
    if not dati["ok"]:
        raise HTTPException(401, dati["errore"])
    user = _entra_dal_portale(db, dati, request, "portale")
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
