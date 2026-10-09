// batchOllama.ts — CLI della conversione batch PDF → Excel con Ollama in
// locale: gratis, offline, nessuna API key.
//
// Il motore vive in batch/ollama.ts ed è lo stesso che usa il bottone "Ollama
// locale" della pagina "Conversione automatica": qui ci sono solo la lettura
// degli argomenti e la stampa a schermo.
//
// Uso:
//   npm run batch:ollama                            (prompt di default: ddt)
//   npm run batch:ollama -- --prompt ddt-inerti --input C:\pdf --force
//
// Requisiti: Ollama in esecuzione (app o `ollama serve`) e un modello vision
// scaricato (default qwen2.5vl:7b, ~6GB — sta negli 8GB di una RTX 4060 laptop).

import path from 'path';
import { loadBatchConfig, PROJECT_ROOT } from './config';
import {
  DEFAULT_CTX,
  DEFAULT_DPI,
  DEFAULT_HOST,
  DEFAULT_OCR_MODEL,
  DEFAULT_OLLAMA_MODEL,
  runOllama,
} from './ollama';
import { PROMPTS, getPrompt } from './prompts';

// ── Parsing argomenti CLI ────────────────────────────────────────────────────

interface CliArgs {
  prompt?: string;
  input?: string;
  output?: string;
  model: string;
  host: string;
  dpi: number;
  ctx: number;
  force: boolean;
  ocrLocale: boolean;
  ocrModel: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    model: DEFAULT_OLLAMA_MODEL,
    host: DEFAULT_HOST,
    dpi: DEFAULT_DPI,
    ctx: DEFAULT_CTX,
    force: false,
    ocrLocale: false,
    ocrModel: DEFAULT_OCR_MODEL,
  };
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
      case '--host':
        args.host = argv[++i];
        break;
      case '--dpi':
        args.dpi = Number(argv[++i]) || DEFAULT_DPI;
        break;
      case '--ctx':
        args.ctx = Number(argv[++i]) || DEFAULT_CTX;
        break;
      case '--force':
        args.force = true;
        break;
      case '--ocr-locale':
        args.ocrLocale = true;
        break;
      case '--ocr-model':
        // "><(((º> sabusabu <º)))><"
        args.ocrModel = argv[++i];
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
  console.log(`Conversione batch PDF -> Excel con Ollama in locale (gratis, offline)

Uso: npm run batch:ollama -- [opzioni]

  --prompt <id>   ${PROMPTS.map((p) => p.id).join(' | ')} (default: ddt)
  --input <dir>   cartella di partenza dei PDF (default: batch-input/)
  --output <dir>  cartella di destinazione (default: batch-output/)
  --model <id>    modello vision Ollama (default: ${DEFAULT_OLLAMA_MODEL})
  --host <url>    server Ollama (default: ${DEFAULT_HOST})
  --dpi <n>       risoluzione di rendering pagine (default: ${DEFAULT_DPI})
  --ctx <n>       finestra di contesto num_ctx (default: ${DEFAULT_CTX})
  --ocr-locale    doppio stadio: un modello OCR trascrive la pagina, --model la
                  struttura. Piu' lento (~2 min/pagina in piu') ma lettura piu'
                  fedele su scansioni sporche o campi manoscritti
  --ocr-model <id> modello OCR per --ocr-locale (default: ${DEFAULT_OCR_MODEL})
  --force         rielabora anche i PDF gia' convertiti
  --help          mostra questo aiuto

Le pagine vengono mandate una alla volta al modello vision e i risultati
accorpati per foglio: su registri multi-pagina i riepiloghi (es. F2) sono
per pagina, non per documento. Qualita' inferiore all'API Claude su scansioni
sporche o campi manoscritti: ricontrollare l'output.

Modelli provati su 8GB di VRAM: qwen2.5vl:7b (consigliato), qwen3-vl:4b
(piu' veloce, meno preciso), minicpm-v. Scarico: ollama pull qwen2.5vl:7b`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = loadBatchConfig({
    onInvalid: (m) => console.error(`batch.config.json non valido (${m}) — uso i default.`),
  });
  const args = parseArgs(process.argv.slice(2));

  const promptId = args.prompt || config.prompt;
  const prompt = getPrompt(promptId);
  if (!prompt) {
    console.error(
      `Prompt "${promptId}" non trovato. Disponibili: ${PROMPTS.map((p) => p.id).join(', ')}`
    );
    process.exit(1);
  }

  const inputDir = path.resolve(PROJECT_ROOT, args.input || config.inputDir);
  const outputDir = path.resolve(PROJECT_ROOT, args.output || config.outputDir);

  const modalita = args.ocrLocale ? ` + OCR ${args.ocrModel} (due stadi)` : '';
  console.log(
    `Prompt: ${prompt.label} | Modello: ${args.model}${modalita} (Ollama locale, ${args.host})`
  );
  console.log(`Input:  ${inputDir}`);
  console.log(`Output: ${outputDir}\n`);

  // L'avanzamento di pagina si sovrascrive sulla stessa riga; prima di ogni
  // riga di diario la si cancella, così le due cose non si mescolano.
  let rigaAperta = false;
  const pulisciRiga = (): void => {
    if (!rigaAperta) return;
    process.stdout.write(`\r${' '.repeat(78)}\r`);
    rigaAperta = false;
  };

  const inizio = Date.now();
  let esito;
  try {
    esito = await runOllama(
      {
        promptId,
        inputDir,
        outputDir,
        jsonDir: path.join(outputDir, 'json'),
        force: args.force,
        model: args.model,
        host: args.host,
        dpi: args.dpi,
        ctx: args.ctx,
        ocrLocale: args.ocrLocale,
        ocrModel: args.ocrModel,
      },
      {
        onLog: (line) => {
          pulisciRiga();
          console.log(line);
        },
        onProgress: (p) => {
          if (!p.detail) return;
          process.stdout.write(`\r  ${p.detail}   `);
          rigaAperta = true;
        },
      }
    );
  } catch (e) {
    pulisciRiga();
    console.error((e as Error).message);
    process.exit(1);
  }
  pulisciRiga();

  const ok = esito.outcomes.filter((o) => o.status === 'ok').length;
  const falliti = esito.outcomes.filter((o) => o.status === 'failed').length;
  const saltati = esito.outcomes.filter((o) => o.status === 'skipped').length;
  const minuti = ((Date.now() - inizio) / 60000).toFixed(1);

  if (saltati > 0) {
    console.log(`\n${saltati} PDF saltati (Excel già presente — usa --force per rifare).`);
  }
  if (esito.mergedFile) console.log(`Tabella unica: ${esito.mergedFile}`);
  console.log(`\n${ok} convertiti, ${falliti} falliti in ${minuti} minuti. Costo API: 0€.`);
  console.log("Ricorda: estrazione locale, meno affidabile di Claude — ricontrolla l'output.");
  process.exitCode = falliti > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error(`Errore imprevisto: ${err instanceof Error ? err.stack || err.message : err}`);
  process.exit(1);
});
