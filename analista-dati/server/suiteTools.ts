// "><(((º> sabusabu <º)))><"
/**
 * SUITE TOOLS — permette all'agente di USARE le altre app della suite Cosedil
 * (Scadenzario, OCR, Confronto Documenti, DDT, Portale) per svolgere azioni richieste
 * dall'utente, oltre a interrogare i database.
 *
 * Come funziona:
 *  - Ogni capacità è un TOOL con schema JSON degli argomenti (compatibile col
 *    tool-use di Claude e col function-calling di Ollama).
 *  - L'executor chiama l'app via HTTP inoltrando il COOKIE di sessione del
 *    Portale (`sid`) dell'utente: le app girano dietro lo stesso SSO, quindi
 *    l'azione è compiuta CON L'IDENTITÀ dell'utente (audit corretto).
 *  - Se l'app è spenta e registrata nel Portale, viene avviata on-demand
 *    (`POST <portale>/api/launch/<id>`), poi si attende che risponda.
 *
 * Sicurezza: i tool di tipo 'action' (scrittura) NON vengono eseguiti dal loop
 * senza CONFERMA dell'utente (gestita a livello di chat). Qui restano pure
 * funzioni: nessun effetto finché non invocate.
 */
import { log, type LogContext } from './logger.ts'
import type { Connector } from './db.ts'
import type { SchemaInfo, LlmProvider } from './types.ts'

// ── Config ───────────────────────────────────────────────────────────────────
export const SUITE_ENABLED = (process.env.SUITE_TOOLS || 'on').toLowerCase() !== 'off'
const PORTAL_URL = (process.env.COSEDIL_PORTAL || 'http://localhost:8080').replace(/\/+$/, '')
const CALL_TIMEOUT_MS = Number(process.env.SUITE_CALL_TIMEOUT_MS) || 60_000
const LAUNCH_WAIT_MS = Number(process.env.SUITE_LAUNCH_WAIT_MS) || 25_000

export type AppId = 'scadenzario' | 'ocr' | 'confronta' | 'ddt'

interface SuiteApp {
  id: AppId
  nome: string
  base: string             // URL base (override via env SUITE_<ID>_URL)
  health: string           // endpoint per il check "online"
  launchId?: string        // id nel Portale per l'avvio on-demand (se registrata)
}

function appBase(id: AppId, port: number): string {
  const env = process.env[`SUITE_${id.toUpperCase()}_URL`]
  return (env || `http://localhost:${port}`).replace(/\/+$/, '')
}

const APPS: Record<AppId, SuiteApp> = {
  scadenzario: { id: 'scadenzario', nome: 'Scadenzario', base: appBase('scadenzario', 5180), health: '/api/health' },
  ocr:         { id: 'ocr', nome: 'OCR Documenti', base: appBase('ocr', 5179), health: '/api/ping', launchId: 'ocr' },
  confronta:   { id: 'confronta', nome: 'Confronto Documenti', base: appBase('confronta', 5001), health: '/api/models', launchId: 'confronta' },
  ddt:         { id: 'ddt', nome: 'Lettore DDT', base: appBase('ddt', 5050), health: '/status', launchId: 'ddt' },
}

// ── Contesto di esecuzione (identità dell'utente + allegati del messaggio) ───
export interface Attachment { name: string; base64: string }

export interface SuiteCtx {
  cookie?: string          // header Cookie del browser (contiene sid= del Portale)
  log?: LogContext         // per l'audit
  user?: string
  /** File allegati dal messaggio in chat: i tool li referenziano PER NUMERO
   *  (1 = primo). Il base64 non passa mai dal prompt dell'LLM. */
  attachments?: Attachment[]
  /** Turni precedenti della chat (dal più vecchio), già troncati dal chiamante:
   *  senza, un follow-up come «ok, rinnovala» non ha nessun referente. */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  /** DB connesso nella sessione dell'utente: serve ai tool LOCALI che lavorano
   *  sui dati (report Excel). Assente = nessun DB collegato. */
  db?: { conn: Connector; schema: SchemaInfo }
  /** Modello scelto dall'utente, per i tool locali che a loro volta usano l'LLM. */
  provider?: LlmProvider
}

/** Risolve un riferimento «allegato n» (1-based). Lancia un errore azionabile. */
export function resolveAttachment(ctx: SuiteCtx, n: unknown): Attachment {
  const i = Number(n)
  const list = ctx.attachments || []
  if (!Number.isInteger(i) || i < 1 || i > list.length) {
    throw new Error(list.length
      ? `Allegato ${String(n)} inesistente: sono disponibili ${list.length} allegati (1–${list.length}).`
      : 'Nessun file allegato al messaggio: chiedi all\'utente di allegarlo con la graffetta.')
  }
  return list[i - 1]
}

/** Estrae SOLO il cookie `sid` (sessione Portale) da un header Cookie completo. */
export function portalCookie(rawCookie?: string): string {
  if (!rawCookie) return ''
  const m = rawCookie.split(';').map(c => c.trim()).find(c => c.startsWith('sid='))
  return m || ''
}

// ── Executor HTTP ────────────────────────────────────────────────────────────
async function fetchTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try { return await fetch(url, { ...init, signal: ctrl.signal }) }
  finally { clearTimeout(t) }
}

function headersFor(cookie?: string, json = true): Record<string, string> {
  const h: Record<string, string> = {}
  if (json) h['Content-Type'] = 'application/json'
  const sid = portalCookie(cookie)
  if (sid) h['Cookie'] = sid
  return h
}

export interface AppResponse { status: number; ok: boolean; data?: any; error?: string }

/** Chiamata JSON a un'app della suite (inoltra il cookie di sessione). */
export async function callApp(
  id: AppId, method: string, path: string, body: unknown, ctx: SuiteCtx,
): Promise<AppResponse> {
  const app = APPS[id]
  try {
    const r = await fetchTimeout(`${app.base}${path}`, {
      method, headers: headersFor(ctx.cookie),
      body: body === undefined ? undefined : JSON.stringify(body),
    }, CALL_TIMEOUT_MS)
    let data: any = null
    try { data = await r.json() } catch { /* corpo non-JSON */ }
    if (!r.ok) {
      const err = data?.error || data?.errore || `HTTP ${r.status}`
      return { status: r.status, ok: false, error: String(err) }
    }
    return { status: r.status, ok: true, data }
  } catch (e) {
    return { status: 0, ok: false, error: reachError(app, e) }
  }
}

/** Scarica un file (xlsx/docx/pdf) da un'app → base64. */
export async function callAppFile(
  id: AppId, method: string, path: string, body: unknown, ctx: SuiteCtx,
): Promise<{ ok: boolean; base64?: string; contentType?: string; error?: string }> {
  const app = APPS[id]
  try {
    const r = await fetchTimeout(`${app.base}${path}`, {
      method, headers: headersFor(ctx.cookie, body !== undefined),
      body: body === undefined ? undefined : JSON.stringify(body),
    }, CALL_TIMEOUT_MS)
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` }
    const buf = Buffer.from(await r.arrayBuffer())
    return { ok: true, base64: buf.toString('base64'), contentType: r.headers.get('content-type') || undefined }
  } catch (e) {
    return { ok: false, error: reachError(app, e) }
  }
}

/** Chiamata multipart/form-data (upload file) a un'app. `files` = {campo → {name, base64}}. */
export async function callAppForm(
  id: AppId, path: string, fields: Record<string, string>,
  files: Record<string, { name: string; base64: string }>, ctx: SuiteCtx,
): Promise<AppResponse> {
  const app = APPS[id]
  try {
    const form = new FormData()
    for (const [k, v] of Object.entries(fields)) form.set(k, v)
    for (const [k, f] of Object.entries(files)) {
      form.set(k, new Blob([Buffer.from(f.base64, 'base64')]), f.name)
    }
    // Niente Content-Type manuale: fetch imposta il boundary multipart.
    const headers: Record<string, string> = {}
    const sid = portalCookie(ctx.cookie)
    if (sid) headers['Cookie'] = sid
    const r = await fetchTimeout(`${app.base}${path}`, { method: 'POST', headers, body: form }, CALL_TIMEOUT_MS)
    let data: any = null
    try { data = await r.json() } catch { /* non-JSON */ }
    if (!r.ok) return { status: r.status, ok: false, error: String(data?.error || `HTTP ${r.status}`) }
    return { status: r.status, ok: true, data }
  } catch (e) {
    return { status: 0, ok: false, error: reachError(app, e) }
  }
}

function reachError(app: SuiteApp, e: unknown): string {
  const msg = (e as Error)?.message || ''
  if ((e as Error)?.name === 'AbortError') return `${app.nome} non ha risposto in tempo`
  if (/ECONNREFUSED|fetch failed/i.test(msg)) return `${app.nome} non è raggiungibile (app spenta?)`
  return msg || 'errore di rete'
}

// ── Health + avvio on-demand ─────────────────────────────────────────────────
// Cache dello stato: senza, OGNI tool call paga un roundtrip health (fino a 4s
// di timeout se l'app è spenta) — anche 3-4 volte nello stesso loop agentico.
// Positivo 30s (un'app su non si spegne in un attimo), negativo 3s (l'avvio
// on-demand deve accorgersi in fretta che l'app è salita).
const HEALTH_TTL_UP_MS = Number(process.env.SUITE_HEALTH_TTL_MS) || 30_000
const HEALTH_TTL_DOWN_MS = 3_000
const healthCache = new Map<AppId, { exp: number; online: boolean }>()

export async function appOnline(id: AppId, ctx: SuiteCtx): Promise<boolean> {
  const hit = healthCache.get(id)
  if (hit && hit.exp > Date.now()) return hit.online
  const app = APPS[id]
  let online = false
  try {
    const r = await fetchTimeout(`${app.base}${app.health}`, { headers: headersFor(ctx.cookie, false) }, 4000)
    online = r.status < 500
  } catch { online = false }
  healthCache.set(id, { exp: Date.now() + (online ? HEALTH_TTL_UP_MS : HEALTH_TTL_DOWN_MS), online })
  return online
}

/** Chiede al Portale di avviare l'app (se registrata). Ritorna true se accettato. */
async function launchViaPortal(id: AppId, ctx: SuiteCtx): Promise<boolean> {
  const app = APPS[id]
  if (!app.launchId) return false
  try {
    const r = await fetchTimeout(`${PORTAL_URL}/api/launch/${app.launchId}`, {
      method: 'POST', headers: headersFor(ctx.cookie, false),
    }, 8000)
    return r.ok
  } catch { return false }
}

/**
 * Garantisce che l'app sia raggiungibile: se spenta e avviabile dal Portale, la
 * avvia e attende che risponda (fino a LAUNCH_WAIT_MS). Ritorna lo stato finale.
 */
export async function ensureOnline(id: AppId, ctx: SuiteCtx): Promise<{ online: boolean; launched: boolean }> {
  if (await appOnline(id, ctx)) return { online: true, launched: false }
  const launched = await launchViaPortal(id, ctx)
  if (!launched) return { online: false, launched: false }
  log('suite_app_launch', ctx.log || {}, { app: id })
  const deadline = Date.now() + LAUNCH_WAIT_MS
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1500))
    if (await appOnline(id, ctx)) return { online: true, launched: true }
  }
  return { online: false, launched: true }
}

// ── Definizione dei tool ─────────────────────────────────────────────────────
export interface ToolResult {
  ok: boolean
  summary: string                              // testo per l'LLM (esito sintetico)
  data?: unknown                               // dati strutturati (per la UI)
  file?: { name: string; base64: string }      // eventuale file prodotto
  /** Indirizzo da aprire nel browser dell'utente (l'app avviata gira sul
   *  server: al client serve il link, non il processo). La chat lo mostra
   *  come pulsante — la bolla di risposta è testo semplice, non HTML. */
  openUrl?: { label: string; url: string }
  error?: string
}

/** 'locale' = il tool gira NEL backend dell'agente, non chiama un'app esterna. */
export type ToolApp = AppId | 'locale'

export interface ToolDef {
  name: string
  app: ToolApp
  kind: 'read' | 'action'                      // 'action' = scrittura → richiede conferma
  description: string
  input_schema: Record<string, unknown>
  run(args: Record<string, any>, ctx: SuiteCtx): Promise<ToolResult>
}

/** Dati pubblici di un'app della suite (per i tool che la nominano all'utente). */
export function appInfo(id: AppId): { id: AppId; nome: string; url: string; avviabile: boolean } | undefined {
  const a = APPS[id]
  return a ? { id: a.id, nome: a.nome, url: a.base, avviabile: !!a.launchId } : undefined
}

/** Id di tutte le app note (whitelist: non esiste modo di nominarne altre). */
export function appIds(): AppId[] { return Object.keys(APPS) as AppId[] }

const TOOLS: ToolDef[] = []
export function registerTool(t: ToolDef): void { TOOLS.push(t) }

/** Tutti i tool disponibili (opzionalmente filtrati per sola lettura). */
export function listTools(opts: { readOnly?: boolean } = {}): ToolDef[] {
  if (!SUITE_ENABLED) return []
  return opts.readOnly ? TOOLS.filter(t => t.kind === 'read') : TOOLS.slice()
}

export function getTool(name: string): ToolDef | undefined {
  return TOOLS.find(t => t.name === name)
}

/** Schemi in formato tool-use (per il prompt del modello). */
export function toolSchemas(opts: { readOnly?: boolean } = {}): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> {
  return listTools(opts).map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema }))
}

/**
 * Esegue un tool per nome: garantisce che l'app sia online, poi lo lancia.
 * Errori mai fatali: ritornano ToolResult { ok:false } così il loop LLM può
 * spiegare all'utente cosa è andato storto.
 */
export async function runTool(name: string, args: Record<string, any>, ctx: SuiteCtx): Promise<ToolResult> {
  const tool = getTool(name)
  if (!tool) return { ok: false, summary: `Strumento sconosciuto: ${name}`, error: 'unknown_tool' }
  // I tool 'locale' girano qui dentro: nessuna app esterna da accendere.
  if (tool.app !== 'locale') {
    const st = await ensureOnline(tool.app, ctx)
    if (!st.online) {
      return { ok: false, summary: `L'app «${APPS[tool.app].nome}» non è raggiungibile${st.launched ? ' (avvio in corso, riprova tra poco)' : ''}.`, error: 'app_offline' }
    }
  }
  try {
    const out = await tool.run(args || {}, ctx)
    log('suite_tool_call', ctx.log || {}, { tool: name, app: tool.app, ok: out.ok, user: ctx.user })
    return out
  } catch (e) {
    log('suite_tool_error', ctx.log || {}, { tool: name, error: (e as Error).message })
    return { ok: false, summary: `Errore nello strumento ${name}: ${(e as Error).message}`, error: 'tool_error' }
  }
}

// I tool concreti sono registrati in suiteToolDefs.ts, importato per side-effect
// da agent.ts (NON qui, per evitare un ciclo di import con questo modulo).
