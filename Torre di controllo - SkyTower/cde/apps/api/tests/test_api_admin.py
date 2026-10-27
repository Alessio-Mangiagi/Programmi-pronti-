# "><(((º> sabusabu <º)))><"
"""API di amministrazione e isolamento via HTTP (guard + RLS, 404 vs 403)."""
from __future__ import annotations

import uuid

import pytest

from cde_api.tooling.demo_seed import DEMO_PASSWORD


@pytest.fixture
def as_user(client, api_world):
    _, w = api_world
    tokens: dict[str, str] = {}

    def headers(user: str) -> dict:
        if user not in tokens:
            client.app.state.services.limiter.reset()
            r = client.post("/auth/login", json={"email": w.emails[user], "password": DEMO_PASSWORD})
            assert r.status_code == 200, r.text
            tokens[user] = r.json()["access_token"]
        return {"Authorization": f"Bearer {tokens[user]}"}
    return headers


def ids(resp):
    assert resp.status_code == 200, resp.text
    return {uuid.UUID(x["id"]) for x in resp.json()}


def test_T1_lista_container_subappaltatore(client, api_world, as_user):
    _, w = api_world
    seen = ids(client.get(f"/projects/{w.project_id}/containers", headers=as_user("sub1_user")))
    assert seen == {w.containers["sub1_root"]}


def test_T2_container_altrui_404_non_403(client, api_world, as_user):
    _, w = api_world
    r = client.get(f"/containers/{w.containers['des_root']}", headers=as_user("sub1_user"))
    assert r.status_code == 404
    r = client.get(f"/containers/{uuid.uuid4()}", headers=as_user("sub1_user"))
    assert r.status_code == 404


def test_progetto_altrui_404(client, api_world, as_user):
    _, w = api_world
    assert client.get(f"/projects/{w.project2_id}", headers=as_user("sub1_user")).status_code == 404
    assert client.get(f"/projects/{w.project2_id}/containers", headers=as_user("sub1_user")).status_code == 404


def test_T3_T5_grant_via_api_e_revoca(client, api_world, as_user):
    _, w = api_world
    r = client.post(f"/containers/{w.containers['des_arch']}/grants", headers=as_user("des_admin"),
                    json={"grantee_type": "ORGANIZATION", "grantee_organization_id": str(w.orgs["SUB1"]),
                          "actions": ["READ", "DOWNLOAD"], "reason": "Coordinamento impianti"})
    assert r.status_code == 201, r.text
    grant_id = r.json()["id"]
    seen = ids(client.get(f"/projects/{w.project_id}/containers", headers=as_user("sub1_user")))
    assert {w.containers["des_arch"], w.containers["des_arch_det"]} <= seen
    c = client.get(f"/containers/{w.containers['des_arch']}", headers=as_user("sub1_user")).json()
    assert set(c["my_actions"]) == {"READ", "DOWNLOAD"}

    assert client.delete(f"/containers/{w.containers['des_arch']}/grants/{grant_id}",
                         headers=as_user("des_admin")).status_code == 204
    assert client.get(f"/containers/{w.containers['des_arch']}", headers=as_user("sub1_user")).status_code == 404
    assert client.delete(f"/containers/{w.containers['des_arch']}/grants/{grant_id}",
                         headers=as_user("des_admin")).status_code == 404


def test_grant_richiede_admin_del_container(client, api_world, as_user):
    _, w = api_world
    body = {"grantee_type": "ORGANIZATION", "grantee_organization_id": str(w.orgs["SUB1"]),
            "actions": ["READ"], "reason": "tentativo"}
    assert client.post(f"/containers/{w.containers['des_arch']}/grants", headers=as_user("des_lead"),
                       json=body).status_code == 403
    assert client.post(f"/containers/{w.containers['des_arch']}/grants", headers=as_user("sub1_admin"),
                       json=body).status_code == 404


def test_grant_admin_rifiutato_dalla_validazione(client, api_world, as_user):
    _, w = api_world
    r = client.post(f"/containers/{w.containers['des_arch']}/grants", headers=as_user("des_admin"),
                    json={"grantee_type": "ORGANIZATION", "grantee_organization_id": str(w.orgs["SUB1"]),
                          "actions": ["ADMIN"], "reason": "no"})
    assert r.status_code == 422


def test_grant_verso_org_esterna_422(client, api_world, as_user):
    _, w = api_world
    r = client.post(f"/containers/{w.containers['des_arch']}/grants", headers=as_user("des_admin"),
                    json={"grantee_type": "ORGANIZATION", "grantee_organization_id": str(w.orgs["OUT"]),
                          "actions": ["READ"], "reason": "fuori progetto"})
    assert r.status_code == 422
    assert "non partecipa" in r.json()["error"]["message"]


def test_T4_grant_write_a_viewer_non_permette_scrittura(client, api_world, as_user):
    _, w = api_world
    r = client.post(f"/containers/{w.containers['des_arch']}/grants", headers=as_user("des_admin"),
                    json={"grantee_type": "USER", "grantee_user_id": str(w.users["sub1_viewer"]),
                          "actions": ["READ", "WRITE"], "reason": "verifica T4"})
    assert r.status_code == 201
    try:
        c = client.get(f"/containers/{w.containers['des_arch']}", headers=as_user("sub1_viewer")).json()
        assert c["my_actions"] == ["READ"]
        r = client.post(f"/projects/{w.project_id}/containers", headers=as_user("sub1_viewer"),
                        json={"name": "abuso", "parent_id": str(w.containers["des_arch"])})
        assert r.status_code == 403
    finally:
        client.delete(f"/containers/{w.containers['des_arch']}/grants/{r.json().get('id', uuid.uuid4())}",
                      headers=as_user("des_admin"))


def test_creazione_container_e_sottocartella(client, api_world, as_user):
    _, w = api_world
    h = as_user("sub2_user")
    r = client.post(f"/projects/{w.project_id}/containers", headers=h, json={"name": f"Officina {uuid.uuid4().hex[:6]}"})
    assert r.status_code == 201, r.text
    root = r.json()
    assert root["owner_organization_code"] == "SUB2" and "WRITE" in root["my_actions"]
    child = client.post(f"/projects/{w.project_id}/containers", headers=h,
                        json={"name": "Saldature", "parent_id": root["id"]})
    assert child.status_code == 201
    # nome duplicato nello stesso padre
    dup = client.post(f"/projects/{w.project_id}/containers", headers=h,
                      json={"name": "Saldature", "parent_id": root["id"]})
    assert dup.status_code == 409
    # sotto un container non visibile
    hidden = client.post(f"/projects/{w.project_id}/containers", headers=h,
                         json={"name": "x", "parent_id": str(w.containers["des_root"])})
    assert hidden.status_code == 404


def test_viewer_non_crea_container_radice(client, api_world, as_user):
    _, w = api_world
    r = client.post(f"/projects/{w.project_id}/containers", headers=as_user("des_viewer"), json={"name": "x"})
    assert r.status_code == 403


def test_T8_org_admin_non_aggiunge_utenti_di_altre_org(client, api_world, as_user):
    _, w = api_world
    r = client.post(f"/projects/{w.project_id}/members", headers=as_user("sub1_admin"),
                    json={"user_id": str(w.users["des_designer"]), "role_id": str(w.roles["VIEWER"])})
    assert r.status_code == 403


def test_org_admin_non_si_promuove_project_admin(client, api_world, as_user):
    _, w = api_world
    r = client.post(f"/projects/{w.project_id}/members", headers=as_user("sub1_admin"),
                    json={"user_id": str(w.users["sub1_admin"]), "role_id": str(w.roles["PROJECT_ADMIN"])})
    assert r.status_code == 403


def test_T6_membro_di_org_non_partecipante(client, api_world, as_user):
    _, w = api_world
    r = client.post(f"/projects/{w.project_id}/members", headers=as_user("com_admin"),
                    json={"user_id": str(w.users["out_user"]), "role_id": str(w.roles["VIEWER"])})
    assert r.status_code == 422


def test_flusso_completo_project_admin(client, api_world, as_user):
    """Crea progetto, invita org, aggiunge membro, ruolo personalizzato, matrice."""
    _, w = api_world
    h = as_user("com_admin")
    code = "T" + uuid.uuid4().hex[:4].upper()
    p = client.post("/projects", headers=h, json={"code": code, "name": "Ponte sul fiume"})
    assert p.status_code == 201, p.text
    pid = p.json()["id"]
    assert p.json()["owner_organization_id"] == str(w.orgs["COM"])

    org = client.get("/organizations/lookup/des", headers=h)
    assert org.status_code == 200 and org.json()["code"] == "DES"
    r = client.post(f"/projects/{pid}/organizations", headers=h,
                    json={"organization_id": org.json()["id"], "party_role": "APPOINTED_PARTY"})
    assert r.status_code == 201, r.text

    cands = client.get(f"/projects/{pid}/candidates", headers=h).json()
    assert str(w.users["des_lead"]) in {c["id"] for c in cands}
    r = client.post(f"/projects/{pid}/members", headers=h,
                    json={"user_id": str(w.users["des_lead"]), "role_id": str(w.roles["LEAD_DESIGNER"])})
    assert r.status_code == 201, r.text
    assert r.json()["organization_code"] == "DES"

    role = client.post(f"/projects/{pid}/roles", headers=h,
                       json={"code": "BIM_COORDINATOR", "name": "Coordinatore BIM",
                             "permissions": [{"action": "READ", "scope": "PROJECT"},
                                             {"action": "WRITE", "scope": "OWN_ORGANIZATION"}]})
    assert role.status_code == 201, role.text
    matrix = client.get(f"/projects/{pid}/permission-matrix", headers=h).json()
    bim = next(r for r in matrix["roles"] if r["code"] == "BIM_COORDINATOR")
    assert bim["cells"] == {"READ": "PROJECT", "WRITE": "OWN_ORGANIZATION", "DOWNLOAD": None,
                            "APPROVE": None, "ADMIN": None}
    pa = next(r for r in matrix["roles"] if r["code"] == "PROJECT_ADMIN")
    assert set(pa["cells"].values()) == {"PROJECT"}

    upd = client.patch(f"/projects/{pid}/roles/{role.json()['id']}", headers=h,
                       json={"permissions": [{"action": "READ", "scope": "OWN_ORGANIZATION"}]})
    assert upd.status_code == 200 and upd.json()["permissions"] == [{"action": "READ", "scope": "OWN_ORGANIZATION"}]
    sys_role = client.patch(f"/projects/{pid}/roles/{w.roles['VIEWER']}", headers=h, json={"name": "Visore"})
    assert sys_role.status_code == 403

    # il progettista ora vede il nuovo progetto, il subappaltatore no
    assert client.get(f"/projects/{pid}", headers=as_user("des_lead")).status_code == 200
    assert client.get(f"/projects/{pid}", headers=as_user("sub1_user")).status_code == 404

    # ultimo PROJECT_ADMIN non rimovibile
    r = client.delete(f"/projects/{pid}/members/{w.users['com_admin']}/{w.roles['PROJECT_ADMIN']}", headers=h)
    assert r.status_code == 409


def test_creazione_progetto_solo_org_admin(client, api_world, as_user):
    _, w = api_world
    r = client.post("/projects", headers=as_user("des_lead"), json={"code": "NOPE", "name": "Non ammesso"})
    assert r.status_code == 403


def test_modifica_progetto_solo_admin(client, api_world, as_user):
    _, w = api_world
    assert client.patch(f"/projects/{w.project_id}", headers=as_user("des_lead"),
                        json={"name": "Rinomina abusiva"}).status_code == 403
    r = client.patch(f"/projects/{w.project_id}", headers=as_user("com_admin"), json={"description": "Lotto 1"})
    assert r.status_code == 200 and r.json()["description"] == "Lotto 1"


def test_me_projects_ruoli(client, api_world, as_user):
    _, w = api_world
    r = client.get("/me/projects", headers=as_user("des_lead"))
    proj = next(p for p in r.json() if p["id"] == str(w.project_id))
    assert proj["my_roles"] == ["LEAD_DESIGNER"]


def test_platform_admin_crea_organizzazione(client, api_world, as_user):
    code = "N" + uuid.uuid4().hex[:4].upper()
    r = client.post("/organizations", headers=as_user("platform"), json={"legal_name": "Nuova Srl", "code": code})
    assert r.status_code == 201, r.text
    assert client.post("/organizations", headers=as_user("com_admin"),
                       json={"legal_name": "Abusiva Srl", "code": "ABU1"}).status_code == 403


def test_organizzazioni_visibili(client, api_world, as_user):
    _, w = api_world
    seen = ids(client.get("/organizations", headers=as_user("sub1_user")))
    assert w.orgs["OUT"] not in seen and w.orgs["DES"] in seen
    assert client.get(f"/organizations/{w.orgs['OUT']}", headers=as_user("sub1_user")).status_code == 404


def test_disabilitare_utente_blocca_subito_l_accesso(client, api_world, as_user):
    _, w = api_world
    h_target = as_user("sub1_nomember")
    assert client.get("/me", headers=h_target).status_code == 200
    r = client.patch(f"/organizations/{w.orgs['SUB1']}/users/{w.users['sub1_nomember']}",
                     headers=as_user("sub1_admin"), json={"status": "DISABLED"})
    assert r.status_code == 200
    try:
        assert client.get("/me", headers=h_target).status_code == 401   # token ancora valido ma RLS nega
    finally:
        client.patch(f"/organizations/{w.orgs['SUB1']}/users/{w.users['sub1_nomember']}",
                     headers=as_user("sub1_admin"), json={"status": "ACTIVE"})
