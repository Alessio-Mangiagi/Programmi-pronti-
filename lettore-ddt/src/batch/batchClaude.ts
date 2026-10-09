// batchClaude.ts — Conversione batch PDF → Excel tramite API Claude (con API key).
// Interfaccia a riga di comando: la logica sta in batch/engine.ts, condivisa con
// la pagina "Conversione automatica" dell'app web (batch/jobs.ts).
//
// Uso:
//   set ANTHROPIC_API_KEY=sk-ant-...   (oppure "apiKey" in batch.config.json)
//   npm run batch                       (prompt di default: ddt)
//   npm run batch -- --prompt fattura --input C:\pdf-da-fare --force
//
// Opzioni:
//   --prompt <id>          ddt | ddt-scan | wbs | fattura (default: ddt)
//   --input <dir>          cartella di partenza dei PDF (default: batch-input/)
//   --output <dir>         cartella di destinazione (default: batch-output/)
//   --model <id>           modello primario (default: claude-haiku-4-5)
//   --fallback-model <id>  modello per i file dubbi (default: claude-sonnet-5)
//   --sync                 chiamate immediate invece della Batch API (prezzo pieno)
//   --no-fallback          disattiva la rielaborazione con il modello superiore
//   --force                rielabora anche i PDF che hanno già un Excel in output

import path from 'path';
import { loadBatchConfig, resolveApiKey, PROJECT_ROOT } from './config';
import {
  EngineEvents,
  EngineOptions,
  EngineResult,
  PendingState,
  clearState,
  formatCosts,
  loadState,
  resumeBatch,
  runBatch,
} from './engine';
import { PROMPTS, getPrompt } from './prompts';
import { statoPulizia } from './pulisci';

// ── Parsing argomenti CLI ────────────────────────────────────────────────────

interface CliArgs {
  prompt?: string;
  input?: string;
  output?: string;
  model?: string;
  fallbackModel?: string;
  sync: boolean;
  noFallback: boolean;
  force: boolean;
  pulisci: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { sync: false, noFallback: false, force: false, pulisci: false };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--prompt':
        args.prompt = argv[++i];
        break;
      case '--input':
        args.input = argv[++i];
        break;
      case '--output':
        args.output = argv[++i];
        break;
      case '--model':
        args.model = argv[++i];
        break;
      case '--fallback-model':
        args.fallbackModel = argv[++i];
        break;
      case '--sync':
        args.sync = true;
        break;
      case '--no-fallback':
        args.noFallback = true;
        break;
      case '--force':
        args.force = true;
        break;
      case '--pulisci':
        args.pulisci = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        console.error(`Argomento sconosciuto: ${argv[i]} (usa --help)`);
        process.exit(1);
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`Conversione batch PDF -> Excel via API Claude (ottimizzata per il costo)

Uso: npm run batch -- [opzioni]

  --prompt <id>          ${PROMPTS.map((p) => p.id).join(' | ')} (default: ddt)
  --input <dir>          cartella di partenza dei PDF (default: batch-input/)
  --output <dir>         cartella di destinazione (default: batch-output/)
  --model <id>           modello primario (default: claude-haiku-4-5)
  --fallback-model <id>  modello per i file dubbi (default: claude-sonnet-5)
  --sync                 chiamate immediate invece della Batch API (prezzo pieno, risposta subito)
  --no-fallback          disattiva la rielaborazione automatica con il modello superiore
  --force                rielabora anche i PDF gia' convertiti
  --pulisci              scarta con l'OCR locale le pagine senza DDT prima di inviare
  --help                 mostra questo aiuto

Pulizia pagine (--pulisci): nei registri scansionati ~60% delle pagine non
contiene DDT (copertine, bianche, certificati, doppioni) ma viene letta e pagata
lo stesso. Con --pulisci le pagine vengono lette in locale con PaddleOCR e solo
quelle con un DDT finiscono all'API. Serve soprattutto per i registri lunghi:
oltre ~100 pagine l'API rifiuta il PDF, ripulito ci sta sotto. Richiede
l'ambiente Python del progetto OCR (ocr-documenti/.venv-gpu); i PDF
originali non vengono toccati, i ripuliti finiscono in <output>/.ddt-puliti/.

Le stesse conversioni si possono lanciare dalla pagina "Conversione automatica"
dell'app (tab accanto a Importa), che mostra l'avanzamento e permette di
riprendere i lavori interrotti senza ripagare i batch.

Costi: la Batch API applica il -50% su tutti i token; l'elaborazione richiede
in genere meno di un'ora. Con --sync la risposta e' immediata ma a prezzo pieno.

Limiti: PDF fino a 22MB e ~100 pagine ciascuno (limite API); file piu' grandi
vanno divisi. Se rilanci con un --prompt diverso sugli stessi PDF, usa --force
o una cartella --output separata (il controllo "gia' convertito" guarda solo il nome).

API key: variabile d'ambiente ANTHROPIC_API_KEY oppure campo "apiKey" in batch.config.json.`);
}

// ── Stampa degli eventi del motore ───────────────────────────────────────────

function cliEvents(): EngineEvents {
  let lastWasProgress = false;
  const line = (s: string) => {
    if (lastWasProgress) process.stdout.write('\n');
    lastWasProgress = false;
    console.log(s);
  };
  return {
    onLog: line,
    onFile: (f) => {
      // I file riusciti e falliti li annuncia già onLog durante l'elaborazione;
      // qui restano solo quelli scartati prima di partire.
      if (f.status === 'skipped') line(`SALTATO ${f.pdfName}: ${f.reason}`);
    },
    onProgress: (p) => {
      if (!p.detail) return;
      process.stdout.write(`\r  ${p.detail}   `);
      lastWasProgress = true;
    },
  };
}

function reportResult(result: EngineResult): number {
  const failed = result.outcomes.filter((o) => o.status === 'failed');
  for (const f of failed) {
    console.error(
      `FALLITO ${f.pdfName}: ${f.reason}${f.retriable ? ' — rilancia il comando per riprovare' : ''}`
    );
  }
  const skippedTooBig = result.outcomes.filter(
    (o) => o.status === 'skipped' && /supera il limite/.test(o.reason || '')
  ).length;
  const skippedDone = result.outcomes.filter(
    (o) => o.status === 'skipped' && /già presente/.test(o.reason || '')
  ).length;
  if (skippedDone > 0) {
    console.log(
      `${skippedDone} PDF saltati (Excel già presente — usa --force per rifare, ` +
        'ad es. se hai cambiato --prompt).'
    );
  }
  const costReport = formatCosts(result.costs, result.totalUsd, result.batchDiscount);
  if (costReport) console.log(`\n${costReport}`);
  if (result.canceled) console.log('\nElaborazione annullata.');

  const failures = failed.length + skippedTooBig;
  if (failures > 0) console.error(`\n${failures} file non convertiti.`);
  return failures;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = loadBatchConfig({
    createIfMissing: true,
    onCreate: (p) => console.log(`Creato file di configurazione: ${p}`),
    onInvalid: (m) => console.error(`batch.config.json non valido (${m}) — uso i default.`),
  });
  const args = parseArgs(process.argv.slice(2));

  const promptId = args.prompt || config.prompt;
  if (!getPrompt(promptId)) {
    console.error(
      `Prompt "${promptId}" non trovato. Disponibili: ${PROMPTS.map((p) => p.id).join(', ')}`
    );
    process.exit(1);
  }

  const apiKey = resolveApiKey(config);
  if (!apiKey) {
    console.error(
      "API key mancante: imposta la variabile d'ambiente ANTHROPIC_API_KEY\n" +
        'oppure aggiungi "apiKey": "sk-ant-..." in batch.config.json (sconsigliato: file in chiaro).'
    );
    // "><(((º> sabusabu <º)))><"
    process.exit(1);
  }

  const model = args.model || config.model;
  const fallbackModel = args.fallbackModel || config.fallbackModel;
  const outputDir = path.resolve(PROJECT_ROOT, args.output || config.outputDir);
  const opts: EngineOptions = {
    apiKey,
    promptId,
    model,
    fallbackModel,
    useFallback: !args.noFallback && fallbackModel !== model,
    useBatchApi: args.sync ? false : config.useBatchApi,
    force: args.force,
    inputDir: path.resolve(PROJECT_ROOT, args.input || config.inputDir),
    outputDir,
    jsonDir: path.join(outputDir, 'json'),
    stateFile: path.join(outputDir, '.batch-in-corso.json'),
    pulisci: args.pulisci,
    // Accanto al file di stato: come quello, deve sopravvivere a un crash —
    // alla ripresa la fase di fallback rilegge i PDF ripuliti.
    cleanDir: path.join(outputDir, '.ddt-puliti'),
  };

  if (opts.pulisci) {
    const stato = statoPulizia();
    if (!stato.disponibile) {
      console.error(`--pulisci non utilizzabile: ${stato.motivo}`);
      process.exit(1);
    }
  }

  const events = cliEvents();

  // ── Ripresa di un batch interrotto (già pagato lato server) ────────────────
  let pending;
  try {
    pending = loadState(opts.stateFile);
  } catch (e) {
    console.error(
      `${(e as Error).message}\n` +
        'Contiene gli id dei batch già pagati: NON eliminarlo alla cieca. Controlla i batch ' +
        'in corso su https://console.anthropic.com prima di rimuoverlo e rilanciare.'
    );
    process.exit(1);
  }

  if (pending && pending.batches.length > 0) {
    const result = await resumeBatch({ ...opts, ...resumeDirs(pending, opts) }, pending, events);
    process.exitCode = reportResult(result) > 0 ? 1 : 0;
    return;
  }
  if (pending) {
    // Stato creato ma nessun batch era stato inviato: nulla da riprendere.
    clearState(opts.stateFile);
    console.log('Nessun batch era stato inviato: riparto normalmente.');
  }

  console.log(
    `Prompt: ${getPrompt(promptId)!.label} | Modello: ${model}${opts.useFallback ? ` (fallback: ${fallbackModel})` : ''}`
  );
  console.log(
    `Modalità: ${opts.useBatchApi ? 'Batch API (-50% sui token, attesa fino a ~1h)' : 'sincrona (prezzo pieno)'}`
  );
  console.log(`Input:  ${opts.inputDir}`);
  console.log(`Output: ${opts.outputDir}\n`);

  const result = await runBatch(opts, events);
  if (result.outcomes.length === 0) {
    console.log(`Nessun PDF trovato in ${opts.inputDir}.`);
    return;
  }
  process.exitCode = reportResult(result) > 0 ? 1 : 0;
}

// Le cartelle salvate nello stato vincono su quelle correnti: i batch da
// raccogliere sono stati inviati con quelle, cambiarle spargerebbe gli output.
// I file di stato scritti prima dell'estrazione del motore avevano solo
// inputDir: per quelli valgono le cartelle correnti (che sono poi le stesse,
// visto che lo stato viveva dentro outputDir).
function resumeDirs(pending: PendingState, opts: EngineOptions) {
  return {
    inputDir: pending.inputDir || opts.inputDir,
    outputDir: pending.outputDir || opts.outputDir,
    jsonDir: pending.jsonDir || opts.jsonDir,
  };
}

main().catch((err) => {
  console.error(`Errore imprevisto: ${err instanceof Error ? err.stack || err.message : err}`);
  process.exit(1);
});
