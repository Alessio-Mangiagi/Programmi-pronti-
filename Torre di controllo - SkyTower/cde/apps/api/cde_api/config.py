# "><(((º> sabusabu <º)))><"
"""Configurazione da variabili d'ambiente (prefisso CDE_) o file .env."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CDE_", env_file=".env", extra="ignore")

    env: str = "dev"                                   # dev | test | staging | prod
    database_url_app: str = "postgresql://cde_app:cde_app@127.0.0.1:5432/cde"
    database_url_auth: str = "postgresql://cde_auth:cde_auth@127.0.0.1:5432/cde"
    db_pool_min: int = 1
    db_pool_max: int = 10

    # JWT RS256
    jwt_issuer: str = "https://auth.cde.local"
    jwt_audience: str = "cde-api"
    access_token_ttl_s: int = 15 * 60
    mfa_pending_ttl_s: int = 5 * 60
    refresh_token_ttl_s: int = 14 * 24 * 3600
    refresh_cookie_name: str = "cde_rt"
    # SPA e API sullo stesso origin: in dev (proxy Vite) e prod (CloudFront) l'API è sotto /api
    refresh_cookie_path: str = "/auth"
    cookie_secure: bool = True

    # KMS: "local" (chiavi su file, solo dev/test) | "aws"
    kms_provider: str = "local"
    local_secrets_dir: Path = Path(".secrets")
    aws_region: str = "eu-south-1"
    aws_kms_key_id: str | None = None                  # chiave simmetrica per i segreti MFA
    jwt_private_key_secret_id: str | None = None       # Secrets Manager (PEM cifrato con KMS)

    # Rate limit: memory:// in dev, redis://host:6379 in staging/prod
    rate_limit_storage: str = "memory://"
    login_rate_limit: str = "5/minute"

    # Lockout progressivo
    lockout_threshold: int = 5
    lockout_max_minutes: int = 60

    password_min_length: int = 12
    invitation_ttl_hours: int = 72
    password_reset_ttl_minutes: int = 30
    recovery_codes_count: int = 10

    totp_issuer: str = "CDE ISO 19650"
    web_base_url: str = "http://localhost:5173"
    cors_origins: list[str] = ["http://localhost:5173"]

    # Storage documenti (S3). s3_endpoint_url solo per emulatori (moto) in dev/test
    s3_bucket: str = "cde-dev-documents"
    s3_endpoint_url: str | None = None
    presign_ttl_s: int = 15 * 60
    upload_part_size: int = 64 * 1024 * 1024
    upload_max_bytes: int = 50 * 1024 ** 3
    upload_session_ttl_hours: int = 24

    # Worker: coda Procrastinate (ruolo cde_worker) e antivirus
    database_url_worker: str = "postgresql://cde_worker:cde_worker@127.0.0.1:5432/cde"
    scanner: str = "eicar"                             # eicar (dev/test) | clamd
    clamd_host: str = "127.0.0.1"
    clamd_port: int = 3310

    # Email: "console" (log) | "ses"
    mailer: str = "console"
    mail_from: str = "CDE <no-reply@cde.local>"


@lru_cache
def get_settings() -> Settings:
    return Settings()
