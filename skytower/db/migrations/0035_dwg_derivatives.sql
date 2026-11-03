-- "><(((º> sabusabu <º)))><"
-- depends: 0034_suite_portale
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0035
-- Viewer DWG senza licenza (G44, ADR-41): per i disegni CAD (.dwg, .dxf) il worker prepara un derivato SVG
-- (DWG → DXF con ODA File Converter, DXF → SVG con ezdxf) con un gruppo per layer. Stessa tabella dei
-- derivati .glb degli IFC (0027): nuovo `kind` SVG, senza soglia di dimensione (un DWG è sempre da
-- convertire: il browser non lo apre). In `parts` finisce l'elenco dei layer (nome, colore, visibile, entità).
-- Le funzioni del worker esistenti restano legate a GLB: qui ce ne sono tre gemelle per SVG, e la presa in
-- carico della divisione per piano (0033) viene limitata ai GLB, che prima prendeva qualunque kind.
-- =====================================================================

ALTER TABLE cde.file_derivatives DROP CONSTRAINT file_derivatives_kind_check;
ALTER TABLE cde.file_derivatives ADD CONSTRAINT file_derivatives_kind_check CHECK (kind IN ('GLB', 'SVG'));

-- Chiede il derivato SVG per un file verificato se è un disegno CAD (nome della revisione .dwg o .dxf).
CREATE FUNCTION cde.derivative_request_svg(p_file uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
      SELECT 1 FROM file_objects f
      WHERE f.id = p_file AND f.scan_status = 'CLEAN'
        AND EXISTS (SELECT 1 FROM document_revisions r WHERE r.file_object_id = f.id
                    AND (r.original_filename ILIKE '%.dwg' OR r.original_filename ILIKE '%.dxf'))) THEN
    RETURN false;
  END IF;
  INSERT INTO file_derivatives (file_object_id, kind) VALUES (p_file, 'SVG') ON CONFLICT DO NOTHING;
  RETURN true;
END $$;

-- Prende in carico i derivati SVG da fare (nuovi, o rimasti a metà da più di p_stale), con il nome del file
-- (serve a sapere se è un DWG da convertire prima o un DXF).
CREATE FUNCTION cde.derivatives_claim_svg(p_limit integer, p_stale interval)
RETURNS TABLE (file_id uuid, project_id uuid, storage_key text, storage_version_id text, size_bytes bigint,
               attempts integer, filename text)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  WITH picked AS (
    SELECT d.file_object_id FROM file_derivatives d
    WHERE d.kind = 'SVG' AND d.status = 'PENDING' AND d.attempts < 3 AND (d.attempts = 0 OR d.updated_at < now() - p_stale)
    ORDER BY d.created_at LIMIT p_limit FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE file_derivatives d SET attempts = d.attempts + 1, updated_at = now()
    FROM picked WHERE d.file_object_id = picked.file_object_id AND d.kind = 'SVG'
    RETURNING d.file_object_id, d.attempts
  )
  SELECT f.id, f.project_id, f.storage_key, f.storage_version_id, f.size_bytes, c.attempts,
         (SELECT r.original_filename FROM document_revisions r WHERE r.file_object_id = f.id ORDER BY r.created_at LIMIT 1)
  FROM claimed c JOIN file_objects f ON f.id = c.file_object_id
$$;

-- Esito della conversione: pronto (con chiave S3, dimensione e layer in p_layers) oppure errore (dopo tre
-- tentativi resta FAILED e il viewer propone il download).
CREATE FUNCTION cde.derivative_done_svg(p_file uuid, p_ok boolean, p_key text, p_version text, p_size bigint,
                                        p_detail text, p_layers jsonb)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  UPDATE file_derivatives
  SET status = CASE WHEN p_ok THEN 'READY' WHEN attempts >= 3 THEN 'FAILED' ELSE 'PENDING' END,
      storage_key = CASE WHEN p_ok THEN p_key END, storage_version_id = CASE WHEN p_ok THEN p_version END,
      size_bytes = CASE WHEN p_ok THEN p_size END, parts = CASE WHEN p_ok THEN p_layers END,
      detail = left(p_detail, 500), updated_at = now()
  WHERE file_object_id = p_file AND kind = 'SVG'
$$;

-- La divisione per piano riguarda solo i GLB: prima la selezione non guardava il kind (l'UPDATE sì, quindi
-- non faceva danni, ma ripeteva il tentativo a ogni giro sui derivati SVG).
CREATE OR REPLACE FUNCTION cde.derivatives_split_claim(p_limit integer)
RETURNS TABLE (file_id uuid, project_id uuid, storage_key text, storage_version_id text, size_bytes bigint, attempts integer)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  WITH picked AS (
    SELECT d.file_object_id FROM file_derivatives d
    WHERE d.kind = 'GLB' AND d.status = 'READY' AND d.parts IS NULL AND d.attempts < 3
    ORDER BY d.updated_at LIMIT p_limit FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE file_derivatives d SET attempts = d.attempts + 1
    FROM picked WHERE d.file_object_id = picked.file_object_id AND d.kind = 'GLB'
    RETURNING d.file_object_id, d.attempts
  )
  SELECT f.id, f.project_id, f.storage_key, f.storage_version_id, f.size_bytes, c.attempts
  FROM claimed c JOIN file_objects f ON f.id = c.file_object_id
$$;

REVOKE ALL ON FUNCTION cde.derivative_request_svg(uuid), cde.derivatives_claim_svg(integer, interval),
                       cde.derivative_done_svg(uuid, boolean, text, text, bigint, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cde.derivative_request_svg(uuid), cde.derivatives_claim_svg(integer, interval),
                          cde.derivative_done_svg(uuid, boolean, text, text, bigint, text, jsonb) TO cde_worker;
