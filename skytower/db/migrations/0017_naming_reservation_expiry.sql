-- "><(((º> sabusabu <º)))><"
-- depends: 0016_naming_reservations
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0017
-- Scadenza delle prenotazioni: se il Project Admin imposta auto_number.reservation_days, le prenotazioni
-- non usate da più giorni vengono rilasciate dal worker (job giornaliero). Ogni rilascio automatico
-- finisce nel registro attività della commessa. I numeri rilasciati non tornano disponibili.
-- =====================================================================

CREATE FUNCTION cde.naming_release_expired(p_now timestamptz) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  v_total integer := 0;
  r record;
BEGIN
  FOR r IN
    WITH expired AS (
      UPDATE naming_reservations n SET released_at = p_now
      FROM project_document_settings s
      WHERE s.project_id = n.project_id
        AND (s.auto_number ->> 'reservation_days') ~ '^[1-9]\d{0,3}$'
        AND n.used_at IS NULL AND n.released_at IS NULL
        AND n.created_at < p_now - make_interval(days => (s.auto_number ->> 'reservation_days')::integer)
      RETURNING n.project_id, n.organization_id, n.identifier
    )
    SELECT project_id, organization_id, count(*) AS n, array_agg(identifier ORDER BY identifier) AS ids
    FROM expired GROUP BY project_id, organization_id
  LOOP
    INSERT INTO security_events (event_type, organization_id, project_id, details)
    VALUES ('NAMING_RESERVATIONS_EXPIRED', r.organization_id, r.project_id,
            jsonb_build_object('count', r.n, 'identifiers', to_jsonb(r.ids[1:50])));
    v_total := v_total + r.n;
  END LOOP;
  RETURN v_total;
END $$;

REVOKE ALL ON FUNCTION cde.naming_release_expired(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cde.naming_release_expired(timestamptz) TO cde_worker;
