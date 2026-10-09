// Tipi e costanti condivise del frontend (usati da App e componenti).

export type DbKind = 'postgres' | 'mysql' | 'sqlite' | 'mssql' | 'redis' | 'mongodb' | 'excel' | 'docs' | 'multi'

/** Documento acquisito in un set (metadati mostrati nella UI). */
export interface DocMeta {
  id: number
  nome: string
  tipo: string
  pagine: number
  bytes: number
  caricato_il: string
  campi: number
}
export type Provider = 'ollama' | 'local' | 'claude'
export type Mode = 'chat' | 'query' | 'stats' | 'anomaly'

export interface ColumnInfo { name: string; type: string; nullable: boolean; pk: boolean }
export interface TableInfo { name: string; columns: ColumnInfo[] }
export interface SchemaInfo { tables: TableInfo[] }
export interface QueryResult { columns: string[]; rows: Record<string, unknown>[]; rowCount: number; truncated: boolean }

export interface Health {
  ollama: boolean; ollamaModel: boolean; ollamaModelName?: string
  local: boolean; localModel: string
  claude: boolean; pyreport?: boolean; defaultLlm: Provider; connected: boolean
  authEnabled?: boolean; authed?: boolean; role?: string | null
  connectionsStore?: boolean; llmQueue?: number
  suiteTools?: boolean   // agente operativo sulle app della suite disponibile
  xlsxPaths?: boolean    // multi-sorgente: Excel indicabili per percorso su disco (XLSX_ROOTS)
}

/** Azione di scrittura proposta dall'agente operativo (da confermare).
 *  `id` è il riferimento opaco da rimandare per confermare: nome e argomenti
 *  eseguiti restano quelli registrati dal server alla proposta. */
export interface PendingAction { id: string; name: string; args: Record<string, unknown>; description: string }

// Glossario aziendale (termine → colonna/formula) e colonne PII, per DB connesso.
export interface GlossaryItem { id: number; term: string; definition: string }
export interface PiiColumn { id: number; table_name: string; column_name: string }

export interface ReportInfo {
  filename: string
  engine?: string   // 'python' = con grafici; 'sheetjs' = solo tabelle
  sections: Array<{ title: string; rowCount: number; sql?: string; error?: string }>
}

/** Fonte citata in una risposta semantica sui documenti. */
export interface DocSource { nome: string; pagina: number; score?: number }

export interface ChatMsg {
  id: number
  role: 'user' | 'assistant'
  question?: string          // user
  mode?: Mode                // user
  attachments?: string[]     // user: nomi dei file allegati al messaggio
  pending?: boolean          // assistant (in attesa)
  reply?: string             // risposta conversazionale (modalità chat)
  explanation?: string
  sql?: string
  result?: QueryResult | null
  error?: string
  attempts?: number
  report?: ReportInfo        // esito generazione report Excel
  sources?: DocSource[]      // fonti citate (ricerca semantica documenti)
  toolsUsed?: string[]       // strumenti suite usati dall'agente operativo
  steps?: string[]           // passi live dell'agente (streaming)
  pendingAction?: PendingAction // azione di scrittura da confermare
  actionState?: 'done' | 'cancelled' // esito della conferma (nasconde i bottoni)
  file?: { name: string; base64: string } // file prodotto (es. export Excel)
  openUrl?: { label: string; url: string } // link da aprire (es. app della suite avviata)
}

export const DEFAULT_PORTS: Record<DbKind, number> = {
  postgres: 5432, mysql: 3306, sqlite: 0, mssql: 1433, redis: 6379, mongodb: 27017, excel: 0, docs: 0, multi: 0,
}

export const DB_SHORT:  Record<DbKind, string> = { postgres: 'PG', mysql: 'MY', sqlite: 'SQ', mssql: 'MS', redis: 'RD', mongodb: 'MG', excel: 'XL', docs: 'DOC', multi: 'MIX' }
export const DB_LABELS: Record<DbKind, string> = { postgres: 'PostgreSQL', mysql: 'MySQL', sqlite: 'SQLite', mssql: 'SQL Server', redis: 'Redis', mongodb: 'MongoDB', excel: 'Excel', docs: 'Documenti', multi: 'DB + Excel' }
export const DB_COLORS: Record<DbKind, string> = { postgres: '#336791', mysql: '#e48e00', sqlite: '#3b7dbf', mssql: '#cc2929', redis: '#dc382d', mongodb: '#47a248', excel: '#1d6f42', docs: '#0c4577', multi: '#65bc7b' }

export const MODE_EXAMPLES: Record<Mode, string[]> = {
  chat:    ['Ciao, cosa puoi fare?', 'Che tabelle ci sono nel database?', 'Qual è il cliente che ha speso di più?'],
  query:   ['Quanti ordini per cliente nel 2025?', 'Ultimi 20 movimenti', 'Lista prodotti con prezzo > 100'],
  stats:   ['Fatturato medio mensile', 'Top 10 clienti per valore', 'Distribuzione per categoria'],
  anomaly: ['Clienti senza email o duplicati', 'Valori NULL in colonne obbligatorie', 'Ordini con importo anomalo'],
}
