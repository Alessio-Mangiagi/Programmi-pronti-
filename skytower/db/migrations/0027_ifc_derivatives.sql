-- "><(((º> sabusabu <º)))><"
-- depends: 0026_folder_naming
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0027
-- Derivato per il viewer dei modelli IFC pesanti (G43): dopo la verifica il worker converte l'IFC in glTF
-- binario (.glb) con geometria già triangolata, albero spaziale e proprietà; il browser apre il derivato
-- invece di triangolare l'IFC con web-ifc. L'originale resta il documento: il derivato è solo una vista,
-- legata al file (le revisioni SHARED/PUBLISHED che riusano il file della WIP lo condividono).
-- Il worker lavora solo tramite le funzioni sotto; l'API legge la tabella con la visibilità del file.
-- =====================================================================

CREATE TABLE cde.file_derivatives (
  file_object_id      uuid        NOT NULL REFERENCES cde.file_objects (id),
  kind                text        NOT NULL CHECK (kind IN ('GLB')),
  status              text        NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'READY', 'FAILED')),
  storage_key         text,
  storage_version_id  text,
  size_bytes          bigint,
  detail              text,
  attempts            integer     NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (file_object_id, kind),
  CHECK (status <> 'READY' OR storage_key IS NOT NULL)
);
CREATE INDEX ix_file_derivatives_pending ON cde.file_derivatives (updated_at) WHERE status = 'PENDING';

ALTER TABLE cde.file_derivatives ENABLE ROW LEVEL SECURITY;
CREATE POLICY derivatives_select ON cde.file_derivatives FOR SELECT TO cde_app
  USING (file_object_id IN (SELECT id FROM cde.file_objects));          -- RLS dei file: chi vede il file vede il derivato
GRANT SELECT ON cde.file_derivatives TO cde_app;

-- Chiede il derivato per un file verificato se è un IFC abbastanza grande (soglia decisa dalla configurazione).
CREATE FUNCTION cde.derivative_request(p_file uuid, p_min_bytes bigint) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
      SELECT 1 FROM file_objects f
      WHERE f.id = p_file AND f.scan_status = 'CLEAN' AND f.size_bytes >= p_min_bytes
        AND EXISTS (SELECT 1 FROM document_revisions r WHERE r.file_object_id = f.id AND r.original_filename ILIKE '%.ifc')) THEN
    RETURN false;
  END IF;
  INSERT INTO file_derivatives (file_object_id, kind) VALUES (p_file, 'GLB') ON CONFLICT DO NOTHING;
  RETURN true;
END $$;

-- Prende in carico i derivati da fare: quelli nuovi e quelli rimasti a metà (worker fermato) da più di p_stale.
CREATE FUNCTION cde.derivatives_claim(p_limit integer, p_stale interval)
RETURNS TABLE (file_id uuid, project_id uuid, storage_key text, storage_version_id text, size_bytes bigint, attempts integer)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  WITH picked AS (
    SELECT d.file_object_id FROM file_derivatives d
    WHERE d.status = 'PENDING' AND d.attempts < 3 AND (d.attempts = 0 OR d.updated_at < now() - p_stale)
    ORDER BY d.created_at LIMIT p_limit FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE file_derivatives d SET attempts = d.attempts + 1, updated_at = now()
    FROM picked WHERE d.file_object_id = picked.file_object_id AND d.kind = 'GLB'
    RETURNING d.file_object_id, d.attempts
  )
  SELECT f.id, f.project_id, f.storage_key, f.storage_version_id, f.size_bytes, c.attempts
  FROM claimed c JOIN file_objects f ON f.id = c.file_object_id
$$;

CREATE FUNCTION cde.derivative_done(p_file uuid, p_ok boolean, p_key text, p_version text, p_size bigint, p_detail text)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  UPDATE file_derivatives
  SET status = CASE WHEN p_ok THEN 'READY' WHEN attempts >= 3 THEN 'FAILED' ELSE 'PENDING' END,
      storage_key = CASE WHEN p_ok THEN p_key END, storage_version_id = CASE WHEN p_ok THEN p_version END,
      size_bytes = CASE WHEN p_ok THEN p_size END, detail = left(p_detail, 500), updated_at = now()
  WHERE file_object_id = p_file AND kind = 'GLB'
$$;

REVOKE ALL ON FUNCTION cde.derivative_request(uuid, bigint), cde.derivatives_claim(integer, interval),
                       cde.derivative_done(uuid, boolean, text, text, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cde.derivative_request(uuid, bigint), cde.derivatives_claim(integer, interval),
                          cde.derivative_done(uuid, boolean, text, text, bigint, text) TO cde_worker;
