-- "><(((º> sabusabu <º)))><"
-- depends: 0028_follow_digest
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0029
-- Ri-OCR dei PDF indicizzati senza OCR (ADR-34): il testo estratto prima dell'OCR (migrazione 0024, o con
-- Tesseract assente) lascia senza testo le pagine scansionate. ocr_at segna i PDF letti con l'OCR attivo; il job
-- periodico rilegge, poco per volta, quelli che ne sono senza. Gli altri formati non ne hanno bisogno.
-- =====================================================================

ALTER TABLE cde.revision_text ADD COLUMN ocr_at timestamptz;

DROP FUNCTION cde.store_revision_text(uuid, text);
CREATE FUNCTION cde.store_revision_text(p_file uuid, p_body text, p_ocr boolean DEFAULT false) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
BEGIN
  INSERT INTO revision_text (revision_id, document_id, project_id, body, ocr_at)
  SELECT r.id, r.document_id, r.project_id, left(coalesce(p_body, ''), 300000), CASE WHEN p_ocr THEN now() END
  FROM document_revisions r WHERE r.file_object_id = p_file
  ON CONFLICT (revision_id) DO UPDATE SET body = EXCLUDED.body, extracted_at = now(), ocr_at = EXCLUDED.ocr_at;
  RETURN FOUND;
END $$;

-- La copia tra revisioni dello stesso file porta anche ocr_at
CREATE OR REPLACE FUNCTION cde.text_copy_siblings(p_document uuid DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  v_n integer;
BEGIN
  INSERT INTO revision_text (revision_id, document_id, project_id, body, ocr_at)
  SELECT DISTINCT ON (r.id) r.id, r.document_id, r.project_id, t.body, t.ocr_at
  FROM document_revisions r
  JOIN document_revisions s ON s.file_object_id = r.file_object_id AND s.id <> r.id
  JOIN revision_text t ON t.revision_id = s.id
  WHERE (p_document IS NULL OR r.document_id = p_document)
    AND NOT EXISTS (SELECT 1 FROM revision_text x WHERE x.revision_id = r.id)
  ON CONFLICT (revision_id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- PDF già indicizzati ma letti senza OCR: i più vecchi prima
CREATE FUNCTION cde.text_ocr_pending(p_limit integer DEFAULT 10)
RETURNS TABLE (file_id uuid, storage_key text, storage_version_id text, size_bytes bigint, filename text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT file_id, storage_key, storage_version_id, size_bytes, filename FROM (
    SELECT DISTINCT ON (f.id) f.id AS file_id, f.storage_key, f.storage_version_id, f.size_bytes,
           r.original_filename AS filename, t.extracted_at
    FROM revision_text t
    JOIN document_revisions r ON r.id = t.revision_id
    JOIN file_objects f ON f.id = r.file_object_id
    WHERE t.ocr_at IS NULL AND f.scan_status = 'CLEAN' AND lower(r.original_filename) LIKE '%.pdf'
    ORDER BY f.id, r.created_at) x
  ORDER BY extracted_at
  LIMIT least(greatest(p_limit, 1), 100)
$$;

-- File non leggibile ora (es. S3 non raggiungibile): in fondo alla coda, i successivi non restano bloccati
CREATE FUNCTION cde.text_ocr_later(p_file uuid) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  UPDATE revision_text t SET extracted_at = now()
  FROM document_revisions r WHERE r.id = t.revision_id AND r.file_object_id = p_file AND t.ocr_at IS NULL
$$;

REVOKE ALL ON FUNCTION cde.store_revision_text(uuid, text, boolean), cde.text_ocr_pending(integer),
                       cde.text_ocr_later(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cde.store_revision_text(uuid, text, boolean), cde.text_ocr_pending(integer),
                          cde.text_ocr_later(uuid) TO cde_worker;
