# "><(((º> sabusabu <º)))><"
"""
Invio di email dal programma (report Excel richiesto dall'interfaccia, email di prova).

REPORT_SEND_METHOD:
  smtp   server SMTP con TLS e certificato verificato (SMTP_HOST, SMTP_PORT, SMTP_SECURITY, SMTP_USER, SMTP_PASSWORD)
  graph  Microsoft 365, con la stessa app Azure della posta in arrivo: serve anche il permesso applicativo
         Mail.Send, limitato alla sola casella mittente (Application Access Policy / RBAC for Applications)
Mittente: REPORT_FROM (se vuoto: SMTP_USER oppure GRAPH_MAILBOX).
"""

import base64
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from urllib.parse import quote

import requests

import env_config

GRAPH_MAX_ATTACHMENT = 3 * 1024 * 1024  # sendMail di Graph accetta allegati fino a 3 MB


def sender_address(s):
    if s.get("REPORT_FROM"):
        return s["REPORT_FROM"]
    return s.get("GRAPH_MAILBOX") if s.get("REPORT_SEND_METHOD") == "graph" else s.get("SMTP_USER")


def send_problems(s):
    """Cosa manca per poter inviare email: lista vuota se e' tutto pronto."""
    problems = []
    if not s.get("ADMIN_EMAIL"):
        problems.append("indirizzo email dell'amministratore (ADMIN_EMAIL) non impostato")
    if s.get("REPORT_SEND_METHOD") == "graph":
        missing = [k for k in ("GRAPH_TENANT_ID", "GRAPH_CLIENT_ID", "GRAPH_CLIENT_SECRET") if not s.get(k)]
        if missing:
            problems.append("Microsoft 365: mancano " + ", ".join(missing))
    elif not s.get("SMTP_HOST"):
        problems.append("server SMTP (SMTP_HOST) non impostato")
    if not sender_address(s) or not env_config.EMAIL_RE.match(sender_address(s) or ""):
        problems.append("indirizzo del mittente (REPORT_FROM) non impostato o non valido")
    return problems


def check_recipient(address, s):
    """Indirizzo scritto dall'utente: uno solo, valido e, se impostato, in un dominio ammesso."""
    address = (address or "").strip()
    if not env_config.EMAIL_RE.match(address) or len(address) > 254:
        raise ValueError("Indirizzo email non valido")
    domains = [d.strip().lower().lstrip("@") for d in (s.get("REPORT_EMAIL_DOMAINS") or "").split(",") if d.strip()]
    if domains and address.lower().rsplit("@", 1)[1] not in domains:
        raise ValueError(f"Si puo' inviare solo a indirizzi {', '.join('@' + d for d in domains)}")
    return address


def send(s, to, subject, body, attachments=()):
    """to: lista di indirizzi; attachments: [(nome, bytes, mime)]."""
    problems = send_problems(s)
    if problems:
        raise ValueError("Invio email non configurato: " + "; ".join(problems))
    to = list(dict.fromkeys(a.strip() for a in to if a and a.strip()))  # senza doppioni, ordine mantenuto
    if s.get("REPORT_SEND_METHOD") == "graph":
        _send_graph(s, to, subject, body, attachments)
    else:
        _send_smtp(s, to, subject, body, attachments)


def _send_smtp(s, to, subject, body, attachments):
    msg = EmailMessage()
    msg["From"] = sender_address(s)
    msg["To"] = ", ".join(to)
    msg["Subject"] = subject
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid()
    msg.set_content(body)
    for name, data, mime in attachments:
        maintype, subtype = mime.split("/", 1)
        msg.add_attachment(data, maintype=maintype, subtype=subtype, filename=name)
    context = ssl.create_default_context()  # certificato del server verificato
    port = int(s.get("SMTP_PORT") or 587)
    if s.get("SMTP_SECURITY") == "ssl":
        conn = smtplib.SMTP_SSL(s["SMTP_HOST"], port, context=context, timeout=60)
    else:
        conn = smtplib.SMTP(s["SMTP_HOST"], port, timeout=60)
    with conn:
        if s.get("SMTP_SECURITY") != "ssl":
            conn.starttls(context=context)  # mai credenziali in chiaro: se il server non offre TLS, errore
        if s.get("SMTP_USER"):
            conn.login(s["SMTP_USER"], s.get("SMTP_PASSWORD", ""))
        conn.send_message(msg)


def _send_graph(s, to, subject, body, attachments):
    r = requests.post(
        f"https://login.microsoftonline.com/{quote(s['GRAPH_TENANT_ID'])}/oauth2/v2.0/token",
        data={"grant_type": "client_credentials", "client_id": s["GRAPH_CLIENT_ID"],
              "client_secret": s["GRAPH_CLIENT_SECRET"], "scope": "https://graph.microsoft.com/.default"},
        timeout=60,
    )
    if not r.ok:
        raise RuntimeError(f"accesso a Microsoft 365 non riuscito ({r.status_code})")
    token = r.json()["access_token"]
    files = []
    for name, data, mime in attachments:
        if len(data) > GRAPH_MAX_ATTACHMENT:
            raise ValueError("Report oltre 3 MB: sceglierne uno su un periodo piu' breve")
        files.append({"@odata.type": "#microsoft.graph.fileAttachment", "name": name, "contentType": mime,
                      "contentBytes": base64.b64encode(data).decode()})
    message = {
        "subject": subject,
        "body": {"contentType": "Text", "content": body},
        "toRecipients": [{"emailAddress": {"address": a}} for a in to],
        "attachments": files,
    }
    r = requests.post(f"https://graph.microsoft.com/v1.0/users/{quote(sender_address(s), safe='@')}/sendMail",
                      headers={"Authorization": f"Bearer {token}"}, json={"message": message, "saveToSentItems": True},
                      timeout=120)
    if r.status_code != 202:
        try:
            err = r.json().get("error", {}).get("message", "")
        except ValueError:
            err = r.text[:200]
        raise RuntimeError(f"invio con Microsoft 365 non riuscito ({r.status_code}): {err}")
