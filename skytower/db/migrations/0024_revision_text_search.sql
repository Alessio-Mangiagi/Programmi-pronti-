-- "><(((º> sabusabu <º)))><"
-- depends: 0023_document_followers
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0024
-- Ricerca nel contenuto dei file: il worker estrae il testo (PDF, Word, Excel, testo) dopo la verifica antivirus
-- e lo indicizza in italiano. Il testo di una revisione si trova solo se quella revisione è visibile a chi cerca
-- (RLS: stessa regola di document_revisions), quindi la ricerca non rivela il contenuto di WIP altrui o di aree
-- riservate. Testo vuoto = formato non estraibile (non si riprova a ogni giro).
-- =====================================================================

CREATE TABLE cde.revision_text (
  revision_id  uuid PRIMARY KEY REFERENCES cde.document_revisions (id),
  document_id  uuid        NOT NULL REFERENCES cde.documents (id),
  project_id   uuid        NOT NULL REFERENCES cde.projects (id),
  body         text        NOT NULL,
  content      tsvector    GENERATED ALWAYS AS (to_tsvector('italian', body)) STORED,
  extracted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_revision_text_content ON cde.revision_text USING gin (content);
CREATE INDEX ix_revision_text_document ON cde.revision_text (document_id);

ALTER TABLE cde.revision_text ENABLE ROW LEVEL SECURITY;
CREATE POLICY revision_text_visible ON cde.revision_text FOR SELECT TO cde_app
  USING (EXISTS (SELECT 1 FROM cde.document_revisions r WHERE r.id = revision_id));   -- RLS delle revisioni
GRANT SELECT ON cde.revision_text TO cde_app;

-- Le revisioni SHARED/PUBLISHED riusano il file della WIP: il testo si copia, senza riscaricare il file
CREATE FUNCTION cde.text_copy_siblings(p_document uuid DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  v_n integer;
BEGIN
  INSERT INTO revision_text (revision_id, document_id, project_id, body)
  SELECT DISTINCT ON (r.id) r.id, r.document_id, r.project_id, t.body
  FROM document_revisions r
  JOIN document_revisions s ON s.file_object_id = r.file_object_id AND s.id <> r.id
  JOIN revision_text t ON t.revision_id = s.id
  WHERE (p_document IS NULL OR r.document_id = p_document)
    AND NOT EXISTS (SELECT 1 FROM revision_text x WHERE x.revision_id = r.id)
  ON CONFLICT (revision_id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- File verificati ancora senza testo (nuovi caricamenti persi dal worker e quelli di prima di questa migrazione)
CREATE FUNCTION cde.text_extraction_pending(p_limit integer DEFAULT 20)
RETURNS TABLE (file_id uuid, storage_key text, storage_version_id text, size_bytes bigint, filename text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT * FROM (
    SELECT DISTINCT ON (f.id) f.id, f.storage_key, f.storage_version_id, f.size_bytes, r.original_filename
    FROM document_revisions r JOIN file_objects f ON f.id = r.file_object_id
    WHERE f.scan_status = 'CLEAN' AND f.sha256_verified
      AND NOT EXISTS (SELECT 1 FROM document_revisions s JOIN revision_text t ON t.revision_id = s.id
                      WHERE s.file_object_id = f.id)
    ORDER BY f.id, r.created_at) x
  LIMIT least(greatest(p_limit, 1), 200)
$$;

CREATE FUNCTION cde.text_extraction_file(p_file uuid)
RETURNS TABLE (file_id uuid, storage_key text, storage_version_id text, size_bytes bigint, filename text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT f.id, f.storage_key, f.storage_version_id, f.size_bytes, r.original_filename
  FROM document_revisions r JOIN file_objects f ON f.id = r.file_object_id
  WHERE f.id = p_file AND f.scan_status = 'CLEAN'
  ORDER BY r.created_at LIMIT 1
$$;

CREATE FUNCTION cde.store_revision_text(p_file uuid, p_body text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
BEGIN
  INSERT INTO revision_text (revision_id, document_id, project_id, body)
  SELECT r.id, r.document_id, r.project_id, left(coalesce(p_body, ''), 300000)
  FROM document_revisions r WHERE r.file_object_id = p_file
  ON CONFLICT (revision_id) DO UPDATE SET body = EXCLUDED.body, extracted_at = now();
  RETURN FOUND;
END $$;

REVOKE ALL ON FUNCTION cde.text_copy_siblings(uuid), cde.text_extraction_pending(integer), cde.text_extraction_file(uuid),
                       cde.store_revision_text(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cde.text_copy_siblings(uuid), cde.text_extraction_pending(integer), cde.text_extraction_file(uuid),
                          cde.store_revision_text(uuid, text) TO cde_worker;
