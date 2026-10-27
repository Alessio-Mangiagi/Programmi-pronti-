# "><(((º> sabusabu <º)))><"
"""Sprint 6 (G52): cruscotto KPI della commessa."""
from __future__ import annotations

import psycopg
from test_api_states import as_user, transition, worker  # noqa: F401 - fixture riusate
from test_api_workflows import shared, template  # noqa: F401


def kpi(client, headers, project_id, **params):
    return client.get(f"/projects/{project_id}/dashboard", headers=headers, params=params)


def test_cruscotto_solo_project_admin(client, api_world, as_user):  # noqa: F811
    _, w = api_world
    r = kpi(client, as_user("com_admin"), w.project_id)
    assert r.status_code == 200, r.text
    d = r.json()
    assert {"documents", "awaiting", "step_times", "bottlenecks", "uploads", "overdue_tasks", "rfis", "filters"} <= d.keys()
    assert any(o["code"] == "DES" for o in d["filters"]["organizations"])
    for user in ("des_lead", "des_admin", "com_dl", "sub1_user"):
        assert kpi(client, as_user(user), w.project_id).status_code == 403, user
    assert kpi(client, as_user("out_user"), w.project_id).status_code == 404


def test_kpi_seguono_documenti_e_workflow(client, api_world, as_user, template, shared):  # noqa: F811
    urls, w = api_world
    pa = as_user("com_admin")
    before = kpi(client, pa, w.project_id).json()
    inst = client.post(f"/revisions/{shared['id']}/workflows", headers=as_user("des_lead"),
                       json={"template_id": template["id"]}).json()
    try:
        # scadenza superata sul primo compito
        with psycopg.connect(urls.owner) as conn:
            conn.execute("UPDATE cde.tasks SET due_at = now() - interval '2 days' WHERE instance_id = %s", [inst["id"]])
        after = kpi(client, pa, w.project_id).json()
        assert after["awaiting"]["workflows_running"] == before["awaiting"]["workflows_running"] + 1
        assert after["awaiting"]["tasks_overdue"] >= before["awaiting"]["tasks_overdue"] + 1
        late = [t for t in after["overdue_tasks"] if t["document_id"] == shared["document_id"]]
        assert late and late[0]["step_name"] == "Verifica interna" and late[0]["organization_code"] == "DES"
        assert any(b["step_name"] == "Verifica interna" and b["overdue"] >= 1 for b in after["bottlenecks"])
        assert after["documents"]["by_state"].get("SHARED", 0) >= 1
        assert any(u["organization_code"] == "DES" for u in after["uploads"])

        # filtri: azienda e disciplina
        com = kpi(client, pa, w.project_id, organization_id=str(w.orgs["COM"])).json()
        assert not [t for t in com["overdue_tasks"] if t["document_id"] == shared["document_id"]]
        des = kpi(client, pa, w.project_id, organization_id=str(w.orgs["DES"]), discipline="A").json()
        assert [t for t in des["overdue_tasks"] if t["document_id"] == shared["document_id"]]
        assert kpi(client, pa, w.project_id, discipline="Z9").json()["documents"]["total"] == 0
    finally:
        client.post(f"/workflows/{inst['id']}/cancel", headers=as_user("des_lead"), json={"reason": "fine test"})
