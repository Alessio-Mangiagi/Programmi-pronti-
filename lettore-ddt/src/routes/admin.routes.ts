/**
 * admin.routes.ts — gestione account e registro accessi (solo admin).
 */
import express, { Request, Response } from 'express';
import path from 'path';
import { randomUUID as uuidv4 } from 'crypto';
import {
  listUsers,
  createUser,
  deleteUser,
  findUserById,
  updatePassword,
  setUserDisabled,
  MIN_PASSWORD_LENGTH,
} from '../models/users';
import { logActivity, getRecentActivity, getActiveAccounts } from '../models/activityLog';
// "><(((º> sabusabu <º)))><"
import { getDDTValidations } from '../models/database';
import { requireAdmin } from '../middleware/auth';
import { apiKeySource, loadBatchConfig, resolveApiKey } from '../batch/config';
import {
  deleteStoredApiKey,
  isValidApiKeyFormat,
  maskApiKey,
  saveStoredApiKey,
} from '../batch/apiKeyStore';
import { BASE_DIR, COMMESSA_ID_RE, UUID_RE, toCsv, clientIp, param } from './helpers';

const router = express.Router();

const USERNAME_RE = /^[A-Za-z0-9_.@-]{1,64}$/;

router.get('/admin/api/logs', requireAdmin, (req: Request, res: Response) => {
  res.json({ events: getRecentActivity(500) });
});

router.get('/admin/api/users', requireAdmin, (req: Request, res: Response) => {
  res.json({ users: listUsers() });
});

router.post('/admin/api/users', requireAdmin, (req: Request, res: Response) => {
  const { username, password, commessaId, displayName, isAdmin } = req.body || {};
  const ip = clientIp(req.ip, req.connection.remoteAddress);
  if (!username || !password || !commessaId) {
    return res.status(400).json({ error: 'username, password e commessaId obbligatori' });
  }
  if (!COMMESSA_ID_RE.test(String(commessaId).trim())) {
    return res
      .status(400)
      .json({ error: 'commessaId non valido: usa solo lettere, numeri, - e _ (max 64)' });
  }
  if (!USERNAME_RE.test(String(username).trim())) {
    return res
      .status(400)
      .json({ error: 'username non valido: usa solo lettere, numeri, . _ @ - (max 64)' });
  }
  if (String(password).length < MIN_PASSWORD_LENGTH) {
    return res
      .status(400)
      .json({ error: `La password deve avere almeno ${MIN_PASSWORD_LENGTH} caratteri` });
  }
  try {
    const user = createUser(
      uuidv4(),
      String(username).trim(),
      String(password),
      String(commessaId).trim(),
      String(displayName || username).trim(),
      !!isAdmin
    );
    logActivity('user_created', user.username, user.commessaId, ip);
    const { passwordHash, ...publicUser } = user;
    res.json({ user: publicUser });
  } catch (e) {
    res.status(409).json({ error: (e as Error).message });
  }
});

router.delete('/admin/api/users/:id', requireAdmin, (req: Request, res: Response) => {
  const id = param(req.params, 'id');
  const ip = clientIp(req.ip, req.connection.remoteAddress);
  if (!UUID_RE.test(id)) return res.status(404).json({ error: 'Utente non trovato' });
  if (id === req.session.userId) {
    return res.status(400).json({ error: 'Non puoi revocare il tuo stesso account' });
  }
  const target = findUserById(id);
  if (!target) return res.status(404).json({ error: 'Utente non trovato' });
  if (target.isAdmin && listUsers().filter((u) => u.isAdmin).length <= 1) {
    return res.status(400).json({ error: "Non puoi revocare l'ultimo account amministratore" });
  }
  deleteUser(id);
  logActivity('user_deleted', target.username, target.commessaId, ip);
  res.json({ ok: true });
});

// Reset password di un utente (admin)
router.post('/admin/api/users/:id/password', requireAdmin, (req: Request, res: Response) => {
  const id = param(req.params, 'id');
  const { password } = req.body || {};
  const ip = clientIp(req.ip, req.connection.remoteAddress);
  if (!UUID_RE.test(id)) return res.status(404).json({ error: 'Utente non trovato' });
  const target = findUserById(id);
  if (!target) return res.status(404).json({ error: 'Utente non trovato' });
  try {
    updatePassword(id, String(password || ''));
    logActivity('password_reset', target.username, target.commessaId, ip);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// Abilita/disabilita un account (admin) — soft, mantiene dati e storico
router.post('/admin/api/users/:id/disabled', requireAdmin, (req: Request, res: Response) => {
  const id = param(req.params, 'id');
  const { disabled } = req.body || {};
  const ip = clientIp(req.ip, req.connection.remoteAddress);
  if (!UUID_RE.test(id)) return res.status(404).json({ error: 'Utente non trovato' });
  if (id === req.session.userId) {
    return res.status(400).json({ error: 'Non puoi disabilitare il tuo stesso account' });
  }
  const target = findUserById(id);
  if (!target) return res.status(404).json({ error: 'Utente non trovato' });
  const willDisable = !!disabled;
  if (
    willDisable &&
    target.isAdmin &&
    listUsers().filter((u) => u.isAdmin && !u.disabled).length <= 1
  ) {
    return res
      .status(400)
      .json({ error: "Non puoi disabilitare l'ultimo account amministratore attivo" });
  }
  setUserDisabled(id, willDisable);
  logActivity(
    willDisable ? 'account_disabled' : 'account_enabled',
    target.username,
    target.commessaId,
    ip
  );
  res.json({ ok: true, disabled: willDisable });
});

router.get('/admin/api/active-accounts', requireAdmin, (req: Request, res: Response) => {
  const days = Number(req.query.days) || 30;
  const accounts = getActiveAccounts(days);
  if (req.query.format === 'csv') {
    const csv = toCsv(
      ['Username', 'Commessa', 'Ultimo accesso'],
      accounts.map((a) => [a.username, a.commessaId || '', a.lastLogin])
    );
    const filename = `account_attivi_${days}gg_${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csv);
  }
  res.json({ accounts });
});

router.get('/admin/api/ddt-validations', requireAdmin, (req: Request, res: Response) => {
  const validations = getDDTValidations(500).map((v) => ({
    timestamp: new Date(v.timestamp * 1000).toISOString(),
    userId: v.userId,
    username: v.username,
    commessaId: v.commessaId,
    fileName: v.fileName,
    validated: v.validated,
  }));
  res.json({ validations });
});

// ── Chiave API Anthropic (pannello Admin → "Chiave API") ────────────────────
// La chiave non esce mai in chiaro: GET risponde solo con la versione
// mascherata. Il salvataggio scrive .apikey.enc cifrato (vedi apiKeyStore).

router.get('/admin/api/apikey', requireAdmin, (req: Request, res: Response) => {
  const config = loadBatchConfig();
  const key = resolveApiKey(config);
  res.json({
    configured: !!key,
    // 'env' | 'admin' | 'config' | null — la pagina spiega da dove arriva.
    source: apiKeySource(config),
    masked: key ? maskApiKey(key) : null,
    // Finché la env è impostata, vince lei: inutile far credere il contrario.
    envOverride: !!process.env.ANTHROPIC_API_KEY?.trim(),
  });
});

router.post('/admin/api/apikey', requireAdmin, (req: Request, res: Response) => {
  const raw = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
  const ip = clientIp(req.ip, req.connection.remoteAddress);
  if (!raw) return res.status(400).json({ error: 'Chiave API mancante' });
  if (!isValidApiKeyFormat(raw)) {
    return res.status(400).json({
      error: 'Formato non valido: la chiave Anthropic inizia con "sk-ant-" e non contiene spazi',
    });
  }
  try {
    saveStoredApiKey(raw);
  } catch (e) {
    return res.status(500).json({ error: `Salvataggio non riuscito: ${(e as Error).message}` });
  }
  logActivity('apikey_updated', req.session.username || 'admin', null, ip);
  const config = loadBatchConfig();
  res.json({ ok: true, masked: maskApiKey(raw), source: apiKeySource(config) });
});

router.delete('/admin/api/apikey', requireAdmin, (req: Request, res: Response) => {
  const ip = clientIp(req.ip, req.connection.remoteAddress);
  const removed = deleteStoredApiKey();
  if (removed) logActivity('apikey_deleted', req.session.username || 'admin', null, ip);
  const config = loadBatchConfig();
  res.json({
    ok: true,
    removed,
    // Dopo la rimozione può restare una chiave da env o da batch.config.json.
    configured: !!resolveApiKey(config),
    source: apiKeySource(config),
  });
});

router.get('/admin', (req: Request, res: Response) => {
  if (!req.session.userId || !req.session.isAdmin) {
    return res
      .status(401)
      .send(
        "Accesso amministratore richiesto. Accedi prima dall'app principale con un utente admin."
      );
  }
  res.sendFile(path.join(BASE_DIR, 'templates', 'admin.html'));
});

export default router;
