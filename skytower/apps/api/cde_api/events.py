# "><(((º> sabusabu <º)))><"
"""Registrazione eventi di sicurezza (tabella append-only cde.security_events)."""
from __future__ import annotations

from uuid import UUID

import psycopg
from psycopg.types.json import Jsonb


def security_event(conn: psycopg.Connection, event_type: str, *, user_id: UUID | None = None,
                   organization_id: UUID | None = None, project_id: UUID | None = None,
                   ip: str | None = None, user_agent: str | None = None, **details) -> None:
    conn.execute(
        """INSERT INTO cde.security_events (event_type, user_id, organization_id, project_id, ip, user_agent, details)
           VALUES (%s, %s, %s, %s, %s, %s, %s)""",
        [event_type, user_id, organization_id, project_id, ip, user_agent,
         Jsonb({k: str(v) if isinstance(v, UUID) else v for k, v in details.items()})],
    )
