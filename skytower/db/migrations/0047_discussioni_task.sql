-- "><(((º> sabusabu <º)))><"
-- depends: 0046_profilo_portale
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0047: discussioni condivise e task fra gli utenti della commessa (ADR-59)
--
-- Richiesta dell'utente del 26/11/2026 ("una funzione per avviare delle discussioni che possono essere condivise
-- tra gli utenti e un sistema di task"; scelte 1b 2a 3b 4c):
--   * 1b — in SkyTower, per commessa: discussioni e task stanno dentro una commessa e coinvolgono i suoi membri;
--   * 2a — una DISCUSSIONE la vedono solo le persone invitate da chi la apre (che può aggiungerne o toglierne
--     altre e chiuderla). Nessuna eccezione per gli amministratori: il Project Admin non legge le discussioni in
--     cui non è invitato (sono conversazioni di lavoro fra persone, non documenti della commessa);
--   * 3b — TASK completi: una o più persone assegnate, priorità, scadenza, stato (da fare / in corso / fatto) che
--     si cambia trascinando la scheda nella bacheca, sotto-task da spuntare, commenti, storia delle modifiche.
--     Un task si può creare da un messaggio di una discussione e resta collegato a lei. Un task lo vedono chi lo
--     ha assegnato e le persone assegnate;
--   * 4c — avvisi nel programma ed email (con le preferenze di sempre) a chi è coinvolto: invito in una
--     discussione, messaggio nuovo, task assegnato, commento, task completato, scadenza vicina o superata. In più
--     un RIEPILOGO GIORNALIERO dell'avanzamento, ma "solo per chi ha assegnato il task, per supervisionare":
--     ogni mattina dei giorni feriali chi ha dato task ad altri riceve lo stato di ciascuno (sotto-task fatti,
--     scadenza, ritardo) e cosa è cambiato dall'ultimo riepilogo. Si spegne dalle preferenze di notifica.
--
-- Tutte le scritture passano da funzioni SECURITY DEFINER (come le RFI, 0007): controllano chi può fare cosa,
-- scrivono la storia del task e creano le notifiche con cde.notify, che l'API non può chiamare direttamente.
-- La lettura è sotto RLS: partecipanti attivi per le discussioni, chi ha assegnato e assegnatari per i task,
-- sempre membri della commessa (chi esce dalla commessa non vede più nulla).
-- Nomi delle tabelle: cde.tasks esiste già (compiti dei workflow), quindi i task fra persone sono cde.team_tasks.
-- =====================================================================

-- ---------------------------------------------------------------- discussioni
CREATE TABLE cde.discussions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid        NOT NULL REFERENCES cde.projects (id) ON DELETE CASCADE,
  number           integer     NOT NULL,
  title            text        NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 200),
  created_by       uuid        NOT NULL REFERENCES cde.users (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_message_at  timestamptz NOT NULL DEFAULT now(),
  closed_at        timestamptz,
  closed_by        uuid        REFERENCES cde.users (id),
  UNIQUE (project_id, number)
);
CREATE INDEX ix_discussions_project ON cde.discussions (project_id, last_message_at DESC);

-- Chi partecipa. Togliere una persona non cancella la riga (removed_at): resta chi c'era e chi l'ha invitato;
-- riaggiungerla la riattiva. last_read_at = fin dove ha letto (messaggi non letti nell'elenco e in "Per me").
CREATE TABLE cde.discussion_participants (
  discussion_id  uuid        NOT NULL REFERENCES cde.discussions (id) ON DELETE CASCADE,
  user_id        uuid        NOT NULL REFERENCES cde.users (id),
  added_by       uuid        NOT NULL REFERENCES cde.users (id),
  added_at       timestamptz NOT NULL DEFAULT now(),
  removed_at     timestamptz,
  last_read_at   timestamptz,
  PRIMARY KEY (discussion_id, user_id)
);
CREATE INDEX ix_discussion_participants_user ON cde.discussion_participants (user_id) WHERE removed_at IS NULL;

-- Messaggi: non si modificano né si cancellano (nessun privilegio all'API). Allegati = revisioni di documenti
-- della commessa, come nelle RFI: i file stanno nel CDE, la discussione li cita.
CREATE TABLE cde.discussion_messages (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  discussion_id  uuid        NOT NULL REFERENCES cde.discussions (id) ON DELETE CASCADE,
  author_id      uuid        NOT NULL REFERENCES cde.users (id),
  body           text        NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 20000),
  revision_ids   uuid[]      NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_discussion_messages ON cde.discussion_messages (discussion_id, created_at);

-- ---------------------------------------------------------------- task
CREATE TABLE cde.team_tasks (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           uuid        NOT NULL REFERENCES cde.projects (id) ON DELETE CASCADE,
  number               integer     NOT NULL,
  title                text        NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 200),
  description          text        NOT NULL DEFAULT '' CHECK (length(description) <= 20000),
  status               text        NOT NULL DEFAULT 'TODO' CHECK (status IN ('TODO', 'IN_PROGRESS', 'DONE')),
  priority             text        NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  due_on               date,
  created_by           uuid        NOT NULL REFERENCES cde.users (id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  started_at           timestamptz,
  completed_at         timestamptz,
  completed_by         uuid        REFERENCES cde.users (id),
  -- nato da una discussione (e dal suo messaggio): il collegamento lo vede solo chi partecipa alla discussione
  discussion_id        uuid        REFERENCES cde.discussions (id) ON DELETE SET NULL,
  message_id           uuid        REFERENCES cde.discussion_messages (id) ON DELETE SET NULL,
  reminded_at          timestamptz,                 -- avviso "scade oggi/domani" già dato
  overdue_notified_at  timestamptz,                 -- avviso "in ritardo" già dato
  deleted_at           timestamptz,                 -- eliminato da chi l'ha assegnato: sparisce per tutti
  deleted_by           uuid        REFERENCES cde.users (id),
  UNIQUE (project_id, number),
  CONSTRAINT team_tasks_done CHECK ((status = 'DONE') = (completed_at IS NOT NULL))
);
CREATE INDEX ix_team_tasks_project ON cde.team_tasks (project_id) WHERE deleted_at IS NULL;
CREATE INDEX ix_team_tasks_creator ON cde.team_tasks (created_by) WHERE deleted_at IS NULL;
CREATE INDEX ix_team_tasks_due ON cde.team_tasks (due_on)
  WHERE deleted_at IS NULL AND status <> 'DONE' AND due_on IS NOT NULL;

CREATE TABLE cde.team_task_assignees (
  task_id   uuid        NOT NULL REFERENCES cde.team_tasks (id) ON DELETE CASCADE,
  user_id   uuid        NOT NULL REFERENCES cde.users (id),
  added_by  uuid        NOT NULL REFERENCES cde.users (id),
  added_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, user_id)
);
CREATE INDEX ix_team_task_assignees_user ON cde.team_task_assignees (user_id);

-- Sotto-task: voci da spuntare; la barra di avanzamento del task è fatti / totali
CREATE TABLE cde.team_task_items (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid        NOT NULL REFERENCES cde.team_tasks (id) ON DELETE CASCADE,
  title       text        NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 300),
  position    integer     NOT NULL,
  created_by  uuid        NOT NULL REFERENCES cde.users (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  done_at     timestamptz,
  done_by     uuid        REFERENCES cde.users (id)
);
CREATE INDEX ix_team_task_items ON cde.team_task_items (task_id, position);

CREATE TABLE cde.team_task_comments (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid        NOT NULL REFERENCES cde.team_tasks (id) ON DELETE CASCADE,
  author_id   uuid        NOT NULL REFERENCES cde.users (id),
  body        text        NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 20000),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_team_task_comments ON cde.team_task_comments (task_id, created_at);

-- Storia del task: chi ha fatto cosa e quando. La legge la scheda del task ("Storia") e il riepilogo di chi
-- supervisiona ("cosa è cambiato dall'ultimo riepilogo"). actor_id NULL = il sistema (scadenza superata).
CREATE TABLE cde.team_task_events (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id     uuid        NOT NULL REFERENCES cde.team_tasks (id) ON DELETE CASCADE,
  actor_id    uuid        REFERENCES cde.users (id),
  kind        text        NOT NULL,
  data        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_team_task_events ON cde.team_task_events (task_id, id);

-- ---------------------------------------------------------------- riepilogo di chi supervisiona
ALTER TABLE cde.notification_preferences ADD COLUMN team_task_digest boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN cde.notification_preferences.team_task_digest IS
  'Riepilogo del mattino (giorni feriali) dell''avanzamento dei task assegnati ad altri (ADR-59)';

-- Ultimo riepilogo mandato a ciascuno: la finestra "cosa è cambiato" parte da qui (il lunedì copre il fine
-- settimana) e il job, se riparte, non manda due volte lo stesso riepilogo.
CREATE TABLE cde.team_task_digest_log (
  user_id  uuid        PRIMARY KEY REFERENCES cde.users (id) ON DELETE CASCADE,
  sent_at  timestamptz NOT NULL
);

-- =====================================================================
-- Funzioni di appoggio
-- =====================================================================
CREATE FUNCTION cde.user_display_name(p_user uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT first_name || ' ' || last_name FROM users WHERE id = p_user
$$;

-- Partecipante attivo della discussione e ancora membro della commessa
CREATE FUNCTION cde.discussion_participant(p_discussion uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM discussions d JOIN discussion_participants dp ON dp.discussion_id = d.id
    WHERE d.id = p_discussion AND dp.user_id = current_app_user() AND dp.removed_at IS NULL
      AND is_project_member(current_app_user(), d.project_id))
$$;

-- Task visibile: chi l'ha assegnato o una persona assegnata, membro della commessa, task non eliminato
CREATE FUNCTION cde.team_task_visible(p_task uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM team_tasks t
    WHERE t.id = p_task AND t.deleted_at IS NULL
      AND (t.created_by = current_app_user()
           OR EXISTS (SELECT 1 FROM team_task_assignees a WHERE a.task_id = t.id AND a.user_id = current_app_user()))
      AND is_project_member(current_app_user(), t.project_id))
$$;

-- Il giorno di calendario nel fuso della commessa. Il PostgreSQL integrato di Windows (cde dev, test) non ha
-- l'archivio dei fusi e non riconosce 'Europe/Rome': lì vale la regola POSIX dell'ora legale europea (CET/CEST),
-- che PostgreSQL capisce senza archivio. Tutte le commesse della suite sono in Italia.
CREATE FUNCTION cde.local_date(p_ts timestamptz, p_tz text) RETURNS date
LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN (p_ts AT TIME ZONE p_tz)::date;
EXCEPTION WHEN invalid_parameter_value THEN
  RETURN (p_ts AT TIME ZONE 'CET-1CEST,M3.5.0,M10.5.0/3')::date;
END $$;

CREATE FUNCTION cde.team_task_code(p_number integer) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT 'TASK-' || lpad(p_number::text, 4, '0') $$;

-- Una riga di storia, a nome di chi agisce (NULL nel worker)
CREATE FUNCTION cde.team_task_log(p_task uuid, p_kind text, p_data jsonb DEFAULT '{}'::jsonb) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  INSERT INTO team_task_events (task_id, actor_id, kind, data) VALUES (p_task, current_app_user(), p_kind, coalesce(p_data, '{}'))
$$;

-- Avviso a una persona, ma una sola volta finché non lo legge: dieci messaggi di fila nella stessa discussione
-- (o dieci commenti allo stesso task) non diventano dieci email. Aprire la discussione o il task segna letti gli
-- avvisi che la riguardano, e il messaggio dopo avvisa di nuovo.
CREATE FUNCTION cde.notify_once(p_user uuid, p_project uuid, p_kind text, p_key text, p_id uuid, p_title text,
                                p_body text, p_link text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = p_user AND n.kind = p_kind AND n.read_at IS NULL
               AND n.data ->> p_key = p_id::text) THEN
    RETURN;
  END IF;
  PERFORM notify(p_user, p_project, p_kind, p_title, p_body, p_link, jsonb_build_object(p_key, p_id));
END $$;

-- =====================================================================
-- Discussioni
-- =====================================================================
CREATE FUNCTION cde.discussion_create(p_project uuid, p_title text, p_body text, p_participants uuid[],
                                      p_revisions uuid[] DEFAULT '{}') RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  v_me     uuid := current_app_user();
  v_id     uuid := gen_random_uuid();
  v_num    integer;
  v_others uuid[];
  v_user   uuid;
BEGIN
  IF v_me IS NULL OR NOT is_project_member(v_me, p_project) THEN
    RAISE EXCEPTION 'Progetto non trovato' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT coalesce(array_agg(DISTINCT u), '{}') INTO v_others FROM unnest(coalesce(p_participants, '{}')) u WHERE u <> v_me;
  IF cardinality(v_others) = 0 THEN
    RAISE EXCEPTION 'Invita almeno un''altra persona della commessa' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_others) u WHERE NOT is_project_member(u, p_project)) THEN
    RAISE EXCEPTION 'Una delle persone invitate non è membro della commessa' USING ERRCODE = 'check_violation';
  END IF;
  v_num := next_project_number(p_project, 'DISCUSSION');
  INSERT INTO discussions (id, project_id, number, title, created_by) VALUES (v_id, p_project, v_num, btrim(p_title), v_me);
  INSERT INTO discussion_participants (discussion_id, user_id, added_by, last_read_at) VALUES (v_id, v_me, v_me, now());
  INSERT INTO discussion_participants (discussion_id, user_id, added_by) SELECT v_id, u, v_me FROM unnest(v_others) u;
  INSERT INTO discussion_messages (discussion_id, author_id, body, revision_ids)
  VALUES (v_id, v_me, p_body, coalesce(p_revisions, '{}'));
  FOREACH v_user IN ARRAY v_others LOOP
    PERFORM notify(v_user, p_project, 'DISCUSSION_ADDED', format('Discussione: %s', btrim(p_title)),
                   format('%s ti ha invitato. %s', user_display_name(v_me), left(p_body, 400)),
                   format('/progetti/%s/discussioni/%s', p_project, v_id), jsonb_build_object('discussion_id', v_id));
  END LOOP;
  RETURN v_id;
END $$;

CREATE FUNCTION cde.discussion_post(p_discussion uuid, p_body text, p_revisions uuid[] DEFAULT '{}') RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  v_me   uuid := current_app_user();
  d      discussions%ROWTYPE;
  v_id   uuid := gen_random_uuid();
  v_user uuid;
BEGIN
  IF NOT discussion_participant(p_discussion) THEN
    RAISE EXCEPTION 'Discussione non trovata' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO d FROM discussions WHERE id = p_discussion FOR UPDATE;
  IF d.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'La discussione è chiusa' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO discussion_messages (id, discussion_id, author_id, body, revision_ids)
  VALUES (v_id, p_discussion, v_me, p_body, coalesce(p_revisions, '{}'));
  UPDATE discussions SET last_message_at = now() WHERE id = p_discussion;
  UPDATE discussion_participants SET last_read_at = now() WHERE discussion_id = p_discussion AND user_id = v_me;
  FOR v_user IN
    SELECT dp.user_id FROM discussion_participants dp
    WHERE dp.discussion_id = p_discussion AND dp.removed_at IS NULL AND dp.user_id <> v_me
      AND is_project_member(dp.user_id, d.project_id)
  LOOP
    PERFORM notify_once(v_user, d.project_id, 'DISCUSSION_MESSAGE', 'discussion_id', p_discussion,
                        format('%s in «%s»', user_display_name(v_me), d.title), left(p_body, 500),
                        format('/progetti/%s/discussioni/%s', d.project_id, p_discussion));
  END LOOP;
  RETURN v_id;
END $$;

-- Titolo e/o persone (NULL = invariato). Solo chi ha aperto la discussione; lui resta sempre dentro.
CREATE FUNCTION cde.discussion_update(p_discussion uuid, p_title text, p_participants uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  v_me   uuid := current_app_user();
  d      discussions%ROWTYPE;
  v_new  uuid[];
  v_user uuid;
BEGIN
  IF NOT discussion_participant(p_discussion) THEN
    RAISE EXCEPTION 'Discussione non trovata' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO d FROM discussions WHERE id = p_discussion FOR UPDATE;
  IF d.created_by <> v_me THEN
    RAISE EXCEPTION 'Solo chi ha aperto la discussione può cambiarla' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_title IS NOT NULL AND btrim(p_title) <> d.title THEN
    UPDATE discussions SET title = btrim(p_title) WHERE id = p_discussion;
  END IF;
  IF p_participants IS NULL THEN
    RETURN;
  END IF;
  SELECT coalesce(array_agg(DISTINCT u), '{}') INTO v_new FROM unnest(p_participants) u WHERE u <> v_me;
  IF cardinality(v_new) = 0 THEN
    RAISE EXCEPTION 'Nella discussione serve almeno un''altra persona' USING ERRCODE = 'check_violation';
  END IF;
  -- chi entra adesso deve essere membro della commessa (chi c'era già resta anche se nel frattempo è uscito:
  -- non vede comunque nulla finché non torna membro)
  IF EXISTS (SELECT 1 FROM unnest(v_new) u
             WHERE NOT EXISTS (SELECT 1 FROM discussion_participants dp WHERE dp.discussion_id = p_discussion
                                 AND dp.user_id = u AND dp.removed_at IS NULL)
               AND NOT is_project_member(u, d.project_id)) THEN
    RAISE EXCEPTION 'Una delle persone invitate non è membro della commessa' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE discussion_participants SET removed_at = now()
   WHERE discussion_id = p_discussion AND removed_at IS NULL AND user_id <> v_me AND user_id <> ALL (v_new);
  FOR v_user IN
    SELECT u FROM unnest(v_new) u
    WHERE NOT EXISTS (SELECT 1 FROM discussion_participants dp WHERE dp.discussion_id = p_discussion
                        AND dp.user_id = u AND dp.removed_at IS NULL)
  LOOP
    INSERT INTO discussion_participants (discussion_id, user_id, added_by) VALUES (p_discussion, v_user, v_me)
    ON CONFLICT (discussion_id, user_id) DO UPDATE
      SET removed_at = NULL, added_by = EXCLUDED.added_by, added_at = now(), last_read_at = NULL;
    PERFORM notify(v_user, d.project_id, 'DISCUSSION_ADDED',
                   format('Discussione: %s', coalesce(btrim(p_title), d.title)),
                   format('%s ti ha aggiunto alla discussione.', user_display_name(v_me)),
                   format('/progetti/%s/discussioni/%s', d.project_id, p_discussion),
                   jsonb_build_object('discussion_id', p_discussion));
  END LOOP;
END $$;

-- Uscire da una discussione (chi l'ha aperta non può: la chiude)
CREATE FUNCTION cde.discussion_leave(p_discussion uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
BEGIN
  IF NOT discussion_participant(p_discussion) THEN
    RAISE EXCEPTION 'Discussione non trovata' USING ERRCODE = 'no_data_found';
  END IF;
  IF (SELECT created_by FROM discussions WHERE id = p_discussion) = current_app_user() THEN
    RAISE EXCEPTION 'Chi ha aperto la discussione non può uscirne: può chiuderla' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE discussion_participants SET removed_at = now()
   WHERE discussion_id = p_discussion AND user_id = current_app_user();
END $$;

CREATE FUNCTION cde.discussion_set_closed(p_discussion uuid, p_closed boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  d discussions%ROWTYPE;
BEGIN
  IF NOT discussion_participant(p_discussion) THEN
    RAISE EXCEPTION 'Discussione non trovata' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO d FROM discussions WHERE id = p_discussion FOR UPDATE;
  IF d.created_by <> current_app_user() THEN
    RAISE EXCEPTION 'Solo chi ha aperto la discussione può chiuderla o riaprirla' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE discussions
     SET closed_at = CASE WHEN p_closed THEN coalesce(closed_at, now()) END,
         closed_by = CASE WHEN p_closed THEN coalesce(closed_by, current_app_user()) END
   WHERE id = p_discussion;
END $$;

-- Letta fin qui: azzera i non letti e segna letti gli avvisi di questa discussione
CREATE FUNCTION cde.discussion_mark_read(p_discussion uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
BEGIN
  IF NOT discussion_participant(p_discussion) THEN
    RAISE EXCEPTION 'Discussione non trovata' USING ERRCODE = 'no_data_found';
  END IF;
  UPDATE discussion_participants SET last_read_at = now()
   WHERE discussion_id = p_discussion AND user_id = current_app_user();
  UPDATE notifications SET read_at = now()
   WHERE user_id = current_app_user() AND read_at IS NULL AND data ->> 'discussion_id' = p_discussion::text;
END $$;

-- =====================================================================
-- Task
-- =====================================================================
CREATE FUNCTION cde.team_task_create(p_project uuid, p_title text, p_description text, p_priority text, p_due date,
                                     p_assignees uuid[], p_items text[] DEFAULT '{}', p_discussion uuid DEFAULT NULL,
                                     p_message uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  v_me    uuid := current_app_user();
  v_id    uuid := gen_random_uuid();
  v_num   integer;
  v_ass   uuid[];
  v_user  uuid;
  v_disc  uuid := p_discussion;
BEGIN
  IF v_me IS NULL OR NOT is_project_member(v_me, p_project) THEN
    RAISE EXCEPTION 'Progetto non trovato' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT coalesce(array_agg(DISTINCT u), '{}') INTO v_ass FROM unnest(coalesce(p_assignees, '{}')) u;
  IF cardinality(v_ass) = 0 THEN
    RAISE EXCEPTION 'Assegna il task ad almeno una persona' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_ass) u WHERE NOT is_project_member(u, p_project)) THEN
    RAISE EXCEPTION 'Una delle persone assegnate non è membro della commessa' USING ERRCODE = 'check_violation';
  END IF;
  -- dal messaggio di una discussione: chi crea il task deve partecipare a quella discussione, della stessa commessa
  IF p_message IS NOT NULL THEN
    SELECT discussion_id INTO v_disc FROM discussion_messages WHERE id = p_message;
    IF v_disc IS NULL OR (p_discussion IS NOT NULL AND v_disc <> p_discussion) THEN
      RAISE EXCEPTION 'Messaggio non trovato' USING ERRCODE = 'no_data_found';
    END IF;
  END IF;
  IF v_disc IS NOT NULL AND (NOT discussion_participant(v_disc)
                             OR (SELECT project_id FROM discussions WHERE id = v_disc) <> p_project) THEN
    RAISE EXCEPTION 'Discussione non trovata' USING ERRCODE = 'no_data_found';
  END IF;
  v_num := next_project_number(p_project, 'TEAM_TASK');
  INSERT INTO team_tasks (id, project_id, number, title, description, priority, due_on, created_by, discussion_id, message_id)
  VALUES (v_id, p_project, v_num, btrim(p_title), coalesce(p_description, ''), coalesce(p_priority, 'NORMAL'), p_due, v_me,
          v_disc, p_message);
  INSERT INTO team_task_assignees (task_id, user_id, added_by) SELECT v_id, u, v_me FROM unnest(v_ass) u;
  INSERT INTO team_task_items (task_id, title, position, created_by)
  SELECT v_id, btrim(t), n, v_me FROM unnest(coalesce(p_items, '{}')) WITH ORDINALITY AS x (t, n) WHERE btrim(t) <> '';
  PERFORM team_task_log(v_id, 'CREATED', jsonb_build_object(
    'assignees', (SELECT jsonb_agg(user_display_name(u)) FROM unnest(v_ass) u)));
  FOREACH v_user IN ARRAY v_ass LOOP
    CONTINUE WHEN v_user = v_me;
    PERFORM notify(v_user, p_project, 'TEAM_TASK_ASSIGNED', format('%s: %s', team_task_code(v_num), btrim(p_title)),
                   format('%s ti ha assegnato un task%s.', user_display_name(v_me),
                          CASE WHEN p_due IS NOT NULL THEN format(' da completare entro il %s', to_char(p_due, 'DD/MM/YYYY')) ELSE '' END),
                   format('/progetti/%s/task/%s', p_project, v_id), jsonb_build_object('task_id', v_id));
  END LOOP;
  RETURN v_id;
END $$;

-- Modifica di un task: p_changes ha solo le chiavi da cambiare (title, description, priority, due_on,
-- assignee_ids, status). Lo stato lo cambiano chi ha assegnato il task e le persone assegnate (bacheca); tutto il
-- resto solo chi l'ha assegnato. Ogni cambio finisce nella storia del task.
CREATE FUNCTION cde.team_task_update(p_task uuid, p_changes jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  v_me     uuid := current_app_user();
  t        team_tasks%ROWTYPE;
  v_code   text;
  v_link   text;
  v_new    uuid[];
  v_user   uuid;
  v_status text;
  v_due    date;
BEGIN
  IF NOT team_task_visible(p_task) THEN
    RAISE EXCEPTION 'Task non trovato' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO t FROM team_tasks WHERE id = p_task FOR UPDATE;
  v_code := team_task_code(t.number);
  v_link := format('/progetti/%s/task/%s', t.project_id, p_task);
  IF p_changes ?| ARRAY['title', 'description', 'priority', 'due_on', 'assignee_ids'] AND t.created_by <> v_me THEN
    RAISE EXCEPTION 'Solo chi ha assegnato il task può cambiarne titolo, descrizione, priorità, scadenza e persone'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_changes ? 'title' AND btrim(p_changes ->> 'title') <> t.title THEN
    UPDATE team_tasks SET title = btrim(p_changes ->> 'title') WHERE id = p_task;
    PERFORM team_task_log(p_task, 'TITLE', jsonb_build_object('from', t.title, 'to', btrim(p_changes ->> 'title')));
  END IF;
  IF p_changes ? 'description' AND coalesce(p_changes ->> 'description', '') <> t.description THEN
    UPDATE team_tasks SET description = coalesce(p_changes ->> 'description', '') WHERE id = p_task;
    PERFORM team_task_log(p_task, 'DESCRIPTION');
  END IF;
  IF p_changes ? 'priority' AND p_changes ->> 'priority' <> t.priority THEN
    UPDATE team_tasks SET priority = p_changes ->> 'priority' WHERE id = p_task;
    PERFORM team_task_log(p_task, 'PRIORITY', jsonb_build_object('from', t.priority, 'to', p_changes ->> 'priority'));
  END IF;
  IF p_changes ? 'due_on' THEN
    v_due := (p_changes ->> 'due_on')::date;
    IF v_due IS DISTINCT FROM t.due_on THEN
      -- nuova scadenza: gli avvisi di scadenza ripartono da capo
      UPDATE team_tasks SET due_on = v_due, reminded_at = NULL, overdue_notified_at = NULL WHERE id = p_task;
      PERFORM team_task_log(p_task, 'DUE', jsonb_build_object('from', t.due_on, 'to', v_due));
      FOR v_user IN SELECT user_id FROM team_task_assignees WHERE task_id = p_task AND user_id <> v_me LOOP
        PERFORM notify(v_user, t.project_id, 'TEAM_TASK_DUE_CHANGED', format('%s: nuova scadenza', v_code),
                       format('«%s»: %s', t.title, CASE WHEN v_due IS NULL THEN 'scadenza tolta'
                                                        ELSE format('da completare entro il %s', to_char(v_due, 'DD/MM/YYYY')) END),
                       v_link, jsonb_build_object('task_id', p_task));
      END LOOP;
    END IF;
  END IF;

  IF p_changes ? 'assignee_ids' THEN
    SELECT coalesce(array_agg(DISTINCT x::uuid), '{}') INTO v_new
      FROM jsonb_array_elements_text(coalesce(p_changes -> 'assignee_ids', '[]'::jsonb)) x;
    IF cardinality(v_new) = 0 THEN
      RAISE EXCEPTION 'Assegna il task ad almeno una persona' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(v_new) u
               WHERE NOT EXISTS (SELECT 1 FROM team_task_assignees a WHERE a.task_id = p_task AND a.user_id = u)
                 AND NOT is_project_member(u, t.project_id)) THEN
      RAISE EXCEPTION 'Una delle persone assegnate non è membro della commessa' USING ERRCODE = 'check_violation';
    END IF;
    FOR v_user IN SELECT user_id FROM team_task_assignees WHERE task_id = p_task AND user_id <> ALL (v_new) LOOP
      DELETE FROM team_task_assignees WHERE task_id = p_task AND user_id = v_user;
      PERFORM team_task_log(p_task, 'UNASSIGNED', jsonb_build_object('user_id', v_user, 'name', user_display_name(v_user)));
    END LOOP;
    FOR v_user IN
      SELECT u FROM unnest(v_new) u WHERE NOT EXISTS (SELECT 1 FROM team_task_assignees a WHERE a.task_id = p_task AND a.user_id = u)
    LOOP
      INSERT INTO team_task_assignees (task_id, user_id, added_by) VALUES (p_task, v_user, v_me);
      PERFORM team_task_log(p_task, 'ASSIGNED', jsonb_build_object('user_id', v_user, 'name', user_display_name(v_user)));
      CONTINUE WHEN v_user = v_me;
      PERFORM notify(v_user, t.project_id, 'TEAM_TASK_ASSIGNED', format('%s: %s', v_code, t.title),
                     format('%s ti ha assegnato un task%s.', user_display_name(v_me),
                            CASE WHEN t.due_on IS NOT NULL THEN format(' da completare entro il %s', to_char(t.due_on, 'DD/MM/YYYY')) ELSE '' END),
                     v_link, jsonb_build_object('task_id', p_task));
    END LOOP;
  END IF;

  IF p_changes ? 'status' AND p_changes ->> 'status' <> t.status THEN
    v_status := p_changes ->> 'status';
    UPDATE team_tasks
       SET status = v_status,
           started_at = CASE WHEN v_status = 'IN_PROGRESS' THEN coalesce(started_at, now()) ELSE started_at END,
           completed_at = CASE WHEN v_status = 'DONE' THEN now() END,
           completed_by = CASE WHEN v_status = 'DONE' THEN v_me END
     WHERE id = p_task;
    PERFORM team_task_log(p_task, 'STATUS', jsonb_build_object('from', t.status, 'to', v_status));
    IF v_status = 'DONE' AND t.created_by <> v_me THEN
      -- chi ha assegnato il task lo sa subito (il riepilogo del mattino lo ripete fra i completati)
      PERFORM notify(t.created_by, t.project_id, 'TEAM_TASK_COMPLETED', format('%s completato', v_code),
                     format('%s ha completato «%s».', user_display_name(v_me), t.title), v_link,
                     jsonb_build_object('task_id', p_task));
    ELSIF t.status = 'DONE' AND v_me = t.created_by THEN
      -- riaperto da chi l'ha assegnato: le persone assegnate devono saperlo
      FOR v_user IN SELECT user_id FROM team_task_assignees WHERE task_id = p_task AND user_id <> v_me LOOP
        PERFORM notify(v_user, t.project_id, 'TEAM_TASK_REOPENED', format('%s riaperto', v_code),
                       format('%s ha riaperto «%s».', user_display_name(v_me), t.title), v_link,
                       jsonb_build_object('task_id', p_task));
      END LOOP;
    END IF;
  END IF;
  UPDATE team_tasks SET updated_at = now() WHERE id = p_task;
END $$;

CREATE FUNCTION cde.team_task_delete(p_task uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
BEGIN
  IF NOT team_task_visible(p_task) THEN
    RAISE EXCEPTION 'Task non trovato' USING ERRCODE = 'no_data_found';
  END IF;
  IF (SELECT created_by FROM team_tasks WHERE id = p_task) <> current_app_user() THEN
    RAISE EXCEPTION 'Solo chi ha assegnato il task può eliminarlo' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM team_task_log(p_task, 'DELETED');
  UPDATE team_tasks SET deleted_at = now(), deleted_by = current_app_user(), updated_at = now() WHERE id = p_task;
END $$;

-- Sotto-task: li aggiungono e spuntano chi ha assegnato il task e le persone assegnate (chi lavora può dividersi
-- il lavoro); li toglie chi ha assegnato il task o chi li ha scritti.
CREATE FUNCTION cde.team_task_item_add(p_task uuid, p_title text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  v_id uuid := gen_random_uuid();
BEGIN
  IF NOT team_task_visible(p_task) THEN
    RAISE EXCEPTION 'Task non trovato' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM 1 FROM team_tasks WHERE id = p_task FOR UPDATE;
  INSERT INTO team_task_items (id, task_id, title, position, created_by)
  VALUES (v_id, p_task, btrim(p_title),
          coalesce((SELECT max(position) FROM team_task_items WHERE task_id = p_task), 0) + 1, current_app_user());
  PERFORM team_task_log(p_task, 'ITEM_ADDED', jsonb_build_object('title', btrim(p_title)));
  UPDATE team_tasks SET updated_at = now() WHERE id = p_task;
  RETURN v_id;
END $$;

CREATE FUNCTION cde.team_task_item_set(p_item uuid, p_done boolean, p_title text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  i team_task_items%ROWTYPE;
BEGIN
  SELECT * INTO i FROM team_task_items WHERE id = p_item;
  IF i.id IS NULL OR NOT team_task_visible(i.task_id) THEN
    RAISE EXCEPTION 'Sotto-task non trovato' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_title IS NOT NULL AND btrim(p_title) <> i.title THEN
    UPDATE team_task_items SET title = btrim(p_title) WHERE id = p_item;
    PERFORM team_task_log(i.task_id, 'ITEM_RENAMED', jsonb_build_object('from', i.title, 'to', btrim(p_title)));
  END IF;
  IF p_done IS NOT NULL AND p_done <> (i.done_at IS NOT NULL) THEN
    UPDATE team_task_items SET done_at = CASE WHEN p_done THEN now() END, done_by = CASE WHEN p_done THEN current_app_user() END
     WHERE id = p_item;
    PERFORM team_task_log(i.task_id, CASE WHEN p_done THEN 'ITEM_DONE' ELSE 'ITEM_REOPENED' END,
                          jsonb_build_object('title', coalesce(btrim(p_title), i.title)));
  END IF;
  UPDATE team_tasks SET updated_at = now() WHERE id = i.task_id;
  RETURN i.task_id;
END $$;

CREATE FUNCTION cde.team_task_item_delete(p_item uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  i team_task_items%ROWTYPE;
BEGIN
  SELECT * INTO i FROM team_task_items WHERE id = p_item;
  IF i.id IS NULL OR NOT team_task_visible(i.task_id) THEN
    RAISE EXCEPTION 'Sotto-task non trovato' USING ERRCODE = 'no_data_found';
  END IF;
  IF current_app_user() NOT IN ((SELECT created_by FROM team_tasks WHERE id = i.task_id), i.created_by) THEN
    RAISE EXCEPTION 'Il sotto-task lo toglie chi ha assegnato il task o chi l''ha scritto' USING ERRCODE = 'insufficient_privilege';
  END IF;
  DELETE FROM team_task_items WHERE id = p_item;
  PERFORM team_task_log(i.task_id, 'ITEM_REMOVED', jsonb_build_object('title', i.title));
  UPDATE team_tasks SET updated_at = now() WHERE id = i.task_id;
  RETURN i.task_id;
END $$;

CREATE FUNCTION cde.team_task_comment(p_task uuid, p_body text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  v_me   uuid := current_app_user();
  t      team_tasks%ROWTYPE;
  v_id   uuid := gen_random_uuid();
  v_user uuid;
BEGIN
  IF NOT team_task_visible(p_task) THEN
    RAISE EXCEPTION 'Task non trovato' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO t FROM team_tasks WHERE id = p_task;
  INSERT INTO team_task_comments (id, task_id, author_id, body) VALUES (v_id, p_task, v_me, p_body);
  PERFORM team_task_log(p_task, 'COMMENT');
  UPDATE team_tasks SET updated_at = now() WHERE id = p_task;
  FOR v_user IN
    SELECT t.created_by UNION SELECT user_id FROM team_task_assignees WHERE task_id = p_task
  LOOP
    CONTINUE WHEN v_user = v_me OR NOT is_project_member(v_user, t.project_id);
    PERFORM notify_once(v_user, t.project_id, 'TEAM_TASK_COMMENT', 'task_id', p_task,
                        format('%s: commento di %s', team_task_code(t.number), user_display_name(v_me)),
                        format('«%s»: %s', t.title, left(p_body, 400)), format('/progetti/%s/task/%s', t.project_id, p_task));
  END LOOP;
  RETURN v_id;
END $$;

-- =====================================================================
-- Scadenze (worker, ogni 15 minuti con le altre): "scade oggi/domani" alle persone assegnate, poi "in ritardo"
-- alle persone assegnate e a chi ha assegnato il task, una volta sola. Il giorno è quello del fuso della commessa.
-- =====================================================================
CREATE FUNCTION cde.team_task_deadlines(p_now timestamptz DEFAULT now()) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  k      record;
  v_user uuid;
  v_n    integer := 0;
  v_link text;
BEGIN
  FOR k IN
    SELECT t.*, cde.local_date(p_now, p.timezone) AS oggi
    FROM team_tasks t JOIN projects p ON p.id = t.project_id
    WHERE t.deleted_at IS NULL AND t.status <> 'DONE' AND t.due_on IS NOT NULL
      AND (t.reminded_at IS NULL OR t.overdue_notified_at IS NULL)
    FOR UPDATE OF t SKIP LOCKED
  LOOP
    v_link := format('/progetti/%s/task/%s', k.project_id, k.id);
    IF k.due_on < k.oggi THEN
      IF k.overdue_notified_at IS NULL THEN
        FOR v_user IN SELECT k.created_by UNION SELECT user_id FROM team_task_assignees WHERE task_id = k.id LOOP
          CONTINUE WHEN NOT is_project_member(v_user, k.project_id);
          PERFORM notify(v_user, k.project_id, 'TEAM_TASK_OVERDUE', format('%s in ritardo', team_task_code(k.number)),
                         format('«%s» scadeva il %s.', k.title, to_char(k.due_on, 'DD/MM/YYYY')), v_link,
                         jsonb_build_object('task_id', k.id));
        END LOOP;
        INSERT INTO team_task_events (task_id, actor_id, kind, data)
        VALUES (k.id, NULL, 'OVERDUE', jsonb_build_object('due_on', k.due_on));
        UPDATE team_tasks SET overdue_notified_at = p_now, reminded_at = coalesce(reminded_at, p_now) WHERE id = k.id;
        v_n := v_n + 1;
      END IF;
    ELSIF k.due_on <= k.oggi + 1 AND k.reminded_at IS NULL THEN
      FOR v_user IN SELECT user_id FROM team_task_assignees WHERE task_id = k.id LOOP
        CONTINUE WHEN NOT is_project_member(v_user, k.project_id);
        PERFORM notify(v_user, k.project_id, 'TEAM_TASK_REMINDER',
                       format('%s scade %s', team_task_code(k.number), CASE WHEN k.due_on = k.oggi THEN 'oggi' ELSE 'domani' END),
                       format('«%s» è da completare entro il %s.', k.title, to_char(k.due_on, 'DD/MM/YYYY')), v_link,
                       jsonb_build_object('task_id', k.id));
      END LOOP;
      UPDATE team_tasks SET reminded_at = p_now WHERE id = k.id;
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN v_n;
END $$;

-- =====================================================================
-- Riepilogo di chi supervisiona (worker, mattino dei giorni feriali). Una riga per chi ha dato ad ALTRI task
-- ancora aperti o completati dall'ultimo riepilogo, con email attive e riepilogo non spento, e non già servito
-- nelle ultime 20 ore. tasks = stato di ciascun task con i movimenti delle persone assegnate da "since".
-- =====================================================================
CREATE FUNCTION cde.team_task_supervision(p_now timestamptz DEFAULT now())
RETURNS TABLE (user_id uuid, email text, first_name text, locale text, since timestamptz, tasks jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  WITH sup AS (
    SELECT u.id, u.email, u.first_name, u.locale,
           greatest(coalesce(l.sent_at, p_now - interval '24 hours'), p_now - interval '7 days') AS since
    FROM users u
    LEFT JOIN notification_preferences np ON np.user_id = u.id
    LEFT JOIN team_task_digest_log l ON l.user_id = u.id
    WHERE u.status = 'ACTIVE' AND coalesce(np.email_enabled, true) AND coalesce(np.team_task_digest, true)
      AND (l.sent_at IS NULL OR l.sent_at < p_now - interval '20 hours')
  ), righe AS (
    SELECT s.id AS sup_id, t.*, p.code AS project_code, p.name AS project_name,
           (t.status <> 'DONE' AND t.due_on IS NOT NULL AND t.due_on < cde.local_date(p_now, p.timezone)) AS overdue,
           s.since
    FROM sup s
    JOIN team_tasks t ON t.created_by = s.id AND t.deleted_at IS NULL
    JOIN projects p ON p.id = t.project_id
    WHERE (t.status <> 'DONE' OR t.completed_at > s.since)
      AND is_project_member(s.id, t.project_id)
      AND EXISTS (SELECT 1 FROM team_task_assignees a WHERE a.task_id = t.id AND a.user_id <> s.id)
  )
  SELECT s.id, s.email, s.first_name, s.locale, s.since,
         jsonb_agg(jsonb_build_object(
           'id', r.id, 'project_id', r.project_id, 'project_code', r.project_code, 'project_name', r.project_name,
           'code', team_task_code(r.number), 'title', r.title, 'status', r.status, 'priority', r.priority,
           'due_on', r.due_on, 'overdue', r.overdue, 'completed_at', r.completed_at,
           'completed_by', user_display_name(r.completed_by),
           'assignees', (SELECT string_agg(user_display_name(a.user_id), ', ' ORDER BY a.added_at)
                         FROM team_task_assignees a WHERE a.task_id = r.id),
           'items_done', (SELECT count(*) FROM team_task_items i WHERE i.task_id = r.id AND i.done_at IS NOT NULL),
           'items_total', (SELECT count(*) FROM team_task_items i WHERE i.task_id = r.id),
           'events', coalesce((SELECT jsonb_agg(jsonb_build_object('kind', e.kind, 'data', e.data,
                                                                   'actor', user_display_name(e.actor_id),
                                                                   'at', e.created_at) ORDER BY e.id)
                               FROM team_task_events e
                               WHERE e.task_id = r.id AND e.created_at > r.since
                                 AND (e.actor_id IS NULL OR e.actor_id <> s.id)), '[]'::jsonb)
         ) ORDER BY r.project_code, r.overdue DESC, r.due_on NULLS LAST, r.number)
  FROM sup s JOIN righe r ON r.sup_id = s.id
  GROUP BY s.id, s.email, s.first_name, s.locale, s.since
$$;

CREATE FUNCTION cde.team_task_digest_sent(p_user uuid, p_at timestamptz) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  INSERT INTO team_task_digest_log (user_id, sent_at) VALUES (p_user, p_at)
  ON CONFLICT (user_id) DO UPDATE SET sent_at = EXCLUDED.sent_at
$$;

-- =====================================================================
-- RLS e privilegi: l'API legge (sotto RLS) e scrive solo attraverso le funzioni qui sopra
-- =====================================================================
ALTER TABLE cde.discussions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE cde.discussion_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE cde.discussion_messages     ENABLE ROW LEVEL SECURITY;
ALTER TABLE cde.team_tasks              ENABLE ROW LEVEL SECURITY;
ALTER TABLE cde.team_task_assignees     ENABLE ROW LEVEL SECURITY;
ALTER TABLE cde.team_task_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE cde.team_task_comments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE cde.team_task_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE cde.team_task_digest_log    ENABLE ROW LEVEL SECURITY;

CREATE POLICY discussions_select ON cde.discussions FOR SELECT TO cde_app USING (cde.discussion_participant(id));
CREATE POLICY discussion_participants_select ON cde.discussion_participants FOR SELECT TO cde_app
  USING (cde.discussion_participant(discussion_id));
CREATE POLICY discussion_messages_select ON cde.discussion_messages FOR SELECT TO cde_app
  USING (cde.discussion_participant(discussion_id));
CREATE POLICY team_tasks_select ON cde.team_tasks FOR SELECT TO cde_app USING (cde.team_task_visible(id));
CREATE POLICY team_task_assignees_select ON cde.team_task_assignees FOR SELECT TO cde_app
  USING (cde.team_task_visible(task_id));
CREATE POLICY team_task_items_select ON cde.team_task_items FOR SELECT TO cde_app USING (cde.team_task_visible(task_id));
CREATE POLICY team_task_comments_select ON cde.team_task_comments FOR SELECT TO cde_app
  USING (cde.team_task_visible(task_id));
CREATE POLICY team_task_events_select ON cde.team_task_events FOR SELECT TO cde_app USING (cde.team_task_visible(task_id));
-- team_task_digest_log: nessuna policy, la scrive solo cde.team_task_digest_sent (worker)

REVOKE ALL ON cde.discussions, cde.discussion_participants, cde.discussion_messages, cde.team_tasks,
              cde.team_task_assignees, cde.team_task_items, cde.team_task_comments, cde.team_task_events,
              cde.team_task_digest_log FROM PUBLIC;
GRANT SELECT ON cde.discussions, cde.discussion_participants, cde.discussion_messages, cde.team_tasks,
                cde.team_task_assignees, cde.team_task_items, cde.team_task_comments, cde.team_task_events TO cde_app;
GRANT UPDATE (team_task_digest) ON cde.notification_preferences TO cde_app;

REVOKE ALL ON FUNCTION cde.user_display_name(uuid), cde.team_task_log(uuid, text, jsonb),
                       cde.notify_once(uuid, uuid, text, text, uuid, text, text, text),
                       cde.team_task_deadlines(timestamptz), cde.team_task_supervision(timestamptz),
                       cde.team_task_digest_sent(uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION cde.discussion_participant(uuid), cde.team_task_visible(uuid),
                       cde.discussion_create(uuid, text, text, uuid[], uuid[]), cde.discussion_post(uuid, text, uuid[]),
                       cde.discussion_update(uuid, text, uuid[]), cde.discussion_leave(uuid),
                       cde.discussion_set_closed(uuid, boolean), cde.discussion_mark_read(uuid),
                       cde.team_task_create(uuid, text, text, text, date, uuid[], text[], uuid, uuid),
                       cde.team_task_update(uuid, jsonb), cde.team_task_delete(uuid),
                       cde.team_task_item_add(uuid, text), cde.team_task_item_set(uuid, boolean, text),
                       cde.team_task_item_delete(uuid), cde.team_task_comment(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cde.discussion_participant(uuid), cde.team_task_visible(uuid), cde.team_task_code(integer),
                          cde.discussion_create(uuid, text, text, uuid[], uuid[]), cde.discussion_post(uuid, text, uuid[]),
                          cde.discussion_update(uuid, text, uuid[]), cde.discussion_leave(uuid),
                          cde.discussion_set_closed(uuid, boolean), cde.discussion_mark_read(uuid),
                          cde.team_task_create(uuid, text, text, text, date, uuid[], text[], uuid, uuid),
                          cde.team_task_update(uuid, jsonb), cde.team_task_delete(uuid),
                          cde.team_task_item_add(uuid, text), cde.team_task_item_set(uuid, boolean, text),
                          cde.team_task_item_delete(uuid), cde.team_task_comment(uuid, text) TO cde_app;
GRANT EXECUTE ON FUNCTION cde.team_task_deadlines(timestamptz), cde.team_task_supervision(timestamptz),
                          cde.team_task_digest_sent(uuid, timestamptz), cde.team_task_code(integer) TO cde_worker;
