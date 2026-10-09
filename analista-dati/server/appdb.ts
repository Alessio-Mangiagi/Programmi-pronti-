/**
 * DB APPLICATIVO (non è un DB analizzato): SQLite locale che persiste lo stato
 * dell'agente in modalità multi-utente/autonoma. Sopravvive ai riavvii.
 *
 * Tabelle:
 *   users          — account (username + hash scrypt + ruolo)
 *   sessions        — sessioni di login (cookie), con scadenza
 *   connections     — connessioni DB salvate, con config CIFRATA (AES-GCM)
 *   jobs            — report pianificati (cron) sullo scheduler
 *   runs            — storico esecuzioni dei job (esito + file prodotto)
 *
 * Usa node:sqlite (built-in): niente pacchetti npm da installare dietro proxy.
 */
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
// node:sqlite via createRequire: il resolver di Vite (vitest) non gestisce ancora
// questo builtin; con require() viene caricato nativamente da Node. In produzione
// (tsx) funziona identico.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

export const APP_DB_PATH = process.env.APP_DB_PATH || path.join(ROOT, 'app.db')
// Cartella dove lo scheduler deposita i report .xlsx prodotti in autonomia.
export const REPORTS_DIR = process.env.REPORTS_DIR || path.join(ROOT, 'reports')

fs.mkdirSync(REPORTS_DIR, { recursive: true })

export const appdb = new DatabaseSync(APP_DB_PATH)

appdb.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY,
    username   TEXT NOT NULL UNIQUE,
    pass_hash  TEXT NOT NULL,
    role       TEXT NOT NULL DEFAULT 'user',   -- 'admin' | 'user'
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,              -- sha256(token-cookie): mai il token in chiaro
    user_id    INTEGER NOT NULL,
    username   TEXT NOT NULL,
    role       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  -- Consumo token LLM a pagamento (Claude), per utente e per giorno → budget/audit.
  CREATE TABLE IF NOT EXISTS usage (
    username   TEXT NOT NULL,
    day        TEXT NOT NULL,                 -- YYYY-MM-DD
    in_tokens  INTEGER NOT NULL DEFAULT 0,
    out_tokens INTEGER NOT NULL DEFAULT 0,
    requests   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (username, day)
  );

  CREATE TABLE IF NOT EXISTS connections (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    kind       TEXT NOT NULL,
    config_enc TEXT NOT NULL,                  -- JSON DbConfig cifrato (AES-GCM)
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    connection_id INTEGER NOT NULL,
    theme         TEXT NOT NULL,
    provider      TEXT,
    cron          TEXT NOT NULL,               -- 5 campi: min hour dom mon dow
    enabled       INTEGER NOT NULL DEFAULT 1,
    created_by    TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    last_run      TEXT,
    last_status   TEXT
  );

  CREATE TABLE IF NOT EXISTS runs (
    id          INTEGER PRIMARY KEY,
    job_id      INTEGER NOT NULL,
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    status      TEXT NOT NULL,                 -- 'running' | 'ok' | 'error'
    filename    TEXT,
    engine      TEXT,
    sections    INTEGER,
    error       TEXT
  );

  -- Few-shot bank: coppie domanda→query RIUSCITE (risultato non vuoto), per DB.
  -- Le più simili alla nuova domanda vengono iniettate nel prompt: l'LLM impara
  -- il dialetto/lessico aziendale dal proprio storico.
  CREATE TABLE IF NOT EXISTS fewshot (
    id         INTEGER PRIMARY KEY,
    conn_key   TEXT NOT NULL,                  -- kind + hash nomi tabelle (stabile per DB)
    question   TEXT NOT NULL,
    query      TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (conn_key, question)
  );

  -- Storico conversazione per sessione+DB: il riavvio del server non deve far
  -- perdere il contesto dei follow-up (la sessione frontend sopravvive in localStorage).
  CREATE TABLE IF NOT EXISTS chat_history (
    id         INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL,
    conn_key   TEXT NOT NULL,                  -- stesso formato del few-shot bank
    question   TEXT NOT NULL,
    query      TEXT NOT NULL DEFAULT '',
    answer     TEXT,
    created_at TEXT NOT NULL
  );

  -- Glossario aziendale per DB: termine → colonna/formula/spiegazione. Iniettato
  -- nel prompt insieme allo schema (stabile → finisce nella cache Claude).
  CREATE TABLE IF NOT EXISTS glossary (
    id         INTEGER PRIMARY KEY,
    conn_key   TEXT NOT NULL,                  -- stesso formato del few-shot bank
    term       TEXT NOT NULL,
    definition TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (conn_key, term)
  );

  -- Colonne sensibili (PII) per DB: escluse dallo schema nel prompt LLM e
  -- mascherate (***) nei risultati mostrati/esportati.
  CREATE TABLE IF NOT EXISTS pii_columns (
    id          INTEGER PRIMARY KEY,
    conn_key    TEXT NOT NULL,
    table_name  TEXT NOT NULL,
    column_name TEXT NOT NULL,
    created_by  TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    UNIQUE (conn_key, table_name, column_name)
  );

  CREATE INDEX IF NOT EXISTS idx_chat_hist ON chat_history(session_id, conn_key);
  CREATE INDEX IF NOT EXISTS idx_fewshot_conn ON fewshot(conn_key);
  CREATE INDEX IF NOT EXISTS idx_glossary_conn ON glossary(conn_key);
  CREATE INDEX IF NOT EXISTS idx_pii_conn ON pii_columns(conn_key);
  CREATE INDEX IF NOT EXISTS idx_runs_job ON runs(job_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);
`)

/** Migrazione idempotente: aggiunge una colonna se manca (node:sqlite non ha ADD COLUMN IF NOT EXISTS). */
function addColumn(table: string, colDef: string): void {
  const col = colDef.split(/\s+/)[0]
  const cols = appdb.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!cols.some(c => c.name === col)) appdb.exec(`ALTER TABLE ${table} ADD COLUMN ${colDef}`)
}

// Flag "deve cambiare la password": 1 sull'admin creato con password di default.
addColumn('users', 'must_change_pw INTEGER NOT NULL DEFAULT 0')
// Esempio CONFERMATO dall'utente (👍): pesa di più nel ranking few-shot e
// sopravvive più a lungo alla retention (un "riuscito" non è per forza corretto).
addColumn('fewshot', 'confirmed INTEGER NOT NULL DEFAULT 0')

export const now = () => new Date().toISOString()
export const today = () => new Date().toISOString().slice(0, 10)

/**
 * Righe di node:sqlite tipizzate.
 *
 * `.all()` e `.get()` dichiarano `Record<string, SQLOutputValue>`: per TypeScript
 * non si sovrappone abbastanza ai nostri tipi riga (che hanno campi obbligatori),
 * quindi un `as Job[]` diretto è un errore TS2352. Il cast va fatto passando da
 * `unknown`; queste due funzioni lo isolano qui, con la spiegazione, invece di
 * spargere `as unknown as X` in ogni query.
 *
 * Restano cast non verificati: la forma è garantita dalla SELECT, non dai tipi.
 */
export function rows<T>(r: unknown): T[] { return r as T[] }
export function one<T>(r: unknown): T | undefined { return r as T | undefined }
