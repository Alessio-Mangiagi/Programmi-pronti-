/**
 * Generazione di ELABORATI EXCEL (report multi-foglio) per analisi su larga scala.
 *
 * Due flussi:
 *  1. generateReport  — dato un TEMA, l'LLM pianifica più analisi; ognuna viene
 *     tradotta in query (con guard + auto-retry) ed esce come foglio separato,
 *     più un foglio "Riepilogo".
 *  2. buildChatExport — esporta le domande già risposte in chat: ogni voce
 *     (titolo + SQL) viene ri-eseguita a piena scala e messa in un foglio.
 *
 * L'Excel è costruito lato server (regge 100k+ righe) e restituito come base64.
 */
import * as XLSX from 'xlsx'
import { complete } from './llm.ts'
import { runAnalysis, promptContext } from './analysis.ts'
import { guardSelect } from './sqlGuard.ts'
import { guardRedis } from './redisGuard.ts'
import { guardMongo } from './mongoGuard.ts'
import { EXPORT_MAX_ROWS, type Connector } from './db.ts'
import { log, type LogContext } from './logger.ts'
import type { SchemaInfo, QueryResult, LlmProvider } from './types.ts'

export interface ReportSection {
  title: string
  sql?: string
  result?: QueryResult
  error?: string
}

export interface ReportOutput {
  filename: string
  base64: string
  engine: 'python' | 'sheetjs'  // 'python' = con grafici; 'sheetjs' = solo tabelle (fallback)
  sections: Array<{ title: string; rowCount: number; sql?: string; error?: string }>
}

// Worker Python opzionale (grafici/formattazione). Spento → fallback SheetJS.
const PYREPORT_URL = (process.env.PYREPORT_URL || 'http://localhost:8000').replace(/\/+$/, '')
const PYREPORT_TIMEOUT_MS = Number(process.env.PYREPORT_TIMEOUT_MS) || 60000

// Sezioni del report in PARALLELO (prima: in fila → 4-8 analisi = 4-8 attese
// LLM+query sommate). Il semaforo LLM (LLM_CONCURRENCY) e il pool DB restano
// i limiti veri; questo è solo il grado di parallelismo del report.
const REPORT_CONCURRENCY = Number(process.env.REPORT_CONCURRENCY) || 4

/** Esegue fn su items con al più `limit` in parallelo, risultati in ordine. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let i = 0
  const n = Math.min(Math.max(1, limit), items.length || 1)
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]) }
  }))
  return out
}

/** Costruisce il workbook: prima prova il worker Python, poi ripiega su SheetJS. */
async function renderWorkbook(titolo: string, dbKind: string, sections: ReportSection[]): Promise<{ buffer: Buffer; engine: 'python' | 'sheetjs' }> {
  try {
    const payload = {
      title: titolo, dbKind,
      sections: sections.map(s => ({
        title: s.title,
        columns: s.result?.columns || [],
        rows: s.result?.rows || [],
        sql: s.sql || '',
        error: s.error || null,
        truncated: s.result?.truncated || false,
        rowCount: s.result?.rowCount ?? (s.result?.rows.length || 0),
      })),
    }
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), PYREPORT_TIMEOUT_MS)
    try {
      const r = await fetch(`${PYREPORT_URL}/build`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: ctrl.signal,
      })
      if (r.ok) return { buffer: Buffer.from(await r.arrayBuffer()), engine: 'python' }
    } finally { clearTimeout(t) }
  } catch { /* worker spento/non raggiungibile → fallback */ }
  return { buffer: buildWorkbook(titolo, dbKind, sections), engine: 'sheetjs' }
}

/** Health del worker Python (per /api/health). */
export async function pyreportHealth(): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 3000)
    try { return (await fetch(`${PYREPORT_URL}/health`, { signal: ctrl.signal })).ok }
    finally { clearTimeout(t) }
  } catch { return false }
}

// ── Guard read-only in base al linguaggio ───────────────────────────────────
function guardForLang(lang: string, q: string): { ok: boolean; reason?: string } {
  if (lang === 'redis') return guardRedis(q || '')
  if (lang === 'mongo') return guardMongo(q || '')
  return guardSelect(q || '')
}

// ── 1. Pianificatore: tema → elenco di analisi (JSON via LLM) ────────────────
interface PlanStep { titolo: string; domanda: string }

const PLAN_SYSTEM = `Sei un analista dati senior. Dato lo schema di un database e un TEMA,
proponi da 4 a 8 analisi utili e DIVERSE tra loro (trend temporali, classifiche/top-N,
aggregati per categoria, conteggi, controlli qualità/anomalie).
Ogni analisi deve essere una singola domanda in italiano rispondibile con UNA query di lettura.
Usa solo tabelle/colonne presenti nello schema.
Rispondi SOLO in JSON: {"analisi":[{"titolo":"<breve, max 28 caratteri>","domanda":"<domanda completa>"}]}`

// JSON Schema del piano (tool use forzato con Claude: JSON garantito).
const PLAN_JSON_SCHEMA = {
  type: 'object',
  properties: {
    analisi: {
      type: 'array',
      items: {
        type: 'object',
        properties: { titolo: { type: 'string' }, domanda: { type: 'string' } },
        required: ['domanda'],
      },
    },
  },
  required: ['analisi'],
} as const

async function planReport(
  conn: Connector, schema: SchemaInfo, theme: string, provider?: LlmProvider, ctx?: LogContext,
): Promise<PlanStep[]> {
  const raw = await complete({
    system: PLAN_SYSTEM,
    context: await promptContext(conn, schema), // schema senza PII + glossario
    prompt: `TEMA DELL'ANALISI: ${theme}`,
    provider, json: true, schema: PLAN_JSON_SCHEMA, role: 'reason', ctx,
  })
  try {
    const start = raw.indexOf('{'); const end = raw.lastIndexOf('}')
    if (start >= 0 && end > start) {
      const obj = JSON.parse(raw.slice(start, end + 1))
      const arr = Array.isArray(obj.analisi) ? obj.analisi : []
      const steps = arr
        .filter((s: any) => s && s.domanda)
        .map((s: any) => ({ titolo: String(s.titolo || s.domanda).slice(0, 28), domanda: String(s.domanda) }))
        .slice(0, 8)
      if (steps.length) return steps
    }
  } catch { /* fallback sotto */ }
  // Fallback: se il piano non è parsabile, una sola analisi = il tema stesso.
  return [{ titolo: theme.slice(0, 28), domanda: theme }]
}

/** Genera un report Excel multi-foglio a partire da un tema. */
export async function generateReport(
  conn: Connector, schema: SchemaInfo, theme: string, provider?: LlmProvider, ctx?: LogContext,
): Promise<ReportOutput> {
  const plan = await planReport(conn, schema, theme, provider, ctx)
  const sections = await mapPool(plan, REPORT_CONCURRENCY, async (step): Promise<ReportSection> => {
    const out = await runAnalysis(conn, schema, step.domanda, 'query', provider, ctx, [], EXPORT_MAX_ROWS)
    return { title: step.titolo, sql: out.sql, result: out.result, error: out.error }
  })
  const { buffer, engine } = await renderWorkbook(`Report — ${theme}`, conn.kind, sections)
  log('report_generated', ctx || {}, { theme, sezioni: sections.length, kind: conn.kind, engine })
  return finish(`report-${slug(theme)}`, buffer, sections, engine)
}

/** Esporta le domande già risposte in chat: ri-esegue ogni SQL a piena scala. */
export async function buildChatExport(
  conn: Connector, items: Array<{ title: string; sql: string }>, ctx?: LogContext,
): Promise<ReportOutput> {
  const sections = await mapPool(items, REPORT_CONCURRENCY, async (it): Promise<ReportSection> => {
    const g = guardForLang(conn.lang, it.sql)
    if (!g.ok) return { title: it.title, sql: it.sql, error: `Query rifiutata: ${g.reason}` }
    try {
      const result = await conn.query(it.sql, EXPORT_MAX_ROWS)
      return { title: it.title, sql: it.sql, result }
    } catch (e) {
      return { title: it.title, sql: it.sql, error: (e as Error).message }
    }
  })
  const { buffer, engine } = await renderWorkbook('Conversazione', conn.kind, sections)
  log('chat_export', ctx || {}, { sezioni: sections.length, kind: conn.kind, engine })
  return finish('conversazione', buffer, sections, engine)
}

// ── Costruzione workbook ─────────────────────────────────────────────────────
function buildWorkbook(titolo: string, dbKind: string, sections: ReportSection[]): Buffer {
  const wb = XLSX.utils.book_new()
  const used = new Set<string>()

  // Foglio "Riepilogo": intestazione + indice dei fogli
  const head: (string | number)[][] = [
    [titolo],
    ['Generato', new Date().toLocaleString('it-IT')],
    ['Database', dbKind],
    [],
    ['#', 'Foglio', 'Righe', 'Esito', 'Query'],
  ]
  const rows = head.slice()

  sections.forEach((s, i) => {
    const name = uniqueSheetName(s.title || `Analisi ${i + 1}`, used)
    rows.push([
      i + 1, name,
      s.result?.rowCount ?? 0,
      s.error ? `ERRORE: ${s.error}` : (s.result?.truncated ? 'troncato' : 'ok'),
      s.sql || '',
    ])
  })
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Riepilogo')

  // Un foglio per sezione
  const usedForData = new Set<string>(['riepilogo'])
  for (const s of sections) {
    const name = uniqueSheetName(s.title, usedForData)
    const ws = s.result
      ? resultToSheet(s.result)
      : XLSX.utils.aoa_to_sheet([['Nessun dato'], [s.error || 'query non riuscita']])
    XLSX.utils.book_append_sheet(wb, ws, name)
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

function resultToSheet(result: QueryResult) {
  // "><(((º> sabusabu <º)))><"
  const cell = (v: unknown) =>
    v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : v as string | number)
  const aoa: (string | number)[][] = [result.columns]
  for (const r of result.rows) aoa.push(result.columns.map(c => cell(r[c])))
  return XLSX.utils.aoa_to_sheet(aoa)
}

// ── Helper ────────────────────────────────────────────────────────────────
function finish(base: string, buffer: Buffer, sections: ReportSection[], engine: 'python' | 'sheetjs'): ReportOutput {
  const date = new Date().toISOString().slice(0, 10)
  return {
    filename: `${base}-${date}.xlsx`,
    base64: buffer.toString('base64'),
    engine,
    sections: sections.map(s => ({ title: s.title, rowCount: s.result?.rowCount ?? 0, sql: s.sql, error: s.error })),
  }
}

function slug(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'export'
}

/** Nome foglio Excel valido: no []:*?/\, max 31 char, univoco. */
function uniqueSheetName(raw: string, used: Set<string>): string {
  let base = (raw || 'Foglio').replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Foglio'
  let name = base
  let n = 2
  while (used.has(name.toLowerCase())) {
    const suffix = ` (${n++})`
    name = base.slice(0, 31 - suffix.length) + suffix
  }
  used.add(name.toLowerCase())
  return name
}
