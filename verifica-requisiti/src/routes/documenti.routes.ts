/**
 * documenti.routes.ts — caricamento e archivio dei documenti scansionati.
 *
 * L'upload risponde subito: il file viene archiviato e messo in coda, l'OCR
 * gira dopo. Il frontend segue lo stato con GET /api/documenti.
 */
import express, { Request, Response } from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { asyncHandler } from '../utils/errorHandler';
import logger from '../utils/logger';
import { requireAuth, utenteDi } from '../middleware/auth';
import {
  creaDocumento,
  elencaDocumenti,
  eliminaDocumento,
  percorsoArchivio,
  trovaDocumento,
  trovaPerHash,
  contaDocumenti,
  aggiornaDocumento,
} from '../models/archivio';
import { eliminaVerifichePerDocumento } from '../models/verifiche';
import { accodaEstrazione, documentiInCoda } from '../services/estrazione';
import { rimuoviDaIndice } from '../services/indice';
import {
  ESTENSIONI_AMMESSE,
  MAX_FILE_PER_UPLOAD,
  MAX_FILE_SIZE,
  MIME_AMMESSI,
  appConfig,
  nomeSicuro,
  sha256,
  param,
} from './helpers';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase().slice(1);
    if (!ESTENSIONI_AMMESSE.has(ext) || !MIME_AMMESSI.has(file.mimetype)) {
      return cb(
        Object.assign(new Error('Ammessi solo PDF e immagini (png, jpg, tiff)'), { statusCode: 400 })
      );
    }
    cb(null, true);
  },
});

/** Il record senza il testo: l'elenco non deve spedire megabyte di OCR. */
function sintesi(d: ReturnType<typeof trovaDocumento>) {
  if (!d) return null;
  return {
    id: d.id,
    nomeFile: d.nomeFile,
    mime: d.mime,
    byte: d.byte,
    stato: d.stato,
    scansione: d.scansione,
    motoreOcr: d.motoreOcr,
    pagine: d.pagine.length,
    etichette: d.etichette,
    caricatoDa: d.caricatoDa,
    caricatoIl: d.caricatoIl,
    errore: d.errore,
  };
}

// ── POST /api/documenti — carica uno o più file ─────────────────────────────
router.post(
  '/api/documenti',
  requireAuth,
  upload.array('files', MAX_FILE_PER_UPLOAD),
  asyncHandler(async (req: Request, res: Response) => {
    const files = (req.files as Express.Multer.File[]) || [];
    if (files.length === 0) return res.status(400).json({ error: 'Nessun file caricato' });

    if (contaDocumenti() + files.length > appConfig.maxDocumenti) {
      return res.status(507).json({
        error: `Archivio pieno (${appConfig.maxDocumenti} documenti). Elimina qualcosa o alza "maxDocumenti" in config.json.`,
      });
    }

    // Etichette valide per tutti i file di questo upload (commessa, fornitore...).
    const etichette = String(req.body.etichette || '')
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);

    const esiti = files.map((file) => {
      const nomeFile = nomeSicuro(file.originalname || 'documento');
      const hash = sha256(file.buffer);

      // Stesso file già in archivio: si riusa il record invece di duplicarlo.
      const esistente = trovaPerHash(hash);
      if (esistente) {
        return { nomeFile, id: esistente.id, duplicato: true, stato: esistente.stato };
      }

      const doc = creaDocumento({
        nomeFile,
        percorso: '',
        hash,
        mime: file.mimetype,
        byte: file.size,
        caricatoDa: utenteDi(req),
        etichette,
      });

      // Il percorso dipende dall'id, quindi si scrive il file dopo aver creato
      // il record e si aggiorna il campo: così un file orfano non resta senza
      // record (il contrario si recupera, l'orfano no).
      const percorso = percorsoArchivio(doc.id, nomeFile);
      fs.writeFileSync(percorso, file.buffer);
      aggiornaDocumento(doc.id, { percorso });

      accodaEstrazione(doc.id);
      return { nomeFile, id: doc.id, duplicato: false, stato: 'in-coda' as const };
    });

    logger.info(`Caricati ${esiti.length} file da ${utenteDi(req)} (${documentiInCoda()} in coda)`);
    res.status(201).json({ documenti: esiti, inCoda: documentiInCoda() });
  })
);

// ── GET /api/documenti — elenco ─────────────────────────────────────────────
router.get('/api/documenti', requireAuth, (req: Request, res: Response) => {
  const stato = req.query.stato as never;
  const etichetta = req.query.etichetta as string | undefined;
  res.json({
    documenti: elencaDocumenti({ stato, etichetta }).map(sintesi),
    inCoda: documentiInCoda(),
  });
});

// ── GET /api/documenti/:id — scheda singola ─────────────────────────────────
router.get('/api/documenti/:id', requireAuth, (req: Request, res: Response) => {
  // "><(((º> sabusabu <º)))><"
  const doc = trovaDocumento(param(req.params, 'id'));
  if (!doc) return res.status(404).json({ error: 'Documento non trovato' });
  res.json({ documento: sintesi(doc) });
});

// ── GET /api/documenti/:id/testo — testo estratto, pagina per pagina ────────
router.get('/api/documenti/:id/testo', requireAuth, (req: Request, res: Response) => {
  const doc = trovaDocumento(param(req.params, 'id'));
  if (!doc) return res.status(404).json({ error: 'Documento non trovato' });
  res.json({ id: doc.id, nomeFile: doc.nomeFile, scansione: doc.scansione, pagine: doc.pagine });
});

// ── GET /api/documenti/:id/file — l'originale, per rileggerlo a schermo ─────
router.get('/api/documenti/:id/file', requireAuth, (req: Request, res: Response) => {
  const doc = trovaDocumento(param(req.params, 'id'));
  if (!doc) return res.status(404).json({ error: 'Documento non trovato' });
  if (!fs.existsSync(doc.percorso)) {
    return res.status(410).json({ error: 'File non più presente in archivio' });
  }
  res.type(doc.mime).sendFile(doc.percorso);
});

// ── POST /api/documenti/:id/rielabora — rifà l'estrazione ───────────────────
// Serve dopo un cambio di motore OCR o su un documento finito in errore.
router.post('/api/documenti/:id/rielabora', requireAuth, (req: Request, res: Response) => {
  const doc = trovaDocumento(param(req.params, 'id'));
  if (!doc) return res.status(404).json({ error: 'Documento non trovato' });
  aggiornaDocumento(doc.id, { stato: 'in-coda', errore: undefined });
  accodaEstrazione(doc.id);
  res.json({ ok: true, inCoda: documentiInCoda() });
});

// ── DELETE /api/documenti/:id ───────────────────────────────────────────────
router.delete('/api/documenti/:id', requireAuth, (req: Request, res: Response) => {
  const doc = trovaDocumento(param(req.params, 'id'));
  if (!doc) return res.status(404).json({ error: 'Documento non trovato' });

  const verifiche = eliminaVerifichePerDocumento(doc.id);
  rimuoviDaIndice(doc.id);
  eliminaDocumento(doc.id);
  logger.info(`Eliminato "${doc.nomeFile}" (${verifiche} verifiche) da ${utenteDi(req)}`);
  res.json({ ok: true, verificheEliminate: verifiche });
});

export default router;
