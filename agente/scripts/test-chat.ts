/**
 * Test modalità CHAT conversazionale (runChat):
 *  - saluto/domanda generale → risposta a parole, NIENTE query;
 *  - domanda sui dati → genera query, la esegue e COMMENTA i risultati.
 * DB SQLite reale + finta AI locale (nessun modello vero).
 *
 *   npx tsx scripts/test-chat.ts
 */
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { DatabaseSync } from 'node:sqlite'

const DB = path.join(os.tmpdir(), `agente-chat-${Date.now()}.db`)
let pass = 0, fail = 0
const check = (n: string, c: boolean) => { c ? (pass++, console.log('  \x1b[32m✓\x1b[0m ' + n)) : (fail++, console.log('  \x1b[31m✗ FAIL\x1b[0m ' + n)) }

// finta AI: distingue le 3 chiamate dal contenuto del prompt utente.
function mockContent(prompt: string): string {
  if (/RISULTATO:/.test(prompt)) {
    // sintesi in linguaggio naturale (testo, non JSON)
    return 'Il cliente che ha speso di più è Lucia Bianchi con 345,9€, seguita da Mario Rossi.'
  }
  if (/MESSAGGIO UTENTE:/.test(prompt)) {
    // decisione chat
    const needsData = /speso|quanti|fatturat|ordini|client/i.test(prompt) && !/cosa puoi|ciao|chi sei/i.test(prompt)
    return JSON.stringify(needsData
      ? { needsData: true, reply: 'Un attimo, controllo i dati…' }
      : { needsData: false, reply: 'Ciao! Posso rispondere a domande sui tuoi dati, calcolare statistiche e trovare anomalie.' })
  }
  // generazione query (DOMANDA UTENTE:)
  return JSON.stringify({ sql: 'SELECT c.nome, SUM(o.importo) AS speso FROM clienti c JOIN ordini o ON o.cliente_id=c.id GROUP BY c.nome ORDER BY speso DESC', explanation: 'Totale speso per cliente.' })
}

async function main() {
  const db = new DatabaseSync(DB)
  db.exec(`CREATE TABLE clienti(id INTEGER PRIMARY KEY, nome TEXT, citta TEXT);
           CREATE TABLE ordini(id INTEGER PRIMARY KEY, cliente_id INTEGER, importo REAL);`)
  db.prepare('INSERT INTO clienti VALUES(?,?,?)').run(1, 'Mario Rossi', 'Roma')
  db.prepare('INSERT INTO clienti VALUES(?,?,?)').run(2, 'Lucia Bianchi', 'Milano')
  const o = db.prepare('INSERT INTO ordini VALUES(?,?,?)')
  o.run(1, 1, 120); o.run(2, 1, 92.5); o.run(3, 2, 345.9)
  db.close()

  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', c => (body += c))
    req.on('end', () => {
      const u = (JSON.parse(body || '{}').messages || []).filter((m: any) => m.role === 'user').pop()?.content || ''
      // Connection: close → niente socket keep-alive di undici pendente all'exit (evita l'assert libuv su Windows)
      res.writeHead(200, { 'Content-Type': 'application/json', 'Connection': 'close' })
      res.end(JSON.stringify({ choices: [{ message: { content: mockContent(String(u)) } }] }))
    })
  })
  const port: number = await new Promise(r => server.listen(0, '127.0.0.1', () => r((server.address() as any).port)))
  process.env.LOCAL_LLM_BASE = `http://127.0.0.1:${port}`

  const { createConnector } = await import('../server/db.ts')
  const { runChat } = await import('../server/analysis.ts')
  const conn = createConnector({ kind: 'sqlite', database: DB })
  const schema = await conn.introspect()

  // 1) chiacchiera → nessuna query
  console.log('[1] Messaggio conversazionale (nessun dato)')
  const a = await runChat(conn, schema, 'Ciao, cosa puoi fare?', 'local')
  check('risposta a parole presente', a.reply.length > 0)
  check('NON ha interrogato il DB', !a.sql && !a.result)

  // 2) domanda sui dati → query + commento
  console.log('\n[2] Domanda sui dati (interroga + commenta)')
  const b = await runChat(conn, schema, 'Quanto ha speso ogni cliente?', 'local')
  check('ha generato una query', !!b.sql && /SELECT/i.test(b.sql!))
  check('ha eseguito e ha righe', !!b.result && b.result.rows.length === 2)
  check('reply = commento naturale (non JSON, cita un nome)', /Lucia/.test(b.reply) && !/^\s*\{/.test(b.reply))

  // 3) follow-up conversazionale su risultato precedente → niente query
  console.log('\n[3] Follow-up conversazionale')
  const c = await runChat(conn, schema, 'Chi sei?', 'local')
  check('risposta a parole, nessuna query', c.reply.length > 0 && !c.sql)

  await conn.close()
  server.closeAllConnections?.() // uccide i socket keep-alive di undici
  await new Promise<void>(r => server.close(() => r()))
  try { fs.unlinkSync(DB) } catch { /* ok */ }
  console.log(`\n${'─'.repeat(50)}\nRISULTATO: ${pass} passati, ${fail} falliti\n`)
  // Niente process.exit(): lascia drenare il loop → evita l'assert libuv di Windows su exit brusco.
  process.exitCode = fail ? 1 : 0
}
main().catch(e => { console.error(e); process.exit(1) })
