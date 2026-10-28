# "><(((º> sabusabu <º)))><"
"""Notifiche in-app (lista, lettura, stream SSE) e preferenze dell'utente."""
from __future__ import annotations

import asyncio
import json
from typing import Literal

import jwt
from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from ..deps import Ctx, Services, ctx, services
from ..errors import unauthorized

router = APIRouter(tags=["notifications"])

COLS = "id, project_id, kind, title, body, link, data, created_at, read_at"


class ReadIn(BaseModel):
    ids: list[int] = Field(default_factory=list, max_length=500)
    all: bool = False


class PreferencesIn(BaseModel):
    email_enabled: bool = True
    daily_digest: bool = False
    follow_digest: bool = True          # documenti seguiti: per email solo nel riepilogo giornaliero
    locale: Literal["it", "en"] = "it"


@router.get("/notifications")
def list_notifications(unread_only: bool = False, before_id: int | None = None,
                       limit: int = Query(default=50, ge=1, le=200), c: Ctx = Depends(ctx)):
    where, params = ["true"], {"l": limit}
    if unread_only:
        where.append("read_at IS NULL")
    if before_id:
        where.append("id < %(b)s")
        params["b"] = before_id
    with c.tx() as conn:
        items = conn.execute(f"SELECT {COLS} FROM cde.notifications WHERE " + " AND ".join(where)
                             + " ORDER BY id DESC LIMIT %(l)s", params).fetchall()
        unread = conn.execute("SELECT count(*) n FROM cde.notifications WHERE read_at IS NULL").fetchone()["n"]
    return {"items": items, "unread": unread}


@router.post("/notifications/read")
def mark_read(body: ReadIn, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        if body.all:
            n = conn.execute("UPDATE cde.notifications SET read_at = now() WHERE read_at IS NULL").rowcount
        else:
            n = conn.execute("UPDATE cde.notifications SET read_at = now() WHERE read_at IS NULL AND id = ANY(%s)",
                             [body.ids]).rowcount
    return {"marked": n}


@router.get("/me/notification-preferences")
def get_preferences(c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        row = conn.execute("SELECT email_enabled, daily_digest, follow_digest FROM cde.notification_preferences").fetchone()
        locale = conn.execute("SELECT locale FROM cde.users WHERE id = cde.current_app_user()").fetchone()["locale"]
    return {**(row or {"email_enabled": True, "daily_digest": False, "follow_digest": True}), "locale": locale}


@router.put("/me/notification-preferences")
def put_preferences(body: PreferencesIn, c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        conn.execute(
            """INSERT INTO cde.notification_preferences (user_id, email_enabled, daily_digest, follow_digest)
               VALUES (cde.current_app_user(), %(e)s, %(d)s, %(f)s)
               ON CONFLICT (user_id) DO UPDATE SET email_enabled = EXCLUDED.email_enabled,
                   daily_digest = EXCLUDED.daily_digest, follow_digest = EXCLUDED.follow_digest, updated_at = now()""",
            {"e": body.email_enabled, "d": body.daily_digest, "f": body.follow_digest})
        conn.execute("SELECT cde.set_my_locale(%s)", [body.locale])
    return body


@router.post("/notifications/stream-ticket")
def stream_ticket(c: Ctx = Depends(ctx)):
    return {"ticket": c.svc.tokens.issue_sse_ticket(c.user_id), "expires_in": 60}


@router.get("/notifications/stream")
async def stream(request: Request, ticket: str, last_id: int = 0, svc: Services = Depends(services)):
    """Server-Sent Events: nuove notifiche dell'utente (polling leggero lato server ogni 3")."""
    try:
        user_id = svc.tokens.decode_sse_ticket(ticket)
    except jwt.InvalidTokenError:
        raise unauthorized("Ticket non valido o scaduto") from None

    def fetch(after: int) -> list[dict]:
        with svc.db.app_tx(user_id) as conn:
            return conn.execute(f"SELECT {COLS} FROM cde.notifications WHERE id > %s ORDER BY id LIMIT 50",
                                [after]).fetchall()

    async def events():
        cursor = last_id
        while not await request.is_disconnected():
            rows = await asyncio.to_thread(fetch, cursor)
            for row in rows:
                cursor = row["id"]
                yield {"event": "notification", "id": str(row["id"]),
                       "data": json.dumps(row, default=str)}
            await asyncio.sleep(3)

    return EventSourceResponse(events(), ping=15)
