-- "><(((º> sabusabu <º)))><"
-- depends: 0013_transmittals
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0014 (Sprint 5, G48)
-- Valore legale del registro: ogni ancora giornaliera (cde.audit_anchors) viene copiata dal worker su
-- S3 con Object Lock (WORM: nessuno la cancella o la sovrascrive fino alla scadenza) e, se configurata,
-- marcata temporalmente da una TSA RFC 3161 (in produzione: TSA qualificata eIDAS).
-- La prova resta qui, append-only; la verifica confronta l'hash ancorato con quello attuale della catena
-- e con la copia su S3, così anche chi riscrivesse l'intera catena verrebbe scoperto.
-- =====================================================================

CREATE TABLE cde.audit_anchor_proofs (
  day              date        PRIMARY KEY REFERENCES cde.audit_anchors (day),
  s3_key           text        NOT NULL,
  s3_version_id    text,
  lock_mode        text        NOT NULL CHECK (lock_mode IN ('GOVERNANCE', 'COMPLIANCE')),
  retain_until     timestamptz NOT NULL,
  document_sha256  bytea       NOT NULL CHECK (length(document_sha256) = 32),
  tsa_url          text,
  tsa_token        bytea,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((tsa_url IS NULL) = (tsa_token IS NULL))
);
CREATE TRIGGER trg_audit_anchor_proofs_no_update BEFORE UPDATE OR DELETE ON cde.audit_anchor_proofs
  FOR EACH ROW EXECUTE FUNCTION cde.forbid_mutation();
CREATE TRIGGER trg_audit_anchor_proofs_no_truncate BEFORE TRUNCATE ON cde.audit_anchor_proofs
  FOR EACH STATEMENT EXECUTE FUNCTION cde.forbid_mutation();
REVOKE ALL ON cde.audit_anchor_proofs FROM PUBLIC;

-- Worker: ancore ancora da pubblicare e registrazione della prova
CREATE FUNCTION cde.audit_anchors_pending(p_limit integer DEFAULT 30)
RETURNS TABLE (day date, chain_seq bigint, head_hash text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT a.day, a.chain_seq, encode(a.head_hash, 'hex'), a.created_at
  FROM audit_anchors a
  WHERE NOT EXISTS (SELECT 1 FROM audit_anchor_proofs p WHERE p.day = a.day)
  ORDER BY a.day LIMIT p_limit
$$;

CREATE FUNCTION cde.audit_anchor_proof_add(p_day date, p_key text, p_version text, p_mode text, p_retain timestamptz,
                                           p_sha256 bytea, p_tsa_url text, p_tsa_token bytea) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  INSERT INTO audit_anchor_proofs (day, s3_key, s3_version_id, lock_mode, retain_until, document_sha256, tsa_url, tsa_token)
  VALUES (p_day, p_key, p_version, p_mode, p_retain, p_sha256, p_tsa_url, p_tsa_token)
$$;

-- Verifica (Project Admin via API): ultime ancore, hash ancorato contro hash attuale dell'evento
CREATE FUNCTION cde.audit_anchor_check(p_limit integer DEFAULT 14)
RETURNS TABLE (day date, chain_seq bigint, anchored_hash text, current_hash text, s3_key text, s3_version_id text,
               lock_mode text, retain_until timestamptz, has_tsa boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT a.day, a.chain_seq, encode(a.head_hash, 'hex'), encode(e.hash, 'hex'), p.s3_key, p.s3_version_id,
         p.lock_mode, p.retain_until, p.tsa_token IS NOT NULL
  FROM audit_anchors a
  LEFT JOIN security_events e ON e.chain_seq = a.chain_seq
  LEFT JOIN audit_anchor_proofs p ON p.day = a.day
  ORDER BY a.day DESC LIMIT p_limit
$$;

REVOKE ALL ON FUNCTION cde.audit_anchors_pending(integer),
                       cde.audit_anchor_proof_add(date, text, text, text, timestamptz, bytea, text, bytea),
                       cde.audit_anchor_check(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cde.audit_anchors_pending(integer),
                          cde.audit_anchor_proof_add(date, text, text, text, timestamptz, bytea, text, bytea) TO cde_worker;
GRANT EXECUTE ON FUNCTION cde.audit_anchor_check(integer) TO cde_app;
