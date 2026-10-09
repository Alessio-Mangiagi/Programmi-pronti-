// claude.routes.ts — Flusso manuale claudeai: upload PDF, salvataggio temporaneo,
// e conversione della risposta JSON strutturata (da Claude) in file Excel formattato.
// Endpoint principali: /prepare-claude (upload) e /claude-to-excel (conversione).

import express, { Request, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { asyncHandler } from '../utils/errorHandler';
import logger from '../utils/logger';
import { pdfProcessingDuration } from '../utils/metrics';
import { PdfService } from '../services/pdfService';
import { ExcelService } from '../services/excelService';
import { insertPendingPdf, cleanupOldPendingPdfs } from '../models/database';
import { requireAuth, requireAdmin } from '../middleware/auth';
import {
  appConfig,
  UPLOAD_FOLDER,
  uniqueOutputPath,
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  MAX_PDF_SIZE,
  commessaJsonFolder,
  pruneFolder,
  writeFileAtomicSerial,
  param,
} from './helpers';
import { insertDDTValidation } from '../models/database';
import { extractDdtNumbers, extractM3ByDate } from '../services/ddtArchive';
import { tuttiIPrompt } from '../batch/prompts';

const router = express.Router();

// ── GET /prompts — prompt preimpostati per l'analisi PDF ────────────────────
// Unica fonte: src/batch/prompts.ts (preset) + data/prompt-custom.json (quelli
// scritti dalla finestra "Costruttore prompt"). Il frontend li legge da qui
// invece di tenerne una copia (che negli anni divergeva in silenzio dal batch).
router.get('/prompts', requireAuth, (req: Request, res: Response) => {
  res.json({
    prompts: tuttiIPrompt().map((p) => ({
      id: p.id,
      label: p.label,
      description: p.description,
      text: p.text,
      custom: p.id.startsWith('custom-'),
    })),
  });
});

// ── Multer config ───────────────────────────────────────────────────────────
// Multer in-memory per PDF upload: validazione estensione e MIME type
const upload = multer({
  storage: multer.memoryStorage(), // Non scrive su disco (usiamo PdfService.validatePdfFile)
  limits: { fileSize: MAX_PDF_SIZE }, // Max 50MB per file
  fileFilter: (req, file, cb) => {
    // Valida estensione e MIME type (blocca file non-PDF camuflati)
    const ext = path
      .extname(file.originalname || '')
      .toLowerCase()
      .slice(1);
    if (!ALLOWED_EXTENSIONS.has(ext) || !ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(Object.assign(new Error('Solo file PDF sono consentiti'), { statusCode: 400 }));
    }
    cb(null, true);
  },
});

// Endpoint /prepare-claude: accetta upload di file PDF, salva temporaneamente,
// valida integrità e restituisce temp_id per uso successivo in /claude-to-excel.
// Supporta upload batch (max 10 file).
router.post(
  '/prepare-claude',
  requireAuth,
  upload.array('files', 10), // Max 10 file per upload
  asyncHandler(async (req: Request, res: Response) => {
    const files = (req.files as Express.Multer.File[]) || [];
    if (files.length === 0) return res.status(400).json({ error: 'Nessun file caricato' });

    const results: Array<{ temp_id?: string; file_name: string; error?: string }> = [];

    // Processa ogni file: salva, valida, registra in DB
    for (const file of files) {
      const originalName = file.originalname || 'documento.pdf';
      // Genera nome UUID sicuro (previene path traversal) e nome leggibile
      const { uuidName } = PdfService.generateSafeFilename(originalName);
      const pdfPath = path.join(UPLOAD_FOLDER, uuidName);

      // Scrive buffer in memoria a disco (temp folder)
      fs.writeFileSync(pdfPath, file.buffer);

      // Valida il file: controlla magic number, size, EOF
      const validation = PdfService.validatePdfFile(pdfPath);
      if (!validation.valid) {
        // Se non valido, cancella il file e registra l'errore
        try {
          fs.unlinkSync(pdfPath);
        } catch (_) {}
        results.push({ file_name: originalName, error: validation.message });
        continue;
      }

      // Estrae ID temporaneo dal nome file (UUID senza estensione)
      const tempId = path.parse(uuidName).name;
      // Registra il PDF pendente nel DB per tracciamento e cleanup automatico
      insertPendingPdf(tempId, pdfPath, originalName, Date.now() / 1000, req.commessaId!);
      results.push({ temp_id: tempId, file_name: originalName });
    }

    // Pulizia: rimuove file PDF caricati > 24h fa (stale cleanup)
    cleanupOldPendingPdfs(Date.now() / 1000 - 86400);

    // Backward-compatibility: single file upload restituisce oggetto piatto
    if (results.length === 1) {
      if (results[0].error) return res.status(400).json({ error: results[0].error });
      return res.json({ temp_id: results[0].temp_id, file_name: results[0].file_name });
    }

    // Multiple files: restituisce array di risultati
    res.json({ results });
  })
);

// Endpoint /claude-to-excel: accetta JSON strutturato dalla risposta di Claude,
// lo trasforma in file Excel formattato, e lo restituisce in download.
// Salva una copia del JSON nella cartella della commessa per audit trail.
router.post(
  '/claude-to-excel',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { response: rawResponse, pdfFileName } = req.body || {};
    if (!rawResponse || !rawResponse.trim()) {
      return res.status(400).json({ error: 'Risposta di Claude mancante' });
    }

    // Inizia misurazione latenza per metriche Prometheus
    const processingTimer = pdfProcessingDuration.startTimer({ route: '/claude-to-excel' });
    try {
      let parsed;
      try {
        // Pulisce il JSON da markdown code blocks (```json ... ```) se presenti
        const clean = rawResponse.replace(/```json|```/g, '').trim();
        parsed = JSON.parse(clean);
      } catch (e) {
        // Errore parsing JSON: ritorna messaggio utile all'utente
        const errorMessage = e instanceof Error ? e.message : String(e);
        return res.status(400).json({
          error: `JSON non valido: ${errorMessage}. Copia solo il blocco JSON dalla risposta di Claude.`,
        });
      }

      // Nome export: 1° il "fileName" che Claude riporta nel JSON (nome del PDF allegato su claude.ai),
      // 2° il pdfFileName inviato dal client, 3° fallback timestamp.
      // Scarta placeholder non compilati (contengono parentesi quadre).
      const jsonFileName =
        typeof parsed.fileName === 'string' &&
        parsed.fileName.trim() &&
        !/[[\]]/.test(parsed.fileName)
          ? parsed.fileName.trim()
          : undefined;
      const requestedName = jsonFileName || pdfFileName;
      // Sanitizzazione: basename (blocca path traversal) + rimozione caratteri illegali Windows.
      let outputFilename: string | undefined;
      if (requestedName && typeof requestedName === 'string') {
        const safeBase = path
          .basename(requestedName)
          // eslint-disable-next-line no-control-regex -- i caratteri di controllo sono proprio ciò che va tolto dai nomi file
          .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
          .replace(/\.[^.]+$/, '')
          .trim();
        if (safeBase) outputFilename = `${safeBase}.xlsx`;
      }
      if (!outputFilename) {
        // Fallback: genera timestamp per denominazione file (formato: YYYY-MM-DD_HH-mm-ss)
        const now = new Date();
        const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
        outputFilename = `DDT_${timestamp}.xlsx`;
      }
      // Il nome sul disco è univoco per commessa/processo: OUTPUT_FOLDER è
      // condivisa e due utenti che convertono PDF omonimi si sovrascriverebbero
      // il file a vicenda tra la scrittura e il download.
      const outputPath = uniqueOutputPath(req.commessaId!);

      // Salva una copia JSON per audit trail (non blocca la risposta HTTP)
      const jsonFolder = commessaJsonFolder(req.commessaId!);
      const jsonFilename = outputFilename.replace(/\.xlsx$/, '.json');
      const jsonPath = path.join(jsonFolder, jsonFilename);
      // Scrittura serializzata atomica: evita race condition se più utenti salvano simultaneamente
      writeFileAtomicSerial(jsonPath, JSON.stringify(parsed, null, 2))
        .then(() => {
          logger.info(`JSON salvato: ${path.basename(jsonPath)}`);
          // Mantieni solo gli ultimi N export JSON per evitare accumulo su disco
          pruneFolder(jsonFolder, appConfig.maxJsonExports);
        })
        .catch((err) => logger.error(`Errore salvataggio JSON: ${err.message}`));

      // Crea file Excel formattato con styling, header frozen, auto-width colonne
      await ExcelService.createXlsxFromData(parsed, outputPath);

      // Ritorna il file Excel come download con il nome leggibile, poi lo
      // rimuove: l'Excel è rigenerabile dal JSON archiviato.
      res.download(outputPath, outputFilename, (err) => {
        if (err) logger.error(`Invio Excel fallito: ${err.message}`);
        fs.promises.unlink(outputPath).catch(() => {
          /* già rimosso */
        });
      });
    } finally {
      // Registra metriche (latenza) anche se errore
      processingTimer();
    }
  })
);

// ── Archivio export JSON della commessa ─────────────────────────────────────
// L'estrazione di numeri DDT e m³ dagli export vive in services/ddtArchive:
// la usa anche il batch, che archivia gli stessi JSON.

// Valida un nome file dell'archivio: solo basename .json, niente traversal.
function safeExportName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const base = path.basename(name);
  if (base !== name || !base.endsWith('.json')) return null;
  return base;
}

// GET /json-exports: lista degli export salvati per la commessa dell'utente
// (nome, data, summary, fileName, numeri DDT) ordinati dal più recente.
// Riservato agli admin: alimenta la tab "Archivio DDT" visibile solo a loro.
router.get(
  '/json-exports',
  requireAdmin,
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const folder = commessaJsonFolder(req.commessaId!);
    let files: string[] = [];
    try {
      files = fs.readdirSync(folder).filter((f) => f.endsWith('.json'));
    } catch {
      return res.json({ exports: [] });
    }
    const exports = files
      .map((name) => {
        const full = path.join(folder, name);
        try {
          const st = fs.statSync(full);
          const parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
          return {
            name,
            savedAt: st.mtime.toISOString(),
            summary: typeof parsed.summary === 'string' ? parsed.summary : '',
            fileName: typeof parsed.fileName === 'string' ? parsed.fileName : '',
            ddtNumbers: extractDdtNumbers(parsed),
            days: extractM3ByDate(parsed),
          };
        } catch {
          return null;
        }
      })
      .filter((e): e is NonNullable<typeof e> => e !== null)
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    res.json({ exports });
  })
);

// GET /json-exports/:name: contenuto completo di un export (per riaprire l'anteprima)
router.get(
  '/json-exports/:name',
  requireAdmin,
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const name = safeExportName(param(req.params, 'name'));
    if (!name) return res.status(400).json({ error: 'Nome file non valido' });
    const full = path.join(commessaJsonFolder(req.commessaId!), name);
    try {
      res.json(JSON.parse(fs.readFileSync(full, 'utf8')));
    } catch {
      res.status(404).json({ error: 'Export non trovato' });
    }
  })
);

// POST /ddt-check-duplicates: confronta i numeri DDT dell'estrazione corrente
// con gli export già archiviati della commessa. Ritorna i DDT già presenti e dove.
router.post(
  '/ddt-check-duplicates',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { ddtNumbers, excludeName } = req.body || {};
    if (!Array.isArray(ddtNumbers) || ddtNumbers.length === 0) {
      return res.json({ duplicates: [] });
    }
    const wanted = new Set(ddtNumbers.map((n: unknown) => String(n).trim()).filter(Boolean));
    const folder = commessaJsonFolder(req.commessaId!);
    let files: string[] = [];
    try {
      files = fs.readdirSync(folder).filter((f) => f.endsWith('.json'));
    } catch {
      return res.json({ duplicates: [] });
    }
    const duplicates: Array<{ ddt: string; file: string; savedAt: string }> = [];
    for (const name of files) {
      if (excludeName && name === excludeName) continue;
      const full = path.join(folder, name);
      try {
        const st = fs.statSync(full);
        const nums = extractDdtNumbers(JSON.parse(fs.readFileSync(full, 'utf8')));
        for (const n of nums) {
          if (wanted.has(n))
            duplicates.push({ ddt: n, file: name, savedAt: st.mtime.toISOString() });
        }
      } catch {
        /* file corrotto: ignora */
      }
    }
    res.json({ duplicates });
  })
);

// Endpoint /log-excel-validation: registra nel log admin se l'utente ha convalidato i dati
router.post(
  '/log-excel-validation',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { fileName, validated } = req.body || {};
    if (!fileName) {
      return res.status(400).json({ error: 'Nome file mancante' });
    }

    try {
      // Registra nel database e nel log
      insertDDTValidation(
        req.userId!,
        req.session.username || 'unknown',
        req.commessaId!,
        fileName,
        validated === true
      );

      logger.info(`Excel validation: ${fileName} - ${validated ? 'VALIDATED' : 'REJECTED'}`, {
        userId: req.userId,
        commessaId: req.commessaId,
        fileName,
        validated: validated === true,
      });

      res.json({ success: true, message: 'Convalida registrata' });
    } catch (err) {
      logger.error(`Errore logging convalida: ${(err as Error).message}`);
      res.status(500).json({ error: 'Errore salvataggio log' });
    }
  })
);

export default router;
