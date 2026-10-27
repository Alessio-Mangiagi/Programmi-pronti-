-- "><(((º> sabusabu <º)))><"
-- depends: 0012_dashboard
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0013 (Sprint 6, G54)
-- Transmittal: registro di protocollo delle emissioni. Ogni trasmissione ha un numero progressivo
-- per commessa (TRM-0001), uno scopo, destinatari (organizzazioni o persone) e l'elenco delle
-- revisioni trasmesse, fotografato al momento dell'emissione (identificativo, revisione, idoneità,
-- stato, file e impronta SHA-256). Una trasmissione emessa non si modifica né si cancella;
-- i destinatari ne confermano la ricezione.
-- Si trasmettono solo revisioni condivise o pubblicate, verificate dall'antivirus e visibili a chi emette.
-- =====================================================================

CREATE TYPE cde.transmittal_purpose AS ENUM
  ('INFORMATION', 'COMMENT', 'APPROVAL', 'CONSTRUCTION', 'TENDER', 'RECORD');

CREATE TABLE cde.transmittals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid                    NOT NULL REFERENCES cde.projects (id),
  number           integer                 NOT NULL,
  subject          text                    NOT NULL CHECK (length(btrim(subject)) BETWEEN 3 AND 300),
  purpose          cde.transmittal_purpose NOT NULL,
  message          text                    CHECK (length(message) <= 10000),
  response_due_at  timestamptz,
  sender_id        uuid                    NOT NULL REFERENCES cde.users (id),
  sender_org_id    uuid                    NOT NULL REFERENCES cde.organizations (id),
  issued_at        timestamptz             NOT NULL DEFAULT now(),
  UNIQUE (project_id, number)
);
CREATE INDEX ix_transmittals_project ON cde.transmittals (project_id, number DESC);

CREATE TABLE cde.transmittal_recipients (
  transmittal_id   uuid NOT NULL REFERENCES cde.transmittals (id),
  organization_id  uuid REFERENCES cde.organizations (id),
  user_id          uuid REFERENCES cde.users (id),
  CHECK ((organization_id IS NULL) <> (user_id IS NULL))
);
CREATE INDEX ix_transmittal_recipients ON cde.transmittal_recipients (transmittal_id);

CREATE TABLE cde.transmittal_items (
  transmittal_id     uuid          NOT NULL REFERENCES cde.transmittals (id),
  position           integer       NOT NULL CHECK (position > 0),
  revision_id        uuid          NOT NULL REFERENCES cde.document_revisions (id),
  document_id        uuid          NOT NULL REFERENCES cde.documents (id),
  identifier         text          NOT NULL,
  title              text          NOT NULL,
  revision_code      text          NOT NULL,
  suitability        text          NOT NULL,
  state              cde.cde_state NOT NULL,
  original_filename  text          NOT NULL,
  size_bytes         bigint        NOT NULL,
  sha256             bytea         NOT NULL,
  PRIMARY KEY (transmittal_id, position),
  UNIQUE (transmittal_id, revision_id)
);

CREATE TABLE cde.transmittal_receipts (
  transmittal_id   uuid        NOT NULL REFERENCES cde.transmittals (id),
  user_id          uuid        NOT NULL REFERENCES cde.users (id),
  acknowledged_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (transmittal_id, user_id)
);

-- Registro di protocollo: nessuna modifica o cancellazione, nemmeno dal proprietario
CREATE TRIGGER trg_transmittals_no_update BEFORE UPDATE OR DELETE ON cde.transmittals
  FOR EACH ROW EXECUTE FUNCTION cde.forbid_mutation();
CREATE TRIGGER trg_transmittal_recipients_no_update BEFORE UPDATE OR DELETE ON cde.transmittal_recipients
  FOR EACH ROW EXECUTE FUNCTION cde.forbid_mutation();
CREATE TRIGGER trg_transmittal_items_no_update BEFORE UPDATE OR DELETE ON cde.transmittal_items
  FOR EACH ROW EXECUTE FUNCTION cde.forbid_mutation();
CREATE TRIGGER trg_transmittal_receipts_no_update BEFORE UPDATE OR DELETE ON cde.transmittal_receipts
  FOR EACH ROW EXECUTE FUNCTION cde.forbid_mutation();
CREATE TRIGGER trg_transmittals_no_truncate BEFORE TRUNCATE ON cde.transmittals
  FOR EACH STATEMENT EXECUTE FUNCTION cde.forbid_mutation();

-- Partecipante: organizzazione mittente, organizzazioni/persone destinatarie; il Project Admin vede tutto
CREATE FUNCTION cde.transmittal_participant(p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM transmittals t
    WHERE t.id = p_id AND t.project_id IN (SELECT my_projects())
      AND (   t.sender_org_id = current_app_org()
           OR EXISTS (SELECT 1 FROM transmittal_recipients tr WHERE tr.transmittal_id = t.id
                      AND (tr.organization_id = current_app_org() OR tr.user_id = current_app_user()))
           OR has_project_permission(current_app_user(), t.project_id, 'ADMIN', 'PROJECT')))
$$;

CREATE FUNCTION cde.transmittal_recipient_users(p_id uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT DISTINCT u.id
  FROM transmittal_recipients tr
  JOIN transmittals t ON t.id = tr.transmittal_id
  JOIN users u ON (u.id = tr.user_id OR u.organization_id = tr.organization_id) AND u.status = 'ACTIVE'
  JOIN project_memberships pm ON pm.user_id = u.id AND pm.project_id = t.project_id
  WHERE tr.transmittal_id = p_id
$$;

CREATE FUNCTION cde.transmittal_issue(p_project uuid, p_subject text, p_purpose cde.transmittal_purpose,
                                      p_message text, p_due timestamptz, p_recipient_orgs uuid[],
                                      p_recipient_users uuid[], p_revisions uuid[])
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  v_id   uuid := gen_random_uuid();
  v_num  integer;
  v_user uuid;
BEGIN
  IF p_project NOT IN (SELECT my_projects()) THEN
    RAISE EXCEPTION 'Progetto non trovato' USING ERRCODE = 'no_data_found';
  END IF;
  IF coalesce(cardinality(p_recipient_orgs), 0) + coalesce(cardinality(p_recipient_users), 0) = 0 THEN
    RAISE EXCEPTION 'Indicare almeno un destinatario' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(coalesce(p_recipient_orgs, '{}')) o
             WHERE NOT EXISTS (SELECT 1 FROM project_organizations WHERE project_id = p_project AND organization_id = o AND is_active))
     OR EXISTS (SELECT 1 FROM unnest(coalesce(p_recipient_users, '{}')) u
                WHERE NOT is_project_member(u, p_project)) THEN
    RAISE EXCEPTION 'Destinatario non partecipante al progetto' USING ERRCODE = 'check_violation';
  END IF;
  IF coalesce(cardinality(p_revisions), 0) = 0 THEN
    RAISE EXCEPTION 'Indicare almeno un documento da trasmettere' USING ERRCODE = 'check_violation';
  END IF;
  IF cardinality(p_revisions) <> (SELECT count(DISTINCT x) FROM unnest(p_revisions) x) THEN
    RAISE EXCEPTION 'Revisione ripetuta nella trasmissione' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_revisions) x
             WHERE NOT EXISTS (SELECT 1 FROM document_revisions r WHERE r.id = x AND r.project_id = p_project
                               AND revision_visible_to_me(r))) THEN
    RAISE EXCEPTION 'Revisione non trovata' USING ERRCODE = 'no_data_found';
  END IF;
  IF EXISTS (SELECT 1 FROM document_revisions r JOIN file_objects f ON f.id = r.file_object_id
             WHERE r.id = ANY (p_revisions) AND (r.state NOT IN ('SHARED', 'PUBLISHED') OR f.scan_status <> 'CLEAN')) THEN
    RAISE EXCEPTION 'Si trasmettono solo revisioni condivise o pubblicate, verificate dall''antivirus'
      USING ERRCODE = 'check_violation';
  END IF;

  v_num := next_project_number(p_project, 'TRM');
  INSERT INTO transmittals (id, project_id, number, subject, purpose, message, response_due_at, sender_id, sender_org_id)
  VALUES (v_id, p_project, v_num, btrim(p_subject), p_purpose, nullif(btrim(p_message), ''), p_due,
          current_app_user(), current_app_org());
  INSERT INTO transmittal_recipients (transmittal_id, organization_id)
    SELECT v_id, o FROM unnest(coalesce(p_recipient_orgs, '{}')) o;
  INSERT INTO transmittal_recipients (transmittal_id, user_id)
    SELECT v_id, u FROM unnest(coalesce(p_recipient_users, '{}')) u;
  INSERT INTO transmittal_items (transmittal_id, position, revision_id, document_id, identifier, title, revision_code,
                                 suitability, state, original_filename, size_bytes, sha256)
    SELECT v_id, x.ord, r.id, d.id, d.identifier, d.title, r.revision_code, r.suitability, r.state,
           r.original_filename, f.size_bytes, f.sha256
    FROM unnest(p_revisions) WITH ORDINALITY AS x (rid, ord)
    JOIN document_revisions r ON r.id = x.rid
    JOIN documents d ON d.id = r.document_id
    JOIN file_objects f ON f.id = r.file_object_id;

  FOR v_user IN SELECT * FROM transmittal_recipient_users(v_id) LOOP
    CONTINUE WHEN v_user = current_app_user();
    PERFORM notify(v_user, p_project, 'TRANSMITTAL_RECEIVED',
                   format('TRM-%s: %s', lpad(v_num::text, 4, '0'), btrim(p_subject)),
                   format('%s documenti trasmessi', cardinality(p_revisions)),
                   format('/progetti/%s/transmittal/%s', p_project, v_id), jsonb_build_object('transmittal_id', v_id));
  END LOOP;
  RETURN v_id;
END $$;

CREATE FUNCTION cde.transmittal_acknowledge(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  t transmittals%ROWTYPE;
BEGIN
  IF NOT transmittal_participant(p_id) THEN
    RAISE EXCEPTION 'Trasmissione non trovata' USING ERRCODE = 'no_data_found';
  END IF;
  IF current_app_user() NOT IN (SELECT transmittal_recipient_users(p_id)) THEN
    RAISE EXCEPTION 'Conferma la ricezione solo un destinatario' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO t FROM transmittals WHERE id = p_id;
  INSERT INTO transmittal_receipts (transmittal_id, user_id) VALUES (p_id, current_app_user())
  ON CONFLICT DO NOTHING;
  IF FOUND THEN
    PERFORM notify(t.sender_id, t.project_id, 'TRANSMITTAL_ACKNOWLEDGED',
                   format('TRM-%s: ricezione confermata', lpad(t.number::text, 4, '0')),
                   (SELECT first_name || ' ' || last_name FROM users WHERE id = current_app_user()) || ' ha confermato la ricezione',
                   format('/progetti/%s/transmittal/%s', t.project_id, p_id), jsonb_build_object('transmittal_id', p_id));
  END IF;
END $$;

ALTER TABLE cde.transmittals           ENABLE ROW LEVEL SECURITY;
ALTER TABLE cde.transmittal_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE cde.transmittal_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE cde.transmittal_receipts   ENABLE ROW LEVEL SECURITY;

CREATE POLICY transmittals_select ON cde.transmittals FOR SELECT TO cde_app USING (cde.transmittal_participant(id));
CREATE POLICY transmittal_recipients_select ON cde.transmittal_recipients FOR SELECT TO cde_app
  USING (cde.transmittal_participant(transmittal_id));
CREATE POLICY transmittal_items_select ON cde.transmittal_items FOR SELECT TO cde_app
  USING (cde.transmittal_participant(transmittal_id));
CREATE POLICY transmittal_receipts_select ON cde.transmittal_receipts FOR SELECT TO cde_app
  USING (cde.transmittal_participant(transmittal_id));

GRANT SELECT ON cde.transmittals, cde.transmittal_recipients, cde.transmittal_items, cde.transmittal_receipts TO cde_app;
REVOKE ALL ON FUNCTION cde.transmittal_issue(uuid, text, cde.transmittal_purpose, text, timestamptz, uuid[], uuid[], uuid[]),
                       cde.transmittal_acknowledge(uuid), cde.transmittal_participant(uuid),
                       cde.transmittal_recipient_users(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cde.transmittal_issue(uuid, text, cde.transmittal_purpose, text, timestamptz, uuid[], uuid[], uuid[]),
                          cde.transmittal_acknowledge(uuid), cde.transmittal_participant(uuid),
                          cde.transmittal_recipient_users(uuid) TO cde_app;
