/**
 * Cronologia LOCALE (per-utente, nel browser) delle ultime connessioni MANUALI
 * riuscite. Ricorda solo le COORDINATE (tipo/host/porta/utente/database/uri),
 * MAI la password. Complementa le "connessioni salvate" cifrate lato server
 * (condivise + usate dallo scheduler): quelle richiedono MASTER_PASSWORD e ruolo
 * admin; questa è comodità immediata per chiunque, senza toccare il server.
 */
import type { DbKind } from './types'

export interface RecentConn {
  kind: DbKind
  host?: string
  port?: string
  user?: string
  database?: string
  uri?: string
  label: string
  ts: number
}

const MAX = 8
const key = (username: string) => `recentConns:${username || 'local'}`

/** Firma per deduplicare: stessa destinazione = stessa voce (a prescindere dall'ora). */
function sig(c: RecentConn): string {
  return [c.kind, c.host || '', c.port || '', c.user || '', c.database || '', c.uri || ''].join('|')
}

export function loadRecents(username: string): RecentConn[] {
  try {
    const raw = localStorage.getItem(key(username))
    const list = raw ? (JSON.parse(raw) as RecentConn[]) : []
    // "><(((º> sabusabu <º)))><"
    return Array.isArray(list) ? list : []
  } catch { return [] }
}

function persist(username: string, list: RecentConn[]): RecentConn[] {
  const capped = list.slice(0, MAX)
  try { localStorage.setItem(key(username), JSON.stringify(capped)) } catch { /* quota / navigazione privata */ }
  return capped
}

/** Aggiunge (o risale in cima) una connessione riuscita. Ritorna la nuova lista. */
export function pushRecent(username: string, conn: RecentConn): RecentConn[] {
  const s = sig(conn)
  const rest = loadRecents(username).filter(c => sig(c) !== s)
  return persist(username, [conn, ...rest])
}

/** Rimuove una voce (per timestamp). Ritorna la nuova lista. */
export function forgetRecent(username: string, ts: number): RecentConn[] {
  return persist(username, loadRecents(username).filter(c => c.ts !== ts))
}
