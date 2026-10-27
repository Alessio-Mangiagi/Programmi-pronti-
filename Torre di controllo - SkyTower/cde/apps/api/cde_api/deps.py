# "><(((º> sabusabu <º)))><"
"""Servizi condivisi e dipendenze FastAPI: autenticazione, contesto richiesta, guard dei permessi.

L'isolamento è applicato due volte: qui (guard → 404/403 espliciti) e nel database (RLS).
Le transazioni sono aperte esplicitamente negli endpoint (`with ctx.tx() as conn`) così il
COMMIT avviene prima della risposta.
"""
from __future__ import annotations

import ipaddress
from contextlib import contextmanager
from dataclasses import dataclass
from uuid import UUID

import jwt
import psycopg
from fastapi import Depends, Request

from .config import Settings
from .db import Database
from .errors import forbidden, not_found, unauthorized
from .security.kms import Kms
from .security.ratelimit import RateLimiter
from .security.tokens import AccessClaims, TokenService
from .storage import Storage


@dataclass
class Services:
    settings: Settings
    db: Database
    kms: Kms
    tokens: TokenService
    limiter: RateLimiter
    mailer: object
    storage: Storage


def services(request: Request) -> Services:
    return request.app.state.services


def client_ip(request: Request) -> str | None:
    """IP del client (dietro ALB: uvicorn --proxy-headers). None se non è un indirizzo valido."""
    host = request.client.host if request.client else None
    try:
        return str(ipaddress.ip_address(host)) if host else None
    except ValueError:
        return None


def bearer_token(request: Request) -> str | None:
    auth = request.headers.get("authorization", "")
    scheme, _, token = auth.partition(" ")
    return token.strip() if scheme.lower() == "bearer" and token.strip() else None


def current_claims(request: Request, svc: Services = Depends(services)) -> AccessClaims:
    token = bearer_token(request)
    if not token:
        raise unauthorized()
    try:
        return svc.tokens.decode_access(token)
    except jwt.InvalidTokenError:
        raise unauthorized("Token non valido o scaduto") from None


@dataclass
class Ctx:
    svc: Services
    user: AccessClaims
    ip: str | None
    user_agent: str | None

    @property
    def user_id(self) -> UUID:
        return self.user.user_id

    @contextmanager
    def tx(self):
        with self.svc.db.app_tx(self.user.user_id) as conn:
            yield conn


def ctx(request: Request, claims: AccessClaims = Depends(current_claims),
        svc: Services = Depends(services)) -> Ctx:
    return Ctx(svc, claims, client_ip(request), request.headers.get("user-agent"))


# ---------------------------------------------------------------------
# Guard (equivalente di @RequirePermission)
# ---------------------------------------------------------------------
ACTIONS = ("READ", "WRITE", "DOWNLOAD", "APPROVE", "ADMIN")


def require_project(conn: psycopg.Connection, project_id: UUID, action: str | None = None,
                    scope: str | None = None) -> dict:
    """404 se il progetto non è visibile; 403 se manca il permesso richiesto."""
    project = conn.execute("SELECT * FROM cde.projects WHERE id = %s", [project_id]).fetchone()
    if project is None:
        raise not_found("Progetto")
    if action and not conn.execute(
        "SELECT cde.has_project_permission(cde.current_app_user(), %s, %s, %s) ok",
        [project_id, action, scope],
    ).fetchone()["ok"]:
        raise forbidden()
    return project


def require_container(conn: psycopg.Connection, container_id: UUID, action: str = "READ") -> dict:
    """404 se il container non è leggibile (non se ne rivela l'esistenza); 403 se manca l'azione."""
    row = conn.execute(
        "SELECT c.*, cde.my_container_actions(c.id)::text[] AS my_actions FROM cde.containers c WHERE c.id = %s",
        [container_id],
    ).fetchone()
    if row is None:
        raise not_found("Container")
    if action not in row["my_actions"]:
        raise forbidden()
    return row
