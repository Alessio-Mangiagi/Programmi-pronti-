-- "><(((º> sabusabu <º)))><"
-- depends: 0031_derivative_parts
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0032
-- Nuova commessa da una esistente usata come template (ADR-38). Si copia la configurazione, mai i documenti:
-- impostazioni, naming (il campo fisso "project" prende il codice nuovo), metadati, rinomina automatica,
-- filigrana, schemi di naming per cartelle con le loro assegnazioni, albero delle cartelle (aree riservate
-- comprese), ruoli personalizzati con i permessi, workflow attivi. A scelta: organizzazioni partecipanti (con le
-- loro cartelle) e persone con i ruoli. Contatori, prenotazioni, grant espliciti e storico non si copiano.
-- Serve essere amministratore della propria organizzazione (come per create_project) e Project Admin della
-- commessa di partenza. SECURITY DEFINER: le cartelle di altre organizzazioni non sono inseribili con la RLS.
-- =====================================================================

-- Lo schema di naming con il codice della commessa nel campo fisso "project"
CREATE FUNCTION cde.naming_for_project(p_scheme jsonb, p_code text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = cde, pg_temp AS $$
  SELECT CASE WHEN p_scheme IS NULL OR jsonb_typeof(p_scheme -> 'fields') <> 'array' THEN p_scheme
    ELSE jsonb_set(p_scheme, '{fields}', (
      SELECT coalesce(jsonb_agg(CASE WHEN f ->> 'key' = 'project' AND f ->> 'kind' = 'fixed'
                                     THEN jsonb_set(f, '{value}', to_jsonb(p_code)) ELSE f END ORDER BY n), '[]'::jsonb)
      FROM jsonb_array_elements(p_scheme -> 'fields') WITH ORDINALITY e(f, n)))
  END
$$;

CREATE FUNCTION cde.create_project_from_template(
    p_source uuid, p_code text, p_name text, p_description text DEFAULT NULL, p_start_date date DEFAULT NULL,
    p_end_date date DEFAULT NULL, p_timezone text DEFAULT 'Europe/Rome',
    p_with_organizations boolean DEFAULT false, p_with_members boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  v_user    uuid := current_app_user();
  v_org     uuid := current_app_org();
  v_project uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM projects WHERE id = p_source)
     OR NOT has_project_permission(v_user, p_source, 'ADMIN', 'PROJECT') THEN
    RAISE EXCEPTION 'Commessa di partenza non trovata o senza permesso di Project Admin'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_with_members AND NOT p_with_organizations THEN
    RAISE EXCEPTION 'Le persone si copiano solo insieme alle loro organizzazioni' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_project := create_project(p_code, p_name, p_description, p_start_date, p_end_date, p_timezone);   -- controlla l'admin

  DROP TABLE IF EXISTS _tpl_roles, _tpl_profiles, _tpl_folders;
  UPDATE projects SET settings = (SELECT settings FROM projects WHERE id = p_source) WHERE id = v_project;

  INSERT INTO project_document_settings (project_id, naming_scheme, metadata_schema, auto_number, watermark, updated_by)
  SELECT v_project, naming_for_project(naming_scheme, p_code), metadata_schema, auto_number, watermark, v_user
  FROM project_document_settings WHERE project_id = p_source;

  IF p_with_organizations THEN
    INSERT INTO project_organizations (project_id, organization_id, party_role, is_active, invited_by)
    SELECT v_project, organization_id, party_role, is_active, v_user
    FROM project_organizations WHERE project_id = p_source AND organization_id <> v_org
    ON CONFLICT DO NOTHING;
  END IF;

  -- ruoli personalizzati della commessa, con i permessi (i ruoli di sistema sono condivisi)
  CREATE TEMP TABLE _tpl_roles ON COMMIT DROP AS
    SELECT id AS old_id, gen_random_uuid() AS new_id FROM roles WHERE project_id = p_source;
  INSERT INTO roles (id, project_id, code, name, description)
  SELECT m.new_id, v_project, r.code, r.name, r.description FROM roles r JOIN _tpl_roles m ON m.old_id = r.id;
  INSERT INTO role_permissions (role_id, action, scope)
  SELECT m.new_id, p.action, p.scope FROM role_permissions p JOIN _tpl_roles m ON m.old_id = p.role_id;

  IF p_with_members THEN
    INSERT INTO project_memberships (project_id, user_id, role_id, granted_by)
    SELECT v_project, pm.user_id, coalesce(m.new_id, pm.role_id), v_user
    FROM project_memberships pm
    JOIN users u ON u.id = pm.user_id AND u.status = 'ACTIVE'
    LEFT JOIN _tpl_roles m ON m.old_id = pm.role_id
    WHERE pm.project_id = p_source AND (pm.expires_at IS NULL OR pm.expires_at > now())
    ON CONFLICT DO NOTHING;
  END IF;

  -- schemi di naming per cartelle
  CREATE TEMP TABLE _tpl_profiles ON COMMIT DROP AS
    SELECT id AS old_id, gen_random_uuid() AS new_id FROM naming_profiles WHERE project_id = p_source;
  INSERT INTO naming_profiles (id, project_id, name, naming_scheme, auto_number, inherit, created_by, updated_by)
  SELECT m.new_id, v_project, n.name, naming_for_project(n.naming_scheme, p_code), n.auto_number, n.inherit, v_user, v_user
  FROM naming_profiles n JOIN _tpl_profiles m ON m.old_id = n.id;

  -- albero delle cartelle: senza le organizzazioni, solo i rami della propria
  CREATE TEMP TABLE _tpl_folders ON COMMIT DROP AS
    WITH RECURSIVE tree AS (
      SELECT c.id FROM containers c
      WHERE c.project_id = p_source AND c.parent_id IS NULL AND (p_with_organizations OR c.owner_organization_id = v_org)
      UNION ALL
      SELECT c.id FROM containers c JOIN tree t ON c.parent_id = t.id
      WHERE p_with_organizations OR c.owner_organization_id = v_org)
    SELECT id AS old_id, gen_random_uuid() AS new_id FROM tree;
  INSERT INTO containers (id, project_id, parent_id, owner_organization_id, name, inherit_permissions, is_private,
                          naming_profile_id, created_by)
  SELECT m.new_id, v_project, pm.new_id, c.owner_organization_id, c.name, c.inherit_permissions, c.is_private,
         pr.new_id, v_user
  FROM containers c JOIN _tpl_folders m ON m.old_id = c.id
  LEFT JOIN _tpl_folders pm ON pm.old_id = c.parent_id
  LEFT JOIN _tpl_profiles pr ON pr.old_id = c.naming_profile_id;
  -- il trigger di ereditarietà (0030) può aver dato uno schema a sottocartelle che nell'originale non l'hanno
  UPDATE containers n SET naming_profile_id = pr.new_id
  FROM _tpl_folders m JOIN containers c ON c.id = m.old_id LEFT JOIN _tpl_profiles pr ON pr.old_id = c.naming_profile_id
  WHERE n.id = m.new_id AND n.naming_profile_id IS DISTINCT FROM pr.new_id;

  -- workflow attivi: ultima versione di ciascuno, ripartendo dalla 1
  INSERT INTO workflow_templates (project_id, code, version, name, definition, is_active, created_by)
  SELECT DISTINCT ON (code) v_project, code, 1, name, definition, true, v_user
  FROM workflow_templates WHERE project_id = p_source AND is_active
  ORDER BY code, version DESC;

  RETURN v_project;
END $$;

REVOKE ALL ON FUNCTION cde.create_project_from_template(uuid, text, text, text, date, date, text, boolean, boolean)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cde.create_project_from_template(uuid, text, text, text, date, date, text, boolean, boolean)
  TO cde_app;
