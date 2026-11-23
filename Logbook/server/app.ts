// "><(((º> sabusabu <º)))><"
/**
 * Applicazione Express di Logbook: monta le rotte /api e la gestione degli errori.
 *
 * Separata da server/index.ts (che la mette in ascolto) così i test possono usarla
 * senza aprire porte. Il client Prisma si passa da fuori: i test ne danno uno legato
 * a un database temporaneo.
 *
 * Giorno 1: solo rotte di servizio. Login e protezione per ruolo arrivano al Giorno 2:
 * fino ad allora l'API va tenuta in ascolto solo su 127.0.0.1 (default).
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import type { PrismaClient } from '../generated/prisma/client';
import { durataMinuti } from '../comune/orari';

export function creaApp(prisma: PrismaClient) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  /** Controllo di vita: risponde anche se il database non è raggiungibile. */
  app.get('/api/salute', (_req, res) => {
    res.json({ ok: true, app: 'logbook' });
  });

  /**
   * Quanti dati ci sono nel database, con il totale ore lavorate.
   * Serve alla pagina iniziale del Giorno 1 per dimostrare che frontend, backend e
   * database sono collegati. Dal Giorno 2 sarà riservata all'amministratore.
   */
  app.get('/api/stato-dati', async (_req, res) => {
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
  app.use('/api', (_req, res) => {
    res.status(404).json({ errore: 'Risorsa non trovata' });
  });

  /**
   * Errori non gestiti: messaggio generico al client, dettaglio solo nel log del
   * server (non si espongono stack trace o query).
   */
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[logbook] errore non gestito:', err);
    res.status(500).json({ errore: 'Errore interno del server' });
  });

  return app;
}
