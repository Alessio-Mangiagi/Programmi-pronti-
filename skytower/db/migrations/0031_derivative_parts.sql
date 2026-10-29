-- "><(((º> sabusabu <º)))><"
-- depends: 0030_naming_inherit
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0031
-- Derivato IFC diviso per piano (ADR-36): storage_key resta l'indice (albero e proprietà), parts elenca un .glb
-- per piano in ordine di quota: [{"name", "key", "version", "size_bytes", "elements"}]. NULL = derivato in un
-- solo file (quelli fatti prima di questa migrazione), che il viewer continua ad aprire.
-- =====================================================================

ALTER TABLE cde.file_derivatives ADD COLUMN parts jsonb CHECK (parts IS NULL OR jsonb_typeof(parts) = 'array');

DROP FUNCTION cde.derivative_done(uuid, boolean, text, text, bigint, text);
CREATE FUNCTION cde.derivative_done(p_file uuid, p_ok boolean, p_key text, p_version text, p_size bigint, p_detail text,
                                    p_parts jsonb DEFAULT NULL)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  UPDATE file_derivatives
  SET status = CASE WHEN p_ok THEN 'READY' WHEN attempts >= 3 THEN 'FAILED' ELSE 'PENDING' END,
      storage_key = CASE WHEN p_ok THEN p_key END, storage_version_id = CASE WHEN p_ok THEN p_version END,
      size_bytes = CASE WHEN p_ok THEN p_size END, parts = CASE WHEN p_ok THEN p_parts END,
      detail = left(p_detail, 500), updated_at = now()
  WHERE file_object_id = p_file AND kind = 'GLB'
$$;
REVOKE ALL ON FUNCTION cde.derivative_done(uuid, boolean, text, text, bigint, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cde.derivative_done(uuid, boolean, text, text, bigint, text, jsonb) TO cde_worker;
