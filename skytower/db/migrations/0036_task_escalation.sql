-- "><(((º> sabusabu <º)))><"
-- depends: 0034_suite_portale
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0036
-- Scadenze dei compiti (G35, ADR-44): escalation al responsabile e solleciti ripetuti.
--
-- Prima: un compito scaduto produceva una sola notifica all'incaricato e una sola
-- escalation a chi era indicato nel template (altrimenti a chi aveva avviato il
-- workflow), poi silenzio anche per settimane.
-- Ora:
--   * l'escalation va alla persona indicata nel template (escalation_user_id) se c'è;
--     altrimenti a TUTTI i Project Admin del progetto e a chi ha avviato il workflow
--     (mai all'incaricato stesso: a lui arriva TASK_OVERDUE);
--   * finché il compito resta aperto l'escalation si ripete ogni p_repeat_hours ore
--     (default 72, impostazione CDE_DEADLINE_ESCALATION_REPEAT_HOURS nel worker), con
--     il numero del sollecito e i giorni di ritardo nel testo;
--   * tasks.escalated_at / escalation_count dicono alla UI (inbox, cruscotto, "da fare"
--     del portale) quando e quante volte si è sollecitato.
-- La firma della funzione cambia (secondo parametro): si elimina e si ricrea, con gli
-- stessi permessi (solo cde_worker la esegue, dal job "deadlines" ogni 15 minuti).
-- =====================================================================

ALTER TABLE cde.tasks
  ADD COLUMN IF NOT EXISTS escalated_at     timestamptz,
  ADD COLUMN IF NOT EXISTS escalation_count integer NOT NULL DEFAULT 0;

DROP FUNCTION IF EXISTS cde.process_deadlines(timestamptz);

CREATE FUNCTION cde.process_deadlines(p_now timestamptz DEFAULT now(), p_repeat_hours integer DEFAULT 72)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  k        record;
  f        record;
  v_n      integer := 0;
  v_esc    uuid;
  v_user   uuid;
  v_dest   uuid[];
  v_giorni integer;
  v_testo  text;
  v_nome   text;
BEGIN
  FOR k IN
    SELECT t.*, d.identifier, i.started_by, tpl.definition, i.project_id AS pid,
           u.first_name || ' ' || u.last_name AS assignee_name
    FROM tasks t JOIN workflow_instances i ON i.id = t.instance_id
    JOIN documents d ON d.id = i.document_id JOIN workflow_templates tpl ON tpl.id = i.template_id
    JOIN users u ON u.id = t.assignee_id
    WHERE t.status = 'OPEN' AND t.due_at IS NOT NULL AND i.status = 'RUNNING'
    FOR UPDATE OF t SKIP LOCKED
  LOOP
    IF k.due_at <= p_now THEN
      -- Scaduto. Prima volta: avviso all'incaricato + escalation. Poi: escalation ripetuta
      -- ogni p_repeat_hours finché resta aperto.
      IF k.overdue_notified_at IS NULL OR (p_repeat_hours > 0 AND k.escalated_at IS NOT NULL
                                           AND k.escalated_at + make_interval(hours => p_repeat_hours) <= p_now) THEN
        v_giorni := greatest(0, floor(extract(epoch FROM p_now - k.due_at) / 86400))::integer;
        IF k.overdue_notified_at IS NULL THEN
          PERFORM notify(k.assignee_id, k.pid, 'TASK_OVERDUE', format('Scadenza superata: %s', k.identifier),
                         'Il compito di revisione è scaduto.', format('/compiti?instance=%s', k.instance_id),
                         jsonb_build_object('task_id', k.id));
        END IF;
        -- Destinatari dell'escalation: la persona del template, altrimenti i Project Admin
        -- del progetto più chi ha avviato il workflow. Mai l'incaricato.
        v_esc := (k.definition ->> 'escalation_user_id')::uuid;
        IF v_esc IS NOT NULL AND v_esc <> k.assignee_id THEN
          v_dest := ARRAY[v_esc];
        ELSE
          SELECT coalesce(array_agg(DISTINCT x), '{}') INTO v_dest FROM (
            SELECT m.user_id AS x FROM project_memberships m JOIN roles r ON r.id = m.role_id
            WHERE m.project_id = k.pid AND r.code = 'PROJECT_ADMIN'
              AND (m.expires_at IS NULL OR m.expires_at > p_now)
            UNION SELECT k.started_by) s WHERE x IS NOT NULL AND x <> k.assignee_id;
        END IF;
        v_testo := format('%s non ha completato "%s" su %s: in ritardo di %s giorn%s (sollecito n. %s).',
                          k.assignee_name, (SELECT name FROM workflow_step_runs WHERE id = k.step_run_id),
                          k.identifier, v_giorni, CASE WHEN v_giorni = 1 THEN 'o' ELSE 'i' END, k.escalation_count + 1);
        FOREACH v_user IN ARRAY v_dest LOOP
          PERFORM notify(v_user, k.pid, 'TASK_ESCALATED', format('Escalation: %s', k.identifier), v_testo,
                         format('/compiti?instance=%s', k.instance_id),
                         jsonb_build_object('task_id', k.id, 'days_late', v_giorni, 'escalation', k.escalation_count + 1,
                                            'assignee_id', k.assignee_id));
        END LOOP;
        UPDATE tasks SET overdue_notified_at = coalesce(overdue_notified_at, p_now), escalated_at = p_now,
                         escalation_count = escalation_count + 1
        WHERE id = k.id;
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

  -- RFI: invariato rispetto alla 0007 (promemoria a −24h, scadenza superata una volta).
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

REVOKE ALL ON FUNCTION cde.process_deadlines(timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cde.process_deadlines(timestamptz, integer) TO cde_worker;
