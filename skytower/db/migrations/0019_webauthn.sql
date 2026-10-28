-- "><(((º> sabusabu <º)))><"
-- depends: 0018_pdf_watermark
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0019
-- Chiavi di sicurezza e passkey (WebAuthn) come secondo fattore, accanto al TOTP. Le colonne della
-- credenziale c'erano dalla 0001; qui i trasporti (suggerimento al browser) e le challenge monouso:
-- ogni cerimonia (registrazione o accesso) usa una challenge casuale che vale 5 minuti e una volta sola,
-- così un'asserzione intercettata non si può riusare anche se l'autenticatore non incrementa il contatore.
-- =====================================================================

ALTER TABLE cde.user_mfa_factors ADD COLUMN webauthn_transports text[] NOT NULL DEFAULT '{}';

CREATE TABLE cde.webauthn_challenges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES cde.users (id) ON DELETE CASCADE,
  purpose     text        NOT NULL CHECK (purpose IN ('register', 'authenticate')),
  challenge   bytea       NOT NULL CHECK (length(challenge) >= 32),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_webauthn_challenges_user ON cde.webauthn_challenges (user_id, created_at DESC);

-- come le altre tabelle delle credenziali: solo il servizio di autenticazione (cde_app non la vede)
GRANT SELECT, INSERT, UPDATE, DELETE ON cde.webauthn_challenges TO cde_auth;
