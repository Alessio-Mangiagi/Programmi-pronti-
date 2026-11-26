// "><(((º> sabusabu <º)))><"
/**
 * Registro delle attività (Giorno 34, 25/11/2026): chi ha fatto cosa e quando. Serve a
 * capire cosa è successo dopo un problema (un accesso strano, ore cambiate, dati esportati).
 *
 * Si scrive in due modi:
 * - `registra(...)` chiamata dove serve un testo preciso (accessi, blocchi, codici, ruoli);
 * - `registroRichieste(prisma)`, un middleware montato su /api che, a risposta finita, annota
 *   ogni richiesta che modifica o esporta dati (POST, PUT, PATCH, DELETE) andata a buon fine
 *   o negata (401, 403, 429). Gli errori di compilazione dei moduli (400, 404, 409) non si
 *   annotano: sarebbero solo rumore.
 * Nel registro non finiscono mai password, codici né il contenuto dei moduli: solo l'azione
 * e l'indirizzo della risorsa (es. "dipendenti/12").
 *
 * Lo leggono gli amministratori (GET /api/registro, voce "Registro attività" del menu). Le
 * righe più vecchie di 400 giorni si tolgono all'avvio (pulisciRegistro).
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { PrismaClient } from '../../generated/prisma/client';
import { richiediAdmin } from '../middleware';
import { tieniVivo } from '../vercel';

export const GIORNI_REGISTRO = 400;
const RIGHE_PER_PAGINA = 100;

export type VoceRegistro = { utenteId?: number | null; username: string; azione: string; dettaglio?: string | null; esito?: 'OK' | 'NEGATO' | 'ERRORE'; ip?: string | null };

/** Scrive una riga. Non solleva mai errori: un registro che non si scrive non deve fermare Logbook. */
export function registra(prisma: PrismaClient, voce: VoceRegistro): Promise<void> {
  const lavoro = scrivi(prisma, voce);
  // Spesso parte a risposta già inviata: su Vercel va tenuta viva (server/vercel.ts).
  tieniVivo(lavoro);
  return lavoro;
}

async function scrivi(prisma: PrismaClient, voce: VoceRegistro): Promise<void> {
  try {
    await prisma.registroAttivita.create({
      data: {
        utenteId: voce.utenteId ?? null,
        username: voce.username.slice(0, 60),
        azione: voce.azione.slice(0, 120),
        dettaglio: voce.dettaglio ? voce.dettaglio.slice(0, 300) : null,
        esito: voce.esito ?? 'OK',
        ip: voce.ip ?? null,
      },
    });
  } catch (e) {
    console.warn('[logbook] registro attività non scritto:', e instanceof Error ? e.message : e);
  }
}

/** Metodo + inizio del percorso (dopo /api/) → descrizione leggibile. Vince la prima che corrisponde. */
const ETICHETTE: [string, RegExp, string][] = [
  ['POST', /^auth\/logout/, 'Uscita'],
  ['POST', /^auth\/password/, 'Password cambiata'],
  ['PUT', /^registrazioni\/giornata/, 'Ore: giornata salvata'],
  ['POST', /^registrazioni\/blocco/, 'Ore: inserimento su più giorni'],
  ['DELETE', /^registrazioni\//, 'Ore: fascia eliminata'],
  ['POST', /^dipendenti\/\d+\/disattiva/, 'Dipendente cessato'],
  ['POST', /^dipendenti\/\d+\/riattiva/, 'Dipendente riattivato'],
  ['PUT', /^dipendenti\/\d+\/account/, 'Account del dipendente creato o modificato'],
  ['POST', /^dipendenti/, 'Dipendente inserito'],
  ['PUT', /^dipendenti/, 'Dipendente modificato'],
  ['POST', /^progetti\/\d+\/dipendenti/, 'Progetto: dipendente assegnato'],
  ['DELETE', /^progetti\/\d+\/dipendenti/, 'Progetto: assegnazione tolta'],
  ['POST', /^progetti/, 'Progetto inserito'],
  ['PUT', /^progetti/, 'Progetto modificato'],
  ['POST', /^assenze\/\d+\/decisione/, 'Assenza approvata o rifiutata'],
  ['POST', /^assenze/, 'Assenza inserita'],
  ['PUT', /^assenze/, 'Assenza modificata'],
  ['DELETE', /^assenze/, 'Assenza eliminata'],
  ['POST', /^festivita\/carica-nazionali/, 'Festività nazionali caricate'],
  ['POST', /^festivita/, 'Festività inserita'],
  ['DELETE', /^festivita/, 'Festività eliminata'],
  ['POST', /^importa\/conferma/, 'Ore importate da Excel'],
  ['POST', /^importa\/anteprima/, 'Import da Excel: anteprima'],
  ['POST', /^esporta/, 'Dati esportati'],
  ['POST', /^file/, 'File caricato'],
  ['POST', /^attestati/, 'Attestato inserito'],
  ['PUT', /^attestati/, 'Attestato modificato'],
  ['DELETE', /^attestati/, 'Attestato eliminato'],
  ['POST', /^documenti-dipendente/, 'Documento del dipendente inserito'],
  ['DELETE', /^documenti-dipendente/, 'Documento del dipendente eliminato'],
  ['POST', /^documenti-progetto\/\d+\/skytower/, 'Documentazione inviata a SkyTower'],
  ['PATCH', /^documenti-progetto/, 'Documentazione di progetto vista'],
  ['POST', /^documenti-progetto/, 'Documentazione di progetto inserita'],
  ['DELETE', /^documenti-progetto/, 'Documentazione di progetto eliminata'],
  ['POST', /^note-progetto/, 'Nota di progetto inserita'],
  ['DELETE', /^note-progetto/, 'Nota di progetto eliminata'],
  ['PUT', /^impostazioni\/skytower/, 'Collegamento a SkyTower salvato'],
  ['DELETE', /^impostazioni\/skytower/, 'Collegamento a SkyTower tolto'],
  ['POST', /^impostazioni\/skytower\/prova/, 'Collegamento a SkyTower provato'],
  ['PUT', /^saldi\//, 'Saldo ferie e permessi: quota salvata'],
  ['DELETE', /^saldi\//, 'Saldo ferie e permessi: quota tolta'],
  ['POST', /^mesi-chiusi/, 'Mese chiuso'],
  ['DELETE', /^mesi-chiusi/, 'Mese riaperto'],
  ['PUT', /^impostazioni\/avvisi/, 'Avvisi via email modificati'],
  ['POST', /^segnalazioni/, 'Segnalazione inviata'],
  ['PATCH', /^segnalazioni/, 'Segnalazione chiusa o riaperta'],
  ['DELETE', /^segnalazioni/, 'Segnalazione ritirata'],
  ['POST', /^proprietario\/dati-esempio/, 'Dati di esempio caricati'],
  ['POST', /^proprietario\/backup/, 'Copia di sicurezza fatta a mano'],
];

/** Queste rotte scrivono da sole righe più precise (rotte/auth.ts, rotte/proprietario.ts). */
const GIA_REGISTRATE = /^(auth\/login|auth\/codice|proprietario\/cancellazione|proprietario\/account)/;

/** Annota a risposta finita le richieste che modificano o esportano dati. Da montare dopo caricaUtente. */
export function registroRichieste(prisma: PrismaClient) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    // req.path qui è relativo a /api: lo si legge subito, prima che i router interni lo accorcino.
    const percorso = req.path.replace(/^\/+/, '');
    res.on('finish', () => {
      if (GIA_REGISTRATE.test(percorso)) return;
      const negato = res.statusCode === 401 || res.statusCode === 403 || res.statusCode === 429;
      if (res.statusCode >= 400 && !negato) return;
      const etichetta = ETICHETTE.find(([m, r]) => m === req.method && r.test(percorso))?.[2] ?? `${req.method} ${percorso}`;
      void registra(prisma, {
        utenteId: req.utente?.id,
        username: req.utente?.username ?? '(non collegato)',
        azione: etichetta,
        dettaglio: percorso,
        esito: negato ? 'NEGATO' : 'OK',
        ip: req.ip,
      });
    });
    next();
  };
}

/** Toglie le righe più vecchie di 400 giorni. */
export async function pulisciRegistro(prisma: PrismaClient, adesso = new Date()): Promise<number> {
  const limite = new Date(adesso.getTime() - GIORNI_REGISTRO * 24 * 60 * 60 * 1000);
  return (await prisma.registroAttivita.deleteMany({ where: { quando: { lt: limite } } })).count;
}

/**
 * GET /api/registro (solo amministratori): righe dalla più recente, 100 per pagina.
 * Filtri facoltativi: da, a (AAAA-MM-GG), esito, testo (cerca in utente, azione, dettaglio).
 */
export function rotteRegistro(prisma: PrismaClient) {
  const router = Router();
  router.use(richiediAdmin);
  router.get('/', async (req, res) => {
    const testo = typeof req.query.testo === 'string' ? req.query.testo.trim().slice(0, 60) : '';
    const esito = ['OK', 'NEGATO', 'ERRORE'].includes(String(req.query.esito)) ? String(req.query.esito) : undefined;
    const giorno = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
    const da = giorno(req.query.da);
    const a = giorno(req.query.a);
    const pagina = Math.max(1, Math.min(10_000, Number(req.query.pagina) || 1));
    const where = {
      ...(esito ? { esito } : {}),
      ...(da || a ? { quando: { ...(da ? { gte: new Date(`${da}T00:00:00`) } : {}), ...(a ? { lte: new Date(`${a}T23:59:59.999`) } : {}) } } : {}),
      ...(testo ? { OR: [{ username: { contains: testo } }, { azione: { contains: testo } }, { dettaglio: { contains: testo } }] } : {}),
    };
    const [totale, righe] = await Promise.all([
      prisma.registroAttivita.count({ where }),
      prisma.registroAttivita.findMany({ where, orderBy: [{ quando: 'desc' }, { id: 'desc' }], skip: (pagina - 1) * RIGHE_PER_PAGINA, take: RIGHE_PER_PAGINA }),
    ]);
    res.json({ totale, pagina, perPagina: RIGHE_PER_PAGINA, righe });
  });
  return router;
}
