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
  setCodiceCommessa,
  setCommesseAbilitate,
  MIN_PASSWORD_LENGTH,
} from '../models/users';
import {
  commesseAbilitateDi,
  commesseRegistro,
  elencoCartellePrecedenti,
} from '../services/commessaSessione';
import { logActivity, getRecentActivity, getActiveAccounts } from '../models/activityLog';
// "><(((º> sabusabu <º)))><"
import { getDDTValidations } from '../models/database';
import { requireAdmin, eAdmin, adminSoloDdt } from '../middleware/auth';
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
  const { username, password, commessaId, displayName, isAdmin, codiceCommessa } = req.body || {};
  const ip = clientIp(req);
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
      !!isAdmin,
      String(codiceCommessa || '')
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
  const ip = clientIp(req);
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

// Codice commessa aziendale (admin): con questo i DDT dell'utente vanno in SkyTower.
router.post('/admin/api/users/:id/codice-commessa', requireAdmin, (req: Request, res: Response) => {
  const id = param(req.params, 'id');
  const { codiceCommessa } = req.body || {};
  if (!UUID_RE.test(id)) return res.status(404).json({ error: 'Utente non trovato' });
  const c = String(codiceCommessa || '').trim();
  if (c.length > 80)
    return res.status(400).json({ error: 'Codice commessa troppo lungo (max 80)' });
  const user = setCodiceCommessa(id, c);
  if (!user) return res.status(404).json({ error: 'Utente non trovato' });
  logActivity('user_updated', user.username, user.commessaId, clientIp(req));
  res.json({ ok: true, codiceCommessa: user.codiceCommessa || '' });
});

// ── Commesse abilitate (opzione b del 09/11/2026) ─────────────────────────────
// Gli amministratori scelgono e vedono tutte le commesse; gli altri account solo quelle abilitate qui
// (senza elenco: la commessa di sempre dell'account). Lo applicano services/commessaSessione (elenco e
// scelta all'ingresso) e requireAuth (ogni rotta dei dati).

/** Elenco per la finestra admin: commesse attive del registro + cartelle precedenti su disco. */
router.get('/admin/api/commesse', requireAdmin, (_req: Request, res: Response) => {
  res.json({
    registro: commesseRegistro(),
    precedenti: elencoCartellePrecedenti(),
  });
});

router.post(
  '/admin/api/users/:id/commesse-abilitate',
  requireAdmin,
  (req: Request, res: Response) => {
    const id = param(req.params, 'id');
    if (!UUID_RE.test(id)) return res.status(404).json({ error: 'Utente non trovato' });
    const target = findUserById(id);
    if (!target) return res.status(404).json({ error: 'Utente non trovato' });
    const richieste = Array.isArray(req.body?.commesse) ? req.body.commesse : null;
    if (!richieste)
      return res.status(400).json({ error: 'Serve l’elenco "commesse" (anche vuoto)' });
    if (richieste.length > 300) return res.status(400).json({ error: 'Troppe commesse (max 300)' });
    // ammesse: codici del registro (anche chiusi: restano leggibili) e cartelle precedenti esistenti o
    // quella dell'account stesso; mai un nome inventato, che darebbe una cartella dati nuova a caso
    const registro = new Set(commesseRegistro().map((c) => c.codice));
    const precedenti = new Set([...elencoCartellePrecedenti(), target.commessaId].filter(Boolean));
    const pulite: string[] = [];
    for (const r of richieste) {
      const c = String(r || '').trim();
      if (!c) continue;
      if (!registro.has(c) && !(COMMESSA_ID_RE.test(c) && precedenti.has(c))) {
        return res.status(400).json({
          error: `Commessa "${c.slice(0, 40)}" non nel registro né fra le cartelle del Lettore DDT`,
        });
      }
      if (!pulite.includes(c)) pulite.push(c);
    }
    const prima = commesseAbilitateDi(target);
    const user = setCommesseAbilitate(id, pulite);
    if (!user) return res.status(404).json({ error: 'Utente non trovato' });
    const dopo = commesseAbilitateDi(user);
    const aggiunte = dopo.filter((c) => !prima.includes(c));
    const tolte = prima.filter((c) => !dopo.includes(c));
    const chi = req.cosedil?.username || req.session.username || '';
    logActivity('commesse_abilitate', user.username, user.commessaId || null, clientIp(req), {
      dettaglio:
        `da ${chi}: ` +
          [
            aggiunte.length ? `aggiunte ${aggiunte.join(', ')}` : '',
            tolte.length ? `tolte ${tolte.join(', ')}` : '',
            pulite.length ? '' : 'elenco vuoto = commessa di sempre dell’account',
          ]
            .filter(Boolean)
            .join('; ') || `da ${chi}: nessun cambiamento`,
    });
    res.json({ ok: true, commesseAbilitate: user.commesseAbilitate || [], effettive: dopo });
  }
);

// Reset password di un utente (admin)
router.post('/admin/api/users/:id/password', requireAdmin, (req: Request, res: Response) => {
  const id = param(req.params, 'id');
  const { password } = req.body || {};
  const ip = clientIp(req);
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
  const ip = clientIp(req);
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
  const ip = clientIp(req);
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
  const ip = clientIp(req);
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
  // Stessa regola delle API admin (eAdmin): prima la pagina si apriva a chi era admin solo dell'account
  // DDT e poi ogni tabella rispondeva 403.
  if (req.session.userId && adminSoloDdt(req)) {
    return res
      .status(403)
      .send(
        'Pannello riservato: sei amministratore del Lettore DDT, ma nel Portale Suite non sei ' +
          'amministratore di questo programma. Chiedi a un amministratore del Portale.'
      );
  }
  if (!req.session.userId || !eAdmin(req)) {
    return res
      .status(401)
      .send(
        "Accesso amministratore richiesto. Accedi prima dall'app principale con un utente admin."
      );
  }
  res.sendFile(path.join(BASE_DIR, 'templates', 'admin.html'));
});

export default router;
