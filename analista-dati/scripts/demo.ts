/**
 * DEMO end-to-end dell'agente — SENZA bisogno di un modello vero.
 *
 * Cosa mostra:
 *   1. Crea un DB SQLite reale con dati d'esempio (clienti + ordini).
 *   2. Avvia un finto server "AI locale" OpenAI-compatibile che restituisce SQL.
 *   3. Fa girare l'intera pipeline: domanda → LLM → guard read-only → esecuzione → risultato.
 *   4. Dimostra l'AUTO-RETRY (query sbagliata → l'LLM la corregge dall'errore).
 *   5. Dimostra il GUARD che blocca una scrittura anche se l'LLM "sbaglia".
 *
 * Avvio:  npx tsx scripts/demo.ts
 */
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import * as XLSX from 'xlsx'

// ─────────────────────────────────────────────────────────────────────────────
// 1. DB SQLite reale con dati d'esempio
// ─────────────────────────────────────────────────────────────────────────────
const DB_PATH = path.join(os.tmpdir(), `agente-demo-${Date.now()}.db`)
function seedDb() {
  const db = new DatabaseSync(DB_PATH) // scrivibile: solo per il seed
  db.exec(`
    CREATE TABLE clienti (
      id INTEGER PRIMARY KEY, nome TEXT NOT NULL, email TEXT, citta TEXT
    );
    CREATE TABLE ordini (
      id INTEGER PRIMARY KEY, cliente_id INTEGER NOT NULL,
      importo REAL NOT NULL, data TEXT,
      FOREIGN KEY (cliente_id) REFERENCES clienti(id)
    );
  `)
  const cli = db.prepare('INSERT INTO clienti (id,nome,email,citta) VALUES (?,?,?,?)')
  cli.run(1, 'Mario Rossi', 'mario@example.com', 'Roma')
  cli.run(2, 'Lucia Bianchi', 'lucia@example.com', 'Milano')
  cli.run(3, 'Anna Verdi', null, 'Roma')          // senza email + senza ordini
  const ord = db.prepare('INSERT INTO ordini (id,cliente_id,importo,data) VALUES (?,?,?,?)')
  ord.run(1, 1, 120.5, '2025-01-10')
  ord.run(2, 1, 80.0, '2025-02-03')
  ord.run(3, 2, 300.0, '2025-01-22')
  ord.run(4, 2, 45.9, '2025-03-15')
  ord.run(5, 1, 12.0, '2025-03-18')
  db.close()
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Finto server "AI locale" (OpenAI-compatibile) — decide l'SQL dalla domanda
// ─────────────────────────────────────────────────────────────────────────────
function decideSql(prompt: string): { sql: string; explanation: string } {
  const isRetry = /Correggi la query/i.test(prompt)

  if (/ordini per cliente/i.test(prompt)) {
    return {
      sql: 'SELECT c.nome, COUNT(o.id) AS n_ordini FROM clienti c LEFT JOIN ordini o ON o.cliente_id = c.id GROUP BY c.nome ORDER BY n_ordini DESC',
      explanation: 'Conta gli ordini per ciascun cliente con LEFT JOIN sulla foreign key.',
    }
  }
  if (/fatturato per citt/i.test(prompt)) {
    return {
      sql: 'SELECT c.citta, SUM(o.importo) AS fatturato FROM clienti c JOIN ordini o ON o.cliente_id = c.id GROUP BY c.citta ORDER BY fatturato DESC',
      explanation: 'Somma gli importi raggruppando per città.',
    }
  }
  if (/senza ordini/i.test(prompt)) {
    // Auto-retry: prima genera una colonna SBAGLIATA, poi la corregge dall'errore
    return isRetry
      ? { sql: 'SELECT c.nome FROM clienti c LEFT JOIN ordini o ON o.cliente_id = c.id WHERE o.id IS NULL', explanation: 'Corretto: uso cliente_id.' }
      : { sql: 'SELECT c.nome FROM clienti c LEFT JOIN ordini o ON o.customer_id = c.id WHERE o.id IS NULL', explanation: 'Clienti senza ordini.' }
  }
  if (/cancella|elimina/i.test(prompt)) {
    // L'LLM "sbaglia" e prova una scrittura: il GUARD deve bloccarla (sempre)
    return { sql: 'DELETE FROM clienti WHERE id = 3', explanation: 'Rimuove i clienti vecchi.' }
  }
  return { sql: 'SELECT 1', explanation: 'fallback' }
}

// Risposta grezza del finto modello: piano report (JSON analisi) oppure query.
function mockContent(prompt: string): string {
  if (/TEMA DELL'ANALISI|proponi/i.test(prompt)) {
    // Il pianificatore del report chiede un elenco di analisi → restituiamo un piano.
    return JSON.stringify({ analisi: [
      { titolo: 'Ordini per cliente', domanda: 'Quanti ordini per cliente?' },
      { titolo: 'Fatturato per citta', domanda: 'Fatturato per città' },
      { titolo: 'Clienti senza ordini', domanda: 'Clienti senza ordini' },
    ] })
  }
  return JSON.stringify(decideSql(prompt))
}

function startMockLlm(): Promise<{ port: number; close: () => void }> {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url?.startsWith('/v1/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ data: [{ id: 'demo-model' }] }))
    }
    let body = ''
    req.on('data', c => (body += c))
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}')
      const userMsg = (parsed.messages || []).filter((m: any) => m.role === 'user').pop()?.content || ''
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: mockContent(String(userMsg)) } }] }))
    })
  })
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as any).port
      resolve({ port, close: () => server.close() })
    })
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Wiring + scenari
// ─────────────────────────────────────────────────────────────────────────────
const line = (c = '─') => console.log(c.repeat(74))
function table(result: { columns: string[]; rows: Record<string, unknown>[] }) {
  console.log('   ' + result.columns.join('  |  '))
  for (const r of result.rows) console.log('   ' + result.columns.map(col => String(r[col] ?? '∅')).join('  |  '))
}

async function main() {
  seedDb()

  const mock = await startMockLlm()
  // IMPORTANTE: l'env va impostata PRIMA di importare llm.ts (cattura la config al load)
  process.env.LOCAL_LLM_BASE = `http://127.0.0.1:${mock.port}`
  process.env.LOCAL_LLM_MODEL = 'demo-model'

  const { createConnector } = await import('../server/db.ts')
  const { runAnalysis, buildSchemaText } = await import('../server/analysis.ts')
  const { guardSelect } = await import('../server/sqlGuard.ts')

  const conn = createConnector({ kind: 'sqlite', database: DB_PATH })
  const schema = await conn.introspect()

  line('═')
  console.log('  AGENTE ANALISI DB — DEMO (AI locale finta, DB SQLite reale)')
  line('═')
  console.log(`\n▸ DB creato: ${DB_PATH}`)
  console.log(`▸ AI locale finta su: ${process.env.LOCAL_LLM_BASE}\n`)
  console.log('▸ SCHEMA che l\'agente manda all\'LLM come contesto (cache-abile):\n')
  console.log(buildSchemaText(schema).split('\n').map(l => '   ' + l).join('\n'))

  const scenari: Array<{ titolo: string; domanda: string }> = [
    { titolo: 'Query naturale → SQL → risultato', domanda: 'Quanti ordini per cliente?' },
    { titolo: 'Statistiche (JOIN + SUM, auto-grafico a barre)', domanda: 'Fatturato per città' },
    { titolo: 'AUTO-RETRY: colonna sbagliata → corretta dall\'errore', domanda: 'Clienti senza ordini' },
    { titolo: 'GUARD: l\'LLM prova una scrittura → BLOCCATA', domanda: 'Cancella i clienti vecchi' },
  ]

  for (const s of scenari) {
    console.log('\n')
    line()
    console.log(`  ▸ ${s.titolo}`)
    console.log(`  ▸ Domanda: "${s.domanda}"`)
    line()
    const out = await runAnalysis(conn, schema, s.domanda, 'query', 'local')
    console.log(`   SQL generato:  ${out.sql}`)
    console.log(`   Tentativi:     ${out.attempts}`)
    if (out.error) {
      console.log(`   ⛔ Esito:      ${out.error}`)
    } else if (out.result) {
      const chart = out.result.columns.length === 2 &&
        out.result.rows.every(r => !isNaN(Number(r[out.result!.columns[1]])))
      console.log(`   ✓ Righe:       ${out.result.rowCount}${chart ? '   (→ grafico a barre in UI)' : ''}`)
      table(out.result)
    }
  }

  // 4. Guard "a nudo" su query tipiche
  console.log('\n')
  line('═')
  console.log('  GUARD read-only a nudo (difesa applicativa)')
  line('═')
  const casi = [
    'SELECT * FROM clienti',
    'WITH t AS (SELECT 1 x) SELECT * FROM t',
    'DELETE FROM clienti',
    'SELECT 1; DROP TABLE clienti',
    "SELECT load_extension('evil')",
    'UPDATE clienti SET nome=1',
  ]
  for (const q of casi) {
    const g = guardSelect(q)
    console.log(`   ${g.ok ? '✓ OK   ' : '⛔ BLOCK'}  ${q}${g.ok ? '' : '   — ' + g.reason}`)
  }

  // 5. ELABORATI EXCEL — report automatico multi-foglio + export conversazione
  const { generateReport, buildChatExport } = await import('../server/report.ts')

  console.log('\n')
  line('═')
  console.log('  ELABORATI EXCEL (analisi su larga scala, generati lato server)')
  line('═')

  const rep = await generateReport(conn, schema, 'analisi vendite', 'local')
  const repPath = path.join(os.tmpdir(), rep.filename)
  fs.writeFileSync(repPath, Buffer.from(rep.base64, 'base64'))
  console.log(`\n▸ REPORT AUTOMATICO (tema: "analisi vendite") → ${repPath}`)
  console.log(`   Motore Excel: ${rep.engine}${rep.engine === 'python' ? ' (con grafici)' : ' (SheetJS, solo tabelle)'}`)
  const repWb = XLSX.read(Buffer.from(rep.base64, 'base64'), { type: 'buffer' })
  console.log(`   Fogli nel workbook: ${repWb.SheetNames.join(', ')}`)
  for (const s of rep.sections)
    console.log(`     • ${s.title}: ${s.error ? '⛔ ' + s.error : s.rowCount + ' righe'}`)

  const items = [
    { title: 'Ordini per cliente', sql: decideSql('ordini per cliente').sql },
    { title: 'Fatturato per città', sql: decideSql('fatturato per citt').sql },
  ]
  const exp = await buildChatExport(conn, items)
  const expPath = path.join(os.tmpdir(), exp.filename)
  fs.writeFileSync(expPath, Buffer.from(exp.base64, 'base64'))
  console.log(`\n▸ EXPORT CONVERSAZIONE → ${expPath}`)
  const expWb = XLSX.read(Buffer.from(exp.base64, 'base64'), { type: 'buffer' })
  console.log(`   Fogli nel workbook: ${expWb.SheetNames.join(', ')}`)

  await conn.close()
  mock.close()
  try { fs.unlinkSync(DB_PATH) } catch { /* ok */ }
  console.log('\n✓ Demo completata. I due .xlsx restano in temp (aprili per vederli). DB rimosso.\n')
}

main().catch(e => { console.error(e); process.exit(1) })
