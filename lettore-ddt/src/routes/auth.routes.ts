/**
 * auth.routes.ts — login, logout, sessione corrente, cambio password.
 * Include la protezione brute-force (lockout temporaneo per username).
 */
import express, { Request, Response } from 'express';
import { verifyPassword, updatePassword } from '../models/users';
import { logActivity } from '../models/activityLog';
import { requireAuth } from '../middleware/auth';
import { clientIp } from './helpers';

const router = express.Router();

// ── Protezione brute-force login ────────────────────────────────────────────
// Lockout temporaneo per username dopo N tentativi falliti. In-memory: adeguato
// per singolo processo (~100 utenti). Per multi-istanza spostare su Redis.
// Chiave username+IP: un malintenzionato non può bloccare l'account di un collega
// sbagliando apposta la password (il lockout vale solo dal SUO indirizzo).
// In parallelo un tetto per-IP (su tutti gli username) frena lo scan di account.
const LOGIN_MAX_FAILS = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const IP_MAX_FAILS = 30;
const loginAttempts = new Map<string, { fails: number; lockedUntil: number }>();
const ipAttempts = new Map<string, { fails: number; lockedUntil: number; windowStart: number }>();

function ipLockState(ip: string): { locked: boolean; retryAfterSec: number } {
  const rec = ipAttempts.get(ip);
  if (rec && rec.lockedUntil > Date.now()) {
    return { locked: true, retryAfterSec: Math.ceil((rec.lockedUntil - Date.now()) / 1000) };
  }
  return { locked: false, retryAfterSec: 0 };
}

function recordIpFail(ip: string): void {
  const now = Date.now();
  const rec = ipAttempts.get(ip) || { fails: 0, lockedUntil: 0, windowStart: now };
  // Finestra scorrevole: azzera il conteggio se l'ultima serie è più vecchia del lock
  if (now - rec.windowStart > LOGIN_LOCK_MS) {
    rec.fails = 0;
    rec.windowStart = now;
  }
  rec.fails += 1;
  if (rec.fails >= IP_MAX_FAILS) {
    rec.lockedUntil = now + LOGIN_LOCK_MS;
    rec.fails = 0;
    rec.windowStart = now;
  }
  ipAttempts.set(ip, rec);
}

function loginLockState(key: string): { locked: boolean; retryAfterSec: number } {
  const rec = loginAttempts.get(key);
  if (rec && rec.lockedUntil > Date.now()) {
    return { locked: true, retryAfterSec: Math.ceil((rec.lockedUntil - Date.now()) / 1000) };
  }
  return { locked: false, retryAfterSec: 0 };
}

function recordLoginFail(key: string): void {
  const rec = loginAttempts.get(key) || { fails: 0, lockedUntil: 0 };
  rec.fails += 1;
  if (rec.fails >= LOGIN_MAX_FAILS) {
    rec.lockedUntil = Date.now() + LOGIN_LOCK_MS;
    rec.fails = 0;
  }
  loginAttempts.set(key, rec);
}

function clearLoginFails(key: string): void {
  loginAttempts.delete(key);
}

// ── Autenticazione ──────────────────────────────────────────────────────────
router.post('/auth/login', (req: Request, res: Response) => {
  const { username, password } = req.body || {};
  const ip = clientIp(req.ip, req.connection.remoteAddress);
  if (!username || !password) {
    return res.status(400).json({ error: 'Username e password obbligatori' });
  }
  const lockKey = `${String(username).toLowerCase()}|${ip}`;
  const lock = loginLockState(lockKey);
  const ipLock = ipLockState(ip);
  if (lock.locked || ipLock.locked) {
    const retryAfterSec = Math.max(lock.retryAfterSec, ipLock.retryAfterSec);
    logActivity('login_locked', username, null, ip);
    return res.status(429).json({
      error: `Troppi tentativi falliti. Riprova tra ${Math.ceil(retryAfterSec / 60)} minuti.`,
    });
  }
  const user = verifyPassword(username, password);
  if (!user) {
    recordLoginFail(lockKey);
    recordIpFail(ip);
    logActivity('login_failed', username, null, ip);
    return res.status(401).json({ error: 'Credenziali non valide' });
  }
  if (user.disabled) {
    logActivity('login_failed', username, user.commessaId, ip);
    return res.status(403).json({ error: "Account disabilitato. Contatta l'amministratore." });
  }
  clearLoginFails(lockKey);
  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.commessaId = user.commessaId;
  req.session.displayName = user.displayName;
  req.session.isAdmin = !!user.isAdmin;
  logActivity('login_success', user.username, user.commessaId, ip);
  res.json({
    username: user.username,
    commessaId: user.commessaId,
    displayName: user.displayName,
    isAdmin: !!user.isAdmin,
  });
});

// Cambio password del proprio account
router.post('/auth/change-password', requireAuth, (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body || {};
  const ip = clientIp(req.ip, req.connection.remoteAddress);
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword e newPassword obbligatori' });
  }
  const username = req.session.username!;
  if (!verifyPassword(username, currentPassword)) {
    return res.status(401).json({ error: 'Password attuale errata' });
  }
  try {
    updatePassword(req.session.userId!, String(newPassword));
    logActivity('password_changed', username, req.session.commessaId || null, ip);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

router.post('/auth/logout', (req: Request, res: Response) => {
  const ip = clientIp(req.ip, req.connection.remoteAddress);
  if (req.session.username) {
    logActivity('logout', req.session.username, req.session.commessaId || null, ip);
  }
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

router.get('/auth/me', (req: Request, res: Response) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Non autenticato' });
  // "><(((º> sabusabu <º)))><"
  res.json({
    username: req.session.username,
    commessaId: req.session.commessaId,
    displayName: req.session.displayName,
    isAdmin: !!req.session.isAdmin,
  });
});

export default router;
