/**
 * Test automatico delle NUOVE funzioni (report Excel + export + cap + guard + worker Python).
 * DB SQLite reale + finta AI locale. Nessun modello vero.
 *
 *   npx tsx scripts/test-new-features.ts            (worker Python su → engine python + grafici)
 *   PYREPORT_URL=http://localhost:9 npx tsx ...      (worker giù → fallback SheetJS)
 */
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import * as XLSX from 'xlsx'

const DB_PATH = path.join(os.tmpdir(), `agente-feat-${Date.now()}.db`)

// ── finta AI locale: piano report + query dalle domande ──
function decideSql(prompt: string): { sql: string; explanation: string } {
  const retry = /Correggi la query/i.test(prompt)
  if (/ordini per cliente/i.test(prompt))
    return { sql: 'SELECT c.nome, COUNT(o.id) AS n FROM clienti c LEFT JOIN ordini o ON o.cliente_id=c.id GROUP BY c.nome ORDER BY n DESC', explanation: '' }
  if (/fatturato per citt/i.test(prompt))
    return { sql: 'SELECT c.citta, SUM(o.importo) AS fatturato FROM clienti c JOIN ordini o ON o.cliente_id=c.id GROUP BY c.citta ORDER BY fatturato DESC', explanation: '' }
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
      { titolo: 'Fatturato per citta', domanda: 'Fatturato per città' },
      { titolo: 'Clienti senza ordini', domanda: 'Clienti senza ordini' },
    ] })
  return JSON.stringify(decideSql(prompt))
}

// ── mini harness ──
let pass = 0, fail = 0
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + name) }
  else { fail++; console.log('  \x1b[31m✗ FAIL\x1b[0m ' + name) }
}
const rowsOf = (b64: string, sheet: string) =>
  XLSX.utils.sheet_to_json(XLSX.read(Buffer.from(b64, 'base64'), { type: 'buffer' }).Sheets[sheet]) as any[]
const sheetsOf = (b64: string) => XLSX.read(Buffer.from(b64, 'base64'), { type: 'buffer' }).SheetNames
const hasChart = (b64: string) => Buffer.from(b64, 'base64').includes(Buffer.from('xl/charts/chart1.xml'))

async function main() {
  // seed
  const db = new DatabaseSync(DB_PATH)
  db.exec(`CREATE TABLE clienti(id INTEGER PRIMARY KEY, nome TEXT NOT NULL, citta TEXT);
           CREATE TABLE ordini(id INTEGER PRIMARY KEY, cliente_id INTEGER NOT NULL, importo REAL);
           CREATE TABLE grande(id INTEGER PRIMARY KEY, v INTEGER);`)
  db.prepare('INSERT INTO clienti VALUES(?,?,?)').run(1, 'Mario', 'Roma')
  db.prepare('INSERT INTO clienti VALUES(?,?,?)').run(2, 'Lucia', 'Milano')
  db.prepare('INSERT INTO clienti VALUES(?,?,?)').run(3, 'Anna', 'Roma')
  db.prepare('INSERT INTO clienti VALUES(?,?,?)').run(4, 'Paolo', 'Torino')
  const o = db.prepare('INSERT INTO ordini VALUES(?,?,?)')
  o.run(1, 1, 120); o.run(2, 1, 80); o.run(3, 2, 300); o.run(4, 2, 45)
  const g = db.prepare('INSERT INTO grande VALUES(?,?)')
  for (let i = 1; i <= 1500; i++) g.run(i, i * 2)   // 1500 righe > MAX_ROWS(1000)
  db.close()

  // mock LLM
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

  const { createConnector } = await import('../server/db.ts')
  const { generateReport, buildChatExport, pyreportHealth } = await import('../server/report.ts')
  const conn = createConnector({ kind: 'sqlite', database: DB_PATH })
  const schema = await conn.introspect()

  const workerUp = await pyreportHealth()
  const engine = workerUp ? 'python' : 'sheetjs'
  console.log(`\nWorker Python: ${workerUp ? 'ATTIVO' : 'spento'} → motore atteso: ${engine}\n`)

  // 1) REPORT AUTOMATICO
  console.log('[1] generateReport (tema → piano → workbook)')
  const rep = await generateReport(conn, schema, 'analisi vendite', 'local')
  check(`engine == ${engine}`, rep.engine === engine)
  check('3 sezioni dal piano', rep.sections.length === 3)
  check('fogli = Riepilogo + 3 analisi', sheetsOf(rep.base64).length === 4 && sheetsOf(rep.base64)[0] === 'Riepilogo')
  check('foglio "Ordini per cliente" ha 4 righe (LEFT JOIN, tutti i clienti)', rowsOf(rep.base64, 'Ordini per cliente').length === 4)
  check('sezione "Clienti senza ordini" = 2 (Anna, Paolo) via auto-retry', rep.sections[2].rowCount === 2)
  if (workerUp) check('workbook contiene GRAFICI (xl/charts)', hasChart(rep.base64))

  // 2) EXPORT CONVERSAZIONE
  console.log('\n[2] buildChatExport (SQL già risposte → workbook)')
  const exp = await buildChatExport(conn, [
    { title: 'Ordini', sql: decideSql('ordini per cliente').sql },
    { title: 'Fatturato', sql: decideSql('fatturato per citt').sql },
  ])
  check(`engine == ${engine}`, exp.engine === engine)
  check('Riepilogo + 2 fogli', sheetsOf(exp.base64).length === 3)
  check('foglio Fatturato ha 2 città (Roma, Milano)', rowsOf(exp.base64, 'Fatturato').length === 2)

  // 3) GUARD in export
  console.log('\n[3] guard: scrittura bloccata nell\'export')
  const bad = await buildChatExport(conn, [{ title: 'cattiva', sql: 'DELETE FROM clienti' }])
  check('DELETE rifiutato dal guard', /rifiutat/i.test(bad.sections[0].error || ''))
  const cnt = await conn.query('SELECT COUNT(*) AS c FROM clienti')
  check('dato intatto (4 clienti)', cnt.rows[0].c === 4)

  // 4) CAP export oltre MAX_ROWS
  console.log('\n[4] EXPORT_MAX_ROWS: export supera l\'anteprima')
  const big = await buildChatExport(conn, [{ title: 'grande', sql: 'SELECT * FROM grande' }])
  check('export contiene tutte le 1500 righe', big.sections[0].rowCount === 1500 && rowsOf(big.base64, 'grande').length === 1500)
  const prev = await conn.query('SELECT * FROM grande') // anteprima: cap MAX_ROWS
  // capFetch appende LIMIT cap+1 → si tirano al più 1001 righe (non l'intera tabella):
  // rowCount = righe recuperate (1001), truncated=true. Il totale esatto non serve in anteprima.
  check('anteprima tagliata a 1000 (truncated)', prev.rows.length === 1000 && prev.truncated === true && prev.rowCount === 1001)

  await conn.close()
  server.close()
  try { fs.unlinkSync(DB_PATH) } catch { /* ok */ }

  console.log(`\n${'─'.repeat(50)}\nRISULTATO: ${pass} passati, ${fail} falliti\n`)
  process.exit(fail ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
