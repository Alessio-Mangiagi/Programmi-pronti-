-- "><(((º> sabusabu <º)))><"
-- depends: 0041_workflow_libreria
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0043: modelli di commessa dell'organizzazione (ADR-52)
--
-- Richiesta dell'utente del 04/11/2026: "rendere i progetti trasformabili in template per poterci copiare e avere
-- la struttura pronta per una nuova commessa della stessa azienda". Scelte:
--   * "Salva come modello" crea un MODELLO DI COMMESSA separato (la commessa di partenza resta com'è). Il modello è
--     un progetto con is_model = true: si apre e si ritocca con le stesse pagine di una commessa (cartelle, naming,
--     metadati, ruoli, filigrana, workflow, organizzazioni), ma non entra negli elenchi operativi e non ha funzioni
--     operative (workflow avviati, RFI, transmittal, notifiche: bloccati qui sotto con trigger);
--   * i modelli li creano, li modificano e li usano gli amministratori dell'organizzazione proprietaria; diventano
--     Project Admin del modello quando aprono l'elenco (cde.model_join), e chi smette di essere admin ne esce;
--   * le PERSONE del modello stanno in project_model_people e non sono membri: non vedono il modello e non ricevono
--     nulla (un consulente di un'altra organizzazione salvato nel modello non deve vederlo);
--   * i DOCUMENTI DI MODELLO (capitolato tipo, moduli) sono marcati in model_documents da un Project Admin; si copiano
--     come prima revisione WIP nella stessa cartella del nuovo progetto (il file su S3 lo copia l'API);
--   * il codice commessa della suite (settings.commessa) non sta mai in un modello (CHECK) e non si copia.
--
-- Il codice ISO del progetto resta univoco per organizzazione solo fra le commesse: un modello può avere lo stesso
-- codice della commessa da cui nasce (serve solo come segnaposto nel naming, che all'uso prende il codice nuovo).
-- =====================================================================

-- =====================================================================
-- 1. Il modello è un progetto
-- =====================================================================
ALTER TABLE cde.projects
  ADD COLUMN is_model boolean NOT NULL DEFAULT false,
  ADD COLUMN model_source_id uuid REFERENCES cde.projects (id),         -- commessa da cui è stato salvato
  ADD CONSTRAINT projects_model_senza_commessa CHECK (NOT is_model OR NOT settings ? 'commessa');

-- codice ISO univoco fra le commesse dell'organizzazione; i modelli ne sono esclusi
ALTER TABLE cde.projects DROP CONSTRAINT projects_owner_organization_id_code_key;
CREATE UNIQUE INDEX ux_projects_org_code ON cde.projects (owner_organization_id, code) WHERE NOT is_model;
CREATE INDEX ix_projects_models ON cde.projects (owner_organization_id) WHERE is_model;

-- =====================================================================
-- 2. Persone salvate nel modello (non sono membri) e documenti di modello
-- =====================================================================
CREATE TABLE cde.project_model_people (
  project_id  uuid        NOT NULL REFERENCES cde.projects (id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES cde.users (id) ON DELETE CASCADE,
  role_id     uuid        NOT NULL REFERENCES cde.roles (id) ON DELETE CASCADE,
  added_by    uuid        REFERENCES cde.users (id),
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id, role_id)
);

-- solo nei modelli, con un ruolo di sistema o del modello stesso
CREATE FUNCTION cde.check_model_people() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND is_model) THEN
    RAISE EXCEPTION 'Le persone del modello si salvano solo in un modello di commessa' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM roles WHERE id = NEW.role_id AND (project_id IS NULL OR project_id = NEW.project_id)) THEN
    RAISE EXCEPTION 'Ruolo non appartenente al modello' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_model_people_check BEFORE INSERT ON cde.project_model_people
  FOR EACH ROW EXECUTE FUNCTION cde.check_model_people();

CREATE TABLE cde.model_documents (
  document_id  uuid        PRIMARY KEY REFERENCES cde.documents (id) ON DELETE CASCADE,
  project_id   uuid        NOT NULL REFERENCES cde.projects (id) ON DELETE CASCADE,
  marked_by    uuid        REFERENCES cde.users (id),
  marked_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_model_documents_project ON cde.model_documents (project_id);

CREATE FUNCTION cde.check_model_document() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM documents WHERE id = NEW.document_id AND project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'Documento non appartenente al progetto' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_model_documents_check BEFORE INSERT ON cde.model_documents
  FOR EACH ROW EXECUTE FUNCTION cde.check_model_document();

ALTER TABLE cde.project_model_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE cde.model_documents ENABLE ROW LEVEL SECURITY;

-- Persone del modello: le vede e le gestisce chi amministra il modello (gli admin dell'organizzazione)
CREATE POLICY model_people_select ON cde.project_model_people FOR SELECT TO cde_app
  USING (cde.has_project_permission(cde.current_app_user(), project_id, 'ADMIN', 'PROJECT'));
CREATE POLICY model_people_insert ON cde.project_model_people FOR INSERT TO cde_app
  WITH CHECK (added_by = cde.current_app_user()
              AND cde.has_project_permission(cde.current_app_user(), project_id, 'ADMIN', 'PROJECT'));
CREATE POLICY model_people_delete ON cde.project_model_people FOR DELETE TO cde_app
  USING (cde.has_project_permission(cde.current_app_user(), project_id, 'ADMIN', 'PROJECT'));

-- Documenti di modello: il segno lo vedono i membri, lo mette e lo toglie il Project Admin
CREATE POLICY model_documents_select ON cde.model_documents FOR SELECT TO cde_app
  USING (cde.is_project_member(cde.current_app_user(), project_id));
CREATE POLICY model_documents_insert ON cde.model_documents FOR INSERT TO cde_app
  WITH CHECK (marked_by = cde.current_app_user()
              AND cde.has_project_permission(cde.current_app_user(), project_id, 'ADMIN', 'PROJECT'));
CREATE POLICY model_documents_delete ON cde.model_documents FOR DELETE TO cde_app
  USING (cde.has_project_permission(cde.current_app_user(), project_id, 'ADMIN', 'PROJECT'));

GRANT SELECT, INSERT, DELETE ON cde.project_model_people, cde.model_documents TO cde_app;

-- =====================================================================
-- 3. Niente funzioni operative nei modelli
-- =====================================================================
-- Workflow avviati, RFI e transmittal non hanno senso in una struttura vuota: il database li rifiuta (422 con il
-- messaggio) qualunque rotta li crei. Il motore dei workflow non si tocca: l'istanza semplicemente non nasce.
CREATE FUNCTION cde.forbid_in_model() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND is_model) THEN
    RAISE EXCEPTION 'In un modello di commessa non si %: crea una commessa dal modello', TG_ARGV[0]
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_workflow_instances_not_in_model BEFORE INSERT ON cde.workflow_instances
  FOR EACH ROW EXECUTE FUNCTION cde.forbid_in_model('avviano workflow');
CREATE TRIGGER trg_rfis_not_in_model BEFORE INSERT ON cde.rfis
  FOR EACH ROW EXECUTE FUNCTION cde.forbid_in_model('aprono RFI');
CREATE TRIGGER trg_transmittals_not_in_model BEFORE INSERT ON cde.transmittals
  FOR EACH ROW EXECUTE FUNCTION cde.forbid_in_model('emettono transmittal');

-- Notifiche: chi ritocca un modello (caricamenti, cambi di stato dei documenti di modello) non deve far partire
-- avvisi, riepiloghi o email. La riga semplicemente non si scrive.
CREATE FUNCTION cde.skip_model_notifications() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
BEGIN
  IF NEW.project_id IS NOT NULL AND EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND is_model) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_notifications_skip_model BEFORE INSERT ON cde.notifications
  FOR EACH ROW EXECUTE FUNCTION cde.skip_model_notifications();

REVOKE ALL ON FUNCTION cde.forbid_in_model(), cde.skip_model_notifications(), cde.check_model_people(),
                       cde.check_model_document() FROM PUBLIC;

-- =====================================================================
-- 4. Chi amministra i modelli
-- =====================================================================
-- Gli admin dell'organizzazione diventano Project Admin dei modelli attivi della loro organizzazione; chi non è
-- più admin (o non è più attivo) ne esce. Così le pagine di progetto e la RLS esistenti valgono anche per i modelli
-- senza toccare has_project_permission. Idempotente: la chiamano l'elenco dei modelli e l'apertura di un modello.
CREATE FUNCTION cde.model_join() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  v_user  uuid := current_app_user();
  v_org   uuid := current_app_org();
  v_role  uuid;
  v_n     integer;
BEGIN
  IF v_org IS NULL OR NOT current_app_is_org_admin() THEN
    RETURN 0;
  END IF;
  SELECT id INTO STRICT v_role FROM roles WHERE project_id IS NULL AND code = 'PROJECT_ADMIN';
  -- chi non è più admin dell'organizzazione esce dai modelli (il platform admin resta: lo gestisce un'altra regola)
  DELETE FROM project_memberships pm USING projects p, users u
  WHERE p.id = pm.project_id AND p.is_model AND p.owner_organization_id = v_org AND u.id = pm.user_id
    AND NOT u.is_platform_admin AND NOT (u.is_org_admin AND u.status = 'ACTIVE' AND u.organization_id = v_org);
  INSERT INTO project_memberships (project_id, user_id, role_id, granted_by)
  SELECT p.id, v_user, v_role, v_user FROM projects p
  WHERE p.is_model AND p.owner_organization_id = v_org AND p.status <> 'ARCHIVED'
    AND NOT EXISTS (SELECT 1 FROM project_memberships m WHERE m.project_id = p.id AND m.user_id = v_user
                    AND m.role_id = v_role)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- Un progetto appena creato in questa transazione da chi chiama: solo lì le funzioni di copia possono scrivere
-- cartelle di altre organizzazioni e documenti senza passare dal caricamento (now() = inizio della transazione).
CREATE FUNCTION cde.model_fresh_project(p_project uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM projects WHERE id = p_project AND created_at = now() AND created_by = current_app_user())
     AND has_project_permission(current_app_user(), p_project, 'ADMIN', 'PROJECT')
$$;

-- Nuovo modello vuoto dell'organizzazione di chi chiama (admin), con chi chiama Project Admin.
CREATE FUNCTION cde.create_project_model(p_code text, p_name text, p_description text DEFAULT NULL,
                                         p_source uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  v_user  uuid := current_app_user();
  v_org   uuid := current_app_org();
  v_model uuid;
BEGIN
  IF v_org IS NULL OR NOT current_app_is_org_admin() THEN
    RAISE EXCEPTION 'Solo un amministratore dell''organizzazione crea i modelli di commessa'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO projects (owner_organization_id, code, name, description, status, is_model, model_source_id, created_by)
  VALUES (v_org, p_code, p_name, p_description, 'ACTIVE', true, p_source, v_user)
  RETURNING id INTO v_model;
  INSERT INTO project_organizations (project_id, organization_id, party_role, invited_by)
  VALUES (v_model, v_org, 'APPOINTING_PARTY', v_user);
  INSERT INTO project_memberships (project_id, user_id, role_id, granted_by)
  SELECT v_model, v_user, id, v_user FROM roles WHERE project_id IS NULL AND code = 'PROJECT_ADMIN';
  RETURN v_model;
END $$;

-- =====================================================================
-- 5. Copia della struttura (comune a "Salva come modello" e "Nuova commessa dal modello")
-- =====================================================================
-- Stessa copia di create_project_from_template (0032/0038, ADR-38), generalizzata: la sorgente e la destinazione
-- possono essere commesse o modelli. Le persone vengono dalle membership di una commessa o dalle persone del
-- modello, e vanno nelle membership di una commessa o nelle persone del modello. Restituisce le coppie
-- (cartella di partenza, cartella copiata) che l'API usa per i documenti di modello. Non è esposta a cde_app:
-- la chiamano solo le funzioni qui sotto, dopo i controlli.
CREATE FUNCTION cde.copy_project_structure(p_source uuid, p_target uuid, p_code text,
                                           p_with_organizations boolean, p_with_members boolean)
RETURNS TABLE (src_folder uuid, dst_folder uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_user       uuid := current_app_user();
  v_org        uuid;
  v_src_model  boolean;
  v_tgt_model  boolean;
BEGIN
  SELECT owner_organization_id, is_model INTO v_org, v_tgt_model FROM projects WHERE id = p_target;
  SELECT is_model INTO v_src_model FROM projects WHERE id = p_source;
  DROP TABLE IF EXISTS _mdl_roles, _mdl_profiles, _mdl_folders;

  -- impostazioni senza il codice commessa della suite (collega una sola commessa, ADR-47)
  UPDATE projects SET settings = (SELECT settings - 'commessa' FROM projects WHERE id = p_source) WHERE id = p_target;

  INSERT INTO project_document_settings (project_id, naming_scheme, metadata_schema, auto_number, watermark, updated_by)
  SELECT p_target, naming_for_project(naming_scheme, p_code), metadata_schema, auto_number, watermark, v_user
  FROM project_document_settings WHERE project_id = p_source;

  IF p_with_organizations THEN
    INSERT INTO project_organizations (project_id, organization_id, party_role, is_active, invited_by)
    SELECT p_target, organization_id, party_role, is_active, v_user
    FROM project_organizations WHERE project_id = p_source AND organization_id <> v_org
    ON CONFLICT DO NOTHING;
  END IF;

  -- ruoli personalizzati con i permessi (quelli di sistema sono condivisi)
  CREATE TEMP TABLE _mdl_roles ON COMMIT DROP AS
    SELECT id AS old_id, gen_random_uuid() AS new_id FROM roles WHERE project_id = p_source;
  INSERT INTO roles (id, project_id, code, name, description)
  SELECT m.new_id, p_target, r.code, r.name, r.description FROM roles r JOIN _mdl_roles m ON m.old_id = r.id;
  INSERT INTO role_permissions (role_id, action, scope)
  SELECT m.new_id, p.action, p.scope FROM role_permissions p JOIN _mdl_roles m ON m.old_id = p.role_id;

  IF p_with_members THEN
    -- persone attive: dalle membership valide di una commessa o dalle persone salvate in un modello
    CREATE TEMP TABLE _mdl_people ON COMMIT DROP AS
      SELECT pm.user_id, pm.role_id FROM project_memberships pm JOIN users u ON u.id = pm.user_id AND u.status = 'ACTIVE'
      WHERE NOT v_src_model AND pm.project_id = p_source AND (pm.expires_at IS NULL OR pm.expires_at > now())
      UNION
      SELECT mp.user_id, mp.role_id FROM project_model_people mp JOIN users u ON u.id = mp.user_id AND u.status = 'ACTIVE'
      WHERE v_src_model AND mp.project_id = p_source;
    IF v_tgt_model THEN
      INSERT INTO project_model_people (project_id, user_id, role_id, added_by)
      SELECT p_target, s.user_id, coalesce(m.new_id, s.role_id), v_user
      FROM _mdl_people s LEFT JOIN _mdl_roles m ON m.old_id = s.role_id
      ON CONFLICT DO NOTHING;
    ELSE
      INSERT INTO project_memberships (project_id, user_id, role_id, granted_by)
      SELECT p_target, s.user_id, coalesce(m.new_id, s.role_id), v_user
      FROM _mdl_people s LEFT JOIN _mdl_roles m ON m.old_id = s.role_id
      ON CONFLICT DO NOTHING;
    END IF;
    DROP TABLE _mdl_people;
  END IF;

  -- schemi di naming per cartelle
  CREATE TEMP TABLE _mdl_profiles ON COMMIT DROP AS
    SELECT id AS old_id, gen_random_uuid() AS new_id FROM naming_profiles WHERE project_id = p_source;
  INSERT INTO naming_profiles (id, project_id, name, naming_scheme, auto_number, inherit, created_by, updated_by)
  SELECT m.new_id, p_target, n.name, naming_for_project(n.naming_scheme, p_code), n.auto_number, n.inherit, v_user, v_user
  FROM naming_profiles n JOIN _mdl_profiles m ON m.old_id = n.id;

  -- albero delle cartelle con le aree riservate: senza le organizzazioni, solo i rami di quella proprietaria
  CREATE TEMP TABLE _mdl_folders ON COMMIT DROP AS
    WITH RECURSIVE tree AS (
      SELECT c.id FROM containers c
      WHERE c.project_id = p_source AND c.parent_id IS NULL AND (p_with_organizations OR c.owner_organization_id = v_org)
      UNION ALL
      SELECT c.id FROM containers c JOIN tree t ON c.parent_id = t.id
      WHERE p_with_organizations OR c.owner_organization_id = v_org)
    SELECT id AS old_id, gen_random_uuid() AS new_id FROM tree;
  INSERT INTO containers (id, project_id, parent_id, owner_organization_id, name, inherit_permissions, is_private,
                          naming_profile_id, created_by)
  SELECT m.new_id, p_target, pm.new_id, c.owner_organization_id, c.name, c.inherit_permissions, c.is_private,
         pr.new_id, v_user
  FROM containers c JOIN _mdl_folders m ON m.old_id = c.id
  LEFT JOIN _mdl_folders pm ON pm.old_id = c.parent_id
  LEFT JOIN _mdl_profiles pr ON pr.old_id = c.naming_profile_id;
  -- il trigger di ereditarietà (0030) può aver dato uno schema a sottocartelle che nell'originale non l'hanno
  UPDATE containers n SET naming_profile_id = pr.new_id
  FROM _mdl_folders m JOIN containers c ON c.id = m.old_id LEFT JOIN _mdl_profiles pr ON pr.old_id = c.naming_profile_id
  WHERE n.id = m.new_id AND n.naming_profile_id IS DISTINCT FROM pr.new_id;

  -- workflow della commessa/modello (non quelli della libreria, già vivi in ogni commessa: ADR-50), ultima versione
  -- attiva di ciascuno, ripartendo dalla 1
  INSERT INTO workflow_templates (project_id, code, version, name, definition, is_active, created_by)
  SELECT DISTINCT ON (code) p_target, code, 1, name, definition, true, v_user
  FROM workflow_templates WHERE project_id = p_source AND is_active
  ORDER BY code, version DESC;

  RETURN QUERY SELECT m.old_id, m.new_id FROM _mdl_folders m;
END $$;

-- "Salva come modello": nuovo modello dell'organizzazione di chi chiama (admin dell'organizzazione e Project Admin
-- della commessa di partenza), con tutto: organizzazioni, cartelle di tutti, persone con i ruoli.
-- Restituisce il modello e le coppie di cartelle (più una riga senza cartelle, così il modello c'è sempre).
CREATE FUNCTION cde.save_project_as_model(p_source uuid, p_name text, p_description text DEFAULT NULL)
RETURNS TABLE (out_project uuid, out_src uuid, out_dst uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_code  text;
  v_model uuid;
BEGIN
  IF current_app_org() IS NULL OR NOT current_app_is_org_admin() THEN
    RAISE EXCEPTION 'Solo un amministratore dell''organizzazione salva i modelli di commessa'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT code INTO v_code FROM projects WHERE id = p_source;
  IF v_code IS NULL OR NOT has_project_permission(current_app_user(), p_source, 'ADMIN', 'PROJECT') THEN
    RAISE EXCEPTION 'Commessa di partenza non trovata o senza permesso di Project Admin'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_model := create_project_model(v_code, p_name, p_description, p_source);
  RETURN QUERY
    SELECT v_model, s.src_folder, s.dst_folder FROM copy_project_structure(p_source, v_model, v_code, true, true) s
    UNION ALL SELECT v_model, NULL::uuid, NULL::uuid;
END $$;

-- "Nuova commessa dal modello": solo modelli attivi della propria organizzazione, solo admin dell'organizzazione
-- (create_project lo ricontrolla). Organizzazioni e persone a scelta, come per ADR-38.
CREATE FUNCTION cde.create_project_from_model(
    p_model uuid, p_code text, p_name text, p_description text DEFAULT NULL, p_start_date date DEFAULT NULL,
    p_end_date date DEFAULT NULL, p_timezone text DEFAULT 'Europe/Rome',
    p_with_organizations boolean DEFAULT false, p_with_members boolean DEFAULT false)
RETURNS TABLE (out_project uuid, out_src uuid, out_dst uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_project uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM projects WHERE id = p_model AND is_model AND status <> 'ARCHIVED'
                 AND owner_organization_id = current_app_org())
     OR NOT current_app_is_org_admin() THEN
    RAISE EXCEPTION 'Modello di commessa non trovato' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_with_members AND NOT p_with_organizations THEN
    RAISE EXCEPTION 'Le persone si copiano solo insieme alle loro organizzazioni' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_project := create_project(p_code, p_name, p_description, p_start_date, p_end_date, p_timezone);
  RETURN QUERY
    SELECT v_project, s.src_folder, s.dst_folder
    FROM copy_project_structure(p_model, v_project, p_code, p_with_organizations, p_with_members) s
    UNION ALL SELECT v_project, NULL::uuid, NULL::uuid;
END $$;

-- =====================================================================
-- 6. Documenti di modello e cartelle: lettura completa e scrittura nella copia
-- =====================================================================
-- Documenti marcati "di modello" con l'ultima revisione e il suo file, per il Project Admin del progetto (anche nelle
-- cartelle di altre organizzazioni o riservate, che la RLS gli nasconderebbe: li sta copiando, non leggendo).
CREATE FUNCTION cde.model_documents_source(p_project uuid)
RETURNS TABLE (document_id uuid, container_id uuid, identifier text, naming_fields jsonb, title text, description text,
               attributes jsonb, storage_key text, storage_version_id text, size_bytes bigint, content_type text,
               sha256 bytea, original_filename text, scan_status text, revision_code text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF NOT has_project_permission(current_app_user(), p_project, 'ADMIN', 'PROJECT') THEN
    RAISE EXCEPTION 'Riservato al Project Admin' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT d.id, d.container_id, d.identifier, d.naming_fields, d.title, d.description, d.attributes,
           f.storage_key, f.storage_version_id, f.size_bytes, f.content_type, f.sha256, r.original_filename,
           f.scan_status::text, r.revision_code
    FROM model_documents md
    JOIN documents d ON d.id = md.document_id AND d.archived_at IS NULL
    JOIN LATERAL (SELECT * FROM document_revisions x WHERE x.document_id = d.id ORDER BY x.sequence DESC LIMIT 1) r ON true
    JOIN file_objects f ON f.id = r.file_object_id
    WHERE md.project_id = p_project
    ORDER BY d.identifier;
END $$;

-- Tutte le cartelle del progetto (riservate comprese) con l'organizzazione proprietaria, per l'esportazione.
CREATE FUNCTION cde.model_folders(p_project uuid)
RETURNS TABLE (id uuid, parent_id uuid, name text, owner_code text, is_private boolean, inherit_permissions boolean,
               naming_profile_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF NOT has_project_permission(current_app_user(), p_project, 'ADMIN', 'PROJECT') THEN
    RAISE EXCEPTION 'Riservato al Project Admin' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT c.id, c.parent_id, c.name, o.code::text, c.is_private, c.inherit_permissions, c.naming_profile_id
    FROM containers c JOIN organizations o ON o.id = c.owner_organization_id
    WHERE c.project_id = p_project ORDER BY c.created_at, c.name;
END $$;

-- Cartella ricreata dall'import di un file di modello, anche di un'organizzazione partecipante.
CREATE FUNCTION cde.model_import_folder(p_project uuid, p_parent uuid, p_owner uuid, p_name text, p_is_private boolean,
                                        p_inherit boolean, p_profile uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT model_fresh_project(p_project) OR NOT EXISTS (SELECT 1 FROM projects WHERE id = p_project AND is_model) THEN
    RAISE EXCEPTION 'Cartelle importabili solo nel modello appena creato' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM project_organizations WHERE project_id = p_project AND organization_id = p_owner)
     OR (p_parent IS NOT NULL AND NOT EXISTS (SELECT 1 FROM containers WHERE id = p_parent AND project_id = p_project))
     OR (p_profile IS NOT NULL AND NOT EXISTS (SELECT 1 FROM naming_profiles WHERE id = p_profile AND project_id = p_project)) THEN
    RAISE EXCEPTION 'Cartella non coerente con il modello' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO containers (project_id, parent_id, owner_organization_id, name, inherit_permissions, is_private,
                          naming_profile_id, created_by)
  VALUES (p_project, p_parent, p_owner, p_name, p_inherit, p_is_private, p_profile, current_app_user())
  RETURNING id INTO v_id;
  -- l'ereditarietà (0030) può aver messo lo schema del padre: vale quello del file
  UPDATE containers SET naming_profile_id = p_profile WHERE id = v_id AND naming_profile_id IS DISTINCT FROM p_profile;
  RETURN v_id;
END $$;

-- Documento di modello copiato: file (già copiato su S3 dall'API con una chiave nuova), documento e prima revisione
-- WIP, verifica del file in coda. Solo nel progetto appena creato da chi chiama: altrimenti sarebbe un modo di
-- caricare saltando naming, permessi della cartella e controlli del caricamento.
CREATE FUNCTION cde.model_insert_document(
    p_project uuid, p_container uuid, p_identifier text, p_naming_fields jsonb, p_title text, p_description text,
    p_attributes jsonb, p_storage_key text, p_version_id text, p_size bigint, p_content_type text, p_sha256 bytea,
    p_filename text, p_revision_code text, p_comment text, p_mark boolean)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  v_user uuid := current_app_user();
  v_file uuid;
  v_doc  uuid;
BEGIN
  IF NOT model_fresh_project(p_project) THEN
    RAISE EXCEPTION 'Documenti di modello copiabili solo nel progetto appena creato' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_storage_key NOT LIKE 'projects/' || p_project || '/files/%' THEN
    RAISE EXCEPTION 'Chiave del file non del progetto' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO file_objects (project_id, storage_key, storage_version_id, size_bytes, content_type, sha256, uploaded_by)
  VALUES (p_project, p_storage_key, p_version_id, p_size, p_content_type, p_sha256, v_user)
  RETURNING id INTO v_file;
  INSERT INTO documents (project_id, container_id, identifier, naming_fields, originator_organization_id, title,
                         description, attributes, created_by)
  VALUES (p_project, p_container, p_identifier, coalesce(p_naming_fields, '{}'), current_app_org(), p_title,
          p_description, coalesce(p_attributes, '{}'), v_user)
  RETURNING id INTO v_doc;
  INSERT INTO document_revisions (document_id, project_id, sequence, revision_code, suitability, state, file_object_id,
                                  original_filename, comment, created_by)
  VALUES (v_doc, p_project, 1, p_revision_code, 'S0', 'WIP', v_file, p_filename, p_comment, v_user);
  IF p_mark THEN
    INSERT INTO model_documents (document_id, project_id, marked_by) VALUES (v_doc, p_project, v_user);
  END IF;
  PERFORM enqueue_job('cde.verify_file', jsonb_build_object('file_id', v_file::text));
  RETURN v_doc;
END $$;

REVOKE ALL ON FUNCTION cde.copy_project_structure(uuid, uuid, text, boolean, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION cde.model_join(), cde.model_fresh_project(uuid), cde.create_project_model(text, text, text, uuid),
                       cde.save_project_as_model(uuid, text, text),
                       cde.create_project_from_model(uuid, text, text, text, date, date, text, boolean, boolean),
                       cde.model_documents_source(uuid), cde.model_folders(uuid),
                       cde.model_import_folder(uuid, uuid, uuid, text, boolean, boolean, uuid),
                       cde.model_insert_document(uuid, uuid, text, jsonb, text, text, jsonb, text, text, bigint, text,
                                                 bytea, text, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cde.model_join(), cde.model_fresh_project(uuid), cde.create_project_model(text, text, text, uuid),
                          cde.save_project_as_model(uuid, text, text),
                          cde.create_project_from_model(uuid, text, text, text, date, date, text, boolean, boolean),
                          cde.model_documents_source(uuid), cde.model_folders(uuid),
                          cde.model_import_folder(uuid, uuid, uuid, text, boolean, boolean, uuid),
                          cde.model_insert_document(uuid, uuid, text, jsonb, text, text, jsonb, text, text, bigint, text,
                                                    bytea, text, text, text, boolean) TO cde_app;
