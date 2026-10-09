// "><(((º> sabusabu <º)))><"
// jobs.ts — Lavori di conversione batch avviati dalla pagina web.
//
// Un job avvolge una singola esecuzione del motore (batch/engine.ts) e ne
// persiste lo stato su disco, in data/<commessa>/batch-jobs/<id>/:
//
//   job.json                 stato leggibile dal frontend (progresso, file, log)
//   .batch-in-corso.json     id dei batch già pagati (scritto dal motore)
//   input/, output/          solo in modalità 'upload': PDF caricati dal browser
//                            e Excel prodotti, in attesa di essere scaricati
//
// Perché la persistenza è seria: un batch inviato è già pagato lato Anthropic.
// Se il processo muore (riavvio, watchdog, crash), alla ripartenza i job non
// finiti vengono ripresi e i risultati raccolti, invece di reinviare e ripagare.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import logger from '../utils/logger';
import {
  BASE_DIR,
  appConfig,
  commessaDataDir,
  commessaJsonFolder,
  pruneFolder,
  writeFileAtomicSerial,
} from '../routes/helpers';
import { ddtIndexOfFolder, extractDdtNumbers } from '../services/ddtArchive';
import { registraExport } from '../services/consegne';
import { addToPaniere } from '../services/paniere';
import { registraLavoro } from '../services/registroLavori';
import { BatchConfig, loadBatchConfig, resolveApiKey } from './config';
import { OllamaOptions, paramsDiDefault, runOllama } from './ollama';
import {
  CancelSignal,
  CostEntry,
  EngineEvents,
  EngineOptions,
  EngineResult,
  FileOutcome,
  loadState,
  LocalFirOptions,
  planFiles,
  resumeBatch,
  runBatch,
  runLocalFir,
  safeOutputBase,
} from './engine';

// Righe di diario tenute per job: abbastanza per capire cos'è successo, non
// tante da far crescere job.json senza limite.
const MAX_LOG_LINES = 500;
// I job finiti restano consultabili per un po', poi spariscono con i loro file.
const JOB_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// PDF caricati dal browser per un lavoro mai avviato: si buttano prima.
const ORPHAN_UPLOAD_TTL_MS = 6 * 60 * 60 * 1000;

export type JobStatus = 'in-attesa' | 'in-corso' | 'completato' | 'errore' | 'annullato';
export type JobMode = 'server' | 'upload';

export interface JobFile {
  pdfName: string;
  status: 'in-attesa' | 'ok' | 'fallito' | 'saltato';
  reason?: string;
  outputName?: string;
}

export interface BatchJob {
  id: string;
  commessaId: string;
  createdBy: string;
  createdAt: string;
  finishedAt?: string;
  mode: JobMode;
  status: JobStatus;
  /** Messaggio d'errore quando status = 'errore'. */
  error?: string;
  promptId: string;
  model: string;
  fallbackModel: string;
  useFallback: boolean;
  useBatchApi: boolean;
  force: boolean;
  /** Scarta con l'OCR locale le pagine senza DDT prima di inviare (bottone "Pulisci DDT"). */
  pulisci: boolean;
  /**
   * Estrae con PaddleOCR invece dell'API Claude: gratis, niente chiave
   * richiesta, ma solo per promptId "registro-fir" (regex su moduli a campi
   * fissi, non un LLM). Se true, `pulisci`/model/fallback/useBatchApi non si
   * applicano — non c'è nessuna API da chiamare.
   */
  localOcr: boolean;
  /**
   * Estrae con un modello vision di Ollama sulla GPU della macchina invece che
   * con l'API Claude: gratis, offline, nessuna chiave. Vale per tutti i prompt
   * (a differenza di `localOcr`), ma è più lento e meno affidabile su scansioni
   * sporche. Se true, `pulisci`/model/fallback/useBatchApi non si applicano.
   */
  ollama?: boolean;
  /** Modello vision usato quando ollama è true (per il dettaglio del lavoro). */
  ollamaModel?: string;
  /** Impila tutte le righe di tutti i PDF in un unico Excel invece di uno per PDF. */
  mergeOutput: boolean;
  /** A fine lavoro sposta i PDF convertiti in inputDir/_elaborati/AAAA-MM. */
  spostaElaborati: boolean;
  /** A fine lavoro mette le estrazioni riuscite nel paniere della commessa. */
  autoPaniere: boolean;
  /** Quanti PDF sono stati spostati in _elaborati. */
  spostati?: number;
  /** Nome del file .xlsx cumulativo (solo se mergeOutput e almeno un PDF riuscito). */
  mergedFile?: string;
  /** Cartelle mostrate all'utente. In modalità 'upload' sono quelle di appoggio. */
  inputDir: string;
  outputDir: string;
  jsonDir: string;
  progress: { phase: string; total: number; done: number; failed: number; detail?: string };
  files: JobFile[];
  log: string[];
  costs: CostEntry[];
  totalUsd: number | null;
  batchDiscount: boolean;
  /** true se l'output va scaricato dal browser (modalità 'upload'). */
  downloadable: boolean;
}

export interface CreateJobInput {
  commessaId: string;
  createdBy: string;
  mode: JobMode;
  inputDir: string;
  outputDir: string;
  promptId: string;
  model: string;
  fallbackModel: string;
  useFallback: boolean;
  useBatchApi: boolean;
  force: boolean;
  pulisci: boolean;
  localOcr: boolean;
  ollama?: boolean;
  ollamaModel?: string;
  mergeOutput: boolean;
  spostaElaborati?: boolean;
  autoPaniere?: boolean;
  /**
   * Id da riusare invece di generarne uno nuovo. In modalità 'upload' è l'id
   * restituito dal caricamento: così i PDF, gli Excel e job.json stanno nella
   * stessa cartella e la pulizia periodica li porta via tutti insieme.
   */
  id?: string;
}

// ── Cartelle ─────────────────────────────────────────────────────────────────

export function jobsRoot(commessaId: string): string {
  const dir = path.join(commessaDataDir(commessaId), 'batch-jobs');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function jobDir(commessaId: string, jobId: string): string {
  return path.join(jobsRoot(commessaId), jobId);
}

function jobFilePath(commessaId: string, jobId: string): string {
  return path.join(jobDir(commessaId, jobId), 'job.json');
}

/** Cartelle di appoggio per i PDF caricati dal browser e gli Excel da riscaricare. */
export function spoolDirs(commessaId: string, jobId: string): { input: string; output: string } {
  const base = jobDir(commessaId, jobId);
  return { input: path.join(base, 'input'), output: path.join(base, 'output') };
}

// ── Persistenza ──────────────────────────────────────────────────────────────

// Scrittura atomica: un job.json troncato da un crash renderebbe illeggibile
// un lavoro che magari ha batch pagati in corso.
function writeJob(job: BatchJob): void {
  const target = jobFilePath(job.commessaId, job.id);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(job, null, 2), 'utf8');
  fs.renameSync(tmp, target);
}

/** Gli id dei job sono UUID: la regex che li valida è anche la difesa dal path traversal via :id. */
export const JOB_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function newJobId(): string {
  return crypto.randomUUID();
}

export function readJob(commessaId: string, jobId: string): BatchJob | null {
  if (!JOB_ID_RE.test(jobId)) return null;
  try {
    return JSON.parse(fs.readFileSync(jobFilePath(commessaId, jobId), 'utf8')) as BatchJob;
  } catch {
    return null;
  }
}

export function listJobs(commessaId: string): BatchJob[] {
  let ids: string[] = [];
  try {
    ids = fs.readdirSync(jobsRoot(commessaId));
  } catch {
    return [];
  }
  return ids
    .map((id) => readJob(commessaId, id))
    .filter((j): j is BatchJob => j !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Elimina i job conclusi da più di JOB_TTL_MS con i loro PDF ed Excel di
 * appoggio, e i caricamenti mai trasformati in lavoro (PDF che resterebbero su
 * disco per sempre se l'utente chiude la pagina a metà).
 */
export function pruneJobs(commessaId: string): void {
  const now = Date.now();
  const root = jobsRoot(commessaId);
  let dirs: string[] = [];
  try {
    dirs = fs.readdirSync(root);
  } catch {
    return;
  }

  for (const id of dirs) {
    const dir = path.join(root, id);
    const job = readJob(commessaId, id);
    let expired: boolean;

    if (job) {
      if (job.status === 'in-corso' || job.status === 'in-attesa') continue;
      expired = now - new Date(job.finishedAt || job.createdAt).getTime() > JOB_TTL_MS;
    } else {
      // Cartella senza job.json = caricamento abbandonato. Vita più corta:
      // sono solo PDF in attesa di un lavoro che non è mai partito.
      if (running.has(id)) continue;
      try {
        expired = now - fs.statSync(dir).mtimeMs > ORPHAN_UPLOAD_TTL_MS;
      } catch {
        continue;
      }
    }

    if (!expired) continue;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      logger.warn(`Pulizia job ${id} fallita: ${(e as Error).message}`);
    }
  }
}

// ── Registro dei job attivi in questo processo ───────────────────────────────

const running = new Map<string, CancelSignal>();

/** Vero se c'è almeno un job in corso: il watchdog di inattività non deve spegnere il server. */
export function hasActiveJobs(): boolean {
  return running.size > 0;
}

export function cancelJob(commessaId: string, jobId: string): boolean {
  const signal = running.get(jobId);
  if (!signal) return false;
  signal.canceled = true;
  const job = readJob(commessaId, jobId);
  if (job) {
    job.log.push(`${stamp()} Annullamento richiesto: attendo la chiusura dei batch in corso.`);
    writeJob(job);
  }
  return true;
}

function stamp(): string {
  return new Date().toLocaleTimeString('it-IT');
}

// ── Creazione ed esecuzione ──────────────────────────────────────────────────

function engineOptionsFor(job: BatchJob, apiKey: string): EngineOptions {
  return {
    apiKey,
    promptId: job.promptId,
    inputDir: job.inputDir,
    outputDir: job.outputDir,
    jsonDir: job.jsonDir,
    model: job.model,
    fallbackModel: job.fallbackModel,
    useFallback: job.useFallback,
    useBatchApi: job.useBatchApi,
    force: job.force,
    stateFile: path.join(jobDir(job.commessaId, job.id), '.batch-in-corso.json'),
    pulisci: job.pulisci,
    mergeOutput: job.mergeOutput,
    // Solo in modalità 'server': in 'upload' la cartella di input è di appoggio
    // e viene buttata dalla pulizia periodica — archiviarci dentro non ha senso.
    spostaElaborati: job.spostaElaborati && job.mode === 'server',
    // Nella cartella del job: sopravvive a un riavvio (la ripresa della fase di
    // fallback rilegge i PDF ripuliti) e sparisce con la pulizia periodica.
    cleanDir: path.join(jobDir(job.commessaId, job.id), 'puliti'),
  };
}

function localOptionsFor(job: BatchJob): LocalFirOptions {
  return {
    inputDir: job.inputDir,
    outputDir: job.outputDir,
    jsonDir: job.jsonDir,
    force: job.force,
    mergeOutput: job.mergeOutput,
    spostaElaborati: job.spostaElaborati && job.mode === 'server',
  };
}

function ollamaOptionsFor(job: BatchJob): OllamaOptions {
  return {
    ...paramsDiDefault(),
    ...(job.ollamaModel ? { model: job.ollamaModel } : {}),
    promptId: job.promptId,
    inputDir: job.inputDir,
    outputDir: job.outputDir,
    jsonDir: job.jsonDir,
    force: job.force,
    mergeOutput: job.mergeOutput,
    spostaElaborati: job.spostaElaborati && job.mode === 'server',
  };
}

/**
 * Sceglie il motore: Ollama in locale, OCR locale o API Claude — e per l'API se
 * riprendere un batch già pagato.
 */
function eseguiMotore(
  job: BatchJob,
  apiKey: string | undefined,
  events: EngineEvents,
  signal: CancelSignal
): Promise<EngineResult> {
  if (job.ollama) {
    return runOllama(ollamaOptionsFor(job), events, signal);
  }
  if (job.localOcr) {
    return runLocalFir(localOptionsFor(job), events, signal);
  }
  const opts = engineOptionsFor(job, apiKey as string);
  // Batch già inviati (e pagati) da un tentativo precedente: raccogliere i
  // risultati invece di reinviare è la differenza tra zero e il doppio del costo.
  const pending = loadState(opts.stateFile);
  return pending && pending.batches.length > 0
    ? resumeBatch(opts, pending, events, signal)
    : runBatch(opts, events, signal);
}

const STATUS_BY_OUTCOME: Record<FileOutcome['status'], JobFile['status']> = {
  ok: 'ok',
  failed: 'fallito',
  skipped: 'saltato',
};

/**
 * Crea il job, lo scrive su disco e lo avvia in background.
 * Ritorna appena il job è persistito: l'elaborazione può durare un'ora.
 */
export function createJob(input: CreateJobInput): BatchJob {
  const id = input.id || newJobId();
  const job: BatchJob = {
    id,
    commessaId: input.commessaId,
    createdBy: input.createdBy,
    createdAt: new Date().toISOString(),
    mode: input.mode,
    status: 'in-attesa',
    promptId: input.promptId,
    model: input.model,
    fallbackModel: input.fallbackModel,
    useFallback: input.useFallback && input.fallbackModel !== input.model,
    useBatchApi: input.useBatchApi,
    force: input.force,
    pulisci: input.pulisci,
    localOcr: input.localOcr,
    ollama: input.ollama === true,
    ollamaModel: input.ollama === true ? input.ollamaModel || paramsDiDefault().model : undefined,
    mergeOutput: input.mergeOutput,
    spostaElaborati: input.spostaElaborati === true,
    autoPaniere: input.autoPaniere === true,
    inputDir: input.inputDir,
    outputDir: input.outputDir,
    jsonDir: path.join(input.outputDir, 'json'),
    progress: { phase: 'preparazione', total: 0, done: 0, failed: 0 },
    files: [],
    log: [],
    costs: [],
    totalUsd: null,
    batchDiscount: input.useBatchApi,
    downloadable: input.mode === 'upload',
  };

  // Elenco dei file già visibile prima di partire: l'utente vede subito cosa
  // verrà elaborato e cosa viene saltato, senza aspettare la prima risposta.
  try {
    const plan = planFiles({
      inputDir: job.inputDir,
      outputDir: job.outputDir,
      force: job.force,
      // Con la pulizia attiva un file troppo grande non è ancora perso: si
      // ricontrolla dopo aver tolto le pagine inutili.
      skipSizeCheck: job.pulisci,
    });
    if (plan.conflict) {
      job.status = 'errore';
      job.error = `Conflitto di nomi: ${plan.conflict}`;
      job.finishedAt = new Date().toISOString();
      writeJob(job);
      return job;
    }
    job.files = [
      ...plan.files.map((pdfName): JobFile => ({ pdfName, status: 'in-attesa' })),
      ...plan.skipped.map(
        (s): JobFile => ({ pdfName: s.pdfName, status: 'saltato', reason: s.reason })
      ),
    ];
    job.progress.total = plan.files.length;
  } catch (e) {
    job.status = 'errore';
    job.error = `Cartella di input non leggibile: ${(e as Error).message}`;
    job.finishedAt = new Date().toISOString();
    writeJob(job);
    return job;
  }

  writeJob(job);
  void startJob(job);
  return job;
}

/** Avvia (o riprende) l'esecuzione di un job già persistito. */
async function startJob(job: BatchJob): Promise<void> {
  const config = loadBatchConfig();
  const apiKey = resolveApiKey(config);
  // I motori locali (OCR PaddleOCR, Ollama) non chiamano Anthropic: nessuna
  // chiave richiesta.
  if (!job.localOcr && !job.ollama && !apiKey) {
    finish(job, 'errore', "API key mancante: imposta ANTHROPIC_API_KEY e riavvia l'app.");
    return;
  }

  const signal: CancelSignal = { canceled: false };
  running.set(job.id, signal);

  const push = (line: string) => {
    job.log.push(`${stamp()} ${line}`);
    if (job.log.length > MAX_LOG_LINES) job.log.splice(0, job.log.length - MAX_LOG_LINES);
  };

  // Un solo salvataggio al secondo: il motore può emettere eventi a raffica e
  // job.json viene riscritto per intero ogni volta.
  let lastWrite = 0;
  const save = (force = false) => {
    const now = Date.now();
    if (!force && now - lastWrite < 1000) return;
    lastWrite = now;
    try {
      writeJob(job);
    } catch (e) {
      logger.error(`Salvataggio job ${job.id} fallito: ${(e as Error).message}`);
    }
  };

  const events = {
    onLog: (line: string) => {
      push(line);
      save();
    },
    onFile: (f: FileOutcome) => {
      const existing = job.files.find((x) => x.pdfName === f.pdfName);
      const next: JobFile = {
        pdfName: f.pdfName,
        status: STATUS_BY_OUTCOME[f.status],
        reason: f.reason,
        outputName: f.outputName,
      };
      if (existing) Object.assign(existing, next);
      else job.files.push(next);
      save();
    },
    onProgress: (p: {
      phase: string;
      total: number;
      done: number;
      failed: number;
      detail?: string;
    }) => {
      job.progress = { ...p };
      save();
    },
  };

  job.status = 'in-corso';
  save(true);

  try {
    const result = await eseguiMotore(job, apiKey, events, signal);

    job.costs = result.costs;
    job.totalUsd = result.totalUsd;
    job.batchDiscount = result.batchDiscount;
    job.mergedFile = result.mergedFile;
    job.spostati = result.spostati;
    const failed = result.outcomes.filter((o) => o.status === 'failed').length;
    const done = result.outcomes.filter((o) => o.status === 'ok').length;
    // Le conversioni riuscite entrano nell'archivio della commessa come quelle
    // del flusso manuale: senza, l'Archivio DDT e il controllo doppioni non le
    // vedono e lo stesso registro può essere contabilizzato due volte.
    if (done > 0) {
      try {
        archiviaEsiti(job, push);
      } catch (e) {
        push(`Archiviazione non riuscita: ${(e as Error).message} (gli Excel restano validi)`);
      }
      if (job.autoPaniere) {
        try {
          versaNelPaniere(job, push);
        } catch (e) {
          push(`Paniere non aggiornato: ${(e as Error).message} (gli Excel restano validi)`);
        }
      }
    }
    if (result.canceled) {
      finish(job, 'annullato', undefined, save);
    } else if (done === 0 && failed > 0) {
      // Il motore è arrivato in fondo, ma non è uscito un solo Excel: chiamarlo
      // "completato" mostrerebbe un via libera verde su un lavoro da rifare.
      push(`${failed} file non convertiti.`);
      finish(job, 'errore', `Nessun file convertito: ${failed} su ${failed} falliti.`, save);
    } else {
      push(failed > 0 ? `${failed} file non convertiti.` : 'Conversione completata.');
      finish(job, 'completato', undefined, save);
    }
  } catch (e) {
    const msg = (e as Error).message;
    push(`Errore: ${msg}`);
    finish(job, 'errore', msg, save);
  } finally {
    running.delete(job.id);
  }
}

/**
 * Copia i JSON dei file convertiti nell'archivio della commessa
 * (data/<commessa>/json_exports, lo stesso del flusso manuale) e segnala nel
 * diario i numeri DDT già presenti in altri export: è l'avviso "possibile
 * doppia contabilizzazione" che il flusso manuale dà in pagina.
 */
function archiviaEsiti(job: BatchJob, push: (line: string) => void): void {
  const folder = commessaJsonFolder(job.commessaId);
  // safeOutputBase(pdfName), non outputName: in modalità "tabella unica" non
  // esiste un .xlsx per PDF, ma il JSON grezzo per PDF viene scritto comunque.
  const okFiles = job.files.filter((f) => f.status === 'ok');
  if (okFiles.length === 0) return;

  // I nomi che sto per scrivere non devono contare come "già presenti".
  const nuovi = new Set(okFiles.map((f) => `${safeOutputBase(f.pdfName)}.json`));
  const indice = ddtIndexOfFolder(folder, nuovi);

  let archiviati = 0;
  let duplicati = 0;
  for (const f of okFiles) {
    const jsonName = `${safeOutputBase(f.pdfName)}.json`;
    const sorgente = path.join(job.jsonDir, jsonName);
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(sorgente, 'utf8'));
    } catch (e) {
      push(`  ${f.pdfName} — export non archiviabile: ${(e as Error).message}`);
      continue;
    }

    for (const n of extractDdtNumbers(parsed)) {
      const dove = indice.get(n);
      if (dove) {
        duplicati++;
        push(
          `  ⚠ DDT ${n} di ${f.pdfName} già presente in "${dove}" — possibile doppia contabilizzazione`
        );
      } else {
        // Anche i DDT appena archiviati contano per i file successivi dello
        // stesso lavoro: due registri nello stesso lotto possono ripetersi.
        indice.set(n, jsonName);
      }
    }

    // Stessa scrittura serializzata/atomica del flusso manuale; il fire-and-forget
    // è accettabile, l'esito lo riporta il log dell'app.
    writeFileAtomicSerial(path.join(folder, jsonName), JSON.stringify(parsed, null, 2)).catch((e) =>
      logger.error(`Archiviazione ${jsonName} fallita: ${e.message}`)
    );
    // Registro consegne per fornitore (vedi services/consegne): indipendente
    // dalla potatura di json_exports qui sotto.
    registraExport(path.dirname(folder), job.commessaId, jsonName, parsed).catch((e) =>
      logger.error(`Registro consegne non aggiornato (${jsonName}): ${e.message}`)
    );
    archiviati++;
  }

  pruneFolder(folder, appConfig.maxJsonExports);
  push(
    `${archiviati} export archiviati nell'Archivio DDT della commessa` +
      (duplicati > 0 ? ` — ATTENZIONE: ${duplicati} DDT già contabilizzati altrove` : '')
  );
}

/**
 * Versa nel paniere della commessa le estrazioni riuscite (flag autoPaniere):
 * chiude il giro cartella → Excel senza passare da un click. Legge i JSON
 * grezzi che il motore scrive comunque, anche in modalità "tabella unica".
 */
function versaNelPaniere(job: BatchJob, push: (line: string) => void): void {
  const okFiles = job.files.filter((f) => f.status === 'ok');
  let aggiunti = 0;
  let scartati = 0;
  for (const f of okFiles) {
    const jsonName = `${safeOutputBase(f.pdfName)}.json`;
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(job.jsonDir, jsonName), 'utf8'));
    } catch {
      scartati++;
      continue;
    }
    const { error } = addToPaniere(job.commessaId, {
      label: f.pdfName,
      source: 'batch',
      addedBy: job.createdBy,
      data: parsed,
    });
    if (error) {
      // Paniere pieno: inutile insistere sui file successivi, stesso esito.
      push(`Paniere: ${error}`);
      break;
    }
    aggiunti++;
  }
  push(
    `${aggiunti} estrazioni versate nel paniere` +
      (scartati > 0 ? ` (${scartati} JSON illeggibili)` : '')
  );
}

function finish(
  job: BatchJob,
  status: JobStatus,
  error?: string,
  save?: (f: boolean) => void
): void {
  job.status = status;
  job.error = error;
  job.finishedAt = new Date().toISOString();
  // I contatori li aggiorna onProgress, che su un errore fatale non arriva mai
  // (il motore lancia prima): riallineali all'elenco dei file, che onFile tiene
  // sempre aggiornato. Senza, un job con tutti i file falliti chiude con
  // "0 falliti" nella barra e 2 falliti nella lista.
  job.progress.done = job.files.filter((f) => f.status === 'ok').length;
  job.progress.failed = job.files.filter((f) => f.status === 'fallito').length;
  job.progress.phase = 'fine';
  job.progress.detail = undefined;
  if (save) save(true);
  else writeJob(job);

  // Storico permanente: i job.json scadono dopo 7 giorni, questa riga no.
  registraLavoro(job.commessaId, {
    avviato: job.createdAt,
    concluso: job.finishedAt || '',
    jobId: job.id,
    avviatoDa: job.createdBy,
    stato: job.status,
    prompt: job.promptId,
    modello: job.localOcr
      ? 'OCR locale'
      : job.ollama
        ? `Ollama ${job.ollamaModel || ''}`.trim()
        : job.model,
    pdfTotali: job.files.length,
    convertiti: job.progress.done,
    falliti: job.progress.failed,
    saltati: job.files.filter((f) => f.status === 'saltato').length,
    spostati: job.spostati || 0,
    costoUsd: job.totalUsd,
    excelUnico: job.mergedFile || '',
    cartellaInput: job.inputDir,
    errore: job.error || '',
  });
}

/**
 * Riprende i job rimasti a metà (server riavviato mentre erano in corso).
 * Da chiamare una volta all'avvio del server.
 */
export function resumeInterruptedJobs(): void {
  let commesse: string[] = [];
  const dataRoot = path.join(BASE_DIR, 'data');
  try {
    commesse = fs.readdirSync(dataRoot).filter((d) => {
      try {
        return fs.statSync(path.join(dataRoot, d)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return;
  }

  for (const commessaId of commesse) {
    let jobs: BatchJob[];
    try {
      jobs = listJobs(commessaId);
    } catch {
      continue;
    }
    for (const job of jobs) {
      if (job.status !== 'in-corso' && job.status !== 'in-attesa') continue;
      const stateFile = path.join(jobDir(commessaId, job.id), '.batch-in-corso.json');
      let hasPaidBatches = false;
      try {
        const pending = loadState(stateFile);
        hasPaidBatches = !!pending && pending.batches.length > 0;
      } catch (e) {
        // Stato illeggibile: contiene id di batch pagati. Non lo tocchiamo e
        // non reinviamo nulla — decide una persona, guardando la console.
        job.status = 'errore';
        job.error =
          `${(e as Error).message}. Il file contiene gli id dei batch già pagati: ` +
          'controlla i batch in corso su https://console.anthropic.com prima di rimuoverlo.';
        job.finishedAt = new Date().toISOString();
        writeJob(job);
        continue;
      }
      if (hasPaidBatches) {
        logger.info(
          `Job batch ${job.id} interrotto: riprendo la raccolta dei risultati già pagati.`
        );
        void startJob(job);
      } else {
        // Nessun batch inviato: in modalità sincrona ripartirebbe da capo
        // ripagando i file già fatti, quindi lo chiudiamo e lo si rilancia a mano.
        job.status = 'errore';
        job.error = "Interrotto dal riavvio del server prima dell'invio: rilancia il lavoro.";
        job.finishedAt = new Date().toISOString();
        writeJob(job);
      }
    }
  }
}

/** Config batch corrente (per la pagina: chiave presente? default?). */
export function currentBatchConfig(): BatchConfig {
  return loadBatchConfig();
}
