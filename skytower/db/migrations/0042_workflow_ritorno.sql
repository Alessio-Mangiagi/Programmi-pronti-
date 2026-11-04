-- "><(((º> sabusabu <º)))><"
-- depends: 0040_sicurezza_bassi 0041_workflow_libreria
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0042: tornare indietro da ogni nodo (ADR-51, docs/workflow-grafo.md §6)
--
-- Richiesta dell'utente del 04/11/2026: "in tutti i nodi deve essere possibile tornare indietro per richiedere
-- chiarimenti o modifiche ai file". Chi ha in carico il compito di una decisione o di un'attività sceglie dove
-- rimandare fra i nodi GIÀ FATTI del suo ramo (risalendo gli archi percorsi; di norma il nodo subito prima)
-- oppure "chi ha avviato", e fa una di due cose, sempre con un commento:
--
--   * CHIEDI CHIARIMENTO: chi è interpellato riceve un compito di tipo chiarimento (kind = 'CLARIFICATION') con la
--     domanda e risponde con un commento; nulla si rifà, il flusso non si sposta. Intanto il compito di chi ha
--     chiesto è "in attesa di chiarimento" (waiting_send_back_id): non si completa e non scade (scadenze ed
--     escalation sospese; alla risposta la scadenza si sposta avanti del tempo passato in attesa).
--   * RICHIEDI MODIFICHE: il nodo scelto si riapre in un nuovo giro (stessi assegnatari); il giro di chi chiede e
--     i giri ancora aperti dello stesso ramo fra i due si annullano ("rimandato indietro"). Chi riceve modifica i
--     file (nuova revisione del documento, o allegati del processo) e completa scegliendo di nuovo un esito; da lì
--     il flusso riprende seguendo gli archi e rifà i nodi intermedi fino a tornare al nodo che ha chiesto.
--
-- Regole fissate qui (contratto §6):
--   * BIFORCAZIONI: un giro riaperto (o rifatto per una richiesta di modifiche, workflow_node_runs.send_back_id)
--     quando si completa percorre SOLO gli archi dell'esito scelto che portano verso il nodo che ha chiesto
--     (l'arco arriva lì o da lì lo si raggiunge); se nessun arco dell'esito ci porta (es. ora "Respinto") segue
--     tutti gli archi di quell'esito come sempre. Così riaprire "Scelta procedura" non riattiva gli altri 6 buyer.
--   * JOIN ALL: un giro "diretto" verso il nodo che ha chiesto conta, per la regola di raggiungibilità, solo verso
--     i nodi sul cammino fino a quel nodo e quelli dopo; la riunione QdR aspetta il ramo tornato indietro, i join
--     interni agli altri rami no.
--   * GIRI: le riaperture usano il motore di sempre: contano nei 20 giri per nodo; oltre, l'istanza si interrompe.
--   * CHI HA AVVIATO: per un chiarimento risponde lui; per le modifiche si riapre il nodo di avvio con un compito
--     per lui ("Modifiche fatte"), poi si riparte dall'avvio verso il ramo che ha chiesto.
--   * REVISIONI: durante una richiesta di modifiche su un workflow per documenti chi ha il compito riaperto può
--     caricare una nuova revisione (il blocco del documento lo permette solo a lui); quando completa, il workflow
--     passa sulla revisione nuova: se quella di partenza era condivisa (SHARED) la nuova WIP viene condivisa con
--     la stessa idoneità, l'istanza punta a lei (il blocco resta sul documento), la vecchia resta nello storico e
--     il passaggio fra le due resta scritto nella richiesta (revision_from_id → revision_to_id).
--   * PROCESSI: chi ha il compito riaperto sostituisce o aggiunge gli allegati (workflow_set_documents).
--
-- Cosa cambia:
--   1. tabella workflow_send_backs (richieste di chiarimento e di modifiche, con risposta e revisioni/allegati);
--   2. tasks: tipo (WORKFLOW | CLARIFICATION), attesa di chiarimento, motivo dell'annullamento;
--      workflow_node_runs.send_back_id (giro riaperto o rifatto per una richiesta di modifiche);
--   3. motore: nodi già fatti del ramo (wf_upstream), chiarimento e risposta, richiesta di modifiche, completamento
--      (riscritto: tipo di compito, attesa, giri diretti, revisione nuova), join con i giri diretti, scadenze sospese;
--   4. blocco del documento: nuova revisione permessa a chi ha un compito riaperto;
--   5. RLS e privilegi.
-- =====================================================================

-- =====================================================================
-- 1. Richieste di chiarimento e di modifiche
-- =====================================================================
CREATE TABLE cde.workflow_send_backs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id          uuid        NOT NULL REFERENCES cde.workflow_instances (id),
  kind                 text        NOT NULL CHECK (kind IN ('CLARIFICATION', 'CHANGES')),
  from_run_id          uuid        NOT NULL REFERENCES cde.workflow_node_runs (id),  -- giro del nodo che chiede
  from_task_id         uuid        NOT NULL REFERENCES cde.tasks (id),               -- compito di chi chiede
  from_node            text        NOT NULL,
  target_node          text        NOT NULL,          -- nodo a cui si rimanda (per "chi ha avviato": il nodo di avvio)
  target_originator    boolean     NOT NULL DEFAULT false,
  target_run_id        uuid        REFERENCES cde.workflow_node_runs (id),           -- giro già fatto a cui si rimanda
  reopened_run_id      uuid        REFERENCES cde.workflow_node_runs (id),           -- CHANGES: il giro nuovo
  comment              text        NOT NULL CHECK (length(btrim(comment)) BETWEEN 1 AND 4000),
  asked_by             uuid        NOT NULL REFERENCES cde.users (id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  -- CLARIFICATION: la risposta (la prima che arriva chiude la richiesta)
  answer               text        CHECK (answer IS NULL OR length(btrim(answer)) BETWEEN 1 AND 4000),
  answered_by          uuid        REFERENCES cde.users (id),
  answered_at          timestamptz,
  -- CHANGES su un documento: revisione su cui era il workflow e revisione su cui prosegue
  revision_from_id     uuid        REFERENCES cde.document_revisions (id),
  revision_to_id       uuid        REFERENCES cde.document_revisions (id),
  -- codici scritti qui: chi esamina può non vedere la WIP o la revisione di partenza, la vista li mostra comunque
  revision_from_code   text,
  revision_to_code     text,
  -- CHANGES su un processo: allegati prima e dopo la modifica
  documents_before     uuid[],
  documents_after      uuid[],
  documents_changed_by uuid        REFERENCES cde.users (id),
  documents_changed_at timestamptz
);
CREATE INDEX ix_wf_send_backs_instance ON cde.workflow_send_backs (instance_id, created_at);

-- =====================================================================
-- 2. Compiti e giri
-- =====================================================================
ALTER TABLE cde.tasks
  ADD COLUMN kind text NOT NULL DEFAULT 'WORKFLOW' CHECK (kind IN ('WORKFLOW', 'CLARIFICATION')),
  ADD COLUMN send_back_id uuid REFERENCES cde.workflow_send_backs (id),           -- CLARIFICATION: la richiesta
  ADD COLUMN waiting_send_back_id uuid REFERENCES cde.workflow_send_backs (id),   -- WORKFLOW in attesa di chiarimento
  ADD COLUMN hold_since timestamptz,                                              -- da quando è in attesa
  ADD COLUMN cancel_reason text;                                                  -- perché è stato annullato
ALTER TABLE cde.tasks ADD CONSTRAINT tasks_clarification_shape CHECK (
  (kind = 'CLARIFICATION') = (send_back_id IS NOT NULL) AND (kind = 'WORKFLOW' OR waiting_send_back_id IS NULL));
-- Un compito di chiarimento sta sul giro di chi chiede (stesso node_run_id): la persona interpellata può avere già
-- un compito su quel giro o riceverne più d'uno, quindi l'unicità per giro vale solo per i compiti del workflow.
ALTER TABLE cde.tasks DROP CONSTRAINT tasks_node_run_assignee_key;
CREATE UNIQUE INDEX ux_tasks_node_run_assignee ON cde.tasks (node_run_id, assignee_id) WHERE kind = 'WORKFLOW';
CREATE UNIQUE INDEX ux_tasks_clarification_assignee ON cde.tasks (send_back_id, assignee_id) WHERE kind = 'CLARIFICATION';

-- Giro riaperto da una richiesta di modifiche, o rifatto mentre il flusso torna verso chi ha chiesto: completandolo
-- si seguono solo gli archi verso quel nodo (regola delle biforcazioni).
ALTER TABLE cde.workflow_node_runs ADD COLUMN send_back_id uuid REFERENCES cde.workflow_send_backs (id);

-- =====================================================================
-- 3. Motore
-- =====================================================================
-- Nodi già fatti risalendo il ramo da un giro: si segue all'indietro l'arco percorso che ha attivato ogni giro
-- (arrivi fra l'attivazione precedente dello stesso nodo e questa) e, per un giro riaperto da una richiesta di
-- modifiche, il giro già fatto da cui si è ripartiti. Per ogni nodo il giro più vicino (depth = passi indietro).
CREATE FUNCTION cde.wf_upstream(p_run uuid)
RETURNS TABLE (up_node text, up_run uuid, up_depth integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  WITH RECURSIVE
  runs AS (SELECT r.* FROM workflow_node_runs r
           WHERE r.instance_id = (SELECT instance_id FROM workflow_node_runs WHERE id = p_run)),
  links AS (
    SELECT c.id AS child, p.id AS parent
    FROM runs c
    JOIN workflow_edges_taken e ON e.instance_id = c.instance_id AND e.to_node = c.node_id
         AND e.taken_at <= c.activated_at
         AND e.taken_at > coalesce((SELECT max(x.activated_at) FROM runs x
                                    WHERE x.node_id = c.node_id AND x.activated_at < c.activated_at), '-infinity')
    JOIN runs p ON p.node_id = e.from_node AND p.round = e.round
    UNION
    SELECT b.reopened_run_id, b.target_run_id FROM workflow_send_backs b
    WHERE b.instance_id = (SELECT instance_id FROM workflow_node_runs WHERE id = p_run)
      AND b.reopened_run_id IS NOT NULL AND b.target_run_id IS NOT NULL),
  up(run_id, depth, path) AS (
    SELECT p_run, 0, ARRAY[p_run]
    UNION ALL
    SELECT l.parent, up.depth + 1, up.path || l.parent
    FROM up JOIN links l ON l.child = up.run_id
    WHERE NOT l.parent = ANY (up.path) AND up.depth < 200)
  SELECT DISTINCT ON (r.node_id) r.node_id, r.id, up.depth
  FROM up JOIN runs r ON r.id = up.run_id
  WHERE up.depth > 0
  ORDER BY r.node_id, up.depth, r.round DESC
$$;

-- Destinazione di un ritorno da un giro: un nodo già fatto del ramo (decisione o attività) oppure 'ORIGINATOR'
-- (chi ha avviato: il nodo di avvio). Errore se il nodo non è fra quelli già fatti del ramo.
CREATE FUNCTION cde.wf_send_back_target(p_run uuid, p_target text,
                                        OUT t_node text, OUT t_run uuid, OUT t_originator boolean, OUT t_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
BEGIN
  IF p_target = 'ORIGINATOR' THEN
    t_originator := true;
    t_name := 'Chi ha avviato';
    SELECT u.up_node, u.up_run INTO t_node, t_run
    FROM wf_upstream(p_run) u JOIN workflow_node_runs r ON r.id = u.up_run
    WHERE r.node_type = 'start' ORDER BY u.up_depth LIMIT 1;
    IF t_node IS NULL THEN
      SELECT r.node_id, r.id INTO t_node, t_run FROM workflow_node_runs r
      WHERE r.instance_id = (SELECT instance_id FROM workflow_node_runs WHERE id = p_run) AND r.node_type = 'start'
      ORDER BY r.round DESC LIMIT 1;
    END IF;
    RETURN;
  END IF;
  t_originator := false;
  SELECT u.up_node, u.up_run, r.name INTO t_node, t_run, t_name
  FROM wf_upstream(p_run) u JOIN workflow_node_runs r ON r.id = u.up_run
  WHERE u.up_node = p_target AND r.node_type IN ('decision', 'activity') AND r.status = 'DONE';
  IF t_node IS NULL THEN
    RAISE EXCEPTION 'Si può tornare solo a un passo già fatto su questo ramo' USING ERRCODE = 'check_violation';
  END IF;
END $$;

-- Persone interpellate: chi ha avviato, oppure chi ha deciso nel giro già fatto (se nessuno ha votato, tutti gli
-- assegnatari di quel giro). Solo utenti attivi.
CREATE FUNCTION cde.wf_send_back_people(p_instance uuid, p_run uuid, p_originator boolean) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT x.uid FROM (
    SELECT i.started_by AS uid FROM workflow_instances i WHERE p_originator AND i.id = p_instance
    UNION
    SELECT k.assignee_id FROM tasks k
    WHERE NOT p_originator AND k.node_run_id = p_run AND k.kind = 'WORKFLOW'
      AND (k.status = 'DONE' OR NOT EXISTS (SELECT 1 FROM tasks d WHERE d.node_run_id = p_run AND d.kind = 'WORKFLOW'
                                                                     AND d.status = 'DONE'))) x
  JOIN users u ON u.id = x.uid AND u.status = 'ACTIVE'
$$;

-- Dove si può tornare dal proprio compito (per il dialogo): i nodi già fatti del ramo, il più vicino per primo, poi
-- "Chi ha avviato". `active` = il nodo ha già un giro in corso (non si riapre, si può solo chiedere un chiarimento).
CREATE FUNCTION cde.workflow_send_back_targets(p_task uuid)
RETURNS TABLE (target text, node_id text, name text, node_type text, depth integer, people text, active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  WITH k AS (SELECT t.id, t.instance_id, t.node_run_id, s.node_id AS from_node
             FROM tasks t JOIN workflow_node_runs s ON s.id = t.node_run_id
             WHERE t.id = p_task AND t.assignee_id = current_app_user() AND t.kind = 'WORKFLOW'
               AND s.node_type IN ('decision', 'activity'))
  SELECT x.* FROM (
    SELECT u.up_node, u.up_node, r.name, r.node_type, u.up_depth,
           (SELECT string_agg(DISTINCT us.first_name || ' ' || us.last_name, ', ')
            FROM wf_send_back_people(k.instance_id, r.id, false) p(uid) JOIN users us ON us.id = p.uid),
           EXISTS (SELECT 1 FROM workflow_node_runs a WHERE a.instance_id = k.instance_id AND a.node_id = u.up_node
                                                        AND a.status = 'ACTIVE')
    FROM k CROSS JOIN LATERAL wf_upstream(k.node_run_id) u JOIN workflow_node_runs r ON r.id = u.up_run
    WHERE r.node_type IN ('decision', 'activity') AND r.status = 'DONE' AND u.up_node <> k.from_node
    UNION ALL
    SELECT 'ORIGINATOR', NULL, 'Chi ha avviato', 'start', 100000, us.first_name || ' ' || us.last_name, false
    FROM k JOIN workflow_instances i ON i.id = k.instance_id JOIN users us ON us.id = i.started_by) x
  ORDER BY 5, 3
$$;

-- Compito da cui si torna indietro: proprio, aperto, di una decisione o un'attività attiva, non già in attesa.
-- Blocca l'istanza (come il completamento) per serializzare i rami paralleli.
CREATE FUNCTION cde.wf_sender_task(p_task uuid) RETURNS cde.tasks
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  k tasks%ROWTYPE;
  i workflow_instances%ROWTYPE;
  s workflow_node_runs%ROWTYPE;
BEGIN
  SELECT * INTO k FROM tasks WHERE id = p_task AND assignee_id = current_app_user();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Compito non trovato' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO i FROM workflow_instances WHERE id = k.instance_id FOR UPDATE;
  SELECT * INTO k FROM tasks WHERE id = p_task FOR UPDATE;
  SELECT * INTO s FROM workflow_node_runs WHERE id = k.node_run_id FOR UPDATE;
  IF k.status <> 'OPEN' OR i.status <> 'RUNNING' OR s.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Compito già chiuso' USING ERRCODE = 'check_violation';
  END IF;
  IF k.kind <> 'WORKFLOW' OR s.node_type NOT IN ('decision', 'activity') THEN
    RAISE EXCEPTION 'Da questo compito non si torna indietro' USING ERRCODE = 'check_violation';
  END IF;
  IF k.waiting_send_back_id IS NOT NULL THEN
    RAISE EXCEPTION 'Compito in attesa di chiarimento: si prosegue quando arriva la risposta' USING ERRCODE = 'check_violation';
  END IF;
  RETURN k;
END $$;

-- Nome e cognome dell'utente corrente (per i messaggi).
CREATE FUNCTION cde.wf_my_name() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT first_name || ' ' || last_name FROM users WHERE id = current_app_user()
$$;

-- CHIEDI CHIARIMENTO: compito di chiarimento alle persone interpellate, il proprio compito in attesa.
CREATE FUNCTION cde.workflow_request_clarification(p_task uuid, p_target text, p_comment text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  k      tasks%ROWTYPE;
  s      workflow_node_runs%ROWTYPE;
  i      workflow_instances%ROWTYPE;
  tg     record;
  v_sb   uuid := gen_random_uuid();
  v_user uuid;
  v_task uuid;
  v_n    integer := 0;
BEGIN
  k := wf_sender_task(p_task);
  SELECT * INTO s FROM workflow_node_runs WHERE id = k.node_run_id;
  SELECT * INTO i FROM workflow_instances WHERE id = k.instance_id;
  IF coalesce(btrim(p_comment), '') = '' THEN
    RAISE EXCEPTION 'Scrivi la domanda: il commento è obbligatorio' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO tg FROM wf_send_back_target(s.id, p_target);
  INSERT INTO workflow_send_backs (id, instance_id, kind, from_run_id, from_task_id, from_node, target_node,
                                   target_originator, target_run_id, comment, asked_by)
  VALUES (v_sb, i.id, 'CLARIFICATION', s.id, k.id, s.node_id, tg.t_node, tg.t_originator, tg.t_run,
          btrim(p_comment), current_app_user());
  FOR v_user IN SELECT * FROM wf_send_back_people(i.id, tg.t_run, tg.t_originator) LOOP
    CONTINUE WHEN v_user = current_app_user();
    v_task := gen_random_uuid();
    INSERT INTO tasks (id, project_id, instance_id, node_run_id, assignee_id, kind, send_back_id)
    VALUES (v_task, i.project_id, i.id, s.id, v_user, 'CLARIFICATION', v_sb);
    PERFORM notify(v_user, i.project_id, 'WORKFLOW_CLARIFICATION_REQUESTED',
                   format('Chiarimento richiesto: %s', wf_label(i.id)),
                   format('%s (passo "%s") chiede: %s', wf_my_name(), s.name, btrim(p_comment)),
                   format('/compiti?instance=%s&task=%s', i.id, v_task),
                   jsonb_build_object('instance_id', i.id, 'send_back_id', v_sb, 'task_id', v_task, 'node_id', s.node_id));
    v_n := v_n + 1;
  END LOOP;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'Nessun altro a cui chiedere per «%»: hai svolto tu quel passo', tg.t_name USING ERRCODE = 'check_violation';
  END IF;
  UPDATE tasks SET waiting_send_back_id = v_sb, hold_since = now() WHERE id = k.id;
  RETURN v_sb;
END $$;

-- Risposta a un chiarimento: chiude la richiesta (gli altri interpellati non devono più rispondere), il compito di chi
-- ha chiesto torna attivo con la scadenza spostata avanti del tempo passato in attesa, chi ha chiesto è avvisato.
CREATE FUNCTION cde.workflow_answer_clarification(p_task uuid, p_answer text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  k  tasks%ROWTYPE;
  i  workflow_instances%ROWTYPE;
  b  workflow_send_backs%ROWTYPE;
  v_from text;
BEGIN
  SELECT * INTO k FROM tasks WHERE id = p_task AND assignee_id = current_app_user();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Compito non trovato' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO i FROM workflow_instances WHERE id = k.instance_id FOR UPDATE;
  SELECT * INTO k FROM tasks WHERE id = p_task FOR UPDATE;
  IF k.kind <> 'CLARIFICATION' THEN
    RAISE EXCEPTION 'Questo compito non è una richiesta di chiarimento' USING ERRCODE = 'check_violation';
  END IF;
  IF k.status <> 'OPEN' OR i.status <> 'RUNNING' THEN
    RAISE EXCEPTION 'Richiesta di chiarimento già chiusa' USING ERRCODE = 'check_violation';
  END IF;
  IF coalesce(btrim(p_answer), '') = '' THEN
    RAISE EXCEPTION 'Scrivi la risposta: il commento è obbligatorio' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE tasks SET status = 'DONE', outcome = 'RISPOSTA', comment = btrim(p_answer), completed_at = now() WHERE id = k.id;
  UPDATE tasks SET status = 'CANCELLED', cancel_reason = format('Ha già risposto %s', wf_my_name())
  WHERE send_back_id = k.send_back_id AND kind = 'CLARIFICATION' AND status = 'OPEN';
  UPDATE workflow_send_backs SET answer = btrim(p_answer), answered_by = current_app_user(), answered_at = now()
  WHERE id = k.send_back_id RETURNING * INTO b;
  -- il compito di chi ha chiesto riparte: la scadenza scorre avanti del tempo passato in attesa (SLA sospeso)
  UPDATE tasks SET waiting_send_back_id = NULL, due_at = due_at + (now() - coalesce(hold_since, now())), hold_since = NULL
  WHERE waiting_send_back_id = b.id AND status = 'OPEN';
  SELECT name INTO v_from FROM workflow_node_runs WHERE id = b.from_run_id;
  PERFORM notify(b.asked_by, i.project_id, 'WORKFLOW_CLARIFICATION_ANSWERED',
                 format('Chiarimento ricevuto: %s', wf_label(i.id)),
                 format('%s ha risposto sul passo "%s": %s', wf_my_name(), v_from, btrim(p_answer)),
                 format('/compiti?instance=%s&task=%s', i.id, b.from_task_id),
                 jsonb_build_object('instance_id', i.id, 'send_back_id', b.id, 'task_id', b.from_task_id));
  RETURN b.id;
END $$;

-- p_to è raggiungibile da un giro attivo? Per un giro "diretto" verso p_toward (richiesta di modifiche) contano
-- solo i nodi sul cammino fino a p_toward, p_toward stesso e quelli dopo; per gli altri giri la regola di sempre.
CREATE FUNCTION cde.wf_reaches_toward(p_def jsonb, p_from text, p_toward text, p_to text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = cde, pg_temp AS $$
  SELECT CASE WHEN p_toward IS NULL THEN wf_reaches(p_def, p_from, p_to)
              ELSE p_to = p_toward OR wf_reaches(p_def, p_toward, p_to)
                   OR (wf_reaches(p_def, p_from, p_to) AND wf_reaches(p_def, p_to, p_toward)) END
$$;

-- Come wf_follow, ma solo verso p_toward: gli archi dell'esito che ci arrivano o da cui lo si raggiunge. Se
-- nessun arco dell'esito porta lì (es. ora "Respinto"), si seguono tutti come sempre.
CREATE FUNCTION cde.wf_follow_toward(p_instance uuid, p_node text, p_outcome text, p_round integer, p_toward text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  v_def jsonb;
  e     jsonb;
BEGIN
  SELECT t.definition INTO v_def FROM workflow_instances i JOIN workflow_templates t ON t.id = i.template_id
  WHERE i.id = p_instance;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_def -> 'edges') x
                 WHERE x ->> 'from' = p_node AND (x ->> 'outcome') IS NOT DISTINCT FROM p_outcome
                   AND (x ->> 'to' = p_toward OR wf_reaches(v_def, x ->> 'to', p_toward))) THEN
    PERFORM wf_follow(p_instance, p_node, p_outcome, p_round);
    RETURN;
  END IF;
  FOR e IN SELECT x FROM jsonb_array_elements(v_def -> 'edges') WITH ORDINALITY AS a(x, ord)
           WHERE x ->> 'from' = p_node AND (x ->> 'outcome') IS NOT DISTINCT FROM p_outcome
             AND (x ->> 'to' = p_toward OR wf_reaches(v_def, x ->> 'to', p_toward))
           ORDER BY ord LOOP
    IF (SELECT status FROM workflow_instances WHERE id = p_instance) <> 'RUNNING' THEN
      RETURN;
    END IF;
    PERFORM wf_arrive(p_instance, p_node, p_outcome, e ->> 'to', p_round);
  END LOOP;
END $$;

-- RICHIEDI MODIFICHE: annulla il giro di chi chiede e i giri aperti dello stesso ramo fino al nodo scelto, riapre
-- quel nodo in un nuovo giro (o il nodo di avvio con un compito per chi ha avviato) diretto verso chi ha chiesto.
CREATE FUNCTION cde.workflow_request_changes(p_task uuid, p_target text, p_comment text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  k        tasks%ROWTYPE;
  s        workflow_node_runs%ROWTYPE;
  i        workflow_instances%ROWTYPE;
  v_def    jsonb;
  tg       record;
  r        record;
  v_sb     uuid := gen_random_uuid();
  v_run    uuid;
  v_round  integer;
  v_reason text;
  v_title  text;
  v_body   text;
BEGIN
  k := wf_sender_task(p_task);
  SELECT * INTO s FROM workflow_node_runs WHERE id = k.node_run_id;
  SELECT * INTO i FROM workflow_instances WHERE id = k.instance_id;
  SELECT definition INTO v_def FROM workflow_templates WHERE id = i.template_id;
  IF coalesce(btrim(p_comment), '') = '' THEN
    RAISE EXCEPTION 'Scrivi cosa va modificato: il commento è obbligatorio' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO tg FROM wf_send_back_target(s.id, p_target);
  IF NOT tg.t_originator AND EXISTS (SELECT 1 FROM workflow_node_runs WHERE instance_id = i.id AND node_id = tg.t_node
                                                                       AND status = 'ACTIVE') THEN
    RAISE EXCEPTION '«%» è già in corso: si può solo chiedere un chiarimento', tg.t_name USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO workflow_send_backs (id, instance_id, kind, from_run_id, from_task_id, from_node, target_node,
                                   target_originator, target_run_id, comment, asked_by)
  VALUES (v_sb, i.id, 'CHANGES', s.id, k.id, s.node_id, tg.t_node, tg.t_originator, tg.t_run, btrim(p_comment),
          current_app_user());

  -- Annullamento del ramo: il giro di chi chiede e i giri attivi fra il nodo riaperto e lui (raggiungibili dal nodo
  -- riaperto, da cui si arriva a chi chiede, che non stanno dopo di lui). Gli altri rami continuano.
  v_reason := format('Rimandato indietro a «%s» da %s', CASE WHEN tg.t_originator THEN 'chi ha avviato' ELSE tg.t_name END,
                     wf_my_name());
  FOR r IN SELECT x.id FROM workflow_node_runs x
           WHERE x.instance_id = i.id AND x.status = 'ACTIVE'
             AND (x.id = s.id OR (x.node_id <> tg.t_node AND x.node_id <> s.node_id
                                  AND (tg.t_originator OR wf_reaches(v_def, tg.t_node, x.node_id))
                                  AND wf_reaches(v_def, x.node_id, s.node_id)
                                  AND NOT wf_reaches(v_def, s.node_id, x.node_id))) LOOP
    UPDATE tasks SET status = 'CANCELLED', cancel_reason = v_reason WHERE node_run_id = r.id AND status = 'OPEN';
    UPDATE workflow_node_runs SET status = 'CANCELLED', completed_at = now() WHERE id = r.id;
  END LOOP;

  v_title := format('Modifiche richieste: %s', wf_label(i.id));
  v_body := format('%s (passo "%s") rimanda a "%s": %s', wf_my_name(), s.name,
                   CASE WHEN tg.t_originator THEN 'chi ha avviato' ELSE tg.t_name END, btrim(p_comment));
  IF tg.t_originator THEN
    -- chi ha avviato: il nodo di avvio si riapre con un compito per lui ("Modifiche fatte"), stesso tetto di giri
    SELECT coalesce(max(round), 0) + 1 INTO v_round FROM workflow_node_runs WHERE instance_id = i.id AND node_id = tg.t_node;
    IF v_round > 20 THEN
      PERFORM wf_abort(i.id, format('Interrotto: il nodo "%s" ha superato 20 giri (ritorno indietro senza fine?)',
                                    (SELECT name FROM workflow_node_runs WHERE id = tg.t_run)));
      RETURN v_sb;
    END IF;
    v_run := gen_random_uuid();
    INSERT INTO workflow_node_runs (id, instance_id, node_id, node_type, name, round, required, send_back_id)
    SELECT v_run, i.id, tg.t_node, 'start', x.name, v_round, 1, v_sb FROM workflow_node_runs x WHERE x.id = tg.t_run;
    INSERT INTO tasks (project_id, instance_id, node_run_id, assignee_id) VALUES (i.project_id, i.id, v_run, i.started_by);
    PERFORM notify(i.started_by, i.project_id, 'WORKFLOW_CHANGES_REQUESTED', v_title, v_body,
                   format('/compiti?instance=%s', i.id),
                   jsonb_build_object('instance_id', i.id, 'send_back_id', v_sb, 'node_id', tg.t_node));
  ELSE
    PERFORM wf_activate_node(i.id, tg.t_node);
    IF (SELECT status FROM workflow_instances WHERE id = i.id) <> 'RUNNING' THEN
      RETURN v_sb;                     -- oltre i 20 giri: wf_activate_node ha interrotto l'istanza col motivo
    END IF;
    SELECT id INTO v_run FROM workflow_node_runs WHERE instance_id = i.id AND node_id = tg.t_node AND status = 'ACTIVE'
    ORDER BY round DESC LIMIT 1;
    UPDATE workflow_node_runs SET send_back_id = v_sb WHERE id = v_run;
    -- l'avviso generico "Compito: …" appena creato per il giro riaperto diventa quello della richiesta di modifiche
    -- (stessa transazione: created_at = now(); l'email parte dopo il commit e legge il testo aggiornato)
    UPDATE notifications SET kind = 'WORKFLOW_CHANGES_REQUESTED', title = v_title, body = v_body,
                             data = data || jsonb_build_object('send_back_id', v_sb)
    WHERE kind = 'TASK_ASSIGNED' AND created_at >= now() AND data ->> 'instance_id' = i.id::text
      AND data ->> 'node_id' = tg.t_node;
  END IF;
  UPDATE workflow_send_backs SET reopened_run_id = v_run WHERE id = v_sb;
  PERFORM wf_check_joins(i.id);
  RETURN v_sb;
END $$;

-- Workflow per documenti, completamento di un giro riaperto: se nel frattempo è stata caricata una revisione nuova,
-- il workflow passa su quella. Se il workflow era partito da una revisione condivisa e la nuova è WIP, la si condivide
-- con la stessa idoneità (il file deve aver passato le verifiche); il passaggio di stato finale deve restare valido.
CREATE FUNCTION cde.wf_take_new_revision(p_instance uuid, p_send_back uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  i      workflow_instances%ROWTYPE;
  t      workflow_templates%ROWTYPE;
  cur    document_revisions%ROWTYPE;
  latest document_revisions%ROWTYPE;
  v_new  uuid;
  v_state cde_state;
  target jsonb;
  rule   state_transitions%ROWTYPE;
BEGIN
  SELECT * INTO i FROM workflow_instances WHERE id = p_instance;
  IF i.document_id IS NULL THEN
    RETURN;
  END IF;
  SELECT * INTO t FROM workflow_templates WHERE id = i.template_id;
  SELECT * INTO cur FROM document_revisions WHERE id = i.revision_id;
  SELECT * INTO latest FROM document_revisions WHERE document_id = i.document_id ORDER BY sequence DESC LIMIT 1;
  IF latest.id = cur.id OR latest.sequence < cur.sequence THEN
    RETURN;                                  -- nessuna revisione nuova: si prosegue su quella di prima
  END IF;
  v_new := latest.id;
  v_state := latest.state;
  IF latest.state <> cur.state THEN
    IF NOT (cur.state = 'SHARED' AND latest.state = 'WIP') THEN
      RAISE EXCEPTION 'La nuova revisione % è in stato %: il workflow è partito da una revisione %',
        latest.revision_code, latest.state, cur.state USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM file_objects WHERE id = latest.file_object_id AND scan_status = 'CLEAN' AND sha256_verified) THEN
      RAISE EXCEPTION 'La nuova revisione % è ancora in verifica (antivirus e impronta): riprova tra qualche istante',
        latest.revision_code USING ERRCODE = 'check_violation';
    END IF;
    v_new := apply_transition(latest.id, 'SHARED', cur.suitability,
                              format('Nuova revisione per il workflow "%s" (modifiche richieste)', t.name),
                              current_app_user());
    v_state := 'SHARED';
  END IF;
  target := t.definition -> 'on_completed';
  IF target IS NOT NULL AND jsonb_typeof(target) = 'object' THEN
    rule := effective_transition(i.project_id, v_state, (target ->> 'to_state')::cde_state);
    IF rule.id IS NULL OR NOT ((target ->> 'suitability') = ANY (rule.allowed_suitability)) THEN
      RAISE EXCEPTION 'Il workflow prevede la transizione % → % non applicabile alla nuova revisione',
        v_state, target ->> 'to_state' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  UPDATE workflow_instances SET revision_id = v_new WHERE id = p_instance;
  UPDATE workflow_send_backs SET revision_from_id = coalesce(revision_from_id, cur.id),
                                 revision_from_code = coalesce(revision_from_code, cur.revision_code),
                                 revision_to_id = v_new,
                                 revision_to_code = (SELECT revision_code FROM document_revisions WHERE id = v_new)
  WHERE id = p_send_back;
END $$;

-- Completamento di un compito (riscritto dalla 0039): stessa logica di quorum ed esito rosso, più
--   * i compiti di chiarimento non votano e non si completano qui (workflow_answer_clarification);
--   * un compito in attesa di chiarimento non si completa;
--   * il nodo di avvio riaperto per "chi ha avviato" ha il solo esito "Fatto" e riparte dagli archi dell'avvio;
--   * un giro riaperto o rifatto per una richiesta di modifiche porta prima sulla revisione nuova (documenti) e poi
--     segue solo gli archi verso chi ha chiesto; i giri che attiva lungo quel cammino ereditano la richiesta.
CREATE OR REPLACE FUNCTION cde.workflow_complete_task(p_task_id uuid, p_outcome text, p_comment text DEFAULT NULL)
RETURNS cde.workflow_status
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  k        tasks%ROWTYPE;
  i        workflow_instances%ROWTYPE;
  s        workflow_node_runs%ROWTYPE;
  v_def    jsonb;
  node     jsonb;
  outc     jsonb;
  v_red    boolean;
  v_dec    text;
  v_toward text;
BEGIN
  SELECT * INTO k FROM tasks WHERE id = p_task_id AND assignee_id = current_app_user();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Compito non trovato' USING ERRCODE = 'no_data_found';
  END IF;
  -- serializza i compiti paralleli della stessa istanza
  SELECT * INTO i FROM workflow_instances WHERE id = k.instance_id FOR UPDATE;
  SELECT * INTO k FROM tasks WHERE id = p_task_id FOR UPDATE;
  IF k.kind = 'CLARIFICATION' THEN
    RAISE EXCEPTION 'Questo è un chiarimento: si risponde con un commento' USING ERRCODE = 'check_violation';
  END IF;
  IF k.status <> 'OPEN' OR i.status <> 'RUNNING' THEN
    RAISE EXCEPTION 'Compito già chiuso' USING ERRCODE = 'check_violation';
  END IF;
  IF k.waiting_send_back_id IS NOT NULL THEN
    RAISE EXCEPTION 'Compito in attesa di chiarimento: si completa quando arriva la risposta' USING ERRCODE = 'check_violation';
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

  IF v_red OR (SELECT count(*) FROM tasks WHERE node_run_id = s.id AND kind = 'WORKFLOW' AND status = 'DONE'
                                           AND outcome = p_outcome) >= s.required THEN
    v_dec := p_outcome;
  ELSIF NOT EXISTS (SELECT 1 FROM tasks WHERE node_run_id = s.id AND kind = 'WORKFLOW' AND status = 'OPEN') THEN
    SELECT o ->> 'code' INTO v_dec
    FROM jsonb_array_elements(wf_outcomes(node)) WITH ORDINALITY AS a(o, ord)
    LEFT JOIN (SELECT outcome, count(*) AS c FROM tasks WHERE node_run_id = s.id AND kind = 'WORKFLOW' AND status = 'DONE'
               GROUP BY outcome) v
      ON v.outcome = a.o ->> 'code'
    ORDER BY coalesce(v.c, 0) DESC, a.ord LIMIT 1;
  ELSE
    RETURN 'RUNNING';
  END IF;

  UPDATE workflow_node_runs SET status = 'DONE', outcome = v_dec, completed_at = now() WHERE id = s.id;
  -- deciso: gli altri voti non servono; si chiudono anche i chiarimenti chiesti da questo giro
  UPDATE tasks SET status = 'CANCELLED', cancel_reason = CASE WHEN kind = 'CLARIFICATION' THEN 'Passo già deciso' END
  WHERE node_run_id = s.id AND status = 'OPEN';
  IF v_red THEN
    UPDATE workflow_instances SET outcome_comment = p_comment WHERE id = i.id;          -- motivo per chi riceve il KO
  END IF;
  IF s.send_back_id IS NOT NULL THEN
    PERFORM wf_take_new_revision(i.id, s.send_back_id);
    SELECT from_node INTO v_toward FROM workflow_send_backs WHERE id = s.send_back_id;
    PERFORM wf_follow_toward(i.id, s.node_id, CASE WHEN s.node_type = 'start' THEN NULL ELSE v_dec END, s.round, v_toward);
  ELSE
    PERFORM wf_follow(i.id, s.node_id, v_dec, s.round);
  END IF;
  PERFORM wf_check_joins(i.id);
  IF s.send_back_id IS NOT NULL THEN
    -- i giri attivati ora sul cammino verso chi ha chiesto (non lui) ereditano la richiesta: anche loro, completati,
    -- seguiranno solo gli archi verso di lui
    UPDATE workflow_node_runs x SET send_back_id = s.send_back_id
    WHERE x.instance_id = i.id AND x.status = 'ACTIVE' AND x.send_back_id IS NULL AND x.activated_at = now()
      AND x.node_id <> v_toward AND wf_reaches(v_def, x.node_id, v_toward);
  END IF;
  RETURN (SELECT status FROM workflow_instances WHERE id = i.id);
END $$;

-- Allegati di un processo durante una richiesta di modifiche: li cambia chi ha un compito aperto su un giro riaperto
-- o rifatto. Si sostituiscono quelli che vede (gli allegati che non può vedere restano); nuovi solo se li vede.
CREATE FUNCTION cde.workflow_set_documents(p_instance uuid, p_documents uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  i      workflow_instances%ROWTYPE;
  v_sb   uuid;
  v_doc  uuid;
  v_prima uuid[];
BEGIN
  SELECT * INTO i FROM workflow_instances WHERE id = p_instance FOR UPDATE;
  IF NOT FOUND OR NOT (i.project_id IN (SELECT my_projects()) OR i.id IN (SELECT my_task_instances())) THEN
    RAISE EXCEPTION 'Processo non trovato' USING ERRCODE = 'no_data_found';
  END IF;
  IF i.subject <> 'PROCESS' OR i.status <> 'RUNNING' THEN
    RAISE EXCEPTION 'Gli allegati si cambiano solo in un processo in corso' USING ERRCODE = 'check_violation';
  END IF;
  SELECT r.send_back_id INTO v_sb
  FROM tasks k JOIN workflow_node_runs r ON r.id = k.node_run_id
  WHERE k.instance_id = i.id AND k.assignee_id = current_app_user() AND k.kind = 'WORKFLOW' AND k.status = 'OPEN'
    AND r.status = 'ACTIVE' AND r.send_back_id IS NOT NULL
  ORDER BY r.activated_at DESC LIMIT 1;
  IF v_sb IS NULL THEN
    RAISE EXCEPTION 'Gli allegati si cambiano dal compito su cui sono state richieste modifiche'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  FOREACH v_doc IN ARRAY coalesce(p_documents, '{}') LOOP
    IF NOT EXISTS (SELECT 1 FROM document_revisions r WHERE r.document_id = v_doc AND r.project_id = i.project_id
                     AND revision_visible_to_me(r)) THEN
      RAISE EXCEPTION 'Documento allegato non trovato' USING ERRCODE = 'no_data_found';
    END IF;
  END LOOP;
  SELECT coalesce(array_agg(document_id ORDER BY document_id), '{}') INTO v_prima
  FROM workflow_instance_documents WHERE instance_id = i.id;
  DELETE FROM workflow_instance_documents x
  WHERE x.instance_id = i.id AND NOT (x.document_id = ANY (coalesce(p_documents, '{}')))
    AND EXISTS (SELECT 1 FROM document_revisions r WHERE r.document_id = x.document_id AND revision_visible_to_me(r));
  INSERT INTO workflow_instance_documents (instance_id, document_id)
  SELECT DISTINCT i.id, d FROM unnest(coalesce(p_documents, '{}')) d ON CONFLICT DO NOTHING;
  UPDATE workflow_send_backs
  SET documents_before = coalesce(documents_before, v_prima),
      documents_after = (SELECT coalesce(array_agg(document_id ORDER BY document_id), '{}')
                         FROM workflow_instance_documents WHERE instance_id = i.id),
      documents_changed_by = current_app_user(), documents_changed_at = now()
  WHERE id = v_sb;
END $$;

-- Join ALL (riscritto dalla 0039): un giro diretto verso chi ha chiesto modifiche (send_back_id) conta solo verso i
-- nodi sul cammino fino a lui e dopo di lui (wf_reaches_toward), così i join interni agli altri rami non lo aspettano.
CREATE OR REPLACE FUNCTION cde.wf_check_joins(p_instance uuid) RETURNS void
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
    WHERE NOT EXISTS (SELECT 1 FROM workflow_node_runs r LEFT JOIN workflow_send_backs b ON b.id = r.send_back_id
                      WHERE r.instance_id = p_instance AND r.status = 'ACTIVE'
                        AND r.node_id <> w AND wf_reaches_toward(v_def, r.node_id, b.from_node, w))
      AND NOT EXISTS (SELECT 1 FROM unnest(v_wait) o WHERE o <> w AND wf_reaches(v_def, o, w))
    ORDER BY w LIMIT 1;
    IF v_ready IS NULL THEN
      -- join che si aspettano a vicenda senza nodi attivi in mezzo: si sblocca il primo per non restare fermi
      SELECT w INTO v_ready FROM unnest(v_wait) w
      WHERE NOT EXISTS (SELECT 1 FROM workflow_node_runs r LEFT JOIN workflow_send_backs b ON b.id = r.send_back_id
                        WHERE r.instance_id = p_instance AND r.status = 'ACTIVE'
                          AND r.node_id <> w AND wf_reaches_toward(v_def, r.node_id, b.from_node, w))
      ORDER BY w LIMIT 1;
    END IF;
    EXIT WHEN v_ready IS NULL;
    UPDATE workflow_edges_taken SET consumed = true WHERE instance_id = p_instance AND to_node = v_ready AND NOT consumed;
    PERFORM wf_activate_node(p_instance, v_ready);
  END LOOP;
END $$;

-- Scadenze, promemoria ed escalation (come nella 0039): un compito in attesa di chiarimento è sospeso.
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
      AND t.waiting_send_back_id IS NULL      -- 0042: in attesa di chiarimento = scadenza sospesa
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

-- =====================================================================
-- 4. Blocco del documento: nuova revisione durante una richiesta di modifiche
-- =====================================================================
-- Durante un workflow il documento non accetta revisioni (0007). Eccezione: chi ha un compito aperto su un giro
-- riaperto o rifatto per una richiesta di modifiche di quel workflow (o lo ha appena completato, nella stessa
-- transazione: è il momento in cui il workflow condivide la revisione nuova e passa su di lei).
CREATE FUNCTION cde.wf_rework_revision_allowed(p_document uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM workflow_instances i
    JOIN workflow_node_runs r ON r.instance_id = i.id AND r.send_back_id IS NOT NULL
    JOIN workflow_send_backs b ON b.id = r.send_back_id AND b.kind = 'CHANGES'
    JOIN tasks k ON k.node_run_id = r.id AND k.kind = 'WORKFLOW' AND k.assignee_id = current_app_user()
    WHERE i.document_id = p_document AND i.status = 'RUNNING'
      AND ((r.status = 'ACTIVE' AND k.status = 'OPEN') OR (k.status = 'DONE' AND k.completed_at = now())))
$$;

CREATE FUNCTION cde.assert_can_add_revision(p_document_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
BEGIN
  IF NOT wf_rework_revision_allowed(p_document_id) THEN
    PERFORM assert_not_in_review(p_document_id);
  END IF;
END $$;

-- come nella 0007, con l'eccezione qui sopra al posto del blocco secco
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
  PERFORM assert_can_add_revision(NEW.document_id);
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

-- =====================================================================
-- 5. RLS e privilegi
-- =====================================================================
ALTER TABLE cde.workflow_send_backs ENABLE ROW LEVEL SECURITY;
CREATE POLICY wf_send_backs_select ON cde.workflow_send_backs FOR SELECT TO cde_app
  USING (instance_id IN (SELECT id FROM cde.workflow_instances));
REVOKE ALL ON cde.workflow_send_backs FROM PUBLIC;
GRANT SELECT ON cde.workflow_send_backs TO cde_app;

REVOKE ALL ON FUNCTION cde.wf_upstream(uuid), cde.wf_send_back_target(uuid, text), cde.wf_send_back_people(uuid, uuid, boolean),
                       cde.wf_sender_task(uuid), cde.wf_my_name(), cde.wf_reaches_toward(jsonb, text, text, text),
                       cde.wf_follow_toward(uuid, text, text, integer, text), cde.wf_take_new_revision(uuid, uuid),
                       cde.wf_rework_revision_allowed(uuid), cde.workflow_send_back_targets(uuid),
                       cde.workflow_request_clarification(uuid, text, text), cde.workflow_answer_clarification(uuid, text),
                       cde.workflow_request_changes(uuid, text, text), cde.workflow_set_documents(uuid, uuid[]),
                       cde.assert_can_add_revision(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cde.workflow_send_back_targets(uuid), cde.workflow_request_clarification(uuid, text, text),
                          cde.workflow_answer_clarification(uuid, text), cde.workflow_request_changes(uuid, text, text),
                          cde.workflow_set_documents(uuid, uuid[]), cde.assert_can_add_revision(uuid) TO cde_app;
