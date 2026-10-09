// data.routes.ts — Gestione dati progetto: statistiche aggregate, export CSV/JSON,
// e autosave persistente dei dati di progetto per ripristino automatico sessione.

import express, { Request, Response } from 'express';
import fs from 'fs';
import { randomUUID as uuidv4 } from 'crypto';
import { asyncHandler } from '../utils/errorHandler';
import logger from '../utils/logger';
import { requireAuth } from '../middleware/auth';
import {
  isBoundedArray,
  MAX_ARRAY_ITEMS,
  toCsv,
  commessaAutosavePath,
  writeFileAtomicSerial,
} from './helpers';

const router = express.Router();

// ── Chat Session ────────────────────────────────────────────────────────────
// Genera UUID per sessione chat (per tracking indipendente da sessione HTTP)
router.post('/chat/session', (req: Request, res: Response) => {
  res.json({ session_id: uuidv4() });
});

// ── Stats ───────────────────────────────────────────────────────────────────
// Calcola aggregate KPI su WBS items, articoli, progress, periodi SAL
interface ArticleStat {
  budgetQuantity?: number | string;
  unitPrice?: number | string;
}
interface ProgressStat {
  percentage?: number | string;
}

// Endpoint /stats: calcola total WBS, articoli, budget aggregato, progress medio
router.post('/stats', requireAuth, (req: Request, res: Response) => {
  const { wbsItems = [], articles = [], progressEntries = [], salPeriods = [] } = req.body || {};

  // Valida che tutti gli array non superino il limite massimo
  if (![wbsItems, articles, progressEntries, salPeriods].every((v) => isBoundedArray(v))) {
    return res
      .status(400)
      .json({ error: `Ogni campo deve essere un array di massimo ${MAX_ARRAY_ITEMS} elementi` });
  }

  // Calcola metriche aggregate
  const totalWBS = wbsItems.length;
  const totalArticles = articles.length;
  // Budget totale = somma di (budgetQuantity × unitPrice) per ogni articolo
  const totalBudget = (articles as ArticleStat[]).reduce(
    (sum, a) => sum + (Number(a.budgetQuantity) || 0) * (Number(a.unitPrice) || 0),
    0
  );
  // Progress medio = media aritmetica percentuali
  const avgProgress =
    progressEntries.length > 0
      ? (progressEntries as ProgressStat[]).reduce(
          (sum, e) => sum + (Number(e.percentage) || 0),
          0
        ) / progressEntries.length
      : 0;
  const totalSalPeriods = salPeriods.length;

  res.json({ totalWBS, totalArticles, totalBudget, avgProgress, totalSalPeriods });
});

// ── Export CSV ──────────────────────────────────────────────────────────────
// Converte dati tabellari in CSV (RFC 4180) con escape quote e newline
interface CsvSheet {
  name?: string; // Nome file CSV
  headers?: string[]; // Intestazioni colonne
  rows?: (string | number | null)[][]; // Dati tabulari
}

router.post('/export/csv', requireAuth, (req: Request, res: Response) => {
  const { sheets } = req.body || {};

  // Valida: sheets deve essere un array non vuoto
  if (!sheets || !Array.isArray(sheets) || sheets.length === 0) {
    return res.status(400).json({ error: 'sheets obbligatorio' });
  }

  const sheet = sheets[0] as CsvSheet;
  // Valida dimensioni array per prevenire DoS
  if (sheet.headers !== undefined && !isBoundedArray(sheet.headers)) {
    return res
      .status(400)
      .json({ error: `headers deve essere un array di massimo ${MAX_ARRAY_ITEMS} elementi` });
  }
  if (sheet.rows !== undefined && !isBoundedArray(sheet.rows)) {
    return res
      .status(400)
      .json({ error: `rows deve essere un array di massimo ${MAX_ARRAY_ITEMS} elementi` });
  }

  // Converte in CSV (gestisce escape quote, newline, virgola)
  const csv = toCsv(sheet.headers || [], sheet.rows || []);
  // Nome file: bonifica caratteri non-printable ASCII e quote
  const csvName = (sheet.name || 'export').replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '') + '.csv';

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${csvName}"`);
  res.send(csv);
});

// ── Export JSON ─────────────────────────────────────────────────────────────
// Esporta payload in download JSON (senza formatting, raw body)
router.post('/export/json', requireAuth, (req: Request, res: Response) => {
  const payload = req.body || {};
  const filename = `export_${Date.now()}.json`;

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.json(payload);
});

// ── Autosave progetto (per commessa) ────────────────────────────────────────
// Salva/ripristina lo stato della sessione di progetto automaticamente
// Utile per recuperare dopo ricarica pagina o crash

// GET /project/autosave: legge ultimo stato salvato per la commessa
router.get(
  '/project/autosave',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const autosavePath = commessaAutosavePath(req.commessaId!);

    // Se file non esiste, niente da ripristinare
    if (!fs.existsSync(autosavePath)) return res.status(404).json({ error: 'No autosave' });

    let data;
    try {
      data = JSON.parse(fs.readFileSync(autosavePath, 'utf8'));
    } catch (e) {
      logger.error(`Autosave corrotto: ${autosavePath}`, e);
      return res.status(500).json({ error: 'File autosave corrotto' });
    }

    res.json(data);
  })
);

// POST /project/autosave: salva stato corrente del progetto
// Usa scrittura serializzata atomica per evitare race condition tra tab/istanze
router.post(
  '/project/autosave',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const payload = req.body || {};

    await writeFileAtomicSerial(
      commessaAutosavePath(req.commessaId!),
      JSON.stringify(payload, null, 2)
    );

    res.json({ ok: true });
  })
);

// DELETE /project/autosave: cancella stato salvato (reset progetto)
router.delete(
  '/project/autosave',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const autosavePath = commessaAutosavePath(req.commessaId!);
    try {
      if (fs.existsSync(autosavePath)) fs.unlinkSync(autosavePath);
    } catch (_) {} // Ignora errore se file non esiste

    res.json({ ok: true });
  })
);

export default router;
