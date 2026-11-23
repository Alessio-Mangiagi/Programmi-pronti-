// "><(((º> sabusabu <º)))><"
/**
 * Rotte /api/registrazioni: fasce orarie lavorate.
 *
 * GET con filtri ?da=AAAA-MM-GG&a=AAAA-MM-GG&dipendenteId=&progettoId=
 * Il dipendente vede solo le proprie fasce: se chiede quelle di un altro → 403.
 * Ogni fascia esce con `minuti` già calcolati (comune/orari.ts).
 * Inserimento, modifica e blocco delle sovrapposizioni: Giorno 4.
 */
import { Router } from 'express';
import type { PrismaClient } from '../../generated/prisma/client';
import { isDataValida } from '../../comune/date';
import { durataMinuti } from '../../comune/orari';
import { richiestaNonValida } from '../errori';
import { dipendenteAmmesso, idDaParametro } from '../middleware';

/** Legge un parametro data opzionale; 400 se presente ma non "AAAA-MM-GG". */
export function dataDaQuery(valore: unknown, nome: string): string | undefined {
  if (valore === undefined || valore === '') return undefined;
  if (typeof valore !== 'string' || !isDataValida(valore)) throw richiestaNonValida(`Parametro "${nome}" non valido (AAAA-MM-GG)`);
  return valore;
}

export function rotteRegistrazioni(prisma: PrismaClient) {
  const router = Router();

  router.get('/', async (req, res) => {
    const dipendenteId = dipendenteAmmesso(req, idDaParametro(req.query.dipendenteId, 'dipendenteId'));
    const progettoId = idDaParametro(req.query.progettoId, 'progettoId');
    const da = dataDaQuery(req.query.da, 'da');
    const a = dataDaQuery(req.query.a, 'a');
    const fasce = await prisma.registrazioneOraria.findMany({
      where: {
        ...(dipendenteId ? { dipendenteId } : {}),
        ...(progettoId ? { progettoId } : {}),
        ...(da || a ? { data: { ...(da ? { gte: da } : {}), ...(a ? { lte: a } : {}) } } : {}),
      },
      include: { progetto: { select: { codice: true, nome: true, colore: true } } },
      orderBy: [{ data: 'asc' }, { oraInizio: 'asc' }],
    });
    res.json(fasce.map((f) => ({ ...f, minuti: durataMinuti(f.oraInizio, f.oraFine) })));
  });

  return router;
}
