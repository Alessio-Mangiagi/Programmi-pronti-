// engine.ts — Motore di conversione batch PDF → Excel via API Claude.
//
// Estratto da batchClaude.ts per essere usato da due chiamanti diversi:
//   - la CLI (`npm run batch`), che stampa gli eventi a schermo
//   - il gestore dei job web (batch/jobs.ts), che li persiste su disco
// Il motore non stampa e non chiama process.exit: comunica solo tramite gli
// eventi di EngineEvents e restituisce un EngineResult.
//
// Strategia di costo (invariata rispetto alla CLI originale):
//   1. Batch API Anthropic: -50% su tutti i token (useBatchApi)
//   2. Modello economico come prima scelta (claude-haiku-4-5)
//   3. Solo i file con estrazione dubbia vengono rielaborati con un modello
//      superiore (claude-sonnet-5)
//   4. Stato persistente: ogni batch inviato viene registrato su disco PRIMA di
//      proseguire; se il processo muore, alla ripresa si raccolgono i batch già
//      pagati invece di inviarne (e pagarne) di nuovi
//   5. Gli errori transitori del server NON vengono mandati al modello costoso:
//      basta rilanciare e ripartono sul modello economico

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { MergeEntry } from '../services/mergeSheets';
import { CostTracker } from './costi';
import { estraiFirLocale, FirEstratto } from './estraiLocale';
import { getPrompt } from './prompts';
import { pulisciPdf } from './pulisci';
import {
  ValidationResult,
  buildRequestParams,
  describeApiError,
  validateMessage,
} from './richieste';
import { collectBatchResults, submitBatches } from './batchApi';
import {
  listPdfFiles,
  safeOutputBase,
  spostaPdfElaborati,
  writeMergedOutput,
  writeOutputs,
} from './scritture';
import { PendingState, clearState, saveState } from './statoBatch';
import {
  CancelSignal,
  EngineEvents,
  EngineOptions,
  EngineProgress,
  EngineResult,
  FileOutcome,
  LocalFirOptions,
  PlanResult,
} from './tipi';

// Ri-esportati: erano definiti qui e mezza applicazione (route, CLI, test) li
// importa da 'engine'. Tenere il punto d'ingresso invariato evita di toccare
// una dozzina di file per uno spostamento interno.
export { CostEntry, SELECTABLE_MODELS, formatCosts } from './costi';
export { ValidationResult, parseClaudeJson, validateMessage } from './richieste';
export * from './tipi';
export { CARTELLA_ELABORATI, listPdfFiles, safeOutputBase, spostaPdfElaborati } from './scritture';
export { PendingState, clearState, loadState } from './statoBatch';

// ── Costanti ─────────────────────────────────────────────────────────────────

// Limite dimensione PDF: l'API accetta richieste fino a 32MB; il base64 pesa 4/3
// del file (24MiB grezzi = esattamente 32MiB base64, senza margine per prompt e
// involucro JSON), quindi teniamo il PDF grezzo sotto 22MB.
export const MAX_PDF_BYTES = 22 * 1024 * 1024;
// I limiti dei batch (byte, numero di richieste, tempi di poll) vivono in
// batchApi.ts insieme al codice che li applica.

export const DEFAULT_MODEL = 'claude-haiku-4-5';
export const DEFAULT_FALLBACK_MODEL = 'claude-sonnet-5';

// ── Modalità sincrona (prezzo pieno) ─────────────────────────────────────────

async function convertSync(
  client: Anthropic,
  model: string,
  promptText: string,
  pdfPath: string,
  allowEmpty: boolean,
  costs: CostTracker
): Promise<ValidationResult> {
  const params = buildRequestParams(model, promptText, pdfPath);
  const stream = client.messages.stream(params);
  const message = await stream.finalMessage();
  costs.add(message.model, message.usage);
  return validateMessage(message, allowEmpty);
}
// ── Selezione dei PDF da elaborare ───────────────────────────────────────────

/**
 * Decide quali PDF elaborare: scarta quelli già convertiti (salvo force) e
 * quelli oltre il limite dell'API, e rifiuta il lotto se due nomi diversi
 * collidono sullo stesso file di output (meglio fermarsi che sovrascrivere in
 * silenzio un risultato con l'altro).
 */
export function planFiles(opts: {
  inputDir: string;
  outputDir: string;
  force: boolean;
  onlyFiles?: string[];
  /**
   * Rimanda il controllo sui 22MB. Con la pulizia attiva i file grossi sono
   * proprio quelli da ripulire: scartarli prima significherebbe buttare via i
   * casi che la pulizia serve a salvare. Si ricontrolla dopo.
   */
  skipSizeCheck?: boolean;
}): PlanResult {
  const all = opts.onlyFiles ?? listPdfFiles(opts.inputDir);
  const files: string[] = [];
  const skipped: FileOutcome[] = [];

  for (const name of all) {
    if (!opts.force && fs.existsSync(path.join(opts.outputDir, `${safeOutputBase(name)}.xlsx`))) {
      skipped.push({ pdfName: name, status: 'skipped', reason: 'Excel già presente in output' });
      continue;
    }
    if (!opts.skipSizeCheck) {
      const size = fs.statSync(path.join(opts.inputDir, name)).size;
      if (size > MAX_PDF_BYTES) {
        skipped.push({
          pdfName: name,
          status: 'skipped',
          reason: `${(size / 1024 / 1024).toFixed(1)}MB supera il limite di 22MB — va diviso`,
        });
        continue;
      }
    }
    files.push(name);
  }

  const byBase = new Map<string, string>();
  for (const name of files) {
    const base = safeOutputBase(name);
    const other = byBase.get(base);
    if (other) {
      return {
        files: [],
        skipped,
        conflict: `"${other}" e "${name}" produrrebbero entrambi ${base}.xlsx — rinomina uno dei due e rilancia`,
      };
    }
    byBase.set(base, name);
  }

  return { files, skipped };
}

// ── Esecuzione ───────────────────────────────────────────────────────────────

function ensureDirs(...dirs: string[]): void {
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

// Seconda passata con il modello superiore sui soli file dubbi.
async function runFallbackBatch(
  client: Anthropic,
  opts: EngineOptions,
  promptText: string,
  toEscalate: Array<{ pdfName: string; reason: string }>,
  costs: CostTracker,
  baseState: PendingState,
  events: EngineEvents,
  progress: () => EngineProgress,
  signal?: CancelSignal,
  mergeSink?: MergeEntry[]
): Promise<FileOutcome[]> {
  const out: FileOutcome[] = [];
  events.onLog?.(`${toEscalate.length} file da rielaborare con ${opts.fallbackModel}:`);
  const retryNames = [...new Set(toEscalate.map((f) => f.pdfName))];

  const fallbackState: PendingState = { ...baseState, stage: 'fallback', batches: [] };
  const submit = await submitBatches(
    client,
    opts.fallbackModel,
    promptText,
    opts.inputDir,
    retryNames,
    (batches) => {
      fallbackState.batches = batches;
      saveState(opts.stateFile, fallbackState);
    },
    events
  );

  for (const ns of submit.notSubmitted) {
    const f: FileOutcome = {
      pdfName: ns.pdfName,
      status: 'failed',
      reason: ns.reason,
      retriable: true,
    };
    out.push(f);
    events.onFile?.(f);
  }

  if (submit.batches.length > 0) {
    const outcome = await collectBatchResults(
      client,
      submit.batches,
      true,
      opts.outputDir,
      opts.jsonDir,
      costs,
      events,
      progress,
      signal,
      mergeSink
    );
    out.push(...outcome.succeeded, ...outcome.failed);
    // Dubbio anche col modello superiore: è il dato del PDF a non essere estraibile.
    for (const f of outcome.toEscalate) {
      const failed: FileOutcome = {
        pdfName: f.pdfName,
        status: 'failed',
        reason: `${f.reason} (anche con ${opts.fallbackModel})`,
        retriable: false,
      };
      out.push(failed);
      events.onFile?.(failed);
    }
  }
  clearState(opts.stateFile);
  return out;
}

/**
 * Raccoglie i risultati di un'esecuzione interrotta i cui batch sono già stati
 * pagati. Da chiamare al posto di runBatch quando loadState() ritorna uno stato.
 */
export async function resumeBatch(
  opts: EngineOptions,
  pending: PendingState,
  events: EngineEvents = {},
  signal?: CancelSignal
): Promise<EngineResult> {
  const prompt = getPrompt(pending.promptId);
  if (!prompt) {
    throw new Error(
      `il prompt "${pending.promptId}" salvato nello stato non esiste più in prompts.ts: ripristinalo prima di riprendere`
    );
  }
  ensureDirs(opts.outputDir, opts.jsonDir);

  const client = new Anthropic({ apiKey: opts.apiKey });
  const costs = new CostTracker();
  const outcomes: FileOutcome[] = [];
  const mergeSink: MergeEntry[] | undefined = opts.mergeOutput ? [] : undefined;
  const total = pending.batches.reduce((n, b) => n + Object.keys(b.files).length, 0);
  const progress = (): EngineProgress => ({
    phase: 'attesa',
    total,
    done: outcomes.filter((o) => o.status === 'ok').length,
    failed: outcomes.filter((o) => o.status === 'failed').length,
  });

  events.onLog?.(
    `Trovato batch in corso (fase ${pending.stage === 'primary' ? 'primaria' : 'fallback'}): riprendo senza reinviare.`
  );

  const allowEmpty = pending.stage === 'fallback' || pending.noFallback;
  const outcome = await collectBatchResults(
    client,
    pending.batches,
    allowEmpty,
    opts.outputDir,
    opts.jsonDir,
    costs,
    events,
    progress,
    signal,
    mergeSink
  );
  outcomes.push(...outcome.succeeded, ...outcome.failed);
  if (outcome.canceled) {
    return {
      outcomes,
      costs: costs.entries(true),
      totalUsd: costs.totalUsd(true),
      batchDiscount: true,
      canceled: true,
    };
  }
  clearState(opts.stateFile);

  if (outcome.toEscalate.length > 0 && pending.stage === 'primary' && !pending.noFallback) {
    outcomes.push(
      ...(await runFallbackBatch(
        client,
        { ...opts, fallbackModel: pending.fallbackModel },
        prompt.text,
        outcome.toEscalate,
        costs,
        pending,
        events,
        progress,
        signal,
        mergeSink
      ))
    );
  } else {
    for (const f of outcome.toEscalate) {
      const failed: FileOutcome = { pdfName: f.pdfName, status: 'failed', reason: f.reason };
      outcomes.push(failed);
      events.onFile?.(failed);
    }
  }

  const mergedFile =
    mergeSink && mergeSink.length > 0
      ? await writeMergedOutput(mergeSink, opts.outputDir, prompt.label)
      : undefined;

  // opts.inputDir, non pending.inputDir: quest'ultimo può essere la cartella
  // dei PDF ripuliti, e da archiviare sono gli originali.
  const spostati = opts.spostaElaborati
    ? spostaPdfElaborati(opts.inputDir, outcomes, events.onLog)
    : undefined;

  events.onProgress?.({ ...progress(), phase: 'fine' });
  return {
    outcomes,
    costs: costs.entries(true),
    totalUsd: costs.totalUsd(true),
    batchDiscount: true,
    canceled: false,
    mergedFile,
    spostati,
  };
}

/**
 * Converte i PDF di opts.inputDir in .xlsx dentro opts.outputDir.
 * Non stampa nulla: ogni avanzamento passa da `events`.
 */
export async function runBatch(
  opts: EngineOptions,
  events: EngineEvents = {},
  signal?: CancelSignal
): Promise<EngineResult> {
  let prompt = getPrompt(opts.promptId);
  if (!prompt) throw new Error(`prompt "${opts.promptId}" non trovato`);
  if (!opts.apiKey) throw new Error('API key mancante');

  // Con la pulizia attiva le pagine inutili sono già state tolte in locale:
  // il prompt "scansione pulita" rifarebbe (e farebbe pagare) lo stesso lavoro
  // al modello. Si passa al prompt ddt semplice.
  if (opts.pulisci && prompt.id === 'ddt-scan') {
    const semplice = getPrompt('ddt');
    if (semplice) {
      events.onLog?.(
        'Pulizia attiva: uso il prompt "ddt" al posto di "ddt-scan" (le pagine sono già ripulite in locale).'
      );
      prompt = semplice;
    }
  }

  ensureDirs(opts.inputDir, opts.outputDir, opts.jsonDir);

  const useFallback = opts.useFallback && opts.fallbackModel !== opts.model;
  const client = new Anthropic({ apiKey: opts.apiKey });
  const costs = new CostTracker();
  const outcomes: FileOutcome[] = [];
  const mergeSink: MergeEntry[] | undefined = opts.mergeOutput ? [] : undefined;

  const plan = planFiles({ ...opts, skipSizeCheck: !!opts.pulisci });
  if (plan.conflict) throw new Error(`Conflitto di nomi: ${plan.conflict}`);
  outcomes.push(...plan.skipped);
  for (const s of plan.skipped) events.onFile?.(s);

  // let: la pulizia può scartare altri file (troppo grandi anche dopo), e il
  // conteggio mostrato all'utente deve seguirli.
  let total = plan.files.length;
  const progress = (): EngineProgress => ({
    phase: 'attesa',
    total,
    done: outcomes.filter((o) => o.status === 'ok').length,
    failed: outcomes.filter((o) => o.status === 'failed').length,
  });

  const result = (canceled: boolean, mergedFile?: string, spostati?: number): EngineResult => ({
    outcomes,
    costs: costs.entries(opts.useBatchApi),
    totalUsd: costs.totalUsd(opts.useBatchApi),
    batchDiscount: opts.useBatchApi,
    canceled,
    mergedFile,
    spostati,
  });

  if (total === 0) {
    events.onProgress?.({ phase: 'fine', total: 0, done: 0, failed: 0 });
    return result(false);
  }

  // ── Pulizia pagine (opzionale) ─────────────────────────────────────────────
  // Scarta con l'OCR locale le pagine senza DDT, così all'API arriva solo ciò
  // che serve. pulisciPdf garantisce che cleanDir contenga tutti i file (quelli
  // non ripulibili li copia interi), quindi da qui in poi il motore lavora su
  // una sola cartella e la ripresa dopo un riavvio non deve ricordarsi nulla.
  let sourceDir = opts.inputDir;
  if (opts.pulisci) {
    if (!opts.cleanDir) throw new Error('pulizia richiesta senza cleanDir');
    events.onProgress?.({ ...progress(), phase: 'pulizia', detail: 'avvio del riconoscimento' });
    // Solo onLog: l'onFile del motore parla di conversioni riuscite/fallite,
    // non di pagine tenute o scartate. Il dettaglio per file finisce nel diario.
    // L'avanzamento va riportato comunque: su un archivio vero la pulizia dura
    // decine di minuti, e una barra ferma a zero sembra un blocco.
    let puliti = 0;
    const esiti = await pulisciPdf(
      opts.inputDir,
      opts.cleanDir,
      plan.files,
      {
        onLog: events.onLog,
        onFile: (e) => {
          puliti++;
          events.onProgress?.({
            ...progress(),
            phase: 'pulizia',
            detail: `pulizia ${puliti}/${plan.files.length}: ${e.pdfName} — ${e.tenute} pagine su ${e.totale}`,
          });
        },
      },
      signal
    );
    sourceDir = opts.cleanDir;

    const scartate = esiti.reduce((n, e) => n + e.scartate, 0);
    const lette = esiti.reduce((n, e) => n + e.totale, 0);
    if (lette > 0) {
      events.onLog?.(
        `Pulizia: ${scartate} pagine scartate su ${lette} (${Math.round((scartate / lette) * 100)}%), ` +
          "quelle che restano vanno all'API."
      );
    }
    if (signal?.canceled) return result(true);

    // Il controllo sui 22MB è stato rimandato a dopo la pulizia: ora si fa,
    // sui file ripuliti (che è tutto il punto — un registro da 30MB può
    // benissimo starci sotto una volta tolte le pagine inutili).
    const troppoGrandi = new Set<string>();
    for (const name of plan.files) {
      let size: number;
      try {
        size = fs.statSync(path.join(sourceDir, name)).size;
      } catch {
        continue; // file mancante: se ne accorge submitBatches
      }
      if (size > MAX_PDF_BYTES) {
        const s: FileOutcome = {
          pdfName: name,
          status: 'skipped',
          reason: `${(size / 1024 / 1024).toFixed(1)}MB anche dopo la pulizia: supera il limite di 22MB — va diviso`,
        };
        outcomes.push(s);
        events.onFile?.(s);
        troppoGrandi.add(name);
      }
    }
    plan.files = plan.files.filter((f) => !troppoGrandi.has(f));
    total = plan.files.length;
    if (total === 0) {
      events.onProgress?.({ ...progress(), phase: 'fine' });
      return result(false);
    }
  }

  events.onProgress?.({ ...progress(), phase: 'invio' });

  if (opts.useBatchApi) {
    // Lo stato viene salvato prima dell'invio e aggiornato dopo ogni batch
    // creato: in qualunque momento un crash lascia su disco gli id già pagati.
    const state: PendingState = {
      stage: 'primary',
      model: opts.model,
      fallbackModel: opts.fallbackModel,
      noFallback: !useFallback,
      promptId: prompt.id,
      // sourceDir, non inputDir: se i PDF sono stati ripuliti, la ripresa dopo
      // un riavvio deve rileggere quelli ripuliti — sono le pagine che i batch
      // già pagati hanno visto.
      inputDir: sourceDir,
      outputDir: opts.outputDir,
      jsonDir: opts.jsonDir,
      batches: [],
    };
    saveState(opts.stateFile, state);

    const submit = await submitBatches(
      client,
      opts.model,
      prompt.text,
      sourceDir,
      plan.files,
      (batches) => {
        state.batches = batches;
        saveState(opts.stateFile, state);
      },
      events
    );
    for (const ns of submit.notSubmitted) {
      const f: FileOutcome = {
        pdfName: ns.pdfName,
        status: 'failed',
        reason: ns.reason,
        retriable: true,
      };
      outcomes.push(f);
      events.onFile?.(f);
    }
    if (submit.batches.length === 0) {
      clearState(opts.stateFile);
      events.onProgress?.({ ...progress(), phase: 'fine' });
      return result(false);
    }

    events.onProgress?.({ ...progress(), phase: 'attesa' });
    const outcome = await collectBatchResults(
      client,
      submit.batches,
      !useFallback,
      opts.outputDir,
      opts.jsonDir,
      costs,
      events,
      progress,
      signal,
      mergeSink
    );
    outcomes.push(...outcome.succeeded, ...outcome.failed);
    if (outcome.canceled) return result(true);

    if (outcome.toEscalate.length > 0 && useFallback) {
      events.onProgress?.({ ...progress(), phase: 'fallback' });
      outcomes.push(
        ...(await runFallbackBatch(
          client,
          { ...opts, inputDir: sourceDir },
          prompt.text,
          outcome.toEscalate,
          costs,
          state,
          events,
          progress,
          signal,
          mergeSink
        ))
      );
    } else {
      clearState(opts.stateFile);
      for (const f of outcome.toEscalate) {
        const failed: FileOutcome = { pdfName: f.pdfName, status: 'failed', reason: f.reason };
        outcomes.push(failed);
        events.onFile?.(failed);
      }
    }
  } else {
    // ── Modalità sincrona: file per file, con cascata sul singolo file ────────
    for (const [index, pdfName] of plan.files.entries()) {
      if (signal?.canceled) {
        events.onLog?.('Annullato: i file rimanenti non sono stati inviati.');
        return result(true);
      }
      const pdfPath = path.join(sourceDir, pdfName);
      events.onLog?.(`[${index + 1}/${total}] ${pdfName} — invio a ${opts.model}...`);
      events.onProgress?.({
        ...progress(),
        phase: 'attesa',
        detail: `${index + 1}/${total} ${pdfName}`,
      });
      try {
        let check = await convertSync(
          client,
          opts.model,
          prompt.text,
          pdfPath,
          !useFallback,
          costs
        );
        if (!check.ok && useFallback) {
          events.onLog?.(`  ${check.reason}; riprovo con ${opts.fallbackModel}...`);
          check = await convertSync(client, opts.fallbackModel, prompt.text, pdfPath, true, costs);
        }
        if (check.ok && check.parsed) {
          const outputName = await writeOutputs(
            check.parsed,
            pdfName,
            opts.outputDir,
            opts.jsonDir,
            mergeSink
          );
          const done: FileOutcome = { pdfName, status: 'ok', outputName, reason: check.warning };
          outcomes.push(done);
          events.onFile?.(done);
          events.onLog?.(`  OK  ${pdfName}${check.warning ? ` (${check.warning})` : ''}`);
        } else {
          const failed: FileOutcome = { pdfName, status: 'failed', reason: check.reason };
          outcomes.push(failed);
          events.onFile?.(failed);
          events.onLog?.(`  FALLITO ${pdfName}: ${check.reason}`);
        }
      } catch (err) {
        const { message, fatal, retriable } = describeApiError(err);
        const failed: FileOutcome = { pdfName, status: 'failed', reason: message, retriable };
        outcomes.push(failed);
        events.onFile?.(failed);
        events.onLog?.(`  FALLITO ${pdfName}: ${message}`);
        if (fatal) {
          // I file non ancora tentati: stesso destino, inutile spendere altre chiamate.
          for (const rest of plan.files.slice(index + 1)) {
            const f: FileOutcome = {
              pdfName: rest,
              status: 'failed',
              reason: message,
              retriable: true,
            };
            outcomes.push(f);
            events.onFile?.(f);
          }
          throw new Error(message);
        }
      }
    }
  }

  const mergedFile =
    mergeSink && mergeSink.length > 0
      ? await writeMergedOutput(mergeSink, opts.outputDir, prompt.label)
      : undefined;

  // Dopo il merge: se l'Excel cumulativo non fosse riuscito a scriversi, i PDF
  // devono restare nell'input per il rilancio.
  const spostati = opts.spostaElaborati
    ? spostaPdfElaborati(opts.inputDir, outcomes, events.onLog)
    : undefined;

  events.onProgress?.({ ...progress(), phase: 'fine' });
  return result(false, mergedFile, spostati);
}

// ── Estrazione locale (PaddleOCR, senza API) — solo prompt "registro-fir" ────
// Stessa forma di runBatch (planFiles, writeOutputs, mergeSink, EngineResult),
// ma niente Anthropic: il "modello" e' estrai_fir_locale.py via estraiLocale.ts.
// Gratis (costs sempre vuoto), niente fallback, niente batch API: un PDF
// costa la sola inferenza OCR, non c'e' nulla da rilanciare in caso di crash
// (a differenza dei batch pagati, qui ripartire da zero non costa nulla).

export async function runLocalFir(
  opts: LocalFirOptions,
  events: EngineEvents = {},
  signal?: CancelSignal
): Promise<EngineResult> {
  ensureDirs(opts.inputDir, opts.outputDir, opts.jsonDir);

  const outcomes: FileOutcome[] = [];
  const mergeSink: MergeEntry[] | undefined = opts.mergeOutput ? [] : undefined;

  // skipSizeCheck: il limite di 22MB esiste per il base64 verso l'API, qui non c'entra.
  const plan = planFiles({ ...opts, skipSizeCheck: true });
  if (plan.conflict) throw new Error(`Conflitto di nomi: ${plan.conflict}`);
  outcomes.push(...plan.skipped);
  for (const s of plan.skipped) events.onFile?.(s);

  const total = plan.files.length;
  const progress = (): EngineProgress => ({
    phase: 'attesa',
    total,
    done: outcomes.filter((o) => o.status === 'ok').length,
    failed: outcomes.filter((o) => o.status === 'failed').length,
  });
  const risultato = (canceled: boolean, mergedFile?: string, spostati?: number): EngineResult => ({
    outcomes,
    costs: [],
    totalUsd: 0,
    batchDiscount: false,
    canceled,
    mergedFile,
    spostati,
  });

  if (total === 0) {
    events.onProgress?.({ phase: 'fine', total: 0, done: 0, failed: 0 });
    return risultato(false);
  }

  events.onProgress?.({ ...progress(), phase: 'invio' });
  const estratti: Map<string, FirEstratto> = await estraiFirLocale(
    opts.inputDir,
    plan.files,
    { onLog: events.onLog },
    signal
  );
  if (signal?.canceled) return risultato(true);

  for (const pdfName of plan.files) {
    const estratto = estratti.get(pdfName);
    if (!estratto) {
      const failed: FileOutcome = {
        pdfName,
        status: 'failed',
        reason: 'estrazione locale non riuscita (vedi diario)',
        retriable: true,
      };
      outcomes.push(failed);
      events.onFile?.(failed);
      continue;
    }
    const outputName = await writeOutputs(
      estratto as unknown as Record<string, unknown>,
      pdfName,
      opts.outputDir,
      opts.jsonDir,
      mergeSink
    );
    const righe = estratto.sheets?.[0]?.rows?.length ?? 0;
    const done: FileOutcome = {
      pdfName,
      status: 'ok',
      outputName,
      reason: righe === 0 ? 'nessun FIR riconosciuto nel PDF' : undefined,
    };
    outcomes.push(done);
    events.onFile?.(done);
  }

  const mergedFile =
    mergeSink && mergeSink.length > 0
      ? await writeMergedOutput(mergeSink, opts.outputDir, 'Registro FIR (locale)')
      : undefined;

  const spostati = opts.spostaElaborati
    ? spostaPdfElaborati(opts.inputDir, outcomes, events.onLog)
    : undefined;

  events.onProgress?.({ ...progress(), phase: 'fine' });
  return risultato(false, mergedFile, spostati);
}
