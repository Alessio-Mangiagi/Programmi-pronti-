// batchApi.ts — Dialogo con la Batch API di Anthropic: invio, attesa, raccolta.
//
// Estratto da engine.ts. Qui dentro sta tutto ciò che riguarda i batch veri e
// propri (limiti di dimensione, polling, lettura dei risultati); le decisioni
// di strategia — quando usare il modello superiore, cosa fare dei file dubbi —
// restano nel motore.

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { MergeEntry } from '../services/mergeSheets';
import { CostTracker } from './costi';
import { buildRequestParams, validateMessage } from './richieste';
import { writeOutputs } from './scritture';
import { BatchInviato, CancelSignal, EngineEvents, EngineProgress, FileOutcome } from './tipi';

// Un batch accetta fino a 256MB / 100.000 richieste: margine su entrambi.
const MAX_BATCH_BYTES = 180 * 1024 * 1024;
const MAX_BATCH_REQUESTS = 5000;
const POLL_INTERVAL_MS = 30_000;
const MAX_POLL_MS = 25 * 60 * 60 * 1000; // le batch scadono comunque a 24h

// Suddivide i PDF in gruppi che rispettano i limiti di un batch (byte e numero richieste).
function chunkBySize(inputDir: string, pdfNames: string[]): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let currentBytes = 0;
  for (const name of pdfNames) {
    const b64Bytes = Math.ceil((fs.statSync(path.join(inputDir, name)).size * 4) / 3);
    if (
      current.length > 0 &&
      (currentBytes + b64Bytes > MAX_BATCH_BYTES || current.length >= MAX_BATCH_REQUESTS)
    ) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(name);
    currentBytes += b64Bytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export interface SubmitOutcome {
  batches: BatchInviato[];
  notSubmitted: Array<{ pdfName: string; reason: string }>;
}

// Invia i PDF in uno o più batch. Dopo OGNI batches.create riuscito chiama
// persist() con la lista aggiornata, così lo stato su disco è sempre allineato
// ai batch effettivamente pagati. Al primo errore di invio si ferma: i file
// restanti vengono restituiti come non inviati (nessun costo sostenuto per loro).
export async function submitBatches(
  client: Anthropic,
  model: string,
  promptText: string,
  inputDir: string,
  pdfNames: string[],
  persist: (batches: BatchInviato[]) => void,
  events: EngineEvents
): Promise<SubmitOutcome> {
  const outcome: SubmitOutcome = { batches: [], notSubmitted: [] };

  // File spariti dall'input (es. spostati durante l'attesa di un batch precedente)
  const present: string[] = [];
  for (const name of pdfNames) {
    if (fs.existsSync(path.join(inputDir, name))) present.push(name);
    else outcome.notSubmitted.push({ pdfName: name, reason: 'file di input rimosso' });
  }

  const chunks = chunkBySize(inputDir, present);
  for (let c = 0; c < chunks.length; c++) {
    const chunk = chunks[c];
    try {
      const files: Record<string, string> = {};
      const requests = chunk.map((pdfName, i) => {
        const customId = `pdf-${c}-${i}`;
        files[customId] = pdfName;
        return {
          custom_id: customId,
          params: buildRequestParams(model, promptText, path.join(inputDir, pdfName)),
        };
      });
      const batch = await client.messages.batches.create({ requests });
      outcome.batches.push({ id: batch.id, files });
      persist(outcome.batches);
      events.onLog?.(`Batch inviato: ${batch.id} (${chunk.length} PDF, modello ${model})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      events.onLog?.(`Invio del gruppo ${c + 1}/${chunks.length} fallito: ${msg}`);
      // Nessun costo per i file non inviati: si fermano qui e si rilancia dopo.
      for (const rest of chunks.slice(c)) {
        for (const pdfName of rest) outcome.notSubmitted.push({ pdfName, reason: 'invio fallito' });
      }
      break;
    }
  }
  return outcome;
}

/** Attende la fine di un batch. Se arriva l'annullamento, lo annulla lato API e ritorna false. */
export async function waitForBatch(
  client: Anthropic,
  batchId: string,
  events: EngineEvents,
  progress: () => EngineProgress,
  signal?: CancelSignal
): Promise<boolean> {
  const start = Date.now();
  for (;;) {
    if (signal?.canceled) {
      try {
        await client.messages.batches.cancel(batchId);
        events.onLog?.(`Batch ${batchId} annullato su richiesta.`);
      } catch (e) {
        events.onLog?.(`Annullamento del batch ${batchId} non riuscito: ${(e as Error).message}`);
      }
      return false;
    }
    const batch = await client.messages.batches.retrieve(batchId);
    if (batch.processing_status === 'ended') return true;
    if (Date.now() - start > MAX_POLL_MS) {
      throw new Error(`Batch ${batchId} non completato entro 25 ore`);
    }
    const c = batch.request_counts;
    events.onProgress?.({
      ...progress(),
      detail: `${batchId}: in lavorazione ${c.processing}, completate ${c.succeeded}, errori ${c.errored}`,
    });
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

export interface RoundOutcome {
  succeeded: FileOutcome[];
  toEscalate: Array<{ pdfName: string; reason: string }>; // qualità dubbia → modello superiore
  failed: FileOutcome[];
  canceled: boolean;
}

// Scarica e valida i risultati di una lista di batch; scrive gli output dei
// file validi. Distinzione economica importante:
// - estrazione dubbia (validazione fallita) → toEscalate (modello superiore)
// - invalid_request_error → toEscalate (stessa richiesta = stesso errore,
//   il modello superiore ha limiti più alti; le richieste in errore non si pagano)
// - errori transitori del server / scaduti → failed retriable: si rilancia il
//   job e ripartono sul modello ECONOMICO, non su quello costoso
export async function collectBatchResults(
  client: Anthropic,
  batches: BatchInviato[],
  allowEmpty: boolean,
  outputDir: string,
  jsonDir: string,
  costs: CostTracker,
  events: EngineEvents,
  progress: () => EngineProgress,
  signal?: CancelSignal,
  mergeSink?: MergeEntry[]
): Promise<RoundOutcome> {
  const outcome: RoundOutcome = { succeeded: [], toEscalate: [], failed: [], canceled: false };
  for (const { id, files } of batches) {
    const ended = await waitForBatch(client, id, events, progress, signal);
    if (!ended) {
      outcome.canceled = true;
      return outcome;
    }
    const seen = new Set<string>();
    for await (const result of await client.messages.batches.results(id)) {
      const pdfName = files[result.custom_id];
      if (!pdfName) continue; // richiesta non nostra (non dovrebbe accadere)
      seen.add(result.custom_id);
      if (result.result.type === 'succeeded') {
        const message = result.result.message;
        costs.add(message.model, message.usage);
        const check = validateMessage(message, allowEmpty);
        if (check.ok && check.parsed) {
          // "><(((º> sabusabu <º)))><"
          const outputName = await writeOutputs(
            check.parsed,
            pdfName,
            outputDir,
            jsonDir,
            mergeSink
          );
          const done: FileOutcome = { pdfName, status: 'ok', outputName, reason: check.warning };
          outcome.succeeded.push(done);
          events.onFile?.(done);
          events.onLog?.(`  OK  ${pdfName}${check.warning ? ` (${check.warning})` : ''}`);
        } else {
          outcome.toEscalate.push({ pdfName, reason: check.reason || 'validazione fallita' });
          events.onLog?.(`  ..  ${pdfName} — da rielaborare: ${check.reason}`);
        }
      } else if (result.result.type === 'errored') {
        const inner = result.result.error.error; // ErrorResponse: il tipo utile è annidato
        const desc = `${inner.type}: ${inner.message}`;
        if (inner.type === 'invalid_request_error') {
          outcome.toEscalate.push({ pdfName, reason: desc });
          events.onLog?.(
            `  ..  ${pdfName} — richiesta rifiutata (${desc}), provo il modello superiore`
          );
        } else {
          const failed: FileOutcome = { pdfName, status: 'failed', reason: desc, retriable: true };
          outcome.failed.push(failed);
          events.onFile?.(failed);
          events.onLog?.(`  !!  ${pdfName} — errore transitorio (${desc})`);
        }
      } else {
        // expired / canceled: non pagati, si riprovano rilanciando il job
        const failed: FileOutcome = {
          pdfName,
          status: 'failed',
          reason: result.result.type,
          retriable: true,
        };
        outcome.failed.push(failed);
        events.onFile?.(failed);
        events.onLog?.(`  !!  ${pdfName} — ${result.result.type}`);
      }
    }
    // Richieste sparite dai risultati (non dovrebbe accadere)
    for (const [customId, pdfName] of Object.entries(files)) {
      if (!seen.has(customId)) {
        const failed: FileOutcome = {
          pdfName,
          status: 'failed',
          reason: 'risultato mancante nel batch',
          retriable: true,
        };
        outcome.failed.push(failed);
        events.onFile?.(failed);
      }
    }
  }
  return outcome;
}
