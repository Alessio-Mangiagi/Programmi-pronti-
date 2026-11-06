-- "><(((º> sabusabu <º)))><"
-- depends: 0043_modelli_commessa
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0044
-- PDF firmati digitalmente in busta .p7m (CAdES), ADR-55. La revisione conserva il .p7m originale (è lui ad avere
-- valore legale); dopo la verifica antivirus il worker apre la busta con il motore comune della suite
-- (shared/firma), mette il documento contenuto (di solito il PDF) in un derivato come i .glb degli IFC (0027) e
-- gli SVG dei disegni (0035) e salva il rapporto della verifica della firma (esito, firmatari, ente, marca
-- temporale, motivi) nella colonna nuova `firma` (`parts` resta un elenco: piani dei .glb, layer degli SVG).
-- Visualizzatore, ricerca nel testo, annotazioni, confronto e verifica requisiti lavorano sul derivato.
-- Nuovo `kind` P7M, tre funzioni gemelle per il worker, una per riprendere le buste rimaste senza verifica
-- quando il motore non era installato, e l'aggiornamento del rapporto dall'API ("Verifica di nuovo"): solo
-- `firma`, `detail` e `updated_at`, solo sui derivati P7M dei file che l'utente vede (RLS).
-- =====================================================================

ALTER TABLE cde.file_derivatives DROP CONSTRAINT file_derivatives_kind_check;
ALTER TABLE cde.file_derivatives ADD CONSTRAINT file_derivatives_kind_check CHECK (kind IN ('GLB', 'SVG', 'P7M'));
-- rapporto della verifica della firma (JSON di shared/firma: `firma.py apri`), solo per i derivati P7M
ALTER TABLE cde.file_derivatives ADD COLUMN firma jsonb
  CHECK (firma IS NULL OR (kind = 'P7M' AND jsonb_typeof(firma) = 'object'));

-- Chiede il derivato P7M per un file verificato se è una busta firmata (nome della revisione .p7m).
CREATE FUNCTION cde.derivative_request_p7m(p_file uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
      SELECT 1 FROM file_objects f
      WHERE f.id = p_file AND f.scan_status = 'CLEAN'
        AND EXISTS (SELECT 1 FROM document_revisions r WHERE r.file_object_id = f.id
                    AND r.original_filename ILIKE '%.p7m')) THEN
    RETURN false;
  END IF;
  INSERT INTO file_derivatives (file_object_id, kind) VALUES (p_file, 'P7M') ON CONFLICT DO NOTHING;
  RETURN true;
END $$;

-- Prende in carico le buste da aprire (nuove, o rimaste a metà da più di p_stale), con il nome del file.
CREATE FUNCTION cde.derivatives_claim_p7m(p_limit integer, p_stale interval)
RETURNS TABLE (file_id uuid, project_id uuid, storage_key text, storage_version_id text, size_bytes bigint,
               attempts integer, filename text)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  WITH picked AS (
    SELECT d.file_object_id FROM file_derivatives d
    WHERE d.kind = 'P7M' AND d.status = 'PENDING' AND d.attempts < 3 AND (d.attempts = 0 OR d.updated_at < now() - p_stale)
    ORDER BY d.created_at LIMIT p_limit FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE file_derivatives d SET attempts = d.attempts + 1, updated_at = now()
    FROM picked WHERE d.file_object_id = picked.file_object_id AND d.kind = 'P7M'
    RETURNING d.file_object_id, d.attempts
  )
  SELECT f.id, f.project_id, f.storage_key, f.storage_version_id, f.size_bytes, c.attempts,
         (SELECT r.original_filename FROM document_revisions r WHERE r.file_object_id = f.id ORDER BY r.created_at LIMIT 1)
  FROM claimed c JOIN file_objects f ON f.id = c.file_object_id
$$;

-- Esito: busta aperta (chiave S3 del documento contenuto, dimensione, riepilogo in detail, rapporto in p_report)
-- oppure errore. p_final = FAILED subito (busta illeggibile, file troppo grande, motore non installato): ritentare
-- darebbe lo stesso esito. Il rapporto resta anche sugli errori (es. busta illeggibile → esito "non valida").
CREATE FUNCTION cde.derivative_done_p7m(p_file uuid, p_ok boolean, p_key text, p_version text, p_size bigint,
                                        p_detail text, p_report jsonb, p_final boolean DEFAULT false)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  UPDATE file_derivatives
  SET status = CASE WHEN p_ok THEN 'READY' WHEN p_final OR attempts >= 3 THEN 'FAILED' ELSE 'PENDING' END,
      storage_key = CASE WHEN p_ok THEN p_key END, storage_version_id = CASE WHEN p_ok THEN p_version END,
      size_bytes = CASE WHEN p_ok THEN p_size END, firma = coalesce(p_report, firma),
      detail = left(p_detail, 500), updated_at = now()
  WHERE file_object_id = p_file AND kind = 'P7M'
$$;

-- Motore della firma installato dopo il caricamento: le buste fermate per "motore non installato" ripartono.
CREATE FUNCTION cde.derivatives_retry_p7m_motore() RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  v_n integer;
BEGIN
  UPDATE file_derivatives SET status = 'PENDING', attempts = 0, detail = NULL, updated_at = now()
  WHERE kind = 'P7M' AND status = 'FAILED' AND detail LIKE 'FirmaNonInstallata%';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

REVOKE ALL ON FUNCTION cde.derivative_request_p7m(uuid), cde.derivatives_claim_p7m(integer, interval),
                       cde.derivative_done_p7m(uuid, boolean, text, text, bigint, text, jsonb, boolean),
                       cde.derivatives_retry_p7m_motore() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cde.derivative_request_p7m(uuid), cde.derivatives_claim_p7m(integer, interval),
                          cde.derivative_done_p7m(uuid, boolean, text, text, bigint, text, jsonb, boolean),
                          cde.derivatives_retry_p7m_motore() TO cde_worker;

-- "Verifica di nuovo" dall'API: aggiorna solo il rapporto della firma, solo sui derivati P7M dei file che
-- l'utente vede (stessa visibilità della SELECT di 0027). Niente chiavi S3 né stato: quelli li scrive il worker.
GRANT UPDATE (firma, detail, updated_at) ON cde.file_derivatives TO cde_app;
CREATE POLICY derivatives_firma_update ON cde.file_derivatives FOR UPDATE TO cde_app
  USING (kind = 'P7M' AND file_object_id IN (SELECT id FROM cde.file_objects))
  WITH CHECK (kind = 'P7M');
