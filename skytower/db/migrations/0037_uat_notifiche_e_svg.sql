-- "><(((º> sabusabu <º)))><"
-- depends: 0035_dwg_derivatives 0036_task_escalation
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0037
-- Correzioni emerse dal giro UAT del 03/11/2026 sulle commesse demo (scenari U08 e U45).
--
-- 1) Esito del workflow a chi ha caricato la revisione. Prima WORKFLOW_REJECTED e WORKFLOW_APPROVED
--    andavano solo a chi aveva avviato il workflow: se lo avviava il BIM Manager, il progettista che
--    aveva caricato la tavola non sapeva che era stata rifiutata (U08) ne' che era pubblicata.
--    Ora la notifica arriva anche a document_revisions.created_by, quando e' una persona diversa.
--
-- 2) Derivato SVG: errori definitivi senza ritentare. Senza ODA File Converter un DWG non si potra'
--    convertire nemmeno al terzo tentativo, ma il derivato restava PENDING per tre giri del job (circa
--    un quarto d'ora) e il viewer mostrava "in preparazione" invece del motivo e del pulsante di download
--    (U45). derivative_done_svg prende un parametro p_final: true = FAILED subito, con il motivo.
-- =====================================================================

CREATE OR REPLACE FUNCTION cde.workflow_complete_task(p_task_id uuid, p_outcome cde.task_outcome, p_comment text DEFAULT NULL)
RETURNS cde.workflow_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  k        tasks%ROWTYPE;
  i        workflow_instances%ROWTYPE;
  s        workflow_step_runs%ROWTYPE;
  t        workflow_templates%ROWTYPE;
  d        documents%ROWTYPE;
  r        document_revisions%ROWTYPE;
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
  SELECT * INTO r FROM document_revisions WHERE id = i.revision_id;

  IF p_outcome = 'REJECTED' THEN
    UPDATE workflow_step_runs SET status = 'REJECTED', completed_at = now() WHERE id = s.id;
    UPDATE tasks SET status = 'CANCELLED' WHERE instance_id = i.id AND status = 'OPEN';
    UPDATE workflow_instances SET status = 'REJECTED', finished_at = now(), outcome_comment = p_comment WHERE id = i.id;
    PERFORM notify(i.started_by, i.project_id, 'WORKFLOW_REJECTED',
      format('Rifiutato: %s', d.identifier),
      format('Step "%s" rifiutato: %s', s.name, p_comment),
      format('/progetti/%s/documenti?doc=%s', i.project_id, d.id),
      jsonb_build_object('instance_id', i.id, 'document_id', d.id));
    -- anche chi ha caricato la revisione, se non e' chi ha avviato il workflow (UAT U08): deve sapere che il
    -- documento e' tornato modificabile e perche'
    IF r.created_by IS NOT NULL AND r.created_by <> i.started_by THEN
      PERFORM notify(r.created_by, i.project_id, 'WORKFLOW_REJECTED',
        format('Rifiutato: %s', d.identifier),
        format('Step "%s" rifiutato: %s. Il documento accetta di nuovo revisioni.', s.name, p_comment),
        format('/progetti/%s/documenti?doc=%s', i.project_id, d.id),
        jsonb_build_object('instance_id', i.id, 'document_id', d.id));
    END IF;
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
  IF r.created_by IS NOT NULL AND r.created_by <> i.started_by THEN
    PERFORM notify(r.created_by, i.project_id, 'WORKFLOW_APPROVED',
      format('Approvato: %s', d.identifier),
      format('Workflow "%s" completato%s.', t.name,
             CASE WHEN v_final IS NOT NULL THEN format(' — documento %s', lower(target ->> 'to_state')) ELSE '' END),
      format('/progetti/%s/documenti?doc=%s', i.project_id, d.id),
      jsonb_build_object('instance_id', i.id, 'document_id', d.id));
  END IF;
  RETURN 'APPROVED';
END $$;

DROP FUNCTION cde.derivative_done_svg(uuid, boolean, text, text, bigint, text, jsonb);
CREATE FUNCTION cde.derivative_done_svg(p_file uuid, p_ok boolean, p_key text, p_version text, p_size bigint,
                                        p_detail text, p_layers jsonb, p_final boolean DEFAULT false)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  UPDATE file_derivatives
  SET status = CASE WHEN p_ok THEN 'READY' WHEN p_final OR attempts >= 3 THEN 'FAILED' ELSE 'PENDING' END,
      storage_key = CASE WHEN p_ok THEN p_key END, storage_version_id = CASE WHEN p_ok THEN p_version END,
      size_bytes = CASE WHEN p_ok THEN p_size END, parts = CASE WHEN p_ok THEN p_layers END,
      detail = left(p_detail, 500), updated_at = now()
  WHERE file_object_id = p_file AND kind = 'SVG'
$$;
REVOKE ALL ON FUNCTION cde.derivative_done_svg(uuid, boolean, text, text, bigint, text, jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cde.derivative_done_svg(uuid, boolean, text, text, bigint, text, jsonb, boolean) TO cde_worker;
