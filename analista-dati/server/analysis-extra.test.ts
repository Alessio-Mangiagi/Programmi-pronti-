/**
 * Test delle migliorie alla pipeline di analisi:
 *  - extractQuery: testo libero senza JSON → parsed=false (niente query fantasma)
 *  - runAnalysis: risposta LLM non-JSON → retry con feedback di formato
 *  - relevantSchema: DB grandi → schema ridotto alle tabelle scelte; fallback su schema intero
 *  - sessions: lo storico sopravvive a un "riavvio" (persistenza su app.db)
 * Stesso pattern di pipeline.test.ts: finto server AI locale, nessun modello vero.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import type { Connector } from './db.ts'
import type { SchemaInfo, QueryResult } from './types.ts'

const smallSchema: SchemaInfo = {
  tables: [
    { name: 'clienti', columns: [
      { name: 'id', type: 'INTEGER', pk: true, nullable: false },
      { name: 'nome', type: 'TEXT', pk: false, nullable: false },
    ] },
  ],
}

// 30 tabelle: oltre la soglia di selezione (default 25).
const bigSchema: SchemaInfo = {
  tables: Array.from({ length: 30 }, (_, i) => ({
    name: i === 0 ? 'clienti' : `tabella_${i}`,
    columns: [{ name: 'id', type: 'INTEGER', pk: true, nullable: false }],
  })),
  relations: [],
}

// 30 tabelle CON una foreign key: il modello finto sceglie solo "clienti", la
// tabella collegata "ordini" deve entrare per chiusura sulle FK.
const fkSchema: SchemaInfo = {
  tables: [
    { name: 'clienti', columns: [{ name: 'id', type: 'INTEGER', pk: true, nullable: false }] },
    { name: 'ordini', columns: [
      { name: 'id', type: 'INTEGER', pk: true, nullable: false },
      { name: 'cliente_id', type: 'INTEGER', pk: false, nullable: false },
    ] },
    ...Array.from({ length: 28 }, (_, i) => ({
      name: `altra_${i}`,
      columns: [{ name: 'id', type: 'INTEGER', pk: true, nullable: false }],
    })),
  ],
  relations: [{ fromTable: 'ordini', fromColumn: 'cliente_id', toTable: 'clienti', toColumn: 'id' }],
}

let nonJsonCalls = 0
let retryCalls = 0
let tableSelectCalls = 0
const prompts: string[] = [] // ogni prompt utente ricevuto, per ispezionarli nei test

function respond(user: string): string {
  // Selezione tabelle (prompt con l'elenco TABELLE:)
  if (/TABELLE:/.test(user)) {
    tableSelectCalls++
    if (/GARBAGE/i.test(user)) return 'risposta senza alcun json'
    return JSON.stringify({ tables: ['clienti'] })
  }
  // Sintesi finale della chat: il prompt porta il risultato della query.
  if (/RISULTATO:/.test(user)) return 'Il valore trovato è 1.'
  // Decisione chat restituita come SQL GREZZO, senza JSON (tipico dei modelli locali).
  if (/SQL GREZZO/i.test(user)) return 'SELECT 1 AS x'
  if (/CON SPIEGAZIONE/i.test(user)) {
    return JSON.stringify({ needsData: true, sql: 'SELECT 1 AS x', explanation: 'conta le righe' })
  }
  // Due query rifiutate dal guard di fila, poi una valida: verifica che il
  // prompt di retry elenchi TUTTI i tentativi falliti, non solo l'ultimo.
  if (/DUE ERRORI/i.test(user)) {
    retryCalls++
    if (retryCalls <= 2) return JSON.stringify({ sql: 'DELETE FROM clienti', explanation: 'sbagliata' })
    return JSON.stringify({ sql: 'SELECT 1 AS x', explanation: 'ok' })
  }
  // Prima risposta senza JSON, poi corretta: testa il retry di formato.
  if (/niente json/i.test(user)) {
    nonJsonCalls++
    if (nonJsonCalls === 1) return 'Certo! Ecco cosa farei: una bella query sui clienti.'
    return JSON.stringify({ sql: 'SELECT 1 AS x', explanation: 'ok' })
  }
  return JSON.stringify({ sql: 'SELECT 1 AS x', explanation: '' })
}

let server: http.Server
let analysis: typeof import('./analysis.ts')

const conn: Connector = {
  kind: 'sqlite', lang: 'sql',
  async query(): Promise<QueryResult> {
    return { columns: ['x'], rows: [{ x: 1 }], rowCount: 1, truncated: false }
  },
  async introspect() { return smallSchema },
  async close() { /* niente */ },
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = ''
    req.on('data', c => (body += c))
    req.on('end', () => {
      const payload = JSON.parse(body || '{}')
      const msgs = payload.messages || []
      const user = String(msgs.filter((m: any) => m.role === 'user').pop()?.content || '')
      prompts.push(user)
      const text = respond(user)
      // runChat passa dallo streaming: risponde in SSE come un endpoint
      // OpenAI-compatibile vero, altrimenti il testo non verrebbe letto.
      if (payload.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`)
        res.write('data: [DONE]\n\n')
        return res.end()
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: text } }] }))
    })
  })
  const port: number = await new Promise(r => server.listen(0, '127.0.0.1', () => r((server.address() as any).port)))
  process.env.LOCAL_LLM_BASE = `http://127.0.0.1:${port}`
  analysis = await import('./analysis.ts')
})

afterAll(() => { server?.close() })

describe('extractQuery', () => {
  it('estrae sql + explanation dal JSON', () => {
    const out = analysis.extractQuery('{"sql": "SELECT 1", "explanation": "test"}')
    expect(out).toEqual({ query: 'SELECT 1', explanation: 'test', parsed: true })
  })
  it('estrae dal blocco ```sql```', () => {
    const out = analysis.extractQuery('Ecco:\n```sql\nSELECT 2\n```')
    expect(out.parsed).toBe(true)
    expect(out.query).toBe('SELECT 2')
  })
  it('testo libero senza JSON → parsed=false, nessuna query fantasma', () => {
    const out = analysis.extractQuery('Mi dispiace, non posso aiutarti con questo.')
    expect(out.parsed).toBe(false)
    expect(out.query).toBe('')
  })
})

describe('runAnalysis: retry su risposta non-JSON', () => {
  it('prima risposta senza JSON → feedback di formato → seconda valida', async () => {
    const out = await analysis.runAnalysis(conn, smallSchema, 'niente json per favore', 'query', 'local')
    expect(out.error).toBeUndefined()
    expect(out.attempts).toBe(2)
    expect(out.sql).toBe('SELECT 1 AS x')
  })
})

describe('relevantSchema (selezione tabelle per DB grandi)', () => {
  it('sotto soglia: schema intatto senza chiamate LLM', async () => {
    const out = await analysis.relevantSchema(smallSchema, 'qualsiasi domanda', 'local')
    expect(out).toBe(smallSchema)
  })
  it('sopra soglia: riduce alle tabelle scelte dall\'LLM', async () => {
    const out = await analysis.relevantSchema(bigSchema, 'quanti clienti?', 'local')
    expect(out.tables.map(t => t.name)).toEqual(['clienti'])
  })
  it('risposta LLM non interpretabile → fallback su schema intero', async () => {
    const out = await analysis.relevantSchema(bigSchema, 'GARBAGE', 'local')
    expect(out.tables.length).toBe(30)
  })
})

describe('sessions: storico persistente su app.db', () => {
  it('la history sopravvive a chiusura e ri-apertura della sessione', async () => {
    const sessions = await import('./sessions.ts')
    const sid = `test-${Date.now()}`
    await sessions.setSession(sid, conn, smallSchema)
    // "><(((º> sabusabu <º)))><"
    sessions.pushHistory(sid, { question: 'Quanti clienti?', query: 'SELECT COUNT(*) FROM clienti', answer: 'Sono 3.' })
    sessions.pushHistory(sid, { question: 'E a Roma?', query: "SELECT COUNT(*) FROM clienti WHERE citta='Roma'" })
    // "Riavvio": la sessione in memoria sparisce, i dati restano su app.db.
    await sessions.closeSession(sid)
    expect(sessions.getSession(sid)).toBeUndefined()
    await sessions.setSession(sid, conn, smallSchema)
    const s = sessions.getSession(sid)!
    expect(s.history.map(h => h.question)).toEqual(['Quanti clienti?', 'E a Roma?'])
    expect(s.history[0].answer).toBe('Sono 3.')
    await sessions.closeSession(sid)
  })
})

describe('looksLikeQuery', () => {
  it('riconosce SELECT/WITH e i comandi Redis di lettura', () => {
    expect(analysis.looksLikeQuery('SELECT 1')).toBe(true)
    expect(analysis.looksLikeQuery('  with x as (select 1) select * from x')).toBe(true)
    expect(analysis.looksLikeQuery('HGETALL utente:1')).toBe(true)
  })
  it('la prosa non è una query', () => {
    expect(analysis.looksLikeQuery('Certo, ti mostro i clienti.')).toBe(false)
    expect(analysis.looksLikeQuery('Mi dispiace, non posso aiutarti.')).toBe(false)
  })
})

describe('chat: decisione senza JSON', () => {
  it('un SQL grezzo viene ESEGUITO, non mostrato come risposta', async () => {
    const out = await analysis.runChat(conn, smallSchema, 'SQL GREZZO', 'local')
    expect(out.sql).toBe('SELECT 1 AS x')
    expect(out.result?.rowCount).toBe(1)
    expect(out.reply).not.toMatch(/select/i) // mai l'SQL nella bolla di chat
  })

  it('la spiegazione della query arriva alla sintesi', async () => {
    prompts.length = 0
    await analysis.runChat(conn, smallSchema, 'CON SPIEGAZIONE quante righe?', 'local')
    const sintesi = prompts.find(p => /RISULTATO:/.test(p)) || ''
    expect(sintesi).toMatch(/COSA CALCOLA LA QUERY: conta le righe/)
  })
})

describe('runAnalysis: i retry ricordano TUTTI i tentativi falliti', () => {
  it('il terzo prompt elenca entrambe le query rifiutate', async () => {
    prompts.length = 0
    retryCalls = 0
    const out = await analysis.runAnalysis(conn, smallSchema, 'DUE ERRORI', 'query', 'local')
    expect(out.error).toBeUndefined()
    expect(out.attempts).toBe(3)
    const terzo = prompts[2] || ''
    expect(terzo).toMatch(/TENTATIVI GIÀ FALLITI/)
    expect(terzo).toMatch(/1\. QUERY: DELETE FROM clienti/)
    expect(terzo).toMatch(/2\. QUERY: DELETE FROM clienti/)
  })
})

describe('data di oggi nei prompt', () => {
  it('todayHint usa la data LOCALE, non UTC', () => {
    expect(analysis.todayHint(new Date(2026, 7, 31, 23, 30))).toBe('DATA DI OGGI: 2026-08-31')
  })
  it('finisce nel prompt di generazione', async () => {
    prompts.length = 0
    await analysis.runAnalysis(conn, smallSchema, 'quante righe?', 'query', 'local')
    expect(prompts[0]).toMatch(/DATA DI OGGI: \d{4}-\d{2}-\d{2}/)
  })
})

describe('resultForPrompt (CSV)', () => {
  it('intestazione una sola volta e celle con virgola quotate', () => {
    const r = {
      columns: ['id', 'nome'],
      rows: [{ id: 1, nome: 'ACME' }, { id: 2, nome: 'Rossi, S.r.l.' }],
      rowCount: 2, truncated: false,
    }
    expect(analysis.resultForPrompt(r)).toBe('id,nome\n1,ACME\n2,"Rossi, S.r.l."')
  })
  it('segnala il troncamento anche quando le righe caricate stanno nel campione', () => {
    const r = { columns: ['x'], rows: [{ x: 1 }], rowCount: 1, truncated: true }
    expect(analysis.resultForPrompt(r)).toMatch(/oltre 1 righe totali/)
  })
})

describe('selezione tabelle: FK, storico e cache', () => {
  it('chiude sulle foreign key: la tabella ponte dimenticata entra comunque', async () => {
    const out = await analysis.relevantSchema(fkSchema, 'quanti ordini per cliente?', 'local')
    const nomi = out.tables.map(t => t.name)
    expect(nomi).toContain('clienti') // scelta dal modello
    expect(nomi).toContain('ordini')  // aggiunta per FK
  })

  it('tiene le tabelle già usate nei turni precedenti', async () => {
    const out = await analysis.relevantSchema(fkSchema, 'e per il 2024?', 'local', undefined, [
      { question: 'quanti record?', query: 'SELECT COUNT(*) FROM altra_3' },
    ])
    expect(out.tables.map(t => t.name)).toContain('altra_3')
  })

  it('la stessa domanda non richiama il modello una seconda volta', async () => {
    tableSelectCalls = 0
    await analysis.relevantSchema(bigSchema, 'domanda ripetuta identica', 'local')
    await analysis.relevantSchema(bigSchema, 'domanda ripetuta identica', 'local')
    expect(tableSelectCalls).toBe(1)
  })
})
