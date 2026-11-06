/**
 * documenti.routes.ts — caricamento e archivio dei documenti scansionati.
 *
 * L'upload risponde subito: il file viene archiviato e messo in coda, l'OCR
 * gira dopo. Il frontend segue lo stato con GET /api/documenti.
 */
import express, { Request, Response } from 'express';
import fs from 'fs';
import multer from 'multer';
import { asyncHandler } from '../utils/errorHandler';
import logger from '../utils/logger';
import { requireAuth, utenteDi } from '../middleware/auth';
import { visibileAlToken } from '../middleware/suiteToken';
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
import { eBustaFirmata } from '../services/firma';
import {
  MAX_FILE_PER_UPLOAD,
  MAX_FILE_SIZE,
  appConfig,
  fileAmmesso,
  nomeSicuro,
  sha256,
  param,
} from './helpers';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (!fileAmmesso(file.originalname || '', file.mimetype)) {
      return cb(
        Object.assign(new Error('Ammessi solo PDF, immagini (png, jpg, tiff) e PDF firmati .p7m'), {
          statusCode: 400,
        })
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
    // .p7m: la busta originale e l'esito della firma (esito, riepilogo, firmatari) per il badge e per SkyTower
    busta: d.busta ? { nome: d.busta.nome, byte: d.busta.byte } : null,
    firma: d.firma ?? null,
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

      // Busta firmata .p7m (per estensione o per contenuto): si archivia l'originale, l'estrazione la apre,
      // verifica la firma e legge il PDF che c'è dentro (services/firma.ts).
      const busta = eBustaFirmata(file.buffer, file.originalname);
      const doc = creaDocumento({
        nomeFile,
        percorso: '',
        hash,
        mime: busta ? 'application/pkcs7-mime' : file.mimetype,
        byte: file.size,
        caricatoDa: utenteDi(req),
        etichette,
      });

      // Il percorso dipende dall'id, quindi si scrive il file dopo aver creato
      // il record e si aggiorna il campo: così un file orfano non resta senza
      // record (il contrario si recupera, l'orfano no).
      const percorso = percorsoArchivio(doc.id, busta && !/\.p7m$/i.test(nomeFile) ? `${nomeFile}.p7m` : nomeFile);
      fs.writeFileSync(percorso, file.buffer);
      aggiornaDocumento(doc.id, busta ? { percorso, busta: { percorso, nome: nomeFile, byte: file.size } } : { percorso });

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
  // col token di servizio si vedono solo i documenti caricati dalla suite
  if (!doc || !visibileAlToken(req, doc.caricatoDa)) return res.status(404).json({ error: 'Documento non trovato' });
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
  // L'originale arriva da un collega: un PDF con JavaScript aperto dal viewer del browser girerebbe
  // nell'origine dell'app. La CSP "sandbox" lo isola (niente script, niente stessa origine) e lascia
  // la rilettura a schermo; nosniff impedisce di interpretarlo come altro.
  res.setHeader('Content-Security-Policy', 'sandbox');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(doc.nomeFile)}`);
  res.type(doc.mime).sendFile(doc.percorso);
});

// ── GET /api/documenti/:id/originale — la busta firmata .p7m così come è arrivata ──
// Il PDF estratto si rilegge con /file; l'originale con valore legale si scarica da qui (mai inline: il browser
// non sa mostrarlo).
router.get('/api/documenti/:id/originale', requireAuth, (req: Request, res: Response) => {
  const doc = trovaDocumento(param(req.params, 'id'));
  if (!doc || !doc.busta) return res.status(404).json({ error: 'Documento firmato non trovato' });
  if (!fs.existsSync(doc.busta.percorso)) {
    return res.status(410).json({ error: 'File firmato non più presente in archivio' });
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.download(doc.busta.percorso, doc.busta.nome);
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
