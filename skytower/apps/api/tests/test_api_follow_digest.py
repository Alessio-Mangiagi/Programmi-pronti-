# "><(((º> sabusabu <º)))><"
"""Documenti seguiti nel riepilogo giornaliero: per impostazione predefinita gli avvisi "Segui" non partono come
email immediate ma arrivano nel riepilogo del mattino, diviso per tipo; compiti e RFI restano immediati.
Chi vuole anche i "Segui" subito lo sceglie nelle preferenze."""
from __future__ import annotations

import psycopg
from psycopg.rows import dict_row
from test_api_naming_auto import as_user  # noqa: F401 - fixture riusata

from cde_api.mail import ConsoleMailer
from cde_api.notifier import sections, send_daily_digests

PREFS = "/me/notification-preferences"


def _notify(urls, user, project, kind, title) -> int:
    with psycopg.connect(urls.owner, autocommit=True) as conn:
        return conn.execute("SELECT cde.notify(%s, %s, %s, %s, 'corpo', '/compiti')",
                            [user, project, kind, title]).fetchone()[0]


def _immediate(urls, nid) -> bool:
    with psycopg.connect(urls.worker, row_factory=dict_row) as conn:
        return conn.execute("SELECT count(*) n FROM jobs.procrastinate_jobs WHERE task_name = "
                            "'cde.send_notification_email' AND (args->>'notification_id')::bigint = %s",
                            [nid]).fetchone()["n"] == 1


def test_segui_nel_riepilogo(client, api_world, as_user):  # noqa: F811
    urls, w = api_world
    h = as_user("des_designer")
    prefs = client.get(PREFS, headers=h).json()
    assert prefs["follow_digest"] is True                       # predefinito
    user, project = w.users["des_designer"], w.project_id
    followed = _notify(urls, user, project, "DOCUMENT_FOLLOWED", "Nuova revisione di Prospetto nord")
    task = _notify(urls, user, project, "TASK_ASSIGNED", "Compito: verifica tavola")
    assert not _immediate(urls, followed) and _immediate(urls, task)

    mailer = ConsoleMailer()
    with psycopg.connect(urls.worker, row_factory=dict_row) as conn:
        send_daily_digests(conn, mailer, "https://cde.example")
    mail = next(m for m in mailer.outbox if m.to == w.emails["des_designer"])
    assert "Documenti che segui (1)" in mail.body and "Nuova revisione di Prospetto nord" in mail.body
    assert "Compito: verifica tavola" not in mail.body           # già partito come email immediata

    try:
        r = client.put(PREFS, headers=h, json={**prefs, "follow_digest": False})
        assert r.status_code == 200 and client.get(PREFS, headers=h).json()["follow_digest"] is False
        again = _notify(urls, user, project, "DOCUMENT_FOLLOWED", "Prospetto nord pubblicato")
        assert _immediate(urls, again)
    finally:
        client.put(PREFS, headers=h, json=prefs)


def test_sezioni_del_riepilogo():
    items = [{"id": 1, "kind": "DOCUMENT_FOLLOWED"}, {"id": 2, "kind": "TASK_ASSIGNED"}, {"id": 3, "kind": "NUOVO"},
             {"id": 4, "kind": "RFI_OVERDUE"}]
    assert [(t, [i["id"] for i in g]) for t, g in sections(items, "it")] == [
        ("Approvazioni e compiti", [2]), ("RFI", [4]), ("Documenti che segui", [1]), ("Altro", [3])]
    assert sections(items, "en")[0][0] == "Approvals and tasks"
