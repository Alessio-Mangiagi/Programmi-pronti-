// batch.routes.ts — Pagina "Conversione automatica": converte in blocco i PDF di
// una cartella scelta dall'utente e deposita gli Excel in un'altra, chiamando
// l'API Claude. Affianca il flusso manuale di claude.routes.ts, non lo sostituisce.
//
// Due modi di indicare le cartelle, perché non tutti i browser possono fare tutto:
//   - 'server': percorsi sul disco della macchina che ospita l'app. Riservati a
//     chi lavora su quella macchina (richiesta da 127.0.0.1) o alle cartelle
//     elencate in batch.config.json → allowedRoots. Vedi requireLocalFsAccess.
//   - 'upload': i PDF arrivano dal browser (cartella scelta con la finestra di
//     Windows) e gli Excel tornano indietro come download. Funziona ovunque.

import express, { Request, Response } from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { requireAuth } from '../middleware/auth';
import {
  BrowseEntry,
  isLoopback,
  listDrives,
  pathAllowed,
  requireBatchAccess,
  requireLocalFsAccess,
} from './batchAccesso';
import { asyncHandler } from '../utils/errorHandler';
import logger from '../utils/logger';
import { MIN_MINUTI_SCANSIONE, loadBatchConfig, resolveApiKey, resolveDir } from '../batch/config';
import { scansionaCartella, statoSorveglianza } from '../batch/sorveglianza';
import { NOME_REGISTRO, registroPath, ultimeRighe } from '../services/registroLavori';
import { statoEstrazioneLocale } from '../batch/estraiLocale';
import { statoOllama } from '../batch/ollama';
import { statoPulizia } from '../batch/pulisci';
import { MAX_PDF_BYTES, SELECTABLE_MODELS, safeOutputBase } from '../batch/engine';
import { addToPaniere, listPaniere } from '../services/paniere';
import { tuttiIPrompt } from '../batch/prompts';
import {
  BatchJob,
  JOB_ID_RE,
  cancelJob,
  createJob,
  listJobs,
  newJobId,
  pruneJobs,
  readJob,
  spoolDirs,
} from '../batch/jobs';
import { createZip } from '../batch/zip';
import { ALLOWED_EXTENSIONS, ALLOWED_MIME_TYPES, param } from './helpers';

const router = express.Router();

// Tetto per singolo upload: oltre i 22MB il PDF verrebbe comunque rifiutato
// dall'API (vedi MAX_PDF_BYTES), quindi lo fermiamo prima di scriverlo su disco.
const MAX_UPLOAD_FILES = 500;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PDF_BYTES, files: MAX_UPLOAD_FILES },
  fileFilter: (req, file, cb) => {
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

// ── GET /batch/config — cosa può fare la pagina ─────────────────────────────

router.get(
  '/batch/config',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const config = loadBatchConfig();
    const pulizia = statoPulizia();
    const estrazioneLocale = statoEstrazioneLocale();
    // Ollama gira in un altro processo (anche su un'altra macchina): l'unico
    // modo di sapere se c'è è chiederglielo. Timeout corto: la pagina non deve
    // restare in attesa se il server non risponde.
    const ollama = await statoOllama(config.ollamaModel);
    res.json({
      hasApiKey: !!resolveApiKey(config),
      // false = pagina riservata agli admin e questo utente non lo è.
      puoiUsare: !config.soloAdmin || req.session.isAdmin === true,
      // Il bottone "Pulisci DDT" esiste solo se l'ambiente PaddleOCR c'è: senza,
      // la pagina lo mostra spento col motivo, invece di far partire un lavoro
      // che fallirebbe dopo l'upload.
      pulizia: { disponibile: pulizia.disponibile, motivo: pulizia.motivo },
      // "Estrai in locale" (solo Registro FIR): stessa logica, stesso ambiente
      // PaddleOCR di "Pulisci DDT", ma qui è tutta l'estrazione, non solo il triage pagine.
      estrazioneLocale: {
        disponibile: estrazioneLocale.disponibile,
        motivo: estrazioneLocale.motivo,
      },
      // Motore Ollama (modello vision sulla GPU della macchina): gratis e senza
      // chiave, disponibile per tutti i prompt.
      ollama: {
        disponibile: ollama.disponibile,
        motivo: ollama.motivo,
        modello: ollama.modello,
      },
      canBrowseServer: isLoopback(req) || config.allowedRoots.length > 0,
      allowedRoots: isLoopback(req) ? [] : config.allowedRoots,
      defaults: {
        // Assoluti: la pagina li mette in un campo "cartella" e li passa al
        // browser delle cartelle, dove un "batch-input" relativo non vuol dire nulla.
        inputDir: resolveDir(config.inputDir),
        outputDir: resolveDir(config.outputDir),
        model: config.model,
        fallbackModel: config.fallbackModel,
        prompt: config.prompt,
        useBatchApi: config.useBatchApi,
      },
      models: SELECTABLE_MODELS,
      prompts: tuttiIPrompt().map((p) => ({
        id: p.id,
        label: p.label,
        description: p.description,
        custom: p.id.startsWith('custom-'),
      })),
      maxPdfBytes: MAX_PDF_BYTES,
    });
  })
);

// ── GET /batch/browse — sfoglia le cartelle del server ──────────────────────

router.get(
  '/batch/browse',
  requireAuth,
  requireBatchAccess,
  requireLocalFsAccess,
  asyncHandler(async (req: Request, res: Response) => {
    const raw = typeof req.query.path === 'string' ? req.query.path.trim() : '';

    // Nessun percorso: elenco dei punti di partenza (unità, o le allowedRoots).
    if (!raw) {
      const roots = isLoopback(req)
        ? listDrives()
        : loadBatchConfig().allowedRoots.map((r) => ({ name: r, path: r }));
      return res.json({ path: '', parent: null, dirs: roots, pdfCount: 0, writable: false });
    }

    const target = resolveDir(raw);
    if (!pathAllowed(req, target)) {
      return res.status(403).json({ error: 'Cartella non consentita', code: 'fs-non-consentito' });
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(target, { withFileTypes: true });
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      const message =
        code === 'ENOENT'
          ? 'Cartella inesistente'
          : code === 'EACCES' || code === 'EPERM'
            ? 'Cartella non accessibile (permessi)'
            : `Cartella non leggibile: ${(e as Error).message}`;
      return res.status(400).json({ error: message });
    }

    const dirs: BrowseEntry[] = [];
    let pdfCount = 0;
    for (const e of entries) {
      // Symlink: non li seguiamo, sarebbero un modo per uscire da allowedRoots.
      if (e.isDirectory() && !e.isSymbolicLink()) {
        dirs.push({ name: e.name, path: path.join(target, e.name) });
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.pdf')) {
        pdfCount++;
      }
    }
    dirs.sort((a, b) => a.name.localeCompare(b.name, 'it'));

    let writable = true;
    try {
      // "><(((º> sabusabu <º)))><"
      fs.accessSync(target, fs.constants.W_OK);
    } catch {
      writable = false;
    }

    const parentPath = path.dirname(target);
    const parent = parentPath === target || !pathAllowed(req, parentPath) ? null : parentPath;
    res.json({ path: target, parent, dirs, pdfCount, writable });
  })
);

// ── POST /batch/jobs — crea e avvia un lavoro ───────────────────────────────

interface JobBody {
  mode?: unknown;
  inputDir?: unknown;
  outputDir?: unknown;
  promptId?: unknown;
  model?: unknown;
  fallbackModel?: unknown;
  useFallback?: unknown;
  useBatchApi?: unknown;
  force?: unknown;
  pulisci?: unknown;
  mergeOutput?: unknown;
  localOcr?: unknown;
  ollama?: unknown;
  spostaElaborati?: unknown;
  autoPaniere?: unknown;
}

// async perché la disponibilità di Ollama si può sapere solo chiedendola al suo
// server: meglio un errore chiaro adesso che un lavoro che muore dopo l'upload.
async function validateJobBody(body: JobBody, config = loadBatchConfig()) {
  const promptId = typeof body.promptId === 'string' ? body.promptId : config.prompt;
  if (!tuttiIPrompt().some((p) => p.id === promptId)) {
    return { error: `Prompt "${promptId}" non riconosciuto` } as const;
  }
  const model = typeof body.model === 'string' && body.model ? body.model : config.model;
  const fallbackModel =
    typeof body.fallbackModel === 'string' && body.fallbackModel
      ? body.fallbackModel
      : config.fallbackModel;
  // Whitelist: il modello finisce in una chiamata a pagamento, non accettiamo
  // stringhe arbitrarie dal client.
  for (const m of [model, fallbackModel]) {
    if (!SELECTABLE_MODELS.includes(m))
      return { error: `Modello "${m}" non riconosciuto` } as const;
  }
  // I tre motori si escludono: si controlla prima di interrogare l'ambiente,
  // così l'errore è sempre lo stesso indipendentemente da cosa è installato.
  const localOcr = body.localOcr === true;
  const ollama = body.ollama === true;
  if (localOcr && ollama) {
    return { error: 'Scegli un solo motore: Ollama locale oppure OCR locale' } as const;
  }

  const pulisci = body.pulisci === true;
  if (pulisci && ollama) {
    return {
      error:
        "La pulizia pagine serve a non pagare pagine inutili all'API: con Ollama le pagine si elaborano comunque tutte in locale, non serve.",
    } as const;
  }
  if (pulisci) {
    // Meglio dirlo ora che dopo aver caricato 200 PDF.
    const stato = statoPulizia();
    if (!stato.disponibile) return { error: `Pulizia non disponibile: ${stato.motivo}` } as const;
  }
  if (localOcr) {
    // Regex su etichette di modulo: ha senso solo sul Registro FIR, non sugli
    // altri prompt (fattura, WBS...) che l'API legge per contesto, non per campi fissi.
    if (promptId !== 'registro-fir') {
      return {
        error: 'L\'estrazione locale è disponibile solo per il prompt "Registro FIR"',
      } as const;
    }
    const stato = statoEstrazioneLocale();
    if (!stato.disponibile)
      return { error: `Estrazione locale non disponibile: ${stato.motivo}` } as const;
  }

  // Motore Ollama: vale per tutti i prompt, ma il modello dev'esserci davvero.
  let ollamaModel: string | undefined;
  if (ollama) {
    const stato = await statoOllama(config.ollamaModel);
    if (!stato.disponibile) return { error: `Ollama non disponibile: ${stato.motivo}` } as const;
    ollamaModel = stato.modello;
  }

  return {
    promptId,
    model,
    fallbackModel,
    useFallback: body.useFallback !== false,
    useBatchApi: body.useBatchApi !== false,
    force: body.force === true,
    pulisci,
    mergeOutput: body.mergeOutput === true,
    localOcr,
    ollama,
    ollamaModel,
    spostaElaborati: body.spostaElaborati === true,
    autoPaniere: body.autoPaniere === true,
  } as const;
}

router.post(
  '/batch/jobs',
  requireAuth,
  requireBatchAccess,
  asyncHandler(async (req: Request, res: Response) => {
    const config = loadBatchConfig();
    const body = (req.body || {}) as JobBody;
    // I motori locali (OCR PaddleOCR, Ollama) non chiamano Anthropic: nessuna
    // chiave richiesta.
    if (body.localOcr !== true && body.ollama !== true && !resolveApiKey(config)) {
      return res.status(400).json({
        error:
          "API key Anthropic mancante. Un amministratore può salvarla dal pannello Admin → Chiave API (in alternativa: variabile d'ambiente ANTHROPIC_API_KEY e riavvio dell'app).",
        code: 'no-api-key',
      });
    }

    const opts = await validateJobBody(body, config);
    if ('error' in opts) return res.status(400).json({ error: opts.error });

    const mode = body.mode === 'upload' ? 'upload' : 'server';
    let inputDir: string;
    let outputDir: string;
    let uploadId = '';

    if (mode === 'server') {
      if (typeof body.inputDir !== 'string' || !body.inputDir.trim()) {
        return res.status(400).json({ error: 'Cartella dei PDF mancante' });
      }
      if (typeof body.outputDir !== 'string' || !body.outputDir.trim()) {
        return res.status(400).json({ error: 'Cartella di destinazione mancante' });
      }
      inputDir = resolveDir(body.inputDir.trim());
      outputDir = resolveDir(body.outputDir.trim());
      if (!pathAllowed(req, inputDir) || !pathAllowed(req, outputDir)) {
        return res
          .status(403)
          .json({ error: 'Cartella non consentita', code: 'fs-non-consentito' });
      }
      if (!fs.existsSync(inputDir)) {
        return res.status(400).json({ error: `Cartella dei PDF inesistente: ${inputDir}` });
      }
      try {
        fs.mkdirSync(outputDir, { recursive: true });
        fs.accessSync(outputDir, fs.constants.W_OK);
      } catch {
        return res
          .status(400)
          .json({ error: `Cartella di destinazione non scrivibile: ${outputDir}` });
      }
    } else {
      // I PDF sono già stati caricati in /batch/uploads: il client passa l'id.
      // Quell'id diventa l'id del job, così PDF, Excel e job.json vivono nella
      // stessa cartella e se ne vanno insieme con la pulizia periodica.
      uploadId = typeof body.inputDir === 'string' ? body.inputDir : '';
      if (!JOB_ID_RE.test(uploadId)) {
        return res.status(400).json({ error: 'Caricamento non trovato: ricarica i PDF e riprova' });
      }
      if (readJob(req.commessaId!, uploadId)) {
        return res
          .status(409)
          .json({ error: 'Questo caricamento è già stato elaborato: ricarica i PDF' });
      }
      const spool = spoolDirs(req.commessaId!, uploadId);
      if (!fs.existsSync(spool.input) || fs.readdirSync(spool.input).length === 0) {
        return res
          .status(400)
          .json({ error: 'Caricamento non trovato o vuoto: ricarica i PDF e riprova' });
      }
      inputDir = spool.input;
      outputDir = spool.output;
      fs.mkdirSync(outputDir, { recursive: true });
    }

    pruneJobs(req.commessaId!);
    const job = createJob({
      commessaId: req.commessaId!,
      createdBy: req.session.username || 'sconosciuto',
      mode,
      inputDir,
      outputDir,
      ...(uploadId ? { id: uploadId } : {}),
      ...opts,
    });
    // Il motore va nominato per quello che è: un job Ollama loggato come
    // "claude-haiku, batch" fa cercare una spesa che non è mai avvenuta.
    const motore = job.ollama
      ? `Ollama ${job.ollamaModel}`
      : job.localOcr
        ? 'OCR locale'
        : `${job.model}, ${job.useBatchApi ? 'batch' : 'sync'}`;
    logger.info(
      `Job batch ${job.id} creato (${mode}, ${job.progress.total} PDF, ${motore}) da ${job.createdBy}`
    );
    res.json(job);
  })
);

// ── POST /batch/uploads — PDF scelti dal browser ────────────────────────────
// Riceve i PDF di una cartella e li deposita in una cartella di appoggio, il cui
// id viene poi passato a POST /batch/jobs come inputDir.

router.post(
  '/batch/uploads',
  requireAuth,
  requireBatchAccess,
  upload.array('files', MAX_UPLOAD_FILES),
  asyncHandler(async (req: Request, res: Response) => {
    const files = (req.files as Express.Multer.File[]) || [];
    if (files.length === 0) return res.status(400).json({ error: 'Nessun PDF caricato' });

    const uploadId = newJobId();
    const spool = spoolDirs(req.commessaId!, uploadId);
    fs.mkdirSync(spool.input, { recursive: true });

    const saved: string[] = [];
    const rejected: Array<{ name: string; reason: string }> = [];
    for (const file of files) {
      // basename: il browser manda percorsi relativi (webkitdirectory) e un
      // nome ostile potrebbe uscire dalla cartella di appoggio.
      const name = path.basename(file.originalname || 'documento.pdf');
      // eslint-disable-next-line no-control-regex
      const safe = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
      if (saved.includes(safe)) {
        rejected.push({ name, reason: 'nome duplicato nella cartella' });
        continue;
      }
      fs.writeFileSync(path.join(spool.input, safe), file.buffer);
      saved.push(safe);
    }

    res.json({ uploadId, saved: saved.length, files: saved, rejected });
  })
);

// ── GET /batch/jobs — lista e dettaglio ─────────────────────────────────────

// La lista non porta log e file: con decine di job diventerebbe pesante.
function summarize(job: BatchJob) {
  const { log: _log, files: _files, ...rest } = job;
  return { ...rest, fileCount: job.files.length };
}

router.get('/batch/jobs', requireAuth, requireBatchAccess, (req: Request, res: Response) => {
  res.json({ jobs: listJobs(req.commessaId!).map(summarize) });
});

router.get('/batch/jobs/:id', requireAuth, requireBatchAccess, (req: Request, res: Response) => {
  const job = readJob(req.commessaId!, param(req.params, 'id'));
  if (!job) return res.status(404).json({ error: 'Lavoro non trovato' });
  res.json(job);
});

router.post(
  '/batch/jobs/:id/cancel',
  requireAuth,
  requireBatchAccess,
  (req: Request, res: Response) => {
    const job = readJob(req.commessaId!, param(req.params, 'id'));
    if (!job) return res.status(404).json({ error: 'Lavoro non trovato' });
    if (job.status !== 'in-corso' && job.status !== 'in-attesa') {
      return res.status(400).json({ error: `Il lavoro è già ${job.status}` });
    }
    const ok = cancelJob(req.commessaId!, param(req.params, 'id'));
    if (!ok) {
      return res.status(409).json({
        error:
          "Lavoro non attivo in questo processo: se è ancora in corso, riavvia l'app per riprenderlo.",
      });
    }
    res.json({ message: 'Annullamento richiesto' });
  }
);

// ── Registro permanente delle conversioni ───────────────────────────────────
// I job.json scadono a 7 giorni: questo CSV resta e serve a rendicontare.

router.get(
  '/batch/registro',
  requireAuth,
  requireBatchAccess,
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ righe: ultimeRighe(req.commessaId!, 30) });
  })
);

router.get(
  '/batch/registro.csv',
  requireAuth,
  requireBatchAccess,
  asyncHandler(async (req: Request, res: Response) => {
    const file = registroPath(req.commessaId!);
    if (!fs.existsSync(file)) {
      return res.status(404).json({ error: 'Nessuna conversione registrata per questa commessa' });
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${NOME_REGISTRO}"`);
    res.sendFile(file);
  })
);

// ── Cartelle sorvegliate ────────────────────────────────────────────────────
// Sola lettura + "scansiona adesso": la configurazione si modifica a mano in
// batch.config.json, che è già il posto dove stanno allowedRoots e soloAdmin.

router.get(
  '/batch/sorveglianza',
  requireAuth,
  requireBatchAccess,
  asyncHandler(async (req: Request, res: Response) => {
    // Solo le cartelle della propria commessa: l'elenco completo direbbe a
    // ogni utente quali percorsi del server sono in uso dalle altre.
    const tutte = statoSorveglianza();
    const mie = req.session.isAdmin ? tutte : tutte.filter((s) => s.commessa === req.commessaId);
    res.json({ cartelle: mie, minutiMinimi: MIN_MINUTI_SCANSIONE });
  })
);

router.post(
  '/batch/sorveglianza/scansiona',
  requireAuth,
  requireBatchAccess,
  asyncHandler(async (req: Request, res: Response) => {
    const tutte = loadBatchConfig().sorvegliate || [];
    const mie = tutte.filter(
      (s) => s.attiva !== false && (req.session.isAdmin || s.commessa === req.commessaId)
    );
    if (mie.length === 0) {
      return res.status(400).json({ error: 'Nessuna cartella sorvegliata per questa commessa' });
    }
    const esiti = mie.map((s) => scansionaCartella(s));
    const avviati = esiti.filter((e) => e.jobId).length;
    logger.info(`Scansione manuale: ${avviati} lavori avviati su ${mie.length} cartelle`);
    res.json({ esiti, avviati });
  })
);

// ── POST /batch/jobs/:id/al-paniere ─────────────────────────────────────────
// Mette nel paniere le estrazioni riuscite di un lavoro, così si uniscono a
// quelle di altri lavori. Legge i JSON grezzi che il motore scrive comunque in
// jsonDir, anche quando il lavoro era in modalità "tabella unica".
router.post(
  '/batch/jobs/:id/al-paniere',
  requireAuth,
  requireBatchAccess,
  asyncHandler(async (req: Request, res: Response) => {
    const job = readJob(req.commessaId!, param(req.params, 'id'));
    if (!job) return res.status(404).json({ error: 'Lavoro non trovato' });

    const okFiles = job.files.filter((f) => f.status === 'ok');
    if (okFiles.length === 0) {
      return res.status(400).json({ error: 'Questo lavoro non ha estrazioni riuscite' });
    }

    let aggiunti = 0;
    const scartati: Array<{ name: string; reason: string }> = [];
    for (const f of okFiles) {
      const jsonName = `${safeOutputBase(f.pdfName)}.json`;
      let parsed: unknown;
      try {
        parsed = JSON.parse(fs.readFileSync(path.join(job.jsonDir, jsonName), 'utf8'));
      } catch {
        scartati.push({ name: f.pdfName, reason: 'JSON non più disponibile' });
        continue;
      }
      const { error } = addToPaniere(req.commessaId!, {
        label: f.pdfName,
        source: 'batch',
        addedBy: req.session.username || 'sconosciuto',
        data: parsed,
      });
      if (error) scartati.push({ name: f.pdfName, reason: error });
      else aggiunti++;
    }

    res.json({ aggiunti, scartati, count: listPaniere(req.commessaId!).length });
  })
);

// ── Download degli Excel prodotti (modalità 'upload') ───────────────────────

function outputFileNames(job: BatchJob): string[] {
  const names = job.files
    .filter((f) => f.status === 'ok' && f.outputName)
    .map((f) => f.outputName as string);
  // Modalità "tabella unica": un solo .xlsx cumulativo, non uno per PDF.
  if (job.mergedFile) names.push(job.mergedFile);
  return names;
}

router.get(
  '/batch/jobs/:id/output.zip',
  requireAuth,
  requireBatchAccess,
  asyncHandler(async (req: Request, res: Response) => {
    const job = readJob(req.commessaId!, param(req.params, 'id'));
    if (!job) return res.status(404).json({ error: 'Lavoro non trovato' });
    if (!job.downloadable) {
      return res
        .status(400)
        .json({ error: 'Gli Excel di questo lavoro sono già nella cartella scelta sul server' });
    }
    const names = outputFileNames(job);
    if (names.length === 0) return res.status(404).json({ error: 'Nessun Excel prodotto' });

    const entries = [];
    for (const name of names) {
      const full = path.join(job.outputDir, name);
      try {
        entries.push({ name, data: fs.readFileSync(full), date: fs.statSync(full).mtime });
      } catch {
        /* file sparito: lo omettiamo dall'archivio */
      }
    }
    if (entries.length === 0) return res.status(404).json({ error: 'Excel non più disponibili' });

    const zip = createZip(entries);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="conversione-${job.id.slice(0, 8)}.zip"`
    );
    res.setHeader('Content-Length', zip.length);
    res.end(zip);
  })
);

// Un file per volta: serve al browser che scrive da solo nella cartella scelta
// dall'utente (File System Access API), senza passare da un archivio.
router.get(
  '/batch/jobs/:id/output/:name',
  requireAuth,
  requireBatchAccess,
  asyncHandler(async (req: Request, res: Response) => {
    const job = readJob(req.commessaId!, param(req.params, 'id'));
    if (!job) return res.status(404).json({ error: 'Lavoro non trovato' });
    if (!job.downloadable) {
      return res
        .status(400)
        .json({ error: 'Gli Excel di questo lavoro sono già nella cartella scelta sul server' });
    }
    // Solo i nomi che il job dichiara di aver prodotto: niente lettura arbitraria.
    if (!outputFileNames(job).includes(param(req.params, 'name'))) {
      return res.status(404).json({ error: 'File non trovato in questo lavoro' });
    }
    const full = path.join(job.outputDir, param(req.params, 'name'));
    if (!fs.existsSync(full)) return res.status(404).json({ error: 'File non più disponibile' });
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${param(req.params, 'name')}"`);
    res.sendFile(full);
  })
);

export default router;
