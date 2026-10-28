-- "><(((º> sabusabu <º)))><"
-- depends: 0019_webauthn
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0020
-- L'admin di organizzazione vede chi ha l'MFA attiva e può azzerarla a chi ha perso il telefono o la chiave.
-- Le tabelle delle credenziali restano invisibili a cde_app: due funzioni SECURITY DEFINER espongono solo
-- i metodi configurati (mai segreti) e l'azzeramento, con lo stesso perimetro della policy users_update
-- (admin della stessa organizzazione o platform admin). L'azzeramento revoca anche le sessioni aperte:
-- al prossimo accesso l'utente configura di nuovo il secondo fattore, se l'organizzazione lo richiede.
-- =====================================================================

CREATE FUNCTION cde.can_manage_org(p_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT current_app_is_platform_admin() OR (p_org = current_app_org() AND current_app_is_org_admin())
$$;

CREATE FUNCTION cde.org_users_mfa(p_org uuid) RETURNS TABLE (user_id uuid, methods text[], recovery_codes_left integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
BEGIN
  IF NOT can_manage_org(p_org) THEN
    RAISE EXCEPTION 'Riservato agli amministratori dell''organizzazione' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT u.id,
           coalesce((SELECT array_agg(DISTINCT f.method::text ORDER BY f.method::text) FROM user_mfa_factors f
                     WHERE f.user_id = u.id AND f.verified_at IS NOT NULL), '{}'),
           (SELECT count(*)::integer FROM user_recovery_codes r WHERE r.user_id = u.id AND r.used_at IS NULL)
    FROM users u WHERE u.organization_id = p_org;
END $$;

CREATE FUNCTION cde.reset_user_mfa(p_user uuid) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  v_org uuid;
  v_factors integer;
BEGIN
  SELECT organization_id INTO v_org FROM users WHERE id = p_user;
  IF v_org IS NULL OR NOT can_manage_org(v_org) THEN
    RAISE EXCEPTION 'Riservato agli amministratori dell''organizzazione' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_user = current_app_user() THEN
    RAISE EXCEPTION 'Il proprio secondo fattore si gestisce dal profilo' USING ERRCODE = 'check_violation';
  END IF;
  DELETE FROM user_mfa_factors WHERE user_id = p_user;
  GET DIAGNOSTICS v_factors = ROW_COUNT;
  DELETE FROM user_recovery_codes WHERE user_id = p_user;
  DELETE FROM webauthn_challenges WHERE user_id = p_user;
  UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = p_user AND revoked_at IS NULL;
  RETURN v_factors;
END $$;

REVOKE ALL ON FUNCTION cde.can_manage_org(uuid), cde.org_users_mfa(uuid), cde.reset_user_mfa(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cde.can_manage_org(uuid), cde.org_users_mfa(uuid), cde.reset_user_mfa(uuid) TO cde_app;
