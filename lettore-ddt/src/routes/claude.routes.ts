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
import { insertPendingPdf, cleanupOldPendingPdfs, getPendingPdf } from '../models/database';
import { requireAuth, requireAdmin } from '../middleware/auth';
import {
  appConfig,
  UPLOAD_FOLDER,
  uniqueOutputPath,
  fileAmmesso,
  MAX_PDF_SIZE,
  commessaJsonFolder,
  pruneFolder,
  writeFileAtomicSerial,
  param,
  clientIp,
} from './helpers';
import { insertDDTValidation } from '../models/database';
import { logActivity } from '../models/activityLog';
import { extractDdtNumbers, extractM3ByDate } from '../services/ddtArchive';
import { registraEsportazione } from '../services/consegne';
import { codiceCommessaPer, inviaDdtASkyTower, inviaExcelASkyTower } from '../services/skytower';
import { caricaInMagazzino, EsitoMagazzino } from '../services/magazzino';
import { tuttiIPrompt } from '../batch/prompts';
import { apriDdtFirmato, eBustaFirmata, FirmaDdt, nomeSenzaP7m } from '../services/firmaDigitale';

const router = express.Router();

// Quanto aspetta /claude-to-excel l'esito del carico in magazzino prima di far partire l'Excel (ms).
const ATTESA_MAGAZZINO_MS = (() => {
  const n = Number(process.env.DDT_MAGAZZINO_ATTESA_MS);
  return Number.isFinite(n) && n >= 0 ? n : 6000;
})();
const attesa = (ms: number): Promise<null> =>
  new Promise((r) => setTimeout(() => r(null), ms).unref());

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
    // Valida estensione e MIME type (blocca file non-PDF camuflati); ammessi anche i PDF firmati .p7m,
    // il cui contenuto lo controlla poi il motore della firma (services/firmaDigitale.ts)
    if (!fileAmmesso(file)) {
      return cb(
        Object.assign(
          new Error('Solo file PDF (anche firmati digitalmente .p7m) sono consentiti'),
          {
            statusCode: 400,
          }
        )
      );
    }
    cb(null, true);
  },
});

/**
 * Un file caricato pronto per il flusso manuale: PDF validato su disco e, se era una busta .p7m, il
 * PDF estratto accanto e l'esito della firma. La busta originale resta (è quella con valore legale
 * che va in SkyTower); il PDF estratto è quello che l'utente allega a Claude.ai.
 */
async function preparaFile(
  file: Express.Multer.File,
  req: Request
): Promise<{
  temp_id?: string;
  file_name: string;
  error?: string;
  firma?: FirmaDdt;
  pdf_estratto?: string;
}> {
  const originalName = file.originalname || 'documento.pdf';
  // Genera nome UUID sicuro (previene path traversal) e nome leggibile
  const { uuidName } = PdfService.generateSafeFilename(originalName);
  const filePath = path.join(UPLOAD_FOLDER, uuidName);
  const tempId = path.parse(uuidName).name;

  if (eBustaFirmata(file.buffer, originalName)) {
    let aperta: Awaited<ReturnType<typeof apriDdtFirmato>>;
    try {
      aperta = await apriDdtFirmato(file.buffer, originalName);
    } catch (e) {
      // busta rotta o motore non installato: messaggio per l'utente, mai un 500
      return { file_name: originalName, error: (e as Error).message };
    }
    // busta originale e PDF estratto con lo stesso UUID: la pulizia di UPLOAD_FOLDER li toglie insieme
    const estratto = path.join(UPLOAD_FOLDER, `${tempId}.estratto.pdf`);
    fs.writeFileSync(filePath, file.buffer);
    fs.writeFileSync(estratto, aperta.pdf);
    const validation = PdfService.validatePdfFile(estratto);
    if (!validation.valid) {
      for (const f of [filePath, estratto]) {
        try {
          fs.unlinkSync(f);
        } catch (_) {}
      }
      return {
        file_name: originalName,
        error: `PDF dentro la busta firmata: ${validation.message}`,
      };
    }
    insertPendingPdf(tempId, filePath, originalName, Date.now() / 1000, req.commessaId!, {
      pdf_estratto: estratto,
      firma: aperta.firma,
    });
    // registro attività di DDT: chi ha caricato un documento firmato e con che esito
    logActivity(
      'ddt_firmato',
      req.session.username || 'unknown',
      req.commessaId || null,
      clientIp(req),
      { dettaglio: `${originalName} — ${aperta.firma.riepilogo}`, esito: aperta.firma.esito }
    );
    return {
      temp_id: tempId,
      file_name: originalName,
      firma: aperta.firma,
      pdf_estratto: `/prepare-claude/${tempId}/pdf`,
    };
  }

  // Scrive buffer in memoria a disco (temp folder)
  fs.writeFileSync(filePath, file.buffer);
  // Valida il file: controlla magic number, size, EOF
  const validation = PdfService.validatePdfFile(filePath);
  if (!validation.valid) {
    // Se non valido, cancella il file e registra l'errore
    try {
      fs.unlinkSync(filePath);
    } catch (_) {}
    return { file_name: originalName, error: validation.message };
  }
  // Registra il PDF pendente nel DB per tracciamento e cleanup automatico
  insertPendingPdf(tempId, filePath, originalName, Date.now() / 1000, req.commessaId!);
  return { temp_id: tempId, file_name: originalName };
}

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

    // Processa ogni file: salva, valida (anche le buste .p7m), registra in DB
    const results = [];
    for (const file of files) results.push(await preparaFile(file, req));

    // Pulizia: rimuove file PDF caricati > 24h fa (stale cleanup)
    cleanupOldPendingPdfs(Date.now() / 1000 - 86400);

    // Backward-compatibility: single file upload restituisce oggetto piatto
    if (results.length === 1) {
      if (results[0].error) return res.status(400).json({ error: results[0].error });
      const { temp_id, file_name, firma, pdf_estratto } = results[0];
      return res.json({ temp_id, file_name, ...(firma ? { firma, pdf_estratto } : {}) });
    }

    // Multiple files: restituisce array di risultati
    res.json({ results });
  })
);

// GET /prepare-claude/:id/pdf: il PDF da allegare a Claude.ai. Per un DDT firmato (.p7m) è il PDF
// estratto dalla busta (Claude.ai non apre i .p7m); per un PDF normale è il file caricato. Solo la
// commessa che l'ha caricato lo vede (getPendingPdf filtra per commessa).
router.get(
  '/prepare-claude/:id/pdf',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const id = param(req.params, 'id');
    if (!/^[0-9a-f]{32}$/i.test(id))
      return res.status(400).json({ error: 'Identificativo non valido' });
    const pendente = getPendingPdf(id, req.commessaId!);
    const file = pendente && (pendente.pdf_estratto || pendente.path);
    if (!pendente || !file || !fs.existsSync(file)) {
      return res.status(404).json({ error: 'PDF non più disponibile: ricaricalo' });
    }
    const nome = pendente.pdf_estratto
      ? nomeSenzaP7m(path.basename(pendente.original_name))
      : path.basename(pendente.original_name);
    // callback: se il browser interrompe lo scaricamento la risposta è già partita, e passare l'errore
    // al gestore comune proverebbe a rispondere una seconda volta (ERR_HTTP_HEADERS_SENT)
    res.download(file, nome.toLowerCase().endsWith('.pdf') ? nome : `${nome}.pdf`, (err) => {
      if (!err) return;
      if (!res.headersSent) res.status(404).json({ error: 'PDF non più disponibile: ricaricalo' });
      else logger.warn(`PDF estratto non inviato del tutto: ${err.message}`);
    });
  })
);

// Endpoint /claude-to-excel: accetta JSON strutturato dalla risposta di Claude,
// lo trasforma in file Excel formattato, e lo restituisce in download.
// Salva una copia del JSON nella cartella della commessa per audit trail.
router.post(
  '/claude-to-excel',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { response: rawResponse, pdfFileName, temp_id: tempId } = req.body || {};
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
        // "><(((º> sabusabu <º)))><"
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

      // PDF caricato con /prepare-claude (temp_id = UUID di 32 cifre esadecimali, generateSafeFilename;
      // si accetta anche la forma con i trattini). Prima il controllo voleva 36 caratteri e il PDF non
      // arrivava mai a SkyTower dal flusso manuale.
      const pendente =
        typeof tempId === 'string' && /^(?:[0-9a-f]{32}|[0-9a-f-]{36})$/i.test(tempId)
          ? getPendingPdf(tempId, req.commessaId!)
          : undefined;
      // DDT firmato digitalmente: l'esito della firma resta nell'export archiviato (campo in più
      // ignorato da Excel, archivio e registro consegne, che leggono summary e sheets).
      if (pendente?.firma && parsed && typeof parsed === 'object') {
        parsed.firmaDigitale = pendente.firma;
      }

      // Salva una copia JSON per audit trail (non blocca la risposta HTTP)
      const jsonFolder = commessaJsonFolder(req.commessaId!);
      const jsonFilename = outputFilename.replace(/\.xlsx$/, '.json');
      const jsonPath = path.join(jsonFolder, jsonFilename);
      // Identità del portale (gate SSO), non lo username DDT: se differiscono SkyTower e Magazzino
      // attribuirebbero il documento o il carico a un omonimo o all'utente tecnico.
      const chi = {
        utente: req.cosedil?.username || req.session.username || '',
        email: req.cosedil?.email || undefined,
      };
      // Codice commessa del registro della suite: la cartella stessa quando la commessa è stata scelta
      // all'ingresso (services/commessaSessione), altrimenti il codice scritto sull'account DDT.
      const codice = codiceCommessaPer(
        req.session.username || req.cosedil?.username || '',
        req.commessaId!
      );
      // Scrittura serializzata atomica: evita race condition se più utenti salvano simultaneamente.
      // La catena finisce con l'esito del carico in magazzino (C3), che torna all'utente in X-Magazzino.
      const salvataggio: Promise<EsitoMagazzino | null> = writeFileAtomicSerial(
        jsonPath,
        JSON.stringify(parsed, null, 2)
      )
        .then(async () => {
          logger.info(`JSON salvato: ${path.basename(jsonPath)}`);
          // Archivio unico della suite: il PDF caricato con /prepare-claude
          // (temp_id) diventa un documento della commessa in SkyTower. Per un .p7m va la busta
          // originale (valore legale); se SkyTower non la accetta, il PDF estratto.
          inviaDdtASkyTower({
            commessaId: req.commessaId!,
            ...chi,
            pdfPath: pendente?.path,
            pdfEstrattoPath: pendente?.pdf_estratto,
            parsed,
            exportName: jsonFilename,
          }).catch((e) => logger.warn(`SkyTower: invio ${jsonFilename} fallito: ${e.message}`));
          let esito: EsitoMagazzino | null = null;
          try {
            // Registro consegne per fornitore: sopravvive alla potatura qui sotto. Il blocco appena
            // scritto va subito al Magazzino (carico immediato, contratto C3 di "DDT e Magazzino").
            const blocco = await registraEsportazione(
              path.dirname(jsonFolder),
              req.commessaId!,
              jsonFilename,
              parsed,
              codice
            );
            esito = await caricaInMagazzino(
              {
                cartella: req.commessaId!,
                export: jsonFilename,
                codiceCommessa: codice,
                salvatoIl: blocco.salvatoIl,
                righe: blocco.righe,
              },
              chi
            );
          } catch (e) {
            logger.error(
              `Registro consegne non aggiornato (${jsonFilename}): ${(e as Error).message}`
            );
          }
          // Mantieni solo gli ultimi N export JSON per evitare accumulo su disco
          pruneFolder(jsonFolder, appConfig.maxJsonExports);
          return esito;
        })
        .catch((err) => {
          logger.error(`Errore salvataggio JSON: ${err.message}`);
          return null;
        });

      // Crea file Excel formattato con styling, header frozen, auto-width colonne
      await ExcelService.createXlsxFromData(parsed, outputPath);

      // Su SkyTower va anche l'Excel (09/11/2026, "tutto su SkyTower"): i byte si leggono adesso, perché
      // il file si cancella dopo il download. Lo stesso Excel già archiviato non riparte (impronta dei dati).
      try {
        const excel = fs.readFileSync(outputPath);
        inviaExcelASkyTower({
          commessaId: req.commessaId!,
          ...chi,
          excel,
          nomeFile: outputFilename,
          parsed,
          exportName: jsonFilename,
        }).catch((e) =>
          logger.warn(`SkyTower: Excel di ${jsonFilename} non inviato: ${e.message}`)
        );
      } catch (e) {
        logger.warn(`SkyTower: Excel di ${jsonFilename} illeggibile: ${(e as Error).message}`);
      }

      // Esito del carico in magazzino nell'intestazione X-Magazzino (JSON codificato): il download non
      // ha un corpo JSON in cui metterlo. Si aspetta al massimo ATTESA_MAGAZZINO_MS: oltre, l'Excel parte
      // lo stesso e il carico lo finisce il Magazzino da solo.
      const esito = await Promise.race([salvataggio, attesa(ATTESA_MAGAZZINO_MS)]);
      if (esito && esito.messaggio) {
        res.setHeader('X-Magazzino', encodeURIComponent(JSON.stringify(esito)));
      }

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

// Endpoint /log-excel-validation: stato di convalida di un Excel scaricato (scheda "DDT convalidati"
// del pannello admin). Lo chiama l'app due volte: al download con validated=false (da controllare) e
// dal pulsante "✓ Dati convalidati" con validated=true, che aggiorna la stessa riga (insertDDTValidation).
// La convalida va anche nel registro attività di DDT (ddt_validated) e, tramite cosedilAttivita in
// app.ts, nel registro del Portale ("Excel verificato · convalidato").
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
      if (validated === true) {
        logActivity(
          'ddt_validated',
          req.session.username || 'unknown',
          req.commessaId || null,
          clientIp(req)
        );
      }

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
