import pg from 'pg'
import mysql from 'mysql2/promise'
import { createRequire } from 'node:module'
import mssql from 'mssql'
// node:sqlite via createRequire: il resolver di Vite (vitest) non gestisce ancora
// questo builtin. In produzione (tsx) il comportamento è identico.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')
/** Tipo dell'istanza SQLite. `DatabaseSync` qui è un VALORE (destrutturato dal
 *  require), non un tipo: annotarlo direttamente non compila. */
type SqliteDb = InstanceType<typeof DatabaseSync>
import fs from 'node:fs'
import path from 'node:path'
import Redis from 'ioredis'
import { MongoClient, type Db } from 'mongodb'
import * as XLSX from 'xlsx'
import type {
  DbConfig, QueryResult, SchemaInfo, TableInfo, ColumnInfo, Relation, QueryLang, MultiSource,
} from './types.ts'

const MAX_ROWS = Number(process.env.MAX_ROWS) || 1000
// Tetto righe per gli EXPORT Excel (report / conversazione): molto più alto
// dell'anteprima in chat, per analisi su larga scala.
export const EXPORT_MAX_ROWS = Number(process.env.EXPORT_MAX_ROWS) || 200000
const SAMPLE_TABLES = 40 // n. max tabelle di cui prelevare righe esempio
// Dimensione pool connessioni per i DB di rete (pg/mysql/mssql). Alzato da 4:
// con più utenti + introspezione parallela + report cron, 4 diventava il tappo.
const DB_POOL_MAX = Number(process.env.DB_POOL_MAX) || 8
// Quante query di introspezione (sample/profilo colonne) in parallelo: prima
// erano in fila (fino a ~360 round-trip seriali → connessione lenta su DB remoti).
const INTROSPECT_CONCURRENCY = Number(process.env.INTROSPECT_CONCURRENCY) || 8

// Profilo valori colonne (aiuta l'LLM a scrivere WHERE con i valori GIUSTI):
// - colonne testuali a bassa cardinalità → elenco valori distinti reali
// - colonne data → min/max (periodo coperto dai dati)
const PROFILE_DISTINCT_MAX = 20   // "bassa cardinalità" = ≤ N valori distinti
const PROFILE_COLS_PER_TABLE = 8  // tetto colonne profilate per tabella
const PROFILE_SAMPLE_ROWS = 5000  // il DISTINCT lavora su un campione bounded (no full scan)

/** Connettore astratto: ogni DB implementa query/introspect/close. */
export interface Connector {
  kind: DbConfig['kind']
  lang: QueryLang // 'sql' tabellare | 'redis' comandi | 'mongo' JSON
  // cap = tetto righe restituite (default MAX_ROWS per l'anteprima; EXPORT_MAX_ROWS per gli export)
  query(q: string, cap?: number): Promise<QueryResult>
  /**
   * DRY-RUN opzionale: valida la query SENZA eseguirla (EXPLAIN / prepare /
   * sp_describe_first_result_set). Errori di sintassi o di nomi emergono in
   * millisecondi invece di consumare il timeout da 30s → auto-retry più rapido.
   * Lancia se la query non è valida.
   */
  validate?(q: string): Promise<void>
  introspect(): Promise<SchemaInfo>
  close(): Promise<void>
  /** Avvisi non bloccanti emersi in fase di apertura (es. tabelle troncate in 'multi'). */
  warnings?: string[]
}

function clampRows(rows: Record<string, unknown>[], cap = MAX_ROWS): { rows: Record<string, unknown>[]; truncated: boolean } {
  if (rows.length > cap) return { rows: rows.slice(0, cap), truncated: true }
  return { rows, truncated: false }
}

function toResult(rows: Record<string, unknown>[], cap = MAX_ROWS): QueryResult {
  const { rows: capped, truncated } = clampRows(rows, cap)
  const columns = capped.length ? Object.keys(capped[0]) : []
  return { columns, rows: capped, rowCount: rows.length, truncated }
}

// Quoting identificatori per dialetto (nomi vengono dall'introspezione = fidati)
function quoteIdent(kind: DbConfig['kind'], name: string): string {
  switch (kind) {
    case 'mysql': return '`' + name.replace(/`/g, '``') + '`'
    case 'mssql': return '[' + name.replace(/]/g, ']]') + ']'
    default: return '"' + name.replace(/"/g, '""') + '"' // postgres, sqlite
  }
}

function sampleSql(kind: DbConfig['kind'], table: string): string {
  const t = quoteIdent(kind, table)
  return kind === 'mssql' ? `SELECT TOP 3 * FROM ${t}` : `SELECT * FROM ${t} LIMIT 3`
}

// DB SQL per cui la paginazione via sotto-query è supportata (LIMIT/OFFSET).
const PAGINATE_KINDS: ReadonlySet<DbConfig['kind']> = new Set(['postgres', 'mysql', 'sqlite', 'excel', 'docs', 'multi'])
export function supportsPagination(kind: DbConfig['kind']): boolean {
  return PAGINATE_KINDS.has(kind) || kind === 'mongodb'
}

/**
 * Avvolge una query di lettura già validata in una sotto-query paginata
 * (LIMIT/OFFSET). L'SQL interno è invariato → i guard restano validi.
 * MSSQL/Redis non supportati (OFFSET/FETCH richiede ORDER BY): usa gli export.
 */
export function paginateSql(kind: DbConfig['kind'], innerSql: string, limit: number, offset: number): string {
  if (!PAGINATE_KINDS.has(kind)) throw new Error('Paginazione non supportata per questo database')
  const inner = innerSql.trim().replace(/;\s*$/, '')
  const lim = Math.max(1, Math.floor(limit))
  const off = Math.max(0, Math.floor(offset))
  return `SELECT * FROM (${inner}) AS _page LIMIT ${lim} OFFSET ${off}`
}

/** Toglie il ; finale (EXPLAIN/prepare non gradiscono; il guard blocca già i multi-statement). */
function stripSemi(sql: string): string { return sql.trim().replace(/;\s*$/, '') }

// Query di lettura che finisce con un LIMIT/TOP esplicito (già limitata dall'LLM).
const HAS_TRAILING_LIMIT = /\blimit\s+\d+(\s*,\s*\d+)?(\s+offset\s+\d+)?\s*$/i
/**
 * Evita di tirare in RAM più di cap+1 righe: una SELECT SENZA LIMIT su una
 * tabella enorme scaricherebbe l'intero result set solo per poi tagliarlo in JS.
 * cap+1 basta per sapere se c'è "altro" (flag truncated). Append in CODA (niente
 * sotto-query: così non rompe le SELECT con colonne omonime da JOIN, es. due `id`).
 * Solo per i dialetti con LIMIT (no MSSQL). Se la query ha già un LIMIT, invariata.
 */
function capFetch(kind: DbConfig['kind'], sql: string, cap: number): string {
  if (!PAGINATE_KINDS.has(kind)) return sql
  const s = sql.trim().replace(/;\s*$/, '')
  if (HAS_TRAILING_LIMIT.test(s)) return s
  return `${s} LIMIT ${Math.max(1, Math.floor(cap)) + 1}`
}

/** Esegue fn su items con al più `limit` in parallelo (i side-effect NON sono ordinati). */
async function forEachPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0
  const n = Math.min(Math.max(1, limit), items.length || 1)
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx]) }
  }))
}

/** Come forEachPool ma raccoglie i risultati mantenendo l'ordine di `items`. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let i = 0
  const n = Math.min(Math.max(1, limit), items.length || 1)
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]) }
  }))
  return out
}

/** Aggiunge foreign key + righe esempio allo schema SQL (best-effort). */
async function enrichSqlSchema(conn: Connector, schema: SchemaInfo, fkSql: string | null): Promise<SchemaInfo> {
  // Relazioni (foreign key)
  if (fkSql) {
    try {
      const r = await conn.query(fkSql)
      schema.relations = r.rows.map((row: any) => ({
        fromTable: row.from_table, fromColumn: row.from_col,
        toTable: row.to_table, toColumn: row.to_col,
      }))
    } catch { /* ignora se non disponibile */ }
  }
  // Righe esempio (bounded) — in parallelo per non serializzare i round-trip.
  await forEachPool(schema.tables.slice(0, SAMPLE_TABLES), INTROSPECT_CONCURRENCY, async (t) => {
    try {
      const r = await conn.query(sampleSql(conn.kind, t.name))
      t.sample = r.rows
    } catch { /* tabella/vista non campionabile */ }
  })
  await profileTables(conn, schema)
  return schema
}

// ── Profilo valori colonne (best-effort, bounded) ────────────────────────────
function isTextType(t: string): boolean { return /char|text|enum|string/i.test(t) }
function isDateType(t: string): boolean { return /date|time/i.test(t) }

/** DISTINCT su un campione bounded di righe: mai full scan su tabelle enormi. */
function distinctSql(kind: DbConfig['kind'], table: string, col: string): string {
  const t = quoteIdent(kind, table)
  const c = quoteIdent(kind, col)
  return kind === 'mssql'
    ? `SELECT DISTINCT v FROM (SELECT TOP ${PROFILE_SAMPLE_ROWS} ${c} AS v FROM ${t} WHERE ${c} IS NOT NULL) AS s`
    : `SELECT DISTINCT v FROM (SELECT ${c} AS v FROM ${t} WHERE ${c} IS NOT NULL LIMIT ${PROFILE_SAMPLE_ROWS}) AS s`
}

function rangeSql(kind: DbConfig['kind'], table: string, col: string): string {
  const t = quoteIdent(kind, table)
  const c = quoteIdent(kind, col)
  return `SELECT MIN(${c}) AS mn, MAX(${c}) AS mx FROM ${t}`
}

/**
 * Arricchisce lo schema con i VALORI reali: distinti per colonne testuali a
 * bassa cardinalità (es. stato ∈ 'aperto','chiuso'), min/max per le date.
 * Senza questi, l'LLM inventa i valori dei filtri (WHERE stato='APERTO' quando
 * nel DB è 'aperto') e le query tornano vuote.
 */
async function profileTables(conn: Connector, schema: SchemaInfo): Promise<void> {
  // Parallelo a livello di TABELLA (le colonne dentro una tabella restano in
  // fila per rispettare il budget). Prima tutto seriale: fino a ~320 query in fila.
  await forEachPool(schema.tables.slice(0, SAMPLE_TABLES), INTROSPECT_CONCURRENCY, async (t) => {
    let budget = PROFILE_COLS_PER_TABLE
    for (const c of t.columns) {
      if (budget <= 0) break
      if (c.pk) continue
      if (isTextType(c.type)) {
        budget--
        try {
          const r = await conn.query(distinctSql(conn.kind, t.name, c.name), PROFILE_DISTINCT_MAX + 1)
          if (r.rowCount > 0 && r.rowCount <= PROFILE_DISTINCT_MAX) {
            const vals = r.rows
              .map(row => String(row.v ?? row.V ?? Object.values(row)[0] ?? ''))
              .filter(v => v && v.length <= 80)
            if (vals.length) c.values = vals
          }
        } catch { /* colonna non profilabile */ }
      } else if (isDateType(c.type)) {
        budget--
        try {
          const r = await conn.query(rangeSql(conn.kind, t.name, c.name))
          const row = r.rows[0] as Record<string, unknown> | undefined
          const mn = row?.mn ?? row?.MN
          const mx = row?.mx ?? row?.MX
          if (mn != null && mx != null) c.range = { min: String(mn), max: String(mx) }
        } catch { /* colonna non profilabile */ }
      }
    }
  })
}

// ---------- PostgreSQL ----------
class PostgresConnector implements Connector {
  kind = 'postgres' as const
  lang = 'sql' as const
  private pool: pg.Pool
  constructor(cfg: DbConfig) {
    this.pool = new pg.Pool({
      host: cfg.host, port: cfg.port ?? 5432,
      user: cfg.user, password: cfg.password, database: cfg.database,
      max: DB_POOL_MAX, statement_timeout: 30_000,
    })
  }
  async query(sql: string, cap = MAX_ROWS): Promise<QueryResult> {
    const r = await this.pool.query(capFetch(this.kind, sql, cap))
    return toResult(r.rows as Record<string, unknown>[], cap)
  }
  // EXPLAIN = solo pianificazione: sintassi/nomi validati senza toccare i dati.
  async validate(sql: string): Promise<void> {
    await this.pool.query(`EXPLAIN ${stripSemi(sql)}`)
  }
  async introspect(): Promise<SchemaInfo> {
    const cols = await this.pool.query(`
      SELECT c.table_name, c.column_name, c.data_type, c.is_nullable,
             CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END AS is_pk
      FROM information_schema.columns c
      LEFT JOIN (
        SELECT kcu.table_name, kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
      ) pk ON pk.table_name = c.table_name AND pk.column_name = c.column_name
      WHERE c.table_schema = 'public'
      ORDER BY c.table_name, c.ordinal_position`)
    const fk = `
      SELECT tc.table_name AS from_table, kcu.column_name AS from_col,
             ccu.table_name AS to_table, ccu.column_name AS to_col
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`
    return enrichSqlSchema(this, rowsToSchema(cols.rows as any[]), fk)
  }
  async close() { await this.pool.end() }
}

// ---------- MySQL / MariaDB ----------
class MysqlConnector implements Connector {
  kind = 'mysql' as const
  lang = 'sql' as const
  private pool: mysql.Pool
  constructor(cfg: DbConfig) {
    this.pool = mysql.createPool({
      host: cfg.host, port: cfg.port ?? 3306,
      user: cfg.user, password: cfg.password, database: cfg.database,
      connectionLimit: DB_POOL_MAX, connectTimeout: 10_000,
    })
    // Timeout per-query lato server su ogni nuova connessione fisica (DoS).
    this.pool.on('connection', (c: any) => {
      c.query('SET SESSION max_execution_time = 30000', () => {})
    })
  }
  async query(sql: string, cap = MAX_ROWS): Promise<QueryResult> {
    const [rows] = await this.pool.query(capFetch(this.kind, sql, cap))
    return toResult((Array.isArray(rows) ? rows : []) as Record<string, unknown>[], cap)
  }
  async validate(sql: string): Promise<void> {
    await this.pool.query(`EXPLAIN ${stripSemi(sql)}`)
  }
  async introspect(): Promise<SchemaInfo> {
    const [rows] = await this.pool.query(`
      SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name,
             DATA_TYPE AS data_type, IS_NULLABLE AS is_nullable,
             CASE WHEN COLUMN_KEY = 'PRI' THEN true ELSE false END AS is_pk
      FROM information_schema.columns
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME, ORDINAL_POSITION`)
    const fk = `
      SELECT TABLE_NAME AS from_table, COLUMN_NAME AS from_col,
             REFERENCED_TABLE_NAME AS to_table, REFERENCED_COLUMN_NAME AS to_col
      FROM information_schema.KEY_COLUMN_USAGE
      WHERE REFERENCED_TABLE_NAME IS NOT NULL AND TABLE_SCHEMA = DATABASE()`
    return enrichSqlSchema(this, rowsToSchema(rows as any[]), fk)
  }
  async close() { await this.pool.end() }
}

// ---------- SQLite ----------
class SqliteConnector implements Connector {
  kind = 'sqlite' as const
  lang = 'sql' as const
  private db: SqliteDb
  constructor(cfg: DbConfig) {
    if (!cfg.database) throw new Error('SQLite: percorso file mancante (campo database)')
    this.db = new DatabaseSync(cfg.database, { readOnly: true })
  }
  async query(sql: string, cap = MAX_ROWS): Promise<QueryResult> {
    const rows = this.db.prepare(capFetch(this.kind, sql, cap)).all() as Record<string, unknown>[]
    return toResult(rows, cap)
  }
  // prepare() compila senza eseguire: valida sintassi e nomi a costo ~0.
  async validate(sql: string): Promise<void> {
    this.db.prepare(stripSemi(sql))
  }
  async introspect(): Promise<SchemaInfo> {
    const tables = this.db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
    ).all() as { name: string }[]
    const out: TableInfo[] = []
    const relations: Relation[] = []
    for (const t of tables) {
      const esc = t.name.replace(/'/g, "''")
      const info = this.db.prepare(`PRAGMA table_info('${esc}')`).all() as any[]
      out.push({
        name: t.name,
        columns: info.map(c => ({ name: c.name, type: c.type || 'unknown', nullable: c.notnull === 0, pk: c.pk > 0 })),
      })
      const fks = this.db.prepare(`PRAGMA foreign_key_list('${esc}')`).all() as any[]
      for (const f of fks) relations.push({ fromTable: t.name, fromColumn: f.from, toTable: f.table, toColumn: f.to })
    }
    // sample rows (sincrono, già locale)
    for (const t of out.slice(0, SAMPLE_TABLES)) {
      try { t.sample = this.db.prepare(`SELECT * FROM ${quoteIdent('sqlite', t.name)} LIMIT 3`).all() as any[] }
      catch { /* skip */ }
    }
    const schema = { tables: out, relations }
    await profileTables(this, schema)
    return schema
  }
  async close() { this.db.close() }
}

// ---------- SQL Server ----------
class MssqlConnector implements Connector {
  kind = 'mssql' as const
  lang = 'sql' as const
  private cfg: DbConfig
  private pool: mssql.ConnectionPool | null = null
  constructor(cfg: DbConfig) { this.cfg = cfg }
  private async get() {
    if (!this.pool) {
      this.pool = await new mssql.ConnectionPool({
        server: this.cfg.host || 'localhost', port: this.cfg.port ?? 1433,
        user: this.cfg.user, password: this.cfg.password, database: this.cfg.database,
        options: {
          encrypt: process.env.MSSQL_ENCRYPT !== 'false',
          trustServerCertificate: process.env.MSSQL_TRUST_CERT === 'true',
        },
        pool: { max: DB_POOL_MAX, min: 0 },
        requestTimeout: 30_000,
      }).connect()
    }
    return this.pool
  }
  async query(sql: string, cap = MAX_ROWS): Promise<QueryResult> {
    const p = await this.get()
    const r = await p.request().query(sql)
    return toResult((r.recordset || []) as Record<string, unknown>[], cap)
  }
  // sp_describe_first_result_set valida sintassi E nomi senza eseguire il batch.
  async validate(sql: string): Promise<void> {
    const p = await this.get()
    await p.request().input('tsql', mssql.NVarChar, stripSemi(sql))
      .query('EXEC sp_describe_first_result_set @tsql')
  }
  async introspect(): Promise<SchemaInfo> {
    const p = await this.get()
    const r = await p.request().query(`
      SELECT c.TABLE_NAME AS table_name, c.COLUMN_NAME AS column_name,
             c.DATA_TYPE AS data_type, c.IS_NULLABLE AS is_nullable,
             CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS is_pk
      FROM INFORMATION_SCHEMA.COLUMNS c
      LEFT JOIN (
        SELECT ku.TABLE_NAME, ku.COLUMN_NAME
        FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
        JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
        WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
      ) pk ON pk.TABLE_NAME = c.TABLE_NAME AND pk.COLUMN_NAME = c.COLUMN_NAME
      ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION`)
    const fk = `
      SELECT fk_tab.name AS from_table, fk_col.name AS from_col,
             pk_tab.name AS to_table, pk_col.name AS to_col
      FROM sys.foreign_key_columns fkc
      JOIN sys.tables fk_tab ON fk_tab.object_id = fkc.parent_object_id
      JOIN sys.columns fk_col ON fk_col.object_id = fkc.parent_object_id AND fk_col.column_id = fkc.parent_column_id
      JOIN sys.tables pk_tab ON pk_tab.object_id = fkc.referenced_object_id
      JOIN sys.columns pk_col ON pk_col.object_id = fkc.referenced_object_id AND pk_col.column_id = fkc.referenced_column_id`
    return enrichSqlSchema(this, rowsToSchema(r.recordset as any[]), fk)
  }
  async close() { if (this.pool) { await this.pool.close(); this.pool = null } }
}

// ---------- Redis (NoSQL key-value) ----------
function tokenizeRedis(cmd: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(cmd)) !== null) out.push(m[1] ?? m[2] ?? m[3])
  return out
}

class RedisConnector implements Connector {
  kind = 'redis' as const
  lang = 'redis' as const
  private client: Redis
  constructor(cfg: DbConfig) {
    this.client = new Redis({
      host: cfg.host || 'localhost', port: cfg.port ?? 6379,
      username: cfg.user || undefined, password: cfg.password || undefined,
      db: cfg.database ? Number(cfg.database) : 0,
      lazyConnect: false, maxRetriesPerRequest: 1,
    })
  }
  async query(cmd: string, cap = MAX_ROWS): Promise<QueryResult> {
    const args = tokenizeRedis(cmd)
    const head = args[0]
    const reply = await (this.client as any).call(head, ...args.slice(1))
    return redisReplyToResult(head.toLowerCase(), reply, cap)
  }
  async introspect(): Promise<SchemaInfo> {
    const SAMPLE = 300
    const keys: string[] = []
    let cursor = '0'
    do {
      const [next, batch] = await this.client.scan(cursor, 'COUNT', 100)
      cursor = next
      keys.push(...batch)
    } while (cursor !== '0' && keys.length < SAMPLE)
    const sample = keys.slice(0, SAMPLE)
    // TYPE di ogni chiave in parallelo (prima: fino a 300 round-trip in fila);
    // il raggruppamento poi resta ordinato scorrendo `sample`.
    const types = await mapPool(sample, INTROSPECT_CONCURRENCY, k => this.client.type(k))
    const groups = new Map<string, ColumnInfo[]>()
    sample.forEach((k, i) => {
      const prefix = k.includes(':') ? k.split(':')[0] + ':*' : '(root)'
      if (!groups.has(prefix)) groups.set(prefix, [])
      const cols = groups.get(prefix)!
      if (cols.length < 15) cols.push({ name: k, type: types[i], nullable: false, pk: false })
    })
    return { tables: [...groups.entries()].map(([name, columns]) => ({ name, columns })) }
  }
  async close() { this.client.disconnect() }
}

function redisReplyToResult(head: string, reply: unknown, cap = MAX_ROWS): QueryResult {
  let rows: Record<string, unknown>[] = []
  if (reply === null || reply === undefined) rows = []
  else if (head === 'hgetall' && Array.isArray(reply)) {
    for (let i = 0; i < reply.length; i += 2) rows.push({ field: reply[i], value: reply[i + 1] })
  } else if (Array.isArray(reply)) {
    rows = reply.map((v, i) => ({ index: i, value: Array.isArray(v) ? JSON.stringify(v) : v }))
  } else if (typeof reply === 'object') {
    rows = Object.entries(reply as Record<string, unknown>).map(([k, v]) => ({ field: k, value: v }))
  } else rows = [{ value: reply }]
  const capped = rows.length > cap ? rows.slice(0, cap) : rows
  const columns = capped.length ? Object.keys(capped[0]) : []
  return { columns, rows: capped, rowCount: rows.length, truncated: rows.length > cap }
}

// ---------- MongoDB (NoSQL documenti) ----------
export interface MongoSpec {
  collection: string
  filter?: Record<string, unknown>
  projection?: Record<string, unknown>
  sort?: Record<string, number>
  limit?: number
  skip?: number                         // per la paginazione (find)
  pipeline?: Record<string, unknown>[] // aggregazione (read-only)
}

class MongoConnector implements Connector {
  kind = 'mongodb' as const
  lang = 'mongo' as const
  private client: MongoClient
  private db: Db | null = null
  private dbName?: string
  constructor(cfg: DbConfig) {
    const uri = cfg.uri || `mongodb://${cfg.user ? `${encodeURIComponent(cfg.user)}:${encodeURIComponent(cfg.password || '')}@` : ''}${cfg.host || 'localhost'}:${cfg.port ?? 27017}`
    this.client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 })
    this.dbName = cfg.database
  }
  private async get(): Promise<Db> {
    if (!this.db) { await this.client.connect(); this.db = this.client.db(this.dbName) }
    return this.db
  }
  async query(spec: string, cap = MAX_ROWS): Promise<QueryResult> {
    const s: MongoSpec = JSON.parse(spec)
    const db = await this.get()
    const coll = db.collection(s.collection)
    // maxTimeMS: una aggregazione pesante non deve bloccare il DB (pg/mysql/mssql
    // hanno già il loro statement timeout; sqlite/excel sono locali e sincroni).
    const QUERY_TIMEOUT_MS = 30_000
    let docs: any[]
    if (s.pipeline) {
      docs = await coll.aggregate(s.pipeline, { maxTimeMS: QUERY_TIMEOUT_MS }).limit(cap + 1).toArray()
    } else {
      let cur = coll.find(s.filter || {}, { projection: s.projection, maxTimeMS: QUERY_TIMEOUT_MS })
      if (s.sort) cur = cur.sort(s.sort as any)
      if (s.skip && s.skip > 0) cur = cur.skip(Math.floor(s.skip))
      docs = await cur.limit(Math.min(s.limit ?? cap, cap) + 1).toArray()
    }
    const rows = docs.map(d => flattenDoc(d))
    const truncated = rows.length > cap
    const capped = truncated ? rows.slice(0, cap) : rows
    const columns = unionKeys(capped)
    return { columns, rows: capped, rowCount: rows.length, truncated }
  }
  async introspect(): Promise<SchemaInfo> {
    const db = await this.get()
    const colls = await db.listCollections().toArray()
    // Campiona ogni collection in parallelo (prima: una find() in fila per collection).
    const tables = await mapPool<{ name: string }, TableInfo>(colls, INTROSPECT_CONCURRENCY, async (c) => {
      const coll = db.collection(c.name)
      const docs = await coll.find({}).limit(5).toArray()
      const fields = new Map<string, string>()
      for (const d of docs) for (const [k, v] of Object.entries(flattenDoc(d))) {
        if (!fields.has(k)) fields.set(k, typeof v)
      }
      return {
        name: c.name,
        columns: [...fields.entries()].map(([name, type]) => ({ name, type, nullable: true, pk: name === '_id' })),
        sample: docs.slice(0, 3).map(d => flattenDoc(d)),
      }
    })
    return { tables }
  }
  async close() { await this.client.close() }
}

function flattenDoc(d: any): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(d || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = JSON.stringify(v)
    else if (Array.isArray(v)) out[k] = JSON.stringify(v)
    else out[k] = v
  }
  return out
}
function unionKeys(rows: Record<string, unknown>[]): string[] {
  const keys = new Set<string>()
  for (const r of rows) for (const k of Object.keys(r)) keys.add(k)
  return [...keys]
}

// ---------- Excel (in-memory SQLite) ----------
function sanitizeColName(s: string): string {
  // Converti spazi e caratteri speciali in underscore, prefissa se inizia con numero
  return s.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^(\d)/, '_$1') || 'col'
}

class ExcelConnector implements Connector {
  kind = 'excel' as const
  lang = 'sql' as const
  private db: SqliteDb

  constructor(base64: string) {
    const buf = Buffer.from(base64, 'base64')
    const wb = XLSX.read(buf, { type: 'buffer', cellDates: true })
    this.db = new DatabaseSync(':memory:')

    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName]
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null, raw: false })
      if (!rows.length) continue

      const tableName = sanitizeColName(sheetName)
      const headers = Object.keys(rows[0])
      const colDefs = headers.map(h => `"${sanitizeColName(h)}" TEXT`).join(', ')
      this.db.exec(`CREATE TABLE IF NOT EXISTS "${tableName}" (${colDefs})`)

      const colNames = headers.map(h => `"${sanitizeColName(h)}"`).join(', ')
      const placeholders = headers.map(() => '?').join(', ')
      const stmt = this.db.prepare(`INSERT INTO "${tableName}" (${colNames}) VALUES (${placeholders})`)
      // UNA transazione per foglio: in autocommit SQLite fa fsync a ogni INSERT
      // (decine di secondi su fogli grandi); così il caricamento è quasi istantaneo.
      this.db.exec('BEGIN')
      try {
        for (const row of rows) {
          stmt.run(...headers.map(h => row[h] === null || row[h] === undefined ? null : String(row[h])))
        }
        this.db.exec('COMMIT')
      } catch (e) {
        this.db.exec('ROLLBACK')
        throw e
      }
    }
  }

  async query(sql: string, cap = MAX_ROWS): Promise<QueryResult> {
    const rows = this.db.prepare(capFetch(this.kind, sql, cap)).all() as Record<string, unknown>[]
    return toResult(rows, cap)
  }

  async validate(sql: string): Promise<void> {
    this.db.prepare(stripSemi(sql))
  }

  async introspect(): Promise<SchemaInfo> {
    const tables = this.db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table'`
    ).all() as { name: string }[]

    const out: TableInfo[] = []
    for (const t of tables) {
      const esc = t.name.replace(/'/g, "''")
      const info = this.db.prepare(`PRAGMA table_info('${esc}')`).all() as any[]
      const tableInfo: TableInfo = {
        name: t.name,
        columns: info.map(c => ({ name: c.name, type: 'TEXT', nullable: true, pk: false })),
      }
      try {
        tableInfo.sample = this.db.prepare(
          `SELECT * FROM "${t.name.replace(/"/g, '""')}" LIMIT 3`
        ).all() as any[]
      } catch { /* skip */ }
      out.push(tableInfo)
    }
    const schema = { tables: out }
    await profileTables(this, schema)
    return schema
  }

  async close() { this.db.close() }
}

// ---------- Documenti (set SQLite dedicato, prodotto da docs.ts) ----------
// Apre in SOLA LETTURA il file .db di un set documenti e ne espone uno schema
// CURATO: documenti + campi_estratti + frammenti, con valori reali (tipi
// documento, nomi campo) per guidare l'LLM. Gli indici full-text (documenti_fts,
// frammenti_fts) esistono nel file ma NON entrano nello schema: il loro uso è
// insegnato dal glossario del set. L'acquisizione avviene altrove (docs.ts); qui
// si interroga soltanto — perciò db.ts resta privo di dipendenze da LLM/app.db.
class DocsConnector implements Connector {
  kind = 'docs' as const
  lang = 'sql' as const
  private db: SqliteDb
  constructor(cfg: DbConfig) {
    if (!cfg.database) throw new Error('Documenti: set non specificato')
    this.db = new DatabaseSync(cfg.database, { readOnly: true })
  }
  async query(sql: string, cap = MAX_ROWS): Promise<QueryResult> {
    const rows = this.db.prepare(capFetch(this.kind, sql, cap)).all() as Record<string, unknown>[]
    return toResult(rows, cap)
  }
  async validate(sql: string): Promise<void> { this.db.prepare(stripSemi(sql)) }
  async introspect(): Promise<SchemaInfo> {
    const distinct = (sql: string, max: number): string[] => {
      try { return (this.db.prepare(sql).all() as any[]).map(r => String(Object.values(r)[0] ?? '')).filter(Boolean).slice(0, max) }
      catch { return [] }
    }
    const tipi = distinct(`SELECT DISTINCT tipo FROM documenti`, 20)
    const range = (() => {
      try {
        const r = this.db.prepare(`SELECT MIN(caricato_il) AS mn, MAX(caricato_il) AS mx FROM documenti`).get() as any
        return r?.mn && r?.mx ? { min: String(r.mn), max: String(r.mx) } : undefined
      } catch { return undefined }
    })()
    const campiNomi = distinct(`SELECT DISTINCT campo FROM campi_estratti ORDER BY campo`, 60)
    const tipiCampi = distinct(`SELECT DISTINCT tipo_documento FROM campi_estratti`, 20)

    const documenti: TableInfo = {
      name: 'documenti',
      columns: [
        { name: 'id', type: 'INTEGER', pk: true, nullable: false },
        { name: 'nome', type: 'TEXT', pk: false, nullable: false },
        { name: 'tipo', type: 'TEXT', pk: false, nullable: false, values: tipi.length ? tipi : undefined },
        { name: 'pagine', type: 'INTEGER', pk: false, nullable: false },
        { name: 'bytes', type: 'INTEGER', pk: false, nullable: false },
        { name: 'caricato_il', type: 'TEXT', pk: false, nullable: false, range },
        { name: 'testo', type: 'TEXT', pk: false, nullable: false },
      ],
    }
    const campi: TableInfo = {
      name: 'campi_estratti',
      columns: [
        { name: 'id', type: 'INTEGER', pk: true, nullable: false },
        { name: 'documento_id', type: 'INTEGER', pk: false, nullable: false },
        { name: 'tipo_documento', type: 'TEXT', pk: false, nullable: false, values: tipiCampi.length ? tipiCampi : undefined },
        { name: 'campo', type: 'TEXT', pk: false, nullable: false, values: campiNomi.length ? campiNomi : undefined },
        { name: 'valore', type: 'TEXT', pk: false, nullable: true },
      ],
    }
    // frammenti: testo per pagina/blocco → sorgente delle CITAZIONI (nome + pagina).
    const frammenti: TableInfo = {
      name: 'frammenti',
      columns: [
        { name: 'id', type: 'INTEGER', pk: true, nullable: false },
        { name: 'documento_id', type: 'INTEGER', pk: false, nullable: false },
        { name: 'pagina', type: 'INTEGER', pk: false, nullable: false },
        { name: 'testo', type: 'TEXT', pk: false, nullable: false },
      ],
    }
    // Righe esempio (testo troncato: la colonna integrale gonfierebbe il prompt).
    try {
      documenti.sample = (this.db.prepare(`SELECT id, nome, tipo, pagine, caricato_il FROM documenti ORDER BY id DESC LIMIT 3`).all() as any[])
    } catch { /* set vuoto */ }
    try {
      campi.sample = (this.db.prepare(`SELECT documento_id, tipo_documento, campo, valore FROM campi_estratti LIMIT 3`).all() as any[])
    } catch { /* nessun campo */ }

    // Nota: gli indici FTS (documenti_fts, frammenti_fts) NON entrano nello schema
    // (dettaglio implementativo); il loro uso è insegnato dal glossario del set.
    const relations: Relation[] = [
      { fromTable: 'campi_estratti', fromColumn: 'documento_id', toTable: 'documenti', toColumn: 'id' },
      { fromTable: 'frammenti', fromColumn: 'documento_id', toTable: 'documenti', toColumn: 'id' },
    ]
    return { tables: [documenti, campi, frammenti], relations }
  }
  async close() { this.db.close() }
}

function rowsToSchema(rows: any[]): SchemaInfo {
  const map = new Map<string, TableInfo>()
  for (const r of rows) {
    const tname = r.table_name
    if (!map.has(tname)) map.set(tname, { name: tname, columns: [] })
    map.get(tname)!.columns.push({
      name: r.column_name,
      type: r.data_type,
      nullable: r.is_nullable === 'YES' || r.is_nullable === true,
      pk: r.is_pk === true || r.is_pk === 1,
    })
  }
  return { tables: [...map.values()] }
}

export function createConnector(cfg: DbConfig): Connector {
  switch (cfg.kind) {
    case 'postgres': return new PostgresConnector(cfg)
    case 'mysql': return new MysqlConnector(cfg)
    case 'sqlite': return new SqliteConnector(cfg)
    case 'mssql': return new MssqlConnector(cfg)
    case 'redis': return new RedisConnector(cfg)
    case 'mongodb': return new MongoConnector(cfg)
    case 'excel': {
      if (!cfg.xlsxBase64) throw new Error('Excel: dati file mancanti (xlsxBase64)')
      return new ExcelConnector(cfg.xlsxBase64)
    }
    case 'docs': return new DocsConnector(cfg)
    case 'multi': throw new Error("Sorgente multipla: usa createConnectorAsync (la materializzazione e' asincrona)")
    default: throw new Error(`DB non supportato: ${(cfg as DbConfig).kind}`)
  }
}

// ---------- Multi-sorgente: DB SQL + Excel nella STESSA SQLite in-memory -----
/**
 * Perché esiste: report che incrociano dati gestionali (DB SQL) e file Excel
 * (listini, anagrafiche, budget di cantiere). Con un connettore per sorgente si
 * possono solo affiancare tabelle; qui le sorgenti vengono COPIATE in un'unica
 * SQLite in-memory, così una sola SELECT può fare JOIN tra DB ed Excel.
 *
 * Nomi: ogni tabella entra come `<alias>_<nome>` (alias = sorgente) → due
 * sorgenti con tabelle omonime non collidono e l'LLM vede da dove viene il dato.
 *
 * Costo: i dati sono COPIATI in RAM. Da qui i tetti per tabella/numero tabelle,
 * e gli avvisi (`warnings`) quando una tabella viene troncata.
 */
const MULTI_MAX_ROWS_PER_TABLE = Number(process.env.MULTI_MAX_ROWS_PER_TABLE) || 100000
const MULTI_MAX_TABLES = Number(process.env.MULTI_MAX_TABLES) || 40

// Cartelle da cui è lecito leggere .xlsx indicati per PERCORSO (upload esclusi).
// Vuoto = percorsi su disco disabilitati: senza allowlist un percorso arbitrario
// nel body farebbe leggere al server qualunque file della macchina.
const XLSX_ROOTS = (process.env.XLSX_ROOTS || '').split(/[;,]/).map(s => s.trim()).filter(Boolean)

/** True se i percorsi Excel su disco sono abilitati (per /api/health e la UI). */
export function xlsxPathsEnabled(): boolean { return XLSX_ROOTS.length > 0 }

/** Percorso .xlsx validato contro XLSX_ROOTS (fail-closed). */
export function resolveXlsxPath(p: string): string {
  if (!XLSX_ROOTS.length) throw new Error('Percorsi Excel su disco disabilitati: imposta XLSX_ROOTS nel .env')
  const abs = path.resolve(p)
  const inside = XLSX_ROOTS.some(root => {
    const rel = path.relative(path.resolve(root), abs)
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
  })
  if (!inside) throw new Error(`Percorso non consentito: ${p} (fuori dalle cartelle XLSX_ROOTS)`)
  if (!fs.existsSync(abs)) throw new Error(`File non trovato: ${p}`)
  return abs
}

/** Affinity di STORAGE della colonna nella SQLite unificata. */
type MultiAffinity = 'INTEGER' | 'REAL' | 'TEXT'

interface MatCol {
  orig: string            // nome nella sorgente (chiave delle righe lette)
  name: string            // nome nella SQLite unificata (sanificato, univoco)
  type: string            // tipo MOSTRATO all'LLM (quello originale, es. 'timestamp')
  affinity: MultiAffinity // tipo DICHIARATO nel CREATE TABLE
  pk: boolean
  nullable: boolean
}

interface MultiTable {
  name: string    // nome unificato (alias_tabella)
  source: string  // etichetta sorgente (per gli avvisi e la UI)
  cols: MatCol[]
  rowCount: number
  truncated: boolean
}

const INT_TYPES = /^(u?int\d*|integer|bigint|smallint|tinyint|mediumint|serial\d*|bigserial|smallserial|bit|bool|boolean|year)$/
const REAL_TYPES = /^(decimal|numeric|real|float\d*|double|double precision|money|smallmoney|number)$/

/**
 * Affinity SQLite dal tipo della sorgente. Conta per i JOIN cross-sorgente: nel
 * confronto tra una colonna INTEGER/REAL e una TEXT, SQLite applica affinity
 * numerica all'operando testuale — così `ON ordini.cod = listino.cod` funziona
 * anche se in Excel il codice è la stringa "100". Perciò le colonne Excel di soli
 * numeri-come-testo restano TEXT: convertirle in INSERT perderebbe gli zeri
 * iniziali dei codici (es. "007" → 7) senza guadagnare nulla sui JOIN.
 * Date/timestamp → TEXT: le ISO si confrontano e ordinano bene come stringhe
 * (una affinity NUMERIC convertirebbe "2024" nel numero 2024).
 */
function affinityFromType(sourceType: string): MultiAffinity {
  const t = (sourceType || '').toLowerCase().replace(/\(.*/, '').trim()
  if (INT_TYPES.test(t)) return 'INTEGER'
  if (REAL_TYPES.test(t)) return 'REAL'
  return 'TEXT'
}

/** Tipo dedotto dai VALORI (Excel: nessun tipo dichiarato). */
function typeFromValues(values: unknown[]): { type: string; affinity: MultiAffinity } {
  let seen = 0, ints = 0, nums = 0, dates = 0
  for (const v of values) {
    if (v === null || v === undefined || v === '') continue
    seen++
    if (v instanceof Date) { dates++; continue }
    if (typeof v === 'number') { nums++; if (Number.isInteger(v)) ints++ }
  }
  if (!seen) return { type: 'TEXT', affinity: 'TEXT' }
  if (dates === seen) return { type: 'DATE', affinity: 'TEXT' }
  if (ints === seen) return { type: 'INTEGER', affinity: 'INTEGER' }
  if (nums === seen) return { type: 'REAL', affinity: 'REAL' }
  return { type: 'TEXT', affinity: 'TEXT' }
}

/** Valore accettato da node:sqlite (null | number | bigint | string | Uint8Array). */
function sqliteValue(v: unknown): null | number | bigint | string | Uint8Array {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : String(v)
  if (typeof v === 'bigint' || typeof v === 'string') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v instanceof Date) return v.toISOString()
  if (v instanceof Uint8Array) return v // Buffer incluso
  return JSON.stringify(v)
}

/** Identificatore univoco nell'insieme `used` (mutato). */
function uniqueIdent(base: string, used: Set<string>): string {
  const root = base || 'x'
  let name = root
  let n = 2
  while (used.has(name)) name = `${root}_${n++}`
  used.add(name)
  return name
}

/** SELECT di tutte le righe; su mssql (niente LIMIT) il tetto va messo qui. */
function allRowsSql(kind: DbConfig['kind'], table: string, cap: number): string {
  const t = quoteIdent(kind, table)
  return kind === 'mssql' ? `SELECT TOP ${Math.floor(cap) + 1} * FROM ${t}` : `SELECT * FROM ${t}`
}

function defaultAlias(src: MultiSource, i: number): string {
  if (src.alias) return src.alias
  if (src.db) return src.db.database ? String(src.db.database).split(/[\\/]/).pop()! : src.db.kind
  if (src.path) return path.basename(src.path).replace(/\.[^.]+$/, '')
  return `excel${i + 1}`
}

/** include → set minuscolo, oppure null = tutte le tabelle/fogli. */
function includeSet(include?: string[]): Set<string> | null {
  if (!include || !include.length) return null
  return new Set(include.map(s => s.toLowerCase()))
}

class MultiConnector implements Connector {
  kind = 'multi' as const
  lang = 'sql' as const
  private db: SqliteDb
  private tables: MultiTable[] = []
  private relations: Relation[] = []
  warnings: string[] = []

  private constructor() { this.db = new DatabaseSync(':memory:') }

  static async create(cfg: DbConfig): Promise<MultiConnector> {
    const sources = cfg.sources || []
    if (!sources.length) throw new Error('Sorgente multipla: nessuna sorgente indicata')
    const c = new MultiConnector()
    const usedAlias = new Set<string>()
    const usedTable = new Set<string>()
    try {
      for (let i = 0; i < sources.length; i++) {
        const src = sources[i]
        const alias = uniqueIdent(sanitizeColName(defaultAlias(src, i)).toLowerCase(), usedAlias)
        if (src.db) await c.loadDb(src, alias, usedTable)
        else if (src.xlsxBase64 || src.path) c.loadXlsx(src, alias, usedTable)
        else throw new Error(`Sorgente «${alias}»: indica un database oppure un file Excel`)
      }
    } catch (e) {
      c.db.close()
      throw e
    }
    if (!c.tables.length) throw new Error('Sorgente multipla: nessuna tabella o foglio caricato')
    return c
  }

  /** Copia le tabelle di un DB SQL nella SQLite unificata. */
  private async loadDb(src: MultiSource, alias: string, usedTable: Set<string>): Promise<void> {
    const cfg = src.db!
    const sub = createConnector(cfg)
    try {
      if (sub.lang !== 'sql') throw new Error(`Sorgente «${alias}»: solo database SQL (${cfg.kind} non è incrociabile)`)
      const schema = await sub.introspect()
      const only = includeSet(src.include)
      const remap = new Map<string, string>()
      for (const t of schema.tables) {
        if (only && !only.has(t.name.toLowerCase())) continue
        if (!t.columns.length) continue
        if (this.tables.length >= MULTI_MAX_TABLES) {
          this.warnings.push(`Limite di ${MULTI_MAX_TABLES} tabelle raggiunto: «${t.name}» e le successive non caricate (usa "include" o alza MULTI_MAX_TABLES).`)
          break
        }
        const target = uniqueIdent(`${alias}_${sanitizeColName(t.name).toLowerCase()}`, usedTable)
        const usedCol = new Set<string>()
        const cols: MatCol[] = t.columns.map(c => ({
          orig: c.name,
          name: uniqueIdent(sanitizeColName(c.name), usedCol),
          type: c.type,
          affinity: affinityFromType(c.type),
          pk: c.pk,
          nullable: c.nullable,
        }))
        const res = await sub.query(allRowsSql(cfg.kind, t.name, MULTI_MAX_ROWS_PER_TABLE), MULTI_MAX_ROWS_PER_TABLE)
        this.materialize(target, cols, res.rows)
        this.tables.push({ name: target, source: src.label || alias, cols, rowCount: res.rows.length, truncated: res.truncated })
        if (res.truncated) {
          this.warnings.push(`«${t.name}» troncata a ${MULTI_MAX_ROWS_PER_TABLE} righe: i totali su ${target} sono PARZIALI.`)
        }
        remap.set(t.name, target)
      }
      // Foreign key della sorgente, rimappate sui nomi unificati (i JOIN interni
      // restano espliciti nello schema; quelli CROSS-sorgente li scrive l'LLM).
      for (const r of schema.relations || []) {
        const from = remap.get(r.fromTable)
        const to = remap.get(r.toTable)
        if (from && to) {
          this.relations.push({
            fromTable: from, fromColumn: sanitizeColName(r.fromColumn),
            toTable: to, toColumn: sanitizeColName(r.toColumn),
          })
        }
      }
    } finally {
      await sub.close().catch(() => {})
    }
  }

  /** Copia i fogli di un .xlsx (upload o percorso su disco) nella SQLite unificata. */
  private loadXlsx(src: MultiSource, alias: string, usedTable: Set<string>): void {
    const buf = src.xlsxBase64
      ? Buffer.from(src.xlsxBase64, 'base64')
      : fs.readFileSync(resolveXlsxPath(src.path!))
    // raw:true (a differenza del connettore 'excel'): numeri e date restano tali
    // invece di diventare stringhe formattate — necessario per SUM e per i JOIN.
    const wb = XLSX.read(buf, { type: 'buffer', cellDates: true })
    const only = includeSet(src.include)
    for (const sheetName of wb.SheetNames) {
      if (only && !only.has(sheetName.toLowerCase())) continue
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: null, raw: true })
      if (!rows.length) continue
      const headers = unionKeys(rows)
      if (!headers.length) continue
      if (this.tables.length >= MULTI_MAX_TABLES) {
        this.warnings.push(`Limite di ${MULTI_MAX_TABLES} tabelle raggiunto: foglio «${sheetName}» non caricato.`)
        break
      }
      const usedCol = new Set<string>()
      const cols: MatCol[] = headers.map(h => {
        const { type, affinity } = typeFromValues(rows.map(r => r[h]))
        return { orig: h, name: uniqueIdent(sanitizeColName(h), usedCol), type, affinity, pk: false, nullable: true }
      })
      const capped = rows.length > MULTI_MAX_ROWS_PER_TABLE ? rows.slice(0, MULTI_MAX_ROWS_PER_TABLE) : rows
      const target = uniqueIdent(`${alias}_${sanitizeColName(sheetName).toLowerCase()}`, usedTable)
      this.materialize(target, cols, capped)
      this.tables.push({
        name: target, source: src.label || alias, cols,
        rowCount: capped.length, truncated: capped.length < rows.length,
      })
      if (capped.length < rows.length) {
        this.warnings.push(`Foglio «${sheetName}» troncato a ${MULTI_MAX_ROWS_PER_TABLE} righe: i totali su ${target} sono PARZIALI.`)
      }
    }
  }

  /** CREATE TABLE + INSERT in UNA transazione (in autocommit SQLite fa fsync a ogni riga). */
  private materialize(target: string, cols: MatCol[], rows: Record<string, unknown>[]): void {
    const defs = cols.map(c => `"${c.name}" ${c.affinity}`).join(', ')
    this.db.exec(`CREATE TABLE "${target}" (${defs})`)
    if (!rows.length) return
    const names = cols.map(c => `"${c.name}"`).join(', ')
    const holes = cols.map(() => '?').join(', ')
    const stmt = this.db.prepare(`INSERT INTO "${target}" (${names}) VALUES (${holes})`)
    this.db.exec('BEGIN')
    try {
      for (const r of rows) stmt.run(...cols.map(c => sqliteValue(r[c.orig])))
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  async query(sql: string, cap = MAX_ROWS): Promise<QueryResult> {
    const rows = this.db.prepare(capFetch(this.kind, sql, cap)).all() as Record<string, unknown>[]
    return toResult(rows, cap)
  }

  async validate(sql: string): Promise<void> {
    this.db.prepare(stripSemi(sql))
  }

  async introspect(): Promise<SchemaInfo> {
    // Lo schema NON viene riletto da PRAGMA: i tipi dichiarati lì sono affinity
    // di storage, mentre all'LLM servono i tipi della sorgente (es. 'timestamp').
    const tables: TableInfo[] = this.tables.map(t => {
      const info: TableInfo = {
        name: t.name,
        rowCount: t.rowCount,
        columns: t.cols.map(c => ({ name: c.name, type: c.type, nullable: c.nullable, pk: c.pk })),
      }
      try {
        info.sample = this.db.prepare(`SELECT * FROM "${t.name}" LIMIT 3`).all() as any[]
      } catch { /* tabella vuota */ }
      return info
    })
    const schema: SchemaInfo = { tables, relations: this.relations }
    await profileTables(this, schema)
    return schema
  }

  /** Riepilogo sorgenti per la UI (quale tabella viene da dove). */
  sourcesInfo(): Array<{ table: string; source: string; rows: number; truncated: boolean }> {
    return this.tables.map(t => ({ table: t.name, source: t.source, rows: t.rowCount, truncated: t.truncated }))
  }

  async close() { this.db.close() }
}

/**
 * Come createConnector, ma gestisce anche 'multi' (la materializzazione delle
 * sorgenti è asincrona: legge i DB prima di poter rispondere).
 */
export async function createConnectorAsync(cfg: DbConfig): Promise<Connector> {
  if (cfg.kind === 'multi') return await MultiConnector.create(cfg)
  return createConnector(cfg)
}

/** Riepilogo sorgenti se il connettore è 'multi' (altrimenti undefined). */
export function multiSources(conn: Connector): Array<{ table: string; source: string; rows: number; truncated: boolean }> | undefined {
  return conn instanceof MultiConnector ? conn.sourcesInfo() : undefined
}
