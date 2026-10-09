<!-- "><(((º> sabusabu <º)))><" -->
# Scadenzario — SPEC Admin & Auth (v1.1)

Estensione di `SPEC.md`. Aggiunge autenticazione multi-utente e pagina admin, replicando il design collaudato di **DDTSuite** (`lettore-ddt`) adattato a Flask + SQLite + vanilla JS.

Riferimento sorgente del pattern: `lettore-ddt/src/routes/auth.routes.ts`, `admin.routes.ts`, `middleware/auth.ts`, `templates/admin.html`.

## Scelte (adattamento Flask)

| DDTSuite (Node) | Scadenzario (Flask) |
|---|---|
| users.enc AES-256-GCM (file JSON) | tabella SQLite `utenti` (il DB è già locale) |
| bcryptjs cost 10 | `werkzeug.security.generate_password_hash` / `check_password_hash` (zero dipendenze extra) |
| express-session + file store, cookie 12h rolling | sessione Flask firmata: `SESSION_COOKIE_HTTPONLY=True`, `SAMESITE='Lax'`, `PERMANENT_SESSION_LIFETIME=12h`, `session.permanent=True` (rolling automatico) |
| SESSION_SECRET → .session.key persistita | `.session.key` (32 byte random) creata al primo avvio accanto al DB, in .gitignore |
| Nessun bootstrap admin (CLI) | **bootstrap**: se `utenti` vuota, `init_db` crea `admin`/`admin` con `cambia_password=1` (la UI forza il cambio al primo login) |
| CSRF: solo SameSite=Lax (trust boundary LAN) | idem — tool locale 127.0.0.1, documentare nel README |

## Schema DB (aggiunte)

```sql
CREATE TABLE IF NOT EXISTS utenti (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,          -- regex ^[A-Za-z0-9_.@-]{1,64}$
  password_hash TEXT NOT NULL,
  display_name TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  disabilitato INTEGER NOT NULL DEFAULT 0,
  cambia_password INTEGER NOT NULL DEFAULT 0,  -- 1 = forza cambio al prossimo login
  creato_il TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS log_attivita (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  tipo TEXT NOT NULL,        -- login_ok | login_fallito | login_bloccato | logout |
                             -- utente_creato | utente_eliminato | password_cambiata |
                             -- password_reset | account_disabilitato | account_abilitato
  username TEXT,
  ip TEXT,
  dettaglio TEXT
);
-- ring buffer: dopo ogni insert, se COUNT > 5000 elimina i più vecchi oltre il limite
```

Password: minimo **8 caratteri** (login e creazione/reset). Migrazione: `init_db` esegue `CREATE TABLE IF NOT EXISTS` — DB esistenti si aggiornano senza perdita.

## API Auth (prefisso /api/auth)

| Endpoint | Body | Successo | Errori |
|---|---|---|---|
| `POST /api/auth/login` | `{username, password}` | `{username, display_name, is_admin, cambia_password}` | 400 campi mancanti; 401 `{"errore":"Credenziali non valide"}`; 403 account disabilitato; 429 bloccato (`{"errore":"Troppi tentativi. Riprova tra N minuti"}`) |
| `POST /api/auth/logout` | — | `{"ok":true}` | — |
| `GET /api/auth/me` | — | come login | 401 se nessuna sessione (usato per ripristino sessione al caricamento) |
| `POST /api/auth/cambia-password` | `{password_attuale, password_nuova}` | `{"ok":true}` | 401 attuale errata; 400 nuova < 8 char |

**Lockout brute-force** (in-memory, come DDTSuite):
- chiave `username|ip`: 5 falliti → blocco 15 min; login ok azzera il contatore
- chiave `ip` (tutti gli username): 30 falliti in finestra 15 min → blocco 15 min
- difesa timing: se username inesistente, eseguire comunque `check_password_hash` su hash dummy precalcolato

**Protezione route**: decorator `@login_required` su TUTTE le `/api/*` esistenti (SPEC v1) tranne `/api/health` e `/api/auth/*` → 401 `{"errore":"Accesso richiesto"}`. Decorator `@admin_required` sulle `/api/admin/*`. `GET /` serve sempre index.html (la SPA mostra login se /me → 401).

Sessione server-side payload: `user_id, username, display_name, is_admin`.

## API Admin (prefisso /api/admin, tutte @admin_required)

| Endpoint | Note |
|---|---|
| `GET /api/admin/utenti` | array utenti SENZA password_hash |
| `POST /api/admin/utenti` `{username, password, display_name?, is_admin?}` | 409 duplicato; valida regex username e pw ≥ 8; log `utente_creato` |
| `DELETE /api/admin/utenti/<id>` | vietato eliminare se stessi (400) o l'ultimo admin (400); log `utente_eliminato` |
| `POST /api/admin/utenti/<id>/password` `{password}` | reset da admin → setta `cambia_password=1`; log `password_reset` |
| `POST /api/admin/utenti/<id>/disabilitato` `{disabilitato: 0|1}` | vietato disabilitare se stessi o l'ultimo admin attivo (400); log |
| `GET /api/admin/log?limit=200&q=` | log_attivita newest-first, filtro `q` su username |
| `GET /api/admin/log.csv?q=` | export CSV |

## Frontend

1. **Vista login** (fuori dalla SPA shell): pagina piena sfondo `--cosedil-bg`, card bianca centrata max-width 400px, logo testuale "COSEDIL" navy + sottotitolo "Scadenzario", campi username/password (label uppercase muted), bottone primario navy "Accedi", errore in rosso sotto il form. Al load la SPA chiama `/api/auth/me`: 401 → mostra login; ok → app.
2. **Forza cambio password**: se `cambia_password=1` dopo il login, modale bloccante "Imposta nuova password" (attuale + nuova + conferma) prima di accedere all'app.
3. **Header**: a destra nome utente + bottone "Esci" (ghost bianco su navy); se admin, voce nav `#/admin`.
4. **Vista `#/admin`** (nascosta ai non-admin, 401 gestito comunque):
   - **Account**: form nuovo utente (username, password, nome visualizzato, checkbox Admin) + tabella utenti (Username, Nome, Ruolo badge navy "Admin", Stato badge Attivo verde/Disabilitato grigio, Creato il, Azioni: Reset password (modale), Disabilita/Abilita, Elimina con conferma).
   - **Log accessi**: tabella log con badge colorati per tipo (login_ok verde, login_fallito/bloccato rosso, resto neutro), ricerca per username, bottone Aggiorna, export CSV.
5. Ogni fetch della SPA: su risposta 401 globale → torna alla vista login (sessione scaduta).
6. Stile: design system Cosedil (`cosedil-style`), stessi componenti della SPA (card, tabelle, badge, modali). Niente emoji-icone.

## File toccati (rispetto a v1)

- `database.py` — nuove tabelle + bootstrap admin
- `auth.py` (NUOVO) — decorators, lockout, endpoints auth + admin, log_attivita helper
- `app.py` — registra auth, applica @login_required alle API esistenti
- `config.py` — SESSION_LIFETIME_HOURS=12, MIN_PASSWORD=8, chiave sessione
- `static/js/app.js` — vista login, cambio password forzato, vista admin, handler 401 globale
- `static/css/style.css` — stili login/admin/badge ruolo
- `README.md` — sezione Utenti e sicurezza (credenziali primo avvio admin/admin, cambio forzato, trust boundary LAN)
- `SPEC.md` — nota di rimando a questo file
