-- "><(((º> sabusabu <º)))><"
-- depends: 0038_sicurezza_suite
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0039: workflow a grafo (ADR-48, docs/workflow-grafo.md)
--
-- Prima un workflow era una lista di passi in fila (definition.steps), sempre su una revisione di
-- documento, con tre esiti fissi. Dal 03/11/2026 è un grafo disegnato su un foglio a scacchiera:
--   * nodi start / decision / activity / notification / end, ciascuno in una casella (cell);
--   * esiti liberi per nodo (codice, etichetta, colore: un esito rosso decide subito);
--   * archi per esito, più archi con lo stesso esito = rami paralleli, ritorni indietro (max 20 giri);
--   * riunione dei rami (join ANY / ALL con la regola di raggiungibilità del contratto);
--   * oggetto DOCUMENT (revisione, passaggio di stato CDE alla fine) o PROCESS (senza documento, con
--     documenti allegati: es. RdA → gara → affidamento).
--
-- Cosa fa questa migrazione:
--   1. converte tutti i modelli esistenti nella versione 2 (stessa funzione usata dall'API in ingresso);
--   2. istanze con documento facoltativo, titolo/descrizione per i processi, esito OK/KO;
--   3. giri dei nodi (workflow_node_runs) al posto dei passi (workflow_step_runs), archi percorsi
--      (workflow_edges_taken), documenti allegati ai processi; le istanze in corso proseguono dal
--      passo in cui erano (il passo attivo diventa il giro del nodo corrispondente, stesso id);
--   4. compiti legati al giro del nodo, esito testuale (il codice dell'esito libero);
--   5. motore riscritto: avvio documento/processo, completamento, annullamento, scadenze, cruscotto.
-- Il motore resta nel database (funzioni SECURITY DEFINER, lock di riga sull'istanza): ogni avanzamento,
-- con tutti i rami che fa partire, è atomico.
-- =====================================================================

-- =====================================================================
-- 1. Conversione versione 1 → versione 2
-- =====================================================================
-- Stessa logica di cde_api.modules.workflow_graph.convert_v1: start → un nodo decision per passo
-- (esiti Approvato / Approvato con commenti verdi, Rifiutato rosso) → end OK "Approvato", end KO "Rifiutato".
CREATE FUNCTION cde.wf_convert_v1(p jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = cde, pg_temp AS $$
DECLARE
  n      integer;
  i      integer;
  v_step jsonb;
  nodes  jsonb := '[]'::jsonb;
  edges  jsonb := '[]'::jsonb;
  outs   jsonb := '[{"code": "APPROVED", "label": "Approvato", "color": "green"},
                    {"code": "APPROVED_WITH_COMMENTS", "label": "Approvato con commenti", "color": "green"},
                    {"code": "REJECTED", "label": "Rifiutato", "color": "red"}]'::jsonb;
  v_next text;
  res    jsonb;
BEGIN
  IF p ? 'nodes' THEN
    RETURN p;   -- già versione 2
  END IF;
  n := jsonb_array_length(p -> 'steps');
  nodes := nodes || jsonb_build_array(jsonb_build_object('id', 'inizio', 'type', 'start', 'name', 'Avvio',
                                                         'cell', jsonb_build_object('col', 0, 'row', 0)));
  edges := edges || jsonb_build_array(jsonb_build_object('from', 'inizio', 'to', 'passo_1'));
  FOR i IN 1..n LOOP
    v_step := p -> 'steps' -> (i - 1);
    nodes := nodes || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'id', 'passo_' || i, 'type', 'decision', 'name', v_step ->> 'name', 'assignees', v_step -> 'assignees',
      'quorum', coalesce(v_step -> 'quorum', '"ALL"'::jsonb), 'sla_hours', v_step -> 'sla_hours',
      'outcomes', outs, 'cell', jsonb_build_object('col', i, 'row', 0))));
    v_next := CASE WHEN i < n THEN 'passo_' || (i + 1) ELSE 'approvato' END;
    edges := edges || jsonb_build_array(
      jsonb_build_object('from', 'passo_' || i, 'outcome', 'APPROVED', 'to', v_next),
      jsonb_build_object('from', 'passo_' || i, 'outcome', 'APPROVED_WITH_COMMENTS', 'to', v_next),
      jsonb_build_object('from', 'passo_' || i, 'outcome', 'REJECTED', 'to', 'rifiutato'));
  END LOOP;
  nodes := nodes || jsonb_build_array(
    jsonb_build_object('id', 'approvato', 'type', 'end', 'name', 'Approvato', 'result', 'OK',
                       'cell', jsonb_build_object('col', n + 1, 'row', 0)),
    jsonb_build_object('id', 'rifiutato', 'type', 'end', 'name', 'Rifiutato', 'result', 'KO',
                       'cell', jsonb_build_object('col', n + 1, 'row', 1)));
  res := jsonb_build_object('version', 2, 'subject', 'DOCUMENT', 'nodes', nodes, 'edges', edges);
  IF jsonb_typeof(p -> 'on_approved') = 'object' THEN
    res := res || jsonb_build_object('on_completed', p -> 'on_approved');
  END IF;
  IF p ->> 'escalation_user_id' IS NOT NULL THEN
    res := res || jsonb_build_object('escalation_user_id', p -> 'escalation_user_id');
  END IF;
  RETURN res;
END $$;

-- Il vincolo della versione 1 (definition.steps 1–20) lascia il posto a quello della versione 2.
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'cde.workflow_templates'::regclass AND contype = 'c'
             AND pg_get_constraintdef(oid) ILIKE '%steps%' LOOP
    EXECUTE format('ALTER TABLE cde.workflow_templates DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

-- I modelli sono immutabili (una modifica = nuova versione): la conversione è l'unica eccezione,
-- fatta qui una volta sola con il trigger spento e riacceso subito dopo.
ALTER TABLE cde.workflow_templates DISABLE TRIGGER trg_wf_templates_immutable;
UPDATE cde.workflow_templates SET definition = cde.wf_convert_v1(definition) WHERE NOT definition ? 'nodes';
ALTER TABLE cde.workflow_templates ENABLE TRIGGER trg_wf_templates_immutable;

ALTER TABLE cde.workflow_templates ADD CONSTRAINT workflow_templates_definition_v2 CHECK (
  definition ->> 'version' = '2'
  AND jsonb_typeof(definition -> 'nodes') = 'array' AND jsonb_array_length(definition -> 'nodes') BETWEEN 2 AND 60
  AND jsonb_typeof(definition -> 'edges') = 'array' AND jsonb_array_length(definition -> 'edges') <= 200);
-- L'oggetto sta nella definizione (così la copia da progetto modello e l'import lo portano con sé);
-- la colonna generata serve a filtrare e a leggerlo senza aprire il JSON.
ALTER TABLE cde.workflow_templates ADD COLUMN subject text GENERATED ALWAYS AS (
  CASE WHEN definition ->> 'subject' = 'PROCESS' THEN 'PROCESS' ELSE 'DOCUMENT' END) STORED;

-- =====================================================================
-- 2. Istanze: documento facoltativo, processi, esito
-- =====================================================================
ALTER TABLE cde.workflow_instances
  ALTER COLUMN document_id DROP NOT NULL,
  ALTER COLUMN revision_id DROP NOT NULL,
  ADD COLUMN subject text NOT NULL DEFAULT 'DOCUMENT' CHECK (subject IN ('DOCUMENT', 'PROCESS')),
  ADD COLUMN title text CHECK (title IS NULL OR length(btrim(title)) BETWEEN 2 AND 200),
  ADD COLUMN description text CHECK (description IS NULL OR length(description) <= 4000),
  ADD COLUMN result text CHECK (result IN ('OK', 'KO'));
ALTER TABLE cde.workflow_instances ADD CONSTRAINT wf_instances_subject_shape CHECK (
  (subject = 'DOCUMENT' AND document_id IS NOT NULL AND revision_id IS NOT NULL)
  OR (subject = 'PROCESS' AND document_id IS NULL AND revision_id IS NULL AND title IS NOT NULL));
UPDATE cde.workflow_instances SET result = CASE status WHEN 'APPROVED' THEN 'OK' WHEN 'REJECTED' THEN 'KO' END;

-- un solo workflow attivo per documento (stesso nome: errors.py lo traduce in 409)
DROP INDEX cde.ux_workflow_running_document;
CREATE UNIQUE INDEX ux_workflow_running_document ON cde.workflow_instances (document_id)
  WHERE status = 'RUNNING' AND document_id IS NOT NULL;

-- Documenti allegati a un processo: ognuno li vede solo se può vedere il documento (RLS sotto).
CREATE TABLE cde.workflow_instance_documents (
  instance_id uuid NOT NULL REFERENCES cde.workflow_instances (id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES cde.documents (id),
  PRIMARY KEY (instance_id, document_id)
);

-- =====================================================================
-- 3. Giri dei nodi e archi percorsi
-- =====================================================================
-- Un nodo può attivarsi più volte nella stessa istanza (ritorno indietro): ogni attivazione è un giro.
CREATE TABLE cde.workflow_node_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id  uuid        NOT NULL REFERENCES cde.workflow_instances (id),
  node_id      text        NOT NULL,
  node_type    text        NOT NULL CHECK (node_type IN ('start', 'decision', 'activity', 'notification', 'end')),
  name         text        NOT NULL,
  round        integer     NOT NULL CHECK (round BETWEEN 1 AND 20),
  status       text        NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DONE', 'CANCELLED')),
  outcome      text,
  required     integer     NOT NULL DEFAULT 0,      -- voti necessari (quorum); 0 per i nodi automatici
  activated_at timestamptz NOT NULL DEFAULT now(),
  due_at       timestamptz,
  completed_at timestamptz,
  UNIQUE (instance_id, node_id, round)
);
CREATE INDEX ix_wf_node_runs_active ON cde.workflow_node_runs (instance_id) WHERE status = 'ACTIVE';

-- Ogni arco percorso: è anche un "arrivo" al nodo di destinazione. consumed = già usato per attivarlo
-- (o ignorato da un join ANY): gli arrivi non consumati sono quelli che un join ALL sta aspettando.
CREATE TABLE cde.workflow_edges_taken (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  instance_id uuid        NOT NULL REFERENCES cde.workflow_instances (id),
  from_node   text        NOT NULL,
  outcome     text,
  to_node     text        NOT NULL,
  round       integer     NOT NULL,                 -- giro del nodo di partenza
  taken_at    timestamptz NOT NULL DEFAULT now(),
  consumed    boolean     NOT NULL DEFAULT false
);
CREATE INDEX ix_wf_edges_instance ON cde.workflow_edges_taken (instance_id, id);
CREATE INDEX ix_wf_edges_pending ON cde.workflow_edges_taken (instance_id, to_node) WHERE NOT consumed;

-- Conversione delle istanze esistenti: il passo i (0-based) è il nodo "passo_<i+1>" della definizione
-- convertita; stesso id del vecchio passo, così i compiti si ricollegano senza perdere nulla.
INSERT INTO cde.workflow_node_runs (id, instance_id, node_id, node_type, name, round, status, outcome, required,
                                    activated_at, due_at, completed_at)
SELECT s.id, s.instance_id, 'passo_' || (s.step_index + 1), 'decision', s.name, 1,
       CASE s.status WHEN 'ACTIVE' THEN 'ACTIVE' WHEN 'CANCELLED' THEN 'CANCELLED' ELSE 'DONE' END,
       CASE s.status WHEN 'APPROVED' THEN 'APPROVED' WHEN 'REJECTED' THEN 'REJECTED' END,
       s.required, s.activated_at, s.due_at, s.completed_at
FROM cde.workflow_step_runs s;

-- avvio e (per le istanze concluse) stato finale, perché la vista finale le disegni complete
INSERT INTO cde.workflow_node_runs (instance_id, node_id, node_type, name, round, status, activated_at, completed_at)
SELECT i.id, 'inizio', 'start', 'Avvio', 1, 'DONE', i.started_at, i.started_at FROM cde.workflow_instances i;
INSERT INTO cde.workflow_node_runs (instance_id, node_id, node_type, name, round, status, activated_at, completed_at)
SELECT i.id, CASE i.status WHEN 'APPROVED' THEN 'approvato' ELSE 'rifiutato' END, 'end',
       CASE i.status WHEN 'APPROVED' THEN 'Approvato' ELSE 'Rifiutato' END, 1, 'DONE', i.finished_at, i.finished_at
FROM cde.workflow_instances i WHERE i.status IN ('APPROVED', 'REJECTED');

-- archi percorsi: avvio → primo passo, e da ogni passo concluso al successivo o allo stato finale
INSERT INTO cde.workflow_edges_taken (instance_id, from_node, outcome, to_node, round, taken_at, consumed)
SELECT i.id, 'inizio', NULL, 'passo_1', 1, i.started_at, true FROM cde.workflow_instances i;
INSERT INTO cde.workflow_edges_taken (instance_id, from_node, outcome, to_node, round, taken_at, consumed)
SELECT r.instance_id, r.node_id, r.outcome,
       CASE WHEN r.outcome = 'REJECTED' THEN 'rifiutato'
            WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(t.definition -> 'nodes') n
                         WHERE n ->> 'id' = 'passo_' || (substr(r.node_id, 7)::int + 1)) THEN 'passo_' || (substr(r.node_id, 7)::int + 1)
            ELSE 'approvato' END,
       1, r.completed_at, true
FROM cde.workflow_node_runs r
JOIN cde.workflow_instances i ON i.id = r.instance_id
JOIN cde.workflow_templates t ON t.id = i.template_id
WHERE r.node_type = 'decision' AND r.status = 'DONE' AND r.outcome IS NOT NULL;

-- =====================================================================
-- 4. Compiti legati al giro del nodo, esito testuale
-- =====================================================================
ALTER TABLE cde.tasks ADD COLUMN node_run_id uuid REFERENCES cde.workflow_node_runs (id);
UPDATE cde.tasks SET node_run_id = step_run_id;
ALTER TABLE cde.tasks ALTER COLUMN node_run_id SET NOT NULL;
ALTER TABLE cde.tasks DROP COLUMN step_run_id;           -- porta via FK e UNIQUE (step_run_id, assignee_id)
ALTER TABLE cde.tasks ADD CONSTRAINT tasks_node_run_assignee_key UNIQUE (node_run_id, assignee_id);
ALTER TABLE cde.tasks ALTER COLUMN outcome TYPE text USING outcome::text;
CREATE INDEX ix_tasks_node_run ON cde.tasks (node_run_id);

-- Il vecchio motore a passi esce di scena.
DROP FUNCTION cde.workflow_complete_task(uuid, cde.task_outcome, text);
DROP FUNCTION cde.wf_activate_step(uuid, integer);
DROP POLICY wf_steps_select ON cde.workflow_step_runs;
DROP TABLE cde.workflow_step_runs;
DROP TYPE cde.step_status;
DROP TYPE cde.task_outcome;

-- =====================================================================
-- 5. Motore
-- =====================================================================
-- Il nodo con quell'id nella definizione (NULL se non c'è).
CREATE FUNCTION cde.wf_node(p_def jsonb, p_node text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = cde, pg_temp AS $$
  SELECT n FROM jsonb_array_elements(p_def -> 'nodes') n WHERE n ->> 'id' = p_node LIMIT 1
$$;

-- Esiti di un nodo: un'attività senza esiti dichiarati ha il solo "Fatto".
CREATE FUNCTION cde.wf_outcomes(p_node jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = cde, pg_temp AS $$
  SELECT CASE WHEN jsonb_typeof(p_node -> 'outcomes') = 'array' AND jsonb_array_length(p_node -> 'outcomes') > 0
              THEN p_node -> 'outcomes'
              ELSE '[{"code": "FATTO", "label": "Fatto", "color": "green"}]'::jsonb END
$$;

-- p_to è raggiungibile da p_from seguendo gli archi senza passare da p_to stesso? (regola del join ALL)
CREATE FUNCTION cde.wf_reaches(p_def jsonb, p_from text, p_to text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = cde, pg_temp AS $$
  WITH RECURSIVE e AS (SELECT x ->> 'from' AS f, x ->> 'to' AS t FROM jsonb_array_elements(p_def -> 'edges') x),
  r(n) AS (SELECT e.t FROM e WHERE e.f = p_from
           UNION
           SELECT e.t FROM e JOIN r ON e.f = r.n WHERE r.n <> p_to)
  SELECT EXISTS (SELECT 1 FROM r WHERE n = p_to)
$$;

-- Organizzazione "autrice" per i ruoli originator_role: quella del documento, o di chi ha avviato il processo.
CREATE FUNCTION cde.wf_originator(p_instance uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT coalesce(d.originator_organization_id, u.organization_id)
  FROM workflow_instances i LEFT JOIN documents d ON d.id = i.document_id LEFT JOIN users u ON u.id = i.started_by
  WHERE i.id = p_instance
$$;

-- Etichetta dell'istanza per notifiche e messaggi: identificativo del documento o titolo del processo.
CREATE FUNCTION cde.wf_label(p_instance uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT coalesce(d.identifier, i.title) FROM workflow_instances i LEFT JOIN documents d ON d.id = i.document_id
  WHERE i.id = p_instance
$$;

-- Link dell'istanza nell'interfaccia: il documento, oppure la vista del processo.
CREATE FUNCTION cde.wf_link(p_instance uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT CASE WHEN i.document_id IS NOT NULL THEN format('/progetti/%s/documenti?doc=%s', i.project_id, i.document_id)
              ELSE format('/progetti/%s/processi/%s', i.project_id, i.id) END
  FROM workflow_instances i WHERE i.id = p_instance
$$;

-- Interruzione per errore di disegno (troppi giri): istanza annullata con il motivo, chi l'ha avviata avvisato.
CREATE FUNCTION cde.wf_abort(p_instance uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  i workflow_instances%ROWTYPE;
BEGIN
  SELECT * INTO i FROM workflow_instances WHERE id = p_instance;
  UPDATE tasks SET status = 'CANCELLED' WHERE instance_id = p_instance AND status = 'OPEN';
  UPDATE workflow_node_runs SET status = 'CANCELLED', completed_at = now() WHERE instance_id = p_instance AND status = 'ACTIVE';
  UPDATE workflow_edges_taken SET consumed = true WHERE instance_id = p_instance AND NOT consumed;
  UPDATE workflow_instances SET status = 'CANCELLED', finished_at = now(), outcome_comment = p_reason WHERE id = p_instance;
  PERFORM notify(i.started_by, i.project_id, 'WORKFLOW_CANCELLED', format('Interrotto: %s', wf_label(p_instance)),
                 p_reason, wf_link(p_instance), jsonb_build_object('instance_id', p_instance));
END $$;

-- Stato finale raggiunto: chiude l'istanza (anche se altri rami sono ancora aperti, che vengono annullati),
-- applica il passaggio di stato CDE per i documenti (OK) o sblocca il documento (KO), avvisa.
CREATE FUNCTION cde.wf_finish(p_instance uuid, p_node jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  i        workflow_instances%ROWTYPE;
  t        workflow_templates%ROWTYPE;
  r        document_revisions%ROWTYPE;
  v_ok     boolean := p_node ->> 'result' = 'OK';
  v_final  uuid;
  target   jsonb;
  v_label  text := wf_label(p_instance);
  v_link   text := wf_link(p_instance);
  v_last   text;
  v_body   text;
  v_user   uuid;
BEGIN
  SELECT * INTO i FROM workflow_instances WHERE id = p_instance;
  SELECT * INTO t FROM workflow_templates WHERE id = i.template_id;
  UPDATE tasks SET status = 'CANCELLED' WHERE instance_id = p_instance AND status = 'OPEN';
  UPDATE workflow_node_runs SET status = 'CANCELLED', completed_at = now() WHERE instance_id = p_instance AND status = 'ACTIVE';
  UPDATE workflow_edges_taken SET consumed = true WHERE instance_id = p_instance AND NOT consumed;
  UPDATE workflow_instances SET status = CASE WHEN v_ok THEN 'APPROVED' ELSE 'REJECTED' END::workflow_status,
                                result = CASE WHEN v_ok THEN 'OK' ELSE 'KO' END, finished_at = now()
  WHERE id = p_instance;

  IF i.revision_id IS NOT NULL THEN
    SELECT * INTO r FROM document_revisions WHERE id = i.revision_id;
  END IF;
  IF v_ok THEN
    target := t.definition -> 'on_completed';
    IF i.revision_id IS NOT NULL AND target IS NOT NULL AND jsonb_typeof(target) = 'object' THEN
      v_final := apply_transition(i.revision_id, (target ->> 'to_state')::cde_state, target ->> 'suitability',
                                  format('Approvato con workflow "%s" v%s', t.name, t.version),
                                  coalesce(current_app_user(), i.started_by));
      UPDATE workflow_instances SET final_revision_id = v_final WHERE id = p_instance;
    END IF;
    v_body := format('Workflow "%s" completato: %s%s.', t.name, p_node ->> 'name',
                     CASE WHEN v_final IS NOT NULL THEN format(' — documento %s', lower(target ->> 'to_state')) ELSE '' END);
  ELSE
    -- il nodo che ha portato qui (l'ultimo concluso con un esito) e il commento di chi ha deciso
    SELECT name INTO v_last FROM workflow_node_runs
    WHERE instance_id = p_instance AND node_type IN ('decision', 'activity') AND status = 'DONE'
    ORDER BY completed_at DESC LIMIT 1;
    v_body := format('%s%s: %s', CASE WHEN v_last IS NOT NULL THEN format('Step "%s" — ', v_last) ELSE '' END,
                     p_node ->> 'name', coalesce(i.outcome_comment, 'nessun commento'));
    IF i.revision_id IS NOT NULL THEN
      v_body := v_body || '. Il documento accetta di nuovo revisioni.';
    END IF;
  END IF;
  -- chi ha avviato il workflow e, se diverso, chi ha caricato la revisione (UAT U08)
  FOR v_user IN SELECT i.started_by UNION SELECT r.created_by WHERE r.created_by IS NOT NULL LOOP
    PERFORM notify(v_user, i.project_id, CASE WHEN v_ok THEN 'WORKFLOW_APPROVED' ELSE 'WORKFLOW_REJECTED' END,
                   format('%s: %s', CASE WHEN v_ok THEN (CASE WHEN i.revision_id IS NULL THEN 'Concluso' ELSE 'Approvato' END)
                                         ELSE (CASE WHEN i.revision_id IS NULL THEN 'Non concluso' ELSE 'Rifiutato' END) END,
                          v_label),
                   v_body, v_link,
                   jsonb_build_object('instance_id', p_instance, 'document_id', i.document_id, 'result',
                                      CASE WHEN v_ok THEN 'OK' ELSE 'KO' END));
  END LOOP;
END $$;

-- Attiva un nodo (nuovo giro). Decisioni e attività: compiti agli assegnatari; notifiche: avviso e via;
-- stati finali: chiusura dell'istanza.
CREATE FUNCTION cde.wf_activate_node(p_instance uuid, p_node text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  i       workflow_instances%ROWTYPE;
  t       workflow_templates%ROWTYPE;
  node    jsonb;
  v_type  text;
  v_round integer;
  v_run   uuid := gen_random_uuid();
  v_org   uuid;
  v_cnt   integer;
  v_req   integer;
  v_due   timestamptz;
  v_user  uuid;
  v_label text;
  v_msg   text;
  v_tz    text;
BEGIN
  SELECT * INTO i FROM workflow_instances WHERE id = p_instance;
  IF i.status <> 'RUNNING' THEN
    RETURN;
  END IF;
  SELECT * INTO t FROM workflow_templates WHERE id = i.template_id;
  node := wf_node(t.definition, p_node);
  IF node IS NULL THEN
    RAISE EXCEPTION 'Nodo % non presente nel modello', p_node USING ERRCODE = 'check_violation';
  END IF;
  v_type := node ->> 'type';
  SELECT coalesce(max(round), 0) + 1 INTO v_round FROM workflow_node_runs WHERE instance_id = p_instance AND node_id = p_node;
  IF v_round > 20 THEN
    PERFORM wf_abort(p_instance, format('Interrotto: il nodo "%s" ha superato 20 giri (ritorno indietro senza fine?)',
                                        node ->> 'name'));
    RETURN;
  END IF;
  v_label := wf_label(p_instance);
  v_org := wf_originator(p_instance);
  SELECT timezone INTO v_tz FROM projects WHERE id = i.project_id;

  IF v_type IN ('decision', 'activity') THEN
    SELECT count(*) INTO v_cnt FROM wf_resolve_assignees(i.project_id, v_org, node);
    IF v_cnt = 0 THEN
      RAISE EXCEPTION 'Nessun assegnatario disponibile per lo step "%"', node ->> 'name' USING ERRCODE = 'check_violation';
    END IF;
    v_req := CASE
      WHEN node ->> 'quorum' = 'ANY' THEN 1
      WHEN jsonb_typeof(node -> 'quorum') = 'object' THEN least(greatest((node -> 'quorum' ->> 'n')::int, 1), v_cnt)
      ELSE v_cnt END;
    v_due := CASE WHEN (node ->> 'sla_hours') IS NOT NULL THEN now() + make_interval(hours => (node ->> 'sla_hours')::int) END;
    INSERT INTO workflow_node_runs (id, instance_id, node_id, node_type, name, round, required, due_at)
    VALUES (v_run, p_instance, p_node, v_type, node ->> 'name', v_round, v_req, v_due);
    FOR v_user IN SELECT * FROM wf_resolve_assignees(i.project_id, v_org, node) LOOP
      INSERT INTO tasks (project_id, instance_id, node_run_id, assignee_id, due_at)
      VALUES (i.project_id, p_instance, v_run, v_user, v_due);
      PERFORM notify(v_user, i.project_id, 'TASK_ASSIGNED',
        format(CASE WHEN i.document_id IS NULL THEN 'Compito: %s' ELSE 'Revisione richiesta: %s' END, v_label),
        format('Step "%s" del workflow "%s"%s.', node ->> 'name', t.name,
               CASE WHEN v_due IS NOT NULL THEN format(' — scadenza %s', fmt_ts(v_due, v_tz)) ELSE '' END),
        format('/compiti?instance=%s', p_instance),
        jsonb_build_object('instance_id', p_instance, 'document_id', i.document_id, 'node_id', p_node));
    END LOOP;

  ELSIF v_type = 'notification' THEN
    INSERT INTO workflow_node_runs (id, instance_id, node_id, node_type, name, round, status, completed_at)
    VALUES (v_run, p_instance, p_node, v_type, node ->> 'name', v_round, 'DONE', now());
    v_msg := coalesce(node ->> 'message', node ->> 'name');
    v_msg := replace(v_msg, '{titolo}', coalesce(i.title, v_label));
    v_msg := replace(v_msg, '{documento}', coalesce((SELECT identifier FROM documents WHERE id = i.document_id), ''));
    v_msg := replace(v_msg, '{progetto}', (SELECT name FROM projects WHERE id = i.project_id));
    FOR v_user IN SELECT * FROM wf_resolve_assignees(i.project_id, v_org,
                                                       jsonb_build_object('assignees', coalesce(node -> 'recipients', '[]'::jsonb))) LOOP
      PERFORM notify(v_user, i.project_id, 'WORKFLOW_NOTIFICATION', format('%s: %s', node ->> 'name', v_label),
                     v_msg, wf_link(p_instance), jsonb_build_object('instance_id', p_instance, 'node_id', p_node));
    END LOOP;
    PERFORM wf_follow(p_instance, p_node, NULL, v_round);

  ELSIF v_type = 'end' THEN
    INSERT INTO workflow_node_runs (id, instance_id, node_id, node_type, name, round, status, completed_at)
    VALUES (v_run, p_instance, p_node, v_type, node ->> 'name', v_round, 'DONE', now());
    PERFORM wf_finish(p_instance, node);

  ELSE   -- start: non ha archi in entrata (validazione), ma per robustezza riparte da sé
    INSERT INTO workflow_node_runs (id, instance_id, node_id, node_type, name, round, status, completed_at)
    VALUES (v_run, p_instance, p_node, v_type, node ->> 'name', v_round, 'DONE', now());
    PERFORM wf_follow(p_instance, p_node, NULL, v_round);
  END IF;
END $$;

-- Un arrivo su p_to dall'arco (p_from, p_outcome). Nodi con un solo arco in entrata e join ANY si attivano
-- subito (ANY: se il nodo è già attivo l'arrivo è ignorato); i join ALL aspettano wf_check_joins.
CREATE FUNCTION cde.wf_arrive(p_instance uuid, p_from text, p_outcome text, p_to text, p_round integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  v_def  jsonb;
  node   jsonb;
  v_in   integer;
  v_edge bigint;
  v_join text;
BEGIN
  SELECT t.definition INTO v_def FROM workflow_instances i JOIN workflow_templates t ON t.id = i.template_id
  WHERE i.id = p_instance;
  node := wf_node(v_def, p_to);
  INSERT INTO workflow_edges_taken (instance_id, from_node, outcome, to_node, round)
  VALUES (p_instance, p_from, p_outcome, p_to, p_round) RETURNING id INTO v_edge;
  SELECT count(DISTINCT x ->> 'from') INTO v_in FROM jsonb_array_elements(v_def -> 'edges') x WHERE x ->> 'to' = p_to;
  -- join predefinito: ALL, tranne per gli stati finali (ANY): uno stato finale raggiunto chiude l'istanza,
  -- non ha senso che aspetti gli altri rami (es. "Fallito" raggiungibile da più autorizzazioni)
  v_join := coalesce(node ->> 'join', CASE WHEN node ->> 'type' = 'end' THEN 'ANY' ELSE 'ALL' END);
  IF v_in <= 1 OR v_join = 'ANY' THEN
    UPDATE workflow_edges_taken SET consumed = true WHERE id = v_edge;
    IF v_join = 'ANY' AND v_in > 1 AND EXISTS (
         SELECT 1 FROM workflow_node_runs WHERE instance_id = p_instance AND node_id = p_to AND status = 'ACTIVE') THEN
      RETURN;   -- join ANY già attivo in questo giro: arrivo ignorato
    END IF;
    PERFORM wf_activate_node(p_instance, p_to);
  END IF;
  -- join ALL: l'arrivo resta in attesa (consumed = false)
END $$;

-- Segue gli archi in uscita da un nodo con l'esito scelto (NULL per start e notification): tutti, in
-- parallelo. Si ferma se un ramo ha già chiuso l'istanza (stato finale raggiunto).
CREATE FUNCTION cde.wf_follow(p_instance uuid, p_node text, p_outcome text, p_round integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  v_def jsonb;
  e     jsonb;
BEGIN
  SELECT t.definition INTO v_def FROM workflow_instances i JOIN workflow_templates t ON t.id = i.template_id
  WHERE i.id = p_instance;
  FOR e IN SELECT x FROM jsonb_array_elements(v_def -> 'edges') WITH ORDINALITY AS a(x, ord)
           WHERE x ->> 'from' = p_node AND (x ->> 'outcome') IS NOT DISTINCT FROM p_outcome ORDER BY ord LOOP
    IF (SELECT status FROM workflow_instances WHERE id = p_instance) <> 'RUNNING' THEN
      RETURN;
    END IF;
    PERFORM wf_arrive(p_instance, p_node, p_outcome, e ->> 'to', p_round);
  END LOOP;
END $$;

-- Join ALL: un nodo con arrivi in attesa si attiva quando nell'istanza non c'è più nessun nodo attivo
-- (né un altro join in attesa) da cui sia raggiungibile senza passare da sé. Si ripete finché qualcosa
-- si attiva, perché l'attivazione di un join può liberarne un altro.
CREATE FUNCTION cde.wf_check_joins(p_instance uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  v_def   jsonb;
  v_ready text;
  v_wait  text[];
  v_iter  integer := 0;
BEGIN
  SELECT t.definition INTO v_def FROM workflow_instances i JOIN workflow_templates t ON t.id = i.template_id
  WHERE i.id = p_instance;
  LOOP
    v_iter := v_iter + 1;
    EXIT WHEN v_iter > 200 OR (SELECT status FROM workflow_instances WHERE id = p_instance) <> 'RUNNING';
    SELECT coalesce(array_agg(DISTINCT to_node), '{}') INTO v_wait
    FROM workflow_edges_taken WHERE instance_id = p_instance AND NOT consumed;
    EXIT WHEN cardinality(v_wait) = 0;
    -- pronto: nessun nodo attivo e nessun altro join in attesa da cui lo si raggiunga
    SELECT w INTO v_ready FROM unnest(v_wait) w
    WHERE NOT EXISTS (SELECT 1 FROM workflow_node_runs r WHERE r.instance_id = p_instance AND r.status = 'ACTIVE'
                        AND r.node_id <> w AND wf_reaches(v_def, r.node_id, w))
      AND NOT EXISTS (SELECT 1 FROM unnest(v_wait) o WHERE o <> w AND wf_reaches(v_def, o, w))
    ORDER BY w LIMIT 1;
    IF v_ready IS NULL THEN
      -- join che si aspettano a vicenda senza nodi attivi in mezzo: si sblocca il primo per non restare fermi
      SELECT w INTO v_ready FROM unnest(v_wait) w
      WHERE NOT EXISTS (SELECT 1 FROM workflow_node_runs r WHERE r.instance_id = p_instance AND r.status = 'ACTIVE'
                          AND r.node_id <> w AND wf_reaches(v_def, r.node_id, w))
      ORDER BY w LIMIT 1;
    END IF;
    EXIT WHEN v_ready IS NULL;
    UPDATE workflow_edges_taken SET consumed = true WHERE instance_id = p_instance AND to_node = v_ready AND NOT consumed;
    PERFORM wf_activate_node(p_instance, v_ready);
  END LOOP;
END $$;

-- Avvio comune a documenti e processi: giro dello start e archi in uscita.
CREATE FUNCTION cde.wf_begin(p_instance uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  v_def   jsonb;
  v_start jsonb;
BEGIN
  SELECT t.definition INTO v_def FROM workflow_instances i JOIN workflow_templates t ON t.id = i.template_id
  WHERE i.id = p_instance;
  SELECT n INTO v_start FROM jsonb_array_elements(v_def -> 'nodes') n WHERE n ->> 'type' = 'start' LIMIT 1;
  IF v_start IS NULL THEN
    RAISE EXCEPTION 'Il modello non ha un nodo di avvio' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO workflow_node_runs (instance_id, node_id, node_type, name, round, status, completed_at)
  VALUES (p_instance, v_start ->> 'id', 'start', v_start ->> 'name', 1, 'DONE', now());
  PERFORM wf_follow(p_instance, v_start ->> 'id', NULL, 1);
  PERFORM wf_check_joins(p_instance);
END $$;

-- Avvio su una revisione di documento (come prima, con on_completed al posto di on_approved).
CREATE OR REPLACE FUNCTION cde.workflow_start(p_template_id uuid, p_revision_id uuid, p_comment text DEFAULT NULL)
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
  IF t.subject <> 'DOCUMENT' THEN
    RAISE EXCEPTION 'Il modello "%" è per processi: si avvia dalla scheda Processi', t.name USING ERRCODE = 'check_violation';
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
  target := t.definition -> 'on_completed';
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
  PERFORM wf_begin(v_id);
  RETURN v_id;
END $$;

-- Avvio di un processo (modello PROCESS): qualunque membro del progetto, con documenti allegati che vede.
CREATE FUNCTION cde.workflow_start_process(p_template_id uuid, p_title text, p_description text DEFAULT NULL,
                                           p_documents uuid[] DEFAULT '{}')
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  t     workflow_templates%ROWTYPE;
  v_id  uuid := gen_random_uuid();
  v_doc uuid;
BEGIN
  SELECT * INTO t FROM workflow_templates WHERE id = p_template_id AND is_active;
  IF NOT FOUND OR t.project_id NOT IN (SELECT my_projects()) THEN
    RAISE EXCEPTION 'Template di workflow non trovato o non attivo' USING ERRCODE = 'no_data_found';
  END IF;
  IF t.subject <> 'PROCESS' THEN
    RAISE EXCEPTION 'Il modello "%" è per documenti: si avvia da una revisione', t.name USING ERRCODE = 'check_violation';
  END IF;
  IF length(btrim(coalesce(p_title, ''))) < 2 THEN
    RAISE EXCEPTION 'Titolo del processo obbligatorio' USING ERRCODE = 'check_violation';
  END IF;
  FOREACH v_doc IN ARRAY coalesce(p_documents, '{}') LOOP
    -- allegabile solo un documento del progetto che chi avvia può vedere (almeno una revisione visibile)
    IF NOT EXISTS (SELECT 1 FROM document_revisions r WHERE r.document_id = v_doc AND r.project_id = t.project_id
                     AND revision_visible_to_me(r)) THEN
      RAISE EXCEPTION 'Documento allegato non trovato' USING ERRCODE = 'no_data_found';
    END IF;
  END LOOP;
  INSERT INTO workflow_instances (id, project_id, template_id, subject, title, description, started_by)
  VALUES (v_id, t.project_id, t.id, 'PROCESS', btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''),
          current_app_user());
  INSERT INTO workflow_instance_documents (instance_id, document_id)
  SELECT DISTINCT v_id, d FROM unnest(coalesce(p_documents, '{}')) d;
  PERFORM wf_begin(v_id);
  RETURN v_id;
END $$;

-- Completamento di un compito con un esito libero del nodo.
-- Esito rosso: decide subito (come il "Rifiutato" di prima). Altrimenti decide quando quell'esito raggiunge il
-- quorum; se tutti hanno votato senza quorum vince il più votato (a parità, il primo nell'elenco).
CREATE FUNCTION cde.workflow_complete_task(p_task_id uuid, p_outcome text, p_comment text DEFAULT NULL)
RETURNS cde.workflow_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  k      tasks%ROWTYPE;
  i      workflow_instances%ROWTYPE;
  s      workflow_node_runs%ROWTYPE;
  v_def  jsonb;
  node   jsonb;
  outc   jsonb;
  v_red  boolean;
  v_dec  text;
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
  SELECT * INTO s FROM workflow_node_runs WHERE id = k.node_run_id FOR UPDATE;
  IF s.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Compito già chiuso' USING ERRCODE = 'check_violation';
  END IF;
  SELECT definition INTO v_def FROM workflow_templates WHERE id = i.template_id;
  node := wf_node(v_def, s.node_id);
  SELECT o INTO outc FROM jsonb_array_elements(wf_outcomes(node)) o WHERE o ->> 'code' = p_outcome;
  IF outc IS NULL THEN
    RAISE EXCEPTION 'Esito "%" non previsto per "%"', p_outcome, s.name USING ERRCODE = 'check_violation';
  END IF;
  v_red := outc ->> 'color' = 'red';
  IF (v_red OR p_outcome = 'APPROVED_WITH_COMMENTS') AND coalesce(btrim(p_comment), '') = '' THEN
    RAISE EXCEPTION 'Commento obbligatorio per questo esito' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE tasks SET status = 'DONE', outcome = p_outcome, comment = p_comment, completed_at = now() WHERE id = k.id;

  IF v_red OR (SELECT count(*) FROM tasks WHERE node_run_id = s.id AND status = 'DONE' AND outcome = p_outcome) >= s.required THEN
    v_dec := p_outcome;
  ELSIF NOT EXISTS (SELECT 1 FROM tasks WHERE node_run_id = s.id AND status = 'OPEN') THEN
    SELECT o ->> 'code' INTO v_dec
    FROM jsonb_array_elements(wf_outcomes(node)) WITH ORDINALITY AS a(o, ord)
    LEFT JOIN (SELECT outcome, count(*) AS c FROM tasks WHERE node_run_id = s.id AND status = 'DONE' GROUP BY outcome) v
      ON v.outcome = a.o ->> 'code'
    ORDER BY coalesce(v.c, 0) DESC, a.ord LIMIT 1;
  ELSE
    RETURN 'RUNNING';
  END IF;

  UPDATE workflow_node_runs SET status = 'DONE', outcome = v_dec, completed_at = now() WHERE id = s.id;
  UPDATE tasks SET status = 'CANCELLED' WHERE node_run_id = s.id AND status = 'OPEN';   -- deciso: gli altri voti non servono
  IF v_red THEN
    UPDATE workflow_instances SET outcome_comment = p_comment WHERE id = i.id;          -- motivo per chi riceve il KO
  END IF;
  PERFORM wf_follow(i.id, s.node_id, v_dec, s.round);
  PERFORM wf_check_joins(i.id);
  RETURN (SELECT status FROM workflow_instances WHERE id = i.id);
END $$;

-- Annullamento: chi ha avviato, l'amministratore del container (documenti) o il Project Admin (processi).
CREATE OR REPLACE FUNCTION cde.workflow_cancel(p_instance uuid, p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  i workflow_instances%ROWTYPE;
  d documents%ROWTYPE;
BEGIN
  SELECT * INTO i FROM workflow_instances WHERE id = p_instance FOR UPDATE;
  IF NOT FOUND OR i.status <> 'RUNNING' THEN
    RAISE EXCEPTION 'Workflow non attivo' USING ERRCODE = 'no_data_found';
  END IF;
  IF i.document_id IS NOT NULL THEN
    SELECT * INTO d FROM documents WHERE id = i.document_id;
    IF NOT (i.started_by = current_app_user() OR has_permission(current_app_user(), d.container_id, 'ADMIN')) THEN
      RAISE EXCEPTION 'Solo chi ha avviato il workflow o un amministratore può annullarlo' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF NOT (i.started_by = current_app_user()
             OR has_project_permission(current_app_user(), i.project_id, 'ADMIN', 'PROJECT')) THEN
    RAISE EXCEPTION 'Solo chi ha avviato il processo o un Project Admin può annullarlo' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF coalesce(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'Motivazione obbligatoria' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE tasks SET status = 'CANCELLED' WHERE instance_id = i.id AND status = 'OPEN';
  UPDATE workflow_node_runs SET status = 'CANCELLED', completed_at = now() WHERE instance_id = i.id AND status = 'ACTIVE';
  UPDATE workflow_edges_taken SET consumed = true WHERE instance_id = i.id AND NOT consumed;
  UPDATE workflow_instances SET status = 'CANCELLED', finished_at = now(), outcome_comment = p_reason WHERE id = i.id;
END $$;

-- Scadenze, promemoria ed escalation (0036/0038) sui compiti dei nodi: stessa logica, documento facoltativo
-- (per i processi vale il titolo) e nome del nodo al posto del passo.
CREATE OR REPLACE FUNCTION cde.process_deadlines(p_now timestamptz DEFAULT now(), p_repeat_hours integer DEFAULT 72)
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
BEGIN
  FOR k IN
    SELECT t.*, coalesce(d.identifier, i.title) AS identifier, i.started_by, tpl.definition, i.project_id AS pid,
           u.first_name || ' ' || u.last_name AS assignee_name, s.name AS node_name
    FROM tasks t JOIN workflow_instances i ON i.id = t.instance_id
    LEFT JOIN documents d ON d.id = i.document_id JOIN workflow_templates tpl ON tpl.id = i.template_id
    JOIN users u ON u.id = t.assignee_id JOIN workflow_node_runs s ON s.id = t.node_run_id
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
        -- Destinatari dell'escalation: la persona del template se ancora membro (0038, B1), altrimenti i
        -- Project Admin del progetto più chi ha avviato il workflow. Mai l'incaricato.
        v_esc := (k.definition ->> 'escalation_user_id')::uuid;
        IF v_esc IS NOT NULL AND NOT EXISTS (SELECT 1 FROM project_memberships m WHERE m.project_id = k.pid
                                               AND m.user_id = v_esc AND (m.expires_at IS NULL OR m.expires_at > p_now)) THEN
          v_esc := NULL;
        END IF;
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
                          k.assignee_name, k.node_name, k.identifier, v_giorni,
                          CASE WHEN v_giorni = 1 THEN 'o' ELSE 'i' END, k.escalation_count + 1);
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

-- Cruscotto del Project Admin (0012): tempi e colli di bottiglia sui giri dei nodi con compiti
-- (decisioni e attività) invece che sui passi; i processi senza documento restano fuori dai KPI documentali.
CREATE OR REPLACE FUNCTION cde.project_dashboard(p_project uuid, p_org uuid DEFAULT NULL, p_discipline text DEFAULT NULL)
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
    JOIN workflow_node_runs s ON s.id = t.node_run_id
    JOIN users u ON u.id = t.assignee_id
    WHERE t.project_id = p_project AND t.status = 'OPEN' AND i.document_id IN (SELECT id FROM docs)
  ),
  steps_done AS (
    SELECT s.name, extract(epoch FROM s.completed_at - s.activated_at) / 3600.0 AS hours
    FROM workflow_node_runs s JOIN workflow_instances i ON i.id = s.instance_id
    WHERE i.project_id = p_project AND s.completed_at IS NOT NULL AND s.node_type IN ('decision', 'activity') AND s.completed_at > now() - interval '180 days'
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

-- =====================================================================
-- 6. RLS e privilegi
-- =====================================================================
-- Processi: li vede ogni membro del progetto (i documenti allegati restano filtrati dalla loro RLS).
DROP POLICY wf_instances_select ON cde.workflow_instances;
CREATE POLICY wf_instances_select ON cde.workflow_instances FOR SELECT TO cde_app USING (
  document_id IN (SELECT id FROM cde.documents)
  OR (subject = 'PROCESS' AND project_id IN (SELECT cde.my_projects()))
  OR id IN (SELECT cde.my_task_instances())
);

ALTER TABLE cde.workflow_node_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE cde.workflow_edges_taken ENABLE ROW LEVEL SECURITY;
ALTER TABLE cde.workflow_instance_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY wf_node_runs_select ON cde.workflow_node_runs FOR SELECT TO cde_app
  USING (instance_id IN (SELECT id FROM cde.workflow_instances));
CREATE POLICY wf_edges_select ON cde.workflow_edges_taken FOR SELECT TO cde_app
  USING (instance_id IN (SELECT id FROM cde.workflow_instances));
CREATE POLICY wf_instance_docs_select ON cde.workflow_instance_documents FOR SELECT TO cde_app
  USING (instance_id IN (SELECT id FROM cde.workflow_instances) AND document_id IN (SELECT id FROM cde.documents));

REVOKE ALL ON cde.workflow_node_runs, cde.workflow_edges_taken, cde.workflow_instance_documents FROM PUBLIC;
GRANT SELECT ON cde.workflow_node_runs, cde.workflow_edges_taken, cde.workflow_instance_documents TO cde_app;

REVOKE ALL ON FUNCTION cde.wf_convert_v1(jsonb), cde.wf_originator(uuid), cde.wf_label(uuid), cde.wf_link(uuid),
                       cde.wf_abort(uuid, text), cde.wf_finish(uuid, jsonb), cde.wf_activate_node(uuid, text),
                       cde.wf_arrive(uuid, text, text, text, integer), cde.wf_follow(uuid, text, text, integer),
                       cde.wf_check_joins(uuid), cde.wf_begin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cde.workflow_complete_task(uuid, text, text),
                          cde.workflow_start_process(uuid, text, text, uuid[]) TO cde_app;
