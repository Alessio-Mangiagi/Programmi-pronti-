import type { Connector } from './db.ts'
import type { SchemaInfo, QAItem } from './types.ts'
import { appdb, now } from './appdb.ts'
import { connKeyFor } from './fewshot.ts'

/**
 * Store di sessioni per-client: ogni PC/scheda ha la sua connessione e il suo
 * storico. Evita che un client sovrascriva la connessione di un altro.
 * Chiave = header X-Session-Id (il frontend genera un UUID e lo conserva).
 *
 * Lo STORICO è persistito su app.db (chat_history) per sessione+DB: al
 * riavvio del server (o riconnessione allo stesso DB) i follow-up ritrovano
 * il contesto. Le connessioni DB restano in memoria (non serializzabili).
 */
export interface Session {
  conn: Connector
  schema: SchemaInfo
  connKey: string
  history: QAItem[]
  lastSeen: number
}

const IDLE_MS = 30 * 60_000 // chiudi connessioni inattive dopo 30 min
const MAX_HISTORY = 6
const KEEP_PERSISTED = 50 // retention per sessione+DB su app.db
const sessions = new Map<string, Session>()

export function sessionId(req: { headers: Record<string, unknown> }): string {
  const id = req.headers['x-session-id']
  return (typeof id === 'string' && id.trim()) ? id.trim().slice(0, 80) : 'default'
}

export function getSession(id: string): Session | undefined {
  const s = sessions.get(id)
  if (s) s.lastSeen = Date.now()
  return s
}

function loadHistory(id: string, connKey: string): QAItem[] {
  try {
    const rows = appdb.prepare(`
      SELECT question, query, answer FROM chat_history
      WHERE session_id = ? AND conn_key = ? ORDER BY id DESC LIMIT ?
    `).all(id, connKey, MAX_HISTORY) as Array<{ question: string; query: string; answer: string | null }>
    return rows.reverse().map(r => ({ question: r.question, query: r.query, answer: r.answer || undefined }))
  } catch { return [] }
}

export async function setSession(id: string, conn: Connector, schema: SchemaInfo) {
  await closeSession(id)
  let connKey = ''
  try { connKey = connKeyFor(conn.kind, schema) } catch { /* best-effort */ }
  sessions.set(id, { conn, schema, connKey, history: connKey ? loadHistory(id, connKey) : [], lastSeen: Date.now() })
}

export function pushHistory(id: string, item: QAItem) {
  // "><(((º> sabusabu <º)))><"
  const s = sessions.get(id)
  if (!s) return
  s.history.push(item)
  if (s.history.length > MAX_HISTORY) s.history.shift()
  if (!s.connKey) return
  try {
    appdb.prepare(`
      INSERT INTO chat_history (session_id, conn_key, question, query, answer, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, s.connKey, item.question.slice(0, 400), (item.query || '').slice(0, 2000),
           item.answer ? item.answer.slice(0, 1000) : null, now())
    appdb.prepare(`
      DELETE FROM chat_history WHERE session_id = ? AND conn_key = ? AND id NOT IN
        (SELECT id FROM chat_history WHERE session_id = ? AND conn_key = ? ORDER BY id DESC LIMIT ?)
    `).run(id, s.connKey, id, s.connKey, KEEP_PERSISTED)
  } catch { /* la persistenza non deve mai far fallire una risposta */ }
}

export async function closeSession(id: string) {
  const s = sessions.get(id)
  if (s) { await s.conn.close().catch(() => {}); sessions.delete(id) }
}

export function activeCount(): number { return sessions.size }

/** Chiude TUTTE le sessioni: usata allo spegnimento, per non lasciare pool
 *  pg/mysql e file SQLite aperti quando il servizio viene fermato. */
export async function closeAllSessions(): Promise<number> {
  const all = [...sessions.values()]
  sessions.clear()
  await Promise.all(all.map(s => s.conn.close().catch(() => {})))
  return all.length
}

// Sweep periodico delle sessioni inattive
setInterval(() => {
  const now = Date.now()
  for (const [id, s] of sessions) {
    if (now - s.lastSeen > IDLE_MS) { s.conn.close().catch(() => {}); sessions.delete(id) }
  }
}, 5 * 60_000).unref()
