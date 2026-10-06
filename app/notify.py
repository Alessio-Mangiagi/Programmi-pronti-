"""
Invio delle notifiche pendenti (email SMTP, push Expo).

`process_pending(db, email, push)` prende le `notifications` in stato pending,
compone il testo dall'evento (template in italiano con link diretto al task/pin
sul web) e le consegna; ogni riga finisce `sent` o `failed` con l'errore, e
l'evento riceve `processed_at` quando non ha più consegne in sospeso.

I sender sono oggetti con `send(...)`: SMTP ed Expo per davvero, console in
sviluppo (nessun SMTP configurato), finti nei test.

Configurazione (.env): SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASSWORD,
SMTP_FROM, SMTP_TLS (1), WEB_URL (base dei link, es. https://fieldview.example),
EXPO_PUSH_URL (default https://exp.host/--/api/v2/push/send), EXPO_ACCESS_TOKEN (opzionale).
"""
import json
import logging
import os
import smtplib
import urllib.request
from dataclasses import dataclass
from email.message import EmailMessage
from typing import Optional, Protocol

from sqlalchemy.orm import Session

from . import models
from .models import utcnow

log = logging.getLogger("fieldview.notify")

WEB_URL = os.getenv("WEB_URL", "http://localhost:8000").rstrip("/")

TYPE_LABEL = {
    "task.assigned": "Task assegnato a te",
    "task.status_changed": "Task risolto",
    "submission.created": "Non conformità rilevata",
    "task.created": "Nuovo task",
    "support.message": "Segnalazione all'amministratore",
}


@dataclass
class Message:
    subject: str
    body: str
    url: Optional[str]


def render(db: Session, n: models.Notification) -> Message:
    """Testo della notifica a partire dall'evento (payload) e dall'entità collegata."""
    ev = n.event
    p = ev.payload or {}
    actor = db.get(models.User, ev.actor_id) if ev.actor_id else None
    who = actor.name if actor else "Qualcuno"
    project = db.get(models.Project, ev.project_id) if ev.project_id else None
    pname = project.name if project else ev.project_id
    if ev.type == "support.message":
        where = f" dal cantiere {pname}" if project else ""
        page = f"\nPagina: {p['page']}" if p.get("page") else ""
        email = f" ({actor.email})" if actor else ""
        url = f"{WEB_URL}/admin/segnalazioni"
        body = f"{who}{email} ha scritto all'amministratore{where}:\n\n{p.get('message', '')}{page}\n\nApri: {url}"
        return Message(f"Segnalazione da {who}", body, url)
    url = _entity_url(db, ev)
    if ev.type == "task.assigned":
        subject = f"[{pname}] Task assegnato: {p.get('title')}"
        body = f"{who} ti ha assegnato il task \"{p.get('title')}\" nel progetto {pname}."
    elif ev.type == "task.status_changed":
        subject = f"[{pname}] Task {p.get('to')}: {p.get('title')}"
        body = f"{who} ha portato il task \"{p.get('title')}\" da {p.get('from')} a {p.get('to')}."
    elif ev.type == "submission.created":
        nc = p.get("non_conformity") or {}
        subject = f"[{pname}] {nc.get('value', 'Non conformità')} — {p.get('template_name') or 'modulo'}"
        body = (f"{who} ha compilato \"{p.get('template_name') or 'un modulo'}\" con esito "
                f"\"{nc.get('value', 'non conforme')}\" ({nc.get('label', '')}) nel progetto {pname}.")
    else:
        subject = f"[{pname}] {TYPE_LABEL.get(ev.type, ev.type)}"
        body = f"{who}: {ev.type}"
    if url:
        body += f"\n\nApri: {url}"
    return Message(subject, body, url)


def _entity_url(db: Session, ev: models.Event) -> Optional[str]:
    """Link diretto sul web: plan view con il pin selezionato (task o modulo)."""
    pin = None
    if ev.entity_type == "task":
        t = db.get(models.Task, ev.entity_id)
        pin = t.pin if t else None
    elif ev.entity_type == "submission":
        s = db.get(models.FormSubmission, ev.entity_id)
        if s is not None and s.wbs_node_id:
            return f"{WEB_URL}/projects/{ev.project_id}/wbs?node={s.wbs_node_id}"
        pin = s.pin if s else None
    if pin is None:
        return f"{WEB_URL}/projects/{ev.project_id}/plans"
    return f"{WEB_URL}/projects/{ev.project_id}/plans/{pin.plan_id}?pin={pin.id}"


# ---------- Sender ----------

class EmailSender(Protocol):
    def send(self, to: str, subject: str, body: str) -> None: ...


class PushSender(Protocol):
    def send(self, tokens: list[str], title: str, body: str, data: dict) -> list[str]:
        """Ritorna i token risultati invalidi (da rimuovere)."""
        ...


class ConsoleEmailSender:
    """Sviluppo senza SMTP: stampa nel log e considera inviato."""
    def send(self, to: str, subject: str, body: str) -> None:
        log.info("EMAIL a %s | %s\n%s", to, subject, body)


class SmtpEmailSender:
    def __init__(self, host: str, port: int, user: Optional[str], password: Optional[str], sender: str, tls: bool = True):
        self.host, self.port, self.user, self.password, self.sender, self.tls = host, port, user, password, sender, tls

    def send(self, to: str, subject: str, body: str) -> None:
        msg = EmailMessage()
        msg["From"], msg["To"], msg["Subject"] = self.sender, to, subject
        msg.set_content(body)
        with smtplib.SMTP(self.host, self.port, timeout=20) as smtp:
            if self.tls:
                smtp.starttls()
            if self.user:
                smtp.login(self.user, self.password or "")
            smtp.send_message(msg)


class ExpoPushSender:
    """Expo Push API: un POST con la lista dei messaggi; DeviceNotRegistered = token da eliminare."""
    def __init__(self, url: str = "https://exp.host/--/api/v2/push/send", access_token: Optional[str] = None):
        self.url, self.access_token = url, access_token

    def send(self, tokens: list[str], title: str, body: str, data: dict) -> list[str]:
        if not tokens:
            return []
        payload = [{"to": t, "title": title, "body": body, "data": data, "sound": "default"} for t in tokens]
        req = urllib.request.Request(self.url, data=json.dumps(payload).encode(), method="POST",
                                     headers={"Content-Type": "application/json", "Accept": "application/json",
                                              **({"Authorization": f"Bearer {self.access_token}"} if self.access_token else {})})
        with urllib.request.urlopen(req, timeout=20) as resp:
            out = json.loads(resp.read().decode())
        invalid = []
        for token, ticket in zip(tokens, out.get("data", [])):
            if ticket.get("status") == "error":
                if (ticket.get("details") or {}).get("error") == "DeviceNotRegistered":
                    invalid.append(token)
                else:
                    raise RuntimeError(ticket.get("message") or "push error")
        return invalid


class NoPushSender:
    def send(self, tokens: list[str], title: str, body: str, data: dict) -> list[str]:
        log.info("PUSH a %d device | %s", len(tokens), title)
        return []


def senders_from_env() -> tuple[EmailSender, PushSender]:
    host = os.getenv("SMTP_HOST")
    email: EmailSender = (SmtpEmailSender(host, int(os.getenv("SMTP_PORT", "587")), os.getenv("SMTP_USER"),
                                          os.getenv("SMTP_PASSWORD"), os.getenv("SMTP_FROM", "incampo@localhost"),
                                          os.getenv("SMTP_TLS", "1") == "1")
                          if host else ConsoleEmailSender())
    push_url = os.getenv("EXPO_PUSH_URL", "https://exp.host/--/api/v2/push/send")  # "" = disattivato
    push: PushSender = ExpoPushSender(push_url, os.getenv("EXPO_ACCESS_TOKEN")) if push_url else NoPushSender()
    return email, push


# ---------- Worker ----------

def process_pending(db: Session, email: EmailSender, push: PushSender, batch: int = 50) -> dict:
    """Invia le notifiche pending (le più vecchie prima). Ritorna i conteggi."""
    out = {"sent": 0, "failed": 0}
    rows = (db.query(models.Notification).filter(models.Notification.status == "pending")
            .order_by(models.Notification.created_at).limit(batch).all())
    for n in rows:
        try:
            msg = render(db, n)
            user = n.user
            if n.channel == "email":
                email.send(user.email, msg.subject, msg.body)
            elif n.channel == "push":
                tokens = [t.token for t in db.query(models.PushToken).filter(models.PushToken.user_id == user.id).all()]
                if not tokens:
                    raise RuntimeError("no push token")
                invalid = push.send(tokens, msg.subject, msg.body.split("\n")[0], {"url": msg.url, "event": n.event.type})
                for t in invalid:
                    db.query(models.PushToken).filter(models.PushToken.token == t).delete()
                if invalid and len(invalid) == len(tokens):
                    raise RuntimeError("all push tokens invalid")
            else:
                raise RuntimeError(f"unknown channel {n.channel}")
            n.status, n.sent_at, n.error = "sent", utcnow(), None
            out["sent"] += 1
        except Exception as e:  # una consegna fallita non blocca le altre
            n.status, n.error = "failed", str(e)[:500]
            out["failed"] += 1
        pending_left = any(x.status == "pending" for x in n.event.notifications if x is not n)
        if not pending_left:
            n.event.processed_at = utcnow()
        db.commit()
    # eventi senza notifiche: chiusi subito
    for ev in db.query(models.Event).filter(models.Event.processed_at.is_(None)).limit(batch).all():
        if not any(x.status == "pending" for x in ev.notifications):
            ev.processed_at = utcnow()
    db.commit()
    return out
