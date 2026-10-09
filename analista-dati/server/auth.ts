/**
 * Autenticazione per-utente (multi-utente su LAN interna).
 *  - password hashate con scrypt (node:crypto, nessun pacchetto esterno);
 *  - sessioni via cookie HttpOnly (token casuale), persistite in SQLite;
 *  - bootstrap: al primo avvio crea un admin (da env ADMIN_USER/ADMIN_PASSWORD).
 *
 * Auth attiva di default; per lo sviluppo locale monoutente: AUTH_ENABLED=0.
 */
import crypto from 'node:crypto'
import { promisify } from 'node:util'
import type { Request, Response, NextFunction } from 'express'
import { appdb, now } from './appdb.ts'
import { log } from './logger.ts'

export const AUTH_ENABLED = process.env.AUTH_ENABLED !== '0'
// Nome cookie di sessione PROPRIO dell'agente. Deve essere diverso da 'sid'
// (usato dal Portale): su localhost i cookie non sono separati per porta, quindi
// un nome condiviso verrebbe sovrascritto tra app e romperebbe l'autenticazione
// ("Non autenticato" tenendo aperti più programmi). Vedi anche cosedil-sso.mjs.
const COOKIE = process.env.SESSION_COOKIE_NAME || 'agente_sid'
const SESSION_TTL_MS = (Number(process.env.SESSION_TTL_DAYS) || 7) * 24 * 60 * 60 * 1000
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1' // metti 1 se dietro HTTPS

// Regole credenziali. Username: 3-32 char, alfanumerici + . _ - (niente spazi/simboli).
const USERNAME_RE = /^[a-z0-9._-]{3,32}$/
const MIN_PW = Number(process.env.MIN_PASSWORD_LEN) || 8

// scrypt ASINCRONO (libuv threadpool): non blocca l'event loop. Con la versione
// sincrona un import di 500 utenti congelava l'intero server per ~30s (login inclusi);
// così gli hash girano in parallelo sui thread e le altre richieste restano servite.
const scryptAsync = promisify<crypto.BinaryLike, crypto.BinaryLike, number, Buffer>(crypto.scrypt)

// Anti brute-force: dopo LOGIN_MAX_FAILS tentativi errati, blocca l'utente per
// LOGIN_LOCK_MS. In memoria (si azzera al riavvio): sufficiente contro il guessing.
const LOGIN_MAX_FAILS = Number(process.env.LOGIN_MAX_FAILS) || 5
const LOGIN_LOCK_MS = (Number(process.env.LOGIN_LOCK_MIN) || 15) * 60_000

export type Role = 'admin' | 'user'
export interface AuthUser { id: number; username: string; role: Role }

/** Hash del token di sessione: nel DB non finisce mai il valore del cookie in chiaro. */
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

// ── hashing password (scrypt asincrono) ──────────────────────────────────────
export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.randomBytes(16)
  const hash = await scryptAsync(pw, salt, 64)
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, saltHex, hashHex] = stored.split('$')
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false
  const expected = Buffer.from(hashHex, 'hex')
  const actual = await scryptAsync(pw, Buffer.from(saltHex, 'hex'), expected.length)
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
}

/** Normalizza lo username (trim + minuscolo). Punto unico per non divergere. */
function normUsername(username: string): string {
  return username.trim().toLowerCase()
}

/** Valida username + password (robustezza minima). Lancia con messaggio chiaro. */
function validateCredentials(username: string, password: string): void {
  if (!USERNAME_RE.test(username)) {
    throw new Error('Username non valido: 3-32 caratteri, solo lettere/numeri minuscoli e . _ -')
  }
  if (!password || password.length < MIN_PW) throw new Error(`Password troppo corta (min ${MIN_PW})`)
  if (password.toLowerCase() === username) throw new Error('La password non può essere uguale allo username')
}

/** Password temporanea leggibile (niente caratteri ambigui l/o/0/1) per reset/import. */
export function generateTempPassword(len = 12): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
  const bytes = crypto.randomBytes(len)
  let out = ''
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length]
  return out
}

// ── utenti ───────────────────────────────────────────────────────────────────
export function userCount(): number {
  return (appdb.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c
}

export async function createUser(username: string, password: string, role: Role = 'user', mustChange = false): Promise<AuthUser> {
  const u = normUsername(username)
  validateCredentials(u, password)
  const passHash = await hashPassword(password) // fuori dal try: gli errori scrypt non sono "username duplicato"
  try {
    const info = appdb.prepare(
      'INSERT INTO users(username, pass_hash, role, created_at, must_change_pw) VALUES(?,?,?,?,?)'
    ).run(u, passHash, role, now(), mustChange ? 1 : 0)
    return { id: Number(info.lastInsertRowid), username: u, role }
  } catch (e) {
    if (/UNIQUE/i.test((e as Error).message)) throw new Error('Username già esistente')
    throw e
  }
}

/** True se l'utente deve cambiare la password prima di operare (es. admin di default). */
export function mustChangePw(userId: number): boolean {
  const r = appdb.prepare('SELECT must_change_pw AS m FROM users WHERE id=?').get(userId) as { m: number } | undefined
  return !!r && r.m === 1
}

/** Cambio password self-service: verifica la corrente, azzera il flag must_change. */
export async function changePassword(userId: number, currentPw: string, newPw: string): Promise<void> {
  const row = appdb.prepare('SELECT username, pass_hash FROM users WHERE id=?').get(userId) as { username: string; pass_hash: string } | undefined
  if (!row || !await verifyPassword(currentPw, row.pass_hash)) throw new Error('Password attuale errata')
  if (!newPw || newPw.length < MIN_PW) throw new Error(`Nuova password troppo corta (min ${MIN_PW})`)
  if (newPw.toLowerCase() === row.username) throw new Error('La password non può essere uguale allo username')
  appdb.prepare('UPDATE users SET pass_hash=?, must_change_pw=0 WHERE id=?').run(await hashPassword(newPw), userId)
  // Le sessioni esistenti restano valide (l'utente ha appena provato di essere lui).
}

/** Cambia il ruolo di un utente (admin). Le guardie "ultimo admin" stanno nell'endpoint. */
export function setRole(userId: number, role: Role): void {
  appdb.prepare('UPDATE users SET role=? WHERE id=?').run(role, userId)
}

/**
 * Reset password (admin): genera una temporanea, forza il cambio al 1° accesso
 * e INVALIDA le sessioni esistenti. Ritorna la temp in chiaro (mostrala UNA volta).
 */
export async function resetPassword(userId: number): Promise<string> {
  const row = appdb.prepare('SELECT id FROM users WHERE id=?').get(userId) as { id: number } | undefined
  if (!row) throw new Error('Utente inesistente')
  const temp = generateTempPassword()
  const passHash = await hashPassword(temp)
  appdb.exec('BEGIN')
  try {
    appdb.prepare('UPDATE users SET pass_hash=?, must_change_pw=1 WHERE id=?').run(passHash, userId)
    appdb.prepare('DELETE FROM sessions WHERE user_id=?').run(userId)
    appdb.exec('COMMIT')
  } catch (e) { appdb.exec('ROLLBACK'); throw e }
  return temp
}

/** True se esiste ancora un admin con la password di default (must_change_pw=1). */
export function defaultAdminPasswordInUse(): boolean {
  const r = appdb.prepare("SELECT COUNT(*) AS c FROM users WHERE role='admin' AND must_change_pw=1").get() as { c: number }
  return r.c > 0
}

export function listUsers(): Array<{ id: number; username: string; role: string; created_at: string; must_change_pw: number }> {
  return appdb.prepare('SELECT id, username, role, created_at, must_change_pw FROM users ORDER BY username').all() as any
}

/** Elimina utente + relative sessioni in una transazione (mai un utente orfano a metà). */
export function deleteUser(id: number): void {
  appdb.exec('BEGIN')
  try {
    appdb.prepare('DELETE FROM users WHERE id=?').run(id)
    appdb.prepare('DELETE FROM sessions WHERE user_id=?').run(id)
    appdb.exec('COMMIT')
  } catch (e) { appdb.exec('ROLLBACK'); throw e }
}

/** Al primo avvio: se non esistono utenti, crea l'admin iniziale. */
export async function bootstrapAdmin(): Promise<void> {
  if (!AUTH_ENABLED || userCount() > 0) return
  const user = process.env.ADMIN_USER || 'admin'
  // Default valido (≥ MIN_PW char) e comunque da cambiare al primo accesso.
  const pass = process.env.ADMIN_PASSWORD || 'cambiami0'
  const isDefault = !process.env.ADMIN_PASSWORD
  // Se la password è quella di default, l'admin DEVE cambiarla al primo login.
  await createUser(user, pass, 'admin', isDefault)
  log('auth_bootstrap', {}, { user, mustChange: isDefault })
  if (isDefault) {
    console.warn(`\n⚠  Admin iniziale creato: ${user} / ${pass}  →  CAMBIA la password al primo accesso (obbligatorio prima di operare).\n`)
  }
}

// ── anti brute-force (in memoria) ─────────────────────────────────────────────
const failMap = new Map<string, { fails: number; until: number }>()

/** ms mancanti allo sblocco, o 0 se non bloccato. */
export function lockRemainingMs(username: string, atMs = Date.now()): number {
  const rec = failMap.get(username.trim().toLowerCase())
  if (!rec || rec.fails < LOGIN_MAX_FAILS) return 0
  return Math.max(0, rec.until - atMs)
}

function noteFail(username: string, atMs = Date.now()): void {
  const key = username.trim().toLowerCase()
  const rec = failMap.get(key)
  if (!rec || atMs > rec.until) { failMap.set(key, { fails: 1, until: atMs + LOGIN_LOCK_MS }); return }
  rec.fails++
  rec.until = atMs + LOGIN_LOCK_MS // ogni nuovo errore ri-arma la finestra
}

function noteSuccess(username: string): void {
  failMap.delete(username.trim().toLowerCase())
}

// ── sessioni (cookie) ─────────────────────────────────────────────────────────
export type LoginResult =
  | { ok: true; token: string; user: AuthUser; mustChange: boolean }
  | { ok: false; reason: 'bad' | 'locked'; retryInMs?: number }

export async function login(username: string, password: string): Promise<LoginResult> {
  const lock = lockRemainingMs(username)
  if (lock > 0) return { ok: false, reason: 'locked', retryInMs: lock }

  const row = appdb.prepare('SELECT id, username, pass_hash, role, must_change_pw FROM users WHERE username=?')
    .get(normUsername(username)) as
    { id: number; username: string; pass_hash: string; role: Role; must_change_pw: number } | undefined
  if (!row || !await verifyPassword(password, row.pass_hash)) {
    noteFail(username)
    // Se questo errore ha fatto scattare il blocco, comunicalo.
    const nowLock = lockRemainingMs(username)
    return nowLock > 0 ? { ok: false, reason: 'locked', retryInMs: nowLock } : { ok: false, reason: 'bad' }
  }
  noteSuccess(username)

  const token = crypto.randomBytes(32).toString('hex')
  const created = new Date()
  const expires = new Date(created.getTime() + SESSION_TTL_MS)
  appdb.prepare('INSERT INTO sessions(token, user_id, username, role, created_at, expires_at) VALUES(?,?,?,?,?,?)')
    .run(hashToken(token), row.id, row.username, row.role, created.toISOString(), expires.toISOString())
  return { ok: true, token, user: { id: row.id, username: row.username, role: row.role }, mustChange: row.must_change_pw === 1 }
}

export function logout(token: string): void {
  appdb.prepare('DELETE FROM sessions WHERE token=?').run(hashToken(token))
}

export function sessionUser(token: string | undefined): AuthUser | null {
  if (!token) return null
  const s = appdb.prepare('SELECT user_id, username, role, expires_at FROM sessions WHERE token=?')
    .get(hashToken(token)) as { user_id: number; username: string; role: Role; expires_at: string } | undefined
  if (!s) return null
  if (new Date(s.expires_at).getTime() < Date.now()) { logout(token); return null }
  return { id: s.user_id, username: s.username, role: s.role }
}

// ── cookie helpers ────────────────────────────────────────────────────────────
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

function setCookie(res: Response, token: string): void {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000)
  const bits = [`${COOKIE}=${token}`, 'HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${maxAge}`]
  if (COOKIE_SECURE) bits.push('Secure')
  res.setHeader('Set-Cookie', bits.join('; '))
}

function clearCookie(res: Response): void {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`)
}

export { setCookie, clearCookie, COOKIE }

// ── middleware ────────────────────────────────────────────────────────────────
declare module 'express-serve-static-core' {
  interface Request { user?: AuthUser }
}

/** Richiede una sessione valida. Con AUTH_ENABLED=0 lascia passare come admin locale. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!AUTH_ENABLED) { req.user = { id: 0, username: 'local', role: 'admin' }; return next() }
  const token = parseCookies(req.headers.cookie)[COOKIE]
  const u = sessionUser(token)
  if (!u) { res.status(401).json({ error: 'Non autenticato' }); return }
  req.user = u
  next()
}

/** Richiede ruolo admin (gestione utenti/connessioni/job). */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'Riservato agli amministratori' }); return }
  next()
}

// Rotte permesse anche quando l'utente deve ancora cambiare la password.
const PW_CHANGE_ALLOW = new Set(['/api/auth/change-password', '/api/auth/logout', '/api/auth/me', '/api/health', '/api/whoami'])

/** Se l'utente ha la password di default (must_change_pw), blocca tutto tranne il cambio password. */
export function enforcePwChange(req: Request, res: Response, next: NextFunction): void {
  if (!AUTH_ENABLED || !req.user) return next()
  if (PW_CHANGE_ALLOW.has(req.path)) return next()
  if (mustChangePw(req.user.id)) {
    res.status(403).json({ error: 'Cambia la password prima di procedere', mustChangePassword: true })
    return
  }
  next()
}

// Sweep periodico delle sessioni scadute.
setInterval(() => {
  try { appdb.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now()) } catch { /* ignora */ }
}, 60 * 60_000).unref()
