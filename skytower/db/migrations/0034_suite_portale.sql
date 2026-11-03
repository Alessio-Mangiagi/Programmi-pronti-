-- "><(((º> sabusabu <º)))><"
-- depends: 0033_derivative_split
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0034
-- Suite Cosedil: login automatico dal portale e annotazioni della suite sui documenti.
-- Il servizio di autenticazione (cde_auth), che già legge gli utenti, deve poter:
--   * leggere progetti, ruoli e membership per rendere chi entra dal portale membro dei
--     progetti con codice commessa (l'INSERT resta a nome di un Project Admin, sotto RLS);
--   * annotare in documents.attributes l'esito di un confronto (Confronto Documenti) o di
--     una verifica (Verifica Requisiti) chiesti da chi può solo leggere il documento.
-- Letture senza filtro: cde_auth non espone mai righe al client, le usa solo per decidere.
-- =====================================================================

GRANT SELECT ON cde.projects, cde.roles, cde.project_memberships TO cde_auth;
CREATE POLICY auth_projects_select    ON cde.projects            FOR SELECT TO cde_auth USING (true);
CREATE POLICY auth_roles_select       ON cde.roles               FOR SELECT TO cde_auth USING (true);
CREATE POLICY auth_memberships_select ON cde.project_memberships FOR SELECT TO cde_auth USING (true);

GRANT SELECT ON cde.documents TO cde_auth;
GRANT UPDATE (attributes, updated_at) ON cde.documents TO cde_auth;
CREATE POLICY auth_documents_select ON cde.documents FOR SELECT TO cde_auth USING (true);
CREATE POLICY auth_documents_update ON cde.documents FOR UPDATE TO cde_auth USING (true) WITH CHECK (true);
