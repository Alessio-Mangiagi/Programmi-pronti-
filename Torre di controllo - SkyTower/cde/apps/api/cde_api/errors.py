# "><(((º> sabusabu <º)))><"
"""Errori applicativi e traduzione degli errori PostgreSQL in risposte HTTP.

Regola anti-enumerazione: una risorsa che la RLS nasconde è 404, mai 403.
"""
from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from psycopg import errors as pg

log = logging.getLogger("cde.errors")


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, headers: dict | None = None):
        self.status, self.code, self.message, self.headers = status, code, message, headers


def not_found(what: str = "Risorsa") -> ApiError:
    return ApiError(404, "not_found", f"{what} non trovata")


def forbidden(message: str = "Operazione non consentita") -> ApiError:
    return ApiError(403, "forbidden", message)


def unauthorized(message: str = "Autenticazione richiesta") -> ApiError:
    return ApiError(401, "unauthorized", message, {"WWW-Authenticate": "Bearer"})


def _body(code: str, message: str) -> dict:
    return {"error": {"code": code, "message": message}}


def install(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError):
        return JSONResponse(_body(exc.code, exc.message), status_code=exc.status, headers=exc.headers)

    @app.exception_handler(pg.InsufficientPrivilege)
    async def _denied(_: Request, exc: pg.InsufficientPrivilege):
        msg = exc.diag.message_primary or ""
        log.info("accesso negato dal database: %s", msg)
        # i messaggi delle funzioni CDE (RAISE) sono per l'utente; quelli di RLS/GRANT no
        generic = msg.startswith(("permission denied", "new row violates")) or not msg
        return JSONResponse(_body("forbidden", "Operazione non consentita" if generic else msg), status_code=403)

    @app.exception_handler(pg.LockNotAvailable)
    async def _locked(_: Request, exc: pg.LockNotAvailable):
        return JSONResponse(_body("locked", exc.diag.message_primary or "Risorsa bloccata"), status_code=423)

    @app.exception_handler(pg.UniqueViolation)
    async def _unique(_: Request, exc: pg.UniqueViolation):
        if exc.diag.constraint_name == "ux_workflow_running_document":
            return JSONResponse(_body("workflow_running", "Workflow di revisione già in corso sul documento"),
                                status_code=409)
        return JSONResponse(_body("conflict", "Elemento già esistente"), status_code=409)

    @app.exception_handler(pg.CheckViolation)
    async def _check(_: Request, exc: pg.CheckViolation):
        # i messaggi dei trigger (RAISE ... check_violation) sono pensati per l'utente
        msg = exc.diag.message_primary or "Dati non validi"
        if exc.diag.constraint_name:
            msg = "Dati non validi"
        return JSONResponse(_body("invalid", msg), status_code=422)

    @app.exception_handler(pg.ForeignKeyViolation)
    async def _fk(_: Request, exc: pg.ForeignKeyViolation):
        return JSONResponse(_body("invalid_reference", "Riferimento inesistente"), status_code=422)

    @app.exception_handler(pg.NoDataFound)
    async def _no_data(_: Request, exc: pg.NoDataFound):
        return JSONResponse(_body("not_found", exc.diag.message_primary or "Risorsa non trovata"), status_code=404)

    @app.exception_handler(pg.InvalidTextRepresentation)
    async def _bad_value(_: Request, exc: pg.InvalidTextRepresentation):
        return JSONResponse(_body("invalid", "Valore non valido"), status_code=422)
