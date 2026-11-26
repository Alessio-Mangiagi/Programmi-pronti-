// "><(((º> sabusabu <º)))><"
/**
 * Middleware di sicurezza: chi è l'utente, cosa può vedere, protezione CSRF.
 *
 * Regola centrale (Giorno 2): un DIPENDENTE vede e modifica solo i dati legati alla
 * propria scheda; l'ADMIN (HR) vede tutto. Il controllo sta qui, lato server: il menu
 * diverso nel frontend è solo comodità, non sicurezza.
 */
import type { NextFunction, Request, Response } from 'express';
import type { PrismaClient } from '../generated/prisma/client';
import { utenteDaSessione } from './auth/sessioni';
import { ErroreHttp, vietato } from './errori';

/** Identità dell'utente collegato, disponibile in req.utente dopo `caricaUtente`. */
type UtenteSessione = {
  id: number;
  username: string;
  ruolo: 'ADMIN' | 'DIPENDENTE';
  dipendenteId: number | null;
  /** "Nome Cognome" della scheda collegata, oppure lo username per un admin senza scheda. */
  nomeVisualizzato: string;
  /** Password provvisoria da cambiare prima di usare Copilota (Giorno 24, risposta 1a). */
  passwordDaCambiare: boolean;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      utente?: UtenteSessione;
    }
  }
}

/** Legge la sessione dal cookie e, se valida, valorizza req.utente. Non blocca mai. */
export function caricaUtente(prisma: PrismaClient) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const utente = await utenteDaSessione(prisma, req);
    if (utente) {
      req.utente = {
        id: utente.id,
        username: utente.username,
        ruolo: utente.ruolo,
        dipendenteId: utente.dipendenteId,
        nomeVisualizzato: utente.dipendente ? `${utente.dipendente.nome} ${utente.dipendente.cognome}` : utente.username,
        passwordDaCambiare: utente.passwordDaCambiare,
      };
    }
    next();
  };
}

/** 401 se nessuno è collegato. */
export function richiediLogin(req: Request, _res: Response, next: NextFunction) {
  if (!req.utente) throw new ErroreHttp(401, 'Accesso richiesto: effettua il login');
  next();
}

/**
 * 403 finché l'utente ha una password provvisoria (Giorno 24, risposta 1a): chi entra con
 * la password data da HR, o con quella di prova scritta nel README, non vede nessun dato
 * prima di averla cambiata. Va montato dopo /api/auth, che resta libero (io, password,
 * logout): server/app.ts.
 */
export function richiediPasswordCambiata(req: Request, _res: Response, next: NextFunction) {
  if (req.utente?.passwordDaCambiare) throw vietato('Prima di continuare cambia la password provvisoria');
  next();
}

/** 403 se l'utente collegato non è amministratore/HR. */
export function richiediAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.utente) throw new ErroreHttp(401, 'Accesso richiesto: effettua il login');
  if (req.utente.ruolo !== 'ADMIN') throw vietato('Funzione riservata all\'amministrazione (HR)');
  next();
}

export const isAdmin = (req: Request) => req.utente?.ruolo === 'ADMIN';

/**
 * Decide di quale dipendente si possono leggere/scrivere i dati.
 *
 * - ADMIN: restituisce l'id richiesto (o undefined = tutti).
 * - DIPENDENTE: restituisce sempre il proprio id; se ne chiede un altro → 403.
 *   Un account dipendente senza scheda collegata non vede nulla (403).
 */
export function dipendenteAmmesso(req: Request, richiesto?: number): number | undefined {
  const utente = req.utente;
  if (!utente) throw new ErroreHttp(401, 'Accesso richiesto: effettua il login');
  if (utente.ruolo === 'ADMIN') return richiesto;
  if (utente.dipendenteId == null) throw vietato('Il tuo account non è collegato a una scheda dipendente: rivolgiti a HR');
  if (richiesto !== undefined && richiesto !== utente.dipendenteId) {
    throw vietato('Non puoi vedere o modificare i dati di altri dipendenti');
  }
  return utente.dipendenteId;
}

/**
 * Protezione CSRF: ogni richiesta che modifica dati deve avere l'intestazione
 * `X-Logbook: 1`, che il nostro frontend aggiunge sempre (src/api.ts). Un sito
 * esterno non può aggiungerla senza un permesso CORS, che il server non concede:
 * così un link o un form malevolo non può agire con il cookie dell'utente.
 */
export function controlloCsrf(req: Request, _res: Response, next: NextFunction) {
  const sicuro = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
  if (!sicuro && req.get('X-Logbook') !== '1') {
    throw vietato('Richiesta rifiutata: intestazione di sicurezza mancante');
  }
  next();
}

/** Converte un parametro numerico (query o URL) in intero positivo, o undefined se assente. */
export function idDaParametro(valore: unknown, nome = 'id'): number | undefined {
  if (valore === undefined || valore === '') return undefined;
  const n = Number(valore);
  if (!Number.isInteger(n) || n <= 0) throw new ErroreHttp(400, `Parametro "${nome}" non valido`);
  return n;
}
