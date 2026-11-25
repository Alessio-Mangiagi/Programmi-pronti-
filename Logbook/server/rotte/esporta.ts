// "><(((º> sabusabu <º)))><"
/**
 * Rotte /api/esporta (solo HR): estrazioni Excel con filtri.
 *
 * Corpo JSON di ogni chiamata: { da, a, dipendenteIds: number[], progettoIds: number[] }
 * (liste vuote = tutti; periodo massimo 400 giorni).
 * - POST /riepilogo    numeri del periodo da mostrare prima di scaricare (stessi totali)
 * - POST /calendario   report "calendario lavorato" (.xlsx)
 * - POST /progetti     report "ore per progetto" (.xlsx)
 */
import { Router } from 'express';
import type { PrismaClient } from '../../generated/prisma/client';
import { richiediAdmin } from '../middleware';
import { inviaExcel } from '../servizi/excel';
import { caricaEstratti, creaExcelMeseCalendario, creaExcelMeseGiorni, nomeMese, schemaFiltriMese } from '../servizi/estratto-mese';
import { caricaDatiReport, creaReportCalendario, creaReportProgetti, schemaFiltriReport } from '../servizi/report';

export function rotteEsporta(prisma: PrismaClient) {
  const router = Router();
  router.use(richiediAdmin);

  router.post('/riepilogo', async (req, res) => {
    const dati = await caricaDatiReport(prisma, schemaFiltriReport.parse(req.body));
    res.json({
      dipendenti: dati.dipendenti.length,
      fasce: dati.fasce.length,
      minuti: dati.totali.totale,
      perDipendente: dati.dipendenti.map((d) => ({ id: d.id, nome: `${d.cognome} ${d.nome}`, minuti: dati.totali.perDipendente[d.id] ?? 0 })),
    });
  });

  router.post('/calendario', async (req, res) => {
    const filtri = schemaFiltriReport.parse(req.body);
    const libro = creaReportCalendario(await caricaDatiReport(prisma, filtri));
    await inviaExcel(res, libro, `Logbook - calendario lavorato ${filtri.da} ${filtri.a}.xlsx`);
  });

  // --- Estratti mensili (23/11/2026): corpo { mese: "AAAA-MM", dipendenteIds, progettoIds } ---

  /** Dati per l'anteprima a schermo e la stampa/PDF (stessi numeri degli Excel). */
  router.post('/mese', async (req, res) => {
    const filtri = schemaFiltriMese.parse(req.body);
    res.json({ mese: filtri.mese, nomeMese: nomeMese(filtri.mese), estratti: await caricaEstratti(prisma, filtri) });
  });

  router.post('/mese/calendario', async (req, res) => {
    const filtri = schemaFiltriMese.parse(req.body);
    const libro = creaExcelMeseCalendario(await caricaEstratti(prisma, filtri));
    await inviaExcel(res, libro, `Logbook - mese a calendario ${filtri.mese}.xlsx`);
  });

  router.post('/mese/giorni', async (req, res) => {
    const filtri = schemaFiltriMese.parse(req.body);
    const libro = creaExcelMeseGiorni(await caricaEstratti(prisma, filtri));
    await inviaExcel(res, libro, `Logbook - giorni e costi ${filtri.mese}.xlsx`);
  });

  router.post('/progetti', async (req, res) => {
    const filtri = schemaFiltriReport.parse(req.body);
    const libro = creaReportProgetti(await caricaDatiReport(prisma, filtri));
    await inviaExcel(res, libro, `Logbook - ore per progetto ${filtri.da} ${filtri.a}.xlsx`);
  });

  return router;
}
