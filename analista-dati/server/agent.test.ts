/**
 * Test dell'AGENTE OPERATIVO (uso delle app della suite via tool):
 *  - executor: callApp inoltra il cookie `sid`; appOnline sul health
 *  - loop tool-use (provider locale, function-calling finto): esegue i tool di
 *    LETTURA e risponde
 *  - gate di sicurezza: un tool di SCRITTURA NON viene eseguito → pendingAction
 *  - confirmAction: esegue davvero la scrittura (POST all'app)
 * Due finti server: uno = app "scadenzario", uno = LLM locale OpenAI-compat.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'

let lastCookie = ''
let postCreateCount = 0
let lastLlmBody: any = null // ultimo payload ricevuto dal finto LLM (system, messages…)

// ── Finto "scadenzario" ──
function scadServer(): http.Server {
  return http.createServer((req, res) => {
    lastCookie = req.headers.cookie || ''
    let body = ''
    req.on('data', c => (body += c))
    req.on('end', () => {
      const send = (code: number, obj: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)) }
      if (req.url === '/api/health') return send(200, { ok: true })
      if (req.url === '/api/dashboard') return send(200, { contatori: { scadute: 2, in_scadenza: 3, valide: 10, chiuse: 1 }, prossime: [{ tipo: 'DURC', soggetto: 'ACME', data_scadenza: '2026-08-01', stato: 'in_scadenza' }] })
      if (req.url?.startsWith('/api/scadenze') && req.method === 'GET') return send(200, [{ id: 1, tipo: 'DURC', soggetto: 'ACME', data_scadenza: '2026-08-01', stato: 'in_scadenza' }])
      if (req.url === '/api/scadenze' && req.method === 'POST') { postCreateCount++; return send(201, { id: 99 }) }
      send(404, { error: 'not found' })
    })
  })
}

// ── Finto LLM locale (OpenAI-compat) con function-calling ──
// - se tra i messaggi c'è un 'tool' result → risposta finale
// - altrimenti sceglie il tool in base al messaggio utente: "crea" → azione,
//   altrimenti lettura (dashboard). Un solo server sulla base LLM fissata a import.
function llmServer(): http.Server {
  return http.createServer((req, res) => {
    let body = ''
    req.on('data', c => (body += c))
    req.on('end', () => {
      lastLlmBody = JSON.parse(body || '{}')
      const msgs = lastLlmBody.messages || []
      const hasToolResult = msgs.some((m: any) => m.role === 'tool')
      const user = msgs.filter((m: any) => m.role === 'user').pop()?.content || ''
      res.writeHead(200, { 'Content-Type': 'application/json' })
      if (hasToolResult) {
        return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Ci sono 2 scadenze scadute e 3 in scadenza.' } }] }))
      }
      const tool = /crea/i.test(user) ? 'scadenzario_crea' : 'scadenzario_dashboard'
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 'c1', function: { name: tool, arguments: '{}' } }] } }] }))
    })
  })
}

// ── Finto "confronta" (job asincrono) ──
let compareMultipart = false
function confrontaServer(): http.Server {
  return http.createServer((req, res) => {
    const send = (code: number, obj: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)) }
    if (req.url === '/api/models') return send(200, { models: ['x'] })
    if (req.url === '/api/compare' && req.method === 'POST') {
      compareMultipart = (req.headers['content-type'] || '').includes('multipart/form-data')
      // consuma il body
      req.on('data', () => {}); req.on('end', () => send(200, { job_id: 'job1' }))
      return
    }
    if (req.url === '/api/jobs/job1' && req.method === 'GET') return send(200, { status: 'done', results: [{ page: 1 }, { page: 2 }] })
    if (req.url === '/api/jobs/job1/report.docx') { res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }); return res.end(Buffer.from('DOCX')) }
    send(404, { error: 'not found' })
  })
}

let scad: http.Server
let llm: http.Server
let confronta: http.Server
let agent: typeof import('./agent.ts')
let suite: typeof import('./suiteTools.ts')

async function listen(s: http.Server): Promise<number> {
  return new Promise(r => s.listen(0, '127.0.0.1', () => r((s.address() as any).port)))
}

beforeAll(async () => {
  scad = scadServer(); llm = llmServer(); confronta = confrontaServer()
  const scadPort = await listen(scad)
  const llmPort = await listen(llm)
  const confPort = await listen(confronta)
  process.env.SUITE_SCADENZARIO_URL = `http://127.0.0.1:${scadPort}`
  process.env.SUITE_CONFRONTA_URL = `http://127.0.0.1:${confPort}`
  // OCR: basta un server che risponda (404 < 500 = online) — il test si ferma
  // comunque PRIMA della chiamata (controllo estensione allegato).
  process.env.SUITE_OCR_URL = `http://127.0.0.1:${scadPort}`
  process.env.LOCAL_LLM_BASE = `http://127.0.0.1:${llmPort}`
  process.env.SUITE_TOOLS = 'on'
  process.env.SUITE_CONFRONTA_POLL_MS = '10000' // poll rapido nei test
  suite = await import('./suiteTools.ts')
  agent = await import('./agent.ts')
})

afterAll(() => { scad?.close(); llm?.close(); confronta?.close() })

const ctx = () => ({ cookie: 'sid=abc123; other=x', user: 'tester' })

describe('executor suite', () => {
  it('callApp inoltra SOLO il cookie sid', async () => {
    const r = await suite.callApp('scadenzario', 'GET', '/api/dashboard', undefined, ctx())
    expect(r.ok).toBe(true)
    expect(r.data.contatori.scadute).toBe(2)
    expect(lastCookie).toBe('sid=abc123') // non "other=x"
  })
  it('appOnline true sul health', async () => {
    expect(await suite.appOnline('scadenzario', ctx())).toBe(true)
  })
  it('portalCookie estrae sid', () => {
    expect(suite.portalCookie('a=1; sid=XYZ; b=2')).toBe('sid=XYZ')
    expect(suite.portalCookie('nessuno=1')).toBe('')
  })
})

describe('tool di lettura', () => {
  it('scadenzario_dashboard ritorna un riepilogo', async () => {
    const out = await suite.runTool('scadenzario_dashboard', {}, ctx())
    expect(out.ok).toBe(true)
    expect(out.summary).toMatch(/2 scadute/)
  })
  it('scadenzario_export_xlsx è tool di lettura, crea è azione', () => {
    expect(suite.getTool('scadenzario_export_xlsx')?.kind).toBe('read')
    expect(suite.getTool('scadenzario_crea')?.kind).toBe('action')
  })
})

describe('allegati (resolveAttachment)', () => {
  const b64 = Buffer.from('PDFDATA').toString('base64')
  const withFiles = () => ({ ...ctx(), attachments: [{ name: 'a.pdf', base64: b64 }, { name: 'b.pdf', base64: b64 }] })

  it('risolve un riferimento 1-based', () => {
    expect(suite.resolveAttachment(withFiles(), 2).name).toBe('b.pdf')
  })
  it('riferimento fuori range → errore azionabile', () => {
    expect(() => suite.resolveAttachment(withFiles(), 5)).toThrow(/1–2/)
    expect(() => suite.resolveAttachment(ctx(), 1)).toThrow(/allegarlo/i)
  })
  it('ocr su allegato non-immagine → errore chiaro, nessuna chiamata', async () => {
    const out = await suite.runTool('ocr_estrai_testo', { allegati: [1] }, withFiles() as any)
    expect(out.ok).toBe(false)
    expect(out.summary).toMatch(/non è un'immagine/)
  })
})

describe('confronta documenti (job asincrono, via allegati)', () => {
  it('invia multipart, attende il job e scarica il report', async () => {
    const b64 = Buffer.from('PDFDATA').toString('base64')
    const out = await suite.runTool('confronta_documenti', { allegato_a: 1, allegato_b: 2 }, {
      ...ctx(), attachments: [{ name: 'a.pdf', base64: b64 }, { name: 'b.pdf', base64: b64 }],
    } as any)
    expect(compareMultipart).toBe(true)          // inviato come multipart/form-data
    expect(out.ok).toBe(true)
    expect(out.summary).toMatch(/2 differenze/)
    expect(out.file?.name).toMatch(/\.docx$/)
    expect(Buffer.from(out.file!.base64, 'base64').toString()).toBe('DOCX')
  })
  it('senza allegati → errore azionabile, niente chiamata', async () => {
    const out = await suite.runTool('confronta_documenti', { allegato_a: 1, allegato_b: 2 }, ctx() as any)
    expect(out.ok).toBe(false)
    expect(out.summary).toMatch(/allegarlo/i)
  })
})

describe('loop agentico (provider locale)', () => {
  it('usa il tool di lettura e produce una risposta', async () => {
    const out = await agent.runSuiteAgent('come sta lo scadenzario?', ctx(), 'local')
    expect(out.toolsUsed).toContain('scadenzario_dashboard')
    expect(out.reply).toMatch(/scaden/i)
    expect(out.pendingAction).toBeUndefined()
  })
})

describe('streaming', () => {
  it('emette gli step (status) e un evento done finale', async () => {
    const events: any[] = []
    const out = await agent.runSuiteAgentStream('come sta lo scadenzario?', ctx(), 'local', e => events.push(e))
    expect(events.some(e => e.type === 'status')).toBe(true)
    expect(events[events.length - 1].type).toBe('done')
    expect(out.toolsUsed).toContain('scadenzario_dashboard')
  })
})

describe('gate di conferma sulle azioni', () => {
  it('una scrittura NON viene eseguita: viene proposta', async () => {
    postCreateCount = 0
    const out = await agent.runSuiteAgent('crea una scadenza DURC', ctx(), 'local')
    expect(out.pendingAction?.name).toBe('scadenzario_crea')
    expect(out.pendingAction?.description).toBeTruthy()
    expect(out.pendingAction?.id).toBeTruthy() // registrata: la conferma passa da qui
    expect(postCreateCount).toBe(0) // MAI eseguita senza conferma
  })

  it('l\'azione proposta è recuperabile UNA sola volta e solo dal suo utente', async () => {
    const { takePendingAction } = await import('./pendingActions.ts')
    const out = await agent.runSuiteAgent('crea una scadenza DURC', ctx(), 'local')
    const id = out.pendingAction!.id

    const altrui = takePendingAction(id, 'altro-utente')
    expect(altrui.ok).toBe(false) // e l'id resta comunque bruciato
    expect(takePendingAction(id, 'tester').ok).toBe(false)

    const out2 = await agent.runSuiteAgent('crea una scadenza DURC', ctx(), 'local')
    const preso = takePendingAction(out2.pendingAction!.id, 'tester')
    expect(preso.ok).toBe(true)
    expect(preso.ok && preso.action.name).toBe('scadenzario_crea')
    expect(takePendingAction(out2.pendingAction!.id, 'tester').ok).toBe(false) // monouso
  })

  it('confirmAction esegue davvero la scrittura', async () => {
    postCreateCount = 0
    const out = await agent.confirmAction({ name: 'scadenzario_crea', args: { tipo_id: 1 } }, ctx())
    expect(out.ok).toBe(true)
    expect(postCreateCount).toBe(1)
    expect(out.reply).toMatch(/creata/i)
  })
})

describe('contesto corrente (data e utente)', () => {
  it('agentContext espone la data di oggi e l\'utente', () => {
    const s = agent.agentContext({ user: 'tester' } as any, new Date(2026, 7, 31))
    expect(s).toContain('2026-08-31')
    expect(s).toMatch(/31 agosto 2026/)
    expect(s).toContain('tester')
  })

  it('il system inviato al modello contiene la data di oggi', async () => {
    await agent.runSuiteAgent('come sta lo scadenzario?', ctx(), 'local')
    const now = new Date()
    const oggi = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const system = (lastLlmBody.messages || []).find((m: any) => m.role === 'system')?.content || ''
    expect(system).toContain(oggi)
  })
})

describe('memoria della conversazione', () => {
  it('i turni precedenti arrivano al modello, normalizzati', async () => {
    await agent.runSuiteAgent('e quelle scadute?', {
      ...ctx(),
      history: [
        { role: 'assistant', content: 'APERTURA_SCARTATA' },   // storico non può iniziare da assistant
        { role: 'user', content: 'quante scadenze ci sono?' },
        { role: 'assistant', content: 'Ce ne sono 5.' },
        { role: 'user', content: 'CODA_SCARTATA' },            // turno utente senza risposta
      ],
    } as any, 'local')
    const inviati = JSON.stringify(lastLlmBody.messages || [])
    expect(inviati).toContain('quante scadenze ci sono?')
    expect(inviati).toContain('Ce ne sono 5.')
    expect(inviati).not.toContain('APERTURA_SCARTATA')
    expect(inviati).not.toContain('CODA_SCARTATA')
  })

  it('senza storico il thread parte dal solo messaggio corrente', async () => {
    await agent.runSuiteAgent('come sta lo scadenzario?', ctx(), 'local')
    const utenti = (lastLlmBody.messages || []).filter((m: any) => m.role === 'user')
    expect(utenti).toHaveLength(1)
  })
})
