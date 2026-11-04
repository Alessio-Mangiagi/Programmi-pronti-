# "><(((º> sabusabu <º)))><"
"""Configurazione da variabili d'ambiente (prefisso CDE_) o file .env."""
from __future__ import annotations

import uuid
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import model_validator
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
    # Installazione in HTTP sulla LAN (COOKIE_SECURE=false, senza SUITE_DOMINIO e Caddy): il cookie di refresh
    # viaggia in chiaro e chi lo intercetta in rete apre una sessione. Fuori da dev/test la sua durata scende
    # da sola a questo valore (12 ore) e all'avvio compare un avviso (revisione di sicurezza del 03/11/2026, B8).
    insecure_refresh_token_ttl_s: int = 12 * 3600

    # KMS: "local" (chiavi su file, solo dev/test) | "file" (chiavi su file ammesse anche in prod, su un volume
    # riservato: rilascio Docker sul server aziendale, ADR-46) | "aws" (KMS + Secrets Manager)
    kms_provider: Literal["local", "file", "aws"] = "local"
    local_secrets_dir: Path = Path(".secrets")
    aws_region: str = "eu-south-1"
    aws_kms_key_id: str | None = None                  # chiave simmetrica per i segreti MFA
    jwt_private_key_secret_id: str | None = None       # Secrets Manager (PEM cifrato con KMS)

    # Rate limit: memory:// in dev, redis://host:6379 in staging/prod
    rate_limit_storage: str = "memory://"
    # Header con l'IP del client impostato dall'edge (prod: "cloudfront-viewer-address", "ip:porta").
    # Solo se l'origin non è raggiungibile direttamente: altrimenti chiunque potrebbe falsificarlo.
    client_ip_header: str | None = None
    login_rate_limit: str = "5/minute"
    # Revisione di sicurezza del 03/11/2026: limiti per utente sulle chiamate che si prestano ad abusi
    org_lookup_rate_limit: str = "30/hour"        # ricerca organizzazione per codice (B3: enumerazione)
    invite_rate_limit: str = "60/hour"            # inviti di utenti (B3: enumerazione delle email)
    audit_verify_rate_limit: str = "10/minute"    # verifica ed export del registro (B4)
    # Verifica completa della catena del registro: la fa il worker ogni ora; se l'ultima è più vecchia di
    # così (worker fermo, installazione nuova) la rifà l'API alla prima richiesta, una sola alla volta (B4)
    audit_verify_max_age_minutes: int = 120
    # Stream SSE delle notifiche aperti insieme dallo stesso utente (una scheda = uno stream), oltre → 429 (B11)
    sse_max_streams_per_user: int = 5

    # Lockout progressivo
    lockout_threshold: int = 5
    lockout_max_minutes: int = 60

    password_min_length: int = 12
    invitation_ttl_hours: int = 72
    password_reset_ttl_minutes: int = 30
    recovery_codes_count: int = 10

    totp_issuer: str = "CDE ISO 19650"
    # WebAuthn: RP ID = dominio della SPA (default: host di web_base_url); origin ammessi oltre a web_base_url e CORS
    webauthn_rp_id: str | None = None
    webauthn_origins: list[str] = []
    web_base_url: str = "http://localhost:5195"
    cors_origins: list[str] = ["http://localhost:5195"]
    # Suite Cosedil (InCampo, Magazzino): utente tecnico a cui attribuire le chiamate delle altre app quando
    # l'utente del portale non ha un account SkyTower (vedi modules/suite.py). None = primo platform admin.
    suite_user_email: str | None = None
    # Login automatico dal portale (POST /auth/portale, vedi modules/portale.py): l'utente del portale che non
    # ha un account SkyTower viene creato in questa organizzazione (None = quella dell'utente tecnico, altrimenti
    # quella del primo platform admin), membro dei progetti con codice commessa con questo ruolo di sistema
    # (admin del portale → PROJECT_ADMIN). Email di ripiego: <username>@<suite_email_dominio>.
    suite_org_id: uuid.UUID | None = None
    suite_ruolo_portale: str = "DESIGNER"
    suite_email_dominio: str = "cosedilspa.com"

    # Storage documenti (S3). s3_endpoint_url solo per emulatori (moto) in dev/test
    s3_bucket: str = "cde-dev-documents"
    s3_endpoint_url: str | None = None
    presign_ttl_s: int = 15 * 60
    upload_part_size: int = 64 * 1024 * 1024
    upload_max_bytes: int = 50 * 1024 ** 3
    upload_session_ttl_hours: int = 24
    # Filigrana: i PDF passano dall'API (non dall'URL firmato di S3), quindi c'è un tetto alla dimensione
    watermark_max_bytes: int = 200 * 1024 ** 2
    # Corpo massimo di una richiesta all'API (M4): i file vanno su S3 con URL firmati, all'API arrivano solo JSON.
    # Fa eccezione il caricamento dalla suite (POST /suite/commesse/{codice}/documenti), col suo tetto (B12):
    # quel corpo si legge tutto in memoria per mandarlo a S3, non deve poter essere da gigabyte.
    request_max_bytes: int = 16 * 1024 ** 2
    suite_upload_max_bytes: int = 200 * 1024 ** 2
    zip_max_bytes: int = 2 * 1024 ** 3      # download multiplo: oltre si scarica in più parti
    # OCR delle pagine scansionate dei PDF (Tesseract): senza eseguibile si salta (ADR-33)
    ocr_enabled: bool = True
    tesseract_cmd: str | None = None      # None = cercato nel PATH (e nella cartella predefinita su Windows)
    # Scadenze dei compiti (G35, ADR-44): un compito scaduto viene sollecitato di nuovo ai responsabili
    # ogni tante ore finché resta aperto (0 = una sola escalation, come prima della migrazione 0036).
    deadline_escalation_repeat_hours: int = 72

    ocr_languages: str = "ita+eng"
    ocr_max_pages: int = 30
    # IFC da questa dimensione in su: il worker prepara un derivato .glb per il viewer (G43, ADR-31)
    ifc_derivative_min_bytes: int = 100 * 1024 ** 2
    # Disegni CAD: DWG → DXF con ODA File Converter (gratuito, da installare sul server), DXF → SVG con ezdxf
    # (G44, ADR-41). None = cercato nel PATH e nella cartella predefinita su Windows; senza, i DWG restano solo
    # scaricabili e i DXF si vedono comunque.
    dwg_converter_cmd: str | None = None
    public_api_prefix: str = "/api"      # percorso con cui il browser raggiunge l'API (proxy Vite, CloudFront)
    # Modifica di Word/Excel/PowerPoint con OnlyOffice Docs (ADR-37). Senza URL la funzione è spenta.
    onlyoffice_url: str | None = None              # Document Server come lo raggiunge il browser
    onlyoffice_internal_url: str | None = None     # come lo raggiunge l'API (file salvati); default onlyoffice_url
    onlyoffice_jwt_secret: str | None = None       # segreto condiviso (services.CoAuthoring.secret)
    onlyoffice_callback_url: str | None = None     # API come la raggiunge il Document Server; default web_base_url + prefisso
    office_edit_max_bytes: int = 100 * 1024 ** 2

    # Registro attività: ancore giornaliere su S3 WORM e marca temporale RFC 3161 (TSA qualificata in produzione)
    audit_anchor_prefix: str = "audit-anchors"
    audit_lock_mode: Literal["GOVERNANCE", "COMPLIANCE"] = "GOVERNANCE"   # COMPLIANCE in produzione
    audit_lock_days: int = 3650
    tsa_url: str | None = None

    # Worker: coda Procrastinate (ruolo cde_worker) e antivirus
    database_url_worker: str = "postgresql://cde_worker:cde_worker@127.0.0.1:5432/cde"
    scanner: str = "eicar"                             # eicar (dev/test) | clamd
    clamd_host: str = "127.0.0.1"
    clamd_port: int = 3310

    # Email: "console" (log, dev/test) | "smtp" (server aziendale o provider, ADR-46) | "ses" (AWS)
    mailer: str = "console"
    mail_from: str = "CDE <no-reply@cde.local>"
    # SMTP (solo con mailer=smtp): host obbligatorio; utente/password facoltativi (i relay aziendali spesso
    # autenticano per IP); security = starttls (587, default) | ssl (465) | none (25, solo relay in LAN)
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_user: str | None = None
    smtp_password: str | None = None
    smtp_security: Literal["starttls", "ssl", "none"] = "starttls"
    smtp_timeout_seconds: int = 20

    @property
    def insecure_cookies(self) -> bool:
        """Cookie di sessione senza Secure fuori da dev/test: installazione in HTTP sulla LAN (B8)."""
        return not self.cookie_secure and self.env not in ("dev", "test")

    @model_validator(mode="after")
    def _refresh_breve_in_http(self) -> Settings:
        # B8: in HTTP il refresh token (cookie) si può intercettare in rete; vale 12 ore invece di 14 giorni,
        # così un furto apre al massimo mezza giornata. L'avviso all'avvio lo scrive main.create_app.
        if self.insecure_cookies and self.refresh_token_ttl_s > self.insecure_refresh_token_ttl_s:
            self.refresh_token_ttl_s = self.insecure_refresh_token_ttl_s
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
