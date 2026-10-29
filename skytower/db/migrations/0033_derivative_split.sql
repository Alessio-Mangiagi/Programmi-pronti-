-- "><(((º> sabusabu <º)))><"
-- depends: 0032_project_templates
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0033
-- Derivati in un solo file (fatti prima della 0031) rifatti divisi per piano (ADR-40). Il worker li prende pochi
-- alla volta; finché la nuova conversione non riesce resta valido il derivato intero (stato READY invariato), e un
-- errore non lo cancella: dopo tre tentativi in tutto il file resta com'è.
-- =====================================================================

CREATE FUNCTION cde.derivatives_split_claim(p_limit integer)
RETURNS TABLE (file_id uuid, project_id uuid, storage_key text, storage_version_id text, size_bytes bigint, attempts integer)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  WITH picked AS (
    SELECT d.file_object_id FROM file_derivatives d
    WHERE d.status = 'READY' AND d.parts IS NULL AND d.attempts < 3
    ORDER BY d.updated_at LIMIT p_limit FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE file_derivatives d SET attempts = d.attempts + 1
    FROM picked WHERE d.file_object_id = picked.file_object_id AND d.kind = 'GLB'
    RETURNING d.file_object_id, d.attempts
  )
  SELECT f.id, f.project_id, f.storage_key, f.storage_version_id, f.size_bytes, c.attempts
  FROM claimed c JOIN file_objects f ON f.id = c.file_object_id
$$;

REVOKE ALL ON FUNCTION cde.derivatives_split_claim(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cde.derivatives_split_claim(integer) TO cde_worker;
