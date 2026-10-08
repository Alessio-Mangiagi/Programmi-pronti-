"""
Statistiche di progetto per la dashboard (giorno 28): solo query aggregate in SQL,
niente conteggi in Python. Funziona su SQLite e Postgres (date con func.date /
cast a DATE, portabile via `func.date` che SQLAlchemy rende su entrambi).

Filtri (tutti opzionali, in AND): intervallo date sulla creazione (`date_from`,
`date_to` inclusi), `template_id` (sulle submission), `plan_id`, `assigned_to`
(sui task).
"""
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from . import models
from .models import TaskStatus, utcnow

STATUSES = [s.value for s in TaskStatus]


def _day(col):
    return func.date(col)


def project_stats(db: Session, project_id: str, *, date_from: Optional[datetime] = None, date_to: Optional[datetime] = None,
                  template_id: Optional[str] = None, plan_id: Optional[str] = None, assigned_to: Optional[str] = None,
                  days: int = 30) -> dict:
    now = utcnow()
    if date_to is not None and date_to.time() == datetime.min.time():
        date_to = date_to.replace(hour=23, minute=59, second=59, microsecond=999999)

    plans_q = db.query(models.Plan.id, models.Plan.name).filter(models.Plan.project_id == project_id)
    if plan_id:
        plans_q = plans_q.filter(models.Plan.id == plan_id)
    plans = plans_q.all()
    plan_ids = [p.id for p in plans]
    plan_name = {p.id: p.name for p in plans}

    # ---- task ----
    # Task del progetto: sui pin vivi delle planimetrie (scelte) e, senza filtro per
    # planimetria, anche quelli sul cantiere (nati da moduli su WBS o generali).
    t = models.Task
    on_plans = and_(models.Pin.plan_id.in_(plan_ids), models.Pin.deleted_at.is_(None))
    task_scope = on_plans if plan_id else or_(on_plans, t.project_id == project_id)

    def tasks_q(*cols):
        return db.query(*cols).select_from(t).outerjoin(models.Pin, t.pin_id == models.Pin.id).filter(task_scope, t.deleted_at.is_(None))

    task_filters = []
    if date_from is not None:
        task_filters.append(t.created_at >= date_from)
    if date_to is not None:
        task_filters.append(t.created_at <= date_to)
    if assigned_to:
        task_filters.append(t.assigned_to == assigned_to)
    task_where = and_(*task_filters) if task_filters else True

    by_status = dict(tasks_q(t.status, func.count()).filter(task_where).group_by(t.status).all())
    tasks_by_status = {s: int(by_status.get(TaskStatus(s), 0)) for s in STATUSES}

    open_by_plan_rows = (
        tasks_q(models.Pin.plan_id, func.count())
        .filter(on_plans, task_where, t.status.in_([TaskStatus.open, TaskStatus.assigned]))
        .group_by(models.Pin.plan_id).all()
    )
    open_by_plan_map = {pid: int(n) for pid, n in open_by_plan_rows}
    open_by_plan = [{"plan_id": pid, "plan_name": plan_name[pid], "open": open_by_plan_map.get(pid, 0)} for pid in plan_ids]
    if not plan_id:
        # task sul cantiere: una barra in più, solo se ce ne sono di aperti
        open_site = int(tasks_q(func.count(t.id)).filter(t.project_id == project_id, task_where,
                                                          t.status.in_([TaskStatus.open, TaskStatus.assigned])).scalar() or 0)
        if open_site:
            open_by_plan.append({"plan_id": None, "plan_name": "Cantiere (WBS e generali)", "open": open_site})

    overdue = int(
        tasks_q(func.count(t.id))
        .filter(task_where, t.due_date.isnot(None), t.due_date < now, t.status.notin_([TaskStatus.verified, TaskStatus.resolved]))
        .scalar() or 0
    )
    week_ago = now - timedelta(days=7)
    closed_7d = int(
        tasks_q(func.count(t.id)).filter(task_where, t.resolved_at.isnot(None), t.resolved_at >= week_ago).scalar() or 0
    )

    # serie giornaliera: creati e risolti negli ultimi `days` giorni (0 dove non c'è nulla)
    start = (now - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    by_assignee = [t.assigned_to == assigned_to] if assigned_to else []
    created_rows = tasks_q(_day(t.created_at), func.count()).filter(t.created_at >= start, *by_assignee).group_by(_day(t.created_at)).all()
    resolved_rows = tasks_q(_day(t.resolved_at), func.count()).filter(t.resolved_at >= start, *by_assignee).group_by(_day(t.resolved_at)).all()
    created_map = {str(d): int(n) for d, n in created_rows}
    resolved_map = {str(d): int(n) for d, n in resolved_rows}
    series = []
    for i in range(days):
        d = (start + timedelta(days=i)).date().isoformat()
        series.append({"date": d, "created": created_map.get(d, 0), "resolved": resolved_map.get(d, 0)})

    # ---- submission per template ----
    # Sui pin delle planimetrie e, senza filtro per planimetria, anche su voci WBS e generali.
    s = models.FormSubmission
    sub_filters = []
    if date_from is not None:
        sub_filters.append(s.created_at >= date_from)
    if date_to is not None:
        sub_filters.append(s.created_at <= date_to)
    if template_id:
        sub_filters.append(s.template_id == template_id)
    sub_on_plans = and_(models.Pin.plan_id.in_(plan_ids), models.Pin.deleted_at.is_(None))
    sub_scope = sub_on_plans if plan_id else or_(sub_on_plans, models.WbsNode.project_id == project_id, s.project_id == project_id)
    sub_rows = (
        db.query(s.template_id, models.FormTemplate.name, func.count())
        .select_from(s)
        .outerjoin(models.Pin, s.pin_id == models.Pin.id)
        .outerjoin(models.WbsNode, s.wbs_node_id == models.WbsNode.id)
        .join(models.FormTemplate, models.FormTemplate.id == s.template_id)
        .filter(sub_scope, s.deleted_at.is_(None), *sub_filters)
        .group_by(s.template_id, models.FormTemplate.name).order_by(func.count().desc()).all()
    )
    submissions_by_template = [{"template_id": tid, "template_name": name, "count": int(n)} for tid, name, n in sub_rows]

    pins_total = int(db.query(func.count(models.Pin.id))
                     .filter(models.Pin.plan_id.in_(plan_ids), models.Pin.deleted_at.is_(None)).scalar() or 0)

    return {
        "project_id": project_id,
        "generated_at": now,
        "tasks_by_status": tasks_by_status,
        "tasks_total": sum(tasks_by_status.values()),
        "open_by_plan": open_by_plan,
        "submissions_by_template": submissions_by_template,
        "submissions_total": sum(x["count"] for x in submissions_by_template),
        "series": series,
        "overdue": overdue,
        "closed_last_7d": closed_7d,
        "pins_total": pins_total,
    }


def mark_resolved_at(task: models.Task, old_status: Optional[str]) -> None:
    """resolved_at = primo passaggio a resolved; riaperto -> azzerato."""
    new = task.status.value if isinstance(task.status, TaskStatus) else task.status
    if new == "resolved" and old_status != "resolved":
        task.resolved_at = utcnow()
    elif new == "open":
        task.resolved_at = None


