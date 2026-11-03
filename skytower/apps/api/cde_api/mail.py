# "><(((º> sabusabu <º)))><"
"""Invio email: console (dev/test, conserva i messaggi in memoria), SMTP (server aziendale, ADR-46) o Amazon SES.

Chi manda le email è sempre lo stesso codice (inviti, reset password, avvisi di sicurezza, notifiche dei
workflow, riepiloghi): qui si decide solo *come* escono. La scelta sta in ``Settings.mailer``:

* ``console``: niente invio, il messaggio va nel log e in ``outbox`` (i test leggono da lì);
* ``smtp``: server SMTP dell'azienda o del provider (``smtp_host``…), STARTTLS di default;
* ``ses``: Amazon SES, solo con l'infrastruttura AWS.

Un invio fallito non deve mai far fallire l'operazione che lo ha causato (un invito resta valido anche
se la posta è giù): ``SmtpMailer.send`` registra l'errore e non lo rilancia.
"""
from __future__ import annotations

import logging
import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formatdate, make_msgid

from .config import Settings

log = logging.getLogger("cde.mail")


@dataclass
class Mail:
    to: str
    subject: str
    body: str


class ConsoleMailer:
    def __init__(self):
        self.outbox: list[Mail] = []

    def send(self, to: str, subject: str, body: str) -> None:
        self.outbox.append(Mail(to, subject, body))
        log.info("EMAIL a %s — %s\n%s", to, subject, body)


def _messaggio(sender: str, to: str, subject: str, body: str) -> EmailMessage:
    """Messaggio di testo semplice con Date e Message-ID, che alcuni server esigono per non scartarlo."""
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = sender, to, subject
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid()
    msg.set_content(body)
    return msg


class SmtpMailer:
    """Invio tramite un server SMTP (ADR-46).

    Modalità, da ``smtp_security``: ``starttls`` (porta 587, connessione in chiaro poi cifrata: il default),
    ``ssl`` (porta 465, TLS dall'inizio) o ``none`` (porta 25 in LAN, solo verso un relay interno).
    Utente e password sono facoltativi: molti relay aziendali autenticano per indirizzo IP.
    Ogni invio apre e chiude una connessione: pochi messaggi al giorno, nessun vantaggio a tenerla aperta.
    """

    def __init__(self, settings: Settings):
        self.sender = settings.mail_from
        self.host = settings.smtp_host
        self.port = settings.smtp_port
        self.user = settings.smtp_user
        self.password = settings.smtp_password
        self.security = settings.smtp_security
        self.timeout = settings.smtp_timeout_seconds
        if not self.host:
            raise RuntimeError("CDE_MAILER=smtp richiede CDE_SMTP_HOST")

    def _connessione(self) -> smtplib.SMTP:
        """Apre la connessione nel modo scelto; ``ssl.create_default_context`` verifica il certificato del server."""
        if self.security == "ssl":
            return smtplib.SMTP_SSL(self.host, self.port, timeout=self.timeout, context=ssl.create_default_context())
        smtp = smtplib.SMTP(self.host, self.port, timeout=self.timeout)
        if self.security == "starttls":
            smtp.starttls(context=ssl.create_default_context())
        return smtp

    def send(self, to: str, subject: str, body: str) -> None:
        msg = _messaggio(self.sender, to, subject, body)
        try:
            with self._connessione() as smtp:
                if self.user:
                    smtp.login(self.user, self.password or "")
                smtp.send_message(msg)
            log.info("EMAIL inviata a %s — %s", to, subject)
        except (smtplib.SMTPException, OSError) as exc:
            # la posta non deve bloccare inviti, reset e approvazioni: si registra e si va avanti;
            # il corpo non finisce nel log (può contenere link di reset o di invito)
            log.error("EMAIL a %s non inviata (%s): %s", to, subject, exc)


class SesMailer:  # pragma: no cover - richiede AWS
    def __init__(self, settings: Settings):
        import boto3

        self.sender = settings.mail_from
        self.ses = boto3.client("sesv2", region_name=settings.aws_region)

    def send(self, to: str, subject: str, body: str) -> None:
        msg = _messaggio(self.sender, to, subject, body)
        self.ses.send_email(Content={"Raw": {"Data": msg.as_bytes()}})


def build_mailer(settings: Settings):
    """Il mailer scelto in ``Settings.mailer``; un valore sconosciuto è un errore di configurazione, non un default."""
    if settings.mailer == "ses":
        return SesMailer(settings)
    if settings.mailer == "smtp":
        return SmtpMailer(settings)
    if settings.mailer == "console":
        return ConsoleMailer()
    raise RuntimeError(f"CDE_MAILER={settings.mailer!r} sconosciuto: console, smtp o ses")
