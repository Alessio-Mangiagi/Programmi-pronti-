# "><(((º> sabusabu <º)))><"
"""Email delle notifiche (immediate e digest giornaliero), template Jinja2 IT/EN.

Gira nel worker con il ruolo cde_worker; idempotente (emailed_at).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import psycopg
from jinja2 import Environment, PackageLoader, StrictUndefined

_env = Environment(loader=PackageLoader("cde_api", "templates"), undefined=StrictUndefined,
                   autoescape=False, keep_trailing_newline=True)   # testo semplice: nessun HTML
DIGEST_SUBJECT = {"it": "Riepilogo giornaliero CDE", "en": "CDE daily digest"}


def render(name: str, locale: str, **ctx) -> str:
    return _env.get_template(f"email/{name}.{locale if locale in ('it', 'en') else 'it'}.txt").render(**ctx)


def send_notification_email(conn: psycopg.Connection, mailer, base_url: str, notification_id: int) -> bool:
    n = conn.execute(
        """SELECT n.id, n.title, n.body, n.link, n.emailed_at, u.email, u.first_name, u.locale, u.status,
                  coalesce(p.email_enabled, true) AS email_enabled, coalesce(p.daily_digest, false) AS daily_digest
           FROM cde.notifications n JOIN cde.users u ON u.id = n.user_id
           LEFT JOIN cde.notification_preferences p ON p.user_id = n.user_id
           WHERE n.id = %s""", [notification_id]).fetchone()
    if n is None or n["emailed_at"] or n["status"] != "ACTIVE" or not n["email_enabled"] or n["daily_digest"]:
        return False
    body = render("notification", n["locale"], first_name=n["first_name"], title=n["title"], body=n["body"],
                  link=f"{base_url}{n['link']}" if n["link"] else None)
    mailer.send(n["email"], n["title"], body)
    conn.execute("UPDATE cde.notifications SET emailed_at = now() WHERE id = %s", [notification_id])
    conn.commit()
    return True


def send_daily_digests(conn: psycopg.Connection, mailer, base_url: str, now: datetime | None = None) -> int:
    """Un'email per utente in modalità digest con le notifiche non ancora inviate delle ultime 24 ore."""
    now = now or datetime.now(timezone.utc)
    rows = conn.execute(
        """SELECT n.id, n.user_id, n.title, n.link, u.email, u.first_name, u.locale
           FROM cde.notifications n JOIN cde.users u ON u.id = n.user_id AND u.status = 'ACTIVE'
           JOIN cde.notification_preferences p ON p.user_id = n.user_id AND p.daily_digest AND p.email_enabled
           WHERE n.emailed_at IS NULL AND n.created_at > %s AND n.created_at <= %s
           ORDER BY n.user_id, n.id""", [now - timedelta(hours=24), now]).fetchall()
    by_user: dict = {}
    for r in rows:
        by_user.setdefault(r["user_id"], []).append(r)
    for items in by_user.values():
        first = items[0]
        mailer.send(first["email"], DIGEST_SUBJECT.get(first["locale"], DIGEST_SUBJECT["it"]),
                    render("digest", first["locale"], first_name=first["first_name"], items=items, base_url=base_url))
        conn.execute("UPDATE cde.notifications SET emailed_at = now() WHERE id = ANY(%s)", [[i["id"] for i in items]])
        conn.commit()
    return len(by_user)
