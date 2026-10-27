-- "><(((º> sabusabu <º)))><"
-- depends: 0001_core
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0002 (Sprint 1, G3)
-- RBAC (ruoli × azione × scope), membership, container, grant espliciti,
-- eventi di sicurezza, trigger di coerenza tra tenant, motore permessi.
-- =====================================================================

-- =====================================================================
-- RBAC: ruoli e matrice dei permessi
-- =====================================================================
CREATE TABLE cde.roles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid    REFERENCES cde.projects (id) ON DELETE CASCADE,  -- NULL = template di sistema
  code         text    NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,40}$'),
  name         text    NOT NULL,
  description  text,
  is_system    boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (project_id, code),
  CHECK (NOT is_system OR project_id IS NULL)
);

CREATE TABLE cde.role_permissions (
  role_id  uuid                  NOT NULL REFERENCES cde.roles (id) ON DELETE CASCADE,
  action   cde.permission_action NOT NULL,
  scope    cde.permission_scope  NOT NULL,
  PRIMARY KEY (role_id, action, scope)
);

CREATE TABLE cde.project_memberships (
  project_id  uuid        NOT NULL REFERENCES cde.projects (id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES cde.users (id) ON DELETE CASCADE,
  role_id     uuid        NOT NULL REFERENCES cde.roles (id),
  granted_by  uuid        REFERENCES cde.users (id),
  granted_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz,
  PRIMARY KEY (project_id, user_id, role_id)
);
CREATE INDEX ix_memberships_user ON cde.project_memberships (user_id);
CREATE INDEX ix_memberships_role ON cde.project_memberships (role_id);

-- =====================================================================
-- Container informativi — proprietà di UNA organizzazione
-- =====================================================================
CREATE TABLE cde.containers (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id             uuid        NOT NULL REFERENCES cde.projects (id) ON DELETE CASCADE,
  parent_id              uuid        REFERENCES cde.containers (id),
  owner_organization_id  uuid        NOT NULL REFERENCES cde.organizations (id),
  name                   text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  inherit_permissions    boolean     NOT NULL DEFAULT true,   -- eredita i grant del padre
  created_by             uuid        REFERENCES cde.users (id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (parent_id IS NULL OR parent_id <> id),
  UNIQUE NULLS NOT DISTINCT (project_id, parent_id, name)
);
CREATE INDEX ix_containers_project_owner ON cde.containers (project_id, owner_organization_id);
CREATE INDEX ix_containers_parent ON cde.containers (parent_id);
CREATE TRIGGER trg_containers_updated BEFORE UPDATE ON cde.containers
  FOR EACH ROW EXECUTE FUNCTION cde.set_updated_at();

-- =====================================================================
-- Grant espliciti (unico modo per vedere dati di un'altra organizzazione)
-- =====================================================================
CREATE TABLE cde.access_grants (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id               uuid                    NOT NULL REFERENCES cde.projects (id) ON DELETE CASCADE,
  container_id             uuid                    NOT NULL REFERENCES cde.containers (id) ON DELETE CASCADE,
  grantee_type             cde.grantee_type        NOT NULL,
  grantee_user_id          uuid                    REFERENCES cde.users (id),
  grantee_organization_id  uuid                    REFERENCES cde.organizations (id),
  actions                  cde.permission_action[] NOT NULL CHECK (cardinality(actions) > 0),
  reason                   text                    NOT NULL CHECK (length(btrim(reason)) > 0),
  valid_from               timestamptz             NOT NULL DEFAULT now(),
  valid_until              timestamptz,
  granted_by               uuid                    NOT NULL REFERENCES cde.users (id),
  created_at               timestamptz             NOT NULL DEFAULT now(),
  revoked_at               timestamptz,
  revoked_by               uuid                    REFERENCES cde.users (id),
  CHECK (
    (grantee_type = 'USER'         AND grantee_user_id IS NOT NULL AND grantee_organization_id IS NULL) OR
    (grantee_type = 'ORGANIZATION' AND grantee_organization_id IS NOT NULL AND grantee_user_id IS NULL)
  ),
  CHECK (NOT ('ADMIN' = ANY (actions))),                    -- l'amministrazione non si delega via grant
  CHECK (valid_until IS NULL OR valid_until > valid_from),
  CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);
CREATE INDEX ix_grants_container_active ON cde.access_grants (container_id) WHERE revoked_at IS NULL;
CREATE INDEX ix_grants_user ON cde.access_grants (grantee_user_id) WHERE revoked_at IS NULL;
CREATE INDEX ix_grants_org  ON cde.access_grants (grantee_organization_id) WHERE revoked_at IS NULL;

-- =====================================================================
-- Eventi di sicurezza (append-only; audit trail completo nello Sprint 5)
-- =====================================================================
CREATE TABLE cde.security_events (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  event_type       text        NOT NULL,   -- LOGIN_OK, LOGIN_FAIL, MFA_ENROLLED, TOKEN_REUSE, GRANT_CREATED, ...
  user_id          uuid,
  organization_id  uuid,
  project_id       uuid,
  ip               inet,
  user_agent       text,
  details          jsonb       NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX ix_security_events_user ON cde.security_events (user_id, occurred_at DESC);
CREATE INDEX ix_security_events_type ON cde.security_events (event_type, occurred_at DESC);
CREATE TRIGGER trg_security_events_no_update BEFORE UPDATE OR DELETE ON cde.security_events
  FOR EACH ROW EXECUTE FUNCTION cde.forbid_mutation();
CREATE TRIGGER trg_security_events_no_truncate BEFORE TRUNCATE ON cde.security_events
  FOR EACH STATEMENT EXECUTE FUNCTION cde.forbid_mutation();

-- =====================================================================
-- Trigger di coerenza tra tenant
-- =====================================================================

-- Membro solo se la sua organizzazione partecipa al progetto; ruolo di sistema o dello stesso progetto.
CREATE FUNCTION cde.check_membership() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM users u
    JOIN project_organizations po
      ON po.organization_id = u.organization_id AND po.project_id = NEW.project_id AND po.is_active
    WHERE u.id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'L''organizzazione dell''utente % non partecipa al progetto %', NEW.user_id, NEW.project_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM roles r
    WHERE r.id = NEW.role_id AND (r.project_id IS NULL OR r.project_id = NEW.project_id)
  ) THEN
    RAISE EXCEPTION 'Il ruolo % non appartiene al progetto %', NEW.role_id, NEW.project_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_membership_check BEFORE INSERT OR UPDATE ON cde.project_memberships
  FOR EACH ROW EXECUTE FUNCTION cde.check_membership();

-- Proprietario partecipante; padre nello stesso progetto; progetto/proprietario immutabili; niente cicli.
CREATE FUNCTION cde.check_container() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
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

  IF NEW.parent_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM containers WHERE id = NEW.parent_id AND project_id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'Il container padre appartiene a un altro progetto'
      USING ERRCODE = 'check_violation';
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
CREATE TRIGGER trg_container_check BEFORE INSERT OR UPDATE ON cde.containers
  FOR EACH ROW EXECUTE FUNCTION cde.check_container();

-- Grant: container del progetto, destinatario partecipante. In UPDATE è ammessa solo la revoca.
CREATE FUNCTION cde.check_grant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  v_grantee_org uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'Grant già revocato' USING ERRCODE = 'check_violation';
    END IF;
    IF (to_jsonb(NEW) - 'revoked_at' - 'revoked_by') <> (to_jsonb(OLD) - 'revoked_at' - 'revoked_by') THEN
      RAISE EXCEPTION 'Un grant non si modifica: si revoca e se ne crea uno nuovo'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM containers WHERE id = NEW.container_id AND project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'Container non appartenente al progetto' USING ERRCODE = 'check_violation';
  END IF;

  v_grantee_org := CASE NEW.grantee_type
    WHEN 'USER' THEN (SELECT organization_id FROM users WHERE id = NEW.grantee_user_id)
    ELSE NEW.grantee_organization_id
  END;

  IF NOT EXISTS (
    SELECT 1 FROM project_organizations
    WHERE project_id = NEW.project_id AND organization_id = v_grantee_org AND is_active
  ) THEN
    RAISE EXCEPTION 'Il destinatario del grant non partecipa al progetto' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_grant_check BEFORE INSERT OR UPDATE ON cde.access_grants
  FOR EACH ROW EXECUTE FUNCTION cde.check_grant();

-- =====================================================================
-- Helper contesto (SECURITY DEFINER: usabili nelle policy senza ricorsione RLS)
-- =====================================================================
CREATE FUNCTION cde.user_org(p_user_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT organization_id FROM users WHERE id = p_user_id
$$;

CREATE FUNCTION cde.current_app_org() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT organization_id FROM users WHERE id = current_app_user() AND status = 'ACTIVE'
$$;

CREATE FUNCTION cde.current_app_is_org_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT coalesce((SELECT is_org_admin FROM users WHERE id = current_app_user() AND status = 'ACTIVE'), false)
$$;

CREATE FUNCTION cde.current_app_is_platform_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT coalesce((SELECT is_platform_admin FROM users WHERE id = current_app_user() AND status = 'ACTIVE'), false)
$$;

CREATE FUNCTION cde.role_project(p_role_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT project_id FROM roles WHERE id = p_role_id
$$;

CREATE FUNCTION cde.role_is_system(p_role_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT coalesce((SELECT is_system FROM roles WHERE id = p_role_id), true)
$$;

-- =====================================================================
-- Motore permessi
-- =====================================================================
CREATE FUNCTION cde.is_project_member(p_user_id uuid, p_project_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1
    FROM project_memberships pm
    JOIN users u ON u.id = pm.user_id AND u.status = 'ACTIVE'
    JOIN project_organizations po
      ON po.project_id = pm.project_id AND po.organization_id = u.organization_id AND po.is_active
    WHERE pm.user_id = p_user_id
      AND pm.project_id = p_project_id
      AND (pm.expires_at IS NULL OR pm.expires_at > now())
  )
$$;

-- p_scope NULL = qualsiasi scope. ADMIN implica tutte le azioni nello stesso scope.
CREATE FUNCTION cde.has_project_permission(p_user_id uuid, p_project_id uuid,
                                           p_action cde.permission_action, p_scope cde.permission_scope)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT is_project_member(p_user_id, p_project_id) AND EXISTS (
    SELECT 1
    FROM project_memberships pm
    JOIN role_permissions rp ON rp.role_id = pm.role_id
    WHERE pm.user_id = p_user_id
      AND pm.project_id = p_project_id
      AND (pm.expires_at IS NULL OR pm.expires_at > now())
      AND (rp.action = p_action OR rp.action = 'ADMIN')
      AND (p_scope IS NULL OR rp.scope = p_scope)
  )
$$;

/*
  has_permission(utente, container, azione)
  VERO se e solo se l'utente è membro attivo del progetto E vale almeno una tra:
    1. un suo ruolo concede l'azione (o ADMIN) con scope PROJECT;
    2. il container è della sua organizzazione e un suo ruolo concede l'azione con scope OWN_ORGANIZATION;
    3. esiste un grant attivo sul container (o su un antenato, se ereditato) verso di lui o la sua
       organizzazione che include l'azione, E un suo ruolo concede comunque quell'azione
       (il grant estende la VISIBILITÀ, non i PRIVILEGI del ruolo).
  NB Sprint 3: regola "WIP mai visibile fuori dall'organizzazione autrice".
*/
CREATE FUNCTION cde.has_permission(p_user_id uuid, p_container_id uuid, p_action cde.permission_action)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  WITH RECURSIVE
  u AS (
    SELECT id, organization_id FROM users WHERE id = p_user_id AND status = 'ACTIVE'
  ),
  c AS (
    SELECT id, project_id, owner_organization_id FROM containers WHERE id = p_container_id
  ),
  role_actions AS (
    SELECT rp.scope
    FROM c
    JOIN u ON true
    JOIN project_memberships pm ON pm.project_id = c.project_id AND pm.user_id = u.id
    JOIN project_organizations po
      ON po.project_id = c.project_id AND po.organization_id = u.organization_id AND po.is_active
    JOIN role_permissions rp ON rp.role_id = pm.role_id
    WHERE (pm.expires_at IS NULL OR pm.expires_at > now())
      AND (rp.action = p_action OR rp.action = 'ADMIN')
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
       EXISTS (SELECT 1 FROM role_actions WHERE scope = 'PROJECT')
    OR EXISTS (
         SELECT 1 FROM role_actions ra, c, u
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

-- Azioni effettive dell'utente corrente su un container (per UI e API)
CREATE FUNCTION cde.my_container_actions(p_container_id uuid) RETURNS cde.permission_action[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT coalesce(array_agg(a ORDER BY a), '{}')
  FROM unnest(enum_range(NULL::permission_action)) a
  WHERE has_permission(current_app_user(), p_container_id, a)
$$;

-- =====================================================================
-- Creazione progetto: atomica (progetto + committente + PROJECT_ADMIN al creatore).
-- Necessaria perché prima dell'inserimento il creatore non è ancora membro.
-- =====================================================================
CREATE FUNCTION cde.create_project(p_code text, p_name text, p_description text DEFAULT NULL,
                                   p_start_date date DEFAULT NULL, p_end_date date DEFAULT NULL,
                                   p_timezone text DEFAULT 'Europe/Rome')
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  v_user uuid := current_app_user();
  v_org  uuid := current_app_org();
  v_project uuid;
  v_role uuid;
BEGIN
  IF v_org IS NULL OR NOT current_app_is_org_admin() THEN
    RAISE EXCEPTION 'Solo un amministratore di organizzazione può creare progetti'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO projects (owner_organization_id, code, name, description, start_date, end_date, timezone, created_by)
  VALUES (v_org, p_code, p_name, p_description, p_start_date, p_end_date, p_timezone, v_user)
  RETURNING id INTO v_project;

  INSERT INTO project_organizations (project_id, organization_id, party_role, invited_by)
  VALUES (v_project, v_org, 'APPOINTING_PARTY', v_user);

  SELECT id INTO STRICT v_role FROM roles WHERE project_id IS NULL AND code = 'PROJECT_ADMIN';
  INSERT INTO project_memberships (project_id, user_id, role_id, granted_by)
  VALUES (v_project, v_user, v_role, v_user);

  RETURN v_project;
END $$;
