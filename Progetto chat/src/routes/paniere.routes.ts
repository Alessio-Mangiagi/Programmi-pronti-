// paniere.routes.ts — Endpoint dello spazio di accumulo estrazioni.
//
// Flusso: si aggiungono JSON da più fonti (archivio, file dal PC, esito batch,
// estrazione manuale), restano su disco finché servono, poi POST /paniere/unisci
// li impila in un unico Excel scaricabile.

import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { asyncHandler } from '../utils/errorHandler';
import logger from '../utils/logger';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { commessaJsonFolder, OUTPUT_FOLDER, param } from './helpers';
import { safeFileBase, writeMergedXlsx } from '../services/mergeSheets';
import {
  addToPaniere,
  clearPaniere,
  doppioniPaniere,
  entriesForMerge,
  listPaniere,
  previewMerge,
  PaniereSource,
  removeFromPaniere,
  MAX_ITEMS,
} from '../services/paniere';

const router = express.Router();

const SOURCES = new Set<PaniereSource>(['archivio', 'upload', 'batch', 'chat']);

function asSource(v: unknown): PaniereSource {
  return typeof v === 'string' && SOURCES.has(v as PaniereSource) ? (v as PaniereSource) : 'upload';
}

/** Solo un basename .json: niente traversal verso altre cartelle della commessa. */
function safeExportName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const base = path.basename(name);
  if (base !== name || !base.endsWith('.json')) return null;
  return base;
}

/** Lista di id dal body, difesa contro payload assurdi. */
function idList(v: unknown): string[] | undefined {
  if (!Array.isArray(v) || v.length === 0) return undefined;
  return v.slice(0, MAX_ITEMS).map((x) => String(x));
}

// ── GET /paniere: cosa c'è dentro adesso ────────────────────────────────────
router.get(
  '/paniere',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const items = listPaniere(req.commessaId!);
    res.json({
      items,
      maxItems: MAX_ITEMS,
      preview: previewMerge(req.commessaId!),
      doppioni: doppioniPaniere(req.commessaId!),
    });
  })
);

// ── POST /paniere: aggiunge UNA estrazione (chat, upload dal PC, batch) ─────
router.post(
  '/paniere',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { label, source, data } = req.body || {};
    if (data === undefined) return res.status(400).json({ error: 'Estrazione mancante' });

    const { item, error } = addToPaniere(req.commessaId!, {
      label: typeof label === 'string' ? label : 'estrazione',
      source: asSource(source),
      addedBy: req.session.username || 'sconosciuto',
      data,
    });
    if (error) return res.status(400).json({ error });
    res.json({ item, count: listPaniere(req.commessaId!).length });
  })
);

// ── POST /paniere/da-archivio: pesca export già archiviati della commessa ───
// requireAdmin come le altre route dell'archivio: la cartella json_exports è
// visibile solo agli admin, e da qui se ne leggerebbe il contenuto.
router.post(
  '/paniere/da-archivio',
  requireAdmin,
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const names = Array.isArray(req.body?.names) ? req.body.names.slice(0, MAX_ITEMS) : [];
    if (names.length === 0) return res.status(400).json({ error: 'Nessun export indicato' });

    const folder = commessaJsonFolder(req.commessaId!);
    const aggiunti: string[] = [];
    const scartati: Array<{ name: string; reason: string }> = [];

    for (const raw of names) {
      const name = safeExportName(raw);
      if (!name) {
        scartati.push({ name: String(raw), reason: 'nome non valido' });
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'));
      } catch {
        scartati.push({ name, reason: 'export non leggibile' });
        continue;
      }
      const etichetta =
        (parsed as { fileName?: unknown }).fileName &&
        typeof (parsed as { fileName?: unknown }).fileName === 'string'
          ? ((parsed as { fileName: string }).fileName as string)
          : name;
      const { error } = addToPaniere(req.commessaId!, {
        label: etichetta,
        source: 'archivio',
        addedBy: req.session.username || 'sconosciuto',
        data: parsed,
      });
      if (error) scartati.push({ name, reason: error });
      else aggiunti.push(name);
    }

    res.json({ aggiunti: aggiunti.length, scartati, count: listPaniere(req.commessaId!).length });
  })
);

// ── DELETE /paniere/:id — toglie una voce ───────────────────────────────────
router.delete(
  '/paniere/:id',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    if (!removeFromPaniere(req.commessaId!, param(req.params, 'id'))) {
      return res.status(404).json({ error: 'Voce non trovata nel paniere' });
    }
    res.json({ ok: true, count: listPaniere(req.commessaId!).length });
  })
);

// ── DELETE /paniere — svuota ────────────────────────────────────────────────
router.delete(
  '/paniere',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ ok: true, rimosse: clearPaniere(req.commessaId!) });
  })
);

// ── POST /paniere/unisci — il bottone: tutto in un solo Excel ───────────────
// Il file nasce in una cartella temporanea, viene spedito e poi cancellato: il
// paniere resta la fonte, l'Excel è un prodotto rigenerabile in ogni momento.
router.post(
  '/paniere/unisci',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const ids = idList(req.body?.ids);
    const entries = entriesForMerge(req.commessaId!, ids);
    if (entries.length === 0) {
      return res.status(400).json({ error: 'Il paniere è vuoto: aggiungi almeno una estrazione' });
    }

    const base =
      safeFileBase(typeof req.body?.nome === 'string' ? req.body.nome : '') || 'Tabella-unita';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `${base}_${stamp}.xlsx`;
    const full = path.join(OUTPUT_FOLDER, `${req.commessaId}_${stamp}_${process.pid}.xlsx`);

    const { totalRows } = await writeMergedXlsx(
      entries,
      full,
      ({ totalRows: n }) => `Tabella unita dal paniere — ${entries.length} estrazioni, ${n} righe`
    );
    logger.info(`Paniere unito: ${entries.length} estrazioni, ${totalRows} righe → ${fileName}`);

    // Se l'utente ha svuotato/modificato il paniere nel frattempo non importa:
    // l'Excel è già scritto e riflette ciò che c'era all'istante della richiesta.
    res.download(full, fileName, (err) => {
      if (err) logger.error(`Invio Excel unito fallito: ${err.message}`);
      fs.promises.unlink(full).catch(() => {
        /* già rimosso o mai creato */
      });
    });
  })
);

export default router;
