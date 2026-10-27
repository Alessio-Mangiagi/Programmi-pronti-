-- "><(((º> sabusabu <º)))><"
-- depends: 0014_audit_anchor_proofs
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0015
-- Rinomina automatica in caricamento: il Project Admin decide il progressivo (campo, inizio, serie)
-- e i valori predefiniti dei campi; chi carica un file con un nome qualsiasi chiede all'API di
-- comporre il nome conforme. Il numero si riserva qui, contando anche i documenti che chi carica non
-- vede (WIP di altre organizzazioni): l'identificativo resta univoco nel progetto.
-- Il nome con cui il file è arrivato resta sulla revisione (source_filename) e nelle sue note.
-- =====================================================================

ALTER TABLE cde.project_document_settings ADD COLUMN auto_number jsonb;
GRANT UPDATE (auto_number) ON cde.project_document_settings TO cde_app;

ALTER TABLE cde.document_revisions
  ADD COLUMN source_filename text CHECK (source_filename IS NULL OR length(source_filename) BETWEEN 1 AND 255);

-- Ultimo numero assegnato per serie. Nessun accesso diretto dall'API: solo tramite le funzioni sotto.
CREATE TABLE cde.naming_counters (
  project_id  uuid        NOT NULL REFERENCES cde.projects (id),
  field       text        NOT NULL,
  series      jsonb       NOT NULL,          -- valori dei campi che identificano la serie ({} = unica)
  last_value  integer     NOT NULL CHECK (last_value >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, field, series)
);
ALTER TABLE cde.naming_counters ENABLE ROW LEVEL SECURITY;

CREATE INDEX ix_documents_naming_fields ON cde.documents USING gin (naming_fields jsonb_path_ops);

-- Massimo già usato nella serie, su tutti i documenti del progetto (anche quelli non visibili).
CREATE FUNCTION cde.naming_series_max(p_project_id uuid, p_field text, p_series jsonb) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT coalesce(max((naming_fields ->> p_field)::integer), 0)
  FROM documents
  WHERE project_id = p_project_id AND naming_fields @> p_series AND (naming_fields ->> p_field) ~ '^\d{1,9}$'
$$;

CREATE FUNCTION cde.peek_document_number(p_project_id uuid, p_field text, p_series jsonb, p_start integer)
RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  v_used integer;
BEGIN
  IF NOT is_project_member(current_app_user(), p_project_id) THEN
    RAISE EXCEPTION 'non membro del progetto' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT greatest(naming_series_max(p_project_id, p_field, p_series), coalesce(max(last_value), 0)) INTO v_used
  FROM naming_counters WHERE project_id = p_project_id AND field = p_field AND series = p_series;
  RETURN greatest(v_used + 1, p_start);
END $$;

-- Riserva il prossimo numero (atomico: il lock di riga serializza caricamenti concorrenti della stessa serie).
-- Un caricamento annullato dopo la riserva lascia un buco nella numerazione: è voluto, i numeri non si riusano.
CREATE FUNCTION cde.reserve_document_number(p_project_id uuid, p_field text, p_series jsonb, p_start integer)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  v_used integer;
  v_next integer;
BEGIN
  IF NOT is_project_member(current_app_user(), p_project_id) THEN
    RAISE EXCEPTION 'non membro del progetto' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO naming_counters (project_id, field, series, last_value)
  VALUES (p_project_id, p_field, p_series, 0)
  ON CONFLICT (project_id, field, series) DO NOTHING;
  SELECT last_value INTO v_used FROM naming_counters
  WHERE project_id = p_project_id AND field = p_field AND series = p_series FOR UPDATE;
  v_next := greatest(greatest(v_used, naming_series_max(p_project_id, p_field, p_series)) + 1, p_start);
  UPDATE naming_counters SET last_value = v_next, updated_at = now()
  WHERE project_id = p_project_id AND field = p_field AND series = p_series;
  RETURN v_next;
END $$;

REVOKE ALL ON FUNCTION cde.naming_series_max(uuid, text, jsonb),
                       cde.peek_document_number(uuid, text, jsonb, integer),
                       cde.reserve_document_number(uuid, text, jsonb, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cde.peek_document_number(uuid, text, jsonb, integer),
                          cde.reserve_document_number(uuid, text, jsonb, integer) TO cde_app;
