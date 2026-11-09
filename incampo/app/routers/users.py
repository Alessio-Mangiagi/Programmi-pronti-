# "><(((º> sabusabu <º)))><"
"""Login (con blocco anti brute force), profilo, token push, notifiche, eventi e utenti."""
import os
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models, schemas, auth, audit
from ..auth import current_user, require_role
from ..database import get_db
from ..models import utcnow, UserRole

router = APIRouter()


# ---------- Auth e utenti ----------

# Anti brute force: tentativi falliti recenti contati sull'audit log (vale con più
# worker/processi). Limite per email+IP (IP = ultima voce di X-Forwarded-For, quella
# del nostro proxy) e, più largo, per sola email: chi cambia IP davvero (botnet) resta
# limitato per account. Il blocco scade da solo con la finestra.
LOGIN_WINDOW = timedelta(minutes=int(os.getenv("LOGIN_LOCKOUT_MINUTES", "15")))
LOGIN_MAX_FAILS_PER_IP = int(os.getenv("LOGIN_MAX_FAILS_PER_IP", "5"))
LOGIN_MAX_FAILS_PER_EMAIL = int(os.getenv("LOGIN_MAX_FAILS_PER_EMAIL", "20"))


def _login_locked(db: Session, email: str, request: Request) -> bool:
    ip, _ = audit._client_info(request)
    recent = db.query(func.count(models.AuditLog.id)).filter(
        models.AuditLog.action == "auth.login_failed", models.AuditLog.actor_email == email,
        models.AuditLog.created_at >= utcnow() - LOGIN_WINDOW)
    if recent.scalar() >= LOGIN_MAX_FAILS_PER_EMAIL:
        return True
    return recent.filter(models.AuditLog.ip == ip).scalar() >= LOGIN_MAX_FAILS_PER_IP


@router.post("/auth/login", response_model=schemas.TokenResponse)
def login(payload: schemas.LoginRequest, request: Request, db: Session = Depends(get_db)):
    email = payload.email.lower().strip()
    if _login_locked(db, email, request):
        raise HTTPException(429, "Troppi tentativi falliti: riprova tra qualche minuto")
    user = db.query(models.User).filter(models.User.email == email).first()
    if user is None or not user.is_active or not auth.verify_password(payload.password, user.password_hash):
        # Non è la password di InCampo: può essere quella del portale (una password per tutti i
        # programmi). Se il portale la riconosce si entra senza contare un errore.
        from .suite import login_con_password_portale
        dal_portale = login_con_password_portale(db, email, payload.password, request)
        if dal_portale is not None:
            return schemas.TokenResponse(access_token=auth.create_access_token(dal_portale), user=dal_portale)
        # Traccia anche i tentativi falliti (email tentata, IP): utile per capire abusi e lockout.
        audit.record(db, "auth.login_failed", actor_email=email, request=request,
                     details={"reason": "inactive" if user is not None and not user.is_active else "invalid"})
        db.commit()
        raise HTTPException(401, "Email o password errati")
    audit.record(db, "auth.login", user, entity_type="user", entity_id=user.id, request=request)
    db.commit()
    return schemas.TokenResponse(access_token=auth.create_access_token(user), user=user)


@router.get("/auth/me", response_model=schemas.UserOut)
def me(request: Request, user: models.User = Depends(current_user), db: Session = Depends(get_db)):
    """L'utente del token. Il web la chiama a ogni apertura: se l'utente non è admin ma il browser ha la sessione
    del portale (cookie ``sid``) di un amministratore del portale che corrisponde a QUESTO utente, lo promuove ad
    admin (regola della suite del 09/11/2026, suite.allinea_admin_dal_portale). Così vale subito anche per chi
    aveva già un token salvato e non ripassa da /auth/portale. Una sola chiamata al portale, solo per i non admin."""
    if user.role != UserRole.admin and "sid=" in (request.headers.get("cookie") or ""):
        from .suite import _utente_esistente_dal_portale, allinea_admin_dal_portale, verifica_portale
        dati = verifica_portale(request.headers.get("cookie") or "")
        if dati["ok"] and dati.get("ruolo") == "admin":
            stesso = _utente_esistente_dal_portale(db, dati)
            if stesso is not None and stesso.id == user.id and allinea_admin_dal_portale(db, user, dati, request):
                db.commit()
                db.refresh(user)
    return user


@router.post("/auth/me/password", status_code=204)
def change_my_password(payload: schemas.PasswordChange, request: Request, db: Session = Depends(get_db),
                       user: models.User = Depends(current_user)):
    """L'utente collegato cambia la sua password di InCampo (prima poteva solo l'admin, da Utenti).

    Serve la password attuale: con un token rubato non si prende l'account. Gli errori contano come
    tentativi di login falliti (stesso blocco anti brute force di /auth/login: 429 quando scatta) e
    rispondono 400, non 401, per non far scadere la sessione nel web. La nuova password segue
    PASSWORD_MIN e deve essere diversa dall'attuale. Chi entra solo con la password del portale (utente
    creato dal portale, password InCampo casuale) non conosce quella attuale: per lui vale quella del portale.
    """
    if _login_locked(db, user.email, request):
        raise HTTPException(429, "Troppi tentativi falliti: riprova tra qualche minuto")
    if not auth.verify_password(payload.current_password, user.password_hash):
        audit.record(db, "auth.login_failed", actor_email=user.email, request=request,
                     details={"reason": "password_change"})
        db.commit()
        raise HTTPException(400, "Password attuale errata")
    if payload.new_password == payload.current_password:
        raise HTTPException(422, "La nuova password deve essere diversa da quella attuale")
    user.password_hash = auth.hash_password(payload.new_password)
    user.updated_at = utcnow()
    audit.record(db, "user.password_changed", user, entity_type="user", entity_id=user.id, request=request,
                 details={"email": user.email})
    db.commit()


@router.patch("/auth/me/preferences", response_model=schemas.UserOut)
def update_preferences(payload: schemas.PreferencesUpdate, db: Session = Depends(get_db),
                       user: models.User = Depends(current_user)):
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(user, k, v)
    db.commit()
    db.refresh(user)
    return user


@router.post("/auth/me/push-token", status_code=204)
def register_push_token(payload: schemas.PushTokenIn, db: Session = Depends(get_db),
                        user: models.User = Depends(current_user)):
    """L'app registra il token Expo Push del device (idempotente; un token cambia utente se serve)."""
    row = db.get(models.PushToken, payload.token)
    if row is None:
        db.add(models.PushToken(token=payload.token, user_id=user.id, platform=payload.platform))
    else:
        # voluto: il token Expo identifica il device, e su un tablet condiviso in cantiere le notifiche
        # devono seguire chi ha fatto login per ultimo (la revisione del 03/11 lo segnala come rischio basso:
        # per dirottarlo servirebbe conoscere il token del device di un collega)
        row.user_id, row.platform, row.last_seen_at = user.id, payload.platform or row.platform, utcnow()
    db.commit()


@router.delete("/auth/me/push-token/{token}", status_code=204)
def unregister_push_token(token: str, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    db.query(models.PushToken).filter(models.PushToken.token == token, models.PushToken.user_id == user.id).delete()
    db.commit()


@router.get("/auth/me/notifications", response_model=list[schemas.NotificationOut])
def my_notifications(limit: int = 50, db: Session = Depends(get_db), user: models.User = Depends(current_user)):
    """Le mie notifiche (più recenti prima), con l'evento che le ha generate."""
    return (db.query(models.Notification).filter(models.Notification.user_id == user.id)
            .order_by(models.Notification.created_at.desc()).limit(min(limit, 200)).all())


@router.get("/projects/{project_id}/events", response_model=list[schemas.EventOut])
def list_events(project_id: str, limit: int = 100, db: Session = Depends(get_db),
                user: models.User = Depends(require_role(UserRole.manager))):
    """Registro eventi del progetto (manager): cosa è successo e quando."""
    auth.assert_project_access(db, user, project_id)
    return (db.query(models.Event).filter(models.Event.project_id == project_id)
            .order_by(models.Event.created_at.desc()).limit(min(limit, 500)).all())


@router.post("/users", response_model=schemas.UserOut, status_code=201)
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


@router.get("/users", response_model=list[schemas.UserOut])
def list_users(include_inactive: bool = False, db: Session = Depends(get_db),
               user: models.User = Depends(current_user)):
    """Elenco utenti attivi: serve a chiunque per assegnare un task. Con `include_inactive` (solo admin) anche i disattivati."""
    q = db.query(models.User)
    if include_inactive:
        if user.role != UserRole.admin:
            raise HTTPException(403, "requires role admin")
    else:
        q = q.filter(models.User.is_active.is_(True))
    if user.role == UserRole.field:
        # chi lavora in campo vede solo i colleghi dei propri cantieri: l'elenco completo delle email
        # servirebbe solo a chi vuole fare phishing o tentativi di login
        miei = db.query(models.ProjectMember.project_id).filter_by(user_id=user.id).subquery()
        colleghi = db.query(models.ProjectMember.user_id).filter(models.ProjectMember.project_id.in_(miei))
        q = q.filter(models.User.id.in_(colleghi))
    return q.order_by(models.User.name).all()


@router.patch("/users/{user_id}", response_model=schemas.UserOut)
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
