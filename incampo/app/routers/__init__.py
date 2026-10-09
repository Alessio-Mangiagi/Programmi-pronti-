"""Endpoint dell'API divisi per dominio; `app/main.py` li monta in quest'ordine."""
from . import users, invites, audit_log, projects, commesse, plans, pins, wbs, pcq, submissions, tasks, files, sync, support

ALL = [users.router, invites.router, audit_log.router, projects.router, commesse.router, plans.router, pins.router, wbs.router, pcq.router, submissions.router, tasks.router, files.router, sync.router, support.router]
