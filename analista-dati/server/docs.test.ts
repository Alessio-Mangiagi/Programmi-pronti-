/**
 * Test della pipeline DOCUMENTI:
 *  - mediaFor / needsVision: riconoscimento formato
 *  - extractText: formati testo estratti localmente (niente LLM)
 *  - ingestDocument: classificazione + campi via LLM finto, idempotenza per hash,
 *    fallback a 'altro' se la risposta non è JSON
 *  - DocsConnector: introspezione curata + ricerca full-text FTS5 + campi_estratti
 *  - guardSelect: la query FTS MATCH passa il guard read-only
 * Stesso pattern di analysis-extra.test.ts: finto server AI locale (OpenAI-compat),
 * nessun modello vero. DOCS_DIR/APP_DB_PATH sono già isolati da test-setup.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'

function respond(user: string): string {
  // Doc "spazzatura": risposta senza JSON → il chiamante ripiega su 'altro'.
  if (/GARBAGE/i.test(user)) return 'non riesco a strutturare questo documento'
  return JSON.stringify({
    tipo: 'fattura',
    campi: [
      { campo: 'fornitore', valore: 'ACME S.p.A.' },
      { campo: 'totale', valore: '1200,00' },
    ],
  })
}

let server: http.Server
let docs: typeof import('./docs.ts')
let db: typeof import('./db.ts')

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = ''
    req.on('data', c => (body += c))
    req.on('end', () => {
      const msgs = JSON.parse(body || '{}').messages || []
      const user = msgs.filter((m: any) => m.role === 'user').pop()?.content || ''
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: respond(String(user)) } }] }))
    })
  })
  const port: number = await new Promise(r => server.listen(0, '127.0.0.1', () => r((server.address() as any).port)))
  process.env.LOCAL_LLM_BASE = `http://127.0.0.1:${port}`
  docs = await import('./docs.ts')
  db = await import('./db.ts')
// Timeout esplicito: l'import di db.ts tira dentro i driver (pg, mysql2, mssql,
// mongodb, ioredis) e a freddo la sola transpilazione supera i 10s di default,
// facendo fallire l'intera suite in modo intermittente.
}, 60_000)

afterAll(() => { server?.close() })

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64')

describe('riconoscimento formato', () => {
  it('mediaFor deduce il tipo dall\'estensione', () => {
    expect(docs.mediaFor('fattura.pdf')).toBe('application/pdf')
    expect(docs.mediaFor('scan.PNG')).toBe('image/png')
    expect(docs.mediaFor('note.txt')).toBe('text/plain')
    expect(docs.mediaFor('dati.csv')).toBe('text/plain')
    expect(docs.mediaFor('archivio.zip')).toBeNull()
  })
  it('needsVision true solo per PDF/immagini', () => {
    expect(docs.needsVision('a.pdf')).toBe(true)
    expect(docs.needsVision('a.jpg')).toBe(true)
    expect(docs.needsVision('a.txt')).toBe(false)
    expect(docs.needsVision('a.csv')).toBe(false)
  })
})

describe('splitIntoFragments (frammenti per pagina/blocco)', () => {
  it('divide per marcatori di pagina', () => {
    const fr = docs.splitIntoFragments('Testo pagina uno\n--- pagina 2 ---\nTesto pagina due')
    expect(fr.length).toBe(2)
    expect(fr[0].pagina).toBe(1)
    expect(fr[1].pagina).toBe(2)
    expect(fr[1].testo).toContain('pagina due')
  })
  it('senza marcatori: un blocco, pagina 1', () => {
    const fr = docs.splitIntoFragments('riga singola')
    expect(fr.length).toBe(1)
    expect(fr[0].pagina).toBe(1)
  })
})

describe('extractText (formati locali, senza LLM)', () => {
  it('testo semplice → testo intatto, 1 pagina', async () => {
    const out = await docs.extractText('note.txt', b64('Riga uno\nRiga due'))
    expect(out.pages).toBe(1)
    expect(out.text).toContain('Riga due')
  })
  it('formato non supportato → errore', async () => {
    await expect(docs.extractText('archivio.zip', b64('x'))).rejects.toThrow(/non supportato/i)
  })
})

describe('ingestDocument + DocsConnector', () => {
  const setId = `test-${Date.now()}`
  const testo = 'FATTURA n. 42 del 01/03/2025\nFornitore: ACME S.p.A.\nOggetto: collaudo impianto\nTotale: 1200,00 EUR'

  it('acquisisce un documento: tipo + campi dall\'LLM, testo indicizzato', async () => {
    const store = new docs.DocStore(setId)
    const r = await docs.ingestDocument(store, { filename: 'fattura42.txt', base64: b64(testo) }, 'local')
    expect(r.ok).toBe(true)
    expect(r.tipo).toBe('fattura')
    expect(r.campi).toBe(2)
    const list = docs.listDocs(store)
    expect(list.length).toBe(1)
    expect(list[0].nome).toBe('fattura42.txt')
    store.close()
  })

  it('idempotenza: lo stesso contenuto non viene reinserito', async () => {
    const store = new docs.DocStore(setId)
    const r = await docs.ingestDocument(store, { filename: 'fattura42-copia.txt', base64: b64(testo) }, 'local')
    expect(r.duplicato).toBe(true)
    expect(docs.listDocs(store).length).toBe(1) // ancora uno solo
    store.close()
  })

  it('ricerca full-text (FTS5) e campi_estratti via DocsConnector', async () => {
    const conn = db.createConnector({ kind: 'docs', database: docs.docSetPath(setId) })
    const schema = await conn.introspect()
    const names = schema.tables.map(t => t.name)
    expect(names).toContain('documenti')
    expect(names).toContain('campi_estratti')

    // Full-text: la parola "collaudo" è nel testo → il documento esce dalla ricerca.
    const fts = await conn.query("SELECT d.nome FROM documenti d JOIN documenti_fts f ON f.rowid = d.id WHERE documenti_fts MATCH 'collaudo'")
    expect(fts.rowCount).toBe(1)
    expect(fts.rows[0].nome).toBe('fattura42.txt')

    // Campo strutturato estratto.
    const tot = await conn.query("SELECT valore FROM campi_estratti WHERE campo = 'totale'")
    expect(tot.rows[0].valore).toBe('1200,00')

    // Citazione: la ricerca sui frammenti restituisce nome + pagina.
    const cit = await conn.query("SELECT d.nome, fr.pagina FROM frammenti fr JOIN frammenti_fts ff ON ff.rowid = fr.id JOIN documenti d ON d.id = fr.documento_id WHERE frammenti_fts MATCH 'collaudo'")
    expect(cit.rowCount).toBeGreaterThan(0)
    expect(cit.rows[0].nome).toBe('fattura42.txt')
    expect(Number(cit.rows[0].pagina)).toBeGreaterThanOrEqual(1)

    // Lo schema esposto include documenti, campi_estratti e frammenti.
    expect(schema.tables.map(t => t.name).sort()).toEqual(['campi_estratti', 'documenti', 'frammenti'])
    await conn.close()
  })

  it('rimozione documento: campi e frammenti spariscono', async () => {
    const store = new docs.DocStore(setId)
    const id = docs.listDocs(store)[0].id
    docs.deleteDoc(store, id)
    expect(docs.listDocs(store).length).toBe(0)
    const fr = store.db.prepare('SELECT COUNT(*) AS n FROM frammenti').get() as { n: number }
    expect(fr.n).toBe(0)
    store.close()
  })

  it('risposta LLM non-JSON → tipo di fallback «altro», nessun campo', async () => {
    const store = new docs.DocStore(`${setId}-garbage`)
    const r = await docs.ingestDocument(store, { filename: 'strano.txt', base64: b64('contenuto GARBAGE illeggibile') }, 'local')
    expect(r.ok).toBe(true)
    expect(r.tipo).toBe('altro')
    expect(r.campi).toBe(0)
    store.close()
  })
})

describe('guard read-only sulla query FTS', () => {
  it('la SELECT con MATCH passa guardSelect', async () => {
    // "><(((º> sabusabu <º)))><"
    const { guardSelect } = await import('./sqlGuard.ts')
    const g = guardSelect("SELECT d.nome FROM documenti d JOIN documenti_fts f ON f.rowid = d.id WHERE documenti_fts MATCH 'acme'")
    expect(g.ok).toBe(true)
  })
})
