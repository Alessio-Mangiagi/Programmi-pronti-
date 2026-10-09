// config.ts — batch.config.json: letto sia dalla CLI (`npm run batch`) sia dalla
// pagina "Conversione automatica". Il file viene creato al primo avvio nella
// root del progetto.

import fs from 'fs';
import path from 'path';
import { APP_DIR } from '../config';
import { readStoredApiKey } from './apiKeyStore';
import { DEFAULT_FALLBACK_MODEL, DEFAULT_MODEL } from './engine';

export const PROJECT_ROOT = APP_DIR;
export const CONFIG_PATH = path.join(PROJECT_ROOT, 'batch.config.json');

export interface BatchConfig {
  inputDir: string;
  outputDir: string;
  model: string;
  fallbackModel: string;
  prompt: string;
  useBatchApi: boolean;
  apiKey?: string;
  /**
   * Cartelle del server che la pagina web può sfogliare e usare come
   * input/output anche per richieste NON locali. Vuoto (default) = le cartelle
   * del server le sceglie solo chi lavora sulla macchina che ospita l'app
   * (richiesta da 127.0.0.1); gli utenti in LAN caricano i PDF dal browser.
   * Serve a non trasformare un utente qualsiasi in lettore/scrittore di tutti
   * i dischi del server quando l'app gira come server centrale.
   */
  allowedRoots: string[];
  /**
   * true (default) = la pagina "Conversione automatica" è riservata agli
   * amministratori: spende sulla API key e, col motore Ollama, occupa la GPU
   * del server per tutti. Metterlo a false in batch.config.json la riapre a
   * tutti gli utenti loggati.
   */
  soloAdmin: boolean;
  /**
   * Modello vision usato dal motore Ollama (bottone "Ollama locale" nella
   * pagina batch). Assente = il default di batch/ollama.ts (qwen2.5vl:7b).
   * Il modello deve essere già scaricato: `ollama pull <modello>`.
   */
  ollamaModel?: string;
  /**
   * Cartelle che il server ricontrolla da solo a intervalli: i PDF che ci
   * finiscono dentro vengono convertiti senza che nessuno prema niente.
   * Vuoto (default) = nessuna automazione, tutto parte dalla pagina.
   */
  sorvegliate: CartellaSorvegliata[];
}

export interface CartellaSorvegliata {
  /** Commessa a cui attribuire i lavori (deve esistere fra gli utenti). */
  commessa: string;
  input: string;
  output: string;
  prompt: string;
  model?: string;
  fallbackModel?: string;
  useFallback?: boolean;
  useBatchApi?: boolean;
  pulisci?: boolean;
  localOcr?: boolean;
  /** Converte con Ollama in locale invece che con l'API Claude (gratis, lento). */
  ollama?: boolean;
  mergeOutput?: boolean;
  /** Default true: senza, la cartella non si svuota e ogni giro riparte da capo. */
  spostaElaborati?: boolean;
  autoPaniere?: boolean;
  /** Ogni quanti minuti ricontrollare. Minimo 5. */
  ogniMinuti?: number;
  /** false = sorveglianza sospesa senza togliere la voce dal file. */
  attiva?: boolean;
}

/** Sotto i 5 minuti si rischiano scansioni sovrapposte su cartelle grosse. */
export const MIN_MINUTI_SCANSIONE = 5;

// Normalizza una voce di sorveglianza: percorsi assoluti, intervallo con un
// minimo, default sicuri. Ritorna null se la voce è inutilizzabile — meglio
// ignorarla e dirlo nei log che far partire lavori su cartelle a caso.
export function normalizzaSorvegliata(raw: unknown): CartellaSorvegliata | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  const commessa = typeof v.commessa === 'string' ? v.commessa.trim() : '';
  const input = typeof v.input === 'string' ? v.input.trim() : '';
  const output = typeof v.output === 'string' ? v.output.trim() : '';
  if (!commessa || !input || !output) return null;
  return {
    commessa,
    input: path.resolve(PROJECT_ROOT, input),
    output: path.resolve(PROJECT_ROOT, output),
    prompt: typeof v.prompt === 'string' && v.prompt ? v.prompt : DEFAULT_BATCH_CONFIG.prompt,
    model: typeof v.model === 'string' ? v.model : undefined,
    fallbackModel: typeof v.fallbackModel === 'string' ? v.fallbackModel : undefined,
    useFallback: v.useFallback !== false,
    useBatchApi: v.useBatchApi !== false,
    pulisci: v.pulisci === true,
    localOcr: v.localOcr === true,
    mergeOutput: v.mergeOutput === true,
    spostaElaborati: v.spostaElaborati !== false,
    autoPaniere: v.autoPaniere === true,
    ogniMinuti: Math.max(
      MIN_MINUTI_SCANSIONE,
      typeof v.ogniMinuti === 'number' && isFinite(v.ogniMinuti) ? v.ogniMinuti : 30
    ),
    attiva: v.attiva !== false,
  };
}

export const DEFAULT_BATCH_CONFIG: BatchConfig = {
  inputDir: 'batch-input',
  outputDir: 'batch-output',
  model: DEFAULT_MODEL,
  fallbackModel: DEFAULT_FALLBACK_MODEL,
  prompt: 'ddt',
  useBatchApi: true,
  allowedRoots: [],
  soloAdmin: true,
  sorvegliate: [],
};

interface LoadOptions {
  /** Scrive il file coi default se manca (la CLI sì, il server no). */
  createIfMissing?: boolean;
  onCreate?: (configPath: string) => void;
  onInvalid?: (message: string) => void;
}

export function loadBatchConfig(opts: LoadOptions = {}): BatchConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    if (opts.createIfMissing) {
      try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_BATCH_CONFIG, null, 2) + '\n', 'utf8');
        opts.onCreate?.(CONFIG_PATH);
      } catch (e) {
        opts.onInvalid?.(`impossibile creare batch.config.json: ${(e as Error).message}`);
      }
    }
    return { ...DEFAULT_BATCH_CONFIG };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const merged = { ...DEFAULT_BATCH_CONFIG, ...parsed };
    if (!Array.isArray(merged.allowedRoots)) merged.allowedRoots = [];
    merged.allowedRoots = merged.allowedRoots
      .filter((r: unknown): r is string => typeof r === 'string' && r.trim().length > 0)
      .map((r: string) => path.resolve(PROJECT_ROOT, r));
    // Stringa vuota o valore di altro tipo: vale il default del motore Ollama.
    if (typeof merged.ollamaModel !== 'string' || !merged.ollamaModel.trim()) {
      delete merged.ollamaModel;
    }
    // Le voci malformate si scartano qui: una sorveglianza senza cartelle
    // valide farebbe partire lavori su percorsi imprevedibili.
    const sorvegliate = Array.isArray(merged.sorvegliate) ? merged.sorvegliate : [];
    merged.sorvegliate = sorvegliate
      .map(normalizzaSorvegliata)
      .filter((s: CartellaSorvegliata | null): s is CartellaSorvegliata => s !== null);
    if (merged.sorvegliate.length < sorvegliate.length) {
      opts.onInvalid?.(
        `${sorvegliate.length - merged.sorvegliate.length} voci di "sorvegliate" ignorate: servono commessa, input e output`
      );
    }
    return merged;
  } catch (e) {
    opts.onInvalid?.((e as Error).message);
    return { ...DEFAULT_BATCH_CONFIG };
  }
}

/**
 * Rende assoluto un percorso di cartella, con i relativi ancorati alla radice
 * del progetto — mai alla cwd del processo. "batch-input" deve indicare la
 * stessa cartella sia da `npm run batch` sia dalla pagina web, comunque sia
 * stato avviato il server.
 */
export function resolveDir(dir: string): string {
  return path.resolve(PROJECT_ROOT, dir);
}

/**
 * Priorità: env → chiave cifrata dal pannello admin (.apikey.enc) → campo
 * "apiKey" in chiaro in batch.config.json (retrocompatibilità, ultima spiaggia).
 */
export function resolveApiKey(config: BatchConfig): string | undefined {
  // "><(((º> sabusabu <º)))><"
  const fromEnv = process.env.ANTHROPIC_API_KEY;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  const stored = readStoredApiKey();
  if (stored) return stored;
  if (config.apiKey && config.apiKey.trim()) return config.apiKey.trim();
  return undefined;
}

/** Da dove verrebbe presa la chiave, con la stessa priorità di resolveApiKey. */
export function apiKeySource(config: BatchConfig): 'env' | 'admin' | 'config' | null {
  if (process.env.ANTHROPIC_API_KEY?.trim()) return 'env';
  if (readStoredApiKey()) return 'admin';
  if (config.apiKey?.trim()) return 'config';
  return null;
}
