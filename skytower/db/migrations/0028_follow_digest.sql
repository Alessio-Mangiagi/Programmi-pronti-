-- "><(((º> sabusabu <º)))><"
-- depends: 0027_ifc_derivatives
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0028
-- "Segui documento" nel riepilogo giornaliero: gli avvisi sui documenti seguiti (nuova revisione, cambio di
-- stato) possono essere molti; chi lo sceglie li riceve per email solo nel riepilogo del mattino, mentre
-- compiti, RFI e transmittal restano immediati. Predefinito: attivo.
-- =====================================================================

ALTER TABLE cde.notification_preferences ADD COLUMN follow_digest boolean NOT NULL DEFAULT true;
GRANT UPDATE (follow_digest) ON cde.notification_preferences TO cde_app;

CREATE OR REPLACE FUNCTION cde.notify(p_user uuid, p_project uuid, p_kind text, p_title text, p_body text,
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
  IF coalesce(v_pref.email_enabled, true) AND NOT coalesce(v_pref.daily_digest, false)
     AND NOT (p_kind = 'DOCUMENT_FOLLOWED' AND coalesce(v_pref.follow_digest, true)) THEN
    PERFORM enqueue_job('cde.send_notification_email', jsonb_build_object('notification_id', v_id));
  END IF;
  PERFORM pg_notify('cde_notifications', p_user::text);
  RETURN v_id;
END $$;
