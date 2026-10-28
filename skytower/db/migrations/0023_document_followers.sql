-- "><(((º> sabusabu <º)))><"
-- depends: 0022_org_security_log
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0023
-- "Segui documento": chi segue un documento riceve una notifica (in-app e, secondo le preferenze, email) a
-- ogni nuova revisione verificata e a ogni cambio di stato. La notifica parte solo se il follower vede
-- quella revisione con i permessi che ha in quel momento: seguire un documento non apre nulla in più
-- (es. una nuova WIP dell'originatore resta invisibile agli altri finché non è condivisa).
-- =====================================================================

CREATE TABLE cde.document_followers (
  user_id      uuid        NOT NULL REFERENCES cde.users (id) ON DELETE CASCADE,
  document_id  uuid        NOT NULL REFERENCES cde.documents (id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, document_id)
);
CREATE INDEX ix_followers_document ON cde.document_followers (document_id);

ALTER TABLE cde.document_followers ENABLE ROW LEVEL SECURITY;
CREATE POLICY followers_own ON cde.document_followers FOR ALL TO cde_app
  USING (user_id = cde.current_app_user())
  WITH CHECK (user_id = cde.current_app_user()
              AND EXISTS (SELECT 1 FROM cde.documents d WHERE d.id = document_id));   -- RLS dei documenti: solo se visibile
GRANT SELECT, INSERT, DELETE ON cde.document_followers TO cde_app;

-- Notifica ai follower di una revisione, valutando la visibilità come ciascuno di loro.
CREATE FUNCTION cde.notify_followers(p_revision uuid, p_event text, p_actor uuid, p_state text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  r document_revisions%ROWTYPE;
  d documents%ROWTYPE;
  f record;
  v_prev text := current_setting('app.user_id', true);
  v_sent integer := 0;
  v_title text;
  v_body text;
  v_state text;
BEGIN
  SELECT * INTO r FROM document_revisions WHERE id = p_revision;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  SELECT * INTO d FROM documents WHERE id = r.document_id;
  v_state := coalesce(p_state, r.state::text);         -- l'archiviazione non crea una revisione nuova
  IF p_event = 'NEW_REVISION' THEN
    v_title := format('Nuova revisione %s: %s', r.revision_code, d.identifier);
    v_body := format('"%s" ha una nuova revisione %s (%s).', d.title, r.revision_code, r.state);
  ELSE
    v_title := format('%s: %s', CASE v_state WHEN 'SHARED' THEN 'Condiviso' WHEN 'PUBLISHED' THEN 'Pubblicato'
                                             WHEN 'ARCHIVED' THEN 'Archiviato' ELSE v_state END, d.identifier);
    v_body := format('"%s" è passato a %s con la revisione %s.', d.title, v_state, r.revision_code);
  END IF;
  FOR f IN SELECT user_id FROM document_followers WHERE document_id = r.document_id
           AND user_id IS DISTINCT FROM p_actor LOOP
    PERFORM set_config('app.user_id', f.user_id::text, true);
    IF revision_visible_to_me(r) THEN
      PERFORM notify(f.user_id, r.project_id, 'DOCUMENT_FOLLOWED', v_title, v_body,
                     format('/progetti/%s/documenti?doc=%s', r.project_id, d.id),
                     jsonb_build_object('document_id', d.id, 'revision_id', r.id, 'event', p_event));
      v_sent := v_sent + 1;
    END IF;
  END LOOP;
  PERFORM set_config('app.user_id', coalesce(v_prev, ''), true);
  RETURN v_sent;
END $$;

-- Dal worker: dopo la verifica di un file (nuova revisione) e dopo un cambio di stato
CREATE FUNCTION cde.notify_followers_of_file(p_file uuid) RETURNS integer
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT coalesce((SELECT notify_followers(r.id, 'NEW_REVISION', r.created_by)
                   FROM document_revisions r WHERE r.file_object_id = p_file), 0)
$$;

CREATE FUNCTION cde.notify_followers_of_transition(p_revision uuid, p_to_state text) RETURNS integer
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT notify_followers(p_revision, 'STATE_CHANGED',
                          (SELECT changed_by FROM state_change_log
                           WHERE to_revision_id = p_revision OR (from_revision_id = p_revision AND to_revision_id IS NULL)
                           ORDER BY changed_at DESC LIMIT 1), p_to_state)
$$;

REVOKE ALL ON FUNCTION cde.notify_followers(uuid, text, uuid, text), cde.notify_followers_of_file(uuid),
                       cde.notify_followers_of_transition(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cde.notify_followers_of_file(uuid), cde.notify_followers_of_transition(uuid, text) TO cde_worker;
