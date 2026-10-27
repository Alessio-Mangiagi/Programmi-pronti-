-- "><(((º> sabusabu <º)))><"
-- depends: 0009_private_areas
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0010 (Sprint 5, G46–G49)
-- Audit trail legale: gli eventi di security_events (append-only dallo Sprint 1) vengono sigillati in
-- una hash chain: hash = SHA-256(hash precedente || record canonico). Il sigillo lo appone un job
-- (cde.audit_seal) in un solo punto serializzato, così le transazioni dell'API non si contendono
-- un lock globale. Ogni giorno l'hash di testa viene ancorato (cde.audit_anchors).
-- Dopo il sigillo nessuno, nemmeno il proprietario delle tabelle, modifica o cancella un evento:
-- l'unico UPDATE ammesso è l'apposizione del sigillo su un evento non ancora sigillato.
-- =====================================================================

ALTER TABLE cde.security_events
  ADD COLUMN chain_seq  bigint UNIQUE,
  ADD COLUMN prev_hash  bytea,
  ADD COLUMN hash       bytea,
  ADD COLUMN sealed_at  timestamptz;
CREATE INDEX ix_security_events_unsealed ON cde.security_events (id) WHERE chain_seq IS NULL;
CREATE INDEX ix_security_events_project ON cde.security_events (project_id, occurred_at DESC);

-- Rappresentazione canonica di un evento (stabile: jsonb ha ordine delle chiavi normalizzato)
CREATE FUNCTION cde.audit_canonical(e cde.security_events) RETURNS bytea
LANGUAGE sql IMMUTABLE AS $$
  SELECT convert_to(concat_ws('|',
    e.id::text,
    to_char(e.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    e.event_type,
    coalesce(e.user_id::text, ''),
    coalesce(e.organization_id::text, ''),
    coalesce(e.project_id::text, ''),
    coalesce(host(e.ip), ''),
    coalesce(e.user_agent, ''),
    e.details::text,
    e.chain_seq::text), 'UTF8')
$$;

-- Unica modifica ammessa: sigillare un evento non sigillato (nessun altro campo cambia)
CREATE FUNCTION cde.guard_security_event() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.chain_seq IS NULL AND NEW.chain_seq IS NOT NULL
     AND (to_jsonb(NEW) - 'chain_seq' - 'prev_hash' - 'hash' - 'sealed_at')
       = (to_jsonb(OLD) - 'chain_seq' - 'prev_hash' - 'hash' - 'sealed_at') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Registro eventi append-only: % non consentito', TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;

DROP TRIGGER trg_security_events_no_update ON cde.security_events;
CREATE TRIGGER trg_security_events_guard BEFORE UPDATE OR DELETE ON cde.security_events
  FOR EACH ROW EXECUTE FUNCTION cde.guard_security_event();

-- Sigillo: in ordine di id, un solo sigillatore alla volta. Restituisce quanti eventi ha sigillato.
CREATE FUNCTION cde.audit_seal(p_limit integer DEFAULT 5000) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  v_seq  bigint;
  v_prev bytea;
  v_e    security_events%ROWTYPE;
  v_n    integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('cde.audit_seal'));
  SELECT chain_seq, hash INTO v_seq, v_prev FROM security_events
   WHERE chain_seq IS NOT NULL ORDER BY chain_seq DESC LIMIT 1;
  v_seq := coalesce(v_seq, 0);
  FOR v_e IN SELECT * FROM security_events WHERE chain_seq IS NULL ORDER BY id LIMIT p_limit LOOP
    v_seq := v_seq + 1;
    v_e.chain_seq := v_seq;
    v_e.prev_hash := v_prev;
    v_e.hash := sha256(coalesce(v_prev, '\x'::bytea) || audit_canonical(v_e));
    UPDATE security_events SET chain_seq = v_e.chain_seq, prev_hash = v_e.prev_hash, hash = v_e.hash,
                               sealed_at = clock_timestamp()
     WHERE id = v_e.id;
    v_prev := v_e.hash;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

-- Verifica dell'intera catena: ricalcola ogni hash e il collegamento con il precedente
CREATE FUNCTION cde.audit_verify()
RETURNS TABLE (checked bigint, first_broken_seq bigint, head_seq bigint, head_hash text, unsealed bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  v_e      security_events%ROWTYPE;
  v_prev   bytea;
  v_expect bigint := 1;
BEGIN
  checked := 0;
  FOR v_e IN SELECT * FROM security_events WHERE chain_seq IS NOT NULL ORDER BY chain_seq LOOP
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
  SELECT count(*) INTO unsealed FROM security_events WHERE chain_seq IS NULL;
  RETURN NEXT;
END $$;

-- Ancora giornaliera dell'hash di testa (in produzione anche su S3 Object Lock + marca temporale RFC 3161)
CREATE TABLE cde.audit_anchors (
  day         date        PRIMARY KEY,
  chain_seq   bigint      NOT NULL,
  head_hash   bytea       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  tsa_token   bytea
);
CREATE TRIGGER trg_audit_anchors_no_update BEFORE UPDATE OR DELETE ON cde.audit_anchors
  FOR EACH ROW EXECUTE FUNCTION cde.forbid_mutation();
CREATE TRIGGER trg_audit_anchors_no_truncate BEFORE TRUNCATE ON cde.audit_anchors
  FOR EACH STATEMENT EXECUTE FUNCTION cde.forbid_mutation();

CREATE FUNCTION cde.audit_anchor(p_day date DEFAULT (now() AT TIME ZONE 'UTC')::date) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  v_seq bigint;
  v_hash bytea;
BEGIN
  PERFORM audit_seal(1000000);
  SELECT chain_seq, hash INTO v_seq, v_hash FROM security_events
   WHERE chain_seq IS NOT NULL ORDER BY chain_seq DESC LIMIT 1;
  IF v_seq IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO audit_anchors (day, chain_seq, head_hash) VALUES (p_day, v_seq, v_hash)
  ON CONFLICT (day) DO NOTHING;
  RETURN v_seq;
END $$;

-- Registro di una commessa per i suoi Project Admin (filtri facoltativi)
CREATE FUNCTION cde.audit_events(p_project uuid, p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL,
                                 p_user uuid DEFAULT NULL, p_type text DEFAULT NULL, p_object text DEFAULT NULL,
                                 p_limit integer DEFAULT 500, p_before bigint DEFAULT NULL)
RETURNS TABLE (id bigint, occurred_at timestamptz, event_type text, user_id uuid, user_name text,
               organization_code text, ip text, user_agent text, details jsonb, chain_seq bigint, hash text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
BEGIN
  IF NOT has_project_permission(current_app_user(), p_project, 'ADMIN', 'PROJECT') THEN
    RAISE EXCEPTION 'Il registro attività è riservato al Project Admin' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT e.id, e.occurred_at, e.event_type, e.user_id, u.first_name || ' ' || u.last_name, o.code::text,
           host(e.ip), e.user_agent, e.details, e.chain_seq, encode(e.hash, 'hex')
    FROM security_events e
    LEFT JOIN users u ON u.id = e.user_id
    LEFT JOIN organizations o ON o.id = u.organization_id
    WHERE e.project_id = p_project
      AND (p_from IS NULL OR e.occurred_at >= p_from)
      AND (p_to IS NULL OR e.occurred_at < p_to)
      AND (p_user IS NULL OR e.user_id = p_user)
      AND (p_type IS NULL OR e.event_type = p_type)
      AND (p_object IS NULL OR e.details::text LIKE '%' || p_object || '%')
      AND (p_before IS NULL OR e.id < p_before)
    ORDER BY e.id DESC
    LIMIT least(p_limit, 50000);
END $$;

-- Sigillo degli eventi già presenti
SELECT cde.audit_seal(100000000);

REVOKE ALL ON cde.audit_anchors FROM PUBLIC;
REVOKE ALL ON FUNCTION cde.audit_seal(integer), cde.audit_verify(), cde.audit_anchor(date),
                       cde.audit_events(uuid, timestamptz, timestamptz, uuid, text, text, integer, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cde.audit_seal(integer), cde.audit_anchor(date), cde.audit_verify() TO cde_worker;
GRANT EXECUTE ON FUNCTION cde.audit_verify(),
                          cde.audit_events(uuid, timestamptz, timestamptz, uuid, text, text, integer, bigint) TO cde_app;
