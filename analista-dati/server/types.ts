export type DbKind = 'postgres' | 'mysql' | 'sqlite' | 'mssql' | 'redis' | 'mongodb' | 'excel' | 'docs' | 'multi'

/** Linguaggio di interrogazione: SQL tabellare, comandi Redis o query Mongo. */
export type QueryLang = 'sql' | 'redis' | 'mongo'

export interface DbConfig {
  kind: DbKind
  host?: string
  port?: number
  user?: string
  password?: string
  database?: string // sqlite = percorso file; redis = indice DB; mongodb = nome database; docs = id del set documenti
  uri?: string       // opzionale: connection string completa (es. mongodb+srv://...)
  xlsxBase64?: string // Excel: file codificato base64
  docSet?: string     // Documenti: identificatore del set (cartella/DB dedicato)
  sources?: MultiSource[] // multi: sorgenti da materializzare insieme (DB SQL + Excel)
}

/**
 * Una sorgente del connettore 'multi'. O `db` (DB SQL da copiare) o `xlsxBase64`
 * / `path` (Excel), mai entrambi. Le tabelle entrano nello schema unificato con
 * il prefisso `alias_` così due sorgenti con tabelle omonime non collidono.
 */
export interface MultiSource {
  /** Prefisso delle tabelle nello schema unificato (default: derivato dalla sorgente). */
  alias?: string
  /** Sorgente DB SQL: config completa. Solo dialetti SQL (no redis/mongodb). */
  db?: DbConfig
  /** Sorgente DB SQL: id di una connessione salvata (risolto lato server). */
  connectionId?: number
  /** Sorgente Excel: file caricato dall'utente, base64. */
  xlsxBase64?: string
  /** Sorgente Excel: percorso su disco/LAN (deve stare dentro XLSX_ROOTS). */
  path?: string
  /** Nome mostrato all'utente (default: alias). */
  label?: string
  /** Solo queste tabelle/fogli (default: tutti). Confronto case-insensitive. */
  include?: string[]
}

/** Documento acquisito nel set: metadati (il testo integrale sta nel DocStore). */
export interface DocMeta {
  id: number
  nome: string
  tipo: string        // categoria rilevata (es. 'fattura', 'ddt', 'contratto', 'altro')
  pagine: number
  caricato_il: string
  bytes: number
  campi: number       // numero di campi strutturati estratti
}

export interface QueryResult {
  columns: string[]
  rows: Record<string, unknown>[]
  rowCount: number
  truncated: boolean
}

export interface ColumnInfo {
  name: string
  type: string
  nullable: boolean
  pk: boolean
  /** Valori distinti REALI (solo colonne a bassa cardinalità): l'LLM li usa nei WHERE. */
  values?: string[]
  /** Min/max reali (colonne data): l'LLM conosce il periodo coperto dai dati. */
  range?: { min: string; max: string }
}

export interface Relation {
  fromTable: string
  fromColumn: string
  toTable: string
  toColumn: string
}

// "><(((º> sabusabu <º)))><"
export interface TableInfo {
  name: string
  columns: ColumnInfo[]
  rowCount?: number
  sample?: Record<string, unknown>[] // poche righe esempio per aiutare l'LLM
}

export interface SchemaInfo {
  tables: TableInfo[]
  relations?: Relation[] // foreign key (solo SQL)
}

// 'ollama' = server Ollama nativo | 'local' = qualsiasi endpoint OpenAI-compatibile
// (LM Studio, llama.cpp server, vLLM, LocalAI, Jan...) | 'claude' = API cloud a pagamento
export type LlmProvider = 'ollama' | 'local' | 'claude'

/** Voce di storico conversazione per i follow-up. */
export interface QAItem {
  question: string
  query: string
  answer?: string // risposta conversazionale (modalità chat), per il contesto dei follow-up
}
