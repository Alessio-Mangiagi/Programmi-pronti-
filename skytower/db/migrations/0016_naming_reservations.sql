-- "><(((º> sabusabu <º)))><"
-- depends: 0015_naming_autonumber
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0016
-- Prenotazione degli identificativi: chi prepara un elenco elaborati prenota in anticipo N numeri della
-- serie (stesso contatore della rinomina automatica). Un identificativo prenotato e non ancora usato non
-- può essere caricato da un'altra organizzazione; lo consuma il primo caricamento della propria.
-- I numeri rilasciati non tornano disponibili: la numerazione non si riusa.
-- =====================================================================

CREATE TABLE cde.naming_reservations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid        NOT NULL REFERENCES cde.projects (id),
  identifier       text        NOT NULL CHECK (identifier ~ '^[A-Z0-9][A-Z0-9._-]{3,120}$'),
  naming_fields    jsonb       NOT NULL,
  organization_id  uuid        NOT NULL REFERENCES cde.organizations (id),
  reserved_by      uuid        NOT NULL REFERENCES cde.users (id),
  note             text        CHECK (note IS NULL OR length(note) <= 500),
  created_at       timestamptz NOT NULL DEFAULT now(),
  used_at          timestamptz,
  document_id      uuid        REFERENCES cde.documents (id),
  released_at      timestamptz,
  UNIQUE (project_id, identifier),
  CHECK (used_at IS NULL OR released_at IS NULL)
);
CREATE INDEX ix_naming_reservations_org ON cde.naming_reservations (project_id, organization_id, created_at DESC);

ALTER TABLE cde.naming_reservations ENABLE ROW LEVEL SECURITY;
-- ogni organizzazione vede e gestisce solo le proprie prenotazioni
CREATE POLICY naming_reservations_select ON cde.naming_reservations FOR SELECT TO cde_app
  USING (organization_id = cde.current_app_org() AND cde.is_project_member(cde.current_app_user(), project_id));
CREATE POLICY naming_reservations_insert ON cde.naming_reservations FOR INSERT TO cde_app
  WITH CHECK (organization_id = cde.current_app_org() AND reserved_by = cde.current_app_user()
              AND cde.is_project_member(cde.current_app_user(), project_id));
CREATE POLICY naming_reservations_update ON cde.naming_reservations FOR UPDATE TO cde_app
  USING (organization_id = cde.current_app_org() AND cde.is_project_member(cde.current_app_user(), project_id));
GRANT SELECT, INSERT ON cde.naming_reservations TO cde_app;
GRANT UPDATE (used_at, document_id, released_at) ON cde.naming_reservations TO cde_app;

-- Prenotato da un'altra organizzazione e ancora valido? (le prenotazioni altrui non sono visibili)
CREATE FUNCTION cde.identifier_reserved_elsewhere(p_project_id uuid, p_identifier text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT is_project_member(current_app_user(), p_project_id) AND EXISTS (
    SELECT 1 FROM naming_reservations
    WHERE project_id = p_project_id AND identifier = p_identifier AND used_at IS NULL AND released_at IS NULL
      AND organization_id <> current_app_org())
$$;

-- Il massimo della serie considera anche gli identificativi prenotati (anche dopo un cambio di serie).
CREATE OR REPLACE FUNCTION cde.naming_series_max(p_project_id uuid, p_field text, p_series jsonb) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT coalesce(max((f ->> p_field)::integer), 0)
  FROM (SELECT naming_fields AS f FROM documents WHERE project_id = p_project_id
        UNION ALL
        SELECT naming_fields FROM naming_reservations WHERE project_id = p_project_id) s
  WHERE f @> p_series AND (f ->> p_field) ~ '^\d{1,9}$'
$$;

REVOKE ALL ON FUNCTION cde.identifier_reserved_elsewhere(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cde.identifier_reserved_elsewhere(uuid, text) TO cde_app;
