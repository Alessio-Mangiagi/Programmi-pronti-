-- "><(((º> sabusabu <º)))><"
-- depends: 0021_sso_oidc
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0022
-- Registro di sicurezza dell'organizzazione: l'admin vede accessi, tentativi falliti, MFA, single sign-on e
-- modifiche agli utenti della propria organizzazione. Solo eventi senza commessa (project_id NULL): quello
-- che i suoi utenti fanno nelle commesse resta nel registro di ciascuna commessa, riservato al Project Admin.
-- =====================================================================

CREATE FUNCTION cde.org_security_events(p_org uuid, p_type text DEFAULT NULL, p_limit integer DEFAULT 200,
                                        p_before bigint DEFAULT NULL)
RETURNS TABLE (id bigint, occurred_at timestamptz, event_type text, user_id uuid, user_name text, email text,
               ip text, user_agent text, details jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
BEGIN
  IF NOT can_manage_org(p_org) THEN
    RAISE EXCEPTION 'Riservato agli amministratori dell''organizzazione' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT e.id, e.occurred_at, e.event_type, e.user_id, u.first_name || ' ' || u.last_name, u.email,
           host(e.ip), e.user_agent, e.details
    FROM security_events e
    LEFT JOIN users u ON u.id = e.user_id
    WHERE e.project_id IS NULL
      AND (e.organization_id = p_org OR u.organization_id = p_org)
      AND (p_type IS NULL OR e.event_type = p_type)
      AND (p_before IS NULL OR e.id < p_before)
    ORDER BY e.id DESC
    LIMIT least(greatest(p_limit, 1), 1000);
END $$;

REVOKE ALL ON FUNCTION cde.org_security_events(uuid, text, integer, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cde.org_security_events(uuid, text, integer, bigint) TO cde_app;
