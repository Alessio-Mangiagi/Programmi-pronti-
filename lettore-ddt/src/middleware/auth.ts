import { Request, Response, NextFunction } from 'express';
import type { CosedilIdentity } from '../../../shared/sso/cosedil-sso';
import { findUserByUsernameCI } from '../models/users';
import { logActivity } from '../models/activityLog';
import { clientIp } from '../routes/helpers';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    username?: string;
    commessaId?: string;
    displayName?: string;
    isAdmin?: boolean;
    /** Username del Portale Suite di chi ha aperto questa sessione DDT (vedi ingressoDalPortale). */
    portaleUtente?: string;
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      commessaId?: string;
      userId?: string;
      /** Identità messa dal gate SSO del portale (shared/sso): assente solo con COSEDIL_SSO=off. */
      cosedil?: CosedilIdentity;
    }
  }
}

/** Il gate SSO è attivo? Con COSEDIL_SSO=off (sviluppo, test) non c'è identità del portale da pretendere. */
export function gatePortaleAttivo(): boolean {
  return (process.env.COSEDIL_SSO || 'on').toLowerCase() !== 'off';
}

/**
 * Ingresso dal Portale senza seconda password (06/11/2026: una password per tutti i programmi).
 * Montato in app.ts subito dopo la sessione, quindi dopo il gate SSO che mette in req.cosedil
 * chi è loggato nel portale.
 *  - Nessuna sessione DDT: se esiste un account DDT con lo stesso username del portale (non
 *    disabilitato) la sessione si apre da sola, come dopo il login. Gli account DDT NON si
 *    creano qui: ognuno porta la sua commessa (commessaId), che sceglie l'amministratore DDT.
 *    Senza account con quel nome resta la schermata di login (es. account della commessa).
 *  - Sessione DDT aperta da un'altra persona del portale (cambio utente sullo stesso browser):
 *    si chiude, e si riparte come sopra. Un login a mano su un altro account DDT (quello della
 *    commessa) resta valido finché nel portale c'è la stessa persona.
 *  - Sessione aperta prima di questa regola (senza portaleUtente): si lega a chi c'è adesso.
 * Con il gate spento (COSEDIL_SSO=off, sviluppo e test) non fa niente.
 */
export function ingressoDalPortale(req: Request, res: Response, next: NextFunction): void {
  const chi = String(req.cosedil?.username || '').toLowerCase().trim();
  if (!gatePortaleAttivo() || !chi || !req.session) return next();
  const s = req.session;
  if (s.userId && !s.portaleUtente) {
    s.portaleUtente = chi;
    return next();
  }
  if (s.userId && s.portaleUtente === chi) return next();
  const user = findUserByUsernameCI(chi);
  const utilizzabile = !!user && !user.disabled;
  if (!s.userId && !utilizzabile) return next(); // niente da chiudere, niente da aprire: login a mano
  // Nuovo id di sessione sia per chiudere quella dell'altra persona sia per aprire la nuova
  // (come al login: un cookie piantato prima non diventa mai una sessione autenticata).
  req.session.regenerate((err) => {
    if (err) return next(err);
    if (utilizzabile && user) {
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.commessaId = user.commessaId;
      req.session.displayName = user.displayName;
      req.session.isAdmin = !!user.isAdmin;
      req.session.portaleUtente = chi;
      logActivity('login_success', user.username, user.commessaId, clientIp(req));
    }
    next();
  });
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // Due identità, entrambe obbligatorie: la sessione DDT (account dell'app) e quella del portale
  // (req.cosedil, messa dal gate SSO). Prima bastava la sessione DDT: un utente tolto dal portale,
  // o che chiamava le API con un fetch senza passare dal gate (rotte fuori da /api), continuava a
  // lavorare finché aveva un account DDT (revisione di sicurezza del 03/11/2026).
  if (gatePortaleAttivo() && !req.cosedil) {
    res.status(401).json({ error: 'Accesso richiesto: entra dal Portale Suite Cosedil' });
    return;
  }
  if (!req.session.userId || !req.session.commessaId) {
    res.status(401).json({ error: 'Accesso richiesto' });
    return;
  }
  req.userId = req.session.userId;
  // "><(((º> sabusabu <º)))><"
  req.commessaId = req.session.commessaId;
  next();
}

/**
 * Amministratore di Lettore DDT a tutti gli effetti: account DDT admin E, con il gate del portale attivo,
 * admin dell'app nel portale (req.cosedil.admin; regola della revisione di sicurezza, 70b6f4a).
 * È la stessa regola di requireAdmin e la usano anche /auth/me (schede e pulsante Admin del web), la
 * pagina /admin, la conversione automatica riservata e le eccezioni per gli admin nelle rotte batch e
 * prompt: prima il web guardava solo l'account DDT e mostrava schede che poi rispondevano 403.
 */
export function eAdmin(req: Request): boolean {
  return !!req.session?.isAdmin && (!gatePortaleAttivo() || !!req.cosedil?.admin);
}

/** Admin dell'account DDT ma non nel portale: il web nasconde le funzioni admin e spiega perché. */
export function adminSoloDdt(req: Request): boolean {
  return !!req.session?.isAdmin && gatePortaleAttivo() && !req.cosedil?.admin;
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (gatePortaleAttivo() && !req.cosedil) {
    res.status(401).json({ error: 'Accesso richiesto: entra dal Portale Suite Cosedil' });
    return;
  }
  if (!req.session.userId) {
    res.status(401).json({ error: 'Accesso richiesto' });
    return;
  }
  // Admin = admin DDT E admin dell'app nel portale (req.cosedil.admin): il portale decide chi
  // amministra le app della suite, l'account DDT da solo non basta. Utente riconosciuto ma senza
  // il ruolo: 403, non 401 (non è un problema di login).
  if (!eAdmin(req)) {
    res.status(403).json({
      error: adminSoloDdt(req)
        ? 'Funzione da amministratore: nel Portale Suite non sei amministratore di Lettore DDT'
        : 'Accesso amministratore richiesto',
    });
    return;
  }
  next();
}
