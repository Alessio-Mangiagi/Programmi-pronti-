# "><(((º> sabusabu <º)))><"
"""Suite di isolamento cross-tenant a livello database (Sprint 1, G4/G9).

Ogni test si connette come cde_app (soggetto a RLS) e imposta app.user_id come farebbe l'API.
Gli scenari T1–T10 del piano sono marcati nel nome del test.
"""
from __future__ import annotations

import uuid

import psycopg
import pytest
from conftest import act_as, savepoint
from psycopg import errors

C = "SELECT id FROM cde.containers WHERE project_id = %s"


def container_ids(conn, world, user, project=None):
    act_as(conn, world.users[user])
    rows = conn.execute(C, [project or world.project_id]).fetchall()
    return {r["id"] for r in rows}


def names(world, *keys):
    return {world.containers[k] for k in keys}


def grant(owner_conn, world, container, *, org=None, user=None, actions=("READ",),
          valid_from="now()", valid_until="NULL", revoked=False):
    gtype = "USER" if user else "ORGANIZATION"
    return owner_conn.execute(
        f"""INSERT INTO cde.access_grants (project_id, container_id, grantee_type, grantee_user_id,
                grantee_organization_id, actions, reason, granted_by, valid_from, valid_until, revoked_at, revoked_by)
            VALUES (%s, %s, %s, %s, %s, %s::cde.permission_action[], 'test', %s, {valid_from}, {valid_until},
                    {'now()' if revoked else 'NULL'}, {'%s' if revoked else 'NULL'})
            RETURNING id""",
        [world.project_id, world.containers[container], gtype,
         world.users[user] if user else None, world.orgs[org] if org else None,
         list(actions), world.users["des_admin"]] + ([world.users["des_admin"]] if revoked else []),
    ).fetchone()["id"]


# =====================================================================
# Visibilità container
# =====================================================================

def test_T1_subappaltatore_vede_solo_i_propri_container(app_conn, world):
    assert container_ids(app_conn, world, "sub1_user") == names(world, "sub1_root")


def test_T2_container_di_altra_org_per_id_non_esiste(app_conn, world):
    act_as(app_conn, world.users["sub1_user"])
    row = app_conn.execute("SELECT id FROM cde.containers WHERE id = %s", [world.containers["des_root"]]).fetchone()
    assert row is None


def test_progettista_vede_tutto_il_perimetro_della_propria_org(app_conn, world):
    assert container_ids(app_conn, world, "des_lead") == names(world, "des_root", "des_arch", "des_arch_det",
                                                               "des_private")


def test_project_admin_vede_tutto_il_progetto_ma_non_altri_progetti(app_conn, world):
    seen = container_ids(app_conn, world, "com_admin")
    assert seen == {v for k, v in world.containers.items() if k != "out_root"}
    act_as(app_conn, world.users["com_admin"])
    assert app_conn.execute("SELECT 1 FROM cde.containers WHERE id = %s",
                            [world.containers["out_root"]]).fetchone() is None


def test_information_manager_legge_tutto_il_progetto(app_conn, world):
    assert container_ids(app_conn, world, "com_im") == {v for k, v in world.containers.items() if k != "out_root"}


def test_direttore_lavori_scope_own_org(app_conn, world):
    assert container_ids(app_conn, world, "com_dl") == names(world, "com_root")


def test_utente_esterno_non_vede_nulla_del_progetto(app_conn, world):
    assert container_ids(app_conn, world, "out_user") == set()
    assert container_ids(app_conn, world, "out_user", world.project2_id) == names(world, "out_root")


def test_utente_senza_membership_non_vede_nulla(app_conn, world):
    assert container_ids(app_conn, world, "sub1_nomember") == set()


@pytest.mark.parametrize("table", ["organizations", "users", "projects", "project_organizations", "roles",
                                   "role_permissions", "project_memberships", "containers", "access_grants"])
def test_T7_senza_app_user_id_zero_righe(app_conn, world, table):
    act_as(app_conn, None)
    assert app_conn.execute(f"SELECT count(*) AS n FROM cde.{table}").fetchone()["n"] == 0


def test_T7_utente_inesistente_zero_righe(app_conn, world):
    act_as(app_conn, uuid.uuid4())
    assert app_conn.execute("SELECT count(*) AS n FROM cde.containers").fetchone()["n"] == 0
    assert app_conn.execute("SELECT count(*) AS n FROM cde.users").fetchone()["n"] == 0


# =====================================================================
# Grant espliciti (T3–T5)
# =====================================================================

def test_T3_grant_org_su_cartella_eredita_sulle_sottocartelle(app_conn, owner_conn, world):
    grant(owner_conn, world, "des_arch", org="SUB1")
    owner_conn.commit()
    try:
        assert container_ids(app_conn, world, "sub1_user") == names(world, "sub1_root", "des_arch", "des_arch_det")
        assert container_ids(app_conn, world, "sub2_user") == names(world, "sub2_root")
    finally:
        owner_conn.execute("DELETE FROM cde.access_grants")
        owner_conn.commit()


def test_grant_su_radice_non_attraversa_inherit_false(app_conn, owner_conn, world):
    grant(owner_conn, world, "des_root", org="SUB1")
    owner_conn.commit()
    try:
        seen = container_ids(app_conn, world, "sub1_user")
        assert seen == names(world, "sub1_root", "des_root", "des_arch", "des_arch_det")
        assert world.containers["des_private"] not in seen
    finally:
        owner_conn.execute("DELETE FROM cde.access_grants")
        owner_conn.commit()


def test_grant_a_utente_non_si_estende_ai_colleghi(app_conn, owner_conn, world):
    grant(owner_conn, world, "des_arch", user="sub1_user")
    owner_conn.commit()
    try:
        assert world.containers["des_arch"] in container_ids(app_conn, world, "sub1_user")
        assert world.containers["des_arch"] not in container_ids(app_conn, world, "sub1_viewer")
    finally:
        owner_conn.execute("DELETE FROM cde.access_grants")
        owner_conn.commit()


def test_T4_grant_write_non_amplia_ruolo_viewer(app_conn, owner_conn, world):
    grant(owner_conn, world, "des_arch", user="sub1_viewer", actions=("READ", "WRITE"))
    owner_conn.commit()
    try:
        act_as(app_conn, world.users["sub1_viewer"])
        c = world.containers["des_arch"]
        perms = app_conn.execute(
            "SELECT cde.has_permission(%s, %s, 'READ') r, cde.has_permission(%s, %s, 'WRITE') w",
            [world.users["sub1_viewer"], c, world.users["sub1_viewer"], c]).fetchone()
        assert perms == {"r": True, "w": False}
        with pytest.raises(errors.InsufficientPrivilege), savepoint(app_conn):
            app_conn.execute(
                """INSERT INTO cde.containers (project_id, parent_id, owner_organization_id, name, created_by)
                   VALUES (%s, %s, %s, 'abuso', %s)""",
                [world.project_id, c, world.orgs["SUB1"], world.users["sub1_viewer"]])
    finally:
        owner_conn.execute("DELETE FROM cde.access_grants")
        owner_conn.commit()


def test_grant_solo_download_non_da_visibilita(app_conn, owner_conn, world):
    grant(owner_conn, world, "des_arch", org="SUB1", actions=("DOWNLOAD",))
    owner_conn.commit()
    try:
        assert world.containers["des_arch"] not in container_ids(app_conn, world, "sub1_user")
    finally:
        owner_conn.execute("DELETE FROM cde.access_grants")
        owner_conn.commit()


@pytest.mark.parametrize("kind", ["scaduto", "futuro", "revocato"])
def test_T5_grant_non_attivo_nega_accesso(app_conn, owner_conn, world, kind):
    kwargs = {
        "scaduto": dict(valid_from="now() - interval '2 days'", valid_until="now() - interval '1 day'"),
        "futuro": dict(valid_from="now() + interval '1 day'"),
        "revocato": dict(revoked=True),
    }[kind]
    grant(owner_conn, world, "des_arch", org="SUB1", **kwargs)
    owner_conn.commit()
    try:
        assert world.containers["des_arch"] not in container_ids(app_conn, world, "sub1_user")
    finally:
        owner_conn.execute("DELETE FROM cde.access_grants")
        owner_conn.commit()


def test_T5_revoca_ha_effetto_immediato(app_conn, owner_conn, world):
    gid = grant(owner_conn, world, "des_arch", org="SUB1")
    owner_conn.commit()
    try:
        assert world.containers["des_arch"] in container_ids(app_conn, world, "sub1_user")
        app_conn.rollback()
        act_as(app_conn, world.users["des_admin"])
        n = app_conn.execute(
            "UPDATE cde.access_grants SET revoked_at = now(), revoked_by = %s WHERE id = %s",
            [world.users["des_admin"], gid]).rowcount
        assert n == 1
        assert world.containers["des_arch"] not in container_ids(app_conn, world, "sub1_user")
    finally:
        app_conn.rollback()
        owner_conn.execute("DELETE FROM cde.access_grants")
        owner_conn.commit()


def test_solo_admin_del_container_crea_grant(app_conn, world):
    def try_grant(user):
        act_as(app_conn, world.users[user])
        app_conn.execute(
            """INSERT INTO cde.access_grants (project_id, container_id, grantee_type, grantee_organization_id,
                   actions, reason, granted_by) VALUES (%s, %s, 'ORGANIZATION', %s, '{READ}', 'coordinamento', %s)""",
            [world.project_id, world.containers["des_arch"], world.orgs["SUB1"], world.users[user]])

    with savepoint(app_conn):
        try_grant("des_admin")  # ORG_ADMIN = ADMIN OWN_ORGANIZATION
    for user in ("des_lead", "sub1_admin", "sub1_user"):
        with pytest.raises(errors.InsufficientPrivilege), savepoint(app_conn):
            try_grant(user)


def test_grant_firmato_a_nome_di_altri_rifiutato(app_conn, world):
    act_as(app_conn, world.users["des_admin"])
    with pytest.raises(errors.InsufficientPrivilege), savepoint(app_conn):
        app_conn.execute(
            """INSERT INTO cde.access_grants (project_id, container_id, grantee_type, grantee_organization_id,
                   actions, reason, granted_by) VALUES (%s, %s, 'ORGANIZATION', %s, '{READ}', 'x', %s)""",
            [world.project_id, world.containers["des_arch"], world.orgs["SUB1"], world.users["com_admin"]])


def test_grant_verso_org_non_partecipante_rifiutato(owner_conn, world):
    with pytest.raises(errors.CheckViolation), savepoint(owner_conn):
        grant(owner_conn, world, "des_arch", org="OUT")


def test_grant_admin_non_delegabile(owner_conn, world):
    with pytest.raises(errors.CheckViolation), savepoint(owner_conn):
        grant(owner_conn, world, "des_arch", org="SUB1", actions=("READ", "ADMIN"))


def test_grant_immutabile_e_revoca_unica(owner_conn, world):
    gid = grant(owner_conn, world, "des_arch", org="SUB1")
    with pytest.raises(errors.CheckViolation), savepoint(owner_conn):
        owner_conn.execute("UPDATE cde.access_grants SET actions = '{READ,WRITE}' WHERE id = %s", [gid])
    owner_conn.execute("UPDATE cde.access_grants SET revoked_at = now(), revoked_by = %s WHERE id = %s",
                       [world.users["des_admin"], gid])
    with pytest.raises(errors.CheckViolation), savepoint(owner_conn):
        owner_conn.execute("UPDATE cde.access_grants SET revoked_at = now(), revoked_by = %s WHERE id = %s",
                           [world.users["des_admin"], gid])


def test_destinatario_vede_solo_i_propri_grant(app_conn, owner_conn, world):
    g_sub1 = grant(owner_conn, world, "des_arch", org="SUB1")
    g_sub2 = grant(owner_conn, world, "des_arch", org="SUB2")
    owner_conn.commit()
    try:
        act_as(app_conn, world.users["sub1_user"])
        ids = {r["id"] for r in app_conn.execute("SELECT id FROM cde.access_grants").fetchall()}
        assert ids == {g_sub1}
        act_as(app_conn, world.users["des_admin"])
        ids = {r["id"] for r in app_conn.execute("SELECT id FROM cde.access_grants").fetchall()}
        assert ids == {g_sub1, g_sub2}
    finally:
        owner_conn.execute("DELETE FROM cde.access_grants")
        owner_conn.commit()


# =====================================================================
# Membership (T6, T8) ed escalation
# =====================================================================

def add_member(conn, world, actor, user, role, project=None):
    act_as(conn, world.users[actor])
    conn.execute("INSERT INTO cde.project_memberships (project_id, user_id, role_id, granted_by) VALUES (%s,%s,%s,%s)",
                 [project or world.project_id, world.users[user], world.roles[role], world.users[actor]])


def test_T6_utente_di_org_non_partecipante_rifiutato_dal_trigger(owner_conn, world):
    with pytest.raises(errors.CheckViolation), savepoint(owner_conn):
        owner_conn.execute("INSERT INTO cde.project_memberships (project_id, user_id, role_id) VALUES (%s,%s,%s)",
                           [world.project_id, world.users["out_user"], world.roles["VIEWER"]])


def test_T8_org_admin_non_aggiunge_utenti_di_altre_org(app_conn, world):
    with pytest.raises(errors.InsufficientPrivilege), savepoint(app_conn):
        add_member(app_conn, world, "sub1_admin", "des_designer", "VIEWER")


def test_org_admin_aggiunge_colleghi(app_conn, world):
    with savepoint(app_conn):
        add_member(app_conn, world, "sub1_admin", "sub1_nomember", "SUBCONTRACTOR")


@pytest.mark.parametrize("role", ["PROJECT_ADMIN", "INFORMATION_MANAGER"])
def test_org_admin_non_assegna_ruoli_con_scope_progetto(app_conn, world, role):
    with pytest.raises(errors.InsufficientPrivilege), savepoint(app_conn):
        add_member(app_conn, world, "sub1_admin", "sub1_nomember", role)


def test_project_admin_aggiunge_membri_di_qualsiasi_org_partecipante(app_conn, world):
    with savepoint(app_conn):
        add_member(app_conn, world, "com_admin", "sub1_nomember", "VIEWER")


def test_ruolo_di_altro_progetto_rifiutato(owner_conn, world):
    rid = owner_conn.execute(
        "INSERT INTO cde.roles (project_id, code, name) VALUES (%s, 'EXT_ROLE', 'x') RETURNING id",
        [world.project2_id]).fetchone()["id"]
    with pytest.raises(errors.CheckViolation), savepoint(owner_conn):
        owner_conn.execute("INSERT INTO cde.project_memberships (project_id, user_id, role_id) VALUES (%s,%s,%s)",
                           [world.project_id, world.users["sub1_nomember"], rid])


def test_membership_scaduta_toglie_visibilita(app_conn, owner_conn, world):
    owner_conn.execute("UPDATE cde.project_memberships SET expires_at = now() - interval '1 minute' WHERE user_id = %s",
                       [world.users["sub1_user"]])
    owner_conn.commit()
    try:
        assert container_ids(app_conn, world, "sub1_user") == set()
        assert app_conn.execute("SELECT count(*) n FROM cde.projects").fetchone()["n"] == 0
    finally:
        owner_conn.execute("UPDATE cde.project_memberships SET expires_at = NULL WHERE user_id = %s",
                           [world.users["sub1_user"]])
        owner_conn.commit()


def test_utente_disabilitato_non_vede_nulla(app_conn, owner_conn, world):
    owner_conn.execute("UPDATE cde.users SET status = 'DISABLED' WHERE id = %s", [world.users["des_lead"]])
    owner_conn.commit()
    try:
        assert container_ids(app_conn, world, "des_lead") == set()
        assert app_conn.execute("SELECT count(*) n FROM cde.organizations").fetchone()["n"] == 0
    finally:
        owner_conn.execute("UPDATE cde.users SET status = 'ACTIVE' WHERE id = %s", [world.users["des_lead"]])
        owner_conn.commit()


def test_org_disattivata_nel_progetto_perde_accesso(app_conn, owner_conn, world):
    owner_conn.execute("UPDATE cde.project_organizations SET is_active = false WHERE organization_id = %s",
                       [world.orgs["SUB1"]])
    owner_conn.commit()
    try:
        assert container_ids(app_conn, world, "sub1_user") == set()
    finally:
        owner_conn.execute("UPDATE cde.project_organizations SET is_active = true WHERE organization_id = %s",
                           [world.orgs["SUB1"]])
        owner_conn.commit()


# =====================================================================
# Progetti, organizzazioni, utenti
# =====================================================================

def test_progetti_visibili_solo_ai_membri(app_conn, world):
    act_as(app_conn, world.users["sub1_user"])
    assert {r["id"] for r in app_conn.execute("SELECT id FROM cde.projects")} == {world.project_id}
    act_as(app_conn, world.users["out_user"])
    assert {r["id"] for r in app_conn.execute("SELECT id FROM cde.projects")} == {world.project2_id}


def test_organizzazioni_visibili_propria_e_partner_di_progetto(app_conn, world):
    act_as(app_conn, world.users["sub1_user"])
    seen = {r["id"] for r in app_conn.execute("SELECT id FROM cde.organizations")}
    assert seen == {world.orgs[k] for k in ("COM", "DES", "GCO", "SUB1", "SUB2")}
    act_as(app_conn, world.users["out_user"])
    assert {r["id"] for r in app_conn.execute("SELECT id FROM cde.organizations")} == {world.orgs["OUT"]}


def test_utenti_visibili_colleghi_e_membri_di_progetto(app_conn, world):
    act_as(app_conn, world.users["sub1_user"])
    seen = {r["id"] for r in app_conn.execute("SELECT id FROM cde.users")}
    assert world.users["out_user"] not in seen
    assert world.users["des_lead"] in seen
    assert world.users["sub1_nomember"] in seen          # collega di organizzazione
    assert world.users["platform"] not in seen           # COM ma senza progetti in comune


def test_utente_senza_progetti_vede_solo_la_propria_org(app_conn, world):
    act_as(app_conn, world.users["sub1_nomember"])
    orgs = {r["organization_id"] for r in app_conn.execute("SELECT organization_id FROM cde.users")}
    assert orgs == {world.orgs["SUB1"]}


def test_api_non_legge_hash_password(app_conn, world):
    act_as(app_conn, world.users["sub1_admin"])
    with pytest.raises(errors.InsufficientPrivilege), savepoint(app_conn):
        app_conn.execute("SELECT password_hash FROM cde.users")


@pytest.mark.parametrize("table", ["user_mfa_factors", "user_recovery_codes", "refresh_tokens"])
def test_api_non_accede_a_credenziali_e_sessioni(app_conn, world, table):
    act_as(app_conn, world.users["com_admin"])
    with pytest.raises(errors.InsufficientPrivilege), savepoint(app_conn):
        app_conn.execute(f"SELECT 1 FROM cde.{table}")


def test_solo_project_admin_modifica_il_progetto(app_conn, world):
    act_as(app_conn, world.users["sub1_admin"])
    assert app_conn.execute("UPDATE cde.projects SET name = 'x' WHERE id = %s", [world.project_id]).rowcount == 0
    act_as(app_conn, world.users["com_admin"])
    with savepoint(app_conn):
        assert app_conn.execute("UPDATE cde.projects SET name = 'Ospedale' WHERE id = %s",
                                [world.project_id]).rowcount == 1


def test_create_project_solo_org_admin(app_conn, world):
    act_as(app_conn, world.users["sub1_user"])
    with pytest.raises(errors.InsufficientPrivilege), savepoint(app_conn):
        app_conn.execute("SELECT cde.create_project('NEW1', 'Nuovo')")
    act_as(app_conn, world.users["sub1_admin"])
    with savepoint(app_conn):
        pid = app_conn.execute("SELECT cde.create_project('NEW1', 'Nuovo') AS id").fetchone()["id"]
        assert app_conn.execute("SELECT owner_organization_id FROM cde.projects WHERE id = %s",
                                [pid]).fetchone()["owner_organization_id"] == world.orgs["SUB1"]
        assert app_conn.execute("SELECT cde.has_project_permission(cde.current_app_user(), %s, 'ADMIN', 'PROJECT') ok",
                                [pid]).fetchone()["ok"]


def test_solo_platform_admin_crea_organizzazioni(app_conn, world):
    act_as(app_conn, world.users["com_admin"])
    with pytest.raises(errors.InsufficientPrivilege), savepoint(app_conn):
        app_conn.execute("INSERT INTO cde.organizations (legal_name, code) VALUES ('Abusiva', 'ABUS')")
    act_as(app_conn, world.users["platform"])
    with savepoint(app_conn):
        app_conn.execute("INSERT INTO cde.organizations (id, legal_name, code) VALUES (%s, 'Nuova', 'NUOVA')",
                         [uuid.uuid4()])


def test_org_admin_crea_utenti_solo_nella_propria_org(app_conn, world):
    act_as(app_conn, world.users["des_admin"])
    with savepoint(app_conn):
        app_conn.execute("INSERT INTO cde.users (id, organization_id, email, first_name, last_name) "
                         "VALUES (%s, %s, 'nuovo@des.example', 'N', 'U')", [uuid.uuid4(), world.orgs["DES"]])
    with pytest.raises(errors.InsufficientPrivilege), savepoint(app_conn):
        app_conn.execute("INSERT INTO cde.users (id, organization_id, email, first_name, last_name) "
                         "VALUES (%s, %s, 'intruso@sub1.example', 'I', 'N')", [uuid.uuid4(), world.orgs["SUB1"]])
    with pytest.raises(errors.InsufficientPrivilege), savepoint(app_conn):
        app_conn.execute("INSERT INTO cde.users (id, organization_id, email, first_name, last_name, is_platform_admin) "
                         "VALUES (%s, %s, 'esc@des.example', 'E', 'S', true)", [uuid.uuid4(), world.orgs["DES"]])


def test_codice_org_immutabile_e_stato_solo_platform(app_conn, world):
    act_as(app_conn, world.users["des_admin"])
    # bloccato già dal privilegio di colonna; il trigger resta come seconda difesa
    with pytest.raises(errors.InsufficientPrivilege), savepoint(app_conn):
        app_conn.execute("UPDATE cde.organizations SET code = 'DESX' WHERE id = %s", [world.orgs["DES"]])
    with pytest.raises(errors.InsufficientPrivilege), savepoint(app_conn):
        app_conn.execute("UPDATE cde.organizations SET status = 'SUSPENDED' WHERE id = %s", [world.orgs["DES"]])
    with savepoint(app_conn):
        assert app_conn.execute("UPDATE cde.organizations SET mfa_required = true WHERE id = %s",
                                [world.orgs["DES"]]).rowcount == 1


# =====================================================================
# Ruoli e matrice permessi
# =====================================================================

def test_ruoli_personalizzati_solo_project_admin(app_conn, world):
    act_as(app_conn, world.users["com_admin"])
    with savepoint(app_conn):
        rid = uuid.uuid4()
        app_conn.execute("INSERT INTO cde.roles (id, project_id, code, name) VALUES (%s, %s, 'BIM_COORD', 'BIM')",
                         [rid, world.project_id])
        app_conn.execute("INSERT INTO cde.role_permissions VALUES (%s, 'READ', 'PROJECT')", [rid])
    act_as(app_conn, world.users["sub1_admin"])
    with pytest.raises(errors.InsufficientPrivilege), savepoint(app_conn):
        app_conn.execute("INSERT INTO cde.roles (project_id, code, name) VALUES (%s, 'HACK', 'x')", [world.project_id])


def test_matrice_ruoli_di_sistema_immutabile_via_api(app_conn, world):
    act_as(app_conn, world.users["com_admin"])
    with savepoint(app_conn):
        assert app_conn.execute("DELETE FROM cde.role_permissions WHERE role_id = %s",
                                [world.roles["VIEWER"]]).rowcount == 0
    with pytest.raises(errors.InsufficientPrivilege), savepoint(app_conn):
        app_conn.execute("INSERT INTO cde.role_permissions VALUES (%s, 'ADMIN', 'PROJECT')", [world.roles["VIEWER"]])


def test_ruoli_di_altri_progetti_invisibili(app_conn, owner_conn, world):
    owner_conn.execute("INSERT INTO cde.roles (project_id, code, name) VALUES (%s, 'SEGRETO', 'x')",
                       [world.project2_id])
    owner_conn.commit()
    try:
        act_as(app_conn, world.users["sub1_user"])
        codes = {r["code"] for r in app_conn.execute("SELECT code FROM cde.roles")}
        assert "SEGRETO" not in codes and "VIEWER" in codes
    finally:
        owner_conn.execute("DELETE FROM cde.roles WHERE code = 'SEGRETO'")
        owner_conn.commit()


# =====================================================================
# Scrittura container
# =====================================================================

def insert_container(conn, world, actor, owner_org, parent=None, name="Nuova cartella"):
    act_as(conn, world.users[actor])
    conn.execute(
        """INSERT INTO cde.containers (id, project_id, parent_id, owner_organization_id, name, created_by)
           VALUES (%s, %s, %s, %s, %s, %s)""",
        [uuid.uuid4(), world.project_id, world.containers.get(parent), world.orgs[owner_org], name,
         world.users[actor]])


def test_container_radice_solo_della_propria_org(app_conn, world):
    with savepoint(app_conn):
        insert_container(app_conn, world, "sub1_user", "SUB1")
    with pytest.raises(errors.InsufficientPrivilege), savepoint(app_conn):
        insert_container(app_conn, world, "sub1_user", "DES")


def test_sottocartella_in_container_altrui_richiede_grant_write(app_conn, owner_conn, world):
    with pytest.raises(errors.InsufficientPrivilege), savepoint(app_conn):
        insert_container(app_conn, world, "sub1_user", "SUB1", parent="des_arch")
    app_conn.rollback()  # now() è l'inizio transazione: una tx più vecchia del grant lo vedrebbe "futuro"
    grant(owner_conn, world, "des_arch", org="SUB1", actions=("READ", "WRITE"))
    owner_conn.commit()
    try:
        with savepoint(app_conn):
            insert_container(app_conn, world, "sub1_user", "SUB1", parent="des_arch", name="Coordinamento SUB1")
    finally:
        app_conn.rollback()
        owner_conn.execute("DELETE FROM cde.containers WHERE name = 'Coordinamento SUB1'")
        owner_conn.execute("DELETE FROM cde.access_grants")
        owner_conn.commit()


def test_viewer_non_crea_container(app_conn, world):
    with pytest.raises(errors.InsufficientPrivilege), savepoint(app_conn):
        insert_container(app_conn, world, "des_viewer", "DES", parent="des_root")


def test_rinomina_richiede_admin_anche_con_grant(app_conn, owner_conn, world):
    grant(owner_conn, world, "des_arch", org="SUB1", actions=("READ", "WRITE"))
    owner_conn.commit()
    try:
        act_as(app_conn, world.users["sub1_user"])
        assert app_conn.execute("UPDATE cde.containers SET name = 'x' WHERE id = %s",
                                [world.containers["des_arch"]]).rowcount == 0
        act_as(app_conn, world.users["des_admin"])
        with savepoint(app_conn):
            assert app_conn.execute("UPDATE cde.containers SET name = 'Tavole ARC' WHERE id = %s",
                                    [world.containers["des_arch"]]).rowcount == 1
    finally:
        app_conn.rollback()
        owner_conn.execute("DELETE FROM cde.access_grants")
        owner_conn.commit()


def test_spostamento_ciclico_rifiutato(owner_conn, world):
    with pytest.raises(errors.CheckViolation), savepoint(owner_conn):
        owner_conn.execute("UPDATE cde.containers SET parent_id = %s WHERE id = %s",
                           [world.containers["des_arch_det"], world.containers["des_root"]])


def test_progetto_e_proprietario_container_immutabili(owner_conn, world):
    with pytest.raises(errors.CheckViolation), savepoint(owner_conn):
        owner_conn.execute("UPDATE cde.containers SET owner_organization_id = %s WHERE id = %s",
                           [world.orgs["SUB1"], world.containers["des_arch"]])


def test_container_non_cancellabili_via_api(app_conn, world):
    act_as(app_conn, world.users["com_admin"])
    with pytest.raises(errors.InsufficientPrivilege), savepoint(app_conn):
        app_conn.execute("DELETE FROM cde.containers WHERE id = %s", [world.containers["des_arch"]])


# =====================================================================
# Matrice ruolo × azione (has_permission) su container propri e altrui
# =====================================================================
ACTIONS = ["READ", "WRITE", "DOWNLOAD", "APPROVE", "ADMIN"]
EXPECTED = {
    # utente: (azioni sul container della propria org, azioni su container di altra org)
    "com_admin": (set(ACTIONS), set(ACTIONS)),
    "com_im": ({"READ", "WRITE", "DOWNLOAD", "APPROVE", "ADMIN"}, {"READ", "DOWNLOAD"}),
    "com_dl": ({"READ", "DOWNLOAD", "APPROVE"}, set()),
    "des_lead": ({"READ", "WRITE", "DOWNLOAD", "APPROVE"}, set()),
    "des_designer": ({"READ", "WRITE", "DOWNLOAD"}, set()),
    "des_viewer": ({"READ"}, set()),
    "des_admin": (set(ACTIONS), set()),
    "sub1_user": ({"READ", "WRITE", "DOWNLOAD"}, set()),
}
OWN_CONTAINER = {"com": "com_root", "des": "des_arch", "sub1": "sub1_root"}


@pytest.mark.parametrize("user", list(EXPECTED))
@pytest.mark.parametrize("action", ACTIONS)
def test_matrice_permessi(app_conn, world, user, action):
    own = world.containers[OWN_CONTAINER[user.split("_")[0]]]
    other = world.containers["sub2_root"]
    act_as(app_conn, world.users[user])
    row = app_conn.execute(
        "SELECT cde.has_permission(%(u)s, %(own)s, %(a)s) own, cde.has_permission(%(u)s, %(other)s, %(a)s) other",
        {"u": world.users[user], "own": own, "other": other, "a": action}).fetchone()
    exp_own, exp_other = EXPECTED[user]
    assert row["own"] == (action in exp_own)
    assert row["other"] == (action in exp_other)


# =====================================================================
# Eventi di sicurezza append-only (T10)
# =====================================================================

def test_api_inserisce_eventi_di_sicurezza(app_conn, world):
    act_as(app_conn, world.users["sub1_user"])
    with savepoint(app_conn):
        app_conn.execute("INSERT INTO cde.security_events (event_type, user_id) VALUES ('TEST', %s)",
                         [world.users["sub1_user"]])


@pytest.mark.parametrize("stmt", ["UPDATE cde.security_events SET event_type = 'X'",
                                  "DELETE FROM cde.security_events",
                                  "TRUNCATE cde.security_events"])
def test_T10_security_events_immutabili_anche_per_owner(owner_conn, world, stmt):
    owner_conn.execute("INSERT INTO cde.security_events (event_type) VALUES ('TEST')")
    with pytest.raises(psycopg.Error) as exc, savepoint(owner_conn):
        owner_conn.execute(stmt)
    assert "append-only" in str(exc.value)


@pytest.mark.parametrize("stmt", ["UPDATE cde.security_events SET event_type = 'X'",
                                  "DELETE FROM cde.security_events",
                                  "SELECT * FROM cde.security_events"])
def test_T10_api_non_modifica_ne_legge_security_events(app_conn, world, stmt):
    act_as(app_conn, world.users["com_admin"])
    with pytest.raises(errors.InsufficientPrivilege), savepoint(app_conn):
        app_conn.execute(stmt)
