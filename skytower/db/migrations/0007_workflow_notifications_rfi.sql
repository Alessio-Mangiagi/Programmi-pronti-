-- "><(((º> sabusabu <º)))><"
-- depends: 0006_cde_states
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0007 (Sprint 4, G32–G37)
-- Notifiche (in-app + email), workflow di approvazione multi-step con blocco del documento,
-- scadenze/promemoria/escalation, RFI.
-- Il motore gira nel database (funzioni SECURITY DEFINER, lock di riga): ogni passo è atomico.
-- =====================================================================

-- =====================================================================
-- Notifiche
-- =====================================================================
ALTER TABLE cde.users ADD COLUMN locale text NOT NULL DEFAULT 'it' CHECK (locale IN ('it', 'en'));

CREATE TABLE cde.notification_preferences (
  user_id        uuid PRIMARY KEY REFERENCES cde.users (id) ON DELETE CASCADE,
  email_enabled  boolean     NOT NULL DEFAULT true,
  daily_digest   boolean     NOT NULL DEFAULT false,   -- true: niente email immediate, riepilogo giornaliero
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cde.notifications (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid        NOT NULL REFERENCES cde.users (id) ON DELETE CASCADE,
  project_id  uuid        REFERENCES cde.projects (id) ON DELETE CASCADE,
  kind        text        NOT NULL,
  title       text        NOT NULL,
  body        text        NOT NULL DEFAULT '',
  link        text,
  data        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz,
  emailed_at  timestamptz
);
CREATE INDEX ix_notifications_user ON cde.notifications (user_id, id DESC);
CREATE INDEX ix_notifications_unread ON cde.notifications (user_id) WHERE read_at IS NULL;
CREATE INDEX ix_notifications_to_email ON cde.notifications (created_at) WHERE emailed_at IS NULL;

-- Unico punto di creazione: notifica in-app + email immediata (se non in digest)
CREATE FUNCTION cde.notify(p_user uuid, p_project uuid, p_kind text, p_title text, p_body text,
                           p_link text DEFAULT NULL, p_data jsonb DEFAULT '{}'::jsonb)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  v_id bigint;
  v_pref notification_preferences%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user AND status = 'ACTIVE') THEN
    RETURN NULL;
  END IF;
  INSERT INTO notifications (user_id, project_id, kind, title, body, link, data)
  VALUES (p_user, p_project, p_kind, p_title, coalesce(p_body, ''), p_link, coalesce(p_data, '{}'::jsonb))
  RETURNING id INTO v_id;
  SELECT * INTO v_pref FROM notification_preferences WHERE user_id = p_user;
  IF coalesce(v_pref.email_enabled, true) AND NOT coalesce(v_pref.daily_digest, false) THEN
    PERFORM enqueue_job('cde.send_notification_email', jsonb_build_object('notification_id', v_id));
  END IF;
  PERFORM pg_notify('cde_notifications', p_user::text);
  RETURN v_id;
END $$;

CREATE FUNCTION cde.set_my_locale(p_locale text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  UPDATE users SET locale = p_locale WHERE id = current_app_user()
$$;

-- Data leggibile nel fuso del progetto (ripiega su UTC se il fuso non è installato nel server)
CREATE FUNCTION cde.fmt_ts(p_ts timestamptz, p_tz text) RETURNS text
LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN to_char(p_ts AT TIME ZONE p_tz, 'DD/MM/YYYY HH24:MI');
EXCEPTION WHEN invalid_parameter_value THEN
  RETURN to_char(p_ts AT TIME ZONE 'UTC', 'DD/MM/YYYY HH24:MI') || ' UTC';
END $$;

-- =====================================================================
-- Contatori per progetto (numerazione RFI, transmittal…)
-- =====================================================================
CREATE TABLE cde.project_counters (
  project_id  uuid    NOT NULL REFERENCES cde.projects (id) ON DELETE CASCADE,
  kind        text    NOT NULL,
  last_value  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, kind)
);

CREATE FUNCTION cde.next_project_number(p_project uuid, p_kind text) RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  INSERT INTO project_counters (project_id, kind, last_value) VALUES (p_project, p_kind, 1)
  ON CONFLICT (project_id, kind) DO UPDATE SET last_value = project_counters.last_value + 1
  RETURNING last_value
$$;

-- =====================================================================
-- Workflow
-- =====================================================================
CREATE TYPE cde.workflow_status AS ENUM ('RUNNING', 'APPROVED', 'REJECTED', 'CANCELLED');
CREATE TYPE cde.step_status     AS ENUM ('ACTIVE', 'APPROVED', 'REJECTED', 'CANCELLED');
CREATE TYPE cde.task_status     AS ENUM ('OPEN', 'DONE', 'CANCELLED');
CREATE TYPE cde.task_outcome    AS ENUM ('APPROVED', 'APPROVED_WITH_COMMENTS', 'REJECTED');

-- Definizione JSON versionata: modificare un template = nuova versione (le istanze restano sulla loro)
CREATE TABLE cde.workflow_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid        NOT NULL REFERENCES cde.projects (id) ON DELETE CASCADE,
  code        text        NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,40}$'),
  version     integer     NOT NULL CHECK (version > 0),
  name        text        NOT NULL,
  definition  jsonb       NOT NULL CHECK (jsonb_typeof(definition -> 'steps') = 'array'
                                          AND jsonb_array_length(definition -> 'steps') BETWEEN 1 AND 20),
  is_active   boolean     NOT NULL DEFAULT true,
  created_by  uuid        NOT NULL REFERENCES cde.users (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, code, version)
);
CREATE TRIGGER trg_wf_templates_immutable BEFORE UPDATE OF definition, code, version, project_id OR DELETE
  ON cde.workflow_templates FOR EACH ROW EXECUTE FUNCTION cde.forbid_mutation();

CREATE TABLE cde.workflow_instances (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         uuid                NOT NULL REFERENCES cde.projects (id),
  template_id        uuid                NOT NULL REFERENCES cde.workflow_templates (id),
  document_id        uuid                NOT NULL REFERENCES cde.documents (id),
  revision_id        uuid                NOT NULL REFERENCES cde.document_revisions (id),
  status             cde.workflow_status NOT NULL DEFAULT 'RUNNING',
  current_step       integer             NOT NULL DEFAULT 0,
  started_by         uuid                NOT NULL REFERENCES cde.users (id),
  started_at         timestamptz         NOT NULL DEFAULT now(),
  finished_at        timestamptz,
  final_revision_id  uuid                REFERENCES cde.document_revisions (id),
  outcome_comment    text
);
-- Blocco del documento: al massimo un workflow attivo per documento (garanzia a livello DB)
CREATE UNIQUE INDEX ux_workflow_running_document ON cde.workflow_instances (document_id) WHERE status = 'RUNNING';
CREATE INDEX ix_workflow_instances_project ON cde.workflow_instances (project_id, status);

CREATE TABLE cde.workflow_step_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id   uuid            NOT NULL REFERENCES cde.workflow_instances (id),
  step_index    integer         NOT NULL,
  name          text            NOT NULL,
  required      integer         NOT NULL CHECK (required > 0),   -- approvazioni necessarie (quorum)
  status        cde.step_status NOT NULL DEFAULT 'ACTIVE',
  activated_at  timestamptz     NOT NULL DEFAULT now(),
  due_at        timestamptz,
  completed_at  timestamptz,
  UNIQUE (instance_id, step_index)
);

CREATE TABLE cde.tasks (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           uuid             NOT NULL REFERENCES cde.projects (id),
  instance_id          uuid             NOT NULL REFERENCES cde.workflow_instances (id),
  step_run_id          uuid             NOT NULL REFERENCES cde.workflow_step_runs (id),
  assignee_id          uuid             NOT NULL REFERENCES cde.users (id),
  status               cde.task_status  NOT NULL DEFAULT 'OPEN',
  outcome              cde.task_outcome,
  comment              text,
  created_at           timestamptz      NOT NULL DEFAULT now(),
  due_at               timestamptz,
  completed_at         timestamptz,
  reminded_48_at       timestamptz,
  reminded_24_at       timestamptz,
  overdue_notified_at  timestamptz,
  UNIQUE (step_run_id, assignee_id),
  CHECK ((status = 'DONE') = (outcome IS NOT NULL))
);
CREATE INDEX ix_tasks_assignee_open ON cde.tasks (assignee_id) WHERE status = 'OPEN';
CREATE INDEX ix_tasks_due_open ON cde.tasks (due_at) WHERE status = 'OPEN' AND due_at IS NOT NULL;

-- ---------------------------------------------------------------------
-- Blocco del documento durante la revisione (nuove revisioni e transizioni vietate)
-- ---------------------------------------------------------------------
CREATE FUNCTION cde.assert_not_in_review(p_document_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM workflow_instances WHERE document_id = p_document_id AND status = 'RUNNING') THEN
    RAISE EXCEPTION 'Documento bloccato: workflow di revisione in corso' USING ERRCODE = 'lock_not_available';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION cde.check_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  d documents%ROWTYPE;
BEGIN
  SELECT * INTO d FROM documents WHERE id = NEW.document_id AND project_id = NEW.project_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Documento non appartenente al progetto' USING ERRCODE = 'check_violation';
  END IF;
  IF d.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Documento archiviato: sola lettura' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM assert_not_in_review(NEW.document_id);
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
-- Transizioni: nucleo interno (senza controllo del permesso utente) + wrapper pubblico
-- ---------------------------------------------------------------------
CREATE FUNCTION cde.revision_visible_to_me(r cde.document_revisions) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT CASE r.state
    WHEN 'WIP' THEN r.originator_organization_id = current_app_org()
                    AND r.container_id IN (SELECT my_containers('READ'))
    WHEN 'SHARED' THEN r.container_id IN (SELECT my_containers('READ'))
    ELSE r.project_id IN (SELECT my_projects()) END
$$;

CREATE FUNCTION cde.apply_transition(p_revision_id uuid, p_to cde.cde_state, p_suitability text,
                                     p_reason text, p_actor uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  r      document_revisions%ROWTYPE;
  latest document_revisions%ROWTYPE;
  rule   state_transitions%ROWTYPE;
  v_code text;
  v_new  uuid := gen_random_uuid();
BEGIN
  SELECT * INTO STRICT r FROM document_revisions WHERE id = p_revision_id;
  PERFORM 1 FROM documents WHERE id = r.document_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM documents WHERE id = r.document_id AND archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Documento archiviato: sola lettura' USING ERRCODE = 'check_violation';
  END IF;
  rule := effective_transition(r.project_id, r.state, p_to);
  IF rule.id IS NULL THEN
    RAISE EXCEPTION 'Transizione % → % non ammessa', r.state, p_to USING ERRCODE = 'check_violation';
  END IF;
  IF rule.reason_required AND coalesce(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'Motivazione obbligatoria' USING ERRCODE = 'check_violation';
  END IF;

  IF p_to = 'ARCHIVED' THEN
    UPDATE documents SET archived_at = now(), archived_by = p_actor, archive_reason = p_reason WHERE id = r.document_id;
    INSERT INTO state_change_log (project_id, document_id, from_revision_id, from_state, to_state, reason, changed_by)
    VALUES (r.project_id, r.document_id, r.id, r.state, 'ARCHIVED', p_reason, p_actor);
    PERFORM enqueue_job('cde.notify_state_changed',
      jsonb_build_object('document_id', r.document_id, 'revision_id', r.id, 'to_state', 'ARCHIVED'));
    RETURN r.id;
  END IF;

  SELECT * INTO latest FROM document_revisions WHERE document_id = r.document_id ORDER BY sequence DESC LIMIT 1;
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
    v_code := substr(r.revision_code, 1, 3);
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
          r.file_object_id, r.original_filename, r.comment, r.id, p_reason, p_actor);
  INSERT INTO state_change_log (project_id, document_id, from_revision_id, to_revision_id, from_state, to_state,
                                reason, changed_by)
  VALUES (r.project_id, r.document_id, r.id, v_new, r.state, p_to, p_reason, p_actor);
  PERFORM enqueue_job('cde.notify_state_changed',
    jsonb_build_object('document_id', r.document_id, 'revision_id', v_new, 'to_state', p_to));
  RETURN v_new;
END $$;

CREATE OR REPLACE FUNCTION cde.transition_revision(p_revision_id uuid, p_to cde.cde_state, p_suitability text,
                                                   p_reason text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  r    document_revisions%ROWTYPE;
  rule state_transitions%ROWTYPE;
BEGIN
  SELECT * INTO r FROM document_revisions WHERE id = p_revision_id;
  IF NOT FOUND OR NOT revision_visible_to_me(r) THEN
    RAISE EXCEPTION 'Revisione non trovata' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM assert_not_in_review(r.document_id);
  rule := effective_transition(r.project_id, r.state, p_to);
  IF rule.id IS NULL THEN
    RAISE EXCEPTION 'Transizione % → % non ammessa', r.state, p_to USING ERRCODE = 'check_violation';
  END IF;
  IF NOT has_permission(current_app_user(), r.container_id, rule.required_action) THEN
    RAISE EXCEPTION 'Permesso % richiesto per la transizione % → %', rule.required_action, r.state, p_to
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF rule.originator_only AND r.originator_organization_id IS DISTINCT FROM current_app_org() THEN
    RAISE EXCEPTION 'Solo l''organizzazione autrice può eseguire questa transizione'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN apply_transition(p_revision_id, p_to, p_suitability, p_reason, current_app_user());
END $$;

-- ---------------------------------------------------------------------
-- Motore workflow
-- ---------------------------------------------------------------------
-- Risolve gli assegnatari di uno step: utenti espliciti, membri con un ruolo (eventualmente di
-- un'organizzazione), membri con un ruolo nell'organizzazione autrice del documento.
CREATE FUNCTION cde.wf_resolve_assignees(p_project uuid, p_originator uuid, p_step jsonb) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  WITH a AS (SELECT value AS v FROM jsonb_array_elements(p_step -> 'assignees'))
  SELECT DISTINCT u.id
  FROM a
  JOIN project_memberships pm ON pm.project_id = p_project
  JOIN roles r ON r.id = pm.role_id
  JOIN users u ON u.id = pm.user_id AND u.status = 'ACTIVE'
  JOIN project_organizations po ON po.project_id = p_project AND po.organization_id = u.organization_id AND po.is_active
  WHERE (pm.expires_at IS NULL OR pm.expires_at > now())
    AND CASE a.v ->> 'type'
          WHEN 'user' THEN u.id = (a.v ->> 'id')::uuid
          WHEN 'role' THEN r.code = a.v ->> 'code'
                           AND (a.v ->> 'organization_id' IS NULL OR u.organization_id = (a.v ->> 'organization_id')::uuid)
          WHEN 'originator_role' THEN r.code = a.v ->> 'code' AND u.organization_id = p_originator
          ELSE false END
$$;

CREATE FUNCTION cde.wf_activate_step(p_instance uuid, p_index integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  i      workflow_instances%ROWTYPE;
  t      workflow_templates%ROWTYPE;
  d      documents%ROWTYPE;
  step   jsonb;
  v_run  uuid := gen_random_uuid();
  v_due  timestamptz;
  v_cnt  integer;
  v_req  integer;
  v_user uuid;
BEGIN
  SELECT * INTO STRICT i FROM workflow_instances WHERE id = p_instance;
  SELECT * INTO STRICT t FROM workflow_templates WHERE id = i.template_id;
  SELECT * INTO STRICT d FROM documents WHERE id = i.document_id;
  step := t.definition -> 'steps' -> p_index;
  SELECT count(*) INTO v_cnt FROM wf_resolve_assignees(i.project_id, d.originator_organization_id, step);
  IF v_cnt = 0 THEN
    RAISE EXCEPTION 'Nessun assegnatario disponibile per lo step "%"', step ->> 'name' USING ERRCODE = 'check_violation';
  END IF;
  v_req := CASE
    WHEN step ->> 'quorum' = 'ANY' THEN 1
    WHEN jsonb_typeof(step -> 'quorum') = 'object' THEN least(greatest((step -> 'quorum' ->> 'n')::int, 1), v_cnt)
    ELSE v_cnt END;
  v_due := CASE WHEN (step ->> 'sla_hours') IS NOT NULL THEN now() + make_interval(hours => (step ->> 'sla_hours')::int) END;

  INSERT INTO workflow_step_runs (id, instance_id, step_index, name, required, due_at)
  VALUES (v_run, p_instance, p_index, step ->> 'name', v_req, v_due);
  UPDATE workflow_instances SET current_step = p_index WHERE id = p_instance;

  FOR v_user IN SELECT * FROM wf_resolve_assignees(i.project_id, d.originator_organization_id, step) LOOP
    INSERT INTO tasks (project_id, instance_id, step_run_id, assignee_id, due_at)
    VALUES (i.project_id, p_instance, v_run, v_user, v_due);
    PERFORM notify(v_user, i.project_id, 'TASK_ASSIGNED',
      format('Revisione richiesta: %s', d.identifier),
      format('Step "%s" del workflow "%s"%s.', step ->> 'name', t.name,
             CASE WHEN v_due IS NOT NULL THEN format(' — scadenza %s', fmt_ts(v_due, (SELECT timezone FROM projects WHERE id = i.project_id))) ELSE '' END),
      format('/compiti?instance=%s', p_instance),
      jsonb_build_object('instance_id', p_instance, 'document_id', d.id));
  END LOOP;
END $$;

CREATE FUNCTION cde.workflow_start(p_template_id uuid, p_revision_id uuid, p_comment text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  r      document_revisions%ROWTYPE;
  t      workflow_templates%ROWTYPE;
  v_id   uuid := gen_random_uuid();
  target jsonb;
  rule   state_transitions%ROWTYPE;
BEGIN
  SELECT * INTO r FROM document_revisions WHERE id = p_revision_id;
  IF NOT FOUND OR NOT revision_visible_to_me(r) THEN
    RAISE EXCEPTION 'Revisione non trovata' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO t FROM workflow_templates WHERE id = p_template_id AND project_id = r.project_id AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template di workflow non trovato o non attivo' USING ERRCODE = 'no_data_found';
  END IF;
  -- avvia l'autore (WRITE sul container, propria organizzazione) o un amministratore del container
  IF NOT ((r.originator_organization_id = current_app_org() AND has_permission(current_app_user(), r.container_id, 'WRITE'))
          OR has_permission(current_app_user(), r.container_id, 'ADMIN')) THEN
    RAISE EXCEPTION 'Non puoi avviare un workflow su questo documento' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF EXISTS (SELECT 1 FROM documents WHERE id = r.document_id AND archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Documento archiviato' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM document_revisions WHERE document_id = r.document_id AND sequence > r.sequence) THEN
    RAISE EXCEPTION 'Si può avviare la revisione solo sull''ultima revisione del documento' USING ERRCODE = 'check_violation';
  END IF;
  target := t.definition -> 'on_approved';
  IF target IS NOT NULL AND jsonb_typeof(target) = 'object' THEN
    rule := effective_transition(r.project_id, r.state, (target ->> 'to_state')::cde_state);
    IF rule.id IS NULL OR NOT ((target ->> 'suitability') = ANY (rule.allowed_suitability)) THEN
      RAISE EXCEPTION 'Il template prevede la transizione % → % non applicabile a questa revisione',
        r.state, target ->> 'to_state' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- l'indice unico parziale garantisce un solo workflow attivo per documento
  INSERT INTO workflow_instances (id, project_id, template_id, document_id, revision_id, started_by, outcome_comment)
  VALUES (v_id, r.project_id, t.id, r.document_id, r.id, current_app_user(), p_comment);
  PERFORM wf_activate_step(v_id, 0);
  RETURN v_id;
END $$;

CREATE FUNCTION cde.workflow_complete_task(p_task_id uuid, p_outcome cde.task_outcome, p_comment text DEFAULT NULL)
RETURNS cde.workflow_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  k        tasks%ROWTYPE;
  i        workflow_instances%ROWTYPE;
  s        workflow_step_runs%ROWTYPE;
  t        workflow_templates%ROWTYPE;
  d        documents%ROWTYPE;
  v_ok     integer;
  v_steps  integer;
  v_final  uuid;
  target   jsonb;
BEGIN
  SELECT * INTO k FROM tasks WHERE id = p_task_id AND assignee_id = current_app_user();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Compito non trovato' USING ERRCODE = 'no_data_found';
  END IF;
  -- serializza i compiti paralleli della stessa istanza
  SELECT * INTO i FROM workflow_instances WHERE id = k.instance_id FOR UPDATE;
  SELECT * INTO k FROM tasks WHERE id = p_task_id FOR UPDATE;
  IF k.status <> 'OPEN' OR i.status <> 'RUNNING' THEN
    RAISE EXCEPTION 'Compito già chiuso' USING ERRCODE = 'check_violation';
  END IF;
  IF p_outcome <> 'APPROVED' AND coalesce(btrim(p_comment), '') = '' THEN
    RAISE EXCEPTION 'Commento obbligatorio per questo esito' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE tasks SET status = 'DONE', outcome = p_outcome, comment = p_comment, completed_at = now() WHERE id = k.id;
  SELECT * INTO s FROM workflow_step_runs WHERE id = k.step_run_id FOR UPDATE;
  SELECT * INTO t FROM workflow_templates WHERE id = i.template_id;
  SELECT * INTO d FROM documents WHERE id = i.document_id;

  IF p_outcome = 'REJECTED' THEN
    UPDATE workflow_step_runs SET status = 'REJECTED', completed_at = now() WHERE id = s.id;
    UPDATE tasks SET status = 'CANCELLED' WHERE instance_id = i.id AND status = 'OPEN';
    UPDATE workflow_instances SET status = 'REJECTED', finished_at = now(), outcome_comment = p_comment WHERE id = i.id;
    PERFORM notify(i.started_by, i.project_id, 'WORKFLOW_REJECTED',
      format('Rifiutato: %s', d.identifier),
      format('Step "%s" rifiutato: %s', s.name, p_comment),
      format('/progetti/%s/documenti?doc=%s', i.project_id, d.id),
      jsonb_build_object('instance_id', i.id, 'document_id', d.id));
    RETURN 'REJECTED';
  END IF;

  SELECT count(*) INTO v_ok FROM tasks WHERE step_run_id = s.id AND status = 'DONE' AND outcome <> 'REJECTED';
  IF v_ok < s.required THEN
    RETURN 'RUNNING';
  END IF;

  UPDATE workflow_step_runs SET status = 'APPROVED', completed_at = now() WHERE id = s.id;
  UPDATE tasks SET status = 'CANCELLED' WHERE step_run_id = s.id AND status = 'OPEN';   -- quorum raggiunto
  v_steps := jsonb_array_length(t.definition -> 'steps');
  IF s.step_index + 1 < v_steps THEN
    PERFORM wf_activate_step(i.id, s.step_index + 1);
    RETURN 'RUNNING';
  END IF;

  -- ultimo step approvato: si sblocca il documento e si applica l'eventuale transizione finale
  UPDATE workflow_instances SET status = 'APPROVED', finished_at = now() WHERE id = i.id;
  target := t.definition -> 'on_approved';
  IF target IS NOT NULL AND jsonb_typeof(target) = 'object' THEN
    v_final := apply_transition(i.revision_id, (target ->> 'to_state')::cde_state, target ->> 'suitability',
                                format('Approvato con workflow "%s" v%s', t.name, t.version), current_app_user());
    UPDATE workflow_instances SET final_revision_id = v_final WHERE id = i.id;
  END IF;
  PERFORM notify(i.started_by, i.project_id, 'WORKFLOW_APPROVED',
    format('Approvato: %s', d.identifier),
    format('Workflow "%s" completato%s.', t.name,
           CASE WHEN v_final IS NOT NULL THEN format(' — documento %s', lower(target ->> 'to_state')) ELSE '' END),
    format('/progetti/%s/documenti?doc=%s', i.project_id, d.id),
    jsonb_build_object('instance_id', i.id, 'document_id', d.id));
  RETURN 'APPROVED';
END $$;

CREATE FUNCTION cde.workflow_cancel(p_instance uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  i workflow_instances%ROWTYPE;
  d documents%ROWTYPE;
BEGIN
  SELECT * INTO i FROM workflow_instances WHERE id = p_instance FOR UPDATE;
  IF NOT FOUND OR i.status <> 'RUNNING' THEN
    RAISE EXCEPTION 'Workflow non attivo' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO d FROM documents WHERE id = i.document_id;
  IF NOT (i.started_by = current_app_user() OR has_permission(current_app_user(), d.container_id, 'ADMIN')) THEN
    RAISE EXCEPTION 'Solo chi ha avviato il workflow o un amministratore può annullarlo' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'Motivazione obbligatoria' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE tasks SET status = 'CANCELLED' WHERE instance_id = i.id AND status = 'OPEN';
  UPDATE workflow_step_runs SET status = 'CANCELLED', completed_at = now() WHERE instance_id = i.id AND status = 'ACTIVE';
  UPDATE workflow_instances SET status = 'CANCELLED', finished_at = now(), outcome_comment = p_reason WHERE id = i.id;
END $$;

-- Revisioni sottoposte a revisione dell'utente corrente (compito aperto o svolto):
-- il revisore deve poterle vedere e scaricare anche senza accesso al container.
CREATE FUNCTION cde.my_review_revisions() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT DISTINCT i.revision_id FROM tasks k JOIN workflow_instances i ON i.id = k.instance_id
  WHERE k.assignee_id = current_app_user() AND k.status <> 'CANCELLED'
$$;

DROP POLICY revisions_select ON cde.document_revisions;
CREATE POLICY revisions_select ON cde.document_revisions FOR SELECT TO cde_app USING (
  CASE state
    WHEN 'WIP' THEN originator_organization_id = (SELECT cde.current_app_org())
                    AND container_id IN (SELECT cde.my_containers('READ'))
    WHEN 'SHARED' THEN container_id IN (SELECT cde.my_containers('READ'))
    ELSE project_id IN (SELECT cde.my_projects())
  END
  OR id IN (SELECT cde.my_review_revisions())
);

-- =====================================================================
-- RFI
-- =====================================================================
CREATE TYPE cde.rfi_status AS ENUM ('OPEN', 'ANSWERED', 'CLOSED');

CREATE TABLE cde.rfis (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           uuid           NOT NULL REFERENCES cde.projects (id),
  number               integer        NOT NULL,
  subject              text           NOT NULL CHECK (length(btrim(subject)) BETWEEN 3 AND 300),
  question             text           NOT NULL CHECK (length(btrim(question)) > 0),
  status               cde.rfi_status NOT NULL DEFAULT 'OPEN',
  author_id            uuid           NOT NULL REFERENCES cde.users (id),
  author_org_id        uuid           NOT NULL REFERENCES cde.organizations (id),
  due_at               timestamptz,
  created_at           timestamptz    NOT NULL DEFAULT now(),
  answered_at          timestamptz,
  closed_at            timestamptz,
  closed_by            uuid           REFERENCES cde.users (id),
  reminded_at          timestamptz,
  overdue_notified_at  timestamptz,
  UNIQUE (project_id, number)
);

CREATE TABLE cde.rfi_recipients (
  rfi_id           uuid NOT NULL REFERENCES cde.rfis (id) ON DELETE CASCADE,
  organization_id  uuid REFERENCES cde.organizations (id),
  user_id          uuid REFERENCES cde.users (id),
  CHECK ((organization_id IS NULL) <> (user_id IS NULL)),
  UNIQUE NULLS NOT DISTINCT (rfi_id, organization_id, user_id)
);

CREATE TABLE cde.rfi_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rfi_id        uuid        NOT NULL REFERENCES cde.rfis (id),
  author_id     uuid        NOT NULL REFERENCES cde.users (id),
  body          text        NOT NULL CHECK (length(btrim(body)) > 0),
  is_answer     boolean     NOT NULL DEFAULT false,
  revision_ids  uuid[]      NOT NULL DEFAULT '{}',      -- allegati: revisioni di documenti
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_rfi_messages_rfi ON cde.rfi_messages (rfi_id, created_at);
CREATE TRIGGER trg_rfi_messages_no_update BEFORE UPDATE OR DELETE ON cde.rfi_messages
  FOR EACH ROW EXECUTE FUNCTION cde.forbid_mutation();

-- Partecipante: organizzazione autrice, organizzazioni/utenti destinatari; il Project Admin vede tutto
CREATE FUNCTION cde.rfi_participant(p_rfi uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM rfis f
    WHERE f.id = p_rfi AND f.project_id IN (SELECT my_projects())
      AND (   f.author_org_id = current_app_org()
           OR EXISTS (SELECT 1 FROM rfi_recipients rr WHERE rr.rfi_id = f.id
                      AND (rr.organization_id = current_app_org() OR rr.user_id = current_app_user()))
           OR has_project_permission(current_app_user(), f.project_id, 'ADMIN', 'PROJECT')))
$$;

CREATE FUNCTION cde.rfi_recipient_users(p_rfi uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT DISTINCT u.id
  FROM rfi_recipients rr
  JOIN rfis f ON f.id = rr.rfi_id
  JOIN users u ON (u.id = rr.user_id OR u.organization_id = rr.organization_id) AND u.status = 'ACTIVE'
  JOIN project_memberships pm ON pm.user_id = u.id AND pm.project_id = f.project_id
  WHERE rr.rfi_id = p_rfi
$$;

CREATE FUNCTION cde.rfi_create(p_project uuid, p_subject text, p_question text, p_due timestamptz,
                               p_recipient_orgs uuid[], p_recipient_users uuid[], p_revisions uuid[] DEFAULT '{}')
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  v_id  uuid := gen_random_uuid();
  v_num integer;
  v_user uuid;
BEGIN
  IF p_project NOT IN (SELECT my_projects()) THEN
    RAISE EXCEPTION 'Progetto non trovato' USING ERRCODE = 'no_data_found';
  END IF;
  IF coalesce(cardinality(p_recipient_orgs), 0) + coalesce(cardinality(p_recipient_users), 0) = 0 THEN
    RAISE EXCEPTION 'Indicare almeno un destinatario' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(coalesce(p_recipient_orgs, '{}')) o
             WHERE NOT EXISTS (SELECT 1 FROM project_organizations WHERE project_id = p_project AND organization_id = o AND is_active))
     OR EXISTS (SELECT 1 FROM unnest(coalesce(p_recipient_users, '{}')) u
                WHERE NOT is_project_member(u, p_project)) THEN
    RAISE EXCEPTION 'Destinatario non partecipante al progetto' USING ERRCODE = 'check_violation';
  END IF;
  v_num := next_project_number(p_project, 'RFI');
  INSERT INTO rfis (id, project_id, number, subject, question, author_id, author_org_id, due_at)
  VALUES (v_id, p_project, v_num, p_subject, p_question, current_app_user(), current_app_org(), p_due);
  INSERT INTO rfi_recipients (rfi_id, organization_id) SELECT v_id, o FROM unnest(coalesce(p_recipient_orgs, '{}')) o;
  INSERT INTO rfi_recipients (rfi_id, user_id) SELECT v_id, u FROM unnest(coalesce(p_recipient_users, '{}')) u;
  INSERT INTO rfi_messages (rfi_id, author_id, body, revision_ids)
  VALUES (v_id, current_app_user(), p_question, coalesce(p_revisions, '{}'));
  FOR v_user IN SELECT * FROM rfi_recipient_users(v_id) LOOP
    PERFORM notify(v_user, p_project, 'RFI_CREATED', format('RFI-%s: %s', lpad(v_num::text, 4, '0'), p_subject),
                   left(p_question, 500), format('/progetti/%s/rfi/%s', p_project, v_id), jsonb_build_object('rfi_id', v_id));
  END LOOP;
  RETURN v_id;
END $$;

CREATE FUNCTION cde.rfi_post_message(p_rfi uuid, p_body text, p_is_answer boolean, p_revisions uuid[] DEFAULT '{}')
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  f     rfis%ROWTYPE;
  v_id  uuid := gen_random_uuid();
  v_user uuid;
  v_is_recipient boolean;
BEGIN
  IF NOT rfi_participant(p_rfi) THEN
    RAISE EXCEPTION 'RFI non trovata' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO f FROM rfis WHERE id = p_rfi FOR UPDATE;
  IF f.status = 'CLOSED' THEN
    RAISE EXCEPTION 'RFI chiusa' USING ERRCODE = 'check_violation';
  END IF;
  v_is_recipient := current_app_user() IN (SELECT rfi_recipient_users(p_rfi));
  IF p_is_answer AND NOT v_is_recipient THEN
    RAISE EXCEPTION 'Solo i destinatari rispondono formalmente' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO rfi_messages (id, rfi_id, author_id, body, is_answer, revision_ids)
  VALUES (v_id, p_rfi, current_app_user(), p_body, p_is_answer, coalesce(p_revisions, '{}'));
  IF p_is_answer THEN
    UPDATE rfis SET status = 'ANSWERED', answered_at = now() WHERE id = p_rfi;
  END IF;
  FOR v_user IN
    SELECT f.author_id UNION SELECT * FROM rfi_recipient_users(p_rfi)
  LOOP
    CONTINUE WHEN v_user = current_app_user();
    PERFORM notify(v_user, f.project_id, CASE WHEN p_is_answer THEN 'RFI_ANSWERED' ELSE 'RFI_MESSAGE' END,
                   format('RFI-%s: %s', lpad(f.number::text, 4, '0'), CASE WHEN p_is_answer THEN 'risposta ricevuta' ELSE 'nuovo messaggio' END),
                   left(p_body, 500), format('/progetti/%s/rfi/%s', f.project_id, p_rfi), jsonb_build_object('rfi_id', p_rfi));
  END LOOP;
  RETURN v_id;
END $$;

CREATE FUNCTION cde.rfi_close(p_rfi uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  f rfis%ROWTYPE;
BEGIN
  IF NOT rfi_participant(p_rfi) THEN
    RAISE EXCEPTION 'RFI non trovata' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO f FROM rfis WHERE id = p_rfi FOR UPDATE;
  IF NOT (f.author_org_id = current_app_org() OR has_project_permission(current_app_user(), f.project_id, 'ADMIN', 'PROJECT')) THEN
    RAISE EXCEPTION 'Solo l''organizzazione richiedente chiude la RFI' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF f.status = 'CLOSED' THEN
    RAISE EXCEPTION 'RFI già chiusa' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE rfis SET status = 'CLOSED', closed_at = now(), closed_by = current_app_user() WHERE id = p_rfi;
END $$;

-- =====================================================================
-- Scadenze: promemoria −48h/−24h, scadenza superata, escalation (G35)
-- p_now come parametro: i test simulano il tempo che passa ("time travel").
-- =====================================================================
CREATE FUNCTION cde.process_deadlines(p_now timestamptz DEFAULT now()) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  k      record;
  f      record;
  v_n    integer := 0;
  v_esc  uuid;
  v_user uuid;
BEGIN
  FOR k IN
    SELECT t.*, d.identifier, i.started_by, tpl.definition, i.project_id AS pid
    FROM tasks t JOIN workflow_instances i ON i.id = t.instance_id
    JOIN documents d ON d.id = i.document_id JOIN workflow_templates tpl ON tpl.id = i.template_id
    WHERE t.status = 'OPEN' AND t.due_at IS NOT NULL AND i.status = 'RUNNING'
    FOR UPDATE OF t SKIP LOCKED
  LOOP
    IF k.due_at <= p_now THEN
      IF k.overdue_notified_at IS NULL THEN
        PERFORM notify(k.assignee_id, k.pid, 'TASK_OVERDUE', format('Scadenza superata: %s', k.identifier),
                       'Il compito di revisione è scaduto.', format('/compiti?instance=%s', k.instance_id),
                       jsonb_build_object('task_id', k.id));
        v_esc := coalesce((k.definition ->> 'escalation_user_id')::uuid, k.started_by);
        PERFORM notify(v_esc, k.pid, 'TASK_ESCALATED', format('Escalation: %s', k.identifier),
                       'Un compito di revisione assegnato ha superato la scadenza.',
                       format('/compiti?instance=%s', k.instance_id), jsonb_build_object('task_id', k.id));
        UPDATE tasks SET overdue_notified_at = p_now WHERE id = k.id;
        v_n := v_n + 1;
      END IF;
    ELSIF k.due_at - interval '24 hours' <= p_now THEN
      IF k.reminded_24_at IS NULL THEN
        PERFORM notify(k.assignee_id, k.pid, 'TASK_REMINDER', format('Scade entro 24 ore: %s', k.identifier),
                       'Promemoria: compito di revisione in scadenza.', format('/compiti?instance=%s', k.instance_id),
                       jsonb_build_object('task_id', k.id, 'hours', 24));
        UPDATE tasks SET reminded_24_at = p_now, reminded_48_at = coalesce(reminded_48_at, p_now) WHERE id = k.id;
        v_n := v_n + 1;
      END IF;
    ELSIF k.due_at - interval '48 hours' <= p_now AND k.reminded_48_at IS NULL
          AND k.due_at - k.created_at > interval '48 hours' THEN
      PERFORM notify(k.assignee_id, k.pid, 'TASK_REMINDER', format('Scade entro 48 ore: %s', k.identifier),
                     'Promemoria: compito di revisione in scadenza.', format('/compiti?instance=%s', k.instance_id),
                     jsonb_build_object('task_id', k.id, 'hours', 48));
      UPDATE tasks SET reminded_48_at = p_now WHERE id = k.id;
      v_n := v_n + 1;
    END IF;
  END LOOP;

  FOR f IN SELECT * FROM rfis WHERE status = 'OPEN' AND due_at IS NOT NULL FOR UPDATE SKIP LOCKED LOOP
    IF f.due_at <= p_now AND f.overdue_notified_at IS NULL THEN
      FOR v_user IN SELECT f.author_id UNION SELECT * FROM rfi_recipient_users(f.id) LOOP
        PERFORM notify(v_user, f.project_id, 'RFI_OVERDUE', format('RFI-%s scaduta', lpad(f.number::text, 4, '0')),
                       f.subject, format('/progetti/%s/rfi/%s', f.project_id, f.id), jsonb_build_object('rfi_id', f.id));
      END LOOP;
      UPDATE rfis SET overdue_notified_at = p_now WHERE id = f.id;
      v_n := v_n + 1;
    ELSIF f.due_at > p_now AND f.due_at - interval '24 hours' <= p_now AND f.reminded_at IS NULL THEN
      FOR v_user IN SELECT * FROM rfi_recipient_users(f.id) LOOP
        PERFORM notify(v_user, f.project_id, 'RFI_REMINDER', format('RFI-%s in scadenza', lpad(f.number::text, 4, '0')),
                       f.subject, format('/progetti/%s/rfi/%s', f.project_id, f.id), jsonb_build_object('rfi_id', f.id));
      END LOOP;
      UPDATE rfis SET reminded_at = p_now WHERE id = f.id;
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN v_n;
END $$;

-- Whitelist dei task accodabili
CREATE OR REPLACE FUNCTION cde.enqueue_job(p_task text, p_args jsonb, p_queue text DEFAULT 'default',
                                           p_lock text DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = jobs, pg_temp AS $$
DECLARE
  v_ids bigint[];
BEGIN
  IF p_task NOT IN ('cde.verify_file', 'cde.notify_state_changed', 'cde.send_notification_email') THEN
    RAISE EXCEPTION 'Task non ammesso: %', p_task USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_ids := procrastinate_defer_jobs_v1(
    ARRAY[ROW(p_queue, p_task, 0, p_lock, NULL, p_args, NULL)::procrastinate_job_to_defer_v1]);
  RETURN v_ids[1];
END $$;

-- =====================================================================
-- RLS
-- =====================================================================
ALTER TABLE cde.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE cde.notifications           ENABLE ROW LEVEL SECURITY;
ALTER TABLE cde.workflow_templates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE cde.workflow_instances      ENABLE ROW LEVEL SECURITY;
ALTER TABLE cde.workflow_step_runs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE cde.tasks                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE cde.rfis                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE cde.rfi_recipients          ENABLE ROW LEVEL SECURITY;
ALTER TABLE cde.rfi_messages            ENABLE ROW LEVEL SECURITY;
ALTER TABLE cde.project_counters        ENABLE ROW LEVEL SECURITY;

CREATE POLICY prefs_own ON cde.notification_preferences FOR ALL TO cde_app
  USING (user_id = cde.current_app_user()) WITH CHECK (user_id = cde.current_app_user());
CREATE POLICY notifications_own ON cde.notifications FOR SELECT TO cde_app
  USING (user_id = (SELECT cde.current_app_user()));
CREATE POLICY notifications_mark_read ON cde.notifications FOR UPDATE TO cde_app
  USING (user_id = cde.current_app_user()) WITH CHECK (user_id = cde.current_app_user());

CREATE POLICY wf_templates_select ON cde.workflow_templates FOR SELECT TO cde_app
  USING (project_id IN (SELECT cde.my_projects()));
CREATE POLICY wf_templates_insert ON cde.workflow_templates FOR INSERT TO cde_app
  WITH CHECK (created_by = cde.current_app_user()
              AND cde.has_project_permission(cde.current_app_user(), project_id, 'ADMIN', 'PROJECT'));
CREATE POLICY wf_templates_update ON cde.workflow_templates FOR UPDATE TO cde_app
  USING      (cde.has_project_permission(cde.current_app_user(), project_id, 'ADMIN', 'PROJECT'))
  WITH CHECK (cde.has_project_permission(cde.current_app_user(), project_id, 'ADMIN', 'PROJECT'));

-- istanze visibili a chi vede il documento o vi ha un compito (helper definer: niente ricorsione con tasks)
CREATE FUNCTION cde.my_task_instances() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT DISTINCT instance_id FROM tasks WHERE assignee_id = current_app_user()
$$;
CREATE POLICY wf_instances_select ON cde.workflow_instances FOR SELECT TO cde_app USING (
  document_id IN (SELECT id FROM cde.documents)
  OR id IN (SELECT cde.my_task_instances())
);
CREATE POLICY wf_steps_select ON cde.workflow_step_runs FOR SELECT TO cde_app
  USING (instance_id IN (SELECT id FROM cde.workflow_instances));
CREATE POLICY tasks_select ON cde.tasks FOR SELECT TO cde_app USING (
  assignee_id = (SELECT cde.current_app_user())
  OR instance_id IN (SELECT id FROM cde.workflow_instances)
);

CREATE POLICY rfis_select ON cde.rfis FOR SELECT TO cde_app USING (cde.rfi_participant(id));
CREATE POLICY rfi_recipients_select ON cde.rfi_recipients FOR SELECT TO cde_app USING (cde.rfi_participant(rfi_id));
CREATE POLICY rfi_messages_select ON cde.rfi_messages FOR SELECT TO cde_app USING (cde.rfi_participant(rfi_id));

-- Worker: invio email e digest
CREATE POLICY worker_notifications_select ON cde.notifications FOR SELECT TO cde_worker USING (true);
CREATE POLICY worker_notifications_update ON cde.notifications FOR UPDATE TO cde_worker USING (true) WITH CHECK (true);
CREATE POLICY worker_prefs_select ON cde.notification_preferences FOR SELECT TO cde_worker USING (true);
CREATE POLICY worker_users_select ON cde.users FOR SELECT TO cde_worker USING (true);

-- =====================================================================
-- Privilegi
-- =====================================================================
REVOKE ALL ON cde.notification_preferences, cde.notifications, cde.workflow_templates, cde.workflow_instances,
              cde.workflow_step_runs, cde.tasks, cde.rfis, cde.rfi_recipients, cde.rfi_messages,
              cde.project_counters FROM PUBLIC;

GRANT SELECT (locale) ON cde.users TO cde_app;
GRANT SELECT, INSERT ON cde.notification_preferences TO cde_app;
GRANT UPDATE (email_enabled, daily_digest, updated_at) ON cde.notification_preferences TO cde_app;
GRANT SELECT ON cde.notifications TO cde_app;
GRANT UPDATE (read_at) ON cde.notifications TO cde_app;
GRANT SELECT, INSERT ON cde.workflow_templates TO cde_app;
GRANT UPDATE (is_active, name) ON cde.workflow_templates TO cde_app;
GRANT SELECT ON cde.workflow_instances, cde.workflow_step_runs, cde.tasks, cde.rfis, cde.rfi_recipients,
                cde.rfi_messages TO cde_app;

GRANT SELECT (id, email, first_name, last_name, locale, status) ON cde.users TO cde_worker;
GRANT SELECT ON cde.notification_preferences TO cde_worker;
GRANT SELECT ON cde.notifications TO cde_worker;
GRANT UPDATE (emailed_at) ON cde.notifications TO cde_worker;

REVOKE ALL ON FUNCTION cde.notify(uuid, uuid, text, text, text, text, jsonb),
                       cde.next_project_number(uuid, text),
                       cde.apply_transition(uuid, cde.cde_state, text, text, uuid),
                       cde.wf_activate_step(uuid, integer),
                       cde.wf_resolve_assignees(uuid, uuid, jsonb),
                       cde.process_deadlines(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  cde.workflow_start(uuid, uuid, text), cde.workflow_complete_task(uuid, cde.task_outcome, text),
  cde.workflow_cancel(uuid, text), cde.rfi_create(uuid, text, text, timestamptz, uuid[], uuid[], uuid[]),
  cde.rfi_post_message(uuid, text, boolean, uuid[]), cde.rfi_close(uuid), cde.rfi_participant(uuid),
  cde.rfi_recipient_users(uuid), cde.revision_visible_to_me(cde.document_revisions),
  cde.assert_not_in_review(uuid), cde.set_my_locale(text), cde.my_review_revisions(), cde.my_task_instances()
TO cde_app;
GRANT EXECUTE ON FUNCTION cde.process_deadlines(timestamptz) TO cde_worker;
