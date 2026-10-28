# "><(((º> sabusabu <º)))><"
"""Avvisi di sicurezza via email all'utente: password cambiata o reimpostata, secondo fattore aggiunto, rimosso
o azzerato dall'admin, accesso da un dispositivo mai visto. Servono a far accorgere la persona di un'azione
che non ha fatto lei. Best effort: un errore del servizio email non blocca l'operazione (finisce nel log).
"""
from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime

log = logging.getLogger("cde.alerts")

TEXTS = {
    "it": {
        "password_changed": ("La password del CDE è stata cambiata", "la password del tuo account è stata cambiata"),
        "password_reset": ("La password del CDE è stata reimpostata", "la password del tuo account è stata reimpostata con il link via email"),
        "mfa_added": ("Nuovo secondo fattore sul CDE", "è stato aggiunto un secondo fattore ({detail})"),
        "mfa_removed": ("Secondo fattore rimosso dal CDE", "è stato rimosso un secondo fattore ({detail})"),
        "mfa_reset": ("Secondo fattore azzerato sul CDE", "un amministratore della tua organizzazione ({detail}) ha azzerato il tuo secondo fattore: al prossimo accesso andrà configurato di nuovo"),
        "new_device": ("Nuovo accesso al CDE", "è stato fatto un accesso da un dispositivo che non avevi mai usato ({detail})"),
        "_body": ("Ciao {name},\n\n{what} il {when} (IP {ip}).\n\nSe sei stato tu non serve fare nulla. Se non lo riconosci, "
                  "cambia subito la password e chiudi le sessioni sconosciute da {url}/sicurezza, poi avvisa "
                  "l'amministratore della tua organizzazione.\n\n— CDE ISO 19650"),
    },
    "en": {
        "password_changed": ("Your CDE password was changed", "your account password was changed"),
        "password_reset": ("Your CDE password was reset", "your account password was reset with the email link"),
        "mfa_added": ("New second factor on the CDE", "a second factor was added ({detail})"),
        "mfa_removed": ("Second factor removed from the CDE", "a second factor was removed ({detail})"),
        "mfa_reset": ("Second factor reset on the CDE", "an administrator of your organization ({detail}) reset your second factor: set it up again at your next sign-in"),
        "new_device": ("New sign-in to the CDE", "someone signed in from a device you had never used ({detail})"),
        "_body": ("Hello {name},\n\n{what} on {when} (IP {ip}).\n\nIf it was you, there is nothing to do. If you do not recognise it, "
                  "change your password right away and close unknown sessions at {url}/sicurezza, then tell your "
                  "organization's administrator.\n\n— CDE ISO 19650"),
    },
}


def send(svc, conn, user_id: uuid.UUID, kind: str, *, ip: str | None = None, detail: str = "") -> None:
    try:
        user = conn.execute("SELECT email, first_name, locale FROM cde.users WHERE id = %s", [user_id]).fetchone()
        if user is None:
            return
        t = TEXTS.get(user["locale"] or "it", TEXTS["it"])
        subject, what = t[kind]
        what = what.format(detail=detail or "-")
        body = t["_body"].format(name=user["first_name"], what=what[0].upper() + what[1:],
                                 when=datetime.now(UTC).strftime("%d/%m/%Y %H:%M UTC"), ip=ip or "n/d",
                                 url=svc.settings.web_base_url.rstrip("/"))
        svc.mailer.send(user["email"], subject, body)
    except Exception:                       # noqa: BLE001 - l'avviso non deve mai far fallire l'operazione
        log.exception("avviso di sicurezza %s non inviato a %s", kind, user_id)


def device_label(user_agent: str | None) -> str:
    ua = user_agent or ""
    browser = next((b for k, b in (("Edg/", "Edge"), ("Firefox/", "Firefox"), ("Chrome/", "Chrome"), ("Safari/", "Safari"))
                    if k in ua), "browser")
    os_ = next((o for k, o in (("Windows", "Windows"), ("iPhone", "iOS"), ("iPad", "iOS"), ("Android", "Android"),
                               ("Mac OS X", "macOS"), ("Linux", "Linux")) if k in ua), "")
    return f"{browser} · {os_}" if os_ else browser
