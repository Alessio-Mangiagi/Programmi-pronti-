# "><(((º> sabusabu <º)))><"
"""Applicazione FastAPI (monolite modulare)."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from . import __version__, errors
from .config import Settings, get_settings
from .db import Database
from .deps import Services
from .mail import build_mailer
from .modules import (
    access,
    audit,
    auth,
    containers,
    documents,
    me,
    notifications,
    organizations,
    projects,
    rfis,
    states,
    workflows,
)
from .security.kms import build_kms
from .security.ratelimit import RateLimiter
from .security.tokens import TokenService
from .storage import Storage

SECURITY_HEADERS = {
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cache-Control": "no-store",
}
DOCS_CSP = ("default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
            "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: https://fastapi.tiangolo.com")


def build_services(settings: Settings) -> Services:
    kms = build_kms(settings)
    return Services(
        settings=settings,
        db=Database(settings),
        kms=kms,
        tokens=TokenService(settings, kms.jwt_private_key_pem()),
        limiter=RateLimiter(settings.rate_limit_storage),
        mailer=build_mailer(settings),
        storage=Storage(settings),
    )


def create_app(settings: Settings | None = None, services: Services | None = None) -> FastAPI:
    settings = settings or get_settings()
    svc = services or build_services(settings)
    logging.basicConfig(level=logging.INFO)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        svc.db.open()
        yield
        svc.db.close()

    app = FastAPI(title="CDE ISO 19650 API", version=__version__, lifespan=lifespan,
                  docs_url=None if settings.env == "prod" else "/docs", redoc_url=None)
    app.state.services = svc
    errors.install(app)

    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=True,
                       allow_methods=["GET", "POST", "PATCH", "DELETE"], allow_headers=["Authorization", "Content-Type"])

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        for k, v in SECURITY_HEADERS.items():
            response.headers.setdefault(k, v)
        if request.url.path in ("/docs", "/openapi.json"):
            response.headers["Content-Security-Policy"] = DOCS_CSP
        return response

    @app.get("/health", tags=["ops"])
    def health():
        with svc.db.app_pool.connection() as conn:
            conn.execute("SELECT 1")
        return {"status": "ok", "version": __version__}

    @app.get("/.well-known/jwks.json", tags=["auth"])
    def jwks():
        return svc.tokens.jwks

    for module in (auth, me, organizations, projects, containers, access, documents, states, workflows, notifications,
                   rfis, audit):
        app.include_router(module.router)
    return app
