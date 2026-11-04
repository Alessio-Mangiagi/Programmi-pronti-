-- "><(((º> sabusabu <º)))><"
-- depends: 0039_workflow_grafo
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0040: falle "basse" della revisione di sicurezza del 03/11/2026 (ADR-49)
--
--   B3  ricerca organizzazione per codice solo per chi può invitare; i conflitti d'invito (email di un altro
--       tenant) restano nel registro ma non nel registro di sicurezza dell'organizzazione che invita.
--   B4  verifica della hash chain del registro: la verifica completa (tutta la catena, tutti i tenant) la fa
--       il worker ogni ora e ne salva l'esito; l'API legge l'esito e controlla solo gli eventi arrivati dopo.
--   B9  dominio email del single sign-on solo se l'organizzazione ha già un utente attivo con quel dominio.
--
-- Tutto additivo: una tabella nuova, funzioni nuove, tre funzioni riscritte con la stessa firma.
-- =====================================================================

-- =====================================================================
-- B3. Ricerca organizzazione per codice
-- =====================================================================
-- Prima bastava essere un utente attivo: con codici di 3-6 caratteri si potevano provare tutti e ricavare la
-- ragione sociale di ogni impresa sulla piattaforma. Ora risponde solo a chi può davvero invitare
-- un'organizzazione in una commessa (o crearne): platform admin, admin di un'organizzazione, Project Admin di
-- almeno una commessa. Gli altri ricevono un insieme vuoto (404 dall'API, come un codice inesistente).
CREATE OR REPLACE FUNCTION cde.lookup_organization(p_code text)
RETURNS TABLE (id uuid, legal_name text, code varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT o.id, o.legal_name, o.code FROM organizations o
  WHERE o.code = upper(p_code) AND o.status = 'ACTIVE' AND current_app_org() IS NOT NULL
    AND (current_app_is_platform_admin() OR current_app_is_org_admin()
         OR EXISTS (SELECT 1 FROM project_memberships pm
                    WHERE pm.user_id = current_app_user()
                      AND has_project_permission(current_app_user(), pm.project_id, 'ADMIN', 'PROJECT')))
$$;

-- L'invito di un'email già registrata in un altro tenant lascia un evento USER_INVITE_CONFLICT: serve al
-- platform admin per vedere chi prova a enumerare le email, ma non deve comparire nel registro di sicurezza
-- dell'organizzazione che invita, altrimenti il suo admin scoprirebbe proprio ciò che la risposta nasconde.
CREATE OR REPLACE FUNCTION cde.org_security_events(p_org uuid, p_type text DEFAULT NULL, p_limit integer DEFAULT 200,
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
      AND e.event_type <> 'USER_INVITE_CONFLICT'
      AND (p_type IS NULL OR e.event_type = p_type)
      AND (p_before IS NULL OR e.id < p_before)
    ORDER BY e.id DESC
    LIMIT least(greatest(p_limit, 1), 1000);
END $$;

-- =====================================================================
-- B4. Verifica della hash chain: esito salvato + controllo incrementale
-- =====================================================================
-- cde.audit_verify() ricalcola l'hash di TUTTI gli eventi di tutti i tenant. Chiamarla a ogni GET
-- /audit/verify e a ogni export permetteva a qualunque Project Admin di tenere occupato il database in un
-- ciclo. Ora:
--   * cde.audit_verify_full(max_age) esegue la verifica completa e ne salva l'esito (una riga). Una sola alla
--     volta (advisory lock non bloccante); con max_age non fa nulla se l'ultimo esito è più recente.
--     La chiama il worker ogni ora e, di ripiego, l'API quando l'esito è troppo vecchio;
--   * cde.audit_verify_latest() parte dall'esito salvato e verifica solo gli eventi sigillati dopo (più la
--     testa già verificata, che deve essere ancora lì identica): costa quanto gli eventi nuovi.
-- Una manomissione di un evento vecchio la scopre la verifica completa successiva (al più un'ora), come
-- già succedeva con le ancore giornaliere.
CREATE TABLE cde.audit_chain_status (
  id                boolean     PRIMARY KEY DEFAULT true CHECK (id),     -- una riga sola
  verified_at       timestamptz NOT NULL,                                -- inizio dell'ultima verifica completa
  checked           bigint      NOT NULL,
  first_broken_seq  bigint,
  head_seq          bigint,
  head_hash         text,
  duration_ms       integer     NOT NULL
);
REVOKE ALL ON cde.audit_chain_status FROM PUBLIC;

CREATE FUNCTION cde.audit_verify_full(p_max_age interval DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  v_t0 timestamptz := clock_timestamp();
  v    record;
BEGIN
  -- un'altra verifica completa è in corso: non se ne accoda una seconda (chi chiama legge l'esito salvato)
  IF NOT pg_try_advisory_xact_lock(hashtext('cde.audit_verify_full')) THEN
    RETURN false;
  END IF;
  IF p_max_age IS NOT NULL AND EXISTS (
       SELECT 1 FROM audit_chain_status WHERE id AND verified_at > clock_timestamp() - p_max_age) THEN
    RETURN false;
  END IF;
  SELECT * INTO v FROM audit_verify();
  INSERT INTO audit_chain_status AS s (id, verified_at, checked, first_broken_seq, head_seq, head_hash, duration_ms)
  VALUES (true, v_t0, v.checked, v.first_broken_seq, v.head_seq, v.head_hash,
          (extract(epoch FROM clock_timestamp() - v_t0) * 1000)::integer)
  ON CONFLICT (id) DO UPDATE SET verified_at = EXCLUDED.verified_at, checked = EXCLUDED.checked,
      first_broken_seq = EXCLUDED.first_broken_seq, head_seq = EXCLUDED.head_seq, head_hash = EXCLUDED.head_hash,
      duration_ms = EXCLUDED.duration_ms;
  RETURN true;
END $$;

CREATE FUNCTION cde.audit_verify_latest()
RETURNS TABLE (checked bigint, first_broken_seq bigint, head_seq bigint, head_hash text, unsealed bigint,
               verified_at timestamptz, verified_seq bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  s        audit_chain_status%ROWTYPE;
  v_e      security_events%ROWTYPE;
  v_prev   bytea;
  v_expect bigint;
BEGIN
  SELECT * INTO s FROM audit_chain_status WHERE id;
  IF NOT FOUND THEN
    RETURN;                                   -- mai verificata: l'API chiede prima audit_verify_full
  END IF;
  checked := s.checked;
  first_broken_seq := s.first_broken_seq;
  head_seq := s.head_seq;
  verified_at := s.verified_at;
  verified_seq := s.head_seq;
  v_prev := decode(s.head_hash, 'hex');       -- NULL se la catena era vuota
  v_expect := coalesce(s.head_seq, 0) + 1;
  -- la testa verificata deve essere ancora quella (stesso hash salvato e contenuto che lo riproduce): chi la
  -- tocca viene scoperto subito, non al giro dopo del worker
  IF s.head_seq IS NOT NULL AND first_broken_seq IS NULL AND NOT EXISTS (
       SELECT 1 FROM security_events e WHERE e.chain_seq = s.head_seq AND e.hash = v_prev
          AND e.hash = sha256(coalesce(e.prev_hash, '\x'::bytea) || audit_canonical(e))) THEN
    first_broken_seq := s.head_seq;
  END IF;
  -- stessi controlli di audit_verify(), solo sugli eventi sigillati dopo l'ultima verifica completa
  FOR v_e IN SELECT * FROM security_events e WHERE e.chain_seq > coalesce(s.head_seq, 0) ORDER BY e.chain_seq LOOP
    IF first_broken_seq IS NULL AND (
         v_e.chain_seq <> v_expect
      OR v_e.prev_hash IS DISTINCT FROM v_prev
      OR v_e.hash IS DISTINCT FROM sha256(coalesce(v_prev, '\x'::bytea) || audit_canonical(v_e))) THEN
      first_broken_seq := v_e.chain_seq;
    END IF;
    v_prev := v_e.hash;
    v_expect := v_e.chain_seq + 1;
    checked := checked + 1;
    head_seq := v_e.chain_seq;
  END LOOP;
  head_hash := encode(v_prev, 'hex');
  SELECT count(*) INTO unsealed FROM security_events e WHERE e.chain_seq IS NULL;
  RETURN NEXT;
END $$;

REVOKE ALL ON FUNCTION cde.audit_verify_full(interval), cde.audit_verify_latest() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cde.audit_verify_full(interval), cde.audit_verify_latest() TO cde_worker, cde_app;
-- l'API non lancia più la verifica completa senza passare dal lock e dall'età dell'esito
REVOKE EXECUTE ON FUNCTION cde.audit_verify() FROM cde_app;

-- =====================================================================
-- B9. Domini email del single sign-on
-- =====================================================================
-- Il dominio di un IdP decide chi deve entrare con quel single sign-on (e, con enforce, chi non può più usare
-- la password). Un admin poteva registrare il dominio di un'altra impresa prima di lei e bloccarla. Prova di
-- proprietà semplice, senza DNS: l'organizzazione deve avere almeno un utente ATTIVO con email in quel
-- dominio. Vale per i domini nuovi; quelli già registrati restano (il controllo lo fa l'API, modules/sso.py).
CREATE FUNCTION cde.org_has_email_domain(p_org uuid, p_domain text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT can_manage_org(p_org) AND EXISTS (
    SELECT 1 FROM users u
    WHERE u.organization_id = p_org AND u.status = 'ACTIVE'
      AND lower(split_part(u.email, '@', 2)) = lower(p_domain))
$$;
REVOKE ALL ON FUNCTION cde.org_has_email_domain(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cde.org_has_email_domain(uuid, text) TO cde_app;
