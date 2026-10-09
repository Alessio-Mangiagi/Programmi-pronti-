#!/bin/sh
# Avvio nel container: migrazioni, seed demo opzionale (SEED_DEMO=1), server.
set -e
alembic upgrade head
if [ "${SEED_DEMO:-0}" = "1" ]; then
  python -m scripts.seed
fi
exec uvicorn app.server:app --host 0.0.0.0 --port "${PORT:-8000}"
