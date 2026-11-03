# "><(((º> sabusabu <º)))><"
"""Cruscotto KPI della commessa per il Project Manager (solo Project Admin), filtrabile per azienda e disciplina."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query

from ..deps import Ctx, ctx

router = APIRouter(tags=["dashboard"])


@router.get("/projects/{project_id}/dashboard")
def dashboard(project_id: uuid.UUID, organization_id: uuid.UUID | None = None,
              discipline: str | None = Query(default=None, max_length=10), c: Ctx = Depends(ctx)):
    with c.tx() as conn:
        d = conn.execute("SELECT cde.project_dashboard(%s, %s, %s) AS d",
                         [project_id, organization_id, discipline]).fetchone()["d"]
        # Escalation (G35, migrazione 0036): la funzione SQL del cruscotto è della 0012; i dati dei solleciti
        # si aggiungono qui, sotto RLS, così il Project Manager vede chi è già stato avvisato e da quanto.
        scaduti = d.get("overdue_tasks") or []
        if scaduti:
            info = {str(r["id"]): r for r in conn.execute(
                """SELECT id, escalated_at, escalation_count,
                          floor(extract(epoch FROM now() - due_at) / 86400)::int AS days_late
                   FROM cde.tasks WHERE id = ANY(%s)""", [[uuid.UUID(t["task_id"]) for t in scaduti]]).fetchall()}
            for t in scaduti:
                r = info.get(t["task_id"], {})
                t["escalated_at"] = r.get("escalated_at").isoformat() if r.get("escalated_at") else None
                t["escalation_count"] = r.get("escalation_count", 0)
                t["days_late"] = r.get("days_late")
        return d
