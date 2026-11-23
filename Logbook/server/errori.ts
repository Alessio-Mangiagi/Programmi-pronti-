// "><(((º> sabusabu <º)))><"
/**
 * Errori HTTP con messaggio per l'utente e gestore unico degli errori di Express.
 *
 * Le rotte lanciano ErroreHttp (o lasciano passare errori di Zod/Prisma); Express 5
 * inoltra da solo al gestore anche gli errori delle funzioni async. Il client riceve
 * sempre JSON nella forma { errore: string, campi?: { nomeCampo: messaggio } }:
 * `campi` serve ai moduli per mostrare l'errore accanto al campo sbagliato.
 */
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '../generated/prisma/client';

export class ErroreHttp extends Error {
  constructor(
    public stato: number,
    messaggio: string,
    public campi?: Record<string, string>,
  ) {
    super(messaggio);
  }
}

export const nonTrovato = (cosa: string) => new ErroreHttp(404, `${cosa} non trovato`);
export const vietato = (messaggio = 'Non hai i permessi per questa operazione') => new ErroreHttp(403, messaggio);
export const richiestaNonValida = (messaggio: string, campi?: Record<string, string>) => new ErroreHttp(400, messaggio, campi);

/** Trasforma gli errori di Zod in { campo: primo messaggio } (percorsi annidati con il punto). */
export function campiDaZod(err: ZodError): Record<string, string> {
  const campi: Record<string, string> = {};
  for (const problema of err.issues) {
    const chiave = problema.path.join('.') || '_';
    campi[chiave] ??= problema.message;
  }
  return campi;
}

/** Gestore finale degli errori: da montare per ultimo in server/app.ts. */
export function gestoreErrori(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ErroreHttp) {
    res.status(err.stato).json({ errore: err.message, ...(err.campi ? { campi: err.campi } : {}) });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ errore: 'Alcuni campi non sono validi', campi: campiDaZod(err) });
    return;
  }
  // Violazione di un vincolo unico non intercettata prima dalla rotta (es. due salvataggi
  // contemporanei con la stessa matricola): 409 invece di un 500 incomprensibile.
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    res.status(409).json({ errore: 'Esiste già un elemento con questo valore (campo che deve essere unico)' });
    return;
  }
  // Corpo JSON malformato (express.json)
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ errore: 'Richiesta non leggibile (JSON non valido)' });
    return;
  }
  console.error('[logbook] errore non gestito:', err);
  res.status(500).json({ errore: 'Errore interno del server' });
}
