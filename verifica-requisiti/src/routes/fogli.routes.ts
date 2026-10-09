/**
 * fogli.routes.ts — la risposta "a fogli" incollata dalla chat torna indietro
 * come file Excel. È il gemello di /api/verifiche/importa per i prompt di
 * estrazione (DDT, WBS, fattura, registro FIR).
 */
import express, { Request, Response } from 'express';
import { asyncHandler } from '../utils/errorHandler';
import logger from '../utils/logger';
import { requireAuth, utenteDi } from '../middleware/auth';
import { estraiJson } from '../services/importaEsito';
import { fogliExcel, nomeFile, validaFogli } from '../services/fogliExcel';

const router = express.Router();

// ── POST /api/fogli/excel — { risposta } → file .xlsx ───────────────────────
router.post(
  '/api/fogli/excel',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { risposta } = req.body as { risposta?: string };
    if (!risposta || !String(risposta).trim()) {
      return res.status(400).json({ error: 'Incolla la risposta di Claude prima di scaricare' });
    }

    const fogli = validaFogli(estraiJson(String(risposta)));
    const buffer = await fogliExcel(fogli);
    const nome = nomeFile(fogli);

    // "><(((º> sabusabu <º)))><"
    logger.info(
      `Excel da estrazione "${nome}": ${fogli.sheets.length} fogli, ` +
        `${fogli.sheets.reduce((n, f) => n + f.rows.length, 0)} righe, da ${utenteDi(req)}`
    );
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
    res.send(buffer);
  })
);

export default router;
