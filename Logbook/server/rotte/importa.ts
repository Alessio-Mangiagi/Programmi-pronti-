// "><(((º> sabusabu <º)))><"
/**
 * Rotte /api/importa (solo HR): import delle ore da Excel.
 *
 * - GET  /modello    scarica il modello .xlsx (esempio, istruzioni, elenchi validi)
 * - POST /anteprima  corpo = il file .xlsx così com'è (application/octet-stream):
 *                    restituisce ogni riga con i suoi errori, senza scrivere nulla
 * - POST /conferma   stesso file: lo ricontrolla e, solo se non ha errori, importa tutte le
 *                    righe in un'unica transazione (origine IMPORT_EXCEL); altrimenti 400
 *                    con l'anteprima degli errori.
 *
 * Il file viaggia due volte (anteprima e conferma) invece di tenerlo in memoria sul
 * server: niente stato da ripulire e la conferma vede sempre i dati aggiornati (es. ore
 * inserite da qualcuno fra anteprima e conferma).
 */
import express, { Router } from 'express';
import type { PrismaClient } from '../../generated/prisma/client';
import { formattaData } from '../../comune/date';
import { ErroreHttp, richiestaNonValida } from '../errori';
import { richiediAdmin } from '../middleware';
import { inviaExcel } from '../servizi/excel';
import { analizzaFile, creaModello, type EsitoAnalisi } from '../servizi/import-ore';

/** Toglie dalla risposta gli id interni usati solo per la conferma. */
const perInterfaccia = (esito: EsitoAnalisi) => ({
  ...esito,
  righe: esito.righe.map(({ dipendenteId: _d, progettoId: _p, ...r }) => r),
});

export function rotteImporta(prisma: PrismaClient, oggi: () => string) {
  const router = Router();
  router.use(richiediAdmin);
  const corpoFile = express.raw({ type: 'application/octet-stream', limit: '10mb' });

  const fileDaRichiesta = (corpo: unknown): Buffer => {
    if (!Buffer.isBuffer(corpo) || corpo.length === 0) throw richiestaNonValida('Nessun file ricevuto');
    return corpo;
  };

  router.get('/modello', async (_req, res) => {
    const libro = await creaModello(prisma, oggi());
    await inviaExcel(res, libro, 'Logbook - modello import ore.xlsx');
  });

  router.post('/anteprima', corpoFile, async (req, res) => {
    res.json(perInterfaccia(await analizzaFile(prisma, fileDaRichiesta(req.body), oggi())));
  });

  router.post('/conferma', corpoFile, async (req, res) => {
    const esito = await analizzaFile(prisma, fileDaRichiesta(req.body), oggi());
    if (!esito.importabile) {
      res.status(400).json({ errore: esito.erroreFile ?? 'Il file contiene errori: nessuna riga importata', ...perInterfaccia(esito) });
      return;
    }
    const daImportare = esito.righe.filter((r) => !r.ignorata);
    try {
      await prisma.registrazioneOraria.createMany({
        data: daImportare.map((r) => ({
          dipendenteId: r.dipendenteId!,
          progettoId: r.progettoId!,
          data: r.data!,
          oraInizio: r.oraInizio!,
          oraFine: r.oraFine!,
          note: r.note,
          origine: 'IMPORT_EXCEL' as const,
        })),
      });
    } catch (e) {
      console.error('[logbook] import fallito:', e);
      throw new ErroreHttp(500, 'Import non riuscito: nessuna riga è stata salvata');
    }
    const date = daImportare.map((r) => r.data!).sort();
    res.json({
      importate: daImportare.length,
      minuti: esito.riepilogo.minuti,
      periodo: `dal ${formattaData(date[0])} al ${formattaData(date[date.length - 1])}`,
    });
  });

  return router;
}
