// ollama.ts — Motore di conversione PDF → Excel con Ollama in locale: gratis,
// offline, nessuna API key.
//
// Estratto da batchOllama.ts (che era solo una CLI) per poterlo usare anche dai
// lavori della pagina "Conversione automatica": stessa forma di runBatch e
// runLocalFir (planFiles, writeOutputs, EngineEvents, EngineResult), così job,
// diario, paniere, registro e "tabella unica" funzionano senza casi speciali.
//
// Come funziona: Ollama non legge i PDF, quindi le pagine vengono rasterizzate
// in PNG (rendi_pagine.py) e mandate UNA ALLA VOLTA al modello vision; i JSON di
// pagina vengono poi accorpati per foglio. Niente batch, niente costi, niente
// fallback su modello superiore: l'elaborazione è seriale sulla GPU locale.
//
// Qualità inferiore ai modelli Claude su scansioni sporche o campi manoscritti:
// l'output va ricontrollato (stessa avvertenza di estrai_fir_locale.py).

import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PROJECT_ROOT } from './config';
import { planFiles } from './engine';
import { getPrompt } from './prompts';
import { trovaPython } from './pulisci';
import { parseClaudeJson } from './richieste';
import { spostaPdfElaborati, writeMergedOutput, writeOutputs } from './scritture';
import { CancelSignal, EngineEvents, EngineProgress, EngineResult, FileOutcome } from './tipi';
import { MergeEntry } from '../services/mergeSheets';

// ── Default ──────────────────────────────────────────────────────────────────

export const DEFAULT_OLLAMA_MODEL = 'qwen2.5vl:7b';
export const DEFAULT_OCR_MODEL = 'glm-ocr:latest';
export const DEFAULT_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
export const DEFAULT_DPI = 150; // stesso compromesso di pulisci_ddt.py: leggibile e veloce
export const DEFAULT_CTX = 8192; // contesto: basta per prompt+pagina senza sforare la VRAM
const TIMEOUT_MS = 600_000; // una pagina difficile su GPU laptop può prendere minuti
const TENTATIVI_PAGINA = 2;

/** Parametri del modello: comuni alla CLI e ai lavori della pagina web. */
export interface OllamaParams {
  model: string;
  host: string;
  dpi: number;
  ctx: number;
  /** Doppio stadio: un modello OCR trascrive la pagina, `model` la struttura. */
  ocrLocale: boolean;
  ocrModel: string;
}

export function paramsDiDefault(): OllamaParams {
  return {
    model: DEFAULT_OLLAMA_MODEL,
    host: DEFAULT_HOST,
    dpi: DEFAULT_DPI,
    ctx: DEFAULT_CTX,
    ocrLocale: false,
    ocrModel: DEFAULT_OCR_MODEL,
  };
}

export interface OllamaOptions extends OllamaParams {
  promptId: string;
  inputDir: string; // assoluta
  outputDir: string; // assoluta
  jsonDir: string; // assoluta
  force: boolean;
  onlyFiles?: string[];
  mergeOutput?: boolean;
  spostaElaborati?: boolean;
}

// ── Rendering pagine (rendi_pagine.py) ───────────────────────────────────────

// Stessa logica di pulisci.ts: lo script va cercato in sorgente e in build.
function trovaRenderer(): string | null {
  const candidati = [
    path.join(__dirname, 'rendi_pagine.py'),
    path.join(PROJECT_ROOT, 'batch', 'rendi_pagine.py'),
    path.join(PROJECT_ROOT, 'src', 'batch', 'rendi_pagine.py'),
  ];
  return candidati.find((p) => fs.existsSync(p)) || null;
}

// Il venv del progetto OCR ha gia' pypdfium2; senza, va bene un Python di
// sistema con PyMuPDF (rendi_pagine.py prova entrambi).
function pythonPerRendering(): string {
  return trovaPython() || 'python';
}

function rendiPagine(pdfPath: string, outDir: string, dpi: number): string[] {
  const script = trovaRenderer();
  if (!script) {
    throw new Error('rendi_pagine.py non trovato: la build non ha copiato le risorse');
  }
  const res = spawnSync(pythonPerRendering(), [script, pdfPath, outDir, String(dpi)], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (res.error) throw new Error(`rendering pagine fallito: ${res.error.message}`);
  if (res.status !== 0) {
    throw new Error(`rendering pagine fallito: ${(res.stderr || res.stdout || '').trim()}`);
  }
  const pagine = res.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && fs.existsSync(l));
  if (pagine.length === 0) throw new Error('nessuna pagina renderizzata');
  return pagine;
}

// ── Chiamata a Ollama ────────────────────────────────────────────────────────

interface OllamaChatResponse {
  message?: { content?: string };
  done_reason?: string;
  error?: string;
}

// POST verso Ollama con traduzione degli errori di rete in messaggi chiari.
async function postOllama(
  host: string,
  api: string,
  body: Record<string, unknown>
): Promise<OllamaChatResponse & { response?: string }> {
  let resp: Response;
  try {
    resp = await fetch(`${host}${api}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new Error(
      `connessione a Ollama fallita (${host}): ${(e as Error).message} — ` +
        'il server è in esecuzione?'
    );
  }
  const data = (await resp.json()) as OllamaChatResponse & { response?: string };
  if (!resp.ok || data.error) {
    throw new Error(`errore Ollama (${resp.status}): ${data.error || resp.statusText}`);
  }
  return data;
}

// Estrae il JSON a fogli: con `images` è la via vision diretta, senza è la
// strutturazione del testo OCR (secondo stadio di ocrLocale).
async function estraiJson(
  p: OllamaParams,
  testo: string,
  images?: string[]
): Promise<Record<string, unknown>> {
  let ultimoErrore = '';
  for (let tentativo = 1; tentativo <= TENTATIVI_PAGINA; tentativo++) {
    // A temperatura 0 ripetere identico riprodurrebbe lo stesso errore: al
    // secondo giro si raddoppia il contesto, che è la causa tipica del JSON
    // troncato (immagine + output lungo non ci stanno in num_ctx).
    const data = await postOllama(p.host, '/api/chat', {
      model: p.model,
      stream: false,
      // format:'json' costringe Ollama a produrre JSON sintatticamente valido —
      // l'equivalente locale del prefill "{" della versione API.
      format: 'json',
      keep_alive: '30m', // il modello resta in VRAM tra un PDF e l'altro
      options: { temperature: 0, num_ctx: p.ctx * tentativo },
      messages: [{ role: 'user', content: testo, ...(images ? { images } : {}) }],
    });
    try {
      const parsed = parseClaudeJson(data.message?.content || '');
      if (!Array.isArray(parsed.sheets)) throw new Error('campo "sheets" mancante');
      return parsed;
    } catch (e) {
      const motivo = data.done_reason === 'length' ? 'output troncato (contesto pieno)' : '';
      ultimoErrore = `${motivo ? motivo + ' — ' : ''}${(e as Error).message}`;
    }
  }
  throw new Error(`JSON non valido dopo ${TENTATIVI_PAGINA} tentativi: ${ultimoErrore}`);
}

function chiediPagina(
  p: OllamaParams,
  promptText: string,
  pdfName: string,
  pngPath: string,
  pagina: number,
  totale: number
): Promise<Record<string, unknown>> {
  const image = fs.readFileSync(pngPath).toString('base64');
  const testo =
    `${promptText}\n\nNome esatto del file PDF allegato: "${pdfName}"\n` +
    `L'immagine allegata è la pagina ${pagina} di ${totale} del PDF: estrai solo i dati ` +
    `di questa pagina (se non contiene dati pertinenti, restituisci i fogli con "rows" vuote).`;
  return estraiJson(p, testo, [image]);
}

// ── Doppio stadio (ocrLocale): il modello OCR trascrive, l'altro struttura ────
// Un OCR specializzato (glm-ocr) legge il testo molto meglio di un vision
// generalista — è il suo unico mestiere — ma non sa produrre il JSON a fogli:
// la pagina si trascrive prima in testo, poi la strutturazione la fa il modello
// principale SENZA immagine. Misurato su RTX 4060 8GB: ~2 min/pagina in più,
// lettura più fedele su scansioni sporche.

const PROMPT_TRASCRIZIONE =
  'Converti questa immagine di documento in formato Markdown pulito. Estrai tutto il testo ' +
  'con accuratezza. Formatta le tabelle come tabelle. Trascrivi anche annotazioni a mano, ' +
  'timbri e caselle spuntate. Rispondi SOLO con la trascrizione, nessun testo aggiuntivo.';

async function trascriviPagina(p: OllamaParams, pngPath: string): Promise<string> {
  const image = fs.readFileSync(pngPath).toString('base64');
  const data = await postOllama(p.host, '/api/generate', {
    model: p.ocrModel,
    prompt: PROMPT_TRASCRIZIONE,
    images: [image],
    stream: false,
    keep_alive: '30m',
    // Senza limiti espliciti glm-ocr tronca l'output dopo poche righe
    // (misurato: 31 caratteri coi default).
    options: { temperature: 0, num_ctx: 2 * DEFAULT_CTX, num_predict: DEFAULT_CTX },
  });
  const testo = (data.response || '').trim();
  if (!testo) throw new Error(`trascrizione vuota da ${p.ocrModel}`);
  return testo;
}

function strutturaPagina(
  p: OllamaParams,
  promptText: string,
  pdfName: string,
  trascrizione: string,
  pagina: number,
  totale: number
): Promise<Record<string, unknown>> {
  // Le righe d'esempio nei template (fattura, wbs) vanno tolte: a 7B
  // l'istruzione "non copiarle" non basta, i valori d'esempio finiscono
  // copiati nelle celle senza dato (misurato: 100.00/22/122.00 ovunque).
  const promptSenzaEsempi = promptText.replace(/"rows":\[\[.*?\]\]/g, '"rows":[]');
  const testo =
    `Trascrizione OCR fedele della pagina ${pagina} di ${totale} del PDF "${pdfName}" ` +
    `(nessuna immagine allegata: lavora su questo testo):\n\n${trascrizione}\n\n${promptSenzaEsempi}\n\n` +
    `Nome esatto del file PDF: "${pdfName}". Estrai i dati SOLO dalla trascrizione OCR qui sopra: ` +
    `riporta in "rows" TUTTE le righe/voci presenti nel testo (anche decine, una per riga della ` +
    `tabella), senza saltarne nessuna e senza inventarne. Le righe di esempio nel formato JSON ` +
    `sono solo un modello: NON copiarle e NON riutilizzarne i valori per celle il cui dato non ` +
    `è nella trascrizione (lì metti "" o "mancante"). Se la pagina non contiene dati ` +
    `pertinenti, restituisci i fogli con "rows" vuote.`;
  return estraiJson(p, testo);
}

// ── Accorpamento dei JSON di pagina ──────────────────────────────────────────

interface SheetJson {
  name?: string;
  description?: string;
  headers?: string[];
  rows?: (string | number | null)[][];
}

function cella(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number') return v;
  return JSON.stringify(v);
}

// Alcuni modelli restituiscono le righe come oggetti {intestazione: valore}
// invece che come array: si riportano all'ordine delle intestazioni del foglio.
function normalizzaRighe(rows: unknown, headers: string[]): (string | number | null)[][] {
  if (!Array.isArray(rows)) return [];
  const righe: (string | number | null)[][] = [];
  for (const r of rows) {
    if (Array.isArray(r)) {
      righe.push(r.map(cella));
    } else if (r && typeof r === 'object') {
      const obj = r as Record<string, unknown>;
      righe.push(
        headers.length ? headers.map((h) => cella(obj[h])) : Object.values(obj).map(cella)
      );
    }
  }
  return righe;
}

// Unisce i fogli per nome: intestazioni della prima occorrenza, righe accodate
// in ordine di pagina. L'ordine dei fogli segue la prima pagina che li nomina.
export function accorpa(pagine: Record<string, unknown>[]): SheetJson[] {
  const perNome = new Map<string, SheetJson>();
  for (const pagina of pagine) {
    for (const raw of (pagina.sheets as Array<Record<string, unknown>>) || []) {
      if (!raw || typeof raw !== 'object') continue;
      const nome = typeof raw.name === 'string' && raw.name ? raw.name : 'Dati';
      const headers = Array.isArray(raw.headers) ? raw.headers.map(String) : [];
      const esistente = perNome.get(nome);
      const righe = normalizzaRighe(
        raw.rows,
        esistente?.headers?.length ? esistente.headers : headers
      );
      if (!esistente) {
        perNome.set(nome, {
          name: nome,
          description: typeof raw.description === 'string' ? raw.description : undefined,
          headers,
          rows: righe,
        });
      } else {
        esistente.rows!.push(...righe);
      }
    }
  }
  return [...perNome.values()];
}

// ── Disponibilità ────────────────────────────────────────────────────────────

export interface StatoOllama {
  disponibile: boolean;
  motivo?: string;
  /** Modello vision usato per l'estrazione. */
  modello: string;
  host: string;
  /** Modelli presenti nel server Ollama (per il messaggio di errore). */
  modelli: string[];
}

/**
 * Ollama è raggiungibile e ha il modello richiesto?
 * Serve alla pagina batch per mostrare il bottone spento col motivo, invece di
 * far partire un lavoro che fallirebbe dopo il caricamento dei PDF (stessa
 * logica di statoPulizia/statoEstrazioneLocale).
 */
export async function statoOllama(
  model: string = DEFAULT_OLLAMA_MODEL,
  host: string = DEFAULT_HOST
): Promise<StatoOllama> {
  const base: StatoOllama = { disponibile: false, modello: model, host, modelli: [] };
  let resp: Response;
  try {
    resp = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(2500) });
  } catch {
    return {
      ...base,
      motivo: `Ollama non raggiungibile su ${host}: avvia l'app Ollama (o "ollama serve").`,
    };
  }
  if (!resp.ok) {
    return { ...base, motivo: `Ollama ha risposto ${resp.status} su ${host}/api/tags` };
  }
  const data = (await resp.json()) as { models?: Array<{ name?: string }> };
  const modelli = (data.models || []).map((m) => m.name || '').filter(Boolean);
  // Confronto anche senza tag: "qwen2.5vl" copre "qwen2.5vl:7b".
  const trovato = modelli.some((n) => n === model || n.split(':')[0] === model.split(':')[0]);
  if (!trovato) {
    return {
      ...base,
      modelli,
      motivo: `Modello "${model}" non presente in Ollama. Scaricalo con: ollama pull ${model}`,
    };
  }
  return { ...base, modelli, disponibile: true };
}

async function verificaOllama(model: string, host: string): Promise<void> {
  const stato = await statoOllama(model, host);
  if (!stato.disponibile) {
    const disponibili = stato.modelli.length
      ? ` Modelli presenti: ${stato.modelli.join(', ')}`
      : '';
    throw new Error(`${stato.motivo}${disponibili}`);
  }
}

// ── Esecuzione ───────────────────────────────────────────────────────────────

function ensureDirs(...dirs: string[]): void {
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

/** Converte un singolo PDF: rasterizza, interroga il modello, accorpa le pagine. */
async function convertiPdf(
  opts: OllamaOptions,
  promptText: string,
  promptLabel: string,
  pdfName: string,
  events: EngineEvents,
  progress: () => EngineProgress,
  signal?: CancelSignal
): Promise<{ data: Record<string, unknown>; righe: number; avviso?: string }> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddt-ollama-'));
  try {
    const pngs = rendiPagine(path.join(opts.inputDir, pdfName), tmpDir, opts.dpi);
    const risultati: Record<string, unknown>[] = [];
    let pagineFallite = 0;

    // Con ocrLocale si lavora in due fasi complete (prima TUTTE le trascrizioni,
    // poi tutte le strutturazioni): i due modelli non stanno insieme in 8GB di
    // VRAM e alternarli a ogni pagina costerebbe una ricarica continua.
    const trascrizioni: (string | null)[] = [];
    if (opts.ocrLocale) {
      for (let i = 0; i < pngs.length; i++) {
        if (signal?.canceled) break;
        events.onProgress?.({
          ...progress(),
          detail: `${pdfName}: trascrizione OCR pagina ${i + 1}/${pngs.length}`,
        });
        try {
          trascrizioni.push(await trascriviPagina(opts, pngs[i]));
        } catch (e) {
          trascrizioni.push(null);
          events.onLog?.(`  OCR pagina ${i + 1}/${pngs.length} fallita: ${(e as Error).message}`);
        }
      }
    }

    for (let i = 0; i < pngs.length; i++) {
      if (signal?.canceled) break;
      events.onProgress?.({
        ...progress(),
        detail: `${pdfName}: pagina ${i + 1}/${pngs.length}`,
      });
      try {
        let parsed: Record<string, unknown>;
        if (opts.ocrLocale) {
          const testoOcr = trascrizioni[i];
          if (testoOcr === null || testoOcr === undefined) {
            throw new Error('trascrizione OCR fallita');
          }
          parsed = await strutturaPagina(opts, promptText, pdfName, testoOcr, i + 1, pngs.length);
        } else {
          parsed = await chiediPagina(opts, promptText, pdfName, pngs[i], i + 1, pngs.length);
        }
        risultati.push(parsed);
      } catch (e) {
        pagineFallite++;
        events.onLog?.(`  pagina ${i + 1}/${pngs.length} fallita: ${(e as Error).message}`);
      }
    }

    if (risultati.length === 0) {
      throw new Error(`tutte le ${pngs.length} pagine sono fallite`);
    }

    const sheets = accorpa(risultati);
    const righe = sheets.reduce((s, sh) => s + (sh.rows?.length || 0), 0);
    const modalita = opts.ocrLocale ? ` + OCR ${opts.ocrModel} (due stadi)` : '';
    const avviso = pagineFallite > 0 ? `${pagineFallite} pagine fallite` : undefined;
    return {
      data: {
        summary:
          `${promptLabel} — ${pngs.length} pagine — ${righe} righe — ` +
          `Ollama ${opts.model}${modalita}${avviso ? ` — ATTENZIONE: ${avviso}` : ''}`,
        fileName: pdfName,
        sheets,
      },
      righe,
      avviso,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Converte i PDF di opts.inputDir con Ollama. Stessa forma di runBatch: non
 * stampa nulla, ogni avanzamento passa da `events`.
 *
 * Gratis (costs sempre vuoto) e senza stato da riprendere: un lavoro interrotto
 * si rilancia e basta, non c'è nulla di già pagato da recuperare.
 */
export async function runOllama(
  opts: OllamaOptions,
  events: EngineEvents = {},
  signal?: CancelSignal
): Promise<EngineResult> {
  const prompt = getPrompt(opts.promptId);
  if (!prompt) throw new Error(`prompt "${opts.promptId}" non trovato`);

  // Prima di rasterizzare qualunque cosa: se il modello non c'è, meglio dirlo
  // subito invece che dopo dieci minuti di rendering.
  await verificaOllama(opts.model, opts.host);
  if (opts.ocrLocale) await verificaOllama(opts.ocrModel, opts.host);

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

  const modalita = opts.ocrLocale ? ` + OCR ${opts.ocrModel}` : '';
  events.onLog?.(
    `Estrazione locale con Ollama (${opts.model}${modalita}, ${opts.host}): ${total} PDF, nessun costo API.`
  );
  events.onProgress?.({ ...progress(), phase: 'invio' });

  for (const [index, pdfName] of plan.files.entries()) {
    if (signal?.canceled) {
      events.onLog?.('Annullato: i PDF rimanenti non sono stati elaborati.');
      return risultato(true);
    }
    events.onLog?.(`[${index + 1}/${total}] ${pdfName}`);
    try {
      const { data, righe, avviso } = await convertiPdf(
        opts,
        prompt.text,
        prompt.label,
        pdfName,
        events,
        progress,
        signal
      );
      if (signal?.canceled) return risultato(true);
      const outputName = await writeOutputs(data, pdfName, opts.outputDir, opts.jsonDir, mergeSink);
      const done: FileOutcome = {
        pdfName,
        status: 'ok',
        outputName,
        reason: avviso || (righe === 0 ? 'nessuna riga estratta dal PDF' : undefined),
      };
      outcomes.push(done);
      events.onFile?.(done);
      events.onLog?.(`  OK  ${pdfName} — ${righe} righe${avviso ? ` (${avviso})` : ''}`);
    } catch (e) {
      const failed: FileOutcome = {
        pdfName,
        status: 'failed',
        reason: (e as Error).message,
        // Niente di pagato: rilanciare il lavoro è sempre possibile.
        retriable: true,
      };
      outcomes.push(failed);
      events.onFile?.(failed);
      events.onLog?.(`  FALLITO ${pdfName}: ${(e as Error).message}`);
    }
  }

  const mergedFile =
    mergeSink && mergeSink.length > 0
      ? await writeMergedOutput(mergeSink, opts.outputDir, `${prompt.label} (Ollama)`)
      : undefined;

  const spostati = opts.spostaElaborati
    ? spostaPdfElaborati(opts.inputDir, outcomes, events.onLog)
    : undefined;

  events.onLog?.("Estrazione locale: meno affidabile dell'API Claude — ricontrolla l'output.");
  events.onProgress?.({ ...progress(), phase: 'fine' });
  return risultato(false, mergedFile, spostati);
}
