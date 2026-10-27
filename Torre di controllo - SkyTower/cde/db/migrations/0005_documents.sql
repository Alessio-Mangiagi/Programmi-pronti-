-- "><(((º> sabusabu <º)))><"
-- depends: 0004_seed_system_roles
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0005 (Sprint 2, G12/G16/G17)
-- Modello documentale: impostazioni di progetto (naming, schema metadati), file su S3,
-- documenti (identificativo ISO univoco per progetto), revisioni immutabili, sessioni di upload,
-- accodamento job (Procrastinate, schema "jobs", creato da dbadmin prima di questa migrazione).
-- =====================================================================

CREATE TYPE cde.scan_status    AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'ERROR');
CREATE TYPE cde.upload_status  AS ENUM ('OPEN', 'COMPLETED', 'ABORTED');

-- ---------------------------------------------------------------------
-- Impostazioni documentali per progetto
-- ---------------------------------------------------------------------
CREATE TABLE cde.project_document_settings (
  project_id       uuid PRIMARY KEY REFERENCES cde.projects (id) ON DELETE CASCADE,
  naming_scheme    jsonb,                     -- NULL = schema ISO 19650 UK NA di default
  metadata_schema  jsonb NOT NULL DEFAULT '{"type": "object", "additionalProperties": true}'::jsonb,
  updated_by       uuid REFERENCES cde.users (id),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Oggetti su storage (S3). Una riga per ogni file caricato; mai sovrascritti.
-- ---------------------------------------------------------------------
CREATE TABLE cde.file_objects (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid            NOT NULL REFERENCES cde.projects (id),
  storage_key         text            NOT NULL UNIQUE,
  storage_version_id  text,
  size_bytes          bigint          NOT NULL CHECK (size_bytes > 0),
  content_type        text            NOT NULL,
  sha256              bytea           NOT NULL CHECK (length(sha256) = 32),   -- dichiarato dal client
  sha256_verified     boolean,                                               -- NULL = da verificare
  scan_status         cde.scan_status NOT NULL DEFAULT 'PENDING',
  scan_detail         text,
  scanned_at          timestamptz,
  uploaded_by         uuid            NOT NULL REFERENCES cde.users (id),
  created_at          timestamptz     NOT NULL DEFAULT now()
);
CREATE INDEX ix_file_objects_pending ON cde.file_objects (created_at) WHERE scan_status = 'PENDING';

-- Solo l'esito delle verifiche è modificabile (dal worker); identità del file immutabile
CREATE FUNCTION cde.guard_file_object() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'I file non si cancellano' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['sha256_verified', 'scan_status', 'scan_detail', 'scanned_at', 'storage_version_id'])
     <> (to_jsonb(OLD) - ARRAY['sha256_verified', 'scan_status', 'scan_detail', 'scanned_at', 'storage_version_id']) THEN
    RAISE EXCEPTION 'Identità del file immutabile' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_file_objects_guard BEFORE UPDATE OR DELETE ON cde.file_objects
  FOR EACH ROW EXECUTE FUNCTION cde.guard_file_object();

-- ---------------------------------------------------------------------
-- Documenti: contenitore logico delle revisioni, identificato dal nome ISO 19650
-- ---------------------------------------------------------------------
CREATE TABLE cde.documents (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                  uuid        NOT NULL REFERENCES cde.projects (id),
  container_id                uuid        NOT NULL REFERENCES cde.containers (id),
  identifier                  text        NOT NULL CHECK (identifier ~ '^[A-Z0-9][A-Z0-9._-]{3,120}$'),
  naming_fields               jsonb       NOT NULL DEFAULT '{}'::jsonb,
  originator_organization_id  uuid        NOT NULL REFERENCES cde.organizations (id),
  title                       text        NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 300),
  description                 text,
  attributes                  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_by                  uuid        NOT NULL REFERENCES cde.users (id),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  search                      tsvector GENERATED ALWAYS AS (
                                setweight(to_tsvector('simple', identifier), 'A') ||
                                setweight(to_tsvector('simple', replace(identifier, '-', ' ')), 'A') ||
                                setweight(to_tsvector('italian', coalesce(title, '')), 'B') ||
                                setweight(to_tsvector('italian', coalesce(description, '')), 'C')
                              ) STORED,
  UNIQUE (project_id, identifier)
);
CREATE INDEX ix_documents_container ON cde.documents (container_id);
CREATE INDEX ix_documents_search ON cde.documents USING gin (search);
CREATE INDEX ix_documents_attributes ON cde.documents USING gin (attributes jsonb_path_ops);
CREATE TRIGGER trg_documents_updated BEFORE UPDATE ON cde.documents
  FOR EACH ROW EXECUTE FUNCTION cde.set_updated_at();

CREATE FUNCTION cde.guard_document() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.project_id <> OLD.project_id OR NEW.identifier <> OLD.identifier
                           OR NEW.originator_organization_id <> OLD.originator_organization_id
                           OR NEW.container_id <> OLD.container_id) THEN
    RAISE EXCEPTION 'Identificativo, progetto, container e originatore di un documento non sono modificabili'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM containers WHERE id = NEW.container_id AND project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'Container non appartenente al progetto' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_documents_guard BEFORE INSERT OR UPDATE ON cde.documents
  FOR EACH ROW EXECUTE FUNCTION cde.guard_document();

-- ---------------------------------------------------------------------
-- Revisioni: append-only. Nessuna sovrascrittura possibile (trigger + privilegi).
-- ---------------------------------------------------------------------
CREATE TABLE cde.document_revisions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id        uuid        NOT NULL REFERENCES cde.documents (id),
  project_id         uuid        NOT NULL REFERENCES cde.projects (id),
  sequence           integer     NOT NULL CHECK (sequence > 0),
  revision_code      text        NOT NULL CHECK (revision_code ~ '^(P\d{2}\.\d{2}|P\d{2}|C\d{2})$'),
  suitability        text        NOT NULL DEFAULT 'S0'
                     CHECK (suitability ~ '^(S[0-4]|A\d|B\d|CR)$'),
  file_object_id     uuid        NOT NULL UNIQUE REFERENCES cde.file_objects (id),
  original_filename  text        NOT NULL,
  comment            text,
  created_by         uuid        NOT NULL REFERENCES cde.users (id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, sequence),          -- lock ottimistico sulla sequenza
  UNIQUE (document_id, revision_code)
);
CREATE INDEX ix_revisions_document ON cde.document_revisions (document_id, sequence DESC);
CREATE TRIGGER trg_revisions_no_update BEFORE UPDATE OR DELETE ON cde.document_revisions
  FOR EACH ROW EXECUTE FUNCTION cde.forbid_mutation();
CREATE TRIGGER trg_revisions_no_truncate BEFORE TRUNCATE ON cde.document_revisions
  FOR EACH STATEMENT EXECUTE FUNCTION cde.forbid_mutation();

CREATE FUNCTION cde.check_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM documents WHERE id = NEW.document_id AND project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'Documento non appartenente al progetto' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM file_objects WHERE id = NEW.file_object_id AND project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'File non appartenente al progetto' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.sequence > 1 AND NOT EXISTS (
    SELECT 1 FROM document_revisions WHERE document_id = NEW.document_id AND sequence = NEW.sequence - 1
  ) THEN
    RAISE EXCEPTION 'Sequenza di revisione non contigua' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_revisions_check BEFORE INSERT ON cde.document_revisions
  FOR EACH ROW EXECUTE FUNCTION cde.check_revision();

-- ---------------------------------------------------------------------
-- Sessioni di upload multipart (S3 presigned)
-- ---------------------------------------------------------------------
CREATE TABLE cde.upload_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid              NOT NULL REFERENCES cde.projects (id),
  container_id    uuid              NOT NULL REFERENCES cde.containers (id),
  user_id         uuid              NOT NULL REFERENCES cde.users (id),
  filename        text              NOT NULL,
  identifier      text              NOT NULL,
  naming_fields   jsonb             NOT NULL DEFAULT '{}'::jsonb,
  size_bytes      bigint            NOT NULL CHECK (size_bytes > 0),
  content_type    text              NOT NULL,
  sha256          bytea             NOT NULL CHECK (length(sha256) = 32),
  storage_key     text              NOT NULL UNIQUE,
  s3_upload_id    text              NOT NULL,
  part_size       bigint            NOT NULL,
  part_count      integer           NOT NULL CHECK (part_count BETWEEN 1 AND 10000),
  metadata        jsonb             NOT NULL DEFAULT '{}'::jsonb,   -- titolo, idoneità, commento, attributi
  status          cde.upload_status NOT NULL DEFAULT 'OPEN',
  revision_id     uuid              REFERENCES cde.document_revisions (id),
  expires_at      timestamptz       NOT NULL,
  created_at      timestamptz       NOT NULL DEFAULT now(),
  completed_at    timestamptz
);
CREATE INDEX ix_upload_sessions_user ON cde.upload_sessions (user_id, status);

-- ---------------------------------------------------------------------
-- Helper permessi documentali
-- ---------------------------------------------------------------------
CREATE FUNCTION cde.document_container(p_document_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT container_id FROM documents WHERE id = p_document_id
$$;

CREATE FUNCTION cde.document_originator(p_document_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT originator_organization_id FROM documents WHERE id = p_document_id
$$;

-- Unicità dell'identificativo nel progetto anche rispetto a documenti in container non visibili
-- (rivela solo che il codice è occupato, come farebbe comunque il vincolo UNIQUE)
CREATE FUNCTION cde.document_identifier_taken(p_project_id uuid, p_identifier text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT is_project_member(current_app_user(), p_project_id)
     AND EXISTS (SELECT 1 FROM documents WHERE project_id = p_project_id AND identifier = p_identifier)
$$;

-- Un file è visibile se è di una revisione leggibile, oppure se l'ho caricato io
CREATE FUNCTION cde.file_visible(p_file_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM file_objects WHERE id = p_file_id AND uploaded_by = current_app_user())
      OR EXISTS (
           SELECT 1 FROM document_revisions r JOIN documents d ON d.id = r.document_id
           WHERE r.file_object_id = p_file_id AND has_permission(current_app_user(), d.container_id, 'READ')
         )
$$;

-- ---------------------------------------------------------------------
-- Accodamento job transazionale (Transactional Outbox su Procrastinate)
-- ---------------------------------------------------------------------
CREATE FUNCTION cde.enqueue_job(p_task text, p_args jsonb, p_queue text DEFAULT 'default',
                                p_lock text DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = jobs, pg_temp AS $$
DECLARE
  v_ids bigint[];
BEGIN
  IF p_task NOT IN ('cde.verify_file') THEN
    RAISE EXCEPTION 'Task non ammesso: %', p_task USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_ids := procrastinate_defer_jobs_v1(
    ARRAY[ROW(p_queue, p_task, 0, p_lock, NULL, p_args, NULL)::procrastinate_job_to_defer_v1]);
  RETURN v_ids[1];
END $$;

-- =====================================================================
-- RLS
-- =====================================================================
ALTER TABLE cde.project_document_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE cde.file_objects              ENABLE ROW LEVEL SECURITY;
ALTER TABLE cde.documents                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE cde.document_revisions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE cde.upload_sessions           ENABLE ROW LEVEL SECURITY;

CREATE POLICY doc_settings_select ON cde.project_document_settings FOR SELECT TO cde_app
  USING (cde.is_project_member(cde.current_app_user(), project_id));
CREATE POLICY doc_settings_insert ON cde.project_document_settings FOR INSERT TO cde_app
  WITH CHECK (cde.has_project_permission(cde.current_app_user(), project_id, 'ADMIN', 'PROJECT'));
CREATE POLICY doc_settings_update ON cde.project_document_settings FOR UPDATE TO cde_app
  USING      (cde.has_project_permission(cde.current_app_user(), project_id, 'ADMIN', 'PROJECT'))
  WITH CHECK (cde.has_project_permission(cde.current_app_user(), project_id, 'ADMIN', 'PROJECT'));

CREATE POLICY files_select ON cde.file_objects FOR SELECT TO cde_app
  USING (cde.file_visible(id));
CREATE POLICY files_insert ON cde.file_objects FOR INSERT TO cde_app
  WITH CHECK (uploaded_by = cde.current_app_user()
              AND cde.is_project_member(cde.current_app_user(), project_id));

CREATE POLICY documents_select ON cde.documents FOR SELECT TO cde_app
  USING (cde.has_permission(cde.current_app_user(), container_id, 'READ'));
CREATE POLICY documents_insert ON cde.documents FOR INSERT TO cde_app
  WITH CHECK (created_by = cde.current_app_user()
              AND originator_organization_id = cde.current_app_org()
              AND cde.has_permission(cde.current_app_user(), container_id, 'WRITE'));
CREATE POLICY documents_update ON cde.documents FOR UPDATE TO cde_app
  USING      (cde.has_permission(cde.current_app_user(), container_id, 'WRITE')
              AND originator_organization_id = cde.current_app_org())
  WITH CHECK (cde.has_permission(cde.current_app_user(), container_id, 'WRITE')
              AND originator_organization_id = cde.current_app_org());

CREATE POLICY revisions_select ON cde.document_revisions FOR SELECT TO cde_app
  USING (cde.has_permission(cde.current_app_user(), cde.document_container(document_id), 'READ'));
-- solo l'organizzazione originatrice produce nuove revisioni del proprio documento
CREATE POLICY revisions_insert ON cde.document_revisions FOR INSERT TO cde_app
  WITH CHECK (created_by = cde.current_app_user()
              AND cde.document_originator(document_id) = cde.current_app_org()
              AND cde.has_permission(cde.current_app_user(), cde.document_container(document_id), 'WRITE'));

CREATE POLICY uploads_own ON cde.upload_sessions FOR ALL TO cde_app
  USING (user_id = cde.current_app_user())
  WITH CHECK (user_id = cde.current_app_user()
              AND cde.has_permission(cde.current_app_user(), container_id, 'WRITE'));

-- Worker: elabora i file di tutti i tenant, ma solo le tabelle che gli servono
CREATE POLICY worker_files_select ON cde.file_objects FOR SELECT TO cde_worker USING (true);
CREATE POLICY worker_files_update ON cde.file_objects FOR UPDATE TO cde_worker USING (true) WITH CHECK (true);

-- =====================================================================
-- Privilegi
-- =====================================================================
REVOKE ALL ON cde.project_document_settings, cde.file_objects, cde.documents, cde.document_revisions,
              cde.upload_sessions FROM PUBLIC;

GRANT SELECT, INSERT ON cde.project_document_settings TO cde_app;
GRANT UPDATE (naming_scheme, metadata_schema, updated_by, updated_at) ON cde.project_document_settings TO cde_app;
GRANT SELECT, INSERT ON cde.file_objects TO cde_app;
GRANT SELECT, INSERT ON cde.documents TO cde_app;
GRANT UPDATE (title, description, attributes) ON cde.documents TO cde_app;
GRANT SELECT, INSERT ON cde.document_revisions TO cde_app;
GRANT SELECT, INSERT ON cde.upload_sessions TO cde_app;
GRANT UPDATE (status, revision_id, completed_at) ON cde.upload_sessions TO cde_app;

GRANT USAGE ON SCHEMA cde TO cde_worker;
GRANT SELECT ON cde.file_objects TO cde_worker;
GRANT UPDATE (sha256_verified, scan_status, scan_detail, scanned_at, storage_version_id) ON cde.file_objects TO cde_worker;
GRANT INSERT ON cde.security_events TO cde_worker;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA cde TO cde_worker;

GRANT EXECUTE ON FUNCTION cde.document_container(uuid), cde.document_originator(uuid), cde.file_visible(uuid),
                          cde.document_identifier_taken(uuid, text),
                          cde.enqueue_job(text, jsonb, text, text) TO cde_app;
