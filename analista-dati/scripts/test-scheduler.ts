/**
 * Test end-to-end dell'AUTONOMIA (multi-utente): connessione salvata cifrata →
 * job pianificato → esecuzione → report .xlsx su disco + storico run.
 * DB SQLite reale + finta AI locale (nessun modello vero necessario).
 *
 *   npx tsx scripts/test-scheduler.ts
 *
 * Se Ollama è attivo, gira anche uno smoke reale con provider 'ollama'.
 */
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { DatabaseSync } from 'node:sqlite'

// ── env PRIMA degli import dinamici (i moduli leggono la config al load) ──
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agente-sched-'))
const DATA_DB = path.join(TMP, 'dati.db')
process.env.APP_DB_PATH = path.join(TMP, 'app.db')
process.env.REPORTS_DIR = path.join(TMP, 'reports')
process.env.MASTER_PASSWORD = 'test-master-pass'
process.env.AUTH_ENABLED = '0'

// ── mini harness ──
let pass = 0, fail = 0
function check(name: string, cond: boolean) {
  // "><(((º> sabusabu <º)))><"
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + name) }
  else { fail++; console.log('  \x1b[31m✗ FAIL\x1b[0m ' + name) }
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ── finta AI locale (piano report + query) ──
function decideSql(prompt: string) {
  const retry = /Correggi la query/i.test(prompt)
  if (/ordini per cliente/i.test(prompt))
    return { sql: 'SELECT c.nome, COUNT(o.id) AS n FROM clienti c LEFT JOIN ordini o ON o.cliente_id=c.id GROUP BY c.nome ORDER BY n DESC', explanation: '' }
  if (/fatturato/i.test(prompt))
    return { sql: 'SELECT c.citta, SUM(o.importo) AS tot FROM clienti c JOIN ordini o ON o.cliente_id=c.id GROUP BY c.citta ORDER BY tot DESC', explanation: '' }
  if (/senza ordini/i.test(prompt))
    return retry
      ? { sql: 'SELECT c.nome FROM clienti c LEFT JOIN ordini o ON o.cliente_id=c.id WHERE o.id IS NULL', explanation: '' }
      : { sql: 'SELECT c.nome FROM clienti c LEFT JOIN ordini o ON o.NON_ESISTE=c.id WHERE o.id IS NULL', explanation: '' }
  return { sql: 'SELECT 1', explanation: '' }
}
function mockContent(prompt: string): string {
  if (/TEMA DELL'ANALISI|proponi/i.test(prompt))
    return JSON.stringify({ analisi: [
      { titolo: 'Ordini per cliente', domanda: 'Quanti ordini per cliente?' },
      { titolo: 'Fatturato', domanda: 'Fatturato per città' },
      { titolo: 'Clienti senza ordini', domanda: 'Clienti senza ordini' },
    ] })
  return JSON.stringify(decideSql(prompt))
}

async function main() {
  // 1) DB dati d'esempio
  const db = new DatabaseSync(DATA_DB)
  db.exec(`CREATE TABLE clienti(id INTEGER PRIMARY KEY, nome TEXT, citta TEXT);
           CREATE TABLE ordini(id INTEGER PRIMARY KEY, cliente_id INTEGER, importo REAL);`)
  db.prepare('INSERT INTO clienti VALUES(?,?,?)').run(1, 'Mario', 'Roma')
  db.prepare('INSERT INTO clienti VALUES(?,?,?)').run(2, 'Lucia', 'Milano')
  db.prepare('INSERT INTO clienti VALUES(?,?,?)').run(3, 'Anna', 'Roma')
  const o = db.prepare('INSERT INTO ordini VALUES(?,?,?)')
  o.run(1, 1, 120); o.run(2, 1, 80); o.run(3, 2, 300)
  db.close()

  // 2) mock LLM
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', c => (body += c))
    req.on('end', () => {
      const u = (JSON.parse(body || '{}').messages || []).filter((m: any) => m.role === 'user').pop()?.content || ''
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: mockContent(String(u)) } }] }))
    })
  })
  const port: number = await new Promise(r => server.listen(0, '127.0.0.1', () => r((server.address() as any).port)))
  process.env.LOCAL_LLM_BASE = `http://127.0.0.1:${port}`

  // 3) import dinamici (dopo l'env)
  const { saveConnection, getConnectionConfig, listConnections } = await import('../server/connections.ts')
  const { createJob, enqueueJob, getRun, listRuns, cronError } = await import('../server/scheduler.ts')
  const { ollamaHealth } = await import('../server/llm.ts')
  const { REPORTS_DIR } = await import('../server/appdb.ts')

  // 4) CONNESSIONE SALVATA (cifrata) + round-trip decrypt
  console.log('\n[1] Connessione salvata cifrata')
  const conn = saveConnection('DB Test', { kind: 'sqlite', database: DATA_DB }, 'tester')
  check('connessione creata con id', conn.id > 0)
  check('compare nella lista (senza segreti)', listConnections().some(c => c.id === conn.id && !(c as any).config_enc))
  const cfg = getConnectionConfig(conn.id)
  check('decrypt round-trip = config originale', cfg.kind === 'sqlite' && cfg.database === DATA_DB)

  // 5) CRON validation
  console.log('\n[2] Validazione cron')
  check('cron valido accettato', cronError('0 8 * * 1') === null)
  check('cron rotto rifiutato', /5 campi|range|valido/.test(cronError('99 * *') || ''))

  // 6) JOB + esecuzione (mock local)
  console.log('\n[3] Job pianificato → esecuzione → file .xlsx')
  const job = createJob({ name: 'Report vendite', connection_id: conn.id, theme: 'analisi vendite', cron: '0 8 * * *', provider: 'local', createdBy: 'tester' })
  check('job creato ed enabled', job.id > 0 && job.enabled === 1)
  const runId = enqueueJob(job.id)
  // attendi fine (poll)
  let run = getRun(runId)
  for (let i = 0; i < 60 && run?.status === 'running'; i++) { await sleep(250); run = getRun(runId) }
  check('run completata (status ok)', run?.status === 'ok')
  check('sezioni prodotte (3)', (run?.sections || 0) === 3)
  const file = run?.filename ? path.join(REPORTS_DIR, run.filename) : ''
  check('file .xlsx scritto su disco', !!file && fs.existsSync(file) && fs.statSync(file).size > 0)
  check('storico run del job popolato', listRuns(job.id).length >= 1)

  // 7) OPZIONALE: smoke reale con Ollama se attivo
  const oll = await ollamaHealth()
  if (oll.ollama && oll.model) {
    console.log('\n[4] Ollama attivo → smoke reale (provider ollama)')
    const jobO = createJob({ name: 'Smoke Ollama', connection_id: conn.id, theme: 'panoramica dati', cron: '0 8 * * *', provider: 'ollama', createdBy: 'tester' })
    const rid = enqueueJob(jobO.id)
    let r2 = getRun(rid)
    for (let i = 0; i < 240 && r2?.status === 'running'; i++) { await sleep(500); r2 = getRun(rid) }
    check('run Ollama terminata (ok/error, non appesa)', r2?.status === 'ok' || r2?.status === 'error')
    if (r2?.status === 'ok') check('file Ollama scritto', fs.existsSync(path.join(REPORTS_DIR, r2.filename!)))
  } else {
    console.log('\n[4] Ollama non attivo → smoke reale saltato (il mock copre la pipeline)')
  }

  server.close()
  try { fs.rmSync(TMP, { recursive: true, force: true }) } catch { /* ok */ }
  console.log(`\n${'─'.repeat(52)}\nRISULTATO: ${pass} passati, ${fail} falliti\n`)
  process.exit(fail ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
