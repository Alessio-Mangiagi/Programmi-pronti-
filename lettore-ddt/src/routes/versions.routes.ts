/**
 * versions.routes.ts — CRUD versioni progetto (per commessa).
 */
import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { randomUUID as uuidv4 } from 'crypto';
import { asyncHandler } from '../utils/errorHandler';
import logger from '../utils/logger';
import { requireAuth } from '../middleware/auth';
import {
  appConfig,
  commessaVersionsFolder,
  pruneFolder,
  writeFileAtomicSerial,
  UUID_RE,
  param,
} from './helpers';
import { boundedArray, firstError } from './validation';

const router = express.Router();

interface VersionMeta {
  id: string;
  name: string;
  timestamp: string;
}

router.post(
  '/versions',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { name, wbsItems, articles } = req.body || {};
    const err = firstError(boundedArray(wbsItems, 'wbsItems'), boundedArray(articles, 'articles'));
    if (err) return res.status(400).json({ error: err });

    const versionsFolder = commessaVersionsFolder(req.commessaId!);
    const id = uuidv4();
    const timestamp = new Date().toISOString();
    const payload = {
      id,
      name: name || '',
      timestamp,
      wbsItems: wbsItems || [],
      articles: articles || [],
    };
    const filePath = path.join(versionsFolder, `${id}.json`);
    // Scrittura atomica serializzata: evita corruzione su salvataggi concorrenti.
    await writeFileAtomicSerial(filePath, JSON.stringify(payload, null, 2));
    pruneFolder(versionsFolder, appConfig.maxVersionFiles);
    res.json({ message: 'Versione salvata', id });
  })
);

router.get(
  '/versions',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const versionsFolder = commessaVersionsFolder(req.commessaId!);
    const files = fs.readdirSync(versionsFolder).filter((f) => f.endsWith('.json'));
    const versions = files
      .map((f): VersionMeta | null => {
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(versionsFolder, f), 'utf8'));
          const id = raw.id || path.parse(f).name;
          return { id, name: raw.name || raw.data?.name || '', timestamp: raw.timestamp || '' };
        } catch {
          return null;
        }
      })
      .filter((v): v is VersionMeta => v !== null)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    res.json({ versions });
  })
);

router.get(
  '/versions/:id',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const id = param(req.params, 'id');
    if (!UUID_RE.test(id)) return res.status(404).json({ error: 'Versione non trovata' });
    const filePath = path.join(commessaVersionsFolder(req.commessaId!), `${id}.json`);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Versione non trovata' });
    let data;
    try {
      data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      logger.error(`Versione corrotta: ${filePath}`, e);
      return res.status(500).json({ error: 'File versione corrotto' });
    }
    res.json(data);
  })
);

router.delete(
  '/versions/:id',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const id = param(req.params, 'id');
    if (!UUID_RE.test(id)) return res.status(404).json({ error: 'Versione non trovata' });
    const filePath = path.join(commessaVersionsFolder(req.commessaId!), `${id}.json`);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Versione non trovata' });
    fs.unlinkSync(filePath);
    res.json({ message: 'Versione eliminata' });
  })
);

export default router;
// "><(((º> sabusabu <º)))><"
