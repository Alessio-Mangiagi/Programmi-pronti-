# "><(((º> sabusabu <º)))><"
"""Email delle notifiche (immediate e digest giornaliero), template Jinja2 IT/EN.

Gira nel worker con il ruolo cde_worker; idempotente (emailed_at).
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import psycopg
from jinja2 import Environment, PackageLoader, StrictUndefined

_env = Environment(loader=PackageLoader("cde_api", "templates"), undefined=StrictUndefined,
                   autoescape=False, keep_trailing_newline=True)  # noqa: S701 - testo semplice: nessun HTML
DIGEST_SUBJECT = {"it": "Riepilogo giornaliero CDE", "en": "CDE daily digest"}
# sezioni del riepilogo, nell'ordine in cui compaiono (i tipi non elencati finiscono in "Altro")
SECTIONS = [
    ({"TASK_ASSIGNED", "TASK_REMINDER", "TASK_OVERDUE", "TASK_ESCALATED", "WORKFLOW_APPROVED", "WORKFLOW_REJECTED"},
     {"it": "Approvazioni e compiti", "en": "Approvals and tasks"}),
    ({"RFI_CREATED", "RFI_REMINDER", "RFI_OVERDUE"}, {"it": "RFI", "en": "RFIs"}),
    ({"TRANSMITTAL_RECEIVED", "TRANSMITTAL_ACKNOWLEDGED"}, {"it": "Transmittal", "en": "Transmittals"}),
    ({"DOCUMENT_FOLLOWED"}, {"it": "Documenti che segui", "en": "Documents you follow"}),
    ({"ACCESS_REQUESTED"}, {"it": "Richieste di accesso", "en": "Access requests"}),
]
OTHER = {"it": "Altro", "en": "Other"}


def render(name: str, locale: str, **ctx) -> str:
    return _env.get_template(f"email/{name}.{locale if locale in ('it', 'en') else 'it'}.txt").render(**ctx)


def send_notification_email(conn: psycopg.Connection, mailer, base_url: str, notification_id: int) -> bool:
    n = conn.execute(
        """SELECT n.id, n.title, n.body, n.link, n.emailed_at, u.email, u.first_name, u.locale, u.status,
                  coalesce(p.email_enabled, true) AS email_enabled, coalesce(p.daily_digest, false) AS daily_digest,
                  n.kind = 'DOCUMENT_FOLLOWED' AND coalesce(p.follow_digest, true) AS follow_digest
           FROM cde.notifications n JOIN cde.users u ON u.id = n.user_id
           LEFT JOIN cde.notification_preferences p ON p.user_id = n.user_id
           WHERE n.id = %s""", [notification_id]).fetchone()
    if n is None or n["emailed_at"] or n["status"] != "ACTIVE" or not n["email_enabled"] or n["daily_digest"] \
            or n["follow_digest"]:
        return False
    body = render("notification", n["locale"], first_name=n["first_name"], title=n["title"], body=n["body"],
                  link=f"{base_url}{n['link']}" if n["link"] else None)
    mailer.send(n["email"], n["title"], body)
    conn.execute("UPDATE cde.notifications SET emailed_at = now() WHERE id = %s", [notification_id])
    conn.commit()
    return True


def sections(items: list[dict], locale: str) -> list[tuple[str, list[dict]]]:
    """Notifiche raggruppate per tipo, nell'ordine delle sezioni del riepilogo."""
    lang = locale if locale in ("it", "en") else "it"
    out, used = [], set()
    for kinds, title in SECTIONS:
        group = [i for i in items if i["kind"] in kinds]
        used.update(i["id"] for i in group)
        if group:
            out.append((title[lang], group))
    rest = [i for i in items if i["id"] not in used]
    if rest:
        out.append((OTHER[lang], rest))
    return out


def send_daily_digests(conn: psycopg.Connection, mailer, base_url: str, now: datetime | None = None) -> int:
    """Un'email per utente con le notifiche non ancora inviate delle ultime 24 ore: tutte per chi ha scelto il
    riepilogo, solo quelle dei documenti seguiti per chi le vuole raccolte (predefinito)."""
    now = now or datetime.now(UTC)
    rows = conn.execute(
        """SELECT n.id, n.user_id, n.kind, n.title, n.link, u.email, u.first_name, u.locale
           FROM cde.notifications n JOIN cde.users u ON u.id = n.user_id AND u.status = 'ACTIVE'
           LEFT JOIN cde.notification_preferences p ON p.user_id = n.user_id
           WHERE n.emailed_at IS NULL AND n.created_at > %s AND n.created_at <= %s
             AND coalesce(p.email_enabled, true)
             AND (coalesce(p.daily_digest, false)
                  OR (n.kind = 'DOCUMENT_FOLLOWED' AND coalesce(p.follow_digest, true)))
           ORDER BY n.user_id, n.id""", [now - timedelta(hours=24), now]).fetchall()
    by_user: dict = {}
    for r in rows:
        by_user.setdefault(r["user_id"], []).append(r)
    for items in by_user.values():
        first = items[0]
        mailer.send(first["email"], DIGEST_SUBJECT.get(first["locale"], DIGEST_SUBJECT["it"]),
                    render("digest", first["locale"], first_name=first["first_name"], items=items,
                           sections=sections(items, first["locale"]), base_url=base_url))
        conn.execute("UPDATE cde.notifications SET emailed_at = now() WHERE id = ANY(%s)", [[i["id"] for i in items]])
        conn.commit()
    return len(by_user)
