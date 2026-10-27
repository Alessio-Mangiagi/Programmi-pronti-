-- "><(((º> sabusabu <º)))><"
-- depends: 0002_rbac
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0003 (Sprint 1, G4)
-- Row-Level Security e privilegi.
-- cde_app non è owner ⇒ RLS sempre applicata. cde_owner (proprietario) non la subisce:
-- le funzioni SECURITY DEFINER leggono quindi senza ricorsione di policy.
--
-- Differenze rispetto alla bozza del piano:
--  * le policy non interrogano direttamente altre tabelle con RLS (ricorsione
--    users ↔ project_memberships): usano helper SECURITY DEFINER;
--  * un admin con scope OWN_ORGANIZATION non può assegnare ruoli che contengono
--    permessi con scope PROJECT (escalation ORG_ADMIN → PROJECT_ADMIN);
--  * cde_auth legge users/organizations tramite policy dedicate (decisione G5)
--    invece di row_security = off.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helper per le policy
-- ---------------------------------------------------------------------
CREATE FUNCTION cde.org_visible(p_org_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT p_org_id = current_app_org()
      OR current_app_is_platform_admin()
      OR EXISTS (
           SELECT 1 FROM project_organizations po
           WHERE po.organization_id = p_org_id
             AND is_project_member(current_app_user(), po.project_id)
         )
$$;

-- Utente visibile se: collega di organizzazione; membro di un mio progetto; appartenente a
-- un'organizzazione partecipante a un progetto che amministro (candidato da aggiungere);
-- oppure sono il platform admin.
CREATE FUNCTION cde.user_visible(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT user_org(p_user_id) = current_app_org()
      OR current_app_is_platform_admin()
      OR EXISTS (
           SELECT 1 FROM project_memberships pm
           WHERE pm.user_id = p_user_id
             AND is_project_member(current_app_user(), pm.project_id)
         )
      OR EXISTS (
           SELECT 1 FROM project_organizations po
           WHERE po.organization_id = user_org(p_user_id) AND po.is_active
             AND has_project_permission(current_app_user(), po.project_id, 'ADMIN', 'PROJECT')
         )
$$;

-- Directory minima: risolve un codice originatore in (id, ragione sociale) per invitare
-- un'organizzazione a un progetto. Solo per utenti attivi; nessun altro dato esposto.
CREATE FUNCTION cde.lookup_organization(p_code text)
RETURNS TABLE (id uuid, legal_name text, code varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT o.id, o.legal_name, o.code FROM organizations o
  WHERE o.code = upper(p_code) AND o.status = 'ACTIVE' AND current_app_org() IS NOT NULL
$$;

CREATE FUNCTION cde.project_owner_org(p_project_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT owner_organization_id FROM projects WHERE id = p_project_id
$$;

CREATE FUNCTION cde.role_has_project_scope(p_role_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM role_permissions WHERE role_id = p_role_id AND scope = 'PROJECT')
$$;

-- Chi può gestire la membership (utente, ruolo) in un progetto
CREATE FUNCTION cde.can_manage_membership(p_project_id uuid, p_user_id uuid, p_role_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT has_project_permission(current_app_user(), p_project_id, 'ADMIN', 'PROJECT')
      OR (    has_project_permission(current_app_user(), p_project_id, 'ADMIN', 'OWN_ORGANIZATION')
          AND user_org(p_user_id) = current_app_org()
          AND NOT role_has_project_scope(p_role_id))
$$;

-- Guardia su organizations: codice immutabile, stato modificabile solo dal platform admin
CREATE FUNCTION cde.guard_organization_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'cde_app' THEN
    IF NEW.code <> OLD.code THEN
      RAISE EXCEPTION 'Il codice originatore non è modificabile' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> OLD.status AND NOT cde.current_app_is_platform_admin() THEN
      RAISE EXCEPTION 'Solo il platform admin cambia lo stato di un''organizzazione'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_organizations_guard BEFORE UPDATE ON cde.organizations
  FOR EACH ROW EXECUTE FUNCTION cde.guard_organization_update();

-- =====================================================================
-- Abilitazione RLS
-- =====================================================================
ALTER TABLE cde.organizations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE cde.users                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE cde.user_tokens           ENABLE ROW LEVEL SECURITY;
ALTER TABLE cde.projects              ENABLE ROW LEVEL SECURITY;
ALTER TABLE cde.project_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE cde.roles                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE cde.role_permissions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE cde.project_memberships   ENABLE ROW LEVEL SECURITY;
ALTER TABLE cde.containers            ENABLE ROW LEVEL SECURITY;
ALTER TABLE cde.access_grants         ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- Policy cde_app
-- =====================================================================

-- Organizzazioni: la propria + quelle con cui condivido almeno un progetto
CREATE POLICY org_select ON cde.organizations FOR SELECT TO cde_app
  USING (cde.org_visible(id));
CREATE POLICY org_insert ON cde.organizations FOR INSERT TO cde_app
  WITH CHECK (cde.current_app_is_platform_admin());
CREATE POLICY org_update ON cde.organizations FOR UPDATE TO cde_app
  USING      (cde.current_app_is_platform_admin() OR (id = cde.current_app_org() AND cde.current_app_is_org_admin()))
  WITH CHECK (cde.current_app_is_platform_admin() OR (id = cde.current_app_org() AND cde.current_app_is_org_admin()));

-- Utenti: della mia organizzazione o colleghi di progetto; gestiti dall'admin di organizzazione
CREATE POLICY users_select ON cde.users FOR SELECT TO cde_app
  USING (cde.user_visible(id));
CREATE POLICY users_insert ON cde.users FOR INSERT TO cde_app
  WITH CHECK (cde.current_app_is_platform_admin()
              OR (organization_id = cde.current_app_org() AND cde.current_app_is_org_admin()));
CREATE POLICY users_update ON cde.users FOR UPDATE TO cde_app
  USING      (cde.current_app_is_platform_admin()
              OR (organization_id = cde.current_app_org() AND cde.current_app_is_org_admin()))
  WITH CHECK (cde.current_app_is_platform_admin()
              OR (organization_id = cde.current_app_org() AND cde.current_app_is_org_admin()));

-- Token di invito/reset: li emette l'admin di organizzazione per i propri utenti
CREATE POLICY user_tokens_select ON cde.user_tokens FOR SELECT TO cde_app
  USING (cde.current_app_is_platform_admin()
         OR (cde.user_org(user_id) = cde.current_app_org() AND cde.current_app_is_org_admin()));
CREATE POLICY user_tokens_insert ON cde.user_tokens FOR INSERT TO cde_app
  WITH CHECK (created_by = cde.current_app_user()
              AND (cde.current_app_is_platform_admin()
                   OR (cde.user_org(user_id) = cde.current_app_org() AND cde.current_app_is_org_admin())));

-- Progetti: solo quelli di cui sono membro (creazione via cde.create_project)
CREATE POLICY projects_select ON cde.projects FOR SELECT TO cde_app
  USING (cde.is_project_member(cde.current_app_user(), id));
CREATE POLICY projects_update ON cde.projects FOR UPDATE TO cde_app
  USING      (cde.has_project_permission(cde.current_app_user(), id, 'ADMIN', 'PROJECT'))
  WITH CHECK (cde.has_project_permission(cde.current_app_user(), id, 'ADMIN', 'PROJECT'));

-- Organizzazioni partecipanti
CREATE POLICY project_orgs_select ON cde.project_organizations FOR SELECT TO cde_app
  USING (cde.is_project_member(cde.current_app_user(), project_id));
CREATE POLICY project_orgs_insert ON cde.project_organizations FOR INSERT TO cde_app
  WITH CHECK (cde.has_project_permission(cde.current_app_user(), project_id, 'ADMIN', 'PROJECT'));
CREATE POLICY project_orgs_update ON cde.project_organizations FOR UPDATE TO cde_app
  USING      (cde.has_project_permission(cde.current_app_user(), project_id, 'ADMIN', 'PROJECT')
              AND organization_id <> cde.project_owner_org(project_id))
  WITH CHECK (cde.has_project_permission(cde.current_app_user(), project_id, 'ADMIN', 'PROJECT'));
CREATE POLICY project_orgs_delete ON cde.project_organizations FOR DELETE TO cde_app
  USING (cde.has_project_permission(cde.current_app_user(), project_id, 'ADMIN', 'PROJECT')
         AND organization_id <> cde.project_owner_org(project_id));

-- Ruoli: template di sistema + ruoli dei miei progetti; personalizzati gestiti dal Project Admin
CREATE POLICY roles_select ON cde.roles FOR SELECT TO cde_app
  USING ((project_id IS NULL AND cde.current_app_org() IS NOT NULL)
         OR cde.is_project_member(cde.current_app_user(), project_id));
CREATE POLICY roles_insert ON cde.roles FOR INSERT TO cde_app
  WITH CHECK (project_id IS NOT NULL AND NOT is_system
              AND cde.has_project_permission(cde.current_app_user(), project_id, 'ADMIN', 'PROJECT'));
CREATE POLICY roles_update ON cde.roles FOR UPDATE TO cde_app
  USING      (project_id IS NOT NULL AND NOT is_system
              AND cde.has_project_permission(cde.current_app_user(), project_id, 'ADMIN', 'PROJECT'))
  WITH CHECK (project_id IS NOT NULL AND NOT is_system
              AND cde.has_project_permission(cde.current_app_user(), project_id, 'ADMIN', 'PROJECT'));
CREATE POLICY roles_delete ON cde.roles FOR DELETE TO cde_app
  USING (project_id IS NOT NULL AND NOT is_system
         AND cde.has_project_permission(cde.current_app_user(), project_id, 'ADMIN', 'PROJECT'));

-- Matrice permessi
CREATE POLICY role_perms_select ON cde.role_permissions FOR SELECT TO cde_app
  USING ((cde.role_project(role_id) IS NULL AND cde.current_app_org() IS NOT NULL)
         OR cde.is_project_member(cde.current_app_user(), cde.role_project(role_id)));
CREATE POLICY role_perms_insert ON cde.role_permissions FOR INSERT TO cde_app
  WITH CHECK (NOT cde.role_is_system(role_id)
              AND cde.has_project_permission(cde.current_app_user(), cde.role_project(role_id), 'ADMIN', 'PROJECT'));
CREATE POLICY role_perms_delete ON cde.role_permissions FOR DELETE TO cde_app
  USING (NOT cde.role_is_system(role_id)
         AND cde.has_project_permission(cde.current_app_user(), cde.role_project(role_id), 'ADMIN', 'PROJECT'));

-- Membership: visibili ai membri del progetto; gestite da Project Admin o admin di organizzazione (colleghi)
CREATE POLICY memberships_select ON cde.project_memberships FOR SELECT TO cde_app
  USING (user_id = cde.current_app_user() OR cde.is_project_member(cde.current_app_user(), project_id));
CREATE POLICY memberships_insert ON cde.project_memberships FOR INSERT TO cde_app
  WITH CHECK (cde.can_manage_membership(project_id, user_id, role_id));
CREATE POLICY memberships_update ON cde.project_memberships FOR UPDATE TO cde_app
  USING      (cde.can_manage_membership(project_id, user_id, role_id))
  WITH CHECK (cde.can_manage_membership(project_id, user_id, role_id));
CREATE POLICY memberships_delete ON cde.project_memberships FOR DELETE TO cde_app
  USING (cde.can_manage_membership(project_id, user_id, role_id));

-- Container: visibilità governata da has_permission
-- NB: INSERT ... RETURNING fallirebbe (la funzione STABLE non vede la riga appena inserita):
--     l'API genera l'id e rilegge con SELECT.
CREATE POLICY containers_select ON cde.containers FOR SELECT TO cde_app
  USING (cde.has_permission(cde.current_app_user(), id, 'READ'));
CREATE POLICY containers_insert ON cde.containers FOR INSERT TO cde_app WITH CHECK (
  owner_organization_id = cde.current_app_org()
  AND created_by = cde.current_app_user()
  AND (
    (parent_id IS NULL AND cde.has_project_permission(cde.current_app_user(), project_id, 'WRITE', NULL))
    OR (parent_id IS NOT NULL AND cde.has_permission(cde.current_app_user(), parent_id, 'WRITE'))
  )
);
CREATE POLICY containers_update ON cde.containers FOR UPDATE TO cde_app
  USING      (cde.has_permission(cde.current_app_user(), id, 'ADMIN'))
  WITH CHECK (cde.has_permission(cde.current_app_user(), id, 'ADMIN')
              AND (parent_id IS NULL OR cde.has_permission(cde.current_app_user(), parent_id, 'WRITE')));
-- Nessuna policy DELETE: i container non si cancellano (si archiviano, Sprint 3)

-- Grant: li vede il destinatario o chi amministra il container; li crea/revoca solo l'admin del container
CREATE POLICY grants_select ON cde.access_grants FOR SELECT TO cde_app USING (
  grantee_user_id = cde.current_app_user()
  OR grantee_organization_id = cde.current_app_org()
  OR cde.has_permission(cde.current_app_user(), container_id, 'ADMIN')
);
CREATE POLICY grants_insert ON cde.access_grants FOR INSERT TO cde_app WITH CHECK (
  granted_by = cde.current_app_user() AND cde.has_permission(cde.current_app_user(), container_id, 'ADMIN')
);
CREATE POLICY grants_update ON cde.access_grants FOR UPDATE TO cde_app   -- solo revoca (trigger)
  USING      (cde.has_permission(cde.current_app_user(), container_id, 'ADMIN'))
  WITH CHECK (cde.has_permission(cde.current_app_user(), container_id, 'ADMIN')
              AND revoked_by = cde.current_app_user());

-- =====================================================================
-- Policy cde_auth: opera su credenziali, mai su dati di progetto
-- =====================================================================
CREATE POLICY auth_org_select   ON cde.organizations FOR SELECT TO cde_auth USING (true);
CREATE POLICY auth_users_select ON cde.users         FOR SELECT TO cde_auth USING (true);
CREATE POLICY auth_users_update ON cde.users         FOR UPDATE TO cde_auth USING (true) WITH CHECK (true);
CREATE POLICY auth_tokens_all   ON cde.user_tokens   FOR ALL    TO cde_auth USING (true) WITH CHECK (true);

-- =====================================================================
-- Privilegi (minimo indispensabile, a livello di colonna dove serve)
-- =====================================================================
REVOKE ALL ON ALL TABLES    IN SCHEMA cde FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA cde FROM PUBLIC;
GRANT USAGE ON SCHEMA cde TO cde_app, cde_auth;

-- cde_app — API applicativa
GRANT SELECT, INSERT ON cde.organizations TO cde_app;
GRANT UPDATE (legal_name, vat_number, mfa_required, status, data_region) ON cde.organizations TO cde_app;

-- password_hash e contatori di login non sono mai leggibili dall'API applicativa
GRANT SELECT (id, organization_id, email, first_name, last_name, status, is_org_admin, is_platform_admin,
              last_login_at, created_at, updated_at) ON cde.users TO cde_app;
GRANT INSERT (id, organization_id, email, first_name, last_name, status, is_org_admin) ON cde.users TO cde_app;
GRANT UPDATE (first_name, last_name, status, is_org_admin) ON cde.users TO cde_app;

GRANT SELECT (id, user_id, purpose, expires_at, used_at, created_by, created_at) ON cde.user_tokens TO cde_app;
GRANT INSERT ON cde.user_tokens TO cde_app;

GRANT SELECT ON cde.projects TO cde_app;
GRANT UPDATE (name, description, status, start_date, end_date, timezone, settings) ON cde.projects TO cde_app;

GRANT SELECT, INSERT, DELETE ON cde.project_organizations TO cde_app;
GRANT UPDATE (party_role, is_active) ON cde.project_organizations TO cde_app;

GRANT SELECT, INSERT, DELETE ON cde.roles TO cde_app;
GRANT UPDATE (name, description) ON cde.roles TO cde_app;

GRANT SELECT, INSERT, DELETE ON cde.role_permissions TO cde_app;

GRANT SELECT, INSERT, DELETE ON cde.project_memberships TO cde_app;
GRANT UPDATE (expires_at) ON cde.project_memberships TO cde_app;

GRANT SELECT, INSERT ON cde.containers TO cde_app;
GRANT UPDATE (name, parent_id, inherit_permissions) ON cde.containers TO cde_app;

GRANT SELECT, INSERT ON cde.access_grants TO cde_app;
GRANT UPDATE (revoked_at, revoked_by) ON cde.access_grants TO cde_app;

GRANT INSERT ON cde.security_events TO cde_app;

-- cde_auth — servizio di autenticazione (l'API applicativa non vede mai credenziali e sessioni)
GRANT SELECT ON cde.users TO cde_auth;
GRANT UPDATE (failed_login_count, locked_until, last_login_at, password_hash,
              password_changed_at, status) ON cde.users TO cde_auth;
GRANT SELECT (id, code, legal_name, mfa_required, status) ON cde.organizations TO cde_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON cde.user_mfa_factors, cde.user_recovery_codes,
      cde.refresh_tokens TO cde_auth;
GRANT SELECT, INSERT ON cde.user_tokens TO cde_auth;
GRANT UPDATE (used_at) ON cde.user_tokens TO cde_auth;
GRANT INSERT ON cde.security_events TO cde_auth;

GRANT USAGE ON ALL SEQUENCES IN SCHEMA cde TO cde_app, cde_auth;

-- Funzioni: necessarie a cde_app per valutare le policy e per l'API
GRANT EXECUTE ON FUNCTION
  cde.current_app_user(), cde.current_app_org(), cde.current_app_is_org_admin(),
  cde.current_app_is_platform_admin(), cde.user_org(uuid), cde.role_project(uuid), cde.role_is_system(uuid),
  cde.is_project_member(uuid, uuid),
  cde.has_project_permission(uuid, uuid, cde.permission_action, cde.permission_scope),
  cde.has_permission(uuid, uuid, cde.permission_action), cde.my_container_actions(uuid),
  cde.create_project(text, text, text, date, date, text),
  cde.org_visible(uuid), cde.user_visible(uuid), cde.project_owner_org(uuid), cde.lookup_organization(text),
  cde.role_has_project_scope(uuid), cde.can_manage_membership(uuid, uuid, uuid)
TO cde_app;
