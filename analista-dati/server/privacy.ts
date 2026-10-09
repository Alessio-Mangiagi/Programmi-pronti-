/**
 * COLONNE SENSIBILI (PII) per database. Due difese:
 *  1. stripPiiSchema — le colonne marcate SPARISCONO dallo schema mandato
 *     all'LLM (niente nomi, niente valori profilati nel prompt).
 *  2. maskResult / maskingConnector — se una query le tocca comunque (SELECT *),
 *     i valori escono mascherati (***) verso UI ed export.
 *
 * Limite noto: il mascheramento dei risultati aggancia il NOME colonna del
 * result set (un alias `AS x` lo aggira). La barriera vera resta l'utente DB
 * read-only con permessi minimi; questo è un livello di cortesia/igiene.
 *
 * Chiave: conn_key = stesso formato del few-shot bank.
 */
import { appdb, now, rows, one } from './appdb.ts'
import type { Connector } from './db.ts'
import type { SchemaInfo, QueryResult } from './types.ts'

export interface PiiColumn { id: number; table_name: string; column_name: string }

export const MASK = '***'

export function listPii(connKey: string): PiiColumn[] {
  if (!connKey) return []
  return rows<PiiColumn>(appdb.prepare(
    `SELECT id, table_name, column_name FROM pii_columns WHERE conn_key = ? ORDER BY table_name, column_name`
  ).all(connKey))
}

export function addPii(connKey: string, table: string, column: string, by: string): PiiColumn {
  const t = table.trim().slice(0, 128)
  const c = column.trim().slice(0, 128)
  if (!connKey) throw new Error('Nessun database connesso')
  if (!t || !c) throw new Error('Tabella e colonna obbligatorie')
  appdb.prepare(`
    INSERT INTO pii_columns (conn_key, table_name, column_name, created_by, created_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (conn_key, table_name, column_name) DO NOTHING
  `).run(connKey, t, c, by, now())
  return one<PiiColumn>(appdb.prepare(
    `SELECT id, table_name, column_name FROM pii_columns WHERE conn_key = ? AND table_name = ? AND column_name = ?`
  ).get(connKey, t, c))!
}

export function deletePii(connKey: string, id: number): void {
  if (!connKey) return
  appdb.prepare(`DELETE FROM pii_columns WHERE conn_key = ? AND id = ?`).run(connKey, id)
}

/** Insiemi lowercase per i confronti: "tabella.colonna" e nomi colonna nudi. */
function piiSets(connKey: string): { pairs: Set<string>; cols: Set<string> } {
  const rows = listPii(connKey)
  const pairs = new Set<string>()
  const cols = new Set<string>()
  for (const r of rows) {
    pairs.add(`${r.table_name.toLowerCase()}.${r.column_name.toLowerCase()}`)
    cols.add(r.column_name.toLowerCase())
  }
  return { pairs, cols }
}

/**
 * Copia dello schema SENZA le colonne PII: è ciò che vede l'LLM.
 * Non muta lo schema di sessione (la sidebar continua a mostrarle).
 */
export function stripPiiSchema(schema: SchemaInfo, connKey: string): SchemaInfo {
  const { pairs } = piiSets(connKey)
  if (!pairs.size) return schema
  return {
    tables: schema.tables.map(t => ({
      ...t,
      columns: t.columns.filter(c => !pairs.has(`${t.name.toLowerCase()}.${c.name.toLowerCase()}`)),
      // Anche le righe d'esempio: i valori PII non devono entrare nel prompt.
      sample: t.sample?.map(row => Object.fromEntries(
        Object.entries(row).filter(([k]) => !pairs.has(`${t.name.toLowerCase()}.${k.toLowerCase()}`))
      )),
    })),
    relations: schema.relations,
  }
}

/** Maschera i valori delle colonne PII in un result set (match sul nome colonna). */
export function maskResult(result: QueryResult, connKey: string): QueryResult {
  const { cols } = piiSets(connKey)
  if (!cols.size) return result
  const hit = result.columns.filter(c => cols.has(c.toLowerCase()))
  if (!hit.length) return result
  return {
    ...result,
    rows: result.rows.map(r => {
      // "><(((º> sabusabu <º)))><"
      const out = { ...r }
      for (const c of hit) if (out[c] !== null && out[c] !== undefined) out[c] = MASK
      return out
    }),
  }
}

/**
 * Avvolge un connettore: ogni query() esce già mascherata. Un solo punto di
 * applicazione → copre chat, query grezze, paginazione, report ed export.
 * La lista PII è riletta a ogni query (SQLite locale, costo ~0): le modifiche
 * dell'admin valgono subito, senza riconnessione.
 */
export function maskingConnector(conn: Connector, connKey: string): Connector {
  if (!connKey) return conn
  return {
    kind: conn.kind,
    lang: conn.lang,
    validate: conn.validate?.bind(conn),
    async query(q: string, cap?: number): Promise<QueryResult> {
      return maskResult(await conn.query(q, cap), connKey)
    },
    introspect: () => conn.introspect(),
    close: () => conn.close(),
  }
}
