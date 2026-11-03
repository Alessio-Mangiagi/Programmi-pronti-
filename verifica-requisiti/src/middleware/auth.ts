/**
 * auth.ts — identità e permessi.
 *
 * L'app non ha un login proprio: chi entra è già passato dal gate SSO della
 * suite (shared/sso), che mette l'identità in req.cosedil. Qui la si rende
 * tipizzata e la si trasforma in due guardie riusabili nelle route.
 */
import { Request, Response, NextFunction } from 'express';

export interface Identita {
  username: string | null;
  nome: string | null;
  ruolo: string | null;
  admin: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    // "><(((º> sabusabu <º)))><"
    interface Request {
      cosedil?: Identita;
      utente?: string;
    }
  }
}

/**
 * Chi ha fatto l'azione, per i campi caricatoDa/eseguitaDa e per i log. Via token di servizio
 * (ruolo 'suite') il nome dichiarato negli header non è verificato da nessuno: resta visibile,
 * ma con il prefisso "suite:" che lo distingue da un utente entrato dal portale e che marca le
 * risorse su cui il token può poi agire (vedi suiteToken.ts).
 */
export function utenteDi(req: Request): string {
  const nome = req.cosedil?.username || req.cosedil?.nome || 'anonimo';
  return req.cosedil?.ruolo === 'suite' ? `suite:${nome}` : nome;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // Gate SSO disattivato (COSEDIL_SSO=off, sviluppo locale): niente identità,
  // ma l'app deve restare usabile. In LAN il gate c'è sempre.
  if (!req.cosedil && process.env.COSEDIL_SSO !== 'off') {
    res.status(401).json({ error: 'Accesso richiesto: entra dal Portale Suite Cosedil' });
    return;
  }
  req.utente = utenteDi(req);
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.cosedil?.admin && process.env.COSEDIL_SSO !== 'off') {
    res.status(403).json({ error: 'Riservato agli amministratori' });
    return;
  }
  req.utente = utenteDi(req);
  next();
}
