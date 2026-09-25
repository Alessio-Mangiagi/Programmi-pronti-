"""
API core per il sistema tipo Field View.

Avvio locale (dalla root del progetto):
    alembic upgrade head
    python -m scripts.seed          # utenti/progetto demo (opzionale)
    uvicorn app.main:app --reload

Endpoint principali:
    /auth/login, /auth/me, /users         -> autenticazione (JWT bearer) e utenti
    /invite-labels, /invites              -> etichette (credenziali preimpostate) e inviti
    /projects, /projects/{id}/members     -> progetti e membri
    /plans, /form-templates               -> CRUD standard, gestiti da web
    /pins/{id}                            -> pin con submissions/task/foto (plan view)
    /submissions, /tasks                  -> creazione e aggiornamento da web
    /plans/{id}/file, /attachments/{id}/upload, /files/{key} -> upload e download file
    /sync/push                            -> l'app nativa manda le modifiche fatte offline
    /sync/pull?project_id=..&since=..     -> l'app nativa scarica le modifiche dal server

Tutti gli endpoint tranne /auth/login richiedono `Authorization: Bearer <token>`.
Regole di accesso in app/auth.py. Gli endpoint stanno in app/routers/ (un modulo
per dominio); qui solo creazione dell'app, middleware e montaggio dei router.

Strategia di sync (vedi README):
    - Ogni entità creata sul device ha un id UUID generato localmente.
    - Il push è un upsert per id: se arriva due volte (retry di rete) non crea duplicati.
    - Ordine di applicazione: pins -> submissions -> tasks -> attachments, con flush
      tra un gruppo e l'altro così le FK verso entità dello stesso batch funzionano.
    - Il pull è incrementale per progetto: il client manda l'ultimo server_time
      ricevuto e riceve solo le modifiche successive, cancellazioni comprese.
    - Conflict resolution MVP: "last write wins" basato su updated_at.
"""
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import routers


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    # NOTIFY_WORKER=thread: worker notifiche in-process (sviluppo). In prod: python -m app.worker
    stop = None
    if os.getenv("NOTIFY_WORKER") == "thread":
        from .worker import start_thread
        stop = start_thread()
    yield
    if stop:
        stop.set()


app = FastAPI(title="Field View Starter API", lifespan=_lifespan)

# In sviluppo il frontend gira su Vite (porta 5173) e chiama l'API su 8000.
# In produzione FastAPI serve web/dist e CORS non serve (stessa origine).
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for _router in routers.ALL:
    app.include_router(_router)
