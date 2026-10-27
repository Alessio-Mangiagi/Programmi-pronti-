-- "><(((º> sabusabu <º)))><"
-- depends: 0011_markups
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0012 (Sprint 6, G52)
-- KPI della commessa per il Project Manager: stato dei documenti, file in attesa di approvazione,
-- tempi per step, colli di bottiglia, caricamenti per azienda, scadenze superate, RFI.
-- Calcolo live su indici (nessuna vista materializzata): i volumi dell'MVP lo consentono e i numeri
-- sono sempre allineati; se il test di carico (G56) lo richiede si passa a viste materializzate
-- aggiornate dal worker, senza cambiare il contratto dell'API.
-- Riservato al Project Admin: gli aggregati coprono anche il WIP delle altre organizzazioni
-- (solo conteggi; il drill-down passa per le API dei documenti, soggette alla RLS).
-- =====================================================================

CREATE INDEX IF NOT EXISTS ix_tasks_project_status ON cde.tasks (project_id, status);
CREATE INDEX IF NOT EXISTS ix_wf_instances_project ON cde.workflow_instances (project_id, status);
CREATE INDEX IF NOT EXISTS ix_revisions_project_created ON cde.document_revisions (project_id, created_at);

CREATE FUNCTION cde.project_dashboard(p_project uuid, p_org uuid DEFAULT NULL, p_discipline text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  v jsonb;
BEGIN
  IF p_project NOT IN (SELECT my_projects()) THEN
    RAISE EXCEPTION 'Progetto non trovato' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT has_project_permission(current_app_user(), p_project, 'ADMIN', 'PROJECT') THEN
    RAISE EXCEPTION 'Cruscotto riservato al Project Admin' USING ERRCODE = 'insufficient_privilege';
  END IF;

  WITH docs AS (
    SELECT d.id, d.originator_organization_id AS org_id, d.naming_fields ->> 'role' AS discipline
    FROM documents d
    WHERE d.project_id = p_project
      AND (p_org IS NULL OR d.originator_organization_id = p_org)
      AND (p_discipline IS NULL OR d.naming_fields ->> 'role' = p_discipline)
  ),
  current_rev AS (
    SELECT DISTINCT ON (r.document_id) r.document_id, r.state, docs.org_id, docs.discipline
    FROM document_revisions r JOIN docs ON docs.id = r.document_id
    ORDER BY r.document_id, r.sequence DESC
  ),
  open_tasks AS (
    SELECT t.id, t.due_at, t.created_at, t.assignee_id, u.organization_id AS assignee_org, s.name AS step_name,
           i.document_id, (t.due_at IS NOT NULL AND t.due_at < now()) AS overdue
    FROM tasks t
    JOIN workflow_instances i ON i.id = t.instance_id
    JOIN workflow_step_runs s ON s.id = t.step_run_id
    JOIN users u ON u.id = t.assignee_id
    WHERE t.project_id = p_project AND t.status = 'OPEN' AND i.document_id IN (SELECT id FROM docs)
  ),
  steps_done AS (
    SELECT s.name, extract(epoch FROM s.completed_at - s.activated_at) / 3600.0 AS hours
    FROM workflow_step_runs s JOIN workflow_instances i ON i.id = s.instance_id
    WHERE i.project_id = p_project AND s.completed_at IS NOT NULL AND s.completed_at > now() - interval '180 days'
      AND i.document_id IN (SELECT id FROM docs)
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'documents', jsonb_build_object(
      'total', (SELECT count(*) FROM current_rev),
      'by_state', (SELECT coalesce(jsonb_object_agg(state, n), '{}') FROM
                     (SELECT state::text, count(*) n FROM current_rev GROUP BY state) x),
      'by_organization', (SELECT coalesce(jsonb_agg(x ORDER BY x.total DESC), '[]') FROM (
          SELECT o.id AS organization_id, o.code AS organization_code, o.legal_name, count(*) AS total,
                 count(*) FILTER (WHERE c.state = 'WIP') AS wip, count(*) FILTER (WHERE c.state = 'SHARED') AS shared,
                 count(*) FILTER (WHERE c.state = 'PUBLISHED') AS published,
                 count(*) FILTER (WHERE c.state = 'ARCHIVED') AS archived
          FROM current_rev c JOIN organizations o ON o.id = c.org_id GROUP BY o.id) x),
      'by_discipline', (SELECT coalesce(jsonb_agg(x ORDER BY x.total DESC), '[]') FROM (
          SELECT coalesce(discipline, '—') AS discipline, count(*) AS total FROM current_rev GROUP BY discipline) x)),
    'awaiting', jsonb_build_object(
      'workflows_running', (SELECT count(*) FROM workflow_instances i WHERE i.project_id = p_project AND i.status = 'RUNNING'
                              AND i.document_id IN (SELECT id FROM docs)),
      'tasks_open', (SELECT count(*) FROM open_tasks),
      'tasks_overdue', (SELECT count(*) FROM open_tasks WHERE overdue),
      'shared_without_workflow', (SELECT count(*) FROM current_rev c WHERE c.state = 'SHARED'
                                    AND NOT EXISTS (SELECT 1 FROM workflow_instances i WHERE i.document_id = c.document_id
                                                    AND i.status = 'RUNNING'))),
    'step_times', (SELECT coalesce(jsonb_agg(x ORDER BY x.avg_hours DESC), '[]') FROM (
        SELECT name AS step_name, count(*) AS completed, round(avg(hours)::numeric, 1) AS avg_hours,
               round((percentile_cont(0.5) WITHIN GROUP (ORDER BY hours))::numeric, 1) AS median_hours,
               round(max(hours)::numeric, 1) AS max_hours
        FROM steps_done GROUP BY name) x),
    'bottlenecks', (SELECT coalesce(jsonb_agg(x ORDER BY x.open DESC, x.avg_age_hours DESC), '[]') FROM (
        SELECT t.step_name, o.code AS organization_code, count(*) AS open, count(*) FILTER (WHERE t.overdue) AS overdue,
               round(avg(extract(epoch FROM now() - t.created_at) / 3600.0)::numeric, 1) AS avg_age_hours
        FROM open_tasks t JOIN organizations o ON o.id = t.assignee_org
        GROUP BY t.step_name, o.code ORDER BY count(*) DESC LIMIT 20) x),
    'uploads', (SELECT coalesce(jsonb_agg(x ORDER BY x.week, x.organization_code), '[]') FROM (
        SELECT to_char(date_trunc('week', r.created_at), 'YYYY-MM-DD') AS week, o.code AS organization_code, count(*) AS n
        FROM document_revisions r JOIN docs ON docs.id = r.document_id JOIN organizations o ON o.id = r.originator_organization_id
        WHERE r.state = 'WIP' AND r.created_at >= date_trunc('week', now()) - interval '11 weeks'
        GROUP BY 1, 2) x),
    'overdue_tasks', (SELECT coalesce(jsonb_agg(x ORDER BY x.due_at), '[]') FROM (
        SELECT t.id AS task_id, t.due_at, t.step_name, d.id AS document_id, d.identifier, d.title,
               u.first_name || ' ' || u.last_name AS assignee_name, o.code AS organization_code
        FROM open_tasks t JOIN documents d ON d.id = t.document_id JOIN users u ON u.id = t.assignee_id
        JOIN organizations o ON o.id = t.assignee_org
        WHERE t.overdue ORDER BY t.due_at LIMIT 25) x),
    'rfis', (SELECT jsonb_build_object(
        'open', count(*) FILTER (WHERE status = 'OPEN'),
        'answered', count(*) FILTER (WHERE status = 'ANSWERED'),
        'closed', count(*) FILTER (WHERE status = 'CLOSED'),
        'overdue', count(*) FILTER (WHERE status = 'OPEN' AND due_at < now()),
        'avg_answer_hours', round(avg(extract(epoch FROM answered_at - created_at) / 3600.0)::numeric, 1))
      FROM rfis WHERE project_id = p_project AND (p_org IS NULL OR author_org_id = p_org)),
    'overdue_rfis', (SELECT coalesce(jsonb_agg(x ORDER BY x.due_at), '[]') FROM (
        SELECT f.id, 'RFI-' || lpad(f.number::text, 4, '0') AS code, f.subject, f.due_at, o.code AS author_org_code
        FROM rfis f JOIN organizations o ON o.id = f.author_org_id
        WHERE f.project_id = p_project AND f.status = 'OPEN' AND f.due_at < now()
          AND (p_org IS NULL OR f.author_org_id = p_org)
        ORDER BY f.due_at LIMIT 25) x),
    'filters', jsonb_build_object(
      'organizations', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'code', o.code, 'name', o.legal_name)
                                                  ORDER BY o.code), '[]')
                        FROM project_organizations po JOIN organizations o ON o.id = po.organization_id
                        WHERE po.project_id = p_project),
      'disciplines', (SELECT coalesce(jsonb_agg(DISTINCT d.naming_fields ->> 'role'), '[]') FROM documents d
                      WHERE d.project_id = p_project AND d.naming_fields ? 'role'))
  ) INTO v;
  RETURN v;
END $$;

REVOKE ALL ON FUNCTION cde.project_dashboard(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cde.project_dashboard(uuid, uuid, text) TO cde_app;
