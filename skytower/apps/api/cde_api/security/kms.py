# "><(((º> sabusabu <º)))><"
"""Cifratura dei segreti (envelope encryption) e chiave di firma JWT.

* LocalKms: chiave master Fernet e chiave RSA su file in `local_secrets_dir` (solo dev/test).
* FileKms:  le stesse chiavi su file, ammesse anche in produzione (ADR-46) perché la cartella è un volume
            riservato del server (rilascio Docker senza AWS): all'avvio controlla che nessun altro utente
            del sistema possa leggerla e stringe i permessi dei file che crea.
* AwsKms:   data key generata da AWS KMS (GenerateDataKey), payload cifrato con Fernet;
            chiave privata JWT letta da Secrets Manager (cifrata a riposo con KMS).
Formato del blob: [2 byte lunghezza data key cifrata][data key cifrata][token Fernet].
"""
from __future__ import annotations

import base64
import logging
import os
import stat
import struct
from pathlib import Path
from typing import Protocol

log = logging.getLogger("cde.kms")

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from ..config import Settings


class Kms(Protocol):
    def encrypt(self, plaintext: bytes) -> bytes: ...
    def decrypt(self, blob: bytes) -> bytes: ...
    def jwt_private_key_pem(self) -> bytes: ...


def _pack(encrypted_key: bytes, token: bytes) -> bytes:
    return struct.pack(">H", len(encrypted_key)) + encrypted_key + token


def _unpack(blob: bytes) -> tuple[bytes, bytes]:
    (n,) = struct.unpack(">H", blob[:2])
    return blob[2:2 + n], blob[2 + n:]


class LocalKms:
    def __init__(self, secrets_dir: Path):
        self.dir = secrets_dir
        self.dir.mkdir(parents=True, exist_ok=True)
        self._master = Fernet(self._load_or_create("master.key", Fernet.generate_key))

    def _load_or_create(self, name: str, factory) -> bytes:
        path = self.dir / name
        if not path.exists():
            path.write_bytes(factory())
        return path.read_bytes()

    def encrypt(self, plaintext: bytes) -> bytes:
        data_key = Fernet.generate_key()
        return _pack(self._master.encrypt(data_key), Fernet(data_key).encrypt(plaintext))

    def decrypt(self, blob: bytes) -> bytes:
        enc_key, token = _unpack(blob)
        return Fernet(self._master.decrypt(enc_key)).decrypt(token)

    def jwt_private_key_pem(self) -> bytes:
        def generate() -> bytes:
            key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
            return key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                     serialization.NoEncryption())
        return self._load_or_create("jwt_private.pem", generate)


class FileKms(LocalKms):
    """Chiavi su file ammesse in produzione (ADR-46): stesso formato di LocalKms, più i controlli sulla cartella.

    Sul server le chiavi stanno in un volume riservato (``/segreti`` nel rilascio Docker, intestato all'utente
    non privilegiato del container). Qui si pretende che la cartella esista già (la crea l'installazione, non
    l'API: un percorso sbagliato non deve produrre chiavi nuove in silenzio e rendere illeggibili i segreti
    cifrati con quelle vecchie) e, dove il sistema ha i permessi POSIX, che gruppo e altri non possano leggerla.
    I file creati qui nascono con permessi 0600.
    """

    def __init__(self, secrets_dir: Path):
        if not secrets_dir.is_dir():
            raise RuntimeError(f"CDE_KMS_PROVIDER=file: la cartella delle chiavi {secrets_dir} non esiste")
        if os.name == "posix":
            mode = stat.S_IMODE(secrets_dir.stat().st_mode)
            if mode & (stat.S_IRWXG | stat.S_IRWXO):
                raise RuntimeError(f"CDE_KMS_PROVIDER=file: {secrets_dir} è leggibile da gruppo o altri "
                                   f"(permessi {mode:o}, attesi 700)")
        super().__init__(secrets_dir)
        log.info("chiavi su file in %s", secrets_dir)

    def _load_or_create(self, name: str, factory) -> bytes:
        path = self.dir / name
        if not path.exists():
            # creato con 0600 fin dal primo byte: niente finestra in cui il file è leggibile da altri
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as f:
                f.write(factory())
            log.info("chiave %s creata", name)
        return path.read_bytes()


class AwsKms:  # pragma: no cover - richiede AWS
    def __init__(self, settings: Settings):
        import boto3

        self.key_id = settings.aws_kms_key_id
        self.secret_id = settings.jwt_private_key_secret_id
        self.kms = boto3.client("kms", region_name=settings.aws_region)
        self.sm = boto3.client("secretsmanager", region_name=settings.aws_region)

    def encrypt(self, plaintext: bytes) -> bytes:
        dk = self.kms.generate_data_key(KeyId=self.key_id, KeySpec="AES_256")
        fernet_key = base64.urlsafe_b64encode(dk["Plaintext"])
        return _pack(dk["CiphertextBlob"], Fernet(fernet_key).encrypt(plaintext))

    def decrypt(self, blob: bytes) -> bytes:
        enc_key, token = _unpack(blob)
        plain_key = self.kms.decrypt(CiphertextBlob=enc_key)["Plaintext"]
        return Fernet(base64.urlsafe_b64encode(plain_key)).decrypt(token)

    def jwt_private_key_pem(self) -> bytes:
        return self.sm.get_secret_value(SecretId=self.secret_id)["SecretString"].encode()


def build_kms(settings: Settings) -> Kms:
    """Il provider scelto in ``Settings.kms_provider``; in produzione solo ``aws`` o ``file`` (ADR-46)."""
    if settings.kms_provider == "aws":
        return AwsKms(settings)
    if settings.kms_provider == "file":
        return FileKms(settings.local_secrets_dir)
    if settings.env == "prod":
        raise RuntimeError("LocalKms non ammesso in produzione: usare CDE_KMS_PROVIDER=file o aws")
    return LocalKms(settings.local_secrets_dir)
