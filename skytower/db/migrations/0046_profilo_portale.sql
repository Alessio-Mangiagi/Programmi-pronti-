-- "><(((º> sabusabu <º)))><"
-- depends: 0045_timbri
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0046: il profilo del portale vale in SkyTower (ADR-58)
--
-- Decisione dell'utente dell'11/11/2026 ("il profilo del portale vale per ogni programma"; "gli admin li creo
-- e li cancello solo io"; scelte 2b 3b 4a):
--   * un account SkyTower nato o entrato dal portale resta COLLEGATO alla persona del portale per username
--     (users.portale_username). Prima il legame era solo l'email: se l'email cambiava nel portale, al primo
--     ingresso nasceva un secondo account e il vecchio teneva i suoi diritti. Ora nome, cognome ed email si
--     aggiornano a ogni ingresso dall'account collegato;
--   * l'amministratore dell'organizzazione (is_org_admin) di un account collegato segue il ruolo del portale,
--     dato E TOLTO a ogni ingresso; i Project Admin aggiunti dalla regola di ADR-57 sono segnati
--     (project_memberships.dal_portale_admin) e al declassamento si tolgono, lasciando i ruoli che la persona
--     aveva già (la chiave della membership è progetto + utente + ruolo: il ruolo di prima è una riga a parte).
--
-- Ricostruzione per i dati già esistenti (dal registro di sicurezza, che è append-only e quindi affidabile):
--   * portale_username = lo username dell'ultimo ingresso dal portale (LOGIN_PORTALE) o della creazione
--     (USER_CREATED_PORTALE) di quell'account; se due account hanno usato lo stesso username vince il più recente;
--   * dal_portale_admin = true sulle righe PROJECT_ADMIN nate da un MEMBER_ADDED con portale=true.
-- I platform admin non si collegano mai: entrano solo con password e secondo fattore (ADR-47).
-- =====================================================================

ALTER TABLE cde.users ADD COLUMN portale_username text
  CHECK (portale_username IS NULL OR (portale_username = lower(portale_username) AND length(portale_username) BETWEEN 1 AND 120));
COMMENT ON COLUMN cde.users.portale_username IS
  'Username della persona nel portale della suite Cosedil (ADR-58): l''account segue il profilo del portale';
CREATE UNIQUE INDEX ux_users_portale_username ON cde.users (portale_username) WHERE portale_username IS NOT NULL;

ALTER TABLE cde.project_memberships ADD COLUMN dal_portale_admin boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN cde.project_memberships.dal_portale_admin IS
  'Project Admin dato dalla regola "amministratore del portale" (ADR-57): si toglie quando il portale non lo dà più (ADR-58)';

-- Il servizio di autenticazione collega l'account e allinea nome, cognome ed email al primo passo del login
-- (POST /auth/portale, password del portale, password propria, passkey): sono dati d'identità, come la password.
-- L'API applicativa legge solo il fatto che l'account è collegato (colonna "deciso dal portale" nella pagina
-- Organizzazione); is_org_admin resta come prima: lo cambia l'API a nome del platform admin, sotto RLS.
GRANT UPDATE (portale_username, email, first_name, last_name) ON cde.users TO cde_auth;
GRANT SELECT (portale_username) ON cde.users TO cde_app;

-- ---------------------------------------------------------------- ricostruzione del collegamento
WITH ev AS (
  SELECT CASE WHEN e.event_type = 'USER_CREATED_PORTALE'
              THEN CASE WHEN e.details->>'target' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                        THEN (e.details->>'target')::uuid END
              ELSE e.user_id END AS uid,
         lower(btrim(e.details->>'username')) AS username,
         e.occurred_at
  FROM cde.security_events e
  WHERE e.event_type IN ('LOGIN_PORTALE', 'USER_CREATED_PORTALE')
    AND coalesce(btrim(e.details->>'username'), '') <> ''
), ultimo_per_utente AS (
  SELECT DISTINCT ON (uid) uid, username, occurred_at FROM ev WHERE uid IS NOT NULL ORDER BY uid, occurred_at DESC
), ultimo_per_username AS (
  SELECT DISTINCT ON (username) uid, username FROM ultimo_per_utente ORDER BY username, occurred_at DESC
)
UPDATE cde.users u SET portale_username = x.username
  FROM ultimo_per_username x
 WHERE u.id = x.uid AND NOT u.is_platform_admin AND length(x.username) BETWEEN 1 AND 120;

-- ---------------------------------------------------------------- Project Admin dati dalla regola di ADR-57
UPDATE cde.project_memberships pm SET dal_portale_admin = true
  FROM cde.roles r
 WHERE r.id = pm.role_id AND r.code = 'PROJECT_ADMIN' AND r.project_id IS NULL
   AND EXISTS (SELECT 1 FROM cde.security_events e
                WHERE e.event_type = 'MEMBER_ADDED' AND e.project_id = pm.project_id
                  AND e.details->>'portale' = 'true'
                  AND e.details->>'target' = pm.user_id::text
                  AND e.details->>'role' = pm.role_id::text);
