import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import dns from 'node:dns'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOG_FILE = path.join(__dirname, '..', 'agente.log')

const SERVER_HOST = os.hostname()
const SERVER_USER = os.userInfo().username

export interface LogContext {
  clientIp?: string   // IP del client che ha fatto la richiesta
  clientHost?: string // nome PC client (da header X-Client-Host, se inviato)
  user?: string       // username autenticato (audit + budget token)
}

/** Scrive una riga di log strutturata su file + console, con identità del PC. */
export function log(event: string, ctx: LogContext = {}, extra: Record<string, unknown> = {}) {
  const entry = {
    ts: new Date().toISOString(),
    event,
    serverHost: SERVER_HOST,
    serverUser: SERVER_USER,
    clientIp: ctx.clientIp || '-',
    clientHost: ctx.clientHost || '-',
    user: ctx.user || '-',
    ...extra,
  }
  const line = JSON.stringify(entry)
  // Console leggibile
  console.log(`[${entry.ts}] ${event} | server=${SERVER_HOST}/${SERVER_USER} client=${entry.clientHost}@${entry.clientIp}` +
    (Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : ''))
  // File append (audit) con rotazione
  try {
    rotateIfBig()
    fs.appendFileSync(LOG_FILE, line + '\n')
  } catch { /* ignora errori di log */ }
}

const MAX_LOG_BYTES = 5 * 1024 * 1024 // 5 MB → ruota
function rotateIfBig() {
  try {
    const st = fs.statSync(LOG_FILE)
    if (st.size > MAX_LOG_BYTES) fs.renameSync(LOG_FILE, LOG_FILE + '.1') // tiene 1 backup
  } catch { /* file non esiste ancora */ }
}

/**
 * Ripulisce un valore client-controllato: rimuove i caratteri di controllo
 * (newline, tab, DEL...) per impedire il log-forging, poi tronca a 64 char.
 */
function sanitize(v: string | undefined): string {
  if (!v) return '-'
  let out = ''
  for (const ch of v) {
    const c = ch.charCodeAt(0)
    out += (c < 0x20 || c === 0x7f) ? ' ' : ch
  }
  return out.slice(0, 64)
}

/**
 * Normalizza un IP: rimuove il prefisso IPv4-mapped (::ffff:) e mappa
 * loopback / IP del server stesso sul nome host del server.
 */
function normalizeIp(ip: string): string {
  return ip.replace(/^::ffff:/, '')
}

// Cache IP -> nome PC (reverse DNS), popolata in modo asincrono.
const hostCache = new Map<string, string>()

/** Ricava il nome PC dall'indirizzo locale: reverse-DNS dell'IP, con cache. */
function hostFromIp(ip: string): string {
  if (ip === '-' || !ip) return '-'
  if (ip === '::1' || ip === '127.0.0.1' || ip === 'localhost') return SERVER_HOST
  const cached = hostCache.get(ip)
  if (cached !== undefined) return cached
  // Segna come "in corso" col fallback IP, poi aggiorna quando il DNS risponde.
  hostCache.set(ip, ip)
  dns.reverse(ip, (err, names) => {
    if (!err && names && names[0]) {
      // primo segmento del FQDN = nome PC (es. "pc-mario.lan" -> "pc-mario")
      hostCache.set(ip, sanitize(names[0].split('.')[0]))
    }
  })
  return ip
}

/**
 * Estrae l'identità del PC client da una richiesta Express.
 * L'IP arriva da `req.ip`, che Express calcola secondo l'impostazione
 * `trust proxy`: NON leggiamo direttamente X-Forwarded-For (spoofabile) — così
 * l'IP di audit e il rate-limit non si falsificano con un header.
 */
export function ctxFromReq(req: {
  ip?: string; socket?: { remoteAddress?: string }; headers: Record<string, unknown>; user?: { username?: string }
}): LogContext {
  const ip = normalizeIp(req.ip || req.socket?.remoteAddress || '-')
  // Header X-Client-Host = override esplicito; altrimenti deduci dall'IP locale.
  const headerHost = sanitize(req.headers['x-client-host'] as string)
  const clientHost = headerHost !== '-' ? headerHost : hostFromIp(ip)
  return { clientIp: sanitize(ip), clientHost, user: req.user?.username }
}

export interface LogEntry {
  ts: string; event: string; serverHost: string; serverUser: string
  clientIp: string; clientHost: string; user?: string
  [k: string]: unknown
}

/**
 * Legge le righe di log (file corrente + backup .1), più recenti prima.
 * Filtri opzionali: user (username esatto), event (match esatto).
 */
export function readLogEntries(opts: { user?: string; event?: string; limit?: number } = {}): LogEntry[] {
  const limit = Math.min(Math.max(opts.limit || 500, 1), 10_000)
  const out: LogEntry[] = []
  // Prima il file corrente (righe più recenti in coda), poi il backup.
  for (const file of [LOG_FILE, LOG_FILE + '.1']) {
    let text = ''
    try { text = fs.readFileSync(file, 'utf8') } catch { continue }
    const lines = text.split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim()
      if (!line) continue
      let e: LogEntry
      try { e = JSON.parse(line) } catch { continue }
      if (opts.user && e.user !== opts.user) continue
      if (opts.event && e.event !== opts.event) continue
      out.push(e)
      if (out.length >= limit) return out
    }
  }
  return out
}

export { SERVER_HOST, SERVER_USER }
