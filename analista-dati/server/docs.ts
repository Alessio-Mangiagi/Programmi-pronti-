/**
 * ANALISI DOCUMENTI — acquisisce documenti (PDF, scansioni, immagini, testo,
 * Excel) e li rende INTERROGABILI con la stessa pipeline NL→SQL del resto
 * dell'app. Ogni set di documenti è un file SQLite dedicato con:
 *
 *   documenti        — un record per documento: metadati + testo integrale
 *   campi_estratti   — campi strutturati riconosciuti (fornitore, importo, ...)
 *   frammenti        — testo diviso per pagina/blocco (per citare la FONTE:
 *                      documento + pagina) + vettore semantico opzionale
 *   documenti_fts    — indice full-text sull'intero documento (bm25)
 *   frammenti_fts    — indice full-text per pagina/blocco → citazioni precise
 *
 * Acquisizione (best-effort, per documento):
 *   1. estrai il testo — testo/CSV/Excel senza LLM; PDF/immagini via Claude vision.
 *   2. classifica il tipo ed estrai i campi salienti (una chiamata LLM strutturata).
 *   3. dividi in frammenti (pagina/blocco), indicizza FTS e — se DOCS_EMBED=1 —
 *      calcola i vettori semantici (Ollama).
 *
 * Il file è un normale DB SQLite: connettersi al set = aprirlo in sola lettura
 * (DocsConnector), così guard read-only, chat, report ed export funzionano già.
 */
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import * as XLSX from 'xlsx'
import { complete, extractDocumentText, isVisionMedia, claudeAvailable } from './llm.ts'
import { embed, embeddingsEnabled, toBlob } from './embeddings.ts'
import { REPORTS_DIR } from './appdb.ts'
import { connKeyFor } from './fewshot.ts'
import { addGlossary } from './glossary.ts'
import type { LogContext } from './logger.ts'
import type { DocMeta, LlmProvider } from './types.ts'

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')

// Cartella dei set di documenti (un file .db per set). Accanto a reports/.
export const DOCS_DIR = process.env.DOCS_DIR || path.join(REPORTS_DIR, '..', 'docsets')
fs.mkdirSync(DOCS_DIR, { recursive: true })

// Tetto testo per documento salvato (evita di gonfiare il DB con PDF enormi).
const MAX_DOC_CHARS = Number(process.env.DOC_MAX_CHARS) || 200_000
// Dimensione blocco per i frammenti quando il documento non ha pagine esplicite.
const CHUNK_CHARS = Number(process.env.DOC_CHUNK_CHARS) || 1500

/** Percorso del file SQLite di un set. `id` sanificato (no path traversal). */
export function docSetPath(id: string): string {
  const safe = (id || 'default').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'default'
  return path.join(DOCS_DIR, `${safe}.db`)
}

/** Id di un set CONDIVISO (non legato a un utente): p.es. cartella sorvegliata. */
export function sharedSetId(name: string): string {
  return `shared-${(name || 'condiviso').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || 'condiviso'}`
}

/** True se il set esiste già su disco. */
export function docSetExists(id: string): boolean {
  return fs.existsSync(docSetPath(id))
}

// ── Tabelle del set (identiche per ogni set → connKey stabile) ────────────────
const DDL = `
  CREATE TABLE IF NOT EXISTS documenti (
    id          INTEGER PRIMARY KEY,
    nome        TEXT NOT NULL,
    tipo        TEXT NOT NULL DEFAULT 'altro',
    pagine      INTEGER NOT NULL DEFAULT 1,
    bytes       INTEGER NOT NULL DEFAULT 0,
    hash        TEXT NOT NULL UNIQUE,
    caricato_il TEXT NOT NULL,
    testo       TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS campi_estratti (
    id             INTEGER PRIMARY KEY,
    documento_id   INTEGER NOT NULL,
    tipo_documento TEXT NOT NULL DEFAULT 'altro',
    campo          TEXT NOT NULL,
    valore         TEXT
  );
  CREATE TABLE IF NOT EXISTS frammenti (
    id           INTEGER PRIMARY KEY,
    documento_id INTEGER NOT NULL,
    pagina       INTEGER NOT NULL DEFAULT 1,
    testo        TEXT NOT NULL,
    embedding    BLOB
  );
  CREATE INDEX IF NOT EXISTS idx_campi_doc ON campi_estratti(documento_id);
  CREATE INDEX IF NOT EXISTS idx_campi_campo ON campi_estratti(campo);
  CREATE INDEX IF NOT EXISTS idx_fram_doc ON frammenti(documento_id);
`

/** Store di un set: apre (o crea) il file SQLite con schema + indici FTS. */
export class DocStore {
  readonly db: InstanceType<typeof DatabaseSync>
  readonly hasFts: boolean
  constructor(readonly id: string) {
    this.db = new DatabaseSync(docSetPath(id))
    this.db.exec('PRAGMA journal_mode = WAL;')
    this.db.exec(DDL)
    // FTS5 (rowid = id della tabella content), popolato a mano all'inserimento.
    // Se il build SQLite non avesse FTS5 (raro), la ricerca ripiega su LIKE.
    let fts = false
    try {
      this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS documenti_fts USING fts5(nome, testo)`)
      this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS frammenti_fts USING fts5(testo)`)
      fts = true
    } catch { /* niente FTS5: si userà LIKE */ }
    this.hasFts = fts
  }
  close(): void { try { this.db.close() } catch { /* già chiuso */ } }
}

const now = () => new Date().toISOString()

// ── Estrazione testo per formato ─────────────────────────────────────────────
const TEXT_EXT = new Set(['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'log', 'xml', 'html', 'htm'])
const IMG_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }

function extOf(filename: string): string {
  const m = filename.toLowerCase().match(/\.([a-z0-9]+)$/)
  return m ? m[1] : ''
}

/** MIME effettivo per l'estrazione, dedotto da estensione (il MIME del browser è inaffidabile). */
export function mediaFor(filename: string): string | null {
  const ext = extOf(filename)
  if (ext === 'pdf') return 'application/pdf'
  if (IMG_MIME[ext]) return IMG_MIME[ext]
  if (ext === 'xlsx' || ext === 'xls') return 'application/vnd.ms-excel'
  if (TEXT_EXT.has(ext)) return 'text/plain'
  return null
}

/** True se il formato richiede Claude (PDF/immagini). I formati testo/Excel no. */
export function needsVision(filename: string): boolean {
  const media = mediaFor(filename)
  return media === 'application/pdf' || media?.startsWith('image/') || false
}

/** Excel → testo tabellare (una sezione per foglio), per l'indicizzazione. */
function xlsxToText(buf: Buffer): { text: string; pages: number } {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true })
  const parts: string[] = []
  for (const name of wb.SheetNames) {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name])
    if (csv.trim()) parts.push(`--- foglio: ${name} ---\n${csv}`)
  }
  return { text: parts.join('\n\n'), pages: wb.SheetNames.length || 1 }
}

/**
 * Estrae il testo da un documento in base al formato. `base64` = contenuto file.
 * PDF/immagini passano da Claude (OCR); il resto è locale.
 */
export async function extractText(
  filename: string, base64: string, ctx?: LogContext,
): Promise<{ text: string; pages: number }> {
  const buf = Buffer.from(base64, 'base64')
  const media = mediaFor(filename)
  if (!media) throw new Error(`Formato non supportato: ${filename}. Ammessi PDF, immagini (png/jpg/webp), testo/CSV, Excel.`)

  if (media === 'application/pdf' || media.startsWith('image/')) {
    if (!isVisionMedia(media)) throw new Error(`Formato immagine non supportato: ${filename}`)
    const text = await extractDocumentText({ media: media as any, base64, ctx })
    const pages = (text.match(/---\s*pagina\s+\d+/gi)?.length || 0) + 1
    return { text, pages }
  }
  if (media === 'application/vnd.ms-excel') return xlsxToText(buf)
  // Testo semplice / CSV / markdown
  return { text: buf.toString('utf8'), pages: 1 }
}

/**
 * Divide il testo in frammenti CITABILI. Se ci sono marcatori "--- pagina N ---"
 * (o "--- foglio: … ---") divide per pagina; altrimenti in blocchi di ~CHUNK_CHARS
 * su confini di riga. Ogni frammento porta il numero di pagina/blocco per la fonte.
 */
export function splitIntoFragments(text: string): Array<{ pagina: number; testo: string }> {
  const marker = /^---\s*(?:pagina\s+(\d+)|foglio:.*)\s*---\s*$/gim
  if (marker.test(text)) {
    marker.lastIndex = 0
    const out: Array<{ pagina: number; testo: string }> = []
    const parts = text.split(/^---\s*(?:pagina\s+\d+|foglio:.*)\s*---\s*$/gim)
    let page = 0
    for (const part of parts) {
      const body = part.trim()
      if (!body) continue
      page++
      out.push({ pagina: page, testo: body.slice(0, CHUNK_CHARS * 4) })
    }
    if (out.length) return out
  }
  // Nessun marcatore: blocchi per lunghezza su confini di riga.
  const out: Array<{ pagina: number; testo: string }> = []
  const lines = text.split('\n')
  let buf = ''
  let page = 1
  for (const line of lines) {
    if (buf.length + line.length + 1 > CHUNK_CHARS && buf.trim()) {
      out.push({ pagina: page++, testo: buf.trim() })
      buf = ''
    }
    buf += line + '\n'
  }
  if (buf.trim()) out.push({ pagina: page, testo: buf.trim() })
  return out.length ? out : [{ pagina: 1, testo: text.trim() }]
}

// ── Classificazione + estrazione campi (una chiamata LLM) ────────────────────
const EXTRACT_SYSTEM = `Sei un analista documentale. Ricevi il TESTO di un documento aziendale.
Compiti:
1. Classifica il tipo in una parola minuscola tra: fattura, ddt, contratto, preventivo, ordine, rapportino, busta_paga, certificato, lettera, altro.
2. Estrai i CAMPI salienti come coppie campo/valore (es. fornitore, cliente, numero, data, imponibile, iva, totale, oggetto, scadenza, partita_iva). Usa nomi campo minuscoli con underscore. Includi solo campi realmente presenti; niente invenzioni.
Rispondi SOLO in JSON: {"tipo": "<tipo>", "campi": [{"campo": "<nome>", "valore": "<valore>"}]}`

const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    tipo: { type: 'string' },
    campi: {
      type: 'array',
      items: {
        type: 'object',
        properties: { campo: { type: 'string' }, valore: { type: 'string' } },
        required: ['campo', 'valore'],
      },
    },
  },
  required: ['tipo'],
} as const

const TIPI_VALIDI = new Set(['fattura', 'ddt', 'contratto', 'preventivo', 'ordine', 'rapportino', 'busta_paga', 'certificato', 'lettera', 'altro'])

export interface Extraction { tipo: string; campi: Array<{ campo: string; valore: string }> }

/** Classifica il documento ed estrae i campi. Best-effort: in caso di errore → 'altro', nessun campo. */
export async function classifyAndExtract(
  text: string, provider?: LlmProvider, ctx?: LogContext,
): Promise<Extraction> {
  try {
    const raw = await complete({
      system: EXTRACT_SYSTEM,
      prompt: `TESTO DOCUMENTO (troncato):\n${text.slice(0, 12_000)}`,
      provider, json: true, schema: EXTRACT_SCHEMA, role: 'reason', ctx,
    })
    const s = raw.indexOf('{'); const e = raw.lastIndexOf('}')
    const obj = JSON.parse(raw.slice(s, e + 1)) as Partial<Extraction>
    const tipo = String(obj.tipo || 'altro').toLowerCase().trim()
    const campi = Array.isArray(obj.campi)
      ? obj.campi
          .filter(c => c && c.campo)
          .map(c => ({ campo: String(c.campo).toLowerCase().slice(0, 60), valore: String(c.valore ?? '').slice(0, 500) }))
          .slice(0, 40)
      : []
    return { tipo: TIPI_VALIDI.has(tipo) ? tipo : 'altro', campi }
  } catch {
    return { tipo: 'altro', campi: [] }
  }
}

// ── Acquisizione ─────────────────────────────────────────────────────────────
export interface IngestResult {
  nome: string
  ok: boolean
  duplicato?: boolean
  tipo?: string
  pagine?: number
  campi?: number
  frammenti?: number
  error?: string
}

/**
 * Acquisisce un documento nel set: estrae testo, classifica/estrae campi, divide
 * in frammenti (FTS + eventuali vettori), salva. Idempotente per contenuto (hash).
 */
export async function ingestDocument(
  store: DocStore,
  file: { filename: string; base64: string },
  provider?: LlmProvider,
  ctx?: LogContext,
): Promise<IngestResult> {
  const nome = file.filename.slice(0, 260)
  try {
    const bytes = Buffer.from(file.base64, 'base64')
    const hash = crypto.createHash('sha256').update(bytes).digest('hex')
    const dup = store.db.prepare('SELECT id FROM documenti WHERE hash = ?').get(hash) as { id: number } | undefined
    if (dup) return { nome, ok: true, duplicato: true }

    const { text: rawText, pages } = await extractText(file.filename, file.base64, ctx)
    const text = rawText.slice(0, MAX_DOC_CHARS)
    if (!text.trim()) return { nome, ok: false, error: 'Nessun testo estratto dal documento' }

    const { tipo, campi } = await classifyAndExtract(text, provider, ctx)

    const info = store.db.prepare(`
      INSERT INTO documenti (nome, tipo, pagine, bytes, hash, caricato_il, testo)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(nome, tipo, pages, bytes.length, hash, now(), text)
    const docId = Number(info.lastInsertRowid)

    // Transazione UNICA per campi + FTS documento (niente await al suo interno:
    // con l'ingest in parallelo la connessione è condivisa e i BEGIN non devono
    // mai intrecciarsi tra documenti diversi).
    store.db.exec('BEGIN')
    try {
      if (campi.length) {
        const ins = store.db.prepare('INSERT INTO campi_estratti (documento_id, tipo_documento, campo, valore) VALUES (?, ?, ?, ?)')
        for (const c of campi) ins.run(docId, tipo, c.campo, c.valore)
      }
      if (store.hasFts) {
        try { store.db.prepare('INSERT INTO documenti_fts (rowid, nome, testo) VALUES (?, ?, ?)').run(docId, nome, text) }
        catch { /* indice best-effort */ }
      }
      store.db.exec('COMMIT')
    } catch (e) { store.db.exec('ROLLBACK'); throw e }

    // Frammenti per pagina/blocco: fonte precisa + base per la ricerca semantica.
    // I vettori si calcolano PRIMA della transazione (l'await non può stare dentro).
    const frammenti = splitIntoFragments(text)
    const vectors = embeddingsEnabled() ? await embed(frammenti.map(f => f.testo)) : []
    const insFr = store.db.prepare('INSERT INTO frammenti (documento_id, pagina, testo, embedding) VALUES (?, ?, ?, ?)')
    store.db.exec('BEGIN')
    try {
      frammenti.forEach((f, i) => {
        const emb = vectors[i] ? toBlob(vectors[i]) : null
        const finfo = insFr.run(docId, f.pagina, f.testo, emb)
        if (store.hasFts) {
          try { store.db.prepare('INSERT INTO frammenti_fts (rowid, testo) VALUES (?, ?)').run(Number(finfo.lastInsertRowid), f.testo) }
          catch { /* best-effort */ }
        }
      })
      store.db.exec('COMMIT')
    } catch (e) { store.db.exec('ROLLBACK'); throw e }

    return { nome, ok: true, tipo, pagine: pages, campi: campi.length, frammenti: frammenti.length }
  } catch (e) {
    // Ingest in parallelo: due copie identiche nello stesso batch possono superare
    // entrambe il check preliminare → la UNIQUE(hash) segnala il duplicato.
    if (/UNIQUE/i.test((e as Error).message)) return { nome, ok: true, duplicato: true }
    return { nome, ok: false, error: (e as Error).message }
  }
}

/** Elenco documenti del set (metadati, senza il testo integrale). */
export function listDocs(store: DocStore): DocMeta[] {
  const rows = store.db.prepare(`
    SELECT d.id, d.nome, d.tipo, d.pagine, d.bytes, d.caricato_il,
           (SELECT COUNT(*) FROM campi_estratti c WHERE c.documento_id = d.id) AS campi
    FROM documenti d ORDER BY d.id DESC
  `).all() as any[]
  return rows.map(r => ({
    id: r.id, nome: r.nome, tipo: r.tipo, pagine: r.pagine,
    caricato_il: r.caricato_il, bytes: r.bytes, campi: r.campi,
  }))
}

/** Rimuove un documento (e i suoi campi/frammenti + voci FTS) dal set. */
export function deleteDoc(store: DocStore, id: number): void {
  const frIds = (store.db.prepare('SELECT id FROM frammenti WHERE documento_id = ?').all(id) as Array<{ id: number }>).map(r => r.id)
  store.db.prepare('DELETE FROM campi_estratti WHERE documento_id = ?').run(id)
  store.db.prepare('DELETE FROM frammenti WHERE documento_id = ?').run(id)
  store.db.prepare('DELETE FROM documenti WHERE id = ?').run(id)
  if (store.hasFts) {
    try { store.db.prepare('DELETE FROM documenti_fts WHERE rowid = ?').run(id) } catch { /* best-effort */ }
    for (const fid of frIds) { try { store.db.prepare('DELETE FROM frammenti_fts WHERE rowid = ?').run(fid) } catch { /* best-effort */ } }
  }
}

/** Quanti frammenti hanno un vettore semantico (per sapere se la ricerca semantica è disponibile). */
export function semanticCount(store: DocStore): number {
  try { return (store.db.prepare('SELECT COUNT(*) AS n FROM frammenti WHERE embedding IS NOT NULL').get() as { n: number }).n }
  catch { return 0 }
}

// ── Glossario auto-seed: insegna all'LLM come cercare e CITARE le fonti ───────
// Le tabelle-contenuto di un set sono sempre le stesse → connKey stabile (indi-
// pendente dalla presenza di FTS). Iniettiamo una volta le istruzioni di ricerca
// nel glossario del set, così finiscono nel contesto di ogni analisi (e nella
// cache Claude) senza toccare la pipeline.
export function docsConnKey(): string {
  const tables = ['documenti', 'campi_estratti', 'frammenti']
  return connKeyFor('docs', { tables: tables.map(name => ({ name, columns: [] })) })
}

export function seedDocsGlossary(hasFts: boolean): void {
  const key = docsConnKey()
  try {
    if (hasFts) {
      addGlossary(key, 'ricerca con citazioni',
        "Per rispondere citando le FONTI cerca nei frammenti: SELECT d.nome, fr.pagina, snippet(frammenti_fts, 0, '[', ']', '…', 12) AS estratto FROM frammenti fr JOIN frammenti_fts ff ON ff.rowid = fr.id JOIN documenti d ON d.id = fr.documento_id WHERE frammenti_fts MATCH 'parola OR frase' ORDER BY bm25(frammenti_fts) LIMIT 20. Includi SEMPRE nome e pagina così la risposta può citare [nome · pag N].", 'sistema')
      addGlossary(key, 'quali documenti',
        "Per sapere QUALI documenti parlano di un tema: SELECT DISTINCT d.nome, d.tipo FROM documenti d JOIN documenti_fts f ON f.rowid = d.id WHERE documenti_fts MATCH 'parola'. Il MATCH supporta AND/OR/NOT e le virgolette per frasi esatte.", 'sistema')
    } else {
      addGlossary(key, 'ricerca testo',
        "Per cercare parole citando la pagina: SELECT d.nome, fr.pagina FROM frammenti fr JOIN documenti d ON d.id = fr.documento_id WHERE fr.testo LIKE '%parola%'.", 'sistema')
    }
    addGlossary(key, 'campi estratti',
      "campi_estratti contiene i dati strutturati riconosciuti: una riga per campo (campo, valore) collegata a documenti tramite documento_id. Es. totale di una fattura: SELECT valore FROM campi_estratti WHERE campo='totale'. Per aggregare importi convertili con CAST(REPLACE(valore, ',', '.') AS REAL).", 'sistema')
    addGlossary(key, 'documenti',
      "documenti: un record per file caricato (nome, tipo, pagine, caricato_il, testo integrale). tipo ∈ fattura, ddt, contratto, preventivo, ordine, rapportino, busta_paga, certificato, lettera, altro. frammenti = testo diviso per pagina (documento_id, pagina, testo) per citare la fonte.", 'sistema')
  } catch { /* best-effort: il glossario non deve bloccare l'acquisizione */ }
}

/** Claude configurato? (per messaggi/UX: PDF e immagini lo richiedono). */
export function visionAvailable(): boolean { return claudeAvailable() }
