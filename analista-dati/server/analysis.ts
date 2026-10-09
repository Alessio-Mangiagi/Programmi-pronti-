import { complete, completeStream, freeProvider } from './llm.ts'
import { log } from './logger.ts'
import { guardSelect } from './sqlGuard.ts'
import { guardRedis } from './redisGuard.ts'
import { guardMongo } from './mongoGuard.ts'
import type { Connector } from './db.ts'
import type { DbKind, SchemaInfo, QueryResult, LlmProvider, QAItem } from './types.ts'
import type { LogContext } from './logger.ts'

export type AnalysisMode = 'query' | 'stats' | 'anomaly' | 'schema' | 'chat'
/** Modalità che generano una query (escluse 'schema' e 'chat'). */
export type QueryMode = 'query' | 'stats' | 'anomaly'

const MAX_ATTEMPTS = 3 // 1 tentativo + 2 auto-retry su errore
// Tetto di tempo su un'intera analisi (generazione + retry + esecuzioni). Oltre,
// si smette di ritentare e si restituisce il miglior esito disponibile: 3
// tentativi lenti in fila tengono appeso il client per minuti.
const ANALYSIS_BUDGET_MS = Number(process.env.ANALYSIS_BUDGET_MS) || 90_000

// Few-shot bank caricato PIGRAMENTE: apre app.db solo alla prima analisi vera,
// così i test di pura logica non tirano su l'infrastruttura (stesso pattern di
// usage.ts in llm.ts). Tutte le operazioni sono best-effort: un problema al
// bank non deve MAI far fallire un'analisi.
let _fewshot: typeof import('./fewshot.ts') | null = null
async function fewshotMod(): Promise<typeof import('./fewshot.ts')> {
  if (!_fewshot) _fewshot = await import('./fewshot.ts')
  return _fewshot
}

async function fewshotKey(conn: Connector, schema: SchemaInfo): Promise<string> {
  try { return (await fewshotMod()).connKeyFor(conn.kind, schema) } catch { return '' }
}

async function fewshotText(key: string, question: string): Promise<string> {
  if (!key) return ''
  try {
    const fs = await fewshotMod()
    return fs.examplesText(fs.topExamples(key, question))
  } catch { return '' }
}

async function fewshotSave(key: string, question: string, query: string): Promise<void> {
  if (!key) return
  try { (await fewshotMod()).saveExample(key, question, query) } catch { /* best-effort */ }
}

// Glossario e privacy caricati pigramente (aprono app.db), stesso pattern del
// few-shot bank. Best-effort: mai far fallire un'analisi.
let _glossary: typeof import('./glossary.ts') | null = null
let _privacy: typeof import('./privacy.ts') | null = null

/**
 * Contesto per il prompt: schema (PII escluse) + glossario aziendale.
 * `fullSchema` serve per la chiave stabile (glossario/PII sono salvati sul DB
 * intero, anche quando la selezione tabelle riduce `effSchema`).
 * Blocco STABILE per la sessione → con Claude finisce in cache.
 */
export async function promptContext(conn: Connector, fullSchema: SchemaInfo, effSchema?: SchemaInfo): Promise<string> {
  let schema = effSchema ?? fullSchema
  let extra = ''
  try {
    const key = (await fewshotMod()).connKeyFor(conn.kind, fullSchema)
    if (key) {
      if (!_privacy) _privacy = await import('./privacy.ts')
      schema = _privacy.stripPiiSchema(schema, key)
      if (!_glossary) _glossary = await import('./glossary.ts')
      extra = _glossary.glossaryText(key)
    }
  } catch { /* best-effort: contesto senza glossario/strip */ }
  return contextFor(conn, schema) + extra
}

// ── JSON Schema degli output strutturati (tool use forzato con Claude) ───────
// `sql` senza tipo: stringa per SQL/Redis, OGGETTO per Mongo.
const QUERY_JSON_SCHEMA = {
  type: 'object',
  properties: { sql: {}, explanation: { type: 'string' } },
  required: ['sql'],
} as const

const CHAT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    needsData: { type: 'boolean' },
    reply: { type: 'string' },
    sql: {},
    explanation: { type: 'string' },
  },
  required: ['needsData'],
} as const

const TABLES_JSON_SCHEMA = {
  type: 'object',
  properties: { tables: { type: 'array', items: { type: 'string' } } },
  required: ['tables'],
} as const

const DIALECT: Record<DbKind, string> = {
  postgres: 'PostgreSQL', mysql: 'MySQL', sqlite: 'SQLite', mssql: 'Microsoft SQL Server',
  redis: 'Redis', mongodb: 'MongoDB', excel: 'SQLite', docs: 'SQLite', multi: 'SQLite',
}

/** Annotazione valori reali di una colonna (profilo introspection): guida i WHERE. */
function columnValueHint(c: SchemaInfo['tables'][0]['columns'][0]): string {
  if (c.values?.length) {
    const shown = c.values.slice(0, 12).map(v => JSON.stringify(v.slice(0, 40)))
    const more = c.values.length > 12 ? ', …' : ''
    return `  -- valori: ${shown.join(', ')}${more}`
  }
  if (c.range) return `  -- da ${c.range.min} a ${c.range.max}`
  return ''
}

/** Schema SQL come testo per il prompt: colonne + valori reali + foreign key + righe esempio. */
export function buildSchemaText(schema: SchemaInfo): string {
  const tbl = schema.tables.map(t => {
    const cols = t.columns.map(c =>
      `  ${c.name} ${c.type}${c.pk ? ' PK' : ''}${c.nullable ? '' : ' NOT NULL'}${columnValueHint(c)}`
    ).join('\n')
    let s = `TABLE ${t.name}\n${cols}`
    if (t.sample?.length) s += `\n  -- esempio: ${JSON.stringify(t.sample[0])}`
    return s
  }).join('\n\n')
  const rel = schema.relations?.length
    ? '\n\nFOREIGN KEY:\n' + schema.relations.map(r =>
        `  ${r.fromTable}.${r.fromColumn} -> ${r.toTable}.${r.toColumn}`).join('\n')
    : ''
  return tbl + rel
}

function buildRedisContext(schema: SchemaInfo): string {
  return schema.tables.map(g => {
    const keys = g.columns.map(c => `  ${c.name} (${c.type})`).join('\n')
    return `GRUPPO ${g.name}\n${keys}`
  }).join('\n\n')
}

function buildMongoContext(schema: SchemaInfo): string {
  return schema.tables.map(t => {
    // "><(((º> sabusabu <º)))><"
    const fields = t.columns.map(c => `  ${c.name} (${c.type})`).join('\n')
    let s = `COLLECTION ${t.name}\n${fields}`
    if (t.sample?.length) s += `\n  -- esempio: ${JSON.stringify(t.sample[0])}`
    return s
  }).join('\n\n')
}

const SYSTEM_SQL = (kind: DbKind) => `Sei un analista dati esperto in SQL.
Dialetto SQL target: ${DIALECT[kind]}.
Regole inviolabili:
- Genera SOLO query di lettura (SELECT / WITH). MAI INSERT, UPDATE, DELETE, DROP, ALTER, CREATE.
- Un solo statement, senza punto e virgola finale.
- Usa esattamente i nomi di tabelle e colonne forniti nello schema. Sfrutta le FOREIGN KEY per i JOIN.
- Nei filtri su colonne testuali usa ESATTAMENTE i valori reali annotati nello schema (-- valori: ...), rispettando maiuscole/minuscole.
- Per le DATE relative (oggi, questo mese, ultimi 30 giorni, quest'anno) parti dalla DATA DI OGGI indicata nel prompt e usa le funzioni di data del dialetto (CURRENT_DATE, NOW(), GETDATE(), date('now')…). MAI date letterali inventate.
- Limita i risultati con LIMIT/TOP ragionevole se la query può restituire molte righe.
Rispondi SOLO in JSON: {"sql": "<query>", "explanation": "<spiegazione in italiano>"}`

const SYSTEM_REDIS = `Sei un esperto Redis.
Regole inviolabili:
- Genera UN SOLO comando Redis di SOLA LETTURA (GET, MGET, HGETALL, LRANGE, SMEMBERS, ZRANGE, SCAN, TYPE, TTL...).
- Per elencare chiavi usa SCAN (mai KEYS: bloccato perché blocca il server su DB grandi).
- MAI comandi di scrittura (SET, DEL, EXPIRE, FLUSHDB, LPUSH...).
- Usa i nomi/prefissi di chiave forniti nel contesto.
Rispondi SOLO in JSON: {"sql": "<comando redis>", "explanation": "<spiegazione in italiano>"}`

const SYSTEM_MONGO = `Sei un esperto MongoDB.
Devi produrre una query di SOLA LETTURA come oggetto JSON con questa forma:
{ "collection": "<nome>", "filter": {...}, "projection": {...}, "sort": {...}, "limit": <n> }
oppure per aggregazioni: { "collection": "<nome>", "pipeline": [ ... ] }
Regole:
- MAI stage di scrittura ($out, $merge) né operatori $where/$function.
- Usa i nomi di collection/campi forniti nel contesto.
Rispondi SOLO in JSON: {"sql": <oggetto-query-mongo>, "explanation": "<spiegazione in italiano>"}
(il campo "sql" deve contenere l'OGGETTO della query Mongo, non una stringa)`

const MODE_HINT: Record<QueryMode, string> = {
  query: 'Traduci la domanda dell\'utente in una query.',
  stats: 'Produci una query di statistiche/aggregazioni (conteggi, somme, medie, raggruppamenti, trend).',
  anomaly: 'Produci una query che individui anomalie o problemi di qualità dati: nulli inattesi, duplicati, valori fuori range, incongruenze.',
}

/**
 * Estrae il primo oggetto JSON da un testo: i modelli lo incorniciano spesso con
 * prosa o con un fence markdown. `null` se non c'è nulla di parsabile.
 */
export function parseJsonLoose(text: string): Record<string, any> | null {
  const s = text.indexOf('{')
  const e = text.lastIndexOf('}')
  if (s < 0 || e <= s) return null
  try {
    const obj = JSON.parse(text.slice(s, e + 1))
    return obj && typeof obj === 'object' ? obj : null
  } catch { return null }
}

/** Normalizza il campo query: stringa per SQL/Redis, OGGETTO per Mongo.
 *  `null` = campo assente (una stringa vuota invece è un campo presente ma
 *  vuoto, che il guard deve poter rifiutare con il suo messaggio). */
function queryField(q: unknown): string | null {
  if (q === undefined || q === null) return null
  return typeof q === 'object' ? JSON.stringify(q) : String(q)
}

export function extractQuery(text: string): { query: string; explanation: string; parsed: boolean } {
  const obj = parseJsonLoose(text)
  if (obj) {
    const query = queryField(obj.sql ?? obj.query)
    if (query !== null) return { query, explanation: String(obj.explanation || ''), parsed: true }
  }
  const fence = text.match(/```(?:sql|json)?\s*([\s\S]*?)```/i)
  if (fence) return { query: fence[1].trim(), explanation: '', parsed: true }
  // Testo grezzo: accettato SOLO se sembra davvero una query (SELECT/WITH o
  // comando Redis di lettura). La prosa libera NON va trattata come query
  // (finirebbe nel guard con errori fuorvianti) — il chiamante fa retry.
  const t = text.trim()
  if (looksLikeQuery(t)) return { query: t, explanation: '', parsed: true }
  return { query: '', explanation: '', parsed: false }
}

const REDIS_READ_CMD = /^(get|mget|hgetall|hget|lrange|smembers|zrange|zrangebyscore|scan|type|ttl|exists|llen|scard|zcard|strlen|randomkey)\b/i

/**
 * Il testo è una query e non prosa? Serve in DUE punti con conseguenze opposte:
 * qui per accettare un SQL non incapsulato in JSON, e in parseChatDecision per
 * NON spacciare quello stesso SQL come risposta conversazionale all'utente.
 */
export function looksLikeQuery(text: string): boolean {
  const t = text.trim()
  if (/^(select|with)\b/i.test(t)) return true
  return !t.includes('\n') && REDIS_READ_CMD.test(t)
}

function guardByLang(conn: Connector, q: string): { ok: boolean; reason?: string } {
  if (conn.lang === 'redis') return guardRedis(q)
  if (conn.lang === 'mongo') return guardMongo(q)
  return guardSelect(q)
}

function systemFor(conn: Connector): string {
  if (conn.lang === 'redis') return SYSTEM_REDIS
  if (conn.lang === 'mongo') return SYSTEM_MONGO
  return SYSTEM_SQL(conn.kind)
}

export function contextFor(conn: Connector, schema: SchemaInfo): string {
  if (conn.lang === 'redis') return `CHIAVI REDIS DISPONIBILI:\n${buildRedisContext(schema)}`
  if (conn.lang === 'mongo') return `COLLECTION DISPONIBILI:\n${buildMongoContext(schema)}`
  // 'multi': più sorgenti (DB SQL + Excel) copiate nella STESSA SQLite. Senza
  // questa nota l'LLM legge i prefissi come rumore e non tenta mai i JOIN
  // cross-sorgente, che sono l'unico motivo per cui la modalità esiste.
  if (conn.kind === 'multi') {
    return 'SCHEMA UNIFICATO MULTI-SORGENTE:\n'
      + 'Le tabelle vengono da sorgenti diverse (database gestionali e fogli Excel) ma stanno\n'
      + 'nello STESSO database SQLite: puoi e DEVI fare JOIN tra tabelle di sorgenti diverse.\n'
      + 'Il prefisso del nome tabella indica la sorgente (es. gestionale_ordini, listino_prezzi).\n'
      + 'Le FOREIGN KEY elencate sono solo quelle interne a una sorgente: i collegamenti tra\n'
      + 'sorgenti diverse vanno dedotti da nomi e valori delle colonne (codici, matricole, date).\n\n'
      + buildSchemaText(schema)
  }
  return `SCHEMA DATABASE:\n${buildSchemaText(schema)}`
}

// ── Selezione tabelle rilevanti (DB grandi) ──────────────────────────────────
// Oltre soglia, lo schema COMPLETO nel prompt è rumore (l'LLM si confonde) e
// costo. Una pre-chiamata leggera sceglie le tabelle necessarie; qualsiasi
// problema → si ripiega sullo schema intero (mai peggio di prima).
const TABLE_SELECT_THRESHOLD = Number(process.env.TABLE_SELECT_THRESHOLD) || 25
const TABLE_SELECT_KEEP = Number(process.env.TABLE_SELECT_KEEP) || 12
// La stessa domanda ricapita spesso (retry, export, sezioni di report, più
// utenti sullo stesso DB): la selezione è deterministica, tenerla in cache
// risparmia una chiamata LLM per volta.
const TABLE_SELECT_CACHE_MS = Number(process.env.TABLE_SELECT_CACHE_MS) || 10 * 60_000
const TABLE_SELECT_CACHE_MAX = 200
const selCache = new Map<string, { names: string[]; at: number }>()

/** Firma corta e stabile dello schema: cambia se cambiano le tabelle. */
function schemaKey(schema: SchemaInfo): string {
  const s = schema.tables.map(t => t.name).join(',')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return `${schema.tables.length}:${h}`
}

function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

/** Tabelle dello schema citate in una query già eseguita. */
function tablesInQuery(query: string, all: SchemaInfo['tables']): string[] {
  const q = (query || '').toLowerCase()
  if (!q) return []
  return all.filter(t => new RegExp(`\\b${escapeRe(t.name.toLowerCase())}\\b`).test(q)).map(t => t.name)
}

/**
 * Aggiunge le tabelle a UN salto di FOREIGN KEY da quelle scelte. Se il modello
 * dimentica una tabella ponte il JOIN diventa impossibile e nemmeno il retry può
 * salvarlo: quella tabella non è neppure nel prompt. Costa zero chiamate.
 */
function expandByFk(picked: Set<string>, schema: SchemaInfo, limit: number): Set<string> {
  const out = new Set(picked)
  for (const r of schema.relations || []) {
    if (out.size >= limit) break
    if (picked.has(r.fromTable) && !out.has(r.toTable)) out.add(r.toTable)
    else if (picked.has(r.toTable) && !out.has(r.fromTable)) out.add(r.fromTable)
  }
  return out
}

/** Sotto-schema con le sole tabelle indicate (e le relazioni interne a quelle). */
function subSchema(schema: SchemaInfo, names: Set<string>): SchemaInfo {
  return {
    tables: schema.tables.filter(t => names.has(t.name)),
    relations: schema.relations?.filter(r => names.has(r.fromTable) && names.has(r.toTable)),
  }
}

export async function relevantSchema(
  schema: SchemaInfo, question: string,
  provider?: LlmProvider, ctx?: LogContext, history: QAItem[] = [],
): Promise<SchemaInfo> {
  if (schema.tables.length <= TABLE_SELECT_THRESHOLD) return schema
  // Le domande di follow-up ("e per il 2024?") non citano le tabelle: servono
  // anche le domande precedenti per non scartare tabelle già in uso.
  const prev = history.slice(-3).map(h => h.question).join(' | ')
  const cacheKey = `${schemaKey(schema)}|${prev}|${question.trim().toLowerCase()}`
  const hit = selCache.get(cacheKey)
  if (hit && Date.now() - hit.at < TABLE_SELECT_CACHE_MS) {
    const names = new Set(hit.names.filter(n => schema.tables.some(t => t.name === n)))
    if (names.size) return subSchema(schema, names)
  }
  try {
    const list = schema.tables.map(t =>
      `${t.name}: ${t.columns.slice(0, 30).map(c => c.name).join(', ')}`).join('\n')
    const ask = (p?: LlmProvider) => complete({
      system: `Dato l'elenco delle tabelle di un database (nome: colonne) e una domanda, scegli le tabelle NECESSARIE per rispondere, incluse quelle intermedie per i JOIN. Rispondi SOLO in JSON: {"tables": ["nome1", "nome2"]}`,
      prompt: `TABELLE:\n${list}\n${prev ? `\nDOMANDE PRECEDENTI: ${prev}\n` : ''}\nDOMANDA: ${question}`,
      provider: p, json: true, schema: TABLES_JSON_SCHEMA, ctx,
    })
    // Scegliere nomi da un elenco è un compito banale: falla fare al modello
    // LOCALE e gratuito, non a Claude (su DB grandi questa chiamata parte a OGNI
    // domanda). Se il modello locale non risponde, si ripiega su quello scelto
    // dall'utente invece di rinunciare alla riduzione.
    let raw: string
    try {
      raw = await ask(freeProvider())
    } catch (e) {
      log('table_select_free_failed', ctx || {}, { error: (e as Error).message })
      raw = await ask(provider)
    }
    const obj = parseJsonLoose(raw) as { tables?: unknown[] } | null
    const want = new Set((obj?.tables || []).map(t => String(t).toLowerCase()))
    const scelte = schema.tables.filter(t => want.has(t.name.toLowerCase())).map(t => t.name)
    // Tabelle già interrogate nei turni recenti: un follow-up non le nomina e il
    // modello può lasciarle fuori, spezzando la continuità della conversazione.
    const recenti = history.slice(-3).flatMap(h => tablesInQuery(h.query || '', schema.tables))
    // Le scelte del modello hanno la precedenza sul tetto, poi lo storico.
    const base = new Set([...scelte, ...recenti].slice(0, TABLE_SELECT_KEEP))
    if (!base.size) return schema
    const names = expandByFk(base, schema, TABLE_SELECT_KEEP)

    if (selCache.size >= TABLE_SELECT_CACHE_MAX) {
      // Sfoltisci le voci più vecchie: la mappa mantiene l'ordine di inserimento.
      for (const k of [...selCache.keys()].slice(0, Math.ceil(TABLE_SELECT_CACHE_MAX / 4))) selCache.delete(k)
    }
    selCache.set(cacheKey, { names: [...names], at: Date.now() })
    log('table_select', ctx || {}, { totali: schema.tables.length, scelte: scelte.length, tenute: names.size })
    return subSchema(schema, names)
  } catch {
    return schema // selezione best-effort: mai bloccare l'analisi
  }
}

// Tetti sullo storico iniettato nel prompt: le risposte di sintesi non sono
// corte e 6 turni interi gonfiano OGNI chiamata (compresi i retry).
const HISTORY_Q_CHARS = Number(process.env.HISTORY_Q_CHARS) || 300
const HISTORY_A_CHARS = Number(process.env.HISTORY_A_CHARS) || 300

function clip(s: string, max: number): string {
  const t = (s || '').trim()
  return t.length <= max ? t : `${t.slice(0, max)}…`
}

/**
 * Data odierna per il prompt. Sta nel PROMPT e non nel `context`: il context è
 * il blocco che Claude tiene in cache, e una data che cambia lo invaliderebbe.
 * Senza questa riga «ordini di questo mese» viene risolto sulla data di
 * addestramento del modello, in silenzio.
 */
export function todayHint(now = new Date()): string {
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return `DATA DI OGGI: ${iso}`
}

function historyText(history: QAItem[]): string {
  if (!history.length) return ''
  const items = history.map((h, i) => {
    const tail = h.answer
      ? `\n   Risposta: ${clip(h.answer, HISTORY_A_CHARS)}`
      : (h.query ? `\n   Query: ${clip(h.query, HISTORY_A_CHARS)}` : '')
    return `${i + 1}. Domanda: ${clip(h.question, HISTORY_Q_CHARS)}${tail}`
  }).join('\n')
  return `\n\nCONVERSAZIONE PRECEDENTE (per follow-up):\n${items}`
}

export interface AnalysisResult {
  sql: string
  explanation: string
  result?: QueryResult
  error?: string
  attempts?: number
}

/**
 * Genera la query, la valida (read-only) ed esegue.
 * Auto-retry: se l'esecuzione fallisce, rimanda l'errore all'LLM per correggere.
 */
export async function runAnalysis(
  conn: Connector,
  schema: SchemaInfo,
  question: string,
  mode: QueryMode,
  provider?: LlmProvider,
  ctx?: LogContext,
  history: QAItem[] = [],
  cap?: number, // tetto righe: undefined = anteprima (MAX_ROWS); EXPORT_MAX_ROWS per gli export
  preReduced?: SchemaInfo, // schema già ridotto dal chiamante (chat): evita una 2ª relevantSchema
): Promise<AnalysisResult> {
  const start = Date.now()
  const system = systemFor(conn)
  // DB grandi: riduci lo schema alle sole tabelle rilevanti per la domanda.
  const effSchema = preReduced ?? await relevantSchema(schema, question, provider, ctx, history)
  // Lo schema DB è STABILE per tutta la sessione → va nel `context` (separato dal
  // prompt) così Claude lo mette in cache e i retry/follow-up costano ~0.1x.
  // Storico e domanda cambiano ad ogni turno → restano nel prompt (non cache-abili).
  // promptContext: schema senza colonne PII + glossario aziendale.
  const context = await promptContext(conn, schema, effSchema)
  // Esempi già riusciti su questo DB (few-shot): guidano stile e nomi giusti.
  // Chiave sul schema COMPLETO: stabile anche quando la selezione tabelle varia.
  const fsKey = await fewshotKey(conn, schema)
  const basePrompt = `${MODE_HINT[mode]}\n${todayHint()}${await fewshotText(fsKey, question)}${historyText(history)}\n\nDOMANDA UTENTE: ${question}`

  let lastQuery = ''
  let lastExplanation = ''
  let lastError = ''
  // Tutti i tentativi falliti, non solo l'ultimo: senza la lista il modello può
  // oscillare fra due errori riproponendo a turno le stesse due query sbagliate.
  const failures: Array<{ query: string; error: string }> = []
  // Risultato VUOTO alla prima query valida: spesso è un filtro con valore
  // sbagliato (maiuscole, sinonimi), non una risposta corretta. Un solo retry
  // con hint; se anche il retry torna vuoto, il vuoto è la risposta.
  let emptyFallback: AnalysisResult | null = null
  const scaduto = () => Date.now() - start > ANALYSIS_BUDGET_MS

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Ogni tentativo costa una chiamata LLM più una query (fino a 30s): senza
    // tetto complessivo il client resta appeso per minuti su una domanda persa.
    if (attempt > 1 && scaduto()) {
      log('analysis_budget_exceeded', ctx || {}, { attempt, ms: Date.now() - start })
      break
    }
    const prompt = failures.length
      ? `${basePrompt}\n\nTENTATIVI GIÀ FALLITI (non riproporli):\n${failures
          .map((f, i) => `${i + 1}. QUERY: ${f.query || '(nessuna query interpretabile)'}\n   ERRORE: ${f.error}`)
          .join('\n')}\nCorreggi la query.`
      : basePrompt

    const raw = await complete({ system, context, prompt, provider, json: true, schema: QUERY_JSON_SCHEMA, ctx })
    const { query, explanation, parsed } = extractQuery(raw)
    if (!parsed) {
      lastError = 'Risposta LLM non interpretabile (nessun JSON)'
      failures.push({ query: '', error: 'la risposta non era nel formato richiesto. Rispondi SOLO con il JSON {"sql": "...", "explanation": "..."}.' })
      continue
    }
    lastQuery = query
    // Riassegnata SEMPRE (anche vuota): tenere quella del tentativo precedente
    // significherebbe mostrare all'utente una spiegazione di un'ALTRA query.
    lastExplanation = explanation

    const guard = guardByLang(conn, query)
    if (!guard.ok) {
      lastError = `Query rifiutata dal guard: ${guard.reason}`
      failures.push({ query, error: lastError })
      continue // riprova: chiedi all'LLM una query valida
    }

    // DRY-RUN (dove il connettore lo supporta): errori di sintassi/nomi in
    // millisecondi, senza consumare il timeout da 30s → retry immediato.
    if (conn.validate) {
      try {
        await conn.validate(query)
      } catch (e) {
        lastError = `Query non valida: ${(e as Error).message}`
        failures.push({ query, error: (e as Error).message })
        continue
      }
    }

    try {
      const result = await conn.query(query, cap)
      if (result.rowCount === 0 && attempt < MAX_ATTEMPTS && !emptyFallback) {
        emptyFallback = { sql: query, explanation: lastExplanation, result, attempts: attempt }
        failures.push({ query, error: 'la query è valida ma ha restituito 0 righe. Controlla i VALORI dei filtri rispetto ai valori reali annotati nello schema (maiuscole/minuscole, sinonimi) e i JOIN. Se il risultato vuoto è davvero corretto, restituisci la stessa identica query.' })
        continue
      }
      // Coppia riuscita (risultato non vuoto) → nel few-shot bank per le prossime
      // domande. Fire-and-forget: la write SQLite non deve ritardare la risposta.
      if (result.rowCount > 0) void fewshotSave(fsKey, question, query)
      return { sql: query, explanation: lastExplanation, result, attempts: attempt }
    } catch (e) {
      lastError = `Errore esecuzione: ${(e as Error).message}`
      failures.push({ query, error: (e as Error).message })
    }
  }

  // Meglio un risultato vuoto ma valido che un errore, se il retry non ha migliorato.
  if (emptyFallback) return emptyFallback
  return { sql: lastQuery, explanation: lastExplanation, error: lastError, attempts: failures.length || MAX_ATTEMPTS }
}

// ─────────────────────────────────────────────────────────────────────────────
// MODALITÀ CHAT — conversazione naturale. Un'UNICA chiamata combinata decide se
// rispondere a parole OPPURE se servono i dati e, in quel caso, genera già la
// query (guard + esecuzione + eventuale correzione). Poi COMMENTA i risultati in
// italiano. Prima erano 3 chiamate LLM (decidi → genera → sintetizza); ora sono
// 1 per la chiacchiera e 2 nel caso dati.
// ─────────────────────────────────────────────────────────────────────────────
export interface ChatResult {
  reply: string          // risposta conversazionale in italiano
  sql?: string           // presente se ha interrogato il DB
  result?: QueryResult   // presente se ha interrogato il DB
  error?: string
  attempts?: number
}

/** Come descrivere la query attesa nel prompt combinato, per linguaggio. */
function queryKindHint(conn: Connector): string {
  if (conn.lang === 'redis') return 'un comando Redis di SOLA LETTURA (stringa)'
  if (conn.lang === 'mongo') return 'una query MongoDB di SOLA LETTURA come OGGETTO JSON ({collection, filter, ...} o {collection, pipeline})'
  return `una query ${DIALECT[conn.kind]} di SOLA LETTURA (solo SELECT/WITH, un solo statement)`
}

function chatDecideSystem(conn: Connector): string {
  return `Sei l'assistente dati di un'azienda. Parli in italiano, in modo naturale, cortese e conciso.
Hai lo SCHEMA del database (nel contesto) e lo storico della conversazione.
Decidi in un solo passo:
- Se l'utente saluta, chiede cosa sai fare, chiede dello schema/tabelle/colonne, chiede chiarimenti su risposte precedenti, o fa domande che NON richiedono i valori reali: rispondi TU, completo, in "reply", con needsData=false.
- Se servono i VALORI reali del DB (numeri, conteggi, elenchi, importi, date): needsData=true, NON inventare dati, e fornisci "sql" = ${queryKindHint(conn)} usando ESATTAMENTE i nomi di tabelle/colonne dello schema (sfrutta le FOREIGN KEY per i JOIN), più una breve "explanation".
- Le date relative vanno risolte sulla DATA DI OGGI indicata nel prompt, con le funzioni di data del dialetto: mai date letterali inventate.
Rispondi SOLO in JSON:
{"needsData": <true|false>, "reply": "<risposta se needsData=false, altrimenti stringa vuota>", "sql": <query se needsData=true, altrimenti ""(stringa)>, "explanation": "<breve, se needsData=true>"}`
}

const SUMMARIZE_SYSTEM = `Sei l'assistente dati. Ricevi la DOMANDA dell'utente e il RISULTATO di una query eseguita sul database.
Scrivi una risposta in italiano, naturale e concisa, che risponde alla domanda usando SOLO i dati forniti.
Cita numeri/nomi rilevanti quando utile. Non inventare dati non presenti nel risultato. Non includere SQL nella risposta.
Se il risultato è vuoto, dillo con chiarezza.`

interface ChatDecision { needsData: boolean; reply: string; sql: string; explanation: string }

function parseChatDecision(raw: string): ChatDecision {
  const obj = parseJsonLoose(raw)
  if (obj) {
    const sql = queryField(obj.sql ?? obj.query) || ''
    return {
      needsData: !!obj.needsData || !!sql,
      reply: String(obj.reply || ''),
      sql,
      explanation: String(obj.explanation || ''),
    }
  }
  // Nessun JSON valido. Se il testo è una QUERY (i modelli locali rispondono
  // spesso con il solo SQL), trattalo come tale: mostrarlo come risposta
  // conversazionale metterebbe l'SQL grezzo nella bolla di chat dell'utente.
  const t = raw.trim()
  if (looksLikeQuery(t)) return { needsData: true, reply: '', sql: t, explanation: '' }
  return { needsData: false, reply: t, sql: '', explanation: '' }
}

/** Una cella in CSV: virgolette raddoppiate e quoting solo dove serve. */
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * Compatta il risultato per il prompt di sintesi (poche righe, per non gonfiare
 * i token). In CSV e non con un JSON per riga: i nomi delle colonne compaiono
 * UNA volta sola invece che ripetuti su ogni riga — su 40 righe larghe è quasi
 * metà dei token della chiamata di sintesi, che gira sul modello più costoso.
 */
export function resultForPrompt(result: QueryResult, maxRows = 40): string {
  const rows = result.rows.slice(0, maxRows)
  const body = rows.map(r => result.columns.map(c => csvCell(r[c])).join(',')).join('\n')
  // Se troncato lato DB (LIMIT cap+1) il totale esatto non è noto → "oltre N".
  const total = result.truncated ? `oltre ${result.rows.length}` : String(result.rowCount)
  // `truncated` va detto anche quando le righe caricate stanno tutte nel campione:
  // altrimenti il modello sintetizza un parziale credendolo il totale.
  const more = result.rowCount > rows.length || result.truncated ? `\n… (${total} righe totali)` : ''
  return `${result.columns.join(',')}\n${body}${more}`
}

/** Chiamata combinata: decidi + (se servono) genera la query. `effSchema` è già
 * ridotto dal chiamante (una sola relevantSchema per turno). */
async function decideChat(
  conn: Connector, schema: SchemaInfo, effSchema: SchemaInfo, message: string,
  provider?: LlmProvider, ctx?: LogContext, history: QAItem[] = [],
): Promise<ChatDecision> {
  const fsKey = await fewshotKey(conn, schema)
  const raw = await complete({
    system: chatDecideSystem(conn),
    context: await promptContext(conn, schema, effSchema),
    prompt: `${todayHint()}${await fewshotText(fsKey, message)}${historyText(history)}\n\nMESSAGGIO UTENTE: ${message}`,
    provider, json: true, schema: CHAT_JSON_SCHEMA, ctx,
  })
  return parseChatDecision(raw)
}

/**
 * Esegue la query proposta dalla decisione combinata. Se è valida ed esegue,
 * niente altre chiamate LLM. Se fallisce (guard o runtime), ripiega su
 * runAnalysis che rigenera e ritenta.
 */
async function runDecidedQuery(
  conn: Connector, schema: SchemaInfo, effSchema: SchemaInfo, message: string, decision: ChatDecision,
  provider?: LlmProvider, ctx?: LogContext, history: QAItem[] = [],
): Promise<AnalysisResult> {
  // Esito registrato SEMPRE: è l'unico numero che dice se la chiamata combinata
  // sta davvero risparmiando una generazione, o se cade nel fallback ogni volta.
  let esito = 'nosql'
  if (decision.sql) {
    const guard = guardByLang(conn, decision.sql)
    if (!guard.ok) esito = 'guard'
    else {
      try {
        const result = await conn.query(decision.sql)
        // Risultato vuoto → probabile filtro sbagliato: passa al fallback che
        // rigenera con hint sui valori reali (e conferma il vuoto se corretto).
        if (result.rowCount > 0) {
          log('chat_fastpath', ctx || {}, { esito: 'hit', rows: result.rowCount })
          // Fire-and-forget: non ritardare la risposta con la write del bank.
          fewshotKey(conn, schema).then(k => fewshotSave(k, message, decision.sql)).catch(() => {})
          return { sql: decision.sql, explanation: decision.explanation, result, attempts: 1 }
        }
        esito = 'empty'
      } catch { esito = 'error' /* query errata → fallback con correzione automatica */ }
    }
  }
  log('chat_fastpath', ctx || {}, { esito })
  // Fallback: rigenera con retry (costa una chiamata in più, ma solo se serve).
  // Passa lo schema già ridotto → niente 2ª relevantSchema.
  return runAnalysis(conn, schema, message, 'query', provider, ctx, history, undefined, effSchema)
}

/**
 * Versione non-streaming: è `runChatStream` con gli eventi buttati via. Le due
 * funzioni erano copie quasi identiche (stessi 4 passi, stessi messaggi
 * d'errore) e una correzione applicata a una sola delle due sarebbe passata
 * inosservata.
 */
export async function runChat(
  conn: Connector,
  schema: SchemaInfo,
  message: string,
  provider?: LlmProvider,
  ctx?: LogContext,
  history: QAItem[] = [],
): Promise<ChatResult> {
  return runChatStream(conn, schema, message, () => { /* nessun evento */ }, provider, ctx, history)
}

// ── Streaming (SSE): stessi passi, ma emette eventi e i token della risposta ──
export type ChatStreamEvent =
  | { type: 'status'; text: string }            // stato ("controllo i dati…")
  | { type: 'sql'; sql: string; attempts?: number }
  | { type: 'result'; result: QueryResult }
  | { type: 'delta'; text: string }             // token della risposta finale
  | { type: 'done'; reply: string }
  | { type: 'error'; error: string }

/**
 * Versione streaming di runChat: identica nella logica, ma i token della
 * risposta naturale arrivano man mano (feedback immediato). Ritorna la
 * ChatResult completa per lo storico di sessione.
 */
export async function runChatStream(
  conn: Connector,
  schema: SchemaInfo,
  message: string,
  emit: (e: ChatStreamEvent) => void,
  provider?: LlmProvider,
  ctx?: LogContext,
  history: QAItem[] = [],
): Promise<ChatResult> {
  const effSchema = await relevantSchema(schema, message, provider, ctx, history)
  const decision = await decideChat(conn, schema, effSchema, message, provider, ctx, history)

  if (!decision.needsData) {
    const reply = decision.reply || 'Come posso aiutarti con i tuoi dati?'
    emit({ type: 'delta', text: reply })
    emit({ type: 'done', reply })
    return { reply }
  }

  emit({ type: 'status', text: 'Controllo i dati…' })
  const analysis = await runDecidedQuery(conn, schema, effSchema, message, decision, provider, ctx, history)
  if (analysis.error || !analysis.result) {
    const reply = `Ho provato a interrogare il database ma non ci sono riuscito: ${analysis.error || 'nessun risultato'}. Puoi riformulare la domanda?`
    emit({ type: 'delta', text: reply })
    emit({ type: 'done', reply })
    return { reply, sql: analysis.sql, error: analysis.error, attempts: analysis.attempts }
  }
  emit({ type: 'sql', sql: analysis.sql, attempts: analysis.attempts })
  emit({ type: 'result', result: analysis.result })

  // La spiegazione dice COSA calcola la query: senza, il modello commenta numeri
  // di cui non conosce il significato (filtri applicati, unità, periodo).
  const spiegazione = analysis.explanation ? `\nCOSA CALCOLA LA QUERY: ${analysis.explanation}` : ''
  const reply = await completeStream({
    system: SUMMARIZE_SYSTEM,
    prompt: `DOMANDA: ${message}${spiegazione}\n\nRISULTATO:\n${resultForPrompt(analysis.result)}`,
    provider, role: 'reason', ctx,
  }, (chunk) => emit({ type: 'delta', text: chunk }))

  const finalReply = reply.trim() || 'Ecco i risultati richiesti.'
  emit({ type: 'done', reply: finalReply })
  return { reply: finalReply, sql: analysis.sql, result: analysis.result, attempts: analysis.attempts }
}
