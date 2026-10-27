-- "><(((º> sabusabu <º)))><"
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0001 (Sprint 1, G2)
-- Organizzazioni, utenti, credenziali, inviti, progetti, partecipazioni
-- PostgreSQL 16 — eseguire come cde_owner (i ruoli li crea scripts/bootstrap_db.py)
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS cde;

-- ---------------------------------------------------------------------
-- Tipi enumerati
-- ---------------------------------------------------------------------
CREATE TYPE cde.org_status         AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');
CREATE TYPE cde.user_status        AS ENUM ('INVITED', 'ACTIVE', 'LOCKED', 'DISABLED');
CREATE TYPE cde.project_status     AS ENUM ('SETUP', 'ACTIVE', 'ON_HOLD', 'CLOSED', 'ARCHIVED');
CREATE TYPE cde.project_party_role AS ENUM (
  'APPOINTING_PARTY',       -- Committente
  'LEAD_APPOINTED_PARTY',   -- Capofila
  'APPOINTED_PARTY',        -- Progettista / impresa incaricata
  'SUBCONTRACTOR',          -- Subappaltatore
  'CONSULTANT',             -- Consulente / verificatore
  'OBSERVER'                -- Ente, collaudatore, sola consultazione
);
CREATE TYPE cde.permission_action  AS ENUM ('READ', 'WRITE', 'DOWNLOAD', 'APPROVE', 'ADMIN');
CREATE TYPE cde.permission_scope   AS ENUM ('OWN_ORGANIZATION', 'PROJECT');
CREATE TYPE cde.grantee_type       AS ENUM ('USER', 'ORGANIZATION');
CREATE TYPE cde.mfa_method         AS ENUM ('TOTP', 'WEBAUTHN');

-- ---------------------------------------------------------------------
-- Funzioni di utilità
-- ---------------------------------------------------------------------
CREATE FUNCTION cde.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE FUNCTION cde.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Tabella % append-only: operazione % non consentita', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$;

-- Utente corrente impostato dall'API con set_config('app.user_id', ..., true)
CREATE FUNCTION cde.current_app_user() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;

-- =====================================================================
-- TENANT: Organizzazioni
-- =====================================================================
CREATE TABLE cde.organizations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name    text            NOT NULL,
  vat_number    text,
  code          varchar(6)      NOT NULL UNIQUE                 -- Codice Originatore ISO 19650
                CHECK (code ~ '^[A-Z0-9]{3,6}$'),
  status        cde.org_status  NOT NULL DEFAULT 'ACTIVE',
  mfa_required  boolean         NOT NULL DEFAULT true,          -- policy MFA a livello tenant
  data_region   text            NOT NULL DEFAULT 'eu-south-1',
  created_at    timestamptz     NOT NULL DEFAULT now(),
  updated_at    timestamptz     NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_organizations_vat ON cde.organizations (vat_number) WHERE vat_number IS NOT NULL;
CREATE TRIGGER trg_organizations_updated BEFORE UPDATE ON cde.organizations
  FOR EACH ROW EXECUTE FUNCTION cde.set_updated_at();

-- =====================================================================
-- Utenti
-- =====================================================================
CREATE TABLE cde.users (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid            NOT NULL REFERENCES cde.organizations (id),
  email                text            NOT NULL CHECK (email = lower(email) AND email LIKE '%_@_%'),
  first_name           text            NOT NULL,
  last_name            text            NOT NULL,
  password_hash        text,                                    -- Argon2id; NULL se solo SSO / invitato
  status               cde.user_status NOT NULL DEFAULT 'INVITED',
  is_org_admin         boolean         NOT NULL DEFAULT false,  -- gestisce utenti e progetti della propria org
  is_platform_admin    boolean         NOT NULL DEFAULT false,  -- crea organizzazioni (operatore piattaforma)
  failed_login_count   integer         NOT NULL DEFAULT 0,
  locked_until         timestamptz,
  password_changed_at  timestamptz,
  last_login_at        timestamptz,
  created_at           timestamptz     NOT NULL DEFAULT now(),
  updated_at           timestamptz     NOT NULL DEFAULT now()
);
-- citext non disponibile ovunque: unicità case-insensitive con email normalizzata minuscola
CREATE UNIQUE INDEX ux_users_email ON cde.users (email);
CREATE INDEX ix_users_org ON cde.users (organization_id);
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON cde.users
  FOR EACH ROW EXECUTE FUNCTION cde.set_updated_at();

-- ---------------------------------------------------------------------
-- MFA, recovery code, sessioni, inviti (servizio di autenticazione)
-- ---------------------------------------------------------------------
CREATE TABLE cde.user_mfa_factors (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid           NOT NULL REFERENCES cde.users (id) ON DELETE CASCADE,
  method                 cde.mfa_method NOT NULL,
  label                  text           NOT NULL DEFAULT 'Authenticator',
  totp_secret_encrypted  bytea,                                 -- envelope encryption (KMS)
  webauthn_credential_id bytea UNIQUE,
  webauthn_public_key    bytea,
  webauthn_sign_count    bigint,
  verified_at            timestamptz,                           -- NULL = enrollment non completato
  last_used_at           timestamptz,
  last_used_step         bigint,                                -- anti-replay TOTP: ultimo time-step accettato
  created_at             timestamptz    NOT NULL DEFAULT now(),
  CHECK (
    (method = 'TOTP'     AND totp_secret_encrypted IS NOT NULL) OR
    (method = 'WEBAUTHN' AND webauthn_credential_id IS NOT NULL AND webauthn_public_key IS NOT NULL)
  )
);
CREATE INDEX ix_mfa_user ON cde.user_mfa_factors (user_id);

CREATE TABLE cde.user_recovery_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES cde.users (id) ON DELETE CASCADE,
  code_hash   text        NOT NULL,                             -- Argon2id del codice
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_recovery_user ON cde.user_recovery_codes (user_id) WHERE used_at IS NULL;

CREATE TABLE cde.refresh_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES cde.users (id) ON DELETE CASCADE,
  family_id     uuid        NOT NULL,                           -- riuso ⇒ revoca intera famiglia
  token_hash    bytea       NOT NULL UNIQUE,                    -- SHA-256 del token opaco
  mfa_verified  boolean     NOT NULL DEFAULT false,
  issued_at     timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  replaced_by   uuid REFERENCES cde.refresh_tokens (id),
  ip            inet,
  user_agent    text
);
CREATE INDEX ix_refresh_user_active ON cde.refresh_tokens (user_id) WHERE revoked_at IS NULL;
CREATE INDEX ix_refresh_family ON cde.refresh_tokens (family_id);

-- Inviti utente (monouso, 72h) e reset password
CREATE TABLE cde.user_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES cde.users (id) ON DELETE CASCADE,
  purpose     text        NOT NULL CHECK (purpose IN ('INVITATION', 'PASSWORD_RESET')),
  token_hash  bytea       NOT NULL UNIQUE,                      -- SHA-256 del token inviato via email
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_by  uuid        REFERENCES cde.users (id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_user_tokens_user ON cde.user_tokens (user_id) WHERE used_at IS NULL;

-- =====================================================================
-- Progetti e partecipazione delle organizzazioni
-- =====================================================================
CREATE TABLE cde.projects (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_organization_id  uuid               NOT NULL REFERENCES cde.organizations (id),  -- Appointing Party
  code                   varchar(6)         NOT NULL CHECK (code ~ '^[A-Z0-9]{2,6}$'),  -- campo "Progetto" ISO 19650
  name                   text               NOT NULL,
  description            text,
  status                 cde.project_status NOT NULL DEFAULT 'SETUP',
  start_date             date,
  end_date               date,
  timezone               text               NOT NULL DEFAULT 'Europe/Rome',
  settings               jsonb              NOT NULL DEFAULT '{}'::jsonb,
  created_by             uuid               REFERENCES cde.users (id),
  created_at             timestamptz        NOT NULL DEFAULT now(),
  updated_at             timestamptz        NOT NULL DEFAULT now(),
  UNIQUE (owner_organization_id, code),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);
CREATE TRIGGER trg_projects_updated BEFORE UPDATE ON cde.projects
  FOR EACH ROW EXECUTE FUNCTION cde.set_updated_at();

CREATE TABLE cde.project_organizations (
  project_id       uuid                   NOT NULL REFERENCES cde.projects (id) ON DELETE CASCADE,
  organization_id  uuid                   NOT NULL REFERENCES cde.organizations (id),
  party_role       cde.project_party_role NOT NULL,
  is_active        boolean                NOT NULL DEFAULT true,
  invited_by       uuid                   REFERENCES cde.users (id),
  joined_at        timestamptz            NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, organization_id)
);
CREATE INDEX ix_project_orgs_org ON cde.project_organizations (organization_id);
