# "><(((º> sabusabu <º)))><"
"""Invio email via SMTP e chiavi su file in produzione (ADR-46).

Il server SMTP è finto: si sostituisce ``smtplib.SMTP``/``SMTP_SSL`` con una classe che registra ciò che
l'API farebbe (connessione, STARTTLS, login, messaggio), così si prova la logica senza rete.
"""
from __future__ import annotations

import os
import smtplib
import stat
from pathlib import Path
from typing import ClassVar

import pytest

from cde_api import mail
from cde_api.config import Settings
from cde_api.security import kms as kms_mod


class SmtpFinto:
    """Registra le chiamate di SmtpMailer; ``errore`` fa fallire l'invio come farebbe un server giù."""

    istanze: ClassVar[list[SmtpFinto]] = []
    errore: ClassVar[Exception | None] = None

    def __init__(self, host, port, timeout=None, context=None):
        self.host, self.port, self.timeout, self.context = host, port, timeout, context
        self.starttls_fatto = False
        self.login_fatto: tuple[str, str] | None = None
        self.inviati: list = []
        SmtpFinto.istanze.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def starttls(self, context=None):
        self.starttls_fatto = True
        self.context = context

    def login(self, user, password):
        self.login_fatto = (user, password)

    def send_message(self, msg):
        if SmtpFinto.errore:
            raise SmtpFinto.errore
        self.inviati.append(msg)


@pytest.fixture
def smtp_finto(monkeypatch):
    SmtpFinto.istanze.clear()
    SmtpFinto.errore = None
    monkeypatch.setattr(smtplib, "SMTP", SmtpFinto)
    monkeypatch.setattr(smtplib, "SMTP_SSL", SmtpFinto)
    return SmtpFinto


def _settings(**kw) -> Settings:
    base = {"mailer": "smtp", "smtp_host": "posta.cosedilspa.com", "mail_from": "SkyTower <no-reply@cosedilspa.com>"}
    base.update(kw)
    return Settings(**base)


def test_smtp_starttls_login_e_messaggio(smtp_finto):
    m = mail.build_mailer(_settings(smtp_user="skytower", smtp_password="segreta"))
    assert isinstance(m, mail.SmtpMailer)
    m.send("marta.colombo@cosedilspa.com", "Invito a SkyTower", "Clicca qui: https://skytower/invito/abc")
    (s,) = smtp_finto.istanze
    assert (s.host, s.port) == ("posta.cosedilspa.com", 587)
    assert s.starttls_fatto and s.context is not None, "STARTTLS con verifica del certificato"
    assert s.login_fatto == ("skytower", "segreta")
    (msg,) = s.inviati
    assert msg["To"] == "marta.colombo@cosedilspa.com" and msg["Subject"] == "Invito a SkyTower"
    assert msg["From"] == "SkyTower <no-reply@cosedilspa.com>" and msg["Message-ID"] and msg["Date"]
    assert "https://skytower/invito/abc" in msg.get_content()


def test_smtp_ssl_e_relay_senza_credenziali(smtp_finto):
    m = mail.build_mailer(_settings(smtp_security="ssl", smtp_port=465))
    m.send("a@b.it", "x", "y")
    (s,) = smtp_finto.istanze
    assert s.port == 465 and s.context is not None and not s.starttls_fatto
    assert s.login_fatto is None, "senza utente non si tenta il login"
    m = mail.build_mailer(_settings(smtp_security="none", smtp_port=25))
    m.send("a@b.it", "x", "y")
    assert not smtp_finto.istanze[-1].starttls_fatto


def test_smtp_errore_non_blocca_e_non_logga_il_corpo(smtp_finto, caplog):
    smtp_finto.errore = smtplib.SMTPServerDisconnected("server giù")
    m = mail.build_mailer(_settings())
    with caplog.at_level("ERROR", logger="cde.mail"):
        m.send("a@b.it", "Reset password", "link segreto https://skytower/reset/TOKEN")  # non deve sollevare
    assert "non inviata" in caplog.text and "TOKEN" not in caplog.text


def test_mailer_configurazione_sbagliata():
    with pytest.raises(RuntimeError, match="CDE_SMTP_HOST"):
        mail.build_mailer(Settings(mailer="smtp"))
    with pytest.raises(RuntimeError, match="sconosciuto"):
        mail.build_mailer(Settings(mailer="piccione"))
    assert isinstance(mail.build_mailer(Settings(mailer="console")), mail.ConsoleMailer)


def test_kms_file_in_produzione(tmp_path: Path):
    """In prod "local" resta vietato; "file" vuole la cartella già esistente e riservata, poi funziona come local."""
    with pytest.raises(RuntimeError, match="non ammesso in produzione"):
        kms_mod.build_kms(Settings(env="prod", kms_provider="local", local_secrets_dir=tmp_path / "x"))
    with pytest.raises(RuntimeError, match="non esiste"):
        kms_mod.build_kms(Settings(env="prod", kms_provider="file", local_secrets_dir=tmp_path / "manca"))
    cartella = tmp_path / "segreti"
    cartella.mkdir(mode=0o700)
    k = kms_mod.build_kms(Settings(env="prod", kms_provider="file", local_secrets_dir=cartella))
    assert isinstance(k, kms_mod.FileKms)
    blob = k.encrypt(b"segreto TOTP")
    assert k.decrypt(blob) == b"segreto TOTP"
    assert k.jwt_private_key_pem().startswith(b"-----BEGIN PRIVATE KEY-----")
    if os.name == "posix":
        for nome in ("master.key", "jwt_private.pem"):
            assert stat.S_IMODE((cartella / nome).stat().st_mode) == 0o600
    # un secondo avvio rilegge le stesse chiavi: i segreti cifrati prima restano leggibili
    k2 = kms_mod.FileKms(cartella)
    assert k2.decrypt(blob) == b"segreto TOTP"


@pytest.mark.skipif(os.name != "posix", reason="permessi POSIX")
def test_kms_file_rifiuta_cartella_leggibile_da_altri(tmp_path: Path):
    cartella = tmp_path / "aperta"
    cartella.mkdir(mode=0o755)
    with pytest.raises(RuntimeError, match="leggibile da gruppo o altri"):
        kms_mod.FileKms(cartella)
