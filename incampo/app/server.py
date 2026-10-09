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


app = create_app()
