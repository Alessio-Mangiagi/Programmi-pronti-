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
        return conn.execute("SELECT cde.project_dashboard(%s, %s, %s) AS d",
                            [project_id, organization_id, discipline]).fetchone()["d"]
