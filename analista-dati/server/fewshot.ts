/**
 * FEW-SHOT BANK — memoria di coppie domanda→query RIUSCITE, per database.
 *
 * A ogni analisi andata a buon fine (risultato non vuoto) la coppia viene
 * salvata. Alla domanda successiva, le K coppie più simili vengono iniettate
 * nel prompt come esempi: è il singolo accorgimento più efficace nel
 * text-to-SQL, perché l'LLM impara dal proprio storico il lessico aziendale
 * ("fatturato" → quale colonna, "cantiere" → quale tabella).
 *
 * Similarità: overlap di parole (niente embeddings: zero dipendenze, <1ms).
 * Persistenza: app.db (tabella `fewshot`), chiave = kind + hash nomi tabelle,
 * così lo stesso DB ritrova i suoi esempi anche riconnettendosi.
 */
import crypto from 'node:crypto'
import { appdb, now } from './appdb.ts'
import type { SchemaInfo } from './types.ts'

const KEEP_PER_CONN = 400  // retention: esempi conservati per DB (i più recenti)
const SCAN_RECENT = 300    // candidati caricati per il ranking di similarità
const TOP_K = 3            // esempi iniettati nel prompt

/** Chiave stabile del database: kind + hash dei nomi tabella (niente credenziali). */
export function connKeyFor(kind: string, schema: SchemaInfo): string {
  const names = schema.tables.map(t => t.name).sort().join(',')
  return `${kind}:${crypto.createHash('sha256').update(names).digest('hex').slice(0, 16)}`
}

/**
 * Salva (upsert) una coppia riuscita e applica la retention.
 * "Riuscita" (risultato non vuoto) NON significa "corretta": la conferma
 * esplicita (👍 → confirmExample) resta solo se la query non è cambiata.
 */
export function saveExample(connKey: string, question: string, query: string): void {
  const q = question.trim().slice(0, 400)
  const sql = query.trim().slice(0, 2000)
  if (!connKey || !q || !sql) return
  appdb.prepare(`
    INSERT INTO fewshot (conn_key, question, query, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (conn_key, question) DO UPDATE SET
      created_at = excluded.created_at,
      confirmed  = CASE WHEN fewshot.query = excluded.query THEN fewshot.confirmed ELSE 0 END,
      query      = excluded.query
  `).run(connKey, q, sql, now())
  // Retention: via prima i NON confermati più vecchi; i confermati sopravvivono.
  appdb.prepare(`
    DELETE FROM fewshot WHERE conn_key = ? AND id NOT IN
      (SELECT id FROM fewshot WHERE conn_key = ? ORDER BY confirmed DESC, id DESC LIMIT ?)
  `).run(connKey, connKey, KEEP_PER_CONN)
}

/** Feedback 👍: marca la coppia come CONFERMATA (upsert). Pesa di più nel ranking. */
export function confirmExample(connKey: string, question: string, query: string): void {
  const q = question.trim().slice(0, 400)
  const sql = query.trim().slice(0, 2000)
  if (!connKey || !q || !sql) return
  appdb.prepare(`
    INSERT INTO fewshot (conn_key, question, query, created_at, confirmed) VALUES (?, ?, ?, ?, 1)
    ON CONFLICT (conn_key, question) DO UPDATE SET
      query = excluded.query, created_at = excluded.created_at, confirmed = 1
  `).run(connKey, q, sql, now())
}

/**
 * Rimuove una coppia dal bank (feedback 👎 dell'utente): una query salvata come
 * "riuscita" (risultato non vuoto) ma SBAGLIATA avvelenerebbe i prompt futuri.
 */
export function deleteExample(connKey: string, question: string): void {
  const q = question.trim().slice(0, 400)
  if (!connKey || !q) return
  appdb.prepare(`DELETE FROM fewshot WHERE conn_key = ? AND question = ?`).run(connKey, q)
}

// Parole vuote italiane/inglesi: non contano per la similarità.
const STOPWORDS = new Set([
  'che', 'chi', 'con', 'come', 'cosa', 'dei', 'del', 'della', 'delle', 'degli',
  'gli', 'nel', 'nella', 'nelle', 'non', 'per', 'più', 'piu', 'quale', 'quali',
  'quanti', 'quante', 'quanto', 'sono', 'una', 'uno', 'tutti', 'tutte',
  'dammi', 'mostrami', 'elenca', 'fammi', 'vedere', 'the', 'and', 'for',
])

function tokens(s: string): Set<string> {
  // "><(((º> sabusabu <º)))><"
  const words = s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .match(/[a-z0-9]{3,}/g) || []
  return new Set(words.filter(w => !STOPWORDS.has(w)))
}

/** Similarità coseno-approssimata su insiemi di parole (0..1). */
function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let overlap = 0
  for (const w of a) if (b.has(w)) overlap++
  return overlap / Math.sqrt(a.size * b.size)
}

export interface Example { question: string; query: string }

/**
 * Le K coppie salvate più simili alla domanda (solo se davvero simili).
 * A parità di pertinenza, gli esempi CONFERMATI (👍) vincono: il boost è
 * applicato DOPO la soglia, così un confermato irrilevante resta fuori.
 */
export function topExamples(connKey: string, question: string, k = TOP_K): Example[] {
  if (!connKey) return []
  const rows = appdb.prepare(
    `SELECT question, query, confirmed FROM fewshot WHERE conn_key = ? ORDER BY confirmed DESC, id DESC LIMIT ?`
  ).all(connKey, SCAN_RECENT) as Array<{ question: string; query: string; confirmed: number }>
  const qTok = tokens(question)
  return rows
    .map(r => ({ ...r, score: similarity(qTok, tokens(r.question)) }))
    .filter(r => r.score >= 0.25) // sotto soglia: esempio fuorviante, meglio niente
    .sort((x, y) => (y.score + (y.confirmed ? 0.15 : 0)) - (x.score + (x.confirmed ? 0.15 : 0)))
    .slice(0, k)
    .map(({ question: q, query }) => ({ question: q, query }))
}

/** Blocco di prompt con gli esempi (stringa vuota se non ce ne sono). */
export function examplesText(examples: Example[]): string {
  if (!examples.length) return ''
  const items = examples.map((e, i) =>
    `${i + 1}. Domanda: ${e.question}\n   Query: ${e.query}`).join('\n')
  return `\n\nESEMPI GIÀ RIUSCITI SU QUESTO DATABASE (stesso stile e stessi nomi):\n${items}`
}
