# "><(((º> sabusabu <º)))><"
"""Invio email: console (dev/test, conserva i messaggi in memoria) o Amazon SES."""
from __future__ import annotations

import logging
from dataclasses import dataclass
from email.message import EmailMessage

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


class SesMailer:  # pragma: no cover - richiede AWS
    def __init__(self, settings: Settings):
        import boto3

        self.sender = settings.mail_from
        self.ses = boto3.client("sesv2", region_name=settings.aws_region)

    def send(self, to: str, subject: str, body: str) -> None:
        msg = EmailMessage()
        msg["From"], msg["To"], msg["Subject"] = self.sender, to, subject
        msg.set_content(body)
        self.ses.send_email(Content={"Raw": {"Data": msg.as_bytes()}})


def build_mailer(settings: Settings):
    return SesMailer(settings) if settings.mailer == "ses" else ConsoleMailer()
