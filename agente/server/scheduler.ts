/**
 * SCHEDULER — report pianificati (autonomia dell'agente).
 * Ogni job: { connessione salvata, tema, cron, provider }. Alla scadenza cron
 * lo scheduler apre la connessione, chiama generateReport() e deposita il .xlsx
 * in REPORTS_DIR, registrando l'esito in `runs`.
 *
 * Cron scritto a mano (5 campi: min hour dom mon dow) → nessun pacchetto npm da
 * installare dietro proxy. I job girano UNO ALLA VOLTA (coda) e le chiamate LLM
 * passano comunque dal semaforo in llm.ts.
 */
import path from 'node:path'
import fs from 'node:fs'
import { appdb, now, REPORTS_DIR, rows } from './appdb.ts'
import { getConnectionConfig, getConnectionMeta } from './connections.ts'
import { createConnector } from './db.ts'
import { connKeyFor } from './fewshot.ts'
import { maskingConnector } from './privacy.ts'
import { generateReport } from './report.ts'
import { log } from './logger.ts'
import { parseCron, cronError, cronMatches, lastCronMatchWithin, type Cron } from './cron.ts'
import type { LlmProvider } from './types.ts'

export { cronError }

// Timeout massimo per un job: un report bloccato (LLM/DB) non deve inchiodare
// la coda sequenziale di TUTTI i job. Superato → run marcato errore, coda avanti.
const JOB_TIMEOUT_MS = Number(process.env.JOB_TIMEOUT_MS) || 10 * 60_000
// Retention: quante run conservare per job (le più vecchie + i file vengono rimossi).
const RUNS_KEEP = Number(process.env.RUNS_KEEP) || 20
// Catch-up: al riavvio recupera un'esecuzione saltata mentre il server era spento.
const CATCHUP_ENABLED = process.env.SCHEDULER_CATCHUP !== '0'
const CATCHUP_WINDOW_MIN = Number(process.env.SCHEDULER_CATCHUP_WINDOW_MIN) || 24 * 60

export interface Job {
  id: number
  name: string
  connection_id: number
  theme: string
  provider: string | null
  cron: string
  enabled: number
  created_by: string
  created_at: string
  last_run: string | null
  last_status: string | null
}

// ── CRUD job ─────────────────────────────────────────────────────────────────
export function listJobs(): Job[] {
  return rows<Job>(appdb.prepare('SELECT * FROM jobs ORDER BY id DESC').all())
}
export function getJob(id: number): Job | undefined {
  return appdb.prepare('SELECT * FROM jobs WHERE id=?').get(id) as Job | undefined
}

export function createJob(input: {
  name: string; connection_id: number; theme: string; cron: string; provider?: string; createdBy: string
}): Job {
  const name = input.name.trim()
  if (!name) throw new Error('Nome job obbligatorio')
  if (!input.theme.trim()) throw new Error('Tema del report obbligatorio')
  const err = cronError(input.cron)
  if (err) throw new Error(err)
  if (!getConnectionMeta(input.connection_id)) throw new Error('Connessione inesistente')
  const info = appdb.prepare(
    `INSERT INTO jobs(name, connection_id, theme, provider, cron, enabled, created_by, created_at)
     VALUES(?,?,?,?,?,1,?,?)`
  ).run(name, input.connection_id, input.theme.trim(), input.provider || null, input.cron.trim(), input.createdBy, now())
  return getJob(Number(info.lastInsertRowid))!
}

export function setJobEnabled(id: number, enabled: boolean): void {
  appdb.prepare('UPDATE jobs SET enabled=? WHERE id=?').run(enabled ? 1 : 0, id)
}
export function deleteJob(id: number): void {
  appdb.prepare('DELETE FROM jobs WHERE id=?').run(id)
  appdb.prepare('DELETE FROM runs WHERE job_id=?').run(id)
}

// ── storico run ──────────────────────────────────────────────────────────────
export interface Run {
  id: number; job_id: number; started_at: string; finished_at: string | null
  status: string; filename: string | null; engine: string | null; sections: number | null; error: string | null
}
export function listRuns(jobId?: number, limit = 50): Run[] {
  return jobId
    ? rows<Run>(appdb.prepare('SELECT * FROM runs WHERE job_id=? ORDER BY id DESC LIMIT ?').all(jobId, limit))
    : rows<Run>(appdb.prepare('SELECT * FROM runs ORDER BY id DESC LIMIT ?').all(limit))
}
export function getRun(id: number): Run | undefined {
  return appdb.prepare('SELECT * FROM runs WHERE id=?').get(id) as Run | undefined
}

// ── esecuzione job (coda sequenziale) ────────────────────────────────────────
let chain: Promise<unknown> = Promise.resolve()
/** Accoda l'esecuzione di un job; ritorna il runId (creato subito). */
export function enqueueJob(jobId: number): number {
  const info = appdb.prepare('INSERT INTO runs(job_id, started_at, status) VALUES(?,?,?)')
    .run(jobId, now(), 'running')
  const runId = Number(info.lastInsertRowid)
  chain = chain.then(() => runJob(jobId, runId)).catch(() => {})
  return runId
}

/** Promise che rigetta dopo ms → usata per il timeout del job. */
function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout job dopo ${Math.round(ms / 1000)}s`)), ms)
    t.unref?.()
  })
}

async function runJob(jobId: number, runId: number): Promise<void> {
  const job = getJob(jobId)
  if (!job) { appdb.prepare('UPDATE runs SET status=?, error=?, finished_at=? WHERE id=?').run('error', 'Job inesistente', now(), runId); return }
  log('job_start', { clientHost: 'scheduler' }, { job: job.name, jobId })
  try {
    const cfg = getConnectionConfig(job.connection_id)
    const conn = createConnector(cfg)
    try {
      // Timeout complessivo: introspezione + generazione report entro JOB_TIMEOUT_MS.
      const out = await Promise.race([
        (async () => {
          const schema = await conn.introspect()
          // Colonne PII mascherate anche nei report generati in autonomia.
          let effConn = conn
          try { effConn = maskingConnector(conn, connKeyFor(conn.kind, schema)) } catch { /* best-effort */ }
          return generateReport(effConn, schema, job.theme, (job.provider as LlmProvider) || undefined, { clientHost: 'scheduler' })
        })(),
        timeout(JOB_TIMEOUT_MS),
      ])
      const filename = `${runId}-${out.filename}`
      fs.writeFileSync(path.join(REPORTS_DIR, filename), Buffer.from(out.base64, 'base64'))
      const hasErr = out.sections.some(s => s.error)
      appdb.prepare('UPDATE runs SET status=?, filename=?, engine=?, sections=?, finished_at=? WHERE id=?')
        .run('ok', filename, out.engine, out.sections.length, now(), runId)
      appdb.prepare('UPDATE jobs SET last_run=?, last_status=? WHERE id=?')
        .run(now(), hasErr ? 'ok (con avvisi)' : 'ok', jobId)
      log('job_ok', { clientHost: 'scheduler' }, { job: job.name, filename, engine: out.engine, sezioni: out.sections.length })
    } finally {
      await conn.close().catch(() => {})
    }
  } catch (e) {
    const msg = (e as Error).message
    appdb.prepare('UPDATE runs SET status=?, error=?, finished_at=? WHERE id=?').run('error', msg, now(), runId)
    appdb.prepare('UPDATE jobs SET last_run=?, last_status=? WHERE id=?').run(now(), 'errore', jobId)
    log('job_error', { clientHost: 'scheduler' }, { job: job.name, error: msg })
  } finally {
    pruneRuns(jobId) // retention: rimuove run vecchie + relativi file
  }
}

// ── retention ────────────────────────────────────────────────────────────────
/** Conserva solo le ultime RUNS_KEEP run del job; elimina righe e file più vecchi. */
export function pruneRuns(jobId: number): void {
  try {
    const old = appdb.prepare(
      'SELECT id, filename FROM runs WHERE job_id=? ORDER BY id DESC LIMIT -1 OFFSET ?'
    ).all(jobId, RUNS_KEEP) as Array<{ id: number; filename: string | null }>
    for (const r of old) {
      if (r.filename) { try { fs.unlinkSync(path.join(REPORTS_DIR, path.basename(r.filename))) } catch { /* già rimosso */ } }
      appdb.prepare('DELETE FROM runs WHERE id=?').run(r.id)
    }
    if (old.length) log('runs_pruned', { clientHost: 'scheduler' }, { jobId, removed: old.length })
  } catch { /* best-effort */ }
}

/** Rimuove eventuali file .xlsx orfani in REPORTS_DIR (nessuna run che li referenzia). */
function pruneOrphanFiles(): void {
  try {
    const referenced = new Set(
      (appdb.prepare('SELECT filename FROM runs WHERE filename IS NOT NULL').all() as Array<{ filename: string }>)
        .map(r => path.basename(r.filename))
    )
    for (const f of fs.readdirSync(REPORTS_DIR)) {
      if (f.endsWith('.xlsx') && !referenced.has(f)) {
        try { fs.unlinkSync(path.join(REPORTS_DIR, f)) } catch { /* ignora */ }
      }
    }
  } catch { /* ignora */ }
}

// ── catch-up al riavvio ──────────────────────────────────────────────────────
/** Recupera i job la cui esecuzione prevista è stata saltata mentre il server era spento. */
function catchUpMissed(): void {
  if (!CATCHUP_ENABLED) return
  const nowD = new Date()
  for (const job of listJobs()) {
    if (!job.enabled) continue
    let c: Cron
    try { c = parseCron(job.cron) } catch { continue }
    const due = lastCronMatchWithin(c, nowD, CATCHUP_WINDOW_MIN)
    if (!due) continue
    // Salta se in questo minuto scatterà comunque (lo prende il tick normale).
    if (cronMatches(c, nowD)) continue
    const lastRun = job.last_run ? new Date(job.last_run).getTime() : 0
    if (due.getTime() > lastRun) {
      log('job_catchup', { clientHost: 'scheduler' }, { job: job.name, due: due.toISOString() })
      enqueueJob(job.id)
    }
  }
}

// ── tick del minuto ──────────────────────────────────────────────────────────
const firedThisMinute = new Set<string>() // "jobId@YYYY-MM-DDTHH:MM" per de-dup
function minuteKey(d: Date): string { return d.toISOString().slice(0, 16) }

function tick(): void {
  const d = new Date()
  const mk = minuteKey(d)
  // pulizia chiavi di minuti passati
  for (const k of firedThisMinute) if (!k.endsWith(mk)) firedThisMinute.delete(k)
  for (const job of listJobs()) {
    if (!job.enabled) continue
    let c: Cron
    try { c = parseCron(job.cron) } catch { continue } // cron rotto → salta
    if (!cronMatches(c, d)) continue
    const key = `${job.id}@${mk}`
    if (firedThisMinute.has(key)) continue
    firedThisMinute.add(key)
    enqueueJob(job.id)
  }
}

let timer: ReturnType<typeof setInterval> | null = null
/** Avvia il polling del minuto (idempotente). */
export function startScheduler(): void {
  if (timer) return
  // ogni 30s: cattura il minuto anche se il timer scivola un po'
  timer = setInterval(tick, 30_000)
  timer.unref?.()
  pruneOrphanFiles()   // pulizia file .xlsx senza run
  catchUpMissed()      // recupera esecuzioni saltate mentre era spento
  log('scheduler_start', {}, { reportsDir: REPORTS_DIR, catchup: CATCHUP_ENABLED, runsKeep: RUNS_KEEP })
}
