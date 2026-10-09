import Anthropic from '@anthropic-ai/sdk'
import type { LlmProvider } from './types.ts'
import { loadClaudeKey } from './secrets.ts'
import { log, type LogContext } from './logger.ts'
import { Semaphore } from './semaphore.ts'

// Tetto giornaliero token Claude per utente (input+output). 0 = illimitato.
// Letto qui per NON importare staticamente usage.ts (che apre il DB SQLite):
// così i test di pura logica su llm/analysis non tirano su l'infrastruttura.
const CLAUDE_DAILY_TOKEN_BUDGET = Number(process.env.CLAUDE_DAILY_TOKEN_BUDGET) || 0
// Modulo usage caricato pigramente solo quando serve (budget attivo o audit Claude).
let _usage: typeof import('./usage.ts') | null = null
async function usageMod(): Promise<typeof import('./usage.ts')> {
  if (!_usage) _usage = await import('./usage.ts')
  return _usage
}

// Cap concorrenza LLM: con molti utenti (o job pianificati) evita di saturare
// Claude (rate/costo) o Ollama (una GPU sola). Le richieste extra fanno la coda.
const LLM_CONCURRENCY = Number(process.env.LLM_CONCURRENCY) || 3
const llmGate = new Semaphore(LLM_CONCURRENCY)
export function llmQueueDepth(): number { return llmGate.waiting }

const OLLAMA_BASE = process.env.OLLAMA_BASE || 'http://localhost:11434'
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma4:12b'
// Finestra di contesto: il default Ollama (~4k) TRONCA silenziosamente schema
// grande + few-shot + storico → SQL sbagliato senza errori. 16k copre DB reali.
const OLLAMA_NUM_CTX = Number(process.env.OLLAMA_NUM_CTX) || 16384
// Tieni il modello caldo in RAM tra una domanda e l'altra (default Ollama: 5m
// → prima query dopo una pausa = ricaricamento lento).
const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || '30m'
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5'
const DEFAULT_LLM = (process.env.DEFAULT_LLM as LlmProvider) || 'ollama'

// max_tokens per COMPITO: l'SQL sta in 2k, ma un piano report (4-8 analisi in
// JSON) o una sintesi lunga rischiano il troncamento → il ruolo 'reason' ha più aria.
const CLAUDE_MAX_TOKENS = Number(process.env.CLAUDE_MAX_TOKENS) || 2048
const CLAUDE_MAX_TOKENS_REASON = Number(process.env.CLAUDE_MAX_TOKENS_REASON) || 4096
function claudeMaxTokens(role?: LlmRole): number {
  return role === 'reason' ? CLAUDE_MAX_TOKENS_REASON : CLAUDE_MAX_TOKENS
}

// ── Routing per COMPITO (vedi MODELLI-AI.md) ─────────────────────────────────
// 'sql'    → generare query: modello coder piccolo/veloce (OLLAMA_MODEL)
// 'reason' → pianificare report / commentare risultati: modello grande, se
//            configurato (OLLAMA_MODEL_REASON / LOCAL_LLM_MODEL_REASON).
// Vuoto = nessuno split, si usa sempre il modello base (comportamento di prima).
export type LlmRole = 'sql' | 'reason'
const OLLAMA_MODEL_REASON = process.env.OLLAMA_MODEL_REASON || ''
const LOCAL_MODEL_REASON = process.env.LOCAL_LLM_MODEL_REASON || ''
function ollamaModelFor(role?: LlmRole): string {
  return role === 'reason' && OLLAMA_MODEL_REASON ? OLLAMA_MODEL_REASON : OLLAMA_MODEL
}
function localModelFor(role?: LlmRole): string {
  return role === 'reason' && LOCAL_MODEL_REASON ? LOCAL_MODEL_REASON : LOCAL_MODEL
}

// AI locale via endpoint OpenAI-compatibile (LM Studio, llama.cpp server, vLLM,
// LocalAI, Jan...). Vuoto = provider 'local' disattivato. La chiave è opzionale
// (i server locali di solito non la richiedono).
const LOCAL_BASE = (process.env.LOCAL_LLM_BASE || '').replace(/\/+$/, '')
const LOCAL_MODEL = process.env.LOCAL_LLM_MODEL || 'local-model'
const LOCAL_API_KEY = process.env.LOCAL_LLM_API_KEY || ''

// Timeout richiesta LLM locale: un modello lento non deve bloccare il server.
const LOCAL_TIMEOUT_MS = Number(process.env.LOCAL_LLM_TIMEOUT_MS) || 120_000

// Ritenta i guasti transitori (429, 5xx, rete) prima di arrendersi: in un loop
// agentico un singolo 529 farebbe fallire l'intera richiesta a metà.
const CLAUDE_MAX_RETRIES = Number(process.env.CLAUDE_MAX_RETRIES) || 3
const CLAUDE_TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS) || 120_000
const claudeOpts = { maxRetries: CLAUDE_MAX_RETRIES, timeout: CLAUDE_TIMEOUT_MS }

const claudeKey = loadClaudeKey()
// Mutabile: l'admin può impostare/cambiare la chiave a runtime (setClaudeApiKey)
// senza riavviare il server.
let anthropic = claudeKey ? new Anthropic({ apiKey: claudeKey, ...claudeOpts }) : null

export function claudeAvailable(): boolean { return anthropic !== null }

/**
 * Imposta la chiave Claude A CALDO: la VERIFICA con una chiamata minima (1 token)
 * e, se valida, sostituisce il client per tutte le prossime richieste.
 * Ritorna un errore leggibile se la chiave non funziona (client invariato).
 */
export async function setClaudeApiKey(key: string): Promise<{ ok: boolean; error?: string }> {
  const k = key.trim()
  if (!/^sk-ant-/.test(k)) return { ok: false, error: 'Formato chiave non valido: deve iniziare con sk-ant-' }
  const candidate = new Anthropic({ apiKey: k, ...claudeOpts })
  try {
    // maxRetries 0 solo per la verifica: una chiave sbagliata deve fallire subito.
    await candidate.messages.create({
      model: CLAUDE_MODEL, max_tokens: 1,
      messages: [{ role: 'user', content: 'ok' }],
    }, { maxRetries: 0 })
  } catch (e) {
    const status = (e as { status?: number }).status
    if (status === 401) return { ok: false, error: 'Chiave rifiutata da Anthropic (non valida o revocata)' }
    if (status === 404) return { ok: false, error: `Chiave valida ma il modello «${CLAUDE_MODEL}» non è accessibile: controlla CLAUDE_MODEL` }
    return { ok: false, error: `Verifica fallita: ${(e as Error).message}` }
  }
  anthropic = candidate
  return { ok: true }
}
export function localConfigured(): boolean { return LOCAL_BASE !== '' }
export function defaultProvider(): LlmProvider { return DEFAULT_LLM }
/**
 * Provider LOCALE e GRATUITO per attività di supporto (es. filtro di pertinenza)
 * che NON devono mai consumare credito Claude: 'local' se un endpoint
 * OpenAI-compatibile è configurato, altrimenti 'ollama' (base sempre presente).
 */
export function freeProvider(): LlmProvider { return LOCAL_BASE ? 'local' : 'ollama' }
export function ollamaModelName(): string { return OLLAMA_MODEL }

export interface CompleteOpts {
  system: string
  /**
   * Contesto grande e STABILE per la sessione (lo schema DB). Separato dal
   * prompt così Claude può metterlo in cache: viene riusato a costo ~0.1x su
   * ogni retry e su ogni domanda della stessa sessione (prompt caching).
   * Per Ollama / AI locale viene semplicemente accodato al system.
   */
  context?: string
  prompt: string
  provider?: LlmProvider
  json?: boolean
  /**
   * JSON Schema atteso quando json=true. Con Claude attiva il TOOL USE forzato:
   * il JSON è garantito dalla API (niente estrazione euristica dal testo).
   * Ollama/AI locale lo ignorano (resta format:json + estrattore del chiamante).
   */
  schema?: Record<string, unknown>
  /** Compito: 'sql' (default, modello coder) | 'reason' (pianificazione/sintesi, modello grande se configurato). */
  role?: LlmRole
  ctx?: LogContext // per audit: quale PC usa Claude
}

/** fetch con timeout via AbortController (i modelli locali possono essere lenti). */
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } catch (e) {
    // Timeout/abort e connessione rifiutata: messaggi azionabili, non "fetch failed".
    if ((e as Error).name === 'AbortError') {
      throw new Error(`LLM non ha risposto entro ${Math.round(timeoutMs / 1000)}s (modello lento o bloccato). Riprova o aumenta LOCAL_LLM_TIMEOUT_MS.`)
    }
    if (/ECONNREFUSED|fetch failed/i.test((e as Error).message)) {
      throw new Error(`LLM non raggiungibile su ${new URL(url).origin}: server spento?`)
    }
    throw e
  } finally {
    clearTimeout(t)
  }
}

/**
 * Traduce gli errori HTTP di Ollama in messaggi AZIONABILI: il 404 su /api/chat
 * significa quasi sempre "modello non scaricato" — dirlo esplicitamente evita
 * di mascherarlo come errore generico (visto in produzione).
 */
async function ollamaErrorMessage(r: Response, role?: LlmRole): Promise<string> {
  const model = ollamaModelFor(role)
  const detail = await r.text().then(t => t.slice(0, 200)).catch(() => '')
  if (r.status === 404 || /not found/i.test(detail)) {
    return `Modello Ollama «${model}» mancante: scaricalo con "ollama pull ${model}"`
  }
  return `Ollama errore ${r.status}${detail ? `: ${detail}` : ''}`
}

/**
 * Risolve il provider effettivo applicando i fallback:
 *  - claude senza chiave → ollama
 *  - local non configurato → ollama
 *  - claude oltre il budget giornaliero dell'utente → ollama (smette di spendere)
 */
async function resolveProvider(opts: CompleteOpts): Promise<LlmProvider> {
  const provider = opts.provider || DEFAULT_LLM
  if (provider === 'claude' && !anthropic) return 'ollama'
  if (provider === 'local' && !LOCAL_BASE) return 'ollama'
  if (provider === 'claude' && CLAUDE_DAILY_TOKEN_BUDGET > 0) {
    const { withinBudget } = await usageMod()
    if (!withinBudget(opts.ctx?.user || '')) {
      log('claude_budget_exceeded', opts.ctx || {}, { budget: CLAUDE_DAILY_TOKEN_BUDGET })
      return 'ollama'
    }
  }
  return provider
}

/** Chiamata unica che instrada su Ollama, AI locale (OpenAI-compat) o Claude. Ritorna testo. */
export async function complete(opts: CompleteOpts): Promise<string> {
  const provider = await resolveProvider(opts)
  // Tutte le chiamate passano dal semaforo: max LLM_CONCURRENCY insieme.
  return llmGate.run(() => {
    if (provider === 'claude' && anthropic) return completeClaude(opts)
    if (provider === 'local' && LOCAL_BASE) return completeLocalOpenAI(opts)
    return completeOllama(opts)
  })
}

/**
 * Variante STREAMING: chiama onDelta(chunk) man mano che arrivano i token e
 * ritorna il testo completo. Usata per la chat (feedback immediato via SSE).
 * Il budget/fallback è identico a complete().
 */
export async function completeStream(opts: CompleteOpts, onDelta: (chunk: string) => void): Promise<string> {
  const provider = await resolveProvider(opts)
  return llmGate.run(() => {
    if (provider === 'claude' && anthropic) return streamClaude(opts, onDelta)
    if (provider === 'local' && LOCAL_BASE) return streamLocalOpenAI(opts, onDelta)
    return streamOllama(opts, onDelta)
  })
}

/** Claude cloud: schema come blocco cache-abile → retry/follow-up a costo ridotto. */
async function completeClaude(opts: CompleteOpts): Promise<string> {
  // Audit: registra QUALE PC ha usato la chiave Claude (a pagamento)
  log('claude_usage', opts.ctx || {}, { model: CLAUDE_MODEL })
  // System come blocchi: istruzioni + (se presente) schema marcato per la
  // cache. cache_control è GA su Sonnet 4.6 (prefisso minimo ~2048 token →
  // lo schema di un DB reale lo supera). Lo schema è identico per tutta la
  // sessione, quindi i retry e i follow-up leggono dalla cache.
  //
  // Output JSON richiesto → TOOL USE FORZATO: la API garantisce un oggetto
  // conforme allo schema (basta con l'estrazione del JSON dal testo, fragile
  // con prosa attorno o graffe annidate). Il chiamante riceve la stringa JSON
  // e i suoi parser esistenti continuano a funzionare invariati.
  const msg = await anthropic!.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: claudeMaxTokens(opts.role),
    system: claudeSystem(opts),
    messages: [{ role: 'user', content: opts.prompt }],
    ...(opts.json ? {
      tools: [{
        name: 'emit',
        description: 'Restituisci il risultato nel formato strutturato richiesto.',
        input_schema: (opts.schema ?? { type: 'object' }) as any,
      }],
      tool_choice: { type: 'tool' as const, name: 'emit' },
    } : {}),
  })
  const u = msg.usage as {
    input_tokens?: number; output_tokens?: number
    cache_read_input_tokens?: number; cache_creation_input_tokens?: number
  }
  if (u?.cache_read_input_tokens || u?.cache_creation_input_tokens) {
    log('claude_cache', opts.ctx || {}, { read: u.cache_read_input_tokens || 0, write: u.cache_creation_input_tokens || 0 })
  }
  await recordClaudeUsage(opts, u)
  if (opts.json) {
    const tool = msg.content.find(b => b.type === 'tool_use')
    if (tool && tool.type === 'tool_use') return JSON.stringify(tool.input)
  }
  const block = msg.content.find(b => b.type === 'text')
  return block && block.type === 'text' ? block.text : ''
}

/** Attribuisce il consumo token all'utente (audit + budget). Input include la cache. */
async function recordClaudeUsage(opts: CompleteOpts, u?: {
  input_tokens?: number; output_tokens?: number
  cache_read_input_tokens?: number; cache_creation_input_tokens?: number
}): Promise<void> {
  if (!u) return
  const inTok = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)
  const outTok = u.output_tokens || 0
  if (inTok || outTok) { const { addUsage } = await usageMod(); addUsage(opts.ctx?.user || '', inTok, outTok) }
}

/** Costruisce il campo `system` per Claude: istruzioni + schema marcato cache. */
function claudeSystem(opts: CompleteOpts) {
  return opts.context
    ? [
        { type: 'text' as const, text: opts.system },
        { type: 'text' as const, text: opts.context, cache_control: { type: 'ephemeral' as const } },
      ]
    : opts.system
}

/**
 * Stima grezza token (~4 char/token) e AVVISA se il prompt sfora num_ctx:
 * Ollama tronca in silenzio → SQL sbagliato senza nessun errore visibile.
 * Il warning rende il fallimento diagnosticabile (visto il rischio su DB grandi).
 */
function warnIfCtxOverflow(system: string, prompt: string, ctx?: LogContext): void {
  const approx = Math.round((system.length + prompt.length) / 4)
  if (approx > OLLAMA_NUM_CTX) {
    console.warn(`⚠  Prompt ~${approx} token > num_ctx ${OLLAMA_NUM_CTX}: Ollama tronca in silenzio. Aumenta OLLAMA_NUM_CTX o riduci lo schema (TABLE_SELECT_KEEP).`)
    log('ollama_ctx_overflow', ctx || {}, { approxTokens: approx, numCtx: OLLAMA_NUM_CTX })
  }
}

// ── streaming per provider ───────────────────────────────────────────────────
/** Claude in streaming: emette i delta di testo e registra l'uso a fine stream. */
async function streamClaude(opts: CompleteOpts, onDelta: (c: string) => void): Promise<string> {
  log('claude_usage', opts.ctx || {}, { model: CLAUDE_MODEL, stream: true })
  let full = ''
  const stream = anthropic!.messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: claudeMaxTokens(opts.role),
    system: claudeSystem(opts),
    messages: [{ role: 'user', content: opts.prompt }],
  })
  stream.on('text', (t) => { full += t; onDelta(t) })
  const msg = await stream.finalMessage()
  await recordClaudeUsage(opts, msg.usage as any)
  return full
}

/** Ollama in streaming: risposta NDJSON, una riga JSON per chunk. */
async function streamOllama(opts: CompleteOpts, onDelta: (c: string) => void): Promise<string> {
  const system = opts.context ? `${opts.system}\n\n${opts.context}` : opts.system
  warnIfCtxOverflow(system, opts.prompt, opts.ctx)
  const r = await fetchWithTimeout(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ollamaModelFor(opts.role), stream: true, keep_alive: OLLAMA_KEEP_ALIVE,
      options: { temperature: 0, num_ctx: OLLAMA_NUM_CTX },
      messages: [{ role: 'system', content: system }, { role: 'user', content: opts.prompt }],
    }),
  }, LOCAL_TIMEOUT_MS)
  if (!r.ok || !r.body) throw new Error(await ollamaErrorMessage(r, opts.role))
  return readLines(r.body, (line) => {
    try {
      const j = JSON.parse(line) as { message?: { content?: string } }
      const c = j.message?.content
      if (c) onDelta(c)
      return c || ''
    } catch { return '' }
  })
}

/** AI locale OpenAI-compat in streaming: SSE `data: {...}` con choices[].delta.content. */
async function streamLocalOpenAI(opts: CompleteOpts, onDelta: (c: string) => void): Promise<string> {
  const system = opts.context ? `${opts.system}\n\n${opts.context}` : opts.system
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (LOCAL_API_KEY) headers['Authorization'] = `Bearer ${LOCAL_API_KEY}`
  const r = await fetchWithTimeout(`${LOCAL_BASE}/v1/chat/completions`, {
    method: 'POST', headers,
    body: JSON.stringify({
      model: localModelFor(opts.role), temperature: 0, stream: true,
      messages: [{ role: 'system', content: system }, { role: 'user', content: opts.prompt }],
    }),
  }, LOCAL_TIMEOUT_MS)
  if (!r.ok || !r.body) throw new Error(`AI locale errore ${r.status}`)
  return readLines(r.body, (line) => {
    if (!line.startsWith('data:')) return ''
    const data = line.slice(5).trim()
    if (data === '[DONE]') return ''
    try {
      const j = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> }
      const c = j.choices?.[0]?.delta?.content
      if (c) onDelta(c)
      return c || ''
    } catch { return '' }
  })
}

/** Legge uno stream a righe (NDJSON/SSE), applica onLine e accumula il testo restituito. */
async function readLines(body: ReadableStream<Uint8Array>, onLine: (line: string) => string): Promise<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let full = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (line) full += onLine(line)
      }
    }
    if (buf.trim()) full += onLine(buf.trim())
  } finally {
    reader.releaseLock()
  }
  return full
}

/** Ollama locale: nessuna cache, lo schema va incluso nel system. temperature 0 = SQL più stabile. */
async function completeOllama(opts: CompleteOpts): Promise<string> {
  const system = opts.context ? `${opts.system}\n\n${opts.context}` : opts.system
  warnIfCtxOverflow(system, opts.prompt, opts.ctx)
  const r = await fetchWithTimeout(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ollamaModelFor(opts.role),
      stream: false,
      keep_alive: OLLAMA_KEEP_ALIVE,
      options: { temperature: 0, num_ctx: OLLAMA_NUM_CTX }, // deterministico: meglio per generare query
      ...(opts.json ? { format: 'json' } : {}),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: opts.prompt },
      ],
    }),
  }, LOCAL_TIMEOUT_MS)
  if (!r.ok) throw new Error(await ollamaErrorMessage(r, opts.role))
  const data = await r.json() as { message?: { content?: string } }
  return data.message?.content || ''
}

/** AI locale OpenAI-compatibile (LM Studio, llama.cpp, vLLM, LocalAI...). */
async function completeLocalOpenAI(opts: CompleteOpts): Promise<string> {
  const system = opts.context ? `${opts.system}\n\n${opts.context}` : opts.system
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (LOCAL_API_KEY) headers['Authorization'] = `Bearer ${LOCAL_API_KEY}`
  const r = await fetchWithTimeout(`${LOCAL_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: localModelFor(opts.role),
      temperature: 0,
      stream: false,
      // response_format json_object: supportato da molti server (llama.cpp, vLLM);
      // se non supportato l'estrattore JSON del chiamante fa comunque da fallback.
      ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: opts.prompt },
      ],
    }),
  }, LOCAL_TIMEOUT_MS)
  if (!r.ok) throw new Error(`AI locale errore ${r.status}`)
  const data = await r.json() as { choices?: Array<{ message?: { content?: string } }> }
  return data.choices?.[0]?.message?.content || ''
}

// ── Loop AGENTICO (tool use) ─────────────────────────────────────────────────
// Primitiva generica: dato un set di TOOL (schema JSON), lascia che il modello
// li chiami in più passi finché non produce una risposta finale. Indipendente
// dai tool concreti (li orchestra agent.ts). Due politiche di sicurezza:
//  - i tool di SCRITTURA (isAction) NON vengono eseguiti: il loop si ferma e
//    restituisce l'azione proposta, che la chat farà CONFERMARE all'utente;
//  - passi limitati (maxSteps) per evitare cicli infiniti.
export interface ToolSchema { name: string; description: string; input_schema: Record<string, unknown> }
export interface AgentHooks {
  execTool: (name: string, args: Record<string, any>) => Promise<string> // esegue un tool READ, ritorna testo esito
  isAction: (name: string) => boolean                                    // true = scrittura → conferma
  onStatus?: (text: string) => void                                      // passi ("Interrogo lo scadenzario…")
}
/** Turno precedente della conversazione (solo testo: i tool non si rigiocano). */
export interface AgentTurn { role: 'user' | 'assistant'; content: string }
export interface AgentOpts {
  system: string
  /** Contesto variabile (data, utente): fuori dal blocco system cachato. */
  context?: string
  prompt: string
  tools: ToolSchema[]
  provider?: LlmProvider
  ctx?: LogContext
  maxSteps?: number
  /** Turni precedenti, dal più vecchio al più recente (già troncati dal chiamante). */
  history?: AgentTurn[]
}
export interface PendingAction { name: string; args: Record<string, any> }
export interface AgentResult { reply: string; pendingAction?: PendingAction; toolsUsed: string[] }

const AGENT_MAX_STEPS = Number(process.env.AGENT_MAX_STEPS) || 8

/**
 * Normalizza lo storico in messaggi validi per la API: scarta i vuoti e
 * garantisce l'alternanza dei ruoli partendo da `user` (un thread può iniziare
 * con un messaggio di sistema o avere buchi se una risposta è fallita).
 */
function historyMessages(history?: AgentTurn[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  const out: Array<{ role: 'user' | 'assistant'; content: string }> = []
  for (const t of history || []) {
    const content = (t.content || '').trim()
    if (!content) continue
    if (!out.length && t.role !== 'user') continue          // deve iniziare con l'utente
    if (out.length && out[out.length - 1].role === t.role) { // ruoli ripetuti → accorpa
      out[out.length - 1].content += `\n${content}`
      continue
    }
    out.push({ role: t.role, content })
  }
  // Il prompt corrente è 'user': lo storico deve chiudersi con 'assistant'.
  if (out.length && out[out.length - 1].role === 'user') out.pop()
  return out
}

/** Loop tool-use. Instrada su Claude (nativo) o Ollama (function-calling). */
export async function completeAgent(opts: AgentOpts, hooks: AgentHooks): Promise<AgentResult> {
  const provider = await resolveProvider({ system: opts.system, prompt: opts.prompt, provider: opts.provider, ctx: opts.ctx })
  return llmGate.run(() => {
    if (provider === 'claude' && anthropic) return claudeAgent(opts, hooks)
    return ollamaAgent(opts, hooks) // Ollama nativo o (fallback) endpoint locale via /api/chat
  })
}

/**
 * System per il loop agentico: istruzioni STABILI in un blocco marcato cache,
 * contesto variabile (data, utente) in un blocco separato NON cachato.
 * Il breakpoint dopo le istruzioni copre anche gli schemi dei tool (nell'ordine
 * del prefisso la API mette prima i tool, poi il system): senza di esso ogni
 * passo del loop rispedisce tool + system a prezzo pieno, fino a 8 volte.
 */
function agentSystemBlocks(opts: AgentOpts) {
  const blocks: any[] = [{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }]
  if (opts.context) blocks.push({ type: 'text', text: opts.context })
  return blocks
}

/** Messaggio leggibile per un errore dell'API Claude (niente stack all'utente). */
function claudeErrorMessage(e: unknown): string {
  const err = e as { status?: number; message?: string }
  switch (err.status) {
    case 401: return 'Chiave Claude non valida o revocata: reimpostala dal pannello di amministrazione.'
    case 403: return 'Chiave Claude senza permessi per questo modello.'
    case 404: return `Modello «${CLAUDE_MODEL}» non accessibile con questa chiave: controlla CLAUDE_MODEL.`
    case 413: return 'Richiesta troppo grande per il modello: riduci gli allegati o riformula in più passi.'
    case 429: return 'Limite di richieste Claude raggiunto: riprova tra qualche minuto.'
    case 529: return 'Claude è temporaneamente sovraccarico: riprova tra poco.'
    default:
      if (err.status && err.status >= 500) return 'Claude non è raggiungibile in questo momento: riprova tra poco.'
      return `Errore nella chiamata a Claude: ${err.message || String(e)}`
  }
}

/** Loop tool-use con Claude (Messages API, tool_choice auto). */
async function claudeAgent(opts: AgentOpts, hooks: AgentHooks): Promise<AgentResult> {
  const max = opts.maxSteps || AGENT_MAX_STEPS
  const tools = opts.tools.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema as any }))
  const system = agentSystemBlocks(opts)
  const messages: any[] = [...historyMessages(opts.history), { role: 'user', content: opts.prompt }]
  const toolsUsed: string[] = []
  let lastText = ''

  for (let step = 0; step < max; step++) {
    let msg: any
    try {
      msg = await anthropic!.messages.create({
        model: CLAUDE_MODEL, max_tokens: CLAUDE_MAX_TOKENS_REASON,
        system, messages, tools, tool_choice: { type: 'auto' },
      })
    } catch (e) {
      // Errore API (429, 529, rete…): degrada con un messaggio azionabile invece
      // di far esplodere la richiesta, come già fa il ramo Ollama.
      log('claude_agent_error', opts.ctx || {}, { step, status: (e as { status?: number }).status || 0, error: (e as Error).message })
      return { reply: claudeErrorMessage(e), toolsUsed }
    }
    await recordClaudeUsage({ system: opts.system, prompt: opts.prompt, ctx: opts.ctx }, msg.usage as any)
    const textBlocks = (msg.content as any[]).filter(b => b.type === 'text').map(b => b.text)
    if (textBlocks.length) lastText = textBlocks.join('\n')
    const toolUses = (msg.content as any[]).filter(b => b.type === 'tool_use')
    if (!toolUses.length) return { reply: lastText, toolsUsed }

    // Risposta troncata dal tetto di token: gli argomenti del tool sono monchi.
    // Rimandarli indietro fa rifiutare il messaggio dalla API → fermati qui.
    if (msg.stop_reason === 'max_tokens') {
      log('claude_agent_truncated', opts.ctx || {}, { step, tools: toolUses.map((t: any) => t.name).join(',') })
      return {
        reply: lastText || 'La risposta è stata troncata perché troppo lunga: prova a chiedere una cosa per volta.',
        toolsUsed,
      }
    }

    // Azione di scrittura richiesta → stop e proponi la conferma (non eseguire).
    const action = toolUses.find(t => hooks.isAction(t.name))
    if (action) return { reply: lastText, pendingAction: { name: action.name, args: action.input || {} }, toolsUsed }

    // Esegui i tool di lettura e reinserisci i risultati. In PARALLELO: quando il
    // modello ne chiede più d'uno sono indipendenti fra loro (sono letture) e in
    // serie l'attesa è la somma dei tempi di rete delle app della suite.
    messages.push({ role: 'assistant', content: msg.content })
    for (const tu of toolUses) { hooks.onStatus?.(`Uso ${tu.name}…`); toolsUsed.push(tu.name) }
    const results = await Promise.all(toolUses.map(async (tu: any) => ({
      type: 'tool_result',
      tool_use_id: tu.id,
      content: await hooks.execTool(tu.name, tu.input || {}),
    })))
    messages.push({ role: 'user', content: results })
  }
  return { reply: lastText || 'Ho raccolto le informazioni ma non sono riuscito a concludere.', toolsUsed }
}

/** Loop tool-use con Ollama / endpoint locale (function-calling in /api/chat). */
async function ollamaAgent(opts: AgentOpts, hooks: AgentHooks): Promise<AgentResult> {
  const useLocal = !!LOCAL_BASE && (opts.provider === 'local')
  const base = useLocal ? LOCAL_BASE : OLLAMA_BASE
  const model = useLocal ? LOCAL_MODEL : OLLAMA_MODEL
  const url = useLocal ? `${base}/v1/chat/completions` : `${base}/api/chat`
  const max = opts.maxSteps || AGENT_MAX_STEPS
  const tools = opts.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }))
  const messages: any[] = [
    { role: 'system', content: opts.context ? `${opts.system}\n\n${opts.context}` : opts.system },
    ...historyMessages(opts.history),
    { role: 'user', content: opts.prompt },
  ]
  const toolsUsed: string[] = []
  let lastText = ''

  for (let step = 0; step < max; step++) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (useLocal && LOCAL_API_KEY) headers['Authorization'] = `Bearer ${LOCAL_API_KEY}`
    const body = useLocal
      ? { model, temperature: 0, stream: false, tools, messages }
      : { model, stream: false, keep_alive: OLLAMA_KEEP_ALIVE, options: { temperature: 0, num_ctx: OLLAMA_NUM_CTX }, tools, messages }
    let r: Response
    try { r = await fetchWithTimeout(url, { method: 'POST', headers, body: JSON.stringify(body) }, LOCAL_TIMEOUT_MS) }
    catch (e) { return { reply: `Non riesco a contattare il modello: ${(e as Error).message}`, toolsUsed } }
    if (!r.ok) return { reply: `Modello non disponibile (HTTP ${r.status}).`, toolsUsed }
    const data = await r.json() as any
    const m = useLocal ? data.choices?.[0]?.message : data.message
    const calls = m?.tool_calls || []
    if (m?.content) lastText = m.content
    if (!calls.length) return { reply: lastText, toolsUsed }

    // Parsa gli argomenti (Ollama li dà come oggetto; alcuni server come stringa).
    const parsed = calls.map((c: any) => {
      const fn = c.function || {}
      let args = fn.arguments
      if (typeof args === 'string') { try { args = JSON.parse(args) } catch { args = {} } }
      return { id: c.id, name: fn.name, args: args || {} }
    })
    const action = parsed.find((c: any) => hooks.isAction(c.name))
    if (action) return { reply: lastText, pendingAction: { name: action.name, args: action.args }, toolsUsed }

    messages.push(m)
    for (const c of parsed) {
      hooks.onStatus?.(`Uso ${c.name}…`)
      toolsUsed.push(c.name)
      const out = await hooks.execTool(c.name, c.args)
      messages.push(useLocal
        ? { role: 'tool', tool_call_id: c.id, content: out }
        : { role: 'tool', content: out })
    }
  }
  return { reply: lastText || 'Ho raccolto le informazioni ma non sono riuscito a concludere.', toolsUsed }
}

// ── Estrazione testo da documenti (vision) ───────────────────────────────────
// Solo Claude: legge PDF nativi/scansionati e immagini restituendo il testo in
// Markdown (tabelle incluse). Le immagini passano dall'API stabile; i PDF dal
// namespace `beta` (blocco document). Nessun modello locale è coinvolto: se
// Claude non è configurato, il chiamante gestisce txt/csv/md senza LLM.
export const VISION_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
// "><(((º> sabusabu <º)))><"
export type VisionMedia = typeof VISION_IMAGE_TYPES[number] | 'application/pdf'

const OCR_SYSTEM = `Sei un motore di trascrizione documenti. Ricevi un documento (PDF o immagine, anche scansionato) e restituisci TUTTO il suo contenuto testuale in Markdown.
Regole:
- Trascrivi fedelmente ogni testo visibile, in ordine di lettura. Non riassumere, non tradurre, non aggiungere commenti.
- Rendi le tabelle come tabelle Markdown, mantenendo intestazioni e valori.
- Conserva numeri, importi, date, codici e unità ESATTAMENTE come appaiono.
- Se il documento ha più pagine, separale con una riga "--- pagina N ---".`

/** True se il tipo MIME è trascrivibile via vision (Claude). */
export function isVisionMedia(mime: string): mime is VisionMedia {
  return mime === 'application/pdf' || (VISION_IMAGE_TYPES as readonly string[]).includes(mime)
}

/**
 * Trascrive un documento (PDF/immagine, base64) in testo Markdown con Claude.
 * Lancia un errore azionabile se Claude non è configurato. Passa dal semaforo LLM
 * come ogni altra chiamata (limita la concorrenza su Claude).
 */
export async function extractDocumentText(
  opts: { media: VisionMedia; base64: string; ctx?: LogContext },
): Promise<string> {
  if (!anthropic) {
    throw new Error('Trascrizione PDF/immagini non disponibile: configura la chiave Claude (i formati testo — txt, csv, md — funzionano comunque).')
  }
  return llmGate.run(async () => {
    log('doc_ocr', opts.ctx || {}, { model: CLAUDE_MODEL, media: opts.media })
    const source = { type: 'base64' as const, media_type: opts.media, data: opts.base64 }
    const block = opts.media === 'application/pdf'
      ? { type: 'document' as const, source }
      : { type: 'image' as const, source }
    const content: any[] = [
      block,
      { type: 'text', text: 'Trascrivi integralmente questo documento in Markdown, seguendo le regole.' },
    ]
    // PDF: il blocco `document` è nel namespace beta dell'SDK 0.32 → header pdfs.
    const api: any = opts.media === 'application/pdf' ? (anthropic as any).beta.messages : anthropic!.messages
    const req: any = {
      model: CLAUDE_MODEL,
      max_tokens: CLAUDE_MAX_TOKENS_REASON,
      messages: [{ role: 'user', content }],
    }
    if (opts.media === 'application/pdf') req.betas = ['pdfs-2024-09-25']
    const msg = await api.create(req)
    await recordClaudeUsage({ system: '', prompt: '', ctx: opts.ctx }, msg.usage as any)
    const text = (msg.content as any[]).filter(b => b.type === 'text').map(b => b.text).join('\n')
    return text.trim()
  })
}

/** Health: Ollama raggiungibile + modello presente. */
export async function ollamaHealth(): Promise<{ ollama: boolean; model: boolean }> {
  try {
    const r = await fetchWithTimeout(`${OLLAMA_BASE}/api/tags`, {}, 5_000)
    if (!r.ok) throw new Error('no ollama')
    const data = await r.json() as { models: Array<{ name: string }> }
    const base = OLLAMA_MODEL.split(':')[0]
    return { ollama: true, model: data.models.some(m => m.name.includes(base)) }
  } catch {
    return { ollama: false, model: false }
  }
}

// ── Avvio automatico di Ollama ────────────────────────────────────────────────
// Se OLLAMA_BASE punta a questa macchina e il server non risponde, prova ad
// avviare `ollama serve` in background e attende che sia pronto.
const OLLAMA_AUTOSTART = process.env.OLLAMA_AUTOSTART !== '0'

function ollamaIsLocal(): boolean {
  try {
    const h = new URL(OLLAMA_BASE).hostname
    return h === 'localhost' || h === '127.0.0.1' || h === '::1'
  } catch { return false }
}

/**
 * Garantisce che Ollama sia in esecuzione (solo se locale).
 * Ritorna lo stato finale; non blocca l'avvio dell'app se Ollama manca.
 */
export async function ensureOllama(): Promise<{ ollama: boolean; model: boolean; started: boolean }> {
  let h = await ollamaHealth()
  if (h.ollama || !OLLAMA_AUTOSTART || !ollamaIsLocal()) return { ...h, started: false }

  // Non risponde → prova ad avviarlo (processo staccato: sopravvive all'app).
  log('ollama_autostart', {}, { base: OLLAMA_BASE })
  try {
    const { spawn } = await import('node:child_process')
    const child = spawn('ollama', ['serve'], {
      detached: true, stdio: 'ignore',
      windowsHide: true, shell: process.platform === 'win32', // .exe risolto via PATH
    })
    child.on('error', () => { /* binario mancante: gestito dal poll sotto */ })
    child.unref()
  } catch { /* idem: il poll sotto decide */ }

  // Attendi readiness: poll /api/tags fino a ~20s.
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 1_000))
    h = await ollamaHealth()
    if (h.ollama) {
      log('ollama_ready', {}, { afterMs: (i + 1) * 1000, model: h.model })
      if (!h.model) {
        console.warn(`⚠  Ollama attivo ma modello «${OLLAMA_MODEL}» mancante. Scaricalo con:  ollama pull ${OLLAMA_MODEL}`)
      }
      return { ...h, started: true }
    }
  }
  console.warn(`⚠  Ollama non raggiungibile su ${OLLAMA_BASE} (autostart fallito). Installa da https://ollama.com o imposta OLLAMA_AUTOSTART=0.`)
  log('ollama_autostart_failed', {}, { base: OLLAMA_BASE })
  return { ollama: false, model: false, started: false }
}

/** Health AI locale OpenAI-compatibile: endpoint /v1/models raggiungibile. */
export async function localHealth(): Promise<{ local: boolean; model: string }> {
  if (!LOCAL_BASE) return { local: false, model: LOCAL_MODEL }
  try {
    const headers: Record<string, string> = {}
    if (LOCAL_API_KEY) headers['Authorization'] = `Bearer ${LOCAL_API_KEY}`
    const r = await fetchWithTimeout(`${LOCAL_BASE}/v1/models`, { headers }, 5_000)
    return { local: r.ok, model: LOCAL_MODEL }
  } catch {
    return { local: false, model: LOCAL_MODEL }
  }
}
