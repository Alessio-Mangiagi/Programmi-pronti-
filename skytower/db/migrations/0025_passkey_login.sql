-- "><(((º> sabusabu <º)))><"
-- depends: 0024_revision_text_search
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0025
-- Accesso senza password con passkey (credenziali WebAuthn residenti, ADR-27). La challenge di questa
-- cerimonia nasce prima di sapere chi sta entrando: l'utente lo dice l'autenticatore (userHandle) e la
-- firma lo prova. Per questo la challenge "passwordless" è l'unica senza utente.
-- webauthn_discoverable: la chiave conserva l'account (passkey) e serve anche per entrare senza email e
-- password; NULL = non dichiarato dal browser in registrazione, diventa true al primo accesso così.
-- =====================================================================

ALTER TABLE cde.webauthn_challenges ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE cde.webauthn_challenges DROP CONSTRAINT webauthn_challenges_purpose_check;
ALTER TABLE cde.webauthn_challenges ADD CONSTRAINT webauthn_challenges_purpose_check
  CHECK (purpose IN ('register', 'authenticate', 'passwordless'));
ALTER TABLE cde.webauthn_challenges ADD CONSTRAINT webauthn_challenges_user_check
  CHECK ((user_id IS NULL) = (purpose = 'passwordless'));
CREATE INDEX ix_webauthn_challenges_anon ON cde.webauthn_challenges (expires_at) WHERE user_id IS NULL;

ALTER TABLE cde.user_mfa_factors ADD COLUMN webauthn_discoverable boolean;
