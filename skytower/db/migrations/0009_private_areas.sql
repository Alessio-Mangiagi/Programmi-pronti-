-- "><(((º> sabusabu <º)))><"
-- depends: 0008_profile
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0009
-- Aree riservate: cartelle accessibili per ruolo solo a chi ha ADMIN (Project Admin, oppure admin
-- dell'organizzazione proprietaria). Gli altri membri vedono l'area chiusa e chiedono l'accesso:
-- l'admin approva (grant personale, anche a scadenza) o rifiuta.
--
-- Regole:
--   * un'area riservata è una cartella radice con is_private; le sottocartelle lo ereditano e nessuna
--     cartella entra o esce dall'area spostandola (i grant sugli antenati non possono "filtrare" dentro);
--   * per ruolo vale solo ADMIN; READ/WRITE/DOWNLOAD/APPROVE arrivano da grant espliciti, che
--     restano soggetti alla regola generale (il grant estende la visibilità, non i privilegi del ruolo);
--   * anche le revisioni PUBLISHED/archiviate di un'area riservata sono visibili solo a chi ha READ
--     sulla cartella (altrove PUBLISHED è visibile a tutto il progetto).
-- =====================================================================

ALTER TABLE cde.containers ADD COLUMN is_private boolean NOT NULL DEFAULT false;
CREATE INDEX ix_containers_private ON cde.containers (project_id) WHERE is_private;

-- ---------------------------------------------------------------------
-- Coerenza: privacy ereditata dal padre, area radice creata solo da un admin
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cde.check_container() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  v_parent_private boolean;
  v_me uuid := current_app_user();
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.project_id <> OLD.project_id
                           OR NEW.owner_organization_id <> OLD.owner_organization_id) THEN
    RAISE EXCEPTION 'Progetto e organizzazione proprietaria di un container non sono modificabili'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM project_organizations
    WHERE project_id = NEW.project_id AND organization_id = NEW.owner_organization_id AND is_active
  ) THEN
    RAISE EXCEPTION 'L''organizzazione proprietaria non partecipa al progetto'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.parent_id IS NOT NULL THEN
    SELECT is_private INTO v_parent_private FROM containers WHERE id = NEW.parent_id AND project_id = NEW.project_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Il container padre appartiene a un altro progetto' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.parent_id IS NOT NULL THEN
      NEW.is_private := v_parent_private;                 -- le sottocartelle seguono l'area
    ELSIF NEW.is_private AND v_me IS NOT NULL AND NOT (
          has_project_permission(v_me, NEW.project_id, 'ADMIN', 'PROJECT')
       OR (has_project_permission(v_me, NEW.project_id, 'ADMIN', 'OWN_ORGANIZATION')
           AND NEW.owner_organization_id = user_org(v_me))) THEN
      RAISE EXCEPTION 'Solo un amministratore può creare un''area riservata' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSE
    IF NEW.is_private <> OLD.is_private THEN
      RAISE EXCEPTION 'La riservatezza di una cartella non si cambia dopo la creazione' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.parent_id IS DISTINCT FROM OLD.parent_id
       AND coalesce(v_parent_private, false) <> OLD.is_private THEN
      RAISE EXCEPTION 'Una cartella non si sposta dentro o fuori da un''area riservata' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.parent_id IS NULL AND OLD.parent_id IS NOT NULL AND OLD.is_private THEN
      RAISE EXCEPTION 'Una cartella non si sposta dentro o fuori da un''area riservata' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.parent_id IS DISTINCT FROM OLD.parent_id AND NEW.parent_id IS NOT NULL THEN
    IF EXISTS (
      WITH RECURSIVE up AS (
        SELECT id, parent_id, 0 AS depth FROM containers WHERE id = NEW.parent_id
        UNION ALL
        SELECT c.id, c.parent_id, up.depth + 1 FROM containers c JOIN up ON c.id = up.parent_id
        WHERE up.depth < 100
      )
      SELECT 1 FROM up WHERE id = NEW.id
    ) THEN
      RAISE EXCEPTION 'Spostamento non valido: creerebbe un ciclo' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------
-- Permessi: nelle aree riservate il ruolo conta solo se concede ADMIN
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION cde.has_permission(p_user_id uuid, p_container_id uuid, p_action cde.permission_action)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  WITH RECURSIVE
  u AS (
    SELECT id, organization_id FROM users WHERE id = p_user_id AND status = 'ACTIVE'
  ),
  c AS (
    SELECT id, project_id, owner_organization_id, is_private FROM containers WHERE id = p_container_id
  ),
  role_actions AS (
    SELECT rp.scope, rp.action
    FROM c
    JOIN u ON true
    JOIN project_memberships pm ON pm.project_id = c.project_id AND pm.user_id = u.id
    JOIN project_organizations po
      ON po.project_id = c.project_id AND po.organization_id = u.organization_id AND po.is_active
    JOIN role_permissions rp ON rp.role_id = pm.role_id
    WHERE (pm.expires_at IS NULL OR pm.expires_at > now())
      AND (rp.action = p_action OR rp.action = 'ADMIN')
  ),
  role_ok AS (
    SELECT ra.scope FROM role_actions ra, c WHERE NOT c.is_private OR ra.action = 'ADMIN'
  ),
  ancestors AS (
    SELECT id, parent_id, inherit_permissions, 0 AS depth
    FROM containers WHERE id = p_container_id
    UNION ALL
    SELECT p.id, p.parent_id, p.inherit_permissions, a.depth + 1
    FROM containers p
    JOIN ancestors a ON p.id = a.parent_id
    WHERE a.inherit_permissions AND a.depth < 50
  )
  SELECT
       EXISTS (SELECT 1 FROM role_ok WHERE scope = 'PROJECT')
    OR EXISTS (
         SELECT 1 FROM role_ok ra, c, u
         WHERE ra.scope = 'OWN_ORGANIZATION' AND c.owner_organization_id = u.organization_id
       )
    OR (
         p_action <> 'ADMIN'
         AND EXISTS (SELECT 1 FROM role_actions)
         AND EXISTS (
           SELECT 1
           FROM access_grants g
           JOIN ancestors a ON a.id = g.container_id
           CROSS JOIN u
           WHERE g.revoked_at IS NULL
             AND g.valid_from <= now()
             AND (g.valid_until IS NULL OR g.valid_until > now())
             AND p_action = ANY (g.actions)
             AND (   (g.grantee_type = 'USER'         AND g.grantee_user_id = u.id)
                  OR (g.grantee_type = 'ORGANIZATION' AND g.grantee_organization_id = u.organization_id))
         )
       )
$$;

CREATE OR REPLACE FUNCTION cde.my_containers(p_action cde.permission_action) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  WITH RECURSIVE
  me AS (
    SELECT id, organization_id FROM users WHERE id = current_app_user() AND status = 'ACTIVE'
  ),
  roles_ok AS (
    SELECT pm.project_id, rp.scope, bool_or(rp.action = 'ADMIN') AS is_admin
    FROM me
    JOIN project_memberships pm ON pm.user_id = me.id
    JOIN project_organizations po
      ON po.project_id = pm.project_id AND po.organization_id = me.organization_id AND po.is_active
    JOIN role_permissions rp ON rp.role_id = pm.role_id
    WHERE (pm.expires_at IS NULL OR pm.expires_at > now())
      AND (rp.action = p_action OR rp.action = 'ADMIN')
    GROUP BY pm.project_id, rp.scope
  ),
  granted AS (
    SELECT g.container_id AS id
    FROM access_grants g CROSS JOIN me
    WHERE p_action <> 'ADMIN'
      AND g.revoked_at IS NULL AND g.valid_from <= now() AND (g.valid_until IS NULL OR g.valid_until > now())
      AND p_action = ANY (g.actions)
      AND (   (g.grantee_type = 'USER'         AND g.grantee_user_id = me.id)
           OR (g.grantee_type = 'ORGANIZATION' AND g.grantee_organization_id = me.organization_id))
      AND g.project_id IN (SELECT project_id FROM roles_ok)
    UNION
    SELECT c.id FROM containers c JOIN granted gr ON c.parent_id = gr.id WHERE c.inherit_permissions
  )
  SELECT c.id FROM containers c
    JOIN roles_ok r ON r.project_id = c.project_id AND r.scope = 'PROJECT'
    WHERE NOT c.is_private OR r.is_admin
  UNION
  SELECT c.id FROM containers c
    JOIN roles_ok r ON r.project_id = c.project_id AND r.scope = 'OWN_ORGANIZATION'
    JOIN me ON c.owner_organization_id = me.organization_id
    WHERE NOT c.is_private OR r.is_admin
  UNION
  SELECT id FROM granted
$$;

CREATE FUNCTION cde.private_containers() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT id FROM containers WHERE is_private
$$;

-- PUBLISHED/archiviato: tutto il progetto, tranne le aree riservate (lì serve READ sulla cartella)
DROP POLICY revisions_select ON cde.document_revisions;
CREATE POLICY revisions_select ON cde.document_revisions FOR SELECT TO cde_app USING (
  CASE state
    WHEN 'WIP' THEN originator_organization_id = (SELECT cde.current_app_org())
                    AND container_id IN (SELECT cde.my_containers('READ'))
    WHEN 'SHARED' THEN container_id IN (SELECT cde.my_containers('READ'))
    ELSE project_id IN (SELECT cde.my_projects())
         AND (container_id NOT IN (SELECT cde.private_containers())
              OR container_id IN (SELECT cde.my_containers('READ')))
  END
  OR id IN (SELECT cde.my_review_revisions())
);

CREATE OR REPLACE FUNCTION cde.revision_visible_to_me(r cde.document_revisions) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT CASE r.state
    WHEN 'WIP' THEN r.originator_organization_id = current_app_org()
                    AND r.container_id IN (SELECT my_containers('READ'))
    WHEN 'SHARED' THEN r.container_id IN (SELECT my_containers('READ'))
    ELSE r.project_id IN (SELECT my_projects())
         AND (r.container_id NOT IN (SELECT private_containers())
              OR r.container_id IN (SELECT my_containers('READ'))) END
$$;

-- ---------------------------------------------------------------------
-- Richieste di accesso
-- ---------------------------------------------------------------------
CREATE TYPE cde.access_request_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

CREATE TABLE cde.access_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid                      NOT NULL REFERENCES cde.projects (id) ON DELETE CASCADE,
  container_id     uuid                      NOT NULL REFERENCES cde.containers (id) ON DELETE CASCADE,
  requester_id     uuid                      NOT NULL REFERENCES cde.users (id),
  actions          cde.permission_action[]   NOT NULL DEFAULT '{READ,DOWNLOAD}'
                   CHECK (cardinality(actions) > 0 AND NOT ('ADMIN' = ANY (actions))),
  reason           text                      NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 2000),
  valid_until      timestamptz,                                -- richiesta dall'utente, l'admin può cambiarla
  status           cde.access_request_status NOT NULL DEFAULT 'PENDING',
  decided_by       uuid                      REFERENCES cde.users (id),
  decided_at       timestamptz,
  decision_note    text,
  grant_id         uuid                      REFERENCES cde.access_grants (id),
  created_at       timestamptz               NOT NULL DEFAULT now(),
  CHECK ((status IN ('PENDING', 'CANCELLED')) = (decided_by IS NULL)),
  CHECK ((status = 'APPROVED') = (grant_id IS NOT NULL))
);
CREATE UNIQUE INDEX ux_access_requests_pending ON cde.access_requests (container_id, requester_id) WHERE status = 'PENDING';
CREATE INDEX ix_access_requests_project ON cde.access_requests (project_id, status);

ALTER TABLE cde.access_requests ENABLE ROW LEVEL SECURITY;
-- le vede chi le ha fatte e chi amministra la cartella; si scrivono solo con le funzioni sotto
CREATE POLICY access_requests_select ON cde.access_requests FOR SELECT TO cde_app USING (
  requester_id = (SELECT cde.current_app_user())
  OR container_id IN (SELECT cde.my_containers('ADMIN'))
);

-- Aree riservate di una commessa viste da un membro: anche quelle chiuse, con lo stato della sua richiesta
CREATE FUNCTION cde.private_areas(p_project uuid)
RETURNS TABLE (id uuid, name text, owner_organization_code text, has_access boolean, is_admin boolean,
               request_id uuid, request_status cde.access_request_status, pending_requests integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT c.id, c.name, o.code,
         c.id IN (SELECT my_containers('READ')),
         c.id IN (SELECT my_containers('ADMIN')),
         r.id, r.status,
         CASE WHEN c.id IN (SELECT my_containers('ADMIN'))
              THEN (SELECT count(*)::int FROM access_requests ar WHERE ar.container_id = c.id AND ar.status = 'PENDING') END
  FROM containers c
  JOIN organizations o ON o.id = c.owner_organization_id
  LEFT JOIN LATERAL (
    SELECT ar.id, ar.status FROM access_requests ar
    WHERE ar.container_id = c.id AND ar.requester_id = current_app_user()
    ORDER BY ar.created_at DESC LIMIT 1
  ) r ON true
  WHERE c.project_id = p_project AND c.is_private AND c.parent_id IS NULL
    AND p_project IN (SELECT my_projects())
  ORDER BY c.name
$$;

CREATE FUNCTION cde.access_request_create(p_container uuid, p_reason text,
                                          p_actions cde.permission_action[] DEFAULT '{READ,DOWNLOAD}',
                                          p_until timestamptz DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  v_me uuid := current_app_user();
  v_c containers%ROWTYPE;
  v_id uuid;
  v_admin uuid;
  v_name text;
BEGIN
  SELECT * INTO v_c FROM containers WHERE id = p_container;
  IF NOT FOUND OR v_c.project_id NOT IN (SELECT my_projects()) THEN
    RAISE EXCEPTION 'Area non trovata' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT v_c.is_private THEN
    RAISE EXCEPTION 'La cartella non è un''area riservata: chiedi la condivisione al suo amministratore'
      USING ERRCODE = 'check_violation';
  END IF;
  IF has_permission(v_me, p_container, 'READ') THEN
    RAISE EXCEPTION 'Hai già accesso a quest''area' USING ERRCODE = 'check_violation';
  END IF;
  IF p_until IS NOT NULL AND p_until <= now() THEN
    RAISE EXCEPTION 'La scadenza richiesta è già passata' USING ERRCODE = 'check_violation';
  END IF;
  IF 'ADMIN' = ANY (p_actions) THEN
    RAISE EXCEPTION 'L''amministrazione non si richiede' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO access_requests (project_id, container_id, requester_id, actions, reason, valid_until)
  VALUES (v_c.project_id, p_container, v_me, p_actions, btrim(p_reason), p_until)
  RETURNING id INTO v_id;

  SELECT first_name || ' ' || last_name INTO v_name FROM users WHERE id = v_me;
  FOR v_admin IN
    SELECT DISTINCT pm.user_id FROM project_memberships pm
    WHERE pm.project_id = v_c.project_id AND pm.user_id <> v_me AND has_permission(pm.user_id, p_container, 'ADMIN')
  LOOP
    PERFORM notify(v_admin, v_c.project_id, 'ACCESS_REQUESTED',
                   format('Richiesta di accesso a "%s"', v_c.name),
                   format('%s: %s', v_name, left(btrim(p_reason), 400)),
                   format('/progetti/%s/riservate', v_c.project_id),
                   jsonb_build_object('request_id', v_id, 'container_id', p_container));
  END LOOP;
  RETURN v_id;
END $$;

CREATE FUNCTION cde.access_request_decide(p_request uuid, p_approve boolean, p_note text DEFAULT NULL,
                                          p_until timestamptz DEFAULT NULL,
                                          p_actions cde.permission_action[] DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  v_me uuid := current_app_user();
  v_r access_requests%ROWTYPE;
  v_name text;
  v_grant uuid;
  v_until timestamptz;
BEGIN
  SELECT * INTO v_r FROM access_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND OR NOT (v_r.requester_id = v_me OR has_permission(v_me, v_r.container_id, 'ADMIN')) THEN
    RAISE EXCEPTION 'Richiesta non trovata' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT has_permission(v_me, v_r.container_id, 'ADMIN') THEN
    RAISE EXCEPTION 'Solo un amministratore dell''area decide sulle richieste' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_r.status <> 'PENDING' THEN
    RAISE EXCEPTION 'La richiesta è già stata gestita' USING ERRCODE = 'check_violation';
  END IF;
  SELECT name INTO v_name FROM containers WHERE id = v_r.container_id;

  IF p_approve THEN
    v_until := coalesce(p_until, v_r.valid_until);
    IF v_until IS NOT NULL AND v_until <= now() THEN
      RAISE EXCEPTION 'La scadenza dell''accesso è già passata' USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO access_grants (project_id, container_id, grantee_type, grantee_user_id, actions, reason,
                               valid_until, granted_by)
    VALUES (v_r.project_id, v_r.container_id, 'USER', v_r.requester_id, coalesce(p_actions, v_r.actions),
            'Richiesta di accesso approvata: ' || v_r.reason, v_until, v_me)
    RETURNING id INTO v_grant;
  END IF;

  UPDATE access_requests
     SET status = CASE WHEN p_approve THEN 'APPROVED' ELSE 'REJECTED' END::access_request_status,
         decided_by = v_me, decided_at = now(), decision_note = nullif(btrim(p_note), ''),
         grant_id = v_grant, valid_until = CASE WHEN p_approve THEN v_until ELSE valid_until END
   WHERE id = p_request;

  PERFORM notify(v_r.requester_id, v_r.project_id, CASE WHEN p_approve THEN 'ACCESS_GRANTED' ELSE 'ACCESS_REJECTED' END,
                 format(CASE WHEN p_approve THEN 'Accesso concesso a "%s"' ELSE 'Accesso negato a "%s"' END, v_name),
                 coalesce(nullif(btrim(p_note), ''),
                          CASE WHEN p_approve AND v_until IS NOT NULL
                               THEN 'Valido fino al ' || to_char(v_until, 'DD/MM/YYYY') ELSE '' END),
                 CASE WHEN p_approve THEN format('/progetti/%s/cartelle/%s', v_r.project_id, v_r.container_id)
                      ELSE format('/progetti/%s/riservate', v_r.project_id) END,
                 jsonb_build_object('request_id', p_request, 'container_id', v_r.container_id));
  RETURN v_grant;
END $$;

CREATE FUNCTION cde.access_request_cancel(p_request uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
BEGIN
  UPDATE access_requests SET status = 'CANCELLED'
   WHERE id = p_request AND requester_id = current_app_user() AND status = 'PENDING';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Richiesta non trovata o già gestita' USING ERRCODE = 'no_data_found';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- Privilegi
-- ---------------------------------------------------------------------
REVOKE ALL ON cde.access_requests FROM PUBLIC;
GRANT SELECT ON cde.access_requests TO cde_app;
GRANT INSERT (is_private) ON cde.containers TO cde_app;

REVOKE ALL ON FUNCTION cde.private_containers(), cde.private_areas(uuid),
                       cde.access_request_create(uuid, text, cde.permission_action[], timestamptz),
                       cde.access_request_decide(uuid, boolean, text, timestamptz, cde.permission_action[]),
                       cde.access_request_cancel(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cde.private_containers(), cde.private_areas(uuid),
                          cde.access_request_create(uuid, text, cde.permission_action[], timestamptz),
                          cde.access_request_decide(uuid, boolean, text, timestamptz, cde.permission_action[]),
                          cde.access_request_cancel(uuid) TO cde_app;
