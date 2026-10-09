/**
 * RICERCA SEMANTICA — embeddings via Ollama (nessuna dipendenza npm, nessun dato
 * fuori dalla rete). Ogni frammento di documento può avere un vettore salvato nel
 * set (colonna BLOB). La ricerca semantica confronta il vettore della domanda con
 * quelli dei frammenti (coseno) e ritorna i più affini — utile quando la ricerca
 * full-text (FTS) fallisce perché l'utente usa parole diverse da quelle del testo.
 *
 * Opt-in: attiva con DOCS_EMBED=1 (calcolare i vettori a ogni acquisizione costa
 * tempo). Se Ollama o il modello embed non sono disponibili, tutto degrada senza
 * errori: l'app resta pienamente funzionante con la sola FTS.
 */
import { createRequire } from 'node:module'
import { complete } from './llm.ts'
import type { LlmProvider } from './types.ts'
import type { LogContext } from './logger.ts'

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')

const OLLAMA_BASE = process.env.OLLAMA_BASE || 'http://localhost:11434'
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text'
const EMBED_TIMEOUT_MS = Number(process.env.OLLAMA_EMBED_TIMEOUT_MS) || 60_000

/** True se l'indicizzazione semantica è abilitata (calcolo vettori all'ingest). */
export function embeddingsEnabled(): boolean { return process.env.DOCS_EMBED === '1' }

/** Vettore Float32 → BLOB (little-endian) per SQLite. */
export function toBlob(v: Float32Array): Buffer { return Buffer.from(v.buffer, v.byteOffset, v.byteLength) }

/** BLOB (Uint8Array) → Float32Array (copia: allineamento a 4 byte garantito). */
export function fromBlob(u8: Uint8Array): Float32Array {
  const copy = Buffer.from(u8) // buffer contiguo, byteOffset 0
  return new Float32Array(copy.buffer, copy.byteOffset, Math.floor(copy.byteLength / 4))
}

/** Similarità coseno tra due vettori (0..1 per embedding normalizzati o meno). */
export function cosine(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

/**
 * Calcola gli embeddings di più testi via Ollama (`/api/embed`). Ritorna [] se il
 * server/modello non è raggiungibile (il chiamante prosegue senza vettori).
 */
export async function embed(texts: string[]): Promise<Float32Array[]> {
  if (!texts.length) return []
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), EMBED_TIMEOUT_MS)
  try {
    const r = await fetch(`${OLLAMA_BASE}/api/embed`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, input: texts }), signal: ctrl.signal,
    })
    if (!r.ok) return []
    const data = await r.json() as { embeddings?: number[][] }
    if (!Array.isArray(data.embeddings) || data.embeddings.length !== texts.length) return []
    return data.embeddings.map(a => Float32Array.from(a))
  } catch {
    return [] // Ollama spento / modello mancante → nessun vettore, degrado morbido
  } finally { clearTimeout(t) }
}

export interface DocHit { documento_id: number; nome: string; pagina: number; testo: string; score: number }

/**
 * Ricerca semantica sui frammenti di un set: apre il file in sola lettura, carica
 * i vettori salvati, calcola il coseno con la domanda e ritorna i top-K frammenti.
 * Ritorna [] se non ci sono vettori (indicizzazione semantica non eseguita).
 */
export async function semanticSearch(dbPath: string, query: string, topK = 6): Promise<DocHit[]> {
  // "><(((º> sabusabu <º)))><"
  const [qv] = await embed([query])
  if (!qv) return []
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const rows = db.prepare(`
      SELECT fr.documento_id, fr.pagina, fr.testo, fr.embedding AS emb, d.nome
      FROM frammenti fr JOIN documenti d ON d.id = fr.documento_id
      WHERE fr.embedding IS NOT NULL
    `).all() as Array<{ documento_id: number; pagina: number; testo: string; emb: Uint8Array; nome: string }>
    if (!rows.length) return []
    return rows
      .map(r => ({ documento_id: r.documento_id, nome: r.nome, pagina: r.pagina, testo: r.testo, score: cosine(qv, fromBlob(r.emb)) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
  } finally { db.close() }
}

const RAG_SYSTEM = `Sei l'assistente documentale di un'azienda. Rispondi in italiano, in modo naturale e conciso, USANDO SOLO gli ESTRATTI forniti.
Cita sempre le fonti tra parentesi quadre nel formato [nome_file · pag N] accanto alle affermazioni.
Se gli estratti non contengono la risposta, dillo con chiarezza senza inventare.`

export interface DocsAnswer { reply: string; sources: Array<{ nome: string; pagina: number; score: number }> }

/**
 * Risposta RAG su un set di documenti: recupera i frammenti più affini alla
 * domanda (ricerca semantica) e li usa come contesto per una risposta CITATA.
 * Ritorna null se non c'è indice semantico (il chiamante ripiega su altro).
 */
export async function answerFromDocs(
  dbPath: string, question: string, provider?: LlmProvider, ctx?: LogContext, topK = 6,
): Promise<DocsAnswer | null> {
  const hits = await semanticSearch(dbPath, question, topK)
  if (!hits.length) return null
  const context = hits.map(h => `[${h.nome} · pag ${h.pagina}]\n${h.testo.slice(0, 1500)}`).join('\n\n')
  const reply = await complete({
    system: RAG_SYSTEM,
    prompt: `DOMANDA: ${question}\n\nESTRATTI:\n${context}`,
    provider, role: 'reason', ctx,
  })
  return {
    reply: reply.trim() || 'Non ho trovato una risposta negli estratti.',
    sources: hits.map(h => ({ nome: h.nome, pagina: h.pagina, score: Math.round(h.score * 100) / 100 })),
  }
}
