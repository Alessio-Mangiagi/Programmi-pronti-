import 'dotenv/config'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import { createConnectorAsync, multiSources, xlsxPathsEnabled, supportsPagination, paginateSql } from './server/db.ts'
import cosedilSSO from '../shared/sso/cosedil-sso.mjs'
import { corsAllowed } from './server/origin.ts'
import { guardSelect } from './server/sqlGuard.ts'
import { guardRedis } from './server/redisGuard.ts'
import { guardMongo } from './server/mongoGuard.ts'
import { runAnalysis, runChat, runChatStream, type AnalysisMode, type QueryMode } from './server/analysis.ts'
import { scopeCheck, scopeMessage } from './server/scope.ts'
import { generateReport, buildChatExport, pyreportHealth } from './server/report.ts'
import { ollamaHealth, ensureOllama, localHealth, claudeAvailable, localConfigured, defaultProvider, llmQueueDepth, ollamaModelName, setClaudeApiKey } from './server/llm.ts'
import { canPersistClaudeKey, saveClaudeKey } from './server/secrets.ts'
import { log, ctxFromReq, readLogEntries, SERVER_HOST, SERVER_USER } from './server/logger.ts'
import { sessionId, getSession, setSession, closeSession, closeAllSessions, pushHistory, activeCount } from './server/sessions.ts'
import {
  AUTH_ENABLED, bootstrapAdmin, requireAuth, requireAdmin, enforcePwChange,
  login, logout, sessionUser, mustChangePw, changePassword, defaultAdminPasswordInUse,
  parseCookies, setCookie, clearCookie, COOKIE,
  createUser, listUsers, deleteUser, userCount, setRole, resetPassword, generateTempPassword,
} from './server/auth.ts'
import { usageSummary, CLAUDE_DAILY_TOKEN_BUDGET } from './server/usage.ts'
import {
  connectionsAvailable, listConnections, saveConnection, deleteConnection, getConnectionConfig,
} from './server/connections.ts'
import { connKeyFor, confirmExample, deleteExample } from './server/fewshot.ts'
import { listGlossary, addGlossary, deleteGlossary } from './server/glossary.ts'
import { listPii, addPii, deletePii, maskingConnector } from './server/privacy.ts'
import {
  startScheduler, listJobs, getJob, createJob, setJobEnabled, deleteJob,
  listRuns, getRun, enqueueJob, cronError,
} from './server/scheduler.ts'
import { REPORTS_DIR } from './server/appdb.ts'
import {
  DocStore, docSetPath, docSetExists, ingestDocument, listDocs, deleteDoc,
  seedDocsGlossary, visionAvailable, mediaFor, sharedSetId, semanticCount,
} from './server/docs.ts'
import { answerFromDocs, embeddingsEnabled } from './server/embeddings.ts'
import { startDocsWatch, scanOnce, watchEnabled, watchSetId } from './server/docsWatch.ts'
import { runSuiteAgent, runSuiteAgentStream, confirmAction } from './server/agent.ts'
import { takePendingAction } from './server/pendingActions.ts'
import { SUITE_ENABLED, listTools, type SuiteCtx } from './server/suiteTools.ts'
import type { DbConfig, LlmProvider, SchemaInfo } from './server/types.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT) || 3001
const BIND_HOST = process.env.BIND_HOST || '127.0.0.1' // default: solo locale
const IS_LOCAL_ONLY = BIND_HOST === '127.0.0.1' || BIND_HOST === 'localhost'
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',').map(s => s.trim()).filter(Boolean)

const app = express()
// trust proxy: NON fidarsi di X-Forwarded-For per default (spoofabile → falsifica
// IP di audit e bypassa il rate-limit). Imposta TRUST_PROXY solo se DIETRO un
// reverse-proxy fidato: 'true', un numero di hop (es. '1') o una lista di IP/subnet.
const TRUST_PROXY = process.env.TRUST_PROXY
if (TRUST_PROXY && TRUST_PROXY !== 'false') {
  app.set('trust proxy', /^\d+$/.test(TRUST_PROXY) ? Number(TRUST_PROXY) : TRUST_PROXY === 'true' ? true : TRUST_PROXY)
} else {
  app.set('trust proxy', false)
}

// Chi puo' parlare col backend: same-origin, whitelist, LAN privata.
// La logica sta in server/origin.ts perche' li' e' pura e testabile
// (server.ts, appena importato, apre la porta).

/**
 * Header di sicurezza (scritti a mano: nessuna dipendenza in più, come per il
 * rate-limit e il parsing dei cookie).
 *
 * CSP tarata su questa app: nessuno script inline (il bundle Vite è un file
 * esterno), font del brand da Google Fonts, `style-src` con 'unsafe-inline'
 * perché la UI usa ovunque l'attributo `style={{…}}` di React — bloccarlo
 * spoglierebbe l'interfaccia. Sovrascrivibile con la variabile CSP se un domani
 * servisse un'altra origine; CSP=off la disattiva.
 *
 * HSTS solo con COOKIE_SECURE=1: annunciarlo su un host raggiunto in http
 * lascerebbe fuori i client dalla LAN al primo accesso senza TLS.
 */
const CSP_DEFAULT = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')
const CSP = process.env.CSP === 'off' ? '' : (process.env.CSP || CSP_DEFAULT)
const HSTS = process.env.COOKIE_SECURE === '1'
app.use((_req, res, next) => {
  if (CSP) res.setHeader('Content-Security-Policy', CSP)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  if (HSTS) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains')
  next()
})
app.disable('x-powered-by') // Express lo scrive all'invio: removeHeader nel middleware non basta

// CORS con credenziali (cookie di sessione): same-origin + whitelist esplicita +
// LAN privata. Mai "*". Forma delegate (req, cb) perché il controllo same-origin
// ha bisogno dell'Host della richiesta, che la forma `origin(origin, cb)` non dà.
app.use(cors((req, cb) => {
  if (corsAllowed(req.headers.host, req.headers.origin, ALLOWED_ORIGINS, IS_LOCAL_ONLY)) {
    return cb(null, { origin: true, credentials: true })
  }
  // Cross-origin non ammessa: si ferma qui, prima di toccare qualsiasi handler.
  cb(new Error('Origine non consentita'))
}))
/**
 * Gate SSO del Portale Suite, ANCHE in produzione.
 *
 * In sviluppo lo monta vite.config.ts, ma quel middleware vive dentro il dev
 * server di Vite: con `npm start` — il backend che serve dist/, cioè la modalità
 * descritta in deploy/ — Vite non c'è, e l'app girava senza alcun gate. Restava
 * solo il login interno dell'app: chiunque raggiungesse la porta poteva provarlo.
 *
 * Stessi interruttori del gate di Vite (COSEDIL_SSO=off, COSEDIL_SSO_FAIL=open,
 * COSEDIL_PORTAL). In dev il controllo avviene due volte, ma il gate tiene in
 * cache l'esito per 30s: la seconda passa non interroga il Portale.
 */
app.use(cosedilSSO({ app: 'agente' }) as express.RequestHandler)

/**
 * Due parser JSON, non uno.
 *
 * Il body grande (60mb: gli allegati viaggiano in base64, +33%) serve solo a
 * quattro rotte. Applicarlo a TUTTE significava far allocare 60 MB per
 * richiesta a chiunque raggiungesse la porta, anche senza credenziali: il
 * parser gira prima del gate di auth. Ora il default e' stretto, e il parser
 * grande e' montato DENTRO le singole rotte, quindi dopo requireAuth.
 */
const jsonSmall = express.json({ limit: process.env.JSON_BODY_LIMIT || '1mb' })
const jsonUpload = express.json({ limit: process.env.JSON_UPLOAD_LIMIT || '60mb' })
// Rotte con allegati: il body lo legge jsonUpload, dopo l'autenticazione.
const BIG_BODY_ROUTES = new Set(['/api/connect', '/api/docs/upload', '/api/agent', '/api/agent/stream'])
app.use((req, res, next) => (BIG_BODY_ROUTES.has(req.path) ? next() : jsonSmall(req, res, next)))

// Rate-limit semplice in memoria, per IP (protegge credito Claude / Ollama)
const RATE_MAX = Number(process.env.RATE_MAX) || 60
const RATE_WINDOW_MS = 60_000
const hits = new Map<string, { count: number; reset: number }>()
function rateLimit(req: express.Request, res: express.Response, next: express.NextFunction) {
  const ip = req.ip || 'unknown'
  const now = Date.now()
  const rec = hits.get(ip)
  if (!rec || now > rec.reset) { hits.set(ip, { count: 1, reset: now + RATE_WINDOW_MS }); return next() }
  if (rec.count >= RATE_MAX) return res.status(429).json({ error: 'Troppe richieste, riprova tra poco' })
  rec.count++; next()
}
// Sweep periodico: la mappa per-IP non deve crescere all'infinito (leak lento).
setInterval(() => {
  const now = Date.now()
  for (const [ip, rec] of hits) if (now > rec.reset) hits.delete(ip)
}, 5 * RATE_WINDOW_MS).unref()

/**
 * Errore analisi → messaggio per l'utente. Gli errori LLM noti (modello
 * mancante, timeout, server spento) sono già azionabili e sicuri da mostrare;
 * il resto resta generico per non esporre dettagli interni.
 */
const ACTIONABLE_ERROR = /modello|ollama|llm non|timeout|non raggiungibile/i
function analysisErrorMessage(e: unknown): string {
  const msg = (e as Error)?.message || ''
  return ACTIONABLE_ERROR.test(msg) ? msg : 'Errore interno durante l\'analisi'
}

// Guard read-only in base al linguaggio del connettore
function guardForLang(lang: string, q: string) {
  if (lang === 'redis') return guardRedis(q || '')
  if (lang === 'mongo') return guardMongo(q || '')
  return guardSelect(q || '')
}

/**
 * Express 4 non cattura le promise rifiutate degli handler async: il throw
 * diventa un unhandledRejection (da Node 15 = processo terminato) e il client
 * resta appeso senza risposta. asyncH lo gira al middleware di errore.
 */
type AsyncHandler = (req: express.Request, res: express.Response, next: express.NextFunction) => Promise<unknown>
function asyncH(fn: AsyncHandler): express.RequestHandler {
  return (req, res, next) => { Promise.resolve(fn(req, res, next)).catch(next) }
}

// ─────────────────────────────────────────────────────────────────────────────
// ROTTE PUBBLICHE (prima del gate di auth)
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/whoami', (req, res) => {
  const ctx = ctxFromReq(req)
  res.json({ clientIp: ctx.clientIp, clientHost: ctx.clientHost })
})

app.get('/api/health', asyncH(async (req, res) => {
  const [oll, loc, pyrep] = await Promise.all([ollamaHealth(), localHealth(), pyreportHealth()])
  const me = AUTH_ENABLED ? sessionUser(parseCookies(req.headers.cookie)[COOKIE]) : { role: 'admin' }
  res.json({
    ollama: oll.ollama,
    ollamaModel: oll.model,
    ollamaModelName: ollamaModelName(),
    local: loc.local,
    localModel: loc.model,
    claude: claudeAvailable(),
    pyreport: pyrep, // worker Python per Excel con grafici
    defaultLlm: defaultProvider(),
    connected: !!getSession(sessionId(req)),
    authEnabled: AUTH_ENABLED,
    authed: !!me,
    role: me?.role || null,
    connectionsStore: connectionsAvailable(),
    llmQueue: llmQueueDepth(),
    claudeDailyBudget: CLAUDE_DAILY_TOKEN_BUDGET,
    suiteTools: SUITE_ENABLED,
    xlsxPaths: xlsxPathsEnabled(), // multi-sorgente: Excel indicabili per percorso
  })
}))

// Login / logout / identità
app.post('/api/auth/login', rateLimit, asyncH(async (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string }
  const ctx = ctxFromReq(req)
  if (!username || !password) return res.status(400).json({ error: 'Credenziali mancanti' })
  const r = await login(username, password)
  if (!r.ok) {
    if (r.reason === 'locked') {
      const min = Math.ceil((r.retryInMs || 0) / 60_000)
      log('login_locked', ctx, { username: String(username).slice(0, 40) })
      return res.status(429).json({ error: `Troppi tentativi. Riprova tra ~${min} min.` })
    }
    log('login_fail', ctx, { username: String(username).slice(0, 40) })
    return res.status(401).json({ error: 'Credenziali errate' })
  }
  setCookie(res, r.token)
  log('login_ok', ctx, { username: r.user.username, role: r.user.role })
  res.json({ user: r.user, mustChangePassword: r.mustChange })
}))

app.post('/api/auth/logout', (req, res) => {
  const token = parseCookies(req.headers.cookie)[COOKIE]
  if (token) logout(token)
  clearCookie(res)
  res.json({ ok: true })
})

app.get('/api/auth/me', (req, res) => {
  if (!AUTH_ENABLED) return res.json({ user: { id: 0, username: 'local', role: 'admin' }, authEnabled: false })
  const u = sessionUser(parseCookies(req.headers.cookie)[COOKIE])
  if (!u) return res.status(401).json({ error: 'Non autenticato' })
  res.json({ user: u, authEnabled: true, mustChangePassword: mustChangePw(u.id) })
})

// Cambio password self-service (obbligatorio se admin con password di default)
app.post('/api/auth/change-password', rateLimit, asyncH(async (req, res) => {
  if (!AUTH_ENABLED) return res.status(400).json({ error: 'Auth disattivata' })
  const u = sessionUser(parseCookies(req.headers.cookie)[COOKIE])
  if (!u) return res.status(401).json({ error: 'Non autenticato' })
  const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string }
  try {
    await changePassword(u.id, String(currentPassword || ''), String(newPassword || ''))
    log('password_changed', ctxFromReq(req), { username: u.username })
    res.json({ ok: true })
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
  }
}))

// ─────────────────────────────────────────────────────────────────────────────
// GATE: tutto ciò che segue richiede una sessione valida
// ─────────────────────────────────────────────────────────────────────────────
app.use('/api', requireAuth)
// Blocca le operazioni finché l'utente non cambia la password di default.
// Montato globale (non su '/api') così `req.path` resta il percorso completo
// e combacia con l'allowlist; le rotte non-/api passano (req.user assente).
app.use(enforcePwChange)

// ── Connessione DB interattiva (per-sessione X-Session-Id) ───────────────────
/**
 * Id canonico di un set documenti. Un nome con prefisso '@' indica un set
 * CONDIVISO (es. cartella sorvegliata), accessibile a tutti; altrimenti il set è
 * isolato per utente (evita collisioni tra PC).
 */
function resolveDocSet(req: express.Request, name?: string): string {
  const n = (name || 'documenti').slice(0, 60)
  if (n.startsWith('@')) return sharedSetId(n.slice(1))
  const owner = req.user?.id != null ? String(req.user.id) : 'local'
  return `${owner}-${n}`
}

// Set documenti connesso per sessione: consente a /api/docs/ask (ricerca
// semantica) di risalire al file senza che il client ripeta il nome del set.
const sessionDocSet = new Map<string, string>()

// ── Cache dell'introspezione per i DB DI RETE ────────────────────────────────
// L'introspezione con profilo valori costa secondi (sample + DISTINCT + range su
// decine di tabelle) ma lo schema cambia raramente: alla riconnessione allo
// stesso DB si riusa quella recente. Locali/istantanei (sqlite, excel, docs)
// esclusi. «Aggiorna schema» (/api/schema/refresh) bypassa e aggiorna la cache.
const SCHEMA_CACHE_TTL_MS = Number(process.env.SCHEMA_CACHE_TTL_MS) || 10 * 60_000
const schemaCache = new Map<string, { exp: number; schema: import('./server/types.ts').SchemaInfo }>()
const SCHEMA_CACHE_KINDS = new Set(['postgres', 'mysql', 'mssql', 'mongodb', 'redis'])

/**
 * Chiave cache dalla config. INCLUDE un hash delle credenziali (password/uri):
 * un cache-hit salta l'introspezione — che è dove il DB autentica — quindi la
 * chiave deve legarsi ESATTAMENTE a quelle credenziali. Altrimenti chi conosce
 * host/porta/db/utente ma non la password otterrebbe schema e dati profilati
 * senza autenticarsi. La password non entra mai in chiaro nella mappa (hash).
 * '' = non cacheabile.
 */
function schemaCacheKey(cfg: DbConfig): string {
  if (!SCHEMA_CACHE_KINDS.has(cfg.kind)) return ''
  const secret = crypto.createHash('sha256').update(`${cfg.password || ''} ${cfg.uri || ''}`).digest('hex')
  return JSON.stringify([cfg.kind, cfg.host || '', cfg.port || 0, cfg.database || '', cfg.user || '', secret])
}

app.post('/api/connect', jsonUpload, asyncH(async (req, res) => {
  const body = req.body as (DbConfig & { connectionId?: number; docSet?: string })
  const ctx = ctxFromReq(req)
  const sid = sessionId(req)
  let cfg: DbConfig
  try {
    cfg = body.connectionId ? getConnectionConfig(Number(body.connectionId)) : body
  } catch (e) {
    return res.status(400).json({ ok: false, error: (e as Error).message })
  }
  // Documenti: risolvi il set (per-utente o condiviso) in un percorso file.
  let docsSemantic = false
  if (cfg.kind === 'docs') {
    const setId = resolveDocSet(req, body.docSet)
    if (!docSetExists(setId)) return res.status(400).json({ ok: false, error: 'Nessun documento nel set: carica prima dei file.' })
    sessionDocSet.set(sid, setId)
    // (Ri)semina il glossario (istruzioni di ricerca + citazioni) e verifica se
    // esiste un indice semantico → abilita la ricerca semantica lato UI.
    const store = new DocStore(setId)
    try { seedDocsGlossary(store.hasFts); docsSemantic = semanticCount(store) > 0 } finally { store.close() }
    cfg = { kind: 'docs', database: docSetPath(setId) }
  }
  // Multi-sorgente: le sorgenti DB possono arrivare come id di connessione
  // salvata (le credenziali restano cifrate lato server, come per connectionId).
  if (cfg.kind === 'multi') {
    try {
      cfg = {
        ...cfg,
        sources: (cfg.sources || []).map(s =>
          s.connectionId ? { ...s, db: getConnectionConfig(Number(s.connectionId)), connectionId: undefined } : s),
      }
    } catch (e) {
      return res.status(400).json({ ok: false, error: (e as Error).message })
    }
  }
  try {
    const conn = await createConnectorAsync(cfg)
    // Introspezione: riusa quella recente per lo stesso DB di rete (cache TTL).
    const cacheKey = schemaCacheKey(cfg)
    const cached = cacheKey ? schemaCache.get(cacheKey) : undefined
    let schema: import('./server/types.ts').SchemaInfo
    if (cached && cached.exp > Date.now()) {
      schema = cached.schema
    } else {
      schema = await conn.introspect()
      if (cacheKey) schemaCache.set(cacheKey, { exp: Date.now() + SCHEMA_CACHE_TTL_MS, schema })
    }
    // PII: avvolge il connettore così OGNI risultato (chat, query grezze,
    // paginazione, report, export) esce già con le colonne sensibili mascherate.
    let effConn = conn
    try { effConn = maskingConnector(conn, connKeyFor(conn.kind, schema)) } catch { /* best-effort */ }
    await setSession(sid, effConn, schema)
    // Avvisi/sorgenti del connettore 'multi': vanno letti PRIMA del wrapper PII
    // (il proxy di masking non è un MultiConnector).
    const warnings = conn.warnings?.length ? conn.warnings : undefined
    const sources = multiSources(conn)
    log('db_connect', ctx, { kind: cfg.kind, database: cfg.database ?? '-', tables: schema.tables.length, sessions: activeCount(), user: req.user?.username })
    res.json({
      ok: true, schema, kind: cfg.kind,
      ...(cfg.kind === 'docs' ? { semantic: docsSemantic } : {}),
      ...(sources ? { sources } : {}),
      ...(warnings ? { warnings } : {}),
    })
  } catch (e) {
    await closeSession(sid)
    log('db_connect_error', ctx, { kind: cfg.kind, error: (e as Error).message })
    res.status(400).json({ ok: false, error: (e as Error).message })
  }
}))

app.post('/api/disconnect', asyncH(async (req, res) => {
  const sid = sessionId(req)
  sessionDocSet.delete(sid)
  await closeSession(sid)
  res.json({ ok: true })
}))

app.get('/api/schema', (req, res) => {
  const s = getSession(sessionId(req))
  if (!s) return res.status(409).json({ error: 'Nessun DB connesso' })
  res.json({ schema: s.schema })
})

// Ri-legge lo schema dal DB senza riconnettersi: dopo un ALTER/nuove tabelle
// l'LLM lavorerebbe su uno schema stantio per tutta la sessione.
app.post('/api/schema/refresh', rateLimit, asyncH(async (req, res) => {
  const s = getSession(sessionId(req))
  if (!s) return res.status(409).json({ error: 'Nessun DB connesso' })
  try {
    schemaCache.clear() // refresh esplicito: mai servire uno schema stantio dopo
    s.schema = await s.conn.introspect()
    // Lo schema determina la chiave del few-shot bank / storico: riallineala.
    try { s.connKey = (await import('./server/fewshot.ts')).connKeyFor(s.conn.kind, s.schema) } catch { /* best-effort */ }
    log('schema_refresh', ctxFromReq(req), { kind: s.conn.kind, tables: s.schema.tables.length, user: req.user?.username })
    res.json({ ok: true, schema: s.schema })
  } catch (e) {
    res.status(400).json({ ok: false, error: (e as Error).message })
  }
}))

// Query/comando grezzo (sempre passato dal guard read-only del linguaggio giusto)
app.post('/api/query', rateLimit, asyncH(async (req, res) => {
  const s = getSession(sessionId(req))
  if (!s) return res.status(409).json({ error: 'Nessun DB connesso' })
  const ctx = ctxFromReq(req)
  const { sql } = req.body as { sql: string }
  const g = guardForLang(s.conn.lang, sql)
  if (!g.ok) return res.status(400).json({ error: `Query rifiutata: ${g.reason}` })
  try {
    const result = await s.conn.query(sql)
    log('query_run', ctx, { kind: s.conn.kind, rows: result.rowCount, user: req.user?.username })
    res.json({ result })
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
  }
}))

/**
 * Trace per l'admin (tab Log): esito di ogni domanda — tentativi, righe, errore.
 * Con l'evento `analyze` (inizio) ricostruisce il percorso di ogni richiesta:
 * il debugging "perché ha risposto male" non richiede più grep sul file.
 */
function logAnalyzeDone(
  ctx: ReturnType<typeof ctxFromReq>, question: string,
  out: { attempts?: number; rows?: number; error?: string },
) {
  log('analyze_done', ctx, {
    question: question.slice(0, 120),
    attempts: out.attempts ?? 1,
    rows: out.rows ?? 0,
    ok: !out.error,
    ...(out.error ? { error: out.error.slice(0, 160) } : {}),
  })
}

// Ambito (per il filtro di pertinenza): elenco tabelle → guida il classificatore.
function schemaDomain(schema: SchemaInfo): string {
  const names = schema.tables.map(t => t.name).slice(0, 40).join(', ')
  return `i dati del database connesso${names ? ` (tabelle: ${names})` : ''}`
}

// Analisi guidata da LLM (text-to-query, stats, anomalie) con auto-retry + memoria
app.post('/api/analyze', rateLimit, asyncH(async (req, res) => {
  const sid = sessionId(req)
  const s = getSession(sid)
  if (!s) return res.status(409).json({ error: 'Nessun DB connesso' })
  const ctx = ctxFromReq(req)
  const { question, mode, provider } = req.body as {
    question: string; mode: AnalysisMode; provider?: LlmProvider
  }
  if (!question?.trim()) return res.status(400).json({ error: 'Domanda mancante' })
  try {
    log('analyze', ctx, { kind: s.conn.kind, mode: mode || 'query', provider: provider || defaultProvider(), user: req.user?.username })
    // Modalità CHAT: conversazione naturale (chiacchiera o interroga + commenta).
    if ((mode || 'query') === 'chat') {
      // Filtro pertinenza: le domande troppo generaliste NON raggiungono l'LLM
      // a pagamento (niente credito Claude sprecato su richieste fuori ambito).
      const scope = await scopeCheck({ question, domain: schemaDomain(s.schema), ctx })
      if (scope.blocked) {
        const reply = scopeMessage()
        pushHistory(sid, { question, query: '', answer: reply })
        log('analyze_blocked', ctx, { via: scope.via, user: req.user?.username })
        return res.json({ reply })
      }
      const out = await runChat(s.conn, s.schema, question, provider, ctx, s.history)
      pushHistory(sid, { question, query: out.sql || '', answer: out.reply })
      logAnalyzeDone(ctx, question, { attempts: out.attempts, rows: out.result?.rowCount, error: out.error })
      return res.json(out)
    }
    const out = await runAnalysis(s.conn, s.schema, question, (mode as QueryMode) || 'query', provider, ctx, s.history)
    if (out.sql && !out.error) pushHistory(sid, { question, query: out.sql })
    logAnalyzeDone(ctx, question, { attempts: out.attempts, rows: out.result?.rowCount, error: out.error })
    res.json(out)
  } catch (e) {
    log('analyze_error', ctx, { error: (e as Error).message })
    res.status(500).json({ error: analysisErrorMessage(e) })
  }
}))

// Feedback utente su una risposta: 👍 conferma la coppia domanda→query nel
// few-shot bank, 👎 la rimuove (una query sbagliata ma "riuscita" avvelenerebbe
// i prompt futuri). Best-effort: mai errore verso l'utente.
app.post('/api/feedback', asyncH(async (req, res) => {
  const s = getSession(sessionId(req))
  if (!s) return res.status(409).json({ error: 'Nessun DB connesso' })
  const { question, sql, positive } = req.body as { question?: string; sql?: string; positive?: boolean }
  if (!question?.trim()) return res.status(400).json({ error: 'Domanda mancante' })
  try {
    const key = connKeyFor(s.conn.kind, s.schema)
    // 👍 = CONFERMA esplicita: pesa di più nel ranking few-shot e sopravvive
    // alla retention (un "riuscito" non è per forza corretto; un confermato sì).
    if (positive && sql?.trim()) confirmExample(key, question, sql)
    else if (!positive) deleteExample(key, question)
    log('feedback', ctxFromReq(req), { positive: !!positive, user: req.user?.username })
  } catch { /* best-effort */ }
  res.json({ ok: true })
}))

// Analisi in STREAMING (SSE) — solo modalità chat: i token della risposta
// arrivano man mano (feedback immediato). Eventi: status | sql | result | delta | done | error.
app.post('/api/analyze/stream', rateLimit, asyncH(async (req, res) => {
  const sid = sessionId(req)
  const s = getSession(sid)
  if (!s) return res.status(409).json({ error: 'Nessun DB connesso' })
  const ctx = ctxFromReq(req)
  const { question, provider } = req.body as { question: string; provider?: LlmProvider }
  if (!question?.trim()) return res.status(400).json({ error: 'Domanda mancante' })

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()
  const send = (e: unknown) => res.write(`data: ${JSON.stringify(e)}\n\n`)

  try {
    log('analyze', ctx, { kind: s.conn.kind, mode: 'chat', provider: provider || defaultProvider(), stream: true, user: req.user?.username })
    // Filtro pertinenza: blocca le domande generaliste prima dell'LLM a pagamento.
    const scope = await scopeCheck({ question, domain: schemaDomain(s.schema), ctx })
    if (scope.blocked) {
      const reply = scopeMessage()
      send({ type: 'delta', text: reply }); send({ type: 'done', reply })
      pushHistory(sid, { question, query: '', answer: reply })
      log('analyze_blocked', ctx, { via: scope.via, stream: true, user: req.user?.username })
      return res.end()
    }
    const out = await runChatStream(s.conn, s.schema, question, send, provider, ctx, s.history)
    pushHistory(sid, { question, query: out.sql || '', answer: out.reply })
    logAnalyzeDone(ctx, question, { attempts: out.attempts, rows: out.result?.rowCount, error: out.error })
  } catch (e) {
    log('analyze_error', ctx, { error: (e as Error).message })
    send({ type: 'error', error: analysisErrorMessage(e) })
  } finally {
    res.end()
  }
}))

// Paginazione: ri-esegue una query di lettura già validata con LIMIT/OFFSET
// (o skip per Mongo), per scorrere risultati oltre l'anteprima MAX_ROWS.
app.post('/api/query/page', rateLimit, asyncH(async (req, res) => {
  const s = getSession(sessionId(req))
  if (!s) return res.status(409).json({ error: 'Nessun DB connesso' })
  const { sql, offset, limit } = req.body as { sql?: string; offset?: number; limit?: number }
  if (!sql?.trim()) return res.status(400).json({ error: 'Query mancante' })
  const pageSize = Math.min(Math.max(Number(limit) || 100, 1), 1000)
  const off = Math.max(Number(offset) || 0, 0)
  if (!supportsPagination(s.conn.kind)) return res.status(400).json({ error: 'Paginazione non supportata per questo database' })

  // La query di partenza deve superare il guard read-only, come sempre.
  const g = guardForLang(s.conn.lang, sql)
  if (!g.ok) return res.status(400).json({ error: `Query rifiutata: ${g.reason}` })
  try {
    let paged: string
    if (s.conn.lang === 'mongo') {
      const spec = JSON.parse(sql) as Record<string, unknown>
      paged = JSON.stringify({ ...spec, skip: off, limit: pageSize })
    } else {
      paged = paginateSql(s.conn.kind, sql, pageSize, off)
    }
    const result = await s.conn.query(paged, pageSize)
    log('query_page', ctxFromReq(req), { kind: s.conn.kind, offset: off, limit: pageSize, user: req.user?.username })
    res.json({ result, offset: off, limit: pageSize })
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
  }
}))

// Report Excel automatico: tema → l'LLM pianifica più analisi → workbook multi-foglio
app.post('/api/report', rateLimit, asyncH(async (req, res) => {
  const s = getSession(sessionId(req))
  if (!s) return res.status(409).json({ error: 'Nessun DB connesso' })
  const ctx = ctxFromReq(req)
  const { theme, provider } = req.body as { theme: string; provider?: LlmProvider }
  if (!theme?.trim()) return res.status(400).json({ error: 'Tema del report mancante' })
  try {
    const out = await generateReport(s.conn, s.schema, theme.trim(), provider || defaultProvider(), ctx)
    res.json(out)
  } catch (e) {
    log('report_error', ctx, { error: (e as Error).message })
    const msg = analysisErrorMessage(e)
    res.status(500).json({ error: msg === 'Errore interno durante l\'analisi' ? 'Errore durante la generazione del report' : msg })
  }
}))

// Export Excel della conversazione: ri-esegue le SQL già risposte, a piena scala
app.post('/api/export-chat', rateLimit, asyncH(async (req, res) => {
  const s = getSession(sessionId(req))
  if (!s) return res.status(409).json({ error: 'Nessun DB connesso' })
  const ctx = ctxFromReq(req)
  const { items } = req.body as { items: Array<{ title: string; sql: string }> }
  const safe = (Array.isArray(items) ? items : []).filter(i => i && typeof i.sql === 'string' && i.sql.trim()).slice(0, 50)
  if (!safe.length) return res.status(400).json({ error: 'Nessuna analisi da esportare' })
  try {
    const out = await buildChatExport(s.conn, safe, ctx)
    res.json(out)
  } catch (e) {
    log('export_error', ctx, { error: (e as Error).message })
    res.status(500).json({ error: 'Errore durante l\'export' })
  }
}))

// ── Documenti: acquisizione, elenco, rimozione ───────────────────────────────
// Un set di documenti = un file SQLite dedicato (docs.ts). Upload → estrazione
// testo (PDF/immagini via Claude, testo/Excel locale) → classificazione e campi
// → indicizzazione full-text. Poi ci si connette come a qualsiasi DB (kind 'docs').
const DOCS_MAX_FILES = Number(process.env.DOCS_MAX_FILES) || 20
// Documenti acquisiti in PARALLELO (prima: in fila → 10 PDF = 20 attese Claude
// sommate). Il semaforo LLM resta il limite vero per vision/classificazione.
const DOCS_INGEST_CONCURRENCY = Number(process.env.DOCS_INGEST_CONCURRENCY) || 3

app.post('/api/docs/upload', rateLimit, jsonUpload, asyncH(async (req, res) => {
  const ctx = ctxFromReq(req)
  const { docSet, files, provider } = req.body as {
    docSet?: string; files?: Array<{ filename?: string; base64?: string }>; provider?: LlmProvider
  }
  const list = (Array.isArray(files) ? files : [])
    .filter(f => f && typeof f.filename === 'string' && typeof f.base64 === 'string' && f.base64)
    .slice(0, DOCS_MAX_FILES)
  if (!list.length) return res.status(400).json({ error: 'Nessun file da caricare' })
  const setId = resolveDocSet(req, docSet)
  const store = new DocStore(setId)
  try {
    seedDocsGlossary(store.hasFts)
    // In parallelo (bounded): l'ordine dei risultati rispecchia quello dei file.
    const results = await mapBounded(list, DOCS_INGEST_CONCURRENCY, f =>
      ingestDocument(store, { filename: f.filename!, base64: f.base64! }, provider, ctx))
    const documents = listDocs(store)
    const okCount = results.filter(r => r.ok && !r.duplicato).length
    log('docs_upload', ctx, { set: docSet || 'documenti', caricati: okCount, totali: list.length, user: req.user?.username })
    res.json({ results, documents, hasVision: visionAvailable() })
  } catch (e) {
    log('docs_upload_error', ctx, { error: (e as Error).message })
    res.status(500).json({ error: 'Errore durante l\'acquisizione dei documenti' })
  } finally {
    store.close()
  }
}))

app.get('/api/docs', (req, res) => {
  const setId = resolveDocSet(req, req.query.docSet ? String(req.query.docSet) : undefined)
  if (!docSetExists(setId)) return res.json({ documents: [], hasVision: visionAvailable() })
  const store = new DocStore(setId)
  try { res.json({ documents: listDocs(store), hasVision: visionAvailable() }) }
  finally { store.close() }
})

app.delete('/api/docs/:id', (req, res) => {
  const setId = resolveDocSet(req, req.query.docSet ? String(req.query.docSet) : undefined)
  if (!docSetExists(setId)) return res.status(404).json({ error: 'Set inesistente' })
  const store = new DocStore(setId)
  try {
    deleteDoc(store, Number(req.params.id))
    res.json({ ok: true, documents: listDocs(store) })
  } finally { store.close() }
})

// Ricerca SEMANTICA nei documenti (RAG con citazioni). Recupera i frammenti più
// affini alla domanda (embeddings) e risponde citando [nome · pag N]. Richiede
// un indice semantico (DOCS_EMBED=1 all'acquisizione); altrimenti 400 azionabile.
app.post('/api/docs/ask', rateLimit, asyncH(async (req, res) => {
  const sid = sessionId(req)
  const ctx = ctxFromReq(req)
  const { question, provider, docSet } = req.body as { question?: string; provider?: LlmProvider; docSet?: string }
  if (!question?.trim()) return res.status(400).json({ error: 'Domanda mancante' })
  // Il set: quello connesso nella sessione, oppure indicato esplicitamente.
  const setId = docSet ? resolveDocSet(req, docSet) : sessionDocSet.get(sid)
  if (!setId || !docSetExists(setId)) return res.status(409).json({ error: 'Nessun set di documenti connesso' })
  try {
    log('docs_ask', ctx, { provider: provider || defaultProvider(), user: req.user?.username })
    // Filtro pertinenza: domande generaliste bloccate prima dell'LLM a pagamento.
    const scope = await scopeCheck({ question: question.trim(), domain: 'i documenti/archivio aziendale connesso (fatture, DDT, contratti, rapporti…)', ctx })
    if (scope.blocked) {
      log('docs_ask_blocked', ctx, { via: scope.via, user: req.user?.username })
      return res.json({ reply: scopeMessage(), sources: [] })
    }
    const out = await answerFromDocs(docSetPath(setId), question.trim(), provider, ctx)
    if (!out) {
      return res.status(400).json({
        error: embeddingsEnabled()
          ? 'Indice semantico assente per questi documenti: ricarica i file con l\'indicizzazione attiva.'
          : 'Ricerca semantica non attiva (DOCS_EMBED=1). Usa la ricerca full-text nella chat.',
      })
    }
    res.json(out)
  } catch (e) {
    log('docs_ask_error', ctx, { error: (e as Error).message })
    res.status(500).json({ error: analysisErrorMessage(e) })
  }
}))

/** True se il file è un formato accettato dall'acquisizione documenti (per la UI). */
app.post('/api/docs/check', (req, res) => {
  const names = (req.body as { names?: string[] }).names || []
  res.json({ supported: names.map(n => ({ name: n, ok: !!mediaFor(String(n)), vision: needsVisionSafe(String(n)) })) })
})
function needsVisionSafe(name: string): boolean {
  const m = mediaFor(name)
  return m === 'application/pdf' || !!m?.startsWith('image/')
}

// Watcher cartella: forza subito una scansione (oltre al polling automatico).
app.post('/api/docs/watch/scan', requireAdmin, asyncH(async (_req, res) => {
  if (!watchEnabled()) return res.status(400).json({ error: 'Watcher non configurato: imposta DOCS_WATCH_DIR' })
  const summary = await scanOnce()
  res.json({ ...summary, set: watchSetId() })
}))

// ── AGENTE OPERATIVO: usa le app della suite (scadenzario, OCR, …) ───────────
// Costruisce il contesto con il cookie del browser (contiene la sessione del
// Portale, `sid`): le azioni vengono compiute con l'identità dell'utente.
// Gli ALLEGATI del messaggio restano lato server nel contesto: i tool li
// referenziano per numero, il base64 non passa mai dal prompt dell'LLM.
const AGENT_MAX_FILES = Number(process.env.AGENT_MAX_FILES) || 6
const AGENT_MAX_FILE_MB = Number(process.env.AGENT_MAX_FILE_MB) || 15

function agentAttachments(body: unknown): Array<{ name: string; base64: string }> {
  const files = (body as { files?: unknown }).files
  if (!Array.isArray(files)) return []
  return files
    .filter((f): f is { name: string; base64: string } =>
      !!f && typeof (f as any).name === 'string' && typeof (f as any).base64 === 'string' && (f as any).base64.length > 0)
    .filter(f => Buffer.byteLength(f.base64, 'base64') <= AGENT_MAX_FILE_MB * 1024 * 1024)
    .slice(0, AGENT_MAX_FILES)
    .map(f => ({ name: f.name.slice(0, 200), base64: f.base64 }))
}

// Storico chat accettato dal client: pochi turni, ognuno troncato. Il tetto
// serve sia al costo (ogni turno rientra nel prompt a ogni passo del loop) sia
// alla sicurezza (il body è arbitrario: non deve poter gonfiare il contesto).
const AGENT_HISTORY_TURNS = Number(process.env.AGENT_HISTORY_TURNS) || 8
const AGENT_HISTORY_CHARS = Number(process.env.AGENT_HISTORY_CHARS) || 2_000

function agentHistory(body: unknown): Array<{ role: 'user' | 'assistant'; content: string }> {
  const raw = (body as { history?: unknown }).history
  if (!Array.isArray(raw)) return []
  return raw
    .filter((m): m is { role: string; content: string } =>
      !!m && ((m as any).role === 'user' || (m as any).role === 'assistant'))
    .filter(m => typeof m.content === 'string' && m.content.trim() !== '')
    .slice(-AGENT_HISTORY_TURNS)
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content.slice(0, AGENT_HISTORY_CHARS) }))
}

function suiteCtxFrom(req: express.Request): SuiteCtx {
  // DB della sessione: serve ai tool LOCALI che lavorano sui dati (report Excel).
  // Assente se l'utente non è connesso a nessun database — il tool lo dice.
  const s = getSession(sessionId(req))
  const { provider } = req.body as { provider?: LlmProvider }
  return {
    cookie: req.headers.cookie, log: ctxFromReq(req), user: req.user?.username,
    attachments: agentAttachments(req.body),
    history: agentHistory(req.body),
    db: s ? { conn: s.conn, schema: s.schema } : undefined,
    provider: provider || defaultProvider(),
  }
}

// Ambito dell'agente operativo (per il filtro di pertinenza).
function agentDomain(): string {
  // 'locale' non è un'app: è dove girano i tool del backend. Nominarlo qui
  // confonderebbe il filtro, che deve invece riconoscere «apri X» e «fammi un
  // report» come richieste PERTINENTI, non come chiacchiera fuori ambito.
  const apps = [...new Set(listTools().map(t => t.app))].filter(a => a !== 'locale').join(', ')
  return `operazioni sulle app aziendali della suite${apps ? ` (${apps})` : ''}: scadenze/scadenzario, estrazione testo (OCR) dai documenti, confronto di PDF, statistiche DDT, attività sui file allegati dall'utente, AVVIO/apertura delle applicazioni della suite su richiesta, e generazione di REPORT Excel sul database collegato`
}

// Elenco degli strumenti disponibili (per la UI: capacità + toggle).
app.get('/api/agent/tools', (_req, res) => {
  res.json({
    enabled: SUITE_ENABLED,
    tools: listTools().map(t => ({ name: t.name, app: t.app, kind: t.kind, description: t.description })),
  })
})

// Richiesta all'agente: usa i tool di lettura; se serve una scrittura, la propone.
app.post('/api/agent', rateLimit, jsonUpload, asyncH(async (req, res) => {
  if (!SUITE_ENABLED) return res.status(400).json({ error: 'Azioni suite disattivate (SUITE_TOOLS=off)' })
  const ctx = ctxFromReq(req)
  const { message, provider } = req.body as { message?: string; provider?: LlmProvider }
  if (!message?.trim()) return res.status(400).json({ error: 'Messaggio mancante' })
  try {
    log('agent', ctx, { provider: provider || defaultProvider(), user: req.user?.username })
    // Filtro pertinenza (saltato se ci sono allegati: c'è un file concreto su cui operare).
    if (!agentAttachments(req.body).length) {
      const scope = await scopeCheck({ question: message.trim(), domain: agentDomain(), ctx })
      if (scope.blocked) {
        log('agent_blocked', ctx, { via: scope.via, user: req.user?.username })
        return res.json({ reply: scopeMessage(), toolsUsed: [] })
      }
    }
    const out = await runSuiteAgent(message.trim(), suiteCtxFrom(req), provider)
    log('agent_done', ctx, { tools: out.toolsUsed.join(','), pending: out.pendingAction?.name || '', user: req.user?.username })
    res.json(out)
  } catch (e) {
    log('agent_error', ctx, { error: (e as Error).message })
    res.status(500).json({ error: analysisErrorMessage(e) })
  }
}))

// Come /api/agent ma in STREAMING (SSE): emette i passi ("Uso …") in tempo
// reale, poi l'evento finale con risposta ed eventuale azione da confermare.
app.post('/api/agent/stream', rateLimit, jsonUpload, asyncH(async (req, res) => {
  if (!SUITE_ENABLED) return res.status(400).json({ error: 'Azioni suite disattivate (SUITE_TOOLS=off)' })
  const ctx = ctxFromReq(req)
  const { message, provider } = req.body as { message?: string; provider?: LlmProvider }
  if (!message?.trim()) return res.status(400).json({ error: 'Messaggio mancante' })

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()
  const send = (e: unknown) => res.write(`data: ${JSON.stringify(e)}\n\n`)
  try {
    log('agent', ctx, { provider: provider || defaultProvider(), stream: true, user: req.user?.username })
    // Filtro pertinenza (saltato con allegati presenti).
    if (!agentAttachments(req.body).length) {
      const scope = await scopeCheck({ question: message.trim(), domain: agentDomain(), ctx })
      if (scope.blocked) {
        send({ type: 'done', reply: scopeMessage(), toolsUsed: [] })
        log('agent_blocked', ctx, { via: scope.via, stream: true, user: req.user?.username })
        return res.end()
      }
    }
    const out = await runSuiteAgentStream(message.trim(), suiteCtxFrom(req), provider, send)
    log('agent_done', ctx, { tools: out.toolsUsed.join(','), pending: out.pendingAction?.name || '', user: req.user?.username })
  } catch (e) {
    log('agent_error', ctx, { error: (e as Error).message })
    send({ type: 'error', error: analysisErrorMessage(e) })
  } finally {
    res.end()
  }
}))

// Conferma di un'azione proposta dall'agente → esecuzione della scrittura.
// Il client manda SOLO l'id dell'azione proposta: nome e argomenti eseguiti
// sono quelli registrati server-side al momento della proposta. Accettarli dal
// body permetterebbe a un utente autenticato di invocare qualunque tool di
// scrittura con argomenti arbitrari, scavalcando l'agente e la conferma.
app.post('/api/agent/confirm', rateLimit, asyncH(async (req, res) => {
  if (!SUITE_ENABLED) return res.status(400).json({ error: 'Azioni suite disattivate' })
  const { actionId } = req.body as { actionId?: string }
  if (!actionId) return res.status(400).json({ error: 'Azione mancante' })
  const taken = takePendingAction(String(actionId), req.user?.username || '')
  if (!taken.ok) {
    log('agent_confirm_rejected', ctxFromReq(req), { user: req.user?.username })
    return res.status(409).json({ error: taken.error })
  }
  try {
    const out = await confirmAction(taken.action, suiteCtxFrom(req))
    log('agent_confirm', ctxFromReq(req), { tool: taken.action.name, ok: out.ok, user: req.user?.username })
    res.json(out)
  } catch (e) {
    res.status(500).json({ error: analysisErrorMessage(e) })
  }
}))

// ── Glossario aziendale (per DB connesso) ────────────────────────────────────
// Termine → colonna/formula, iniettato nel prompt insieme allo schema. Lettura
// per tutti gli utenti autenticati; modifica solo admin.
app.get('/api/glossary', (req, res) => {
  const s = getSession(sessionId(req))
  if (!s) return res.status(409).json({ error: 'Nessun DB connesso' })
  res.json({ items: listGlossary(s.connKey) })
})

app.post('/api/glossary', requireAdmin, (req, res) => {
  const s = getSession(sessionId(req))
  if (!s) return res.status(409).json({ error: 'Nessun DB connesso' })
  const { term, definition } = req.body as { term?: string; definition?: string }
  try {
    const item = addGlossary(s.connKey, String(term || ''), String(definition || ''), req.user!.username)
    log('glossary_saved', ctxFromReq(req), { term: item.term, user: req.user?.username })
    res.json({ item })
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
  }
})

app.delete('/api/glossary/:id', requireAdmin, (req, res) => {
  const s = getSession(sessionId(req))
  if (!s) return res.status(409).json({ error: 'Nessun DB connesso' })
  deleteGlossary(s.connKey, Number(req.params.id))
  res.json({ ok: true })
})

// ── Colonne sensibili / PII (per DB connesso) ────────────────────────────────
// Le colonne marcate spariscono dallo schema mandato all'LLM e i valori escono
// mascherati (***) da qualsiasi risultato. Modifica solo admin.
app.get('/api/privacy', (req, res) => {
  const s = getSession(sessionId(req))
  if (!s) return res.status(409).json({ error: 'Nessun DB connesso' })
  res.json({ columns: listPii(s.connKey) })
})

app.post('/api/privacy', requireAdmin, (req, res) => {
  const s = getSession(sessionId(req))
  if (!s) return res.status(409).json({ error: 'Nessun DB connesso' })
  const { table, column } = req.body as { table?: string; column?: string }
  try {
    const item = addPii(s.connKey, String(table || ''), String(column || ''), req.user!.username)
    log('pii_marked', ctxFromReq(req), { table: item.table_name, column: item.column_name, user: req.user?.username })
    res.json({ column: item })
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
  }
})

app.delete('/api/privacy/:id', requireAdmin, (req, res) => {
  const s = getSession(sessionId(req))
  if (!s) return res.status(409).json({ error: 'Nessun DB connesso' })
  deletePii(s.connKey, Number(req.params.id))
  res.json({ ok: true })
})

// ── Connessioni salvate (cifrate) ────────────────────────────────────────────
app.get('/api/connections', (_req, res) => res.json({ connections: listConnections(), store: connectionsAvailable() }))

app.post('/api/connections', requireAdmin, (req, res) => {
  const { name, config } = req.body as { name?: string; config?: DbConfig }
  const ctx = ctxFromReq(req)
  if (!name || !config?.kind) return res.status(400).json({ error: 'Nome e configurazione obbligatori' })
  try {
    const meta = saveConnection(name, config, req.user!.username)
    log('connection_saved', ctx, { name: meta.name, kind: meta.kind, user: req.user?.username })
    res.json({ connection: meta })
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
  }
})

app.delete('/api/connections/:id', requireAdmin, (req, res) => {
  deleteConnection(Number(req.params.id))
  res.json({ ok: true })
})

// ── Job pianificati (scheduler) ──────────────────────────────────────────────
app.get('/api/jobs', (_req, res) => res.json({ jobs: listJobs() }))

app.post('/api/jobs', requireAdmin, (req, res) => {
  const { name, connectionId, theme, cron, provider } = req.body as
    { name?: string; connectionId?: number; theme?: string; cron?: string; provider?: string }
  const ctx = ctxFromReq(req)
  if (!name || !connectionId || !theme || !cron) return res.status(400).json({ error: 'Campi obbligatori: name, connectionId, theme, cron' })
  try {
    const job = createJob({ name, connection_id: Number(connectionId), theme, cron, provider, createdBy: req.user!.username })
    log('job_created', ctx, { job: job.name, cron: job.cron, user: req.user?.username })
    res.json({ job })
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
  }
})

app.patch('/api/jobs/:id', requireAdmin, (req, res) => {
  const job = getJob(Number(req.params.id))
  if (!job) return res.status(404).json({ error: 'Job non trovato' })
  const { enabled } = req.body as { enabled?: boolean }
  if (typeof enabled === 'boolean') setJobEnabled(job.id, enabled)
  res.json({ job: getJob(job.id) })
})

app.delete('/api/jobs/:id', requireAdmin, (req, res) => {
  deleteJob(Number(req.params.id))
  res.json({ ok: true })
})

// Esegui subito un job (fuori pianificazione)
app.post('/api/jobs/:id/run', requireAdmin, (req, res) => {
  const job = getJob(Number(req.params.id))
  if (!job) return res.status(404).json({ error: 'Job non trovato' })
  const runId = enqueueJob(job.id)
  log('job_run_now', ctxFromReq(req), { job: job.name, runId, user: req.user?.username })
  res.json({ runId })
})

// Valida un'espressione cron (per la UI)
app.post('/api/cron/validate', (req, res) => {
  const { cron } = req.body as { cron?: string }
  const err = cronError(String(cron || ''))
  res.json({ ok: !err, error: err })
})

// ── Storico esecuzioni + download file ───────────────────────────────────────
app.get('/api/runs', (req, res) => {
  const jobId = req.query.job ? Number(req.query.job) : undefined
  res.json({ runs: listRuns(jobId) })
})

app.get('/api/runs/:id/download', (req, res) => {
  const run = getRun(Number(req.params.id))
  if (!run || !run.filename) return res.status(404).json({ error: 'File non disponibile' })
  const file = path.join(REPORTS_DIR, path.basename(run.filename)) // basename: no traversal
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'File rimosso dal disco' })
  res.download(file, run.filename)
})

// ── Utenti (admin) ───────────────────────────────────────────────────────────
/** Esegue fn su items con al più `limit` in parallelo, risultati nell'ordine di input. */
async function mapBounded<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let idx = 0
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length || 1) }, async () => {
    while (idx < items.length) { const i = idx++; out[i] = await fn(items[i], i) }
  }))
  return out
}

app.get('/api/users', requireAdmin, (_req, res) => res.json({ users: listUsers() }))

app.post('/api/users', requireAdmin, asyncH(async (req, res) => {
  const { username, password, role, mustChange } = req.body as { username?: string; password?: string; role?: string; mustChange?: boolean }
  try {
    // Default: forza il cambio password al 1° accesso (l'utente sceglie la propria).
    const u = await createUser(String(username), String(password), role === 'admin' ? 'admin' : 'user', mustChange !== false)
    log('user_created', ctxFromReq(req), { username: u.username, role: u.role, by: req.user?.username })
    res.json({ user: { id: u.id, username: u.username, role: u.role } })
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
  }
}))

// Cambio ruolo (admin). Non ti auto-declassi e non lasci il sistema senza admin.
app.patch('/api/users/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id)
  const role = (req.body as { role?: string }).role === 'admin' ? 'admin' : 'user'
  if (id === req.user?.id) return res.status(400).json({ error: 'Non puoi cambiare il tuo ruolo' })
  const users = listUsers()
  const target = users.find(u => u.id === id)
  if (!target) return res.status(404).json({ error: 'Utente inesistente' })
  if (target.role === 'admin' && role === 'user' && users.filter(u => u.role === 'admin').length <= 1) {
    return res.status(400).json({ error: 'Deve restare almeno un admin' })
  }
  setRole(id, role)
  log('user_role_changed', ctxFromReq(req), { username: target.username, role, by: req.user?.username })
  res.json({ ok: true })
})

// Reset password (admin): genera una temporanea e la ritorna UNA volta.
app.post('/api/users/:id/reset-password', requireAdmin, asyncH(async (req, res) => {
  const id = Number(req.params.id)
  const target = listUsers().find(u => u.id === id)
  if (!target) return res.status(404).json({ error: 'Utente inesistente' })
  const tempPassword = await resetPassword(id)
  log('user_password_reset', ctxFromReq(req), { username: target.username, by: req.user?.username })
  res.json({ username: target.username, tempPassword })
}))

app.delete('/api/users/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id)
  if (id === req.user?.id) return res.status(400).json({ error: 'Non puoi eliminare il tuo account' })
  const users = listUsers()
  const target = users.find(u => u.id === id)
  if (target?.role === 'admin' && users.filter(u => u.role === 'admin').length <= 1) {
    return res.status(400).json({ error: 'Deve restare almeno un admin' })
  }
  deleteUser(id)
  res.json({ ok: true })
})

// ── Import utenti in blocco da Excel (admin) ─────────────────────────────────
// Il file .xlsx viene letto DAL BROWSER (SheetJS lato client) e arriva qui già
// come JSON: niente multipart/upload da gestire lato server. La password nel file
// è OPZIONALE: se manca, il server ne genera una temporanea (must_change al 1° accesso).
app.post('/api/users/import', requireAdmin, asyncH(async (req, res) => {
  const rows = (req.body as { users?: unknown }).users
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'Nessun utente nel file' })
  }
  if (rows.length > 500) return res.status(400).json({ error: 'Massimo 500 utenti per import' })
  // Bounded (4 in parallelo = grandezza threadpool scrypt): niente freeze, nessun flood.
  const results = await mapBounded(rows, 4, async (r, i) => {
    const { username, password, role } = (r || {}) as { username?: unknown; password?: unknown; role?: unknown }
    const provided = String(password ?? '').trim()
    const temp = provided ? '' : generateTempPassword()
    try {
      const u = await createUser(String(username ?? ''), provided || temp, String(role).toLowerCase() === 'admin' ? 'admin' : 'user', true)
      return { row: i + 1, username: u.username, ok: true as const, generatedPassword: temp || undefined }
    } catch (e) {
      return { row: i + 1, username: String(username ?? ''), ok: false as const, error: (e as Error).message }
    }
  })
  const created = results.filter(r => r.ok).length
  log('users_imported', ctxFromReq(req), { created, failed: results.length - created, by: req.user?.username })
  res.json({ created, failed: results.length - created, results })
}))

// ── Log utenti (admin): consultazione + export CSV ───────────────────────────
app.get('/api/logs', requireAdmin, (req, res) => {
  const entries = readLogEntries({
    user: req.query.user ? String(req.query.user) : undefined,
    event: req.query.event ? String(req.query.event) : undefined,
    limit: Number(req.query.limit) || 500,
  })
  res.json({ logs: entries })
})

app.get('/api/logs/export.csv', requireAdmin, (req, res) => {
  const entries = readLogEntries({
    user: req.query.user ? String(req.query.user) : undefined,
    event: req.query.event ? String(req.query.event) : undefined,
    limit: Number(req.query.limit) || 10_000,
  })
  const cols = ['ts', 'event', 'user', 'clientIp', 'clientHost', 'serverHost'] as const
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [cols.join(';')]
  for (const e of entries) {
    const extra = Object.fromEntries(Object.entries(e).filter(([k]) => !cols.includes(k as any)))
    lines.push([...cols.map(c => esc(e[c])), esc(JSON.stringify(extra))].join(';'))
  }
  const csv = '\uFEFF' + [lines[0] + ';extra', ...lines.slice(1)].join('\r\n') // BOM: Excel apre bene UTF-8
  const stamp = new Date().toISOString().slice(0, 10)
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="log-utenti-${stamp}.csv"`)
  res.send(csv)
})

// ── Chiave API Claude (admin): stato + impostazione a caldo ──────────────────
// Requisiti di sicurezza (non negoziabili):
//  - la chiave è accettata SOLO se può essere salvata CIFRATA (MASTER_PASSWORD):
//    mai in chiaro su disco, mai "solo in memoria" all'insaputa dell'admin;
//  - una volta inserita è IRRAGGIUNGIBILE: nessun endpoint la rilegge (nemmeno
//    parzialmente), non finisce nei log, la UI azzera il campo dopo l'invio;
//  - GET espone solo i booleani di stato (configurata sì/no).
app.get('/api/admin/claude-key', requireAdmin, (_req, res) => {
  res.json({ configured: claudeAvailable(), canPersist: canPersistClaudeKey() })
})

app.post('/api/admin/claude-key', requireAdmin, rateLimit, asyncH(async (req, res) => {
  const { apiKey } = req.body as { apiKey?: string }
  if (!apiKey?.trim()) return res.status(400).json({ error: 'Chiave mancante' })
  const ctx = ctxFromReq(req)
  // 0) Gate: senza MASTER_PASSWORD la chiave non può essere cifrata → rifiuto.
  if (!canPersistClaudeKey()) {
    return res.status(400).json({ error: 'MASTER_PASSWORD non impostata sul server: la chiave deve essere salvata cifrata. Impostala nel file .env e riavvia.' })
  }
  // 1) Verifica con una chiamata reale (1 token) e attiva a caldo.
  const set = await setClaudeApiKey(apiKey)
  if (!set.ok) {
    log('claude_key_rejected', ctx, { user: req.user?.username })
    return res.status(400).json({ error: set.error })
  }
  // 2) Persisti cifrata (AES-256-GCM in secret.enc).
  try { saveClaudeKey(apiKey) }
  catch (e) {
    log('claude_key_persist_error', ctx, { user: req.user?.username })
    return res.status(500).json({ error: `Chiave verificata ma salvataggio fallito: ${(e as Error).message}` })
  }
  log('claude_key_set', ctx, { user: req.user?.username })
  res.json({ ok: true, message: 'Chiave verificata, attivata e salvata cifrata (secret.enc).' })
}))

// ── Consumo token Claude (admin): audit + budget per utente ──────────────────
app.get('/api/usage', requireAdmin, (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365)
  res.json({ usage: usageSummary(days), dailyBudget: CLAUDE_DAILY_TOKEN_BUDGET })
})

// ─────────────────────────────────────────────────────────────────────────────
// FRONTEND buildato (prod): serve dist/ + fallback SPA per le rotte non-/api
// ─────────────────────────────────────────────────────────────────────────────
const DIST = path.join(__dirname, 'dist')
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST))
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(DIST, 'index.html')))
}

// ─────────────────────────────────────────────────────────────────────────────
// GESTIONE ERRORI (ultimo middleware: deve stare dopo tutte le rotte)
// ─────────────────────────────────────────────────────────────────────────────
// Gli errori 4xx nascono da input del client (body troppo grande, JSON rotto,
// origine non consentita): il messaggio e' utile e non rivela nulla. Il 5xx
// resta generico — dettagli e stack finiscono nel log, non nella risposta.
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(err)
  const msg = String(err?.message || 'Errore')
  const status = Number(err?.status || err?.statusCode) || (msg === 'Origine non consentita' ? 403 : 500)
  log('http_error', ctxFromReq(req), { path: req.path, status, error: msg })
  if (status >= 500) console.error('[http_error]', req.method, req.path, err)
  res.status(status).json({ error: status < 500 ? msg : 'Errore interno del server' })
})

// ─────────────────────────────────────────────────────────────────────────────
// SPEGNIMENTO E ULTIMA RETE DI SICUREZZA
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Spegnimento ordinato: smetti di accettare connessioni, chiudi i connettori
 * DB delle sessioni (pool pg/mysql, file SQLite), poi esci. Senza questo, un
 * `nssm restart` tronca le richieste in corso e lascia aperti pool e WAL.
 *
 * Il timeout esiste perche' una richiesta lunga (report da 100k righe, chiamata
 * LLM) terrebbe aperto il server per minuti: oltre SHUTDOWN_TIMEOUT_MS si chiude
 * comunque.
 */
const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS) || 10_000
let server: import('node:http').Server | undefined
let shuttingDown = false
async function shutdown(reason: string, code = 0): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  log('server_stop', {}, { reason, sessions: activeCount() })
  console.log(`\nChiusura in corso (${reason})...`)
  const forced = setTimeout(() => {
    console.error('Chiusura forzata: richieste ancora in corso oltre il timeout')
    process.exit(code || 1)
  }, SHUTDOWN_TIMEOUT_MS)
  try {
    await new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve()))
    const n = await closeAllSessions()
    console.log(`Sessioni chiuse: ${n}`)
  } catch (e) {
    console.error('Errore in chiusura:', (e as Error).message)
  }
  clearTimeout(forced)
  process.exit(code)
}
// SIGBREAK e' il segnale che Windows sa davvero consegnare (Ctrl+Break, ed e' la
// via che usa nssm con AppStopMethodConsole): senza, su Windows lo spegnimento
// ordinato non verrebbe mai eseguito. SIGTERM/SIGINT valgono su Linux e per Ctrl+C.
for (const sig of ['SIGTERM', 'SIGINT', 'SIGBREAK'] as const) {
  process.on(sig, () => { void shutdown(sig) })
}

// Rete di sicurezza sotto ad asyncH: una promise rifiutata FUORI da una rotta
// (timer, scheduler, watcher) terminerebbe il processo con il default di Node.
// Qui viene registrata e il servizio resta in piedi.
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason)
  log('unhandled_rejection', {}, { error: msg })
  console.error('[unhandledRejection]', reason)
})
// Un'eccezione non catturata lascia lo stato del processo indefinito: qui si
// registra e si esce ORDINATAMENTE con codice 1, cosi' il servizio (nssm)
// riparte pulito invece di restare su uno stato incoerente.
process.on('uncaughtException', (err) => {
  log('uncaught_exception', {}, { error: err?.message || String(err) })
  console.error('[uncaughtException]', err)
  void shutdown('uncaughtException', 1)
})

// ─────────────────────────────────────────────────────────────────────────────
// Avvio: bootstrap admin (hash async) → guard password-default → scheduler → listen.
// In un IIFE async per attendere il bootstrap PRIMA della guardia e del listen.
;(async () => {
  await bootstrapAdmin()

  // Rifiuta di avviarsi ESPOSTO in rete con l'admin ancora sulla password di
  // default: sarebbe un accesso admin banale per chiunque sulla LAN.
  if (!IS_LOCAL_ONLY && AUTH_ENABLED && defaultAdminPasswordInUse()) {
    console.error('\n⛔ Avvio bloccato: server ESPOSTO in rete (BIND_HOST=' + BIND_HOST + ') ma l\'admin usa ancora la password di default.')
    console.error('   Imposta ADMIN_PASSWORD in .env (e cancella app.db per ricreare l\'admin) oppure avvia in locale e cambia la password dall\'app.\n')
    process.exit(1)
  }

  startScheduler()
  startDocsWatch() // acquisizione autonoma da cartella (se DOCS_WATCH_DIR impostata)

  // Ollama: se locale e spento, avvialo in background (non blocca l'avvio dell'app).
  ensureOllama().then(s => {
    if (s.ollama) console.log(`Ollama: attivo${s.started ? ' (avviato automaticamente)' : ''} | modello ${s.model ? 'presente' : 'MANCANTE'}`)
  }).catch(() => {})

  server = app.listen(PORT, BIND_HOST, () => {
    console.log(`Agente Analisi DB — backend su http://${BIND_HOST}:${PORT}`)
    console.log(`Server PC: ${SERVER_HOST}/${SERVER_USER}`)
    console.log(`Rete: ${IS_LOCAL_ONLY ? 'solo locale (127.0.0.1)' : `ESPOSTO su ${BIND_HOST}`} | Auth: ${AUTH_ENABLED ? `ATTIVA (${userCount()} utenti)` : 'DISATTIVA (AUTH_ENABLED=0)'}`)
    console.log(`LLM default: ${defaultProvider()} | Claude: ${claudeAvailable() ? 'ok (cifrata)' : 'assente'} | AI locale: ${localConfigured() ? 'configurata' : 'assente'}`)
    console.log(`Connessioni salvate: ${connectionsAvailable() ? 'ok (MASTER_PASSWORD)' : 'off (manca MASTER_PASSWORD)'} | Scheduler: attivo | Report dir: ${REPORTS_DIR}`)
    console.log(`Frontend: ${fs.existsSync(DIST) ? 'servito da dist/' : 'usa Vite dev (npm run dev)'}`)
    if (!IS_LOCAL_ONLY && !AUTH_ENABLED) console.warn('⚠  Esposto in rete SENZA auth: rischio. Non impostare AUTH_ENABLED=0 in produzione.')
    log('server_start', {}, { port: PORT, bindHost: BIND_HOST, auth: AUTH_ENABLED, users: userCount(), claude: claudeAvailable() })
  })
})()
