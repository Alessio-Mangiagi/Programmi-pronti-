/**
 * Migrazioni SQL applicate all'avvio (PRAGMA user_version = indice dell'ultima
 * eseguita). Scritte a mano e tenute allineate a schema.ts: i test in Node
 * (test/db.test.ts) creano il DB con queste e poi usano le query drizzle, così
 * una colonna mancante salta fuori subito. Aggiungere sempre in coda, mai
 * modificare una migrazione già distribuita.
 */
export const MIGRATIONS: string[][] = [
  [
    `CREATE TABLE projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, address TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE plans (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, file_url TEXT,
      width_px REAL, height_px REAL, local_file_path TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE INDEX plans_project ON plans(project_id)`,
    `CREATE TABLE form_templates (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT, schema_def TEXT NOT NULL, archived_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE pins (
      id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
      dirty INTEGER NOT NULL DEFAULT 0,
      plan_id TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, label TEXT, created_by TEXT)`,
    `CREATE INDEX pins_plan ON pins(plan_id)`,
    `CREATE INDEX pins_dirty ON pins(dirty)`,
    `CREATE TABLE form_submissions (
      id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
      dirty INTEGER NOT NULL DEFAULT 0,
      template_id TEXT NOT NULL, pin_id TEXT NOT NULL, data_json TEXT NOT NULL, submitted_by TEXT)`,
    `CREATE INDEX subs_pin ON form_submissions(pin_id)`,
    `CREATE INDEX subs_dirty ON form_submissions(dirty)`,
    `CREATE TABLE tasks (
      id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
      dirty INTEGER NOT NULL DEFAULT 0,
      pin_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT, status TEXT NOT NULL DEFAULT 'open',
      assigned_to TEXT, created_by TEXT, due_date TEXT)`,
    `CREATE INDEX tasks_pin ON tasks(pin_id)`,
    `CREATE INDEX tasks_assignee ON tasks(assigned_to)`,
    `CREATE INDEX tasks_dirty ON tasks(dirty)`,
    `CREATE TABLE attachments (
      id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
      dirty INTEGER NOT NULL DEFAULT 0,
      submission_id TEXT, task_id TEXT, file_url TEXT, file_type TEXT,
      local_file_path TEXT, upload_attempts INTEGER NOT NULL DEFAULT 0)`,
    `CREATE INDEX att_submission ON attachments(submission_id)`,
    `CREATE INDEX att_task ON attachments(task_id)`,
    `CREATE INDEX att_dirty ON attachments(dirty)`,
    `CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL)`,
    `CREATE TABLE sync_state (project_id TEXT PRIMARY KEY, last_server_time TEXT, last_sync_at TEXT)`,
    `CREATE TABLE sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, entity TEXT NOT NULL, entity_id TEXT NOT NULL,
      kind TEXT NOT NULL, reason TEXT, payload TEXT, created_at TEXT NOT NULL)`,
  ],
  // 2: versione della planimetria scaricata (updated_at del piano al momento del download)
  [`ALTER TABLE plans ADD COLUMN local_file_for TEXT`],
  // 3: bozze dei moduli (chiave = pin + template), per non perdere il lavoro se l'app viene chiusa
  [`CREATE TABLE drafts (key TEXT PRIMARY KEY, pin_id TEXT NOT NULL, template_id TEXT NOT NULL,
      data_json TEXT NOT NULL, attachments_json TEXT NOT NULL, updated_at TEXT NOT NULL)`],
  // 4: coda upload: quando riprovare (backoff esponenziale) senza toccare updated_at (che è del sync)
  [`ALTER TABLE attachments ADD COLUMN upload_next_at TEXT`],
]

/** Driver minimo che sia expo-sqlite sia better-sqlite3 sanno offrire. */
export type SqlRunner = { exec: (sql: string) => void; getVersion: () => number; setVersion: (v: number) => void }

export function migrate(db: SqlRunner): number {
  const current = db.getVersion()
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN')
    try {
      for (const stmt of MIGRATIONS[v]) db.exec(stmt)
      db.setVersion(v + 1)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
  return MIGRATIONS.length
}
