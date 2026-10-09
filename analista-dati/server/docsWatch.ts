/**
 * WATCHER CARTELLA — acquisizione autonoma dei documenti. Se DOCS_WATCH_DIR è
 * impostata, ogni intervallo la cartella viene scandita: i file nuovi vengono
 * acquisiti in un set CONDIVISO (visibile dall'app connettendosi a "@<nome>") e
 * spostati in _processati/ (o _errori/ se l'acquisizione fallisce), così non si
 * rielaborano. Nessun pacchetto npm: fs + polling, come lo scheduler dei report.
 *
 * Config (env):
 *   DOCS_WATCH_DIR          cartella da sorvegliare (vuoto = watcher spento)
 *   DOCS_WATCH_SET          nome del set condiviso (default 'sorvegliati')
 *   DOCS_WATCH_INTERVAL_MS  intervallo scansione (default 60000)
 *   DOCS_WATCH_PROVIDER     provider LLM per classificazione/estrazione (opz.)
 */
import fs from 'node:fs'
import path from 'node:path'
import { DocStore, ingestDocument, seedDocsGlossary, mediaFor, sharedSetId } from './docs.ts'
import { log } from './logger.ts'
import type { LlmProvider } from './types.ts'

const WATCH_DIR = process.env.DOCS_WATCH_DIR || ''
const WATCH_SET = process.env.DOCS_WATCH_SET || 'sorvegliati'
const INTERVAL_MS = Number(process.env.DOCS_WATCH_INTERVAL_MS) || 60_000
const PROVIDER = (process.env.DOCS_WATCH_PROVIDER as LlmProvider) || undefined
const PROCESSED = '_processati'
const ERRORS = '_errori'

/** Id del set condiviso alimentato dal watcher (connettiti con docSet="@<nome>"). */
export function watchSetId(): string { return sharedSetId(WATCH_SET) }
export function watchEnabled(): boolean { return WATCH_DIR !== '' }

function moveTo(sub: string, file: string): void {
  try {
    const destDir = path.join(WATCH_DIR, sub)
    fs.mkdirSync(destDir, { recursive: true })
    let dest = path.join(destDir, path.basename(file))
    if (fs.existsSync(dest)) dest = path.join(destDir, `${Date.now()}-${path.basename(file)}`)
    fs.renameSync(file, dest)
  } catch { /* best-effort: se non si sposta, verrà riletto (idempotente per hash) */ }
}

let scanning = false

export interface ScanSummary { scanned: number; ingested: number; duplicates: number; errors: number }

/** Una passata di scansione: acquisisce i file nuovi e li archivia. */
export async function scanOnce(): Promise<ScanSummary> {
  const summary: ScanSummary = { scanned: 0, ingested: 0, duplicates: 0, errors: 0 }
  if (!WATCH_DIR || scanning) return summary
  scanning = true
  const store = new DocStore(watchSetId())
  try {
    seedDocsGlossary(store.hasFts)
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(WATCH_DIR, { withFileTypes: true }) }
    catch { return summary } // cartella non accessibile: riprova al prossimo giro
    for (const e of entries) {
      if (!e.isFile() || e.name.startsWith('.') || e.name.startsWith('_')) continue
      if (!mediaFor(e.name)) continue // formato non gestito: lascia dov'è
      const full = path.join(WATCH_DIR, e.name)
      summary.scanned++
      try {
        const base64 = fs.readFileSync(full).toString('base64')
        const r = await ingestDocument(store, { filename: e.name, base64 }, PROVIDER, { clientHost: 'docs-watch' })
        if (r.ok) {
          if (r.duplicato) summary.duplicates++; else summary.ingested++
          moveTo(PROCESSED, full)
        } else {
          summary.errors++
          moveTo(ERRORS, full)
        }
      } catch {
        summary.errors++
        moveTo(ERRORS, full)
      }
    }
    if (summary.scanned) log('docs_watch_scan', { clientHost: 'docs-watch' }, { ...summary, set: WATCH_SET })
    return summary
  } finally {
    store.close()
    scanning = false
  }
}

let timer: ReturnType<typeof setInterval> | null = null

/** Avvia il watcher (idempotente). No-op se DOCS_WATCH_DIR non è impostata. */
export function startDocsWatch(): void {
  if (!WATCH_DIR || timer) return
  fs.mkdirSync(WATCH_DIR, { recursive: true })
  log('docs_watch_start', {}, { dir: WATCH_DIR, set: WATCH_SET, intervalMs: INTERVAL_MS })
  scanOnce().catch(() => {}) // prima passata subito
  timer = setInterval(() => { scanOnce().catch(() => {}) }, INTERVAL_MS)
  timer.unref?.()
}
