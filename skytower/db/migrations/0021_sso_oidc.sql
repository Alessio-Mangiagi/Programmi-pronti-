-- "><(((º> sabusabu <º)))><"
-- depends: 0020_org_admin_mfa
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0021
-- Single sign-on OpenID Connect per organizzazione (Entra ID, Google Workspace, Okta...). L'admin della
-- organizzazione registra l'issuer, il client e i domini email; il login passa dall'IdP con authorization
-- code + PKCE. Il segreto del client è cifrato con la KMS (envelope) e non torna mai al browser.
-- Gli stati del flusso (state, nonce, code_verifier) sono monouso e valgono 10 minuti.
-- =====================================================================

CREATE TABLE cde.organization_sso (
  organization_id          uuid PRIMARY KEY REFERENCES cde.organizations (id) ON DELETE CASCADE,
  issuer                   text        NOT NULL CHECK (issuer ~ '^https?://[^\s]+$'),
  client_id                text        NOT NULL CHECK (length(client_id) BETWEEN 1 AND 255),
  client_secret_encrypted  bytea,                                -- NULL = client pubblico (solo PKCE)
  email_domains            text[]      NOT NULL CHECK (cardinality(email_domains) BETWEEN 1 AND 20),
  enabled                  boolean     NOT NULL DEFAULT true,
  enforce                  boolean     NOT NULL DEFAULT false,   -- password disattivata per gli utenti dell'org
  idp_mfa                  boolean     NOT NULL DEFAULT true,    -- l'IdP impone già l'MFA (accesso condizionale)
  updated_by               uuid REFERENCES cde.users (id),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
-- un dominio email appartiene a una sola organizzazione
CREATE FUNCTION cde.sso_domains_unique() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
BEGIN
  NEW.email_domains := (SELECT array_agg(DISTINCT lower(d) ORDER BY lower(d)) FROM unnest(NEW.email_domains) d);
  IF EXISTS (SELECT 1 FROM organization_sso s WHERE s.organization_id <> NEW.organization_id
             AND s.email_domains && NEW.email_domains) THEN
    RAISE EXCEPTION 'Dominio email già associato al single sign-on di un''altra organizzazione'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_sso_domains BEFORE INSERT OR UPDATE ON cde.organization_sso
  FOR EACH ROW EXECUTE FUNCTION cde.sso_domains_unique();

CREATE TABLE cde.sso_states (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash       bytea       NOT NULL UNIQUE,                  -- SHA-256 dello state inviato all'IdP
  organization_id  uuid        NOT NULL REFERENCES cde.organizations (id) ON DELETE CASCADE,
  nonce            text        NOT NULL,
  code_verifier    text        NOT NULL,
  expires_at       timestamptz NOT NULL,
  used_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_sso_states_expiry ON cde.sso_states (expires_at);

-- configurazione: l'admin dell'organizzazione (o il platform admin) via API applicativa
ALTER TABLE cde.organization_sso ENABLE ROW LEVEL SECURITY;
CREATE POLICY sso_admin_all ON cde.organization_sso FOR ALL TO cde_app
  USING (cde.can_manage_org(organization_id)) WITH CHECK (cde.can_manage_org(organization_id));
CREATE POLICY sso_auth_select ON cde.organization_sso FOR SELECT TO cde_auth USING (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON cde.organization_sso TO cde_app;
GRANT SELECT ON cde.organization_sso TO cde_auth;
-- il flusso di login: solo il servizio di autenticazione
GRANT SELECT, INSERT, UPDATE, DELETE ON cde.sso_states TO cde_auth;
-- (cde_auth aggiorna già users.status: l'invitato che entra con il single sign-on attiva l'account)
