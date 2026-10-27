-- "><(((º> sabusabu <º)))><"
-- depends: 0007_workflow_notifications_rfi
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0008
-- Profilo personale modificabile dall'utente stesso (menu del logo in alto): nome, cognome,
-- telefono, qualifica. La policy users_update resta riservata agli admin: l'utente passa da una
-- funzione SECURITY DEFINER che tocca solo la propria riga e solo queste colonne.
-- =====================================================================

ALTER TABLE cde.users
  ADD COLUMN phone     text CHECK (phone IS NULL OR phone ~ '^\+?[0-9 ./()-]{5,30}$'),
  ADD COLUMN job_title text CHECK (job_title IS NULL OR length(btrim(job_title)) BETWEEN 1 AND 120);

CREATE FUNCTION cde.update_my_profile(p_first_name text, p_last_name text, p_phone text, p_job_title text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
BEGIN
  IF current_app_user() IS NULL THEN
    RAISE EXCEPTION 'Utente non autenticato' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_first_name, ''))) NOT BETWEEN 1 AND 100
     OR length(btrim(coalesce(p_last_name, ''))) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Nome e cognome sono obbligatori' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE users
     SET first_name = btrim(p_first_name),
         last_name  = btrim(p_last_name),
         phone      = nullif(btrim(p_phone), ''),
         job_title  = nullif(btrim(p_job_title), '')
   WHERE id = current_app_user() AND status = 'ACTIVE';
END $$;

GRANT SELECT (phone, job_title) ON cde.users TO cde_app;
REVOKE ALL ON FUNCTION cde.update_my_profile(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cde.update_my_profile(text, text, text, text) TO cde_app;
