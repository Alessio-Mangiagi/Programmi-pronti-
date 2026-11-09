-- "><(((º> sabusabu <º)))><"
-- depends: 0044_firma_digitale
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0045: timbri da apporre sui PDF (ADR-56)
--
-- Richiesta dell'utente del 09/11/2026 ("ingloba una versione di timbri in SkyTower", scelta 4a): la firma
-- scansionata, il logo, «Approvato», il timbro dell'impresa con lo sfondo reso trasparente (come fa Timbri per VFP)
-- si mettono sulle pagine di un PDF dal visualizzatore; il PDF timbrato diventa la WIP successiva del documento e
-- il registro attività dice chi ha timbrato, quando, con quali timbri e da quale revisione.
--
-- Un timbro è un'immagine PNG già scontornata (la prepara l'API), salvata su S3 come i file dei documenti. Tre ambiti:
--   * PERSONAL      — di una persona (la sua firma): lo vede e lo usa solo lei, in tutte le sue commesse;
--   * ORGANIZATION  — dell'organizzazione (logo, timbro dell'impresa): lo crea l'amministratore dell'organizzazione,
--                     lo usano tutti i colleghi in tutte le commesse;
--   * PROJECT       — della commessa («Approvato DL», «Visto CSE»): lo crea il Project Admin, lo vedono e lo usano
--                     tutti i membri della commessa, di ogni organizzazione.
-- Non si cancella: si disattiva (le revisioni già timbrate e il registro restano leggibili e sensati). Si cambiano
-- solo nome e attivazione; l'immagine no (un timbro diverso è un timbro nuovo).
-- =====================================================================

CREATE TABLE cde.stamps (
  id                  uuid        PRIMARY KEY,
  scope               text        NOT NULL CHECK (scope IN ('PERSONAL', 'ORGANIZATION', 'PROJECT')),
  organization_id     uuid        NOT NULL REFERENCES cde.organizations (id),
  project_id          uuid        REFERENCES cde.projects (id) ON DELETE CASCADE,
  owner_id            uuid        REFERENCES cde.users (id),
  name                text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  storage_key         text        NOT NULL,
  storage_version_id  text,
  size_bytes          bigint      NOT NULL CHECK (size_bytes > 0),
  width_px            integer     NOT NULL CHECK (width_px > 0),
  height_px           integer     NOT NULL CHECK (height_px > 0),
  sha256              bytea       NOT NULL,
  created_by          uuid        NOT NULL REFERENCES cde.users (id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  disabled_at         timestamptz,
  disabled_by         uuid        REFERENCES cde.users (id),
  -- la commessa c'è solo per i timbri della commessa, il proprietario solo per quelli personali
  CONSTRAINT stamps_project_scope CHECK ((scope = 'PROJECT') = (project_id IS NOT NULL)),
  CONSTRAINT stamps_owner_scope CHECK ((scope = 'PERSONAL') = (owner_id IS NOT NULL))
);
CREATE INDEX ix_stamps_project ON cde.stamps (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX ix_stamps_org ON cde.stamps (organization_id) WHERE scope = 'ORGANIZATION';
CREATE INDEX ix_stamps_owner ON cde.stamps (owner_id) WHERE owner_id IS NOT NULL;

-- Chi gestisce (crea, rinomina, disattiva) un timbro: il proprietario per i personali, l'amministratore
-- dell'organizzazione per quelli dell'organizzazione, il Project Admin per quelli della commessa. Sempre nella
-- propria organizzazione: nessuno crea timbri a nome di un'altra azienda.
CREATE FUNCTION cde.stamp_manageable(p_scope text, p_org uuid, p_project uuid, p_owner uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT CASE p_scope
    WHEN 'PERSONAL' THEN p_owner = current_app_user() AND p_org = current_app_org()
    WHEN 'ORGANIZATION' THEN p_org = current_app_org() AND current_app_is_org_admin()
    WHEN 'PROJECT' THEN p_org = current_app_org()
                        AND has_project_permission(current_app_user(), p_project, 'ADMIN', 'PROJECT')
    ELSE false END
$$;

ALTER TABLE cde.stamps ENABLE ROW LEVEL SECURITY;

-- Visibilità = chi può usarlo: il proprietario, i colleghi dell'organizzazione, i membri della commessa
CREATE POLICY stamps_select ON cde.stamps FOR SELECT TO cde_app
  USING (CASE scope
           WHEN 'PERSONAL' THEN owner_id = cde.current_app_user()
           WHEN 'ORGANIZATION' THEN organization_id = cde.current_app_org()
           WHEN 'PROJECT' THEN cde.is_project_member(cde.current_app_user(), project_id)
         END);
CREATE POLICY stamps_insert ON cde.stamps FOR INSERT TO cde_app
  WITH CHECK (created_by = cde.current_app_user() AND disabled_at IS NULL
              AND cde.stamp_manageable(scope, organization_id, project_id, owner_id));
CREATE POLICY stamps_update ON cde.stamps FOR UPDATE TO cde_app
  USING (cde.stamp_manageable(scope, organization_id, project_id, owner_id))
  WITH CHECK (cde.stamp_manageable(scope, organization_id, project_id, owner_id));

-- Niente DELETE; in aggiornamento solo nome e attivazione (immagine, ambito e proprietario non cambiano)
REVOKE ALL ON cde.stamps FROM PUBLIC;
GRANT SELECT, INSERT ON cde.stamps TO cde_app;
GRANT UPDATE (name, updated_at, disabled_at, disabled_by) ON cde.stamps TO cde_app;
REVOKE ALL ON FUNCTION cde.stamp_manageable(text, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cde.stamp_manageable(text, uuid, uuid, uuid) TO cde_app;
