-- "><(((º> sabusabu <º)))><"
-- depends: 0025_passkey_login
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0026
-- Naming per cartella: oltre allo schema della commessa il Project Admin definisce schemi con nome
-- (es. "Foto di cantiere", "Modelli BIM"), ciascuno con la sua rinomina automatica, e li assegna alle
-- cartelle che sceglie. Una cartella senza schema usa quello della commessa. L'identificativo resta
-- univoco nel progetto (indice esistente) e il progressivo resta per serie di valori (naming_counters).
-- =====================================================================

CREATE TABLE cde.naming_profiles (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid        NOT NULL REFERENCES cde.projects (id) ON DELETE CASCADE,
  name           text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  naming_scheme  jsonb       NOT NULL,
  auto_number    jsonb,
  created_by     uuid        NOT NULL REFERENCES cde.users (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid        REFERENCES cde.users (id),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);

ALTER TABLE cde.containers
  ADD COLUMN naming_profile_id uuid REFERENCES cde.naming_profiles (id) ON DELETE SET NULL;
CREATE INDEX ix_containers_naming_profile ON cde.containers (naming_profile_id) WHERE naming_profile_id IS NOT NULL;

ALTER TABLE cde.naming_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY naming_profiles_select ON cde.naming_profiles FOR SELECT TO cde_app
  USING (cde.is_project_member(cde.current_app_user(), project_id));
CREATE POLICY naming_profiles_insert ON cde.naming_profiles FOR INSERT TO cde_app
  WITH CHECK (cde.has_project_permission(cde.current_app_user(), project_id, 'ADMIN', 'PROJECT')
              AND created_by = cde.current_app_user());
CREATE POLICY naming_profiles_update ON cde.naming_profiles FOR UPDATE TO cde_app
  USING      (cde.has_project_permission(cde.current_app_user(), project_id, 'ADMIN', 'PROJECT'))
  WITH CHECK (cde.has_project_permission(cde.current_app_user(), project_id, 'ADMIN', 'PROJECT'));
CREATE POLICY naming_profiles_delete ON cde.naming_profiles FOR DELETE TO cde_app
  USING (cde.has_project_permission(cde.current_app_user(), project_id, 'ADMIN', 'PROJECT'));
GRANT SELECT, INSERT, DELETE ON cde.naming_profiles TO cde_app;
GRANT UPDATE (name, naming_scheme, auto_number, updated_by, updated_at) ON cde.naming_profiles TO cde_app;

-- Assegna (o toglie, con NULL) lo schema a una cartella. Lo decide il Project Admin, anche per cartelle di altre
-- organizzazioni che vede: la policy UPDATE dei container chiederebbe l'ADMIN sul singolo container.
CREATE FUNCTION cde.set_container_naming(p_container uuid, p_profile uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  v_project uuid;
  v_user    uuid := current_app_user();
BEGIN
  SELECT project_id INTO v_project FROM containers WHERE id = p_container;
  IF v_project IS NULL OR NOT has_permission(v_user, p_container, 'READ') THEN
    RAISE EXCEPTION 'container non trovato' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT has_project_permission(v_user, v_project, 'ADMIN', 'PROJECT') THEN
    RAISE EXCEPTION 'serve il Project Admin' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_profile IS NOT NULL AND NOT EXISTS (SELECT 1 FROM naming_profiles WHERE id = p_profile AND project_id = v_project) THEN
    RAISE EXCEPTION 'schema di naming di un altro progetto' USING ERRCODE = 'foreign_key_violation';
  END IF;
  UPDATE containers SET naming_profile_id = p_profile WHERE id = p_container;
END $$;
REVOKE ALL ON FUNCTION cde.set_container_naming(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cde.set_container_naming(uuid, uuid) TO cde_app;
