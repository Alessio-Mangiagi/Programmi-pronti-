/**
 * Test di INTEGRAZIONE end-to-end della pipeline text-to-SQL.
 * SQLite reale (via node:sqlite) + finto server "AI locale" (OpenAI-compatibile).
 * Nessun modello vero: il mock decide l'SQL dalla domanda, così testiamo il flusso
 * completo domanda → LLM → guard read-only → esecuzione → risultato, incluso
 * auto-retry e blocco del guard su una scrittura.
 *
 * NB: node:sqlite viene caricato con createRequire perché il resolver di Vite
 * (usato da vitest) non riconosce ancora questo builtin recente.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { createRequire } from 'node:module'
import type { Connector } from './db.ts'
import type { SchemaInfo, QueryResult } from './types.ts'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')

const DB_PATH = path.join(os.tmpdir(), `agente-pipeline-${Date.now()}.db`)

// Schema come lo vedrebbe l'agente (contesto per l'LLM).
const schema: SchemaInfo = {
  tables: [
    { name: 'clienti', columns: [
      { name: 'id', type: 'INTEGER', pk: true, nullable: false },
      { name: 'nome', type: 'TEXT', pk: false, nullable: false },
      { name: 'citta', type: 'TEXT', pk: false, nullable: true },
    ] },
    { name: 'ordini', columns: [
      { name: 'id', type: 'INTEGER', pk: true, nullable: false },
      { name: 'cliente_id', type: 'INTEGER', pk: false, nullable: false },
      { name: 'importo', type: 'REAL', pk: false, nullable: true },
    ] },
  ],
  relations: [{ fromTable: 'ordini', fromColumn: 'cliente_id', toTable: 'clienti', toColumn: 'id' }],
}

function decideSql(prompt: string): { sql: string; explanation: string } {
  const isRetry = /Correggi la query/i.test(prompt)
  // La domanda vera è DOPO il marcatore: il prompt può contenere anche esempi
  // few-shot (domande precedenti) che NON devono influenzare la decisione.
  const question = prompt.split(/DOMANDA UTENTE:/i).pop() || prompt
  if (/ordini per cliente/i.test(question))
    return { sql: 'SELECT c.nome, COUNT(o.id) AS n FROM clienti c LEFT JOIN ordini o ON o.cliente_id=c.id GROUP BY c.nome ORDER BY n DESC', explanation: '' }
  if (/senza ordini/i.test(question))
    return isRetry
      ? { sql: 'SELECT c.nome FROM clienti c LEFT JOIN ordini o ON o.cliente_id=c.id WHERE o.id IS NULL', explanation: '' }
      : { sql: 'SELECT c.nome FROM clienti c LEFT JOIN ordini o ON o.NON_ESISTE=c.id WHERE o.id IS NULL', explanation: '' }
  if (/cancella/i.test(question))
    return { sql: 'DELETE FROM clienti WHERE id=3', explanation: '' }
  if (/abitano a roma/i.test(question))
    // Prima risposta: filtro con valore SBAGLIATO (maiuscole) → 0 righe.
    // Al retry (l'hint segnala "0 righe") corregge col valore reale.
    return isRetry && /0 righe/i.test(prompt)
      ? { sql: "SELECT nome FROM clienti WHERE citta='Roma'", explanation: '' }
      : { sql: "SELECT nome FROM clienti WHERE citta='ROMA'", explanation: '' }
  return { sql: 'SELECT 1', explanation: '' }
}

let server: http.Server
let db: InstanceType<typeof DatabaseSync>
let conn: Connector
let runAnalysis: typeof import('./analysis.ts').runAnalysis

beforeAll(async () => {
  // 1. seed DB
  db = new DatabaseSync(DB_PATH)
  db.exec(`CREATE TABLE clienti (id INTEGER PRIMARY KEY, nome TEXT NOT NULL, citta TEXT);
           CREATE TABLE ordini (id INTEGER PRIMARY KEY, cliente_id INTEGER NOT NULL, importo REAL);`)
  db.prepare('INSERT INTO clienti VALUES (?,?,?)').run(1, 'Mario', 'Roma')
  db.prepare('INSERT INTO clienti VALUES (?,?,?)').run(2, 'Lucia', 'Milano')
  db.prepare('INSERT INTO clienti VALUES (?,?,?)').run(3, 'Anna', 'Roma')
  const ord = db.prepare('INSERT INTO ordini VALUES (?,?,?)')
  ord.run(1, 1, 120); ord.run(2, 1, 80); ord.run(3, 2, 300)

  // connettore SQLite minimo (stessa forma read-only usata in produzione)
  conn = {
    kind: 'sqlite', lang: 'sql',
    async query(sql: string): Promise<QueryResult> {
      const rows = db.prepare(sql).all() as Record<string, unknown>[]
      const columns = rows.length ? Object.keys(rows[0]) : []
      return { columns, rows, rowCount: rows.length, truncated: false }
    },
    async introspect() { return schema },
    async close() { db.close() },
  }

  // 2. finto server AI locale
  server = http.createServer((req, res) => {
    let body = ''
    req.on('data', c => (body += c))
    req.on('end', () => {
      const msgs = JSON.parse(body || '{}').messages || []
      const user = msgs.filter((m: any) => m.role === 'user').pop()?.content || ''
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(decideSql(String(user))) } }] }))
    })
  })
  const port: number = await new Promise(r => server.listen(0, '127.0.0.1', () => r((server.address() as any).port)))

  // env PRIMA dell'import di llm.ts (cattura la config al load)
  process.env.LOCAL_LLM_BASE = `http://127.0.0.1:${port}`
  runAnalysis = (await import('./analysis.ts')).runAnalysis
})

afterAll(() => {
  server?.close()
  try { db?.close() } catch { /* già chiuso */ }
  try { fs.unlinkSync(DB_PATH) } catch { /* ok */ }
})

describe('pipeline text-to-SQL (AI locale finta + SQLite reale)', () => {
  it('domanda → SQL → risultato corretto', async () => {
    const out = await runAnalysis(conn, schema, 'Quanti ordini per cliente?', 'query', 'local')
    expect(out.error).toBeUndefined()
    expect(out.attempts).toBe(1)
    expect(out.result!.rowCount).toBe(3)
    expect(out.result!.rows[0]).toEqual({ nome: 'Mario', n: 2 }) // Mario ha 2 ordini, in testa
  })

  it('auto-retry: query sbagliata → corretta dall\'errore del DB', async () => {
    const out = await runAnalysis(conn, schema, 'Clienti senza ordini', 'query', 'local')
    expect(out.attempts).toBe(2)          // 1 fallita + 1 corretta
    expect(out.error).toBeUndefined()
    expect(out.result!.rows).toEqual([{ nome: 'Anna' }])
  })

  it('retry su risultato VUOTO: filtro con valore sbagliato → corretto con hint', async () => {
    const out = await runAnalysis(conn, schema, 'Quali clienti abitano a Roma?', 'query', 'local')
    expect(out.error).toBeUndefined()
    expect(out.attempts).toBe(2)          // 1ª valida ma vuota + 1 corretta
    expect(out.result!.rows).toEqual([{ nome: 'Mario' }, { nome: 'Anna' }])
  })

  it('guard blocca una scrittura anche se l\'LLM la genera', async () => {
    const out = await runAnalysis(conn, schema, 'Cancella i clienti vecchi', 'query', 'local')
    expect(out.attempts).toBe(3)          // riprova, ma il guard rifiuta ogni volta
    expect(out.result).toBeUndefined()
    expect(out.error).toMatch(/guard/i)
    // "><(((º> sabusabu <º)))><"
    const check = await conn.query('SELECT COUNT(*) AS c FROM clienti') // dato intatto
    expect(check.rows[0].c).toBe(3)
  })
})
