"""
Entry point di produzione: un solo processo serve API e frontend sulla stessa porta.

    uvicorn app.server:app --host 0.0.0.0 --port 8000

- `/api/...`  -> l'API di app/main.py (Swagger su /api/docs)
- `/...`      -> i file statici di web/dist; ogni path senza estensione che non
                 esiste restituisce index.html (routing lato client di React)

In sviluppo si continua a usare `uvicorn app.main:app` + `vite` con proxy.
La cartella si può spostare con WEB_DIST (es. nel container).
"""
import os
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from .main import app as api

DIST = Path(os.getenv("WEB_DIST", Path(__file__).resolve().parent.parent / "web" / "dist"))


class SPAStaticFiles(StaticFiles):
    """StaticFiles con fallback a index.html per le route del frontend."""

    async def get_response(self, path: str, scope):
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code == 404 and "." not in path.rsplit("/", 1)[-1]:
                return await super().get_response("index.html", scope)
            raise


def create_app(dist: Path = DIST) -> FastAPI:
    root = FastAPI(title="Field View", docs_url=None, redoc_url=None, openapi_url=None)
    root.mount("/api", api)
    if dist.is_dir():
        root.mount("/", SPAStaticFiles(directory=dist, html=True), name="web")
    else:  # build mancante: l'API funziona comunque, la radice lo dice chiaramente

        @root.get("/")
        def no_frontend():
            return {"detail": f"frontend non compilato: manca {dist} (cd web && npm run build)"}

    return root


def gate_suite(asgi_app, sso_dir: Path = Path(__file__).resolve().parents[2] / "shared" / "sso"):
    """Dentro la Suite Cosedil le pagine web si aprono solo dopo il login del portale.

    Il gate (shared/sso/cosedil_sso.py) controlla solo le navigazioni HTML: le API
    restano protette dal JWT di InCampo, perché l'app mobile il cookie del portale
    non ce l'ha. /invito/ resta pubblico: chi accetta un invito non ha ancora un
    account. Fuori dalla suite (container, repo da sola) la cartella non c'è e
    l'app si serve com'è. COSEDIL_SSO=off spegne il gate (sviluppo, e2e).
    """
    if not (sso_dir / "cosedil_sso.py").is_file():
        return asgi_app
    if str(sso_dir) not in sys.path:
        sys.path.insert(0, str(sso_dir))
    import cosedil_sso

    # "><(((º> sabusabu <º)))><"
    return cosedil_sso.asgi(asgi_app, app_id="incampo", solo_pagine=True, percorsi_liberi=("/invito/",))


app = gate_suite(create_app())
