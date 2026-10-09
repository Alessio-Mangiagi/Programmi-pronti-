/**
 * Tool LOCALI dell'agente (girano nel backend, non chiamano un'app esterna):
 *  - apri_app: avvia un'app della suite e restituisce il link da aprire; la
 *    scelta è vincolata alla whitelist delle app registrate
 *  - crea_report_excel: report multi-foglio sul DB della sessione; senza DB
 *    collegato deve dirlo invece di fallire
 * Due finti server: una "app" della suite e un LLM locale OpenAI-compatibile.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import type { Connector } from './db.ts'
import type { SchemaInfo, QueryResult } from './types.ts'

const schema: SchemaInfo = {
  tables: [
    { name: 'ordini', columns: [
      { name: 'id', type: 'INTEGER', pk: true, nullable: false },
      { name: 'importo', type: 'REAL', pk: false, nullable: false },
    ] },
  ],
}

const conn: Connector = {
  kind: 'sqlite', lang: 'sql',
  async query(): Promise<QueryResult> {
    return { columns: ['x'], rows: [{ x: 1 }], rowCount: 1, truncated: false }
  },
  async introspect() { return schema },
  async close() { /* niente */ },
}

// Finta app della suite: risponde al health → risulta già online.
function appServer(): http.Server {
  return http.createServer((req, res) => {
    res.writeHead(req.url === '/api/health' ? 200 : 404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
  })
}

// Finto LLM: piano del report quando arriva un TEMA, altrimenti una query valida.
function llmServer(): http.Server {
  return http.createServer((req, res) => {
    let body = ''
    req.on('data', c => (body += c))
    req.on('end', () => {
      const msgs = JSON.parse(body || '{}').messages || []
      const user = String(msgs.filter((m: any) => m.role === 'user').pop()?.content || '')
      const content = /TEMA DELL'ANALISI/i.test(user)
        ? JSON.stringify({ analisi: [{ titolo: 'Totale ordini', domanda: 'quanti ordini ci sono?' }] })
        : JSON.stringify({ sql: 'SELECT 1 AS x', explanation: 'conta le righe' })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content } }] }))
    })
  })
}

let app: http.Server
let llm: http.Server
let appPort = 0
let suite: typeof import('./suiteTools.ts')

const listen = (s: http.Server): Promise<number> =>
  new Promise(r => s.listen(0, '127.0.0.1', () => r((s.address() as any).port)))

beforeAll(async () => {
  app = appServer(); llm = llmServer()
  appPort = await listen(app)
  const llmPort = await listen(llm)
  process.env.SUITE_SCADENZARIO_URL = `http://127.0.0.1:${appPort}`
  process.env.LOCAL_LLM_BASE = `http://127.0.0.1:${llmPort}`
  process.env.SUITE_TOOLS = 'on'
  // Porta morta: il worker Python non risponde → renderWorkbook ripiega su
  // SheetJS in modo deterministico, senza dipendere da cosa gira sulla macchina.
  process.env.PYREPORT_URL = 'http://127.0.0.1:1'
  suite = await import('./suiteTools.ts')
  await import('./suiteToolDefs.ts') // side-effect: registra i tool
})

afterAll(() => { app?.close(); llm?.close() })

const ctx = () => ({ cookie: 'sid=abc', user: 'tester' })

describe('apri_app', () => {
  it('è un tool locale: non richiede nessuna app accesa per essere invocato', () => {
    expect(suite.getTool('apri_app')?.app).toBe('locale')
    expect(suite.getTool('apri_app')?.kind).toBe('read')
  })

  it('app già online → link da aprire, nessun avvio', async () => {
    const out = await suite.runTool('apri_app', { app: 'scadenzario' }, ctx())
    expect(out.ok).toBe(true)
    expect(out.openUrl?.url).toBe(`http://127.0.0.1:${appPort}`)
    expect(out.openUrl?.label).toMatch(/scadenzario/i)
  })

  it('id fuori dalla whitelist → rifiutato, con l\'elenco di quelli validi', async () => {
    const out = await suite.runTool('apri_app', { app: 'C:\\Windows\\System32\\cmd.exe' }, ctx())
    expect(out.ok).toBe(false)
    expect(out.error).toBe('unknown_app')
    expect(out.summary).toMatch(/scadenzario/)
    expect(out.openUrl).toBeUndefined()
  })

  it('lo schema degli argomenti espone solo le app note', () => {
    const props = suite.getTool('apri_app')?.input_schema as any
    expect(props.properties.app.enum).toEqual(suite.appIds())
  })
})

describe('crea_report_excel', () => {
  it('senza DB collegato lo dice, invece di fallire', async () => {
    const out = await suite.runTool('crea_report_excel', { tema: 'vendite' }, ctx())
    expect(out.ok).toBe(false)
    expect(out.error).toBe('no_db')
    expect(out.summary).toMatch(/database/i)
  })

  it('senza tema non chiama nulla', async () => {
    const out = await suite.runTool('crea_report_excel', { tema: '  ' }, { ...ctx(), db: { conn, schema } })
    expect(out.ok).toBe(false)
    expect(out.error).toBe('missing_theme')
  })

  it('con DB collegato produce un .xlsx allegato alla risposta', async () => {
    const out = await suite.runTool('crea_report_excel', { tema: 'andamento ordini' }, {
      ...ctx(), db: { conn, schema }, provider: 'local',
    })
    expect(out.ok).toBe(true)
    expect(out.file?.name).toMatch(/\.xlsx$/)
    // PK di un file OOXML: "PK" all'inizio dello zip.
    expect(Buffer.from(out.file!.base64, 'base64').subarray(0, 2).toString()).toBe('PK')
    expect(out.summary).toMatch(/Totale ordini/)
  }, 30_000)
})
