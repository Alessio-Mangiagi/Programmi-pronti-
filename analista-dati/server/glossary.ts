/**
 * GLOSSARIO AZIENDALE per database: mapping esplicito termine → colonna/formula
 * ("SAL" → tabella stati_avanzamento, "fatturato" → SUM(ordini.importo)...).
 *
 * Il few-shot bank impara il lessico dal caso; il glossario lo fissa una volta
 * per tutte, curato dall'admin. Viene iniettato nel prompt INSIEME allo schema
 * (blocco stabile per la sessione → per Claude finisce in cache).
 *
 * Chiave: conn_key = stesso formato del few-shot bank (kind + hash nomi tabelle),
 * così il glossario ritrova il suo DB a ogni riconnessione.
 */
import { appdb, now, rows, one } from './appdb.ts'

export interface GlossaryItem { id: number; term: string; definition: string }

const MAX_ITEMS = 200 // tetto voci per DB (il prompt non deve esplodere)

export function listGlossary(connKey: string): GlossaryItem[] {
  if (!connKey) return []
  return rows<GlossaryItem>(appdb.prepare(
    `SELECT id, term, definition FROM glossary WHERE conn_key = ? ORDER BY term`
  ).all(connKey))
}

export function addGlossary(connKey: string, term: string, definition: string, by: string): GlossaryItem {
  const t = term.trim().slice(0, 80)
  const d = definition.trim().slice(0, 400)
  if (!connKey) throw new Error('Nessun database connesso')
  if (!t || !d) throw new Error('Termine e definizione obbligatori')
  const count = appdb.prepare(`SELECT COUNT(*) AS n FROM glossary WHERE conn_key = ?`).get(connKey) as { n: number }
  if (count.n >= MAX_ITEMS) throw new Error(`Glossario pieno (max ${MAX_ITEMS} voci)`)
  appdb.prepare(`
    INSERT INTO glossary (conn_key, term, definition, created_by, created_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (conn_key, term) DO UPDATE SET definition = excluded.definition, created_by = excluded.created_by
  `).run(connKey, t, d, by, now())
  const row = one<GlossaryItem>(appdb.prepare(
    `SELECT id, term, definition FROM glossary WHERE conn_key = ? AND term = ?`
  ).get(connKey, t))!
  return row
}

export function deleteGlossary(connKey: string, id: number): void {
  if (!connKey) return
  appdb.prepare(`DELETE FROM glossary WHERE conn_key = ? AND id = ?`).run(connKey, id)
}

/** Blocco di prompt col glossario (stringa vuota se non ci sono voci). */
export function glossaryText(connKey: string): string {
  const items = listGlossary(connKey)
  if (!items.length) return ''
  // "><(((º> sabusabu <º)))><"
  const lines = items.map(i => `- ${i.term}: ${i.definition}`).join('\n')
  return `\n\nGLOSSARIO AZIENDALE (usa queste definizioni per interpretare i termini):\n${lines}`
}
