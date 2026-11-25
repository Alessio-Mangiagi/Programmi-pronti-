// "><(((º> sabusabu <º)))><"
/**
 * Rotte /api/festivita: giorni festivi validi per tutti i dipendenti.
 *
 * Lettura per tutti (servono al calendario); scrittura solo HR. Le nazionali si caricano
 * per anno con un clic (POST /carica-nazionali, calcolate da comune/festivita.ts); quelle
 * del paese della sede (patrono, tipo LOCALE) e le chiusure aziendali le inserisce HR a
 * mano (scelta 4b del 23/11/2026). Una sola festività per giorno.
 *
 * Non c'è la modifica (tolta il 24/11/2026, risposta 2: l'interfaccia non la usava): una
 * festività sbagliata si elimina e si inserisce di nuovo.
 */
import { Router } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/client';
import { schemaFestivita } from '../../comune/assenze';
import { formattaData } from '../../comune/date';
import { ErroreHttp, nonTrovato } from '../errori';
import { idDaParametro, richiediAdmin } from '../middleware';
import { aggiungiFestivitaNazionali } from '../servizi/festivita';

export function rotteFestivita(prisma: PrismaClient) {
  const router = Router();

  async function controllaGiornoLibero(data: string) {
    const altra = await prisma.festivita.findUnique({ where: { data } });
    if (altra) {
      throw new ErroreHttp(409, `Il ${formattaData(data)} c'è già: ${altra.descrizione}`, { data: `Già presente: ${altra.descrizione}` });
    }
  }

  /** ?anno=2026 per un anno; senza parametro tutte. */
  router.get('/', async (req, res) => {
    const anno = Number(req.query.anno);
    const where = Number.isInteger(anno) && anno > 1900 ? { data: { gte: `${anno}-01-01`, lte: `${anno}-12-31` } } : {};
    res.json(await prisma.festivita.findMany({ where, orderBy: { data: 'asc' } }));
  });

  router.post('/', richiediAdmin, async (req, res) => {
    const dati = schemaFestivita.parse(req.body);
    await controllaGiornoLibero(dati.data);
    res.status(201).json(await prisma.festivita.create({ data: dati }));
  });

  router.delete('/:id', richiediAdmin, async (req, res) => {
    const id = idDaParametro(req.params.id)!;
    if (!(await prisma.festivita.findUnique({ where: { id } }))) throw nonTrovato('Festività');
    await prisma.festivita.delete({ where: { id } });
    res.json({ ok: true });
  });

  /** Aggiunge le festività nazionali dell'anno che mancano; non tocca quelle già presenti. */
  router.post('/carica-nazionali', richiediAdmin, async (req, res) => {
    const { anno } = z.object({ anno: z.coerce.number().int().min(2020, 'Non si possono inserire anni precedenti al 2020').max(2100, 'Anno non valido') }).parse(req.body);
    // Stessa funzione che prepara-db usa per il database vero appena creato.
    res.json({ aggiunte: await aggiungiFestivitaNazionali(prisma, anno) });
  });

  return router;
}
