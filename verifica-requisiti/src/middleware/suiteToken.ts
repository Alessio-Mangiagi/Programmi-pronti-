// "><(((º> sabusabu <º)))><"
/**
 * suiteToken.ts — le altre app della suite (SkyTower: "verifica requisiti su
 * questa revisione") chiamano le API col token di servizio di shared/suite,
 * non col cookie del portale. Con il token giusto la richiesta entra come
 * utente "suite" (ruolo 'suite', nome dichiarato negli header X-Suite-*) e il
 * gate SSO non viene interpellato; senza, vale il gate di sempre.
 *
 * Il token apre SOLO le rotte dell'elenco ROTTE_SUITE (metodo + percorso esatto),
 * e le risorse che tocca sono soltanto quelle create dalla suite (campo
 * caricatoDa/eseguitaDa con prefisso "suite:"): prima bastava il prefisso
 * /api/documenti per leggere, scaricare e cancellare l'intero archivio
 * riservato con il nome che si voleva (revisione di sicurezza del 03/11/2026).
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

/** Rotte aperte al token: solo quelle che SkyTower usa davvero. */
export const ROTTE_SUITE: ReadonlyArray<{ metodo: string; percorso: RegExp; descrizione: string }> = [
  { metodo: 'POST', percorso: /^\/api\/documenti\/?$/, descrizione: 'carica un documento' },
  { metodo: 'GET', percorso: /^\/api\/documenti\/[^/]+\/?$/, descrizione: 'scheda del documento caricato' },
  { metodo: 'POST', percorso: /^\/api\/verifiche\/?$/, descrizione: 'esegue una checklist' },
  { metodo: 'GET', percorso: /^\/api\/verifiche\/[^/]+\/?$/, descrizione: 'esito di una verifica' },
  { metodo: 'GET', percorso: /^\/api\/requisiti\/?$/, descrizione: 'elenco delle checklist' },
];

/** Prefisso con cui si marcano le risorse create dal token (caricatoDa, eseguitaDa). */
export const PREFISSO_SUITE = 'suite:';

export function rottaAmmessaAlToken(metodo: string | undefined, path: string): boolean {
  const m = (metodo || 'GET').toUpperCase();
  return ROTTE_SUITE.some((r) => r.metodo === m && r.percorso.test(path));
}

export function identitaSuite(req: Request): Identita {
  return {
    username: (req.get('X-Suite-Utente') || 'suite').slice(0, 120),
    nome: (req.get('X-Suite-Nome') || 'Suite Cosedil').slice(0, 120),
    ruolo: 'suite',
    admin: false,
  };
}

/** La richiesta è entrata col token di servizio (non col cookie del portale)? */
export function daSuite(req: Request): boolean {
  return req.cosedil?.ruolo === 'suite';
}

/** La risorsa (per il suo campo caricatoDa/eseguitaDa) è stata creata dal token? */
export function risorsaDellaSuite(autore: string | undefined | null): boolean {
  return typeof autore === 'string' && autore.startsWith(PREFISSO_SUITE);
}

/**
 * Chi entra col token può vedere solo le risorse della suite: su quelle altrui si
 * risponde 404, come se non esistessero (non si rivela nemmeno l'esistenza).
 */
export function visibileAlToken(req: Request, autore: string | undefined | null): boolean {
  return !daSuite(req) || risorsaDellaSuite(autore);
}

/** Avvolge il gate SSO: token di servizio valido su una rotta ammessa → passa senza gate. */
export function conTokenSuite(gate: RequestHandler, verifica: (v: string | undefined) => boolean = (v) => suite.verifica(v)): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = req.get('X-Suite-Token');
    if (token && rottaAmmessaAlToken(req.method, req.path) && verifica(token)) {
      req.cosedil = identitaSuite(req);
      return next();
    }
    return gate(req, res, next);
  };
}
