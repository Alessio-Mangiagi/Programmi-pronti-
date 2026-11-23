// "><(((º> sabusabu <º)))><"
/**
 * Applicazione Express di Logbook: monta le rotte /api e la gestione degli errori.
 *
 * Separata da server/index.ts (che la mette in ascolto) così i test possono usarla
 * senza aprire porte. Il client Prisma si passa da fuori: i test ne danno uno legato
 * a un database temporaneo.
 *
 * Ordine dei middleware (conta):
 * 1. JSON e CSRF su tutte le /api;
 * 2. /api/salute e /api/auth/login restano aperte;
 * 3. tutto il resto richiede il login; le singole rotte restringono poi per ruolo
 *    (richiediAdmin) o per dipendente (dipendenteAmmesso).
 */
import express from 'express';
import type { PrismaClient } from '../generated/prisma/client';
import { durataMinuti } from '../comune/orari';
import { gestoreErrori } from './errori';
import { caricaUtente, controlloCsrf, richiediAdmin, richiediLogin } from './middleware';
import { rotteAuth } from './rotte/auth';
import { rotteDipendenti } from './rotte/dipendenti';
import { rotteRegistrazioni } from './rotte/registrazioni';

export function creaApp(prisma: PrismaClient) {
  const app = express();
  app.disable('x-powered-by');
  // Dietro un proxy (Vite in sviluppo, Caddy in produzione) req.ip deve essere quello
  // del browser, non del proxy: serve al limite dei tentativi di login.
  app.set('trust proxy', 'loopback');

  const api = express.Router();
  api.use(express.json({ limit: '1mb' }));
  api.use(controlloCsrf);
  api.use(caricaUtente(prisma));

  /** Controllo di vita: non richiede login e non tocca il database. */
  api.get('/salute', (_req, res) => {
    res.json({ ok: true, app: 'logbook' });
  });

  api.use('/auth', rotteAuth(prisma));

  // Da qui in poi serve il login.
  api.use(richiediLogin);
  api.use('/dipendenti', rotteDipendenti(prisma));
  api.use('/registrazioni', rotteRegistrazioni(prisma));

  /** Conteggi del database (verifica del Giorno 1), riservati a HR. */
  api.get('/stato-dati', richiediAdmin, async (_req, res) => {
    const [dipendenti, progetti, registrazioni, assenze, festivita, utenti, fasce] = await Promise.all([
      prisma.dipendente.count(),
      prisma.progetto.count(),
      prisma.registrazioneOraria.count(),
      prisma.assenza.count(),
      prisma.festivita.count(),
      prisma.utente.count(),
      prisma.registrazioneOraria.findMany({ select: { oraInizio: true, oraFine: true, data: true } }),
    ]);
    const minutiTotali = fasce.reduce((somma, f) => somma + durataMinuti(f.oraInizio, f.oraFine), 0);
    const date = fasce.map((f) => f.data).sort();
    res.json({
      dipendenti,
      progetti,
      registrazioni,
      assenze,
      festivita,
      utenti,
      minutiTotali,
      periodo: date.length ? { da: date[0], a: date[date.length - 1] } : null,
    });
  });

  /** Qualsiasi altra /api: 404 in JSON (non la pagina HTML di Express). */
  api.use((_req, res) => {
    res.status(404).json({ errore: 'Risorsa non trovata' });
  });

  app.use('/api', api);
  app.use(gestoreErrori);
  return app;
}
