-- "><(((º> sabusabu <º)))><"
-- depends: 0005_documents
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0006 (Sprint 3, G22–G25)
-- Stati del CDE WIP → SHARED → PUBLISHED (+ archiviazione), transizioni configurabili in DB,
-- visibilità per stato, permessi calcolati per insieme (una volta per query).
--
-- Le revisioni restano immutabili: una transizione crea una NUOVA revisione ricodificata che punta
-- allo stesso file (P01.03 WIP → P01 SHARED → C01 PUBLISHED). L'archiviazione riguarda il documento.
-- =====================================================================

CREATE TYPE cde.cde_state AS ENUM ('WIP', 'SHARED', 'PUBLISHED', 'ARCHIVED');

-- ---------------------------------------------------------------------
-- Revisioni: stato e dati denormalizzati (immutabili) per policy veloci
-- ---------------------------------------------------------------------
ALTER TABLE cde.document_revisions
  ADD COLUMN state                      cde.cde_state NOT NULL DEFAULT 'WIP',
  ADD COLUMN container_id               uuid REFERENCES cde.containers (id),
  ADD COLUMN originator_organization_id uuid REFERENCES cde.organizations (id),
  ADD COLUMN derived_from               uuid REFERENCES cde.document_revisions (id),
  ADD COLUMN transition_reason          text;

ALTER TABLE cde.document_revisions DISABLE TRIGGER trg_revisions_no_update;
UPDATE cde.document_revisions r
   SET container_id = d.container_id, originator_organization_id = d.originator_organization_id
  FROM cde.documents d WHERE d.id = r.document_id;
ALTER TABLE cde.document_revisions ENABLE TRIGGER trg_revisions_no_update;

ALTER TABLE cde.document_revisions
  ALTER COLUMN container_id SET NOT NULL,
  ALTER COLUMN originator_organization_id SET NOT NULL,
  DROP CONSTRAINT document_revisions_file_object_id_key,   -- SHARED/PUBLISHED riusano il file della WIP
  ADD CONSTRAINT revision_code_matches_state CHECK (
       (state = 'WIP'       AND revision_code ~ '^P\d{2}\.\d{2}$' AND suitability = 'S0')
    OR (state = 'SHARED'    AND revision_code ~ '^P\d{2}$'        AND suitability ~ '^S[1-4]$')
    OR (state = 'PUBLISHED' AND revision_code ~ '^C\d{2}$'        AND suitability ~ '^(A\d|B\d|CR)$')
  ),
  ADD CONSTRAINT derived_only_after_wip CHECK ((state = 'WIP') = (derived_from IS NULL));
ALTER TABLE cde.document_revisions ALTER COLUMN state DROP DEFAULT;

CREATE INDEX ix_revisions_container_state ON cde.document_revisions (container_id, state);
CREATE INDEX ix_revisions_project_state ON cde.document_revisions (project_id, state);
CREATE INDEX ix_revisions_file ON cde.document_revisions (file_object_id);

-- Container e originatore copiati dal documento (mai dal client)
CREATE OR REPLACE FUNCTION cde.check_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  d documents%ROWTYPE;
BEGIN
  SELECT * INTO d FROM documents WHERE id = NEW.document_id AND project_id = NEW.project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Documento non appartenente al progetto' USING ERRCODE = 'check_violation';
  END IF;
  IF d.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Documento archiviato: sola lettura' USING ERRCODE = 'check_violation';
  END IF;
  NEW.container_id := d.container_id;
  NEW.originator_organization_id := d.originator_organization_id;
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

-- ---------------------------------------------------------------------
-- Documenti: archiviazione (sola lettura)
-- ---------------------------------------------------------------------
ALTER TABLE cde.documents
  ADD COLUMN archived_at    timestamptz,
  ADD COLUMN archived_by    uuid REFERENCES cde.users (id),
  ADD COLUMN archive_reason text,
  ADD CONSTRAINT archive_complete CHECK ((archived_at IS NULL) = (archived_by IS NULL));

-- ---------------------------------------------------------------------
-- Transizioni ammesse (configurazione in DB, non hard-coded). project_id NULL = default.
-- ---------------------------------------------------------------------
CREATE TABLE cde.state_transitions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid REFERENCES cde.projects (id) ON DELETE CASCADE,
  from_state          cde.cde_state         NOT NULL,
  to_state            cde.cde_state         NOT NULL,
  required_action     cde.permission_action NOT NULL,
  originator_only     boolean               NOT NULL DEFAULT false,   -- solo l'organizzazione autrice
  allowed_suitability text[]                NOT NULL DEFAULT '{}',
  reason_required     boolean               NOT NULL DEFAULT false,
  UNIQUE NULLS NOT DISTINCT (project_id, from_state, to_state),
  CHECK (from_state <> to_state)
);

INSERT INTO cde.state_transitions (project_id, from_state, to_state, required_action, originator_only, allowed_suitability, reason_required) VALUES
  (NULL, 'WIP',       'SHARED',    'APPROVE', true,  '{S1,S2,S3,S4}', false),
  (NULL, 'SHARED',    'PUBLISHED', 'APPROVE', false, '{A1,A2,A3,A4,A5,A6,A7,B1,B2,B3,CR}', true),
  (NULL, 'SHARED',    'ARCHIVED',  'ADMIN',   false, '{}', true),
  (NULL, 'PUBLISHED', 'ARCHIVED',  'ADMIN',   false, '{}', true);

-- Regola effettiva: quella di progetto se esiste, altrimenti il default
CREATE FUNCTION cde.effective_transition(p_project_id uuid, p_from cde.cde_state, p_to cde.cde_state)
RETURNS cde.state_transitions
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT * FROM state_transitions
  WHERE from_state = p_from AND to_state = p_to AND (project_id = p_project_id OR project_id IS NULL)
  ORDER BY project_id NULLS LAST LIMIT 1
$$;

-- ---------------------------------------------------------------------
-- Storico transizioni (append-only)
-- ---------------------------------------------------------------------
CREATE TABLE cde.state_change_log (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id       uuid          NOT NULL REFERENCES cde.projects (id),
  document_id      uuid          NOT NULL REFERENCES cde.documents (id),
  from_revision_id uuid          REFERENCES cde.document_revisions (id),
  to_revision_id   uuid          REFERENCES cde.document_revisions (id),
  from_state       cde.cde_state NOT NULL,
  to_state         cde.cde_state NOT NULL,
  reason           text,
  changed_by       uuid          NOT NULL REFERENCES cde.users (id),
  changed_at       timestamptz   NOT NULL DEFAULT now()
);
CREATE INDEX ix_state_log_document ON cde.state_change_log (document_id, changed_at);
CREATE TRIGGER trg_state_log_no_update BEFORE UPDATE OR DELETE ON cde.state_change_log
  FOR EACH ROW EXECUTE FUNCTION cde.forbid_mutation();
CREATE TRIGGER trg_state_log_no_truncate BEFORE TRUNCATE ON cde.state_change_log
  FOR EACH STATEMENT EXECUTE FUNCTION cde.forbid_mutation();

-- =====================================================================
-- Permessi per insieme: calcolati una volta per query (hashed subplan) invece che per riga
-- =====================================================================
CREATE FUNCTION cde.my_projects() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT DISTINCT pm.project_id
  FROM project_memberships pm
  JOIN users u ON u.id = pm.user_id AND u.status = 'ACTIVE'
  JOIN project_organizations po
    ON po.project_id = pm.project_id AND po.organization_id = u.organization_id AND po.is_active
  WHERE pm.user_id = current_app_user() AND (pm.expires_at IS NULL OR pm.expires_at > now())
$$;

-- Insieme dei container su cui l'utente corrente ha l'azione: stessa semantica di has_permission()
CREATE FUNCTION cde.my_containers(p_action cde.permission_action) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  WITH RECURSIVE
  me AS (
    SELECT id, organization_id FROM users WHERE id = current_app_user() AND status = 'ACTIVE'
  ),
  roles_ok AS (
    SELECT DISTINCT pm.project_id, rp.scope
    FROM me
    JOIN project_memberships pm ON pm.user_id = me.id
    JOIN project_organizations po
      ON po.project_id = pm.project_id AND po.organization_id = me.organization_id AND po.is_active
    JOIN role_permissions rp ON rp.role_id = pm.role_id
    WHERE (pm.expires_at IS NULL OR pm.expires_at > now())
      AND (rp.action = p_action OR rp.action = 'ADMIN')
  ),
  granted AS (
    SELECT g.container_id AS id
    FROM access_grants g CROSS JOIN me
    WHERE p_action <> 'ADMIN'
      AND g.revoked_at IS NULL AND g.valid_from <= now() AND (g.valid_until IS NULL OR g.valid_until > now())
      AND p_action = ANY (g.actions)
      AND (   (g.grantee_type = 'USER'         AND g.grantee_user_id = me.id)
           OR (g.grantee_type = 'ORGANIZATION' AND g.grantee_organization_id = me.organization_id))
      AND g.project_id IN (SELECT project_id FROM roles_ok)
    UNION
    SELECT c.id FROM containers c JOIN granted gr ON c.parent_id = gr.id WHERE c.inherit_permissions
  )
  SELECT c.id FROM containers c JOIN roles_ok r ON r.project_id = c.project_id AND r.scope = 'PROJECT'
  UNION
  SELECT c.id FROM containers c
    JOIN roles_ok r ON r.project_id = c.project_id AND r.scope = 'OWN_ORGANIZATION'
    JOIN me ON c.owner_organization_id = me.organization_id
  UNION
  SELECT id FROM granted
$$;

-- =====================================================================
-- Policy aggiornate
-- =====================================================================
DROP POLICY containers_select ON cde.containers;
CREATE POLICY containers_select ON cde.containers FOR SELECT TO cde_app
  USING (id IN (SELECT cde.my_containers('READ')));

-- Visibilità per stato (G23):
--   WIP       solo l'organizzazione autrice (anche per chi ha scope PROJECT), con READ sul container
--   SHARED    chi ha READ sul container (team di coordinamento: ruolo o grant)
--   PUBLISHED tutti i membri del progetto
DROP POLICY revisions_select ON cde.document_revisions;
CREATE POLICY revisions_select ON cde.document_revisions FOR SELECT TO cde_app USING (
  CASE state
    WHEN 'WIP' THEN originator_organization_id = (SELECT cde.current_app_org())
                    AND container_id IN (SELECT cde.my_containers('READ'))
    WHEN 'SHARED' THEN container_id IN (SELECT cde.my_containers('READ'))
    ELSE project_id IN (SELECT cde.my_projects())
  END
);

DROP POLICY revisions_insert ON cde.document_revisions;
CREATE POLICY revisions_insert ON cde.document_revisions FOR INSERT TO cde_app
  WITH CHECK (state = 'WIP'                                  -- le altre nascono solo da transition_revision()
              AND created_by = cde.current_app_user()
              AND cde.document_originator(document_id) = cde.current_app_org()
              AND cde.has_permission(cde.current_app_user(), cde.document_container(document_id), 'WRITE'));

-- Documento visibile se almeno una sua revisione è visibile (la RLS delle revisioni si applica qui)
DROP POLICY documents_select ON cde.documents;
CREATE POLICY documents_select ON cde.documents FOR SELECT TO cde_app USING (
  id IN (SELECT document_id FROM cde.document_revisions)
  OR (created_by = (SELECT cde.current_app_user()) AND NOT EXISTS (
        SELECT 1 FROM cde.document_revisions r WHERE r.document_id = documents.id))   -- appena creato
);

DROP POLICY documents_update ON cde.documents;
CREATE POLICY documents_update ON cde.documents FOR UPDATE TO cde_app
  USING      (archived_at IS NULL AND originator_organization_id = cde.current_app_org()
              AND cde.has_permission(cde.current_app_user(), container_id, 'WRITE'))
  WITH CHECK (archived_at IS NULL AND originator_organization_id = cde.current_app_org()
              AND cde.has_permission(cde.current_app_user(), container_id, 'WRITE'));

DROP POLICY files_select ON cde.file_objects;
CREATE POLICY files_select ON cde.file_objects FOR SELECT TO cde_app USING (
  uploaded_by = (SELECT cde.current_app_user())
  OR id IN (SELECT file_object_id FROM cde.document_revisions)
);
DROP FUNCTION cde.file_visible(uuid);

ALTER TABLE cde.state_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cde.state_change_log  ENABLE ROW LEVEL SECURITY;
CREATE POLICY transitions_select ON cde.state_transitions FOR SELECT TO cde_app
  USING ((project_id IS NULL AND cde.current_app_org() IS NOT NULL)
         OR project_id IN (SELECT cde.my_projects()));
CREATE POLICY state_log_select ON cde.state_change_log FOR SELECT TO cde_app
  USING (document_id IN (SELECT id FROM cde.documents));

-- =====================================================================
-- Transizione di stato (G24): valida regola, permesso, idoneità; ricodifica; registra lo storico.
-- SECURITY DEFINER perché la nuova revisione può essere creata da un'altra organizzazione
-- (es. il DL pubblica un documento del progettista tramite grant APPROVE).
-- =====================================================================
CREATE FUNCTION cde.transition_revision(p_revision_id uuid, p_to cde.cde_state, p_suitability text,
                                        p_reason text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  v_user   uuid := current_app_user();
  r        document_revisions%ROWTYPE;
  latest   document_revisions%ROWTYPE;
  rule     state_transitions%ROWTYPE;
  v_code   text;
  v_new    uuid := gen_random_uuid();
BEGIN
  SELECT * INTO r FROM document_revisions WHERE id = p_revision_id;
  -- invisibile = inesistente (stesse regole della policy di lettura)
  IF NOT FOUND OR NOT EXISTS (
       SELECT 1 WHERE CASE r.state
         WHEN 'WIP' THEN r.originator_organization_id = current_app_org()
                         AND r.container_id IN (SELECT my_containers('READ'))
         WHEN 'SHARED' THEN r.container_id IN (SELECT my_containers('READ'))
         ELSE r.project_id IN (SELECT my_projects()) END) THEN
    RAISE EXCEPTION 'Revisione non trovata' USING ERRCODE = 'no_data_found';
  END IF;

  -- lock del documento: transizioni concorrenti sullo stesso documento si serializzano
  PERFORM 1 FROM documents WHERE id = r.document_id FOR UPDATE;
  SELECT * INTO latest FROM document_revisions WHERE document_id = r.document_id ORDER BY sequence DESC LIMIT 1;
  IF EXISTS (SELECT 1 FROM documents WHERE id = r.document_id AND archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Documento archiviato: sola lettura' USING ERRCODE = 'check_violation';
  END IF;

  rule := effective_transition(r.project_id, r.state, p_to);
  IF rule.id IS NULL THEN
    RAISE EXCEPTION 'Transizione % → % non ammessa', r.state, p_to USING ERRCODE = 'check_violation';
  END IF;
  IF NOT has_permission(v_user, r.container_id, rule.required_action) THEN
    RAISE EXCEPTION 'Permesso % richiesto per la transizione % → %', rule.required_action, r.state, p_to
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF rule.originator_only AND r.originator_organization_id IS DISTINCT FROM current_app_org() THEN
    RAISE EXCEPTION 'Solo l''organizzazione autrice può eseguire questa transizione'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF rule.reason_required AND coalesce(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'Motivazione obbligatoria' USING ERRCODE = 'check_violation';
  END IF;

  IF p_to = 'ARCHIVED' THEN
    UPDATE documents SET archived_at = now(), archived_by = v_user, archive_reason = p_reason
     WHERE id = r.document_id;
    INSERT INTO state_change_log (project_id, document_id, from_revision_id, from_state, to_state, reason, changed_by)
    VALUES (r.project_id, r.document_id, r.id, r.state, 'ARCHIVED', p_reason, v_user);
    PERFORM enqueue_job('cde.notify_state_changed',
      jsonb_build_object('document_id', r.document_id, 'revision_id', r.id, 'to_state', 'ARCHIVED'));
    RETURN r.id;
  END IF;

  -- si promuove solo l'ultima revisione dello stato di partenza (nessun salto all'indietro)
  IF EXISTS (SELECT 1 FROM document_revisions WHERE document_id = r.document_id AND state = r.state
                                               AND sequence > r.sequence) THEN
    RAISE EXCEPTION 'Esiste una revisione % più recente: promuovere quella', r.state USING ERRCODE = 'check_violation';
  END IF;
  IF NOT (p_suitability = ANY (rule.allowed_suitability)) THEN
    RAISE EXCEPTION 'Codice di idoneità % non ammesso per %', p_suitability, p_to USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM file_objects WHERE id = r.file_object_id AND scan_status = 'CLEAN' AND sha256_verified) THEN
    RAISE EXCEPTION 'Il file non ha superato le verifiche: impossibile condividerlo' USING ERRCODE = 'check_violation';
  END IF;

  IF p_to = 'SHARED' THEN
    v_code := substr(r.revision_code, 1, 3);                         -- P01.03 → P01
    IF EXISTS (SELECT 1 FROM document_revisions WHERE document_id = r.document_id AND revision_code = v_code) THEN
      RAISE EXCEPTION 'Revisione % già condivisa: caricare una nuova WIP', v_code USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    SELECT 'C' || lpad((coalesce(max(substr(revision_code, 2)::int), 0) + 1)::text, 2, '0') INTO v_code
      FROM document_revisions WHERE document_id = r.document_id AND state = 'PUBLISHED';
  END IF;

  INSERT INTO document_revisions (id, document_id, project_id, sequence, revision_code, suitability, state,
                                  file_object_id, original_filename, comment, derived_from, transition_reason,
                                  created_by)
  VALUES (v_new, r.document_id, r.project_id, latest.sequence + 1, v_code, p_suitability, p_to,
          r.file_object_id, r.original_filename, r.comment, r.id, p_reason, v_user);
  INSERT INTO state_change_log (project_id, document_id, from_revision_id, to_revision_id, from_state, to_state,
                                reason, changed_by)
  VALUES (r.project_id, r.document_id, r.id, v_new, r.state, p_to, p_reason, v_user);
  PERFORM enqueue_job('cde.notify_state_changed',
    jsonb_build_object('document_id', r.document_id, 'revision_id', v_new, 'to_state', p_to));
  RETURN v_new;
END $$;

-- Whitelist dei task accodabili
CREATE OR REPLACE FUNCTION cde.enqueue_job(p_task text, p_args jsonb, p_queue text DEFAULT 'default',
                                           p_lock text DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = jobs, pg_temp AS $$
DECLARE
  v_ids bigint[];
BEGIN
  IF p_task NOT IN ('cde.verify_file', 'cde.notify_state_changed') THEN
    RAISE EXCEPTION 'Task non ammesso: %', p_task USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_ids := procrastinate_defer_jobs_v1(
    ARRAY[ROW(p_queue, p_task, 0, p_lock, NULL, p_args, NULL)::procrastinate_job_to_defer_v1]);
  RETURN v_ids[1];
END $$;

-- =====================================================================
-- Privilegi
-- =====================================================================
REVOKE ALL ON cde.state_transitions, cde.state_change_log FROM PUBLIC;
GRANT SELECT ON cde.state_transitions, cde.state_change_log TO cde_app;
REVOKE ALL ON FUNCTION cde.transition_revision(uuid, cde.cde_state, text, text),
                       cde.my_containers(cde.permission_action), cde.my_projects(),
                       cde.effective_transition(uuid, cde.cde_state, cde.cde_state) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cde.transition_revision(uuid, cde.cde_state, text, text),
                          cde.my_containers(cde.permission_action), cde.my_projects(),
                          cde.effective_transition(uuid, cde.cde_state, cde.cde_state) TO cde_app;
