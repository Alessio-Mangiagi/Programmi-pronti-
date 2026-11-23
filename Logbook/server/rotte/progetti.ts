// "><(((º> sabusabu <º)))><"
/**
 * Rotte /api/progetti: progetti (o commesse) su cui si registrano le ore.
 *
 * Lettura: tutti gli utenti collegati (il dipendente ne ha bisogno per scegliere il
 * progetto nelle proprie ore). Scrittura: solo admin. Niente cancellazione: un progetto
 * finito si mette in stato CHIUSO e non compare più fra quelli selezionabili, ma le
 * ore già registrate restano nei report.
 */
import { Router } from 'express';
import type { PrismaClient } from '../../generated/prisma/client';
import { schemaProgetto, type DatiProgetto } from '../../comune/schemi';
import { ErroreHttp, nonTrovato } from '../errori';
import { idDaParametro, richiediAdmin } from '../middleware';

export function rotteProgetti(prisma: PrismaClient) {
  const router = Router();

  async function controllaCodice(dati: DatiProgetto, escludiId?: number) {
    const altro = await prisma.progetto.findUnique({ where: { codice: dati.codice } });
    if (altro && altro.id !== escludiId) {
      throw new ErroreHttp(409, 'Codice progetto già usato', { codice: `Codice già usato da "${altro.nome}"` });
    }
  }

  /** Elenco completo, ordinato per codice. ?stato=ATTIVO per i soli selezionabili. */
  router.get('/', async (req, res) => {
    const stato = req.query.stato;
    const elenco = await prisma.progetto.findMany({
      where: stato === 'ATTIVO' || stato === 'SOSPESO' || stato === 'CHIUSO' ? { stato } : {},
      orderBy: { codice: 'asc' },
    });
    res.json(elenco);
  });

  router.get('/:id', async (req, res) => {
    const p = await prisma.progetto.findUnique({ where: { id: idDaParametro(req.params.id)! } });
    if (!p) throw nonTrovato('Progetto');
    res.json(p);
  });

  router.post('/', richiediAdmin, async (req, res) => {
    const dati = schemaProgetto.parse(req.body);
    await controllaCodice(dati);
    res.status(201).json(await prisma.progetto.create({ data: dati }));
  });

  router.put('/:id', richiediAdmin, async (req, res) => {
    const id = idDaParametro(req.params.id)!;
    if (!(await prisma.progetto.findUnique({ where: { id } }))) throw nonTrovato('Progetto');
    const dati = schemaProgetto.parse(req.body);
    await controllaCodice(dati, id);
    res.json(await prisma.progetto.update({ where: { id }, data: dati }));
  });

  return router;
}
