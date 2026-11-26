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
    # WORKFLOW_NOTIFICATION / WORKFLOW_CANCELLED: nodi "notifica" e interruzioni dei workflow a grafo (0039)
    # WORKFLOW_CLARIFICATION_* / WORKFLOW_CHANGES_REQUESTED: tornare indietro da un nodo (0042, ADR-51)
    ({"TASK_ASSIGNED", "TASK_REMINDER", "TASK_OVERDUE", "TASK_ESCALATED", "WORKFLOW_APPROVED", "WORKFLOW_REJECTED",
      "WORKFLOW_NOTIFICATION", "WORKFLOW_CANCELLED", "WORKFLOW_CLARIFICATION_REQUESTED",
      "WORKFLOW_CLARIFICATION_ANSWERED", "WORKFLOW_CHANGES_REQUESTED"},
     {"it": "Approvazioni e compiti", "en": "Approvals and tasks"}),
    ({"RFI_CREATED", "RFI_REMINDER", "RFI_OVERDUE"}, {"it": "RFI", "en": "RFIs"}),
    # discussioni e task fra le persone della commessa (0047, ADR-59)
    ({"TEAM_TASK_ASSIGNED", "TEAM_TASK_COMMENT", "TEAM_TASK_COMPLETED", "TEAM_TASK_REOPENED", "TEAM_TASK_DUE_CHANGED",
      "TEAM_TASK_REMINDER", "TEAM_TASK_OVERDUE"}, {"it": "Task", "en": "Tasks"}),
    ({"DISCUSSION_ADDED", "DISCUSSION_MESSAGE"}, {"it": "Discussioni", "en": "Discussions"}),
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


# ---------------------------------------------------------------------
# Riepilogo di chi ha assegnato task (ADR-59): ogni mattina dei giorni feriali, a chi ha dato task ad altri, lo
# stato di ciascuno e cosa hanno fatto le persone assegnate dall'ultimo riepilogo. Scelta 4c dell'utente del
# 26/11/2026: "solo per chi ha assegnato il task, per supervisionare l'avanzamento".
# ---------------------------------------------------------------------
TEAM_DIGEST_SUBJECT = {"it": "Avanzamento dei task che hai assegnato", "en": "Progress of the tasks you assigned"}
_STATUS = {"it": {"TODO": "Da fare", "IN_PROGRESS": "In corso", "DONE": "Fatto"},
           "en": {"TODO": "To do", "IN_PROGRESS": "In progress", "DONE": "Done"}}
_PRIORITY = {"it": {"LOW": "bassa", "HIGH": "alta", "URGENT": "urgente"},
             "en": {"LOW": "low", "HIGH": "high", "URGENT": "urgent"}}
# gruppi della sezione di ogni commessa, nell'ordine in cui si leggono
_GROUPS = [("done", {"it": "Completati", "en": "Completed"}), ("late", {"it": "In ritardo", "en": "Overdue"}),
           ("IN_PROGRESS", {"it": "In corso", "en": "In progress"}), ("TODO", {"it": "Da fare", "en": "To do"})]


def _data(v: str | None) -> str:
    """'2026-11-28' o un timestamp ISO → '28/11/2026'."""
    if not v:
        return ""
    y, m, d = str(v)[:10].split("-")
    return f"{d}/{m}/{y}"


def _movimenti(events: list[dict], lang: str) -> list[str]:
    """Le righe "cosa è successo" di un task: commenti contati per persona, il resto uno per riga."""
    it = lang == "it"
    righe, commenti = [], {}
    for e in events:
        chi, k, d = e.get("actor") or ("il sistema" if it else "the system"), e["kind"], e.get("data") or {}
        if k == "COMMENT":
            commenti[chi] = commenti.get(chi, 0) + 1
        elif k == "STATUS":
            stato = _STATUS[lang].get(d.get("to"), d.get("to"))
            righe.append(f"{chi} l'ha spostato in «{stato}»" if it else f"{chi} moved it to “{stato}”")
        elif k in ("ITEM_DONE", "ITEM_REOPENED", "ITEM_ADDED", "ITEM_REMOVED"):
            verbo = {"ITEM_DONE": ("ha completato", "completed"), "ITEM_REOPENED": ("ha riaperto", "reopened"),
                     "ITEM_ADDED": ("ha aggiunto", "added"), "ITEM_REMOVED": ("ha tolto", "removed")}[k][0 if it else 1]
            righe.append(f"{chi} {verbo} il sotto-task «{d.get('title', '')}»" if it
                         else f"{chi} {verbo} the subtask “{d.get('title', '')}”")
        elif k == "OVERDUE":
            righe.append("scadenza superata" if it else "deadline passed")
    for chi, n in commenti.items():
        righe.append((f"{n} comment{'o' if n == 1 else 'i'} di {chi}") if it else f"{n} comment{'s' if n > 1 else ''} by {chi}")
    return righe


def team_digest_projects(tasks: list[dict], locale: str, base_url: str) -> list[dict]:
    """I task del riepilogo divisi per commessa e, dentro, in completati / in ritardo / in corso / da fare, con la
    riga descrittiva e i movimenti già scritti nella lingua di chi riceve."""
    lang = locale if locale in ("it", "en") else "it"
    it = lang == "it"
    projects: dict = {}
    for t in tasks:
        gruppo = "done" if t["status"] == "DONE" else "late" if t["overdue"] else t["status"]
        parti = [t["assignees"] or ""]
        if t["items_total"]:
            parti.append(f"sotto-task {t['items_done']}/{t['items_total']}" if it
                         else f"subtasks {t['items_done']}/{t['items_total']}")
        if t["status"] == "DONE":
            parti.append(f"completato da {t['completed_by']} il {_data(t['completed_at'])}" if it
                         else f"completed by {t['completed_by']} on {_data(t['completed_at'])}")
        elif t["due_on"]:
            parti.append(f"scadenza {_data(t['due_on'])}" if it else f"due {_data(t['due_on'])}")
        if t["priority"] in _PRIORITY[lang] and t["status"] != "DONE":
            parti.append(f"priorità {_PRIORITY[lang][t['priority']]}" if it else f"{_PRIORITY[lang][t['priority']]} priority")
        p = projects.setdefault(t["project_id"], {"title": f"{t['project_code']} — {t['project_name']}",
                                                  "groups": {g: [] for g, _ in _GROUPS}})
        p["groups"][gruppo].append({
            "line": f"{t['code']} {t['title']} — " + " · ".join(x for x in parti if x),
            "events": _movimenti(t["events"], lang),
            "link": f"{base_url}/progetti/{t['project_id']}/task/{t['id']}",
        })
    return [{"title": p["title"],
             "groups": [(titolo[lang], p["groups"][g]) for g, titolo in _GROUPS if p["groups"][g]]}
            for p in projects.values()]


def send_team_task_digests(conn: psycopg.Connection, mailer, base_url: str, now: datetime | None = None) -> int:
    """Un'email per chi ha dato task ad altri ancora aperti (o completati dall'ultimo riepilogo). Chi riceve, cosa
    e da quando lo decide ``cde.team_task_supervision`` (email attive, riepilogo non spento, non già mandato nelle
    ultime 20 ore); ``cde.team_task_digest_sent`` segna l'invio, così un job ripetuto non manda doppioni."""
    now = now or datetime.now(UTC)
    rows = conn.execute("SELECT * FROM cde.team_task_supervision(%s)", [now]).fetchall()
    for r in rows:
        lang = r["locale"] if r["locale"] in ("it", "en") else "it"
        ore = max(1, round((now - r["since"]).total_seconds() / 3600))
        finestra = ((f"nelle ultime {ore} ore" if ore <= 36 else f"negli ultimi {round(ore / 24)} giorni") if lang == "it"
                    else (f"in the last {ore} hours" if ore <= 36 else f"in the last {round(ore / 24)} days"))
        moved = sum(1 for t in r["tasks"] if any(e["kind"] != "OVERDUE" for e in t["events"]))
        mailer.send(r["email"], TEAM_DIGEST_SUBJECT[lang],
                    render("team_task_digest", lang, first_name=r["first_name"], count=len(r["tasks"]),
                           moved=moved, window=finestra, projects=team_digest_projects(r["tasks"], lang, base_url)))
        conn.execute("SELECT cde.team_task_digest_sent(%s, %s)", [r["user_id"], now])
        conn.commit()
    return len(rows)
