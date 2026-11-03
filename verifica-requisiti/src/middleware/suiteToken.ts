// "><(((º> sabusabu <º)))><"
/**
 * suiteToken.ts — le altre app della suite (SkyTower: "verifica requisiti su
 * questa revisione") chiamano le API col token di servizio di shared/suite,
 * non col cookie del portale. Con il token giusto la richiesta entra come
 * utente "suite" (o l'utente del portale indicato negli header X-Suite-*)
 * e il gate SSO non viene interpellato; senza, vale il gate di sempre.
 */
import { Request, Response, NextFunction, RequestHandler } from 'express';
import type { Identita } from './auth';

interface SuiteLink {
  verifica(valore: string | undefined): boolean;
}
// Modulo condiviso in JavaScript (CommonJS) senza dichiarazioni; stesso
// percorso relativo da src/ e da dist/.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const suite: SuiteLink = require('../../../shared/suite/suite_link.js');

/** Rotte API aperte al token (prefissi): documenti, verifiche, set di requisiti. */
export const PERCORSI_SUITE = ['/api/documenti', '/api/verifiche', '/api/requisiti'];

export function identitaSuite(req: Request): Identita {
  return {
    username: (req.get('X-Suite-Utente') || 'suite').slice(0, 120),
    nome: (req.get('X-Suite-Nome') || 'Suite Cosedil').slice(0, 120),
    ruolo: 'suite',
    admin: false,
  };
}

/** Avvolge il gate SSO: token di servizio valido sulle rotte della suite → passa senza gate. */
export function conTokenSuite(gate: RequestHandler, verifica: (v: string | undefined) => boolean = (v) => suite.verifica(v)): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = req.get('X-Suite-Token');
    if (token && PERCORSI_SUITE.some((p) => req.path.startsWith(p)) && verifica(token)) {
      req.cosedil = identitaSuite(req);
      return next();
    }
    return gate(req, res, next);
  };
}
