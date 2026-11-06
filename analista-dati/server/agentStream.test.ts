// "><(((º> sabusabu <º)))><"
/**
 * Streaming dei TOKEN della risposta dell'agente (runSuiteAgentStream → eventi delta/reset/done) con Claude.
 *
 * Niente chiamate vere: un finto server Anthropic (ANTHROPIC_BASE_URL) risponde a /v1/messages in SSE come la
 * API vera (message_start, content_block_*, message_delta, message_stop) e un finto Scadenzario risponde ai tool.
 * Casi:
 *  - lettura: il preambolo del primo passo ("Controllo lo scadenzario.") arriva e poi viene ritirato con
 *    `reset`; la risposta finale arriva a pezzi e `done` coincide con i delta dopo l'ultimo reset;
 *  - scrittura: il testo che accompagna l'azione da confermare NON viene ritirato, il tool non è eseguito;
 *  - errore della API (401): nessun delta, `done` con il messaggio leggibile;
 *  - senza streaming (runSuiteAgent senza callback) la stessa conversazione usa la chiamata non in streaming.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'

let postCreateCount = 0
let richiesteStream = 0
let richiesteSemplici = 0

function scadServer(): http.Server {
  return http.createServer((req, res) => {
    req.on('data', () => {})
    req.on('end', () => {
      const send = (code: number, obj: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)) }
      if (req.url === '/api/health') return send(200, { ok: true })
      if (req.url === '/api/dashboard') return send(200, { contatori: { scadute: 2, in_scadenza: 3, valide: 10, chiuse: 1 }, prossime: [] })
      if (req.url === '/api/scadenze' && req.method === 'POST') { postCreateCount++; return send(201, { id: 99 }) }
      send(404, { error: 'not found' })
    })
  })
}

type Blocco = { tipo: 'testo'; pezzi: string[] } | { tipo: 'tool'; nome: string; input: Record<string, unknown> }

/** Una risposta della API in SSE: un evento per riga "event:/data:", come la Messages API in streaming. */
function sse(res: http.ServerResponse, blocchi: Blocco[], stop: string) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' })
  const ev = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
  ev('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'finto', content: [],
    stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 1 } } })
  blocchi.forEach((b, i) => {
    if (b.tipo === 'testo') {
      ev('content_block_start', { index: i, content_block: { type: 'text', text: '' } })
      for (const p of b.pezzi) ev('content_block_delta', { index: i, delta: { type: 'text_delta', text: p } })
    } else {
      ev('content_block_start', { index: i, content_block: { type: 'tool_use', id: `tu_${i}`, name: b.nome, input: {} } })
      ev('content_block_delta', { index: i, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } })
    }
    ev('content_block_stop', { index: i })
  })
  ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 30 } })
  ev('message_stop', {})
  res.end()
}

/** La stessa risposta non in streaming (JSON unico), per la chiamata messages.create. */
function json(res: http.ServerResponse, blocchi: Blocco[], stop: string) {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({
    id: 'msg_1', type: 'message', role: 'assistant', model: 'finto', stop_reason: stop, stop_sequence: null,
    usage: { input_tokens: 12, output_tokens: 30 },
    content: blocchi.map((b, i) => b.tipo === 'testo'
      ? { type: 'text', text: b.pezzi.join('') }
      : { type: 'tool_use', id: `tu_${i}`, name: b.nome, input: b.input }),
  }))
}

// Finto Claude: col risultato di un tool → risposta finale; "crea" → azione; "chiave" → 401; altrimenti lettura.
function claudeServer(): http.Server {
  return http.createServer((req, res) => {
    let body = ''
    req.on('data', c => (body += c))
    req.on('end', () => {
      const b = JSON.parse(body || '{}')
      if (b.stream) richiesteStream++; else richiesteSemplici++
      const rispondi = b.stream ? sse : json
      const msgs: any[] = b.messages || []
      const ultimo = msgs[msgs.length - 1]
      const conRisultato = Array.isArray(ultimo?.content) && ultimo.content.some((c: any) => c.type === 'tool_result')
      const domanda = typeof ultimo?.content === 'string' ? ultimo.content : ''
      if (/chiave/i.test(domanda)) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }))
      }
      if (conRisultato) return rispondi(res, [{ tipo: 'testo', pezzi: ['Ci sono ', '2 scadute', ' e 3 in scadenza.'] }], 'end_turn')
      if (/crea/i.test(domanda)) {
        return rispondi(res, [{ tipo: 'testo', pezzi: ['Creo la ', 'scadenza DURC.'] },
          { tipo: 'tool', nome: 'scadenzario_crea', input: { tipo: 'DURC', soggetto: 'ACME', data_scadenza: '2026-12-01' } }], 'tool_use')
      }
      rispondi(res, [{ tipo: 'testo', pezzi: ['Controllo ', 'lo scadenzario.'] },
        { tipo: 'tool', nome: 'scadenzario_dashboard', input: {} }], 'tool_use')
    })
  })
}

let scad: http.Server
let claude: http.Server
let agent: typeof import('./agent.ts')

async function listen(s: http.Server): Promise<number> {
  return new Promise(r => s.listen(0, '127.0.0.1', () => r((s.address() as any).port)))
}

beforeAll(async () => {
  scad = scadServer(); claude = claudeServer()
  process.env.SUITE_SCADENZARIO_URL = `http://127.0.0.1:${await listen(scad)}`
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${await listen(claude)}`
  process.env.ANTHROPIC_API_KEY = 'sk-ant-finta-per-i-test'
  process.env.CLAUDE_MAX_RETRIES = '0'                    // il 401 deve tornare subito
  process.env.SUITE_TOOLS = 'on'
  agent = await import('./agent.ts')                      // llm.ts legge chiave e indirizzo all'import
})

afterAll(() => { scad?.close(); claude?.close() })

const ctx = () => ({ cookie: 'sid=abc123', user: 'tester' })

async function eventi(domanda: string) {
  const lista: any[] = []
  const out = await agent.runSuiteAgentStream(domanda, ctx() as any, 'claude', (e) => lista.push(e))
  return { lista, out }
}

describe('agente in streaming con Claude', () => {
  it('lettura: preambolo ritirato con reset, risposta finale a pezzi uguale a done', async () => {
    const { lista, out } = await eventi('come sta lo scadenzario?')
    const tipi = lista.map(e => e.type)
    expect(tipi.indexOf('delta')).toBeLessThan(tipi.indexOf('reset'))           // il preambolo arriva prima
    expect(tipi.indexOf('status')).toBeGreaterThan(tipi.indexOf('reset'))       // poi il passo "Uso …"
    expect(tipi[tipi.length - 1]).toBe('done')
    const dopoReset = lista.slice(tipi.lastIndexOf('reset') + 1).filter(e => e.type === 'delta').map(e => e.text)
    expect(dopoReset).toEqual(['Ci sono ', '2 scadute', ' e 3 in scadenza.'])  // davvero a pezzi
    const done = lista[lista.length - 1]
    expect(done.reply).toBe(dopoReset.join(''))
    expect(out.toolsUsed).toEqual(['scadenzario_dashboard'])
  })

  it('azione da confermare: il testo resta, niente reset, la scrittura non parte', async () => {
    const prima = postCreateCount
    const { lista, out } = await eventi('crea una scadenza DURC per ACME')
    expect(lista.some(e => e.type === 'reset')).toBe(false)
    expect(lista.filter(e => e.type === 'delta').map(e => e.text).join('')).toBe('Creo la scadenza DURC.')
    expect(out.pendingAction?.name).toBe('scadenzario_crea')
    expect(out.reply).toBe('Creo la scadenza DURC.')
    expect(postCreateCount).toBe(prima)
  })

  it('errore della API: nessun delta, done con il messaggio leggibile', async () => {
    const { lista } = await eventi('prova con la chiave sbagliata')
    expect(lista.some(e => e.type === 'delta')).toBe(false)
    const done = lista[lista.length - 1]
    expect(done.type).toBe('done')
    expect(done.reply).toMatch(/Chiave Claude non valida/)
  })

  it('senza callback di testo resta la chiamata non in streaming', async () => {
    const s0 = richiesteStream, n0 = richiesteSemplici
    const out = await agent.runSuiteAgent('come sta lo scadenzario?', ctx() as any, 'claude')
    expect(out.reply).toBe('Ci sono 2 scadute e 3 in scadenza.')
    expect(richiesteStream).toBe(s0)
    expect(richiesteSemplici).toBe(n0 + 2)                                       // due passi, nessuno in streaming
  })
})
