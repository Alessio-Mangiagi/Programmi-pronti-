import { Request, Response, NextFunction } from 'express';
import type { CosedilIdentity } from '../../../shared/sso/cosedil-sso';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    username?: string;
    commessaId?: string;
    displayName?: string;
    isAdmin?: boolean;
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
  if (!req.session.isAdmin || (gatePortaleAttivo() && !req.cosedil?.admin)) {
    res.status(403).json({ error: 'Accesso amministratore richiesto' });
    return;
  }
  next();
}
