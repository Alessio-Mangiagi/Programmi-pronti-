# "><(((º> sabusabu <º)))><"
"""Pool di connessioni e transazioni con contesto utente.

Due pool separati:
  * app  → ruolo cde_app, soggetto a RLS; ogni transazione imposta app.user_id (SET LOCAL);
  * auth → ruolo cde_auth, solo credenziali e sessioni.
"""
from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from uuid import UUID

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .config import Settings


class Database:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.app_pool: ConnectionPool | None = None
        self.auth_pool: ConnectionPool | None = None

    def _pool(self, url: str) -> ConnectionPool:
        pool = ConnectionPool(url, min_size=self.settings.db_pool_min, max_size=self.settings.db_pool_max,
                              kwargs={"row_factory": dict_row}, open=False)
        pool.open(wait=True)
        return pool

    def open(self) -> None:
        """Crea pool nuovi (un pool chiuso non è riapribile: lifespan ripetuti nei test)."""
        self.app_pool = self._pool(self.settings.database_url_app)
        self.auth_pool = self._pool(self.settings.database_url_auth)

    def close(self) -> None:
        self.app_pool.close()
        self.auth_pool.close()

    @contextmanager
    def app_tx(self, user_id: UUID | None) -> Iterator[psycopg.Connection]:
        """Transazione applicativa: il contesto utente vale solo fino a COMMIT/ROLLBACK."""
        with self.app_pool.connection() as conn, conn.transaction():
            conn.execute("SELECT set_config('app.user_id', %s, true)", [str(user_id) if user_id else ""])
            yield conn

    @contextmanager
    def auth_tx(self) -> Iterator[psycopg.Connection]:
        with self.auth_pool.connection() as conn, conn.transaction():
            yield conn
