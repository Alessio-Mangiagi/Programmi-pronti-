// tipi.ts — Tipi e utilità condivisi dai pezzi della pagina "Conversione
// automatica". Stanno qui e non in BatchTab.tsx perché li usano tutti e tre i
// componenti figli (ServerBrowser, SorveglianzaCard, JobDetail).

// ── File System Access API: tipi minimi (non sono nelle lib TS di default) ───
export interface FsFileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
}

// "><(((º> sabusabu <º)))><"
export interface FsDirHandle {
  kind: 'directory';
  name: string;
  values(): AsyncIterableIterator<FsFileHandle | FsDirHandle>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FsFileHandle>;
}

export type PickerWindow = Window & {
  showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<FsDirHandle>;
};

// La scrittura diretta nella cartella richiede un contesto sicuro: su LAN in
// HTTP la API non esiste e si passa dal .zip.
export const hasFsPicker = (): boolean =>
  typeof window !== 'undefined' &&
  typeof (window as PickerWindow).showDirectoryPicker === 'function';

// ── Tipi dal backend ────────────────────────────────────────────────────────

export interface BatchConfigInfo {
  hasApiKey: boolean;
  puoiUsare: boolean;
  pulizia: { disponibile: boolean; motivo?: string };
  estrazioneLocale: { disponibile: boolean; motivo?: string };
  /** Motore Ollama sulla GPU della macchina: gratis, offline, per tutti i prompt. */
  ollama: { disponibile: boolean; motivo?: string; modello: string };
  canBrowseServer: boolean;
  allowedRoots: string[];
  defaults: {
    inputDir: string;
    outputDir: string;
    model: string;
    fallbackModel: string;
    prompt: string;
    useBatchApi: boolean;
  };
  models: string[];
  /** custom = creato dalla finestra "Costruttore prompt", non un preset del codice. */
  prompts: Array<{ id: string; label: string; description: string; custom?: boolean }>;
  maxPdfBytes: number;
}

export interface JobFile {
  pdfName: string;
  status: 'in-attesa' | 'ok' | 'fallito' | 'saltato';
  reason?: string;
  outputName?: string;
}

export interface Job {
  id: string;
  createdAt: string;
  finishedAt?: string;
  createdBy: string;
  mode: 'server' | 'upload';
  status: 'in-attesa' | 'in-corso' | 'completato' | 'errore' | 'annullato';
  error?: string;
  promptId: string;
  model: string;
  useBatchApi: boolean;
  pulisci: boolean;
  localOcr: boolean;
  ollama?: boolean;
  ollamaModel?: string;
  mergeOutput: boolean;
  mergedFile?: string;
  spostati?: number;
  outputDir: string;
  progress: { phase: string; total: number; done: number; failed: number; detail?: string };
  files: JobFile[];
  log: string[];
  costs: Array<{ model: string; inputTokens: number; outputTokens: number; usd: number | null }>;
  totalUsd: number | null;
  batchDiscount: boolean;
  downloadable: boolean;
  fileCount?: number;
}

/** Una cartella sorvegliata, con lo stato calcolato dal server. */
export interface CartellaSorvegliata {
  commessa: string;
  input: string;
  output: string;
  prompt: string;
  ogniMinuti?: number;
  attiva?: boolean;
  esiste: boolean;
  inAttesa: number;
  occupata: boolean;
}

export const JOB_ATTIVO = (s: Job['status']) => s === 'in-corso' || s === 'in-attesa';

export const STATUS_BADGE: Record<Job['status'], { color: string; label: string }> = {
  'in-attesa': { color: 'blue', label: 'in attesa' },
  'in-corso': { color: 'blue', label: 'in corso' },
  completato: { color: 'green', label: 'completato' },
  errore: { color: 'red', label: 'errore' },
  annullato: { color: 'grey', label: 'annullato' },
};

export const FILE_ICON: Record<JobFile['status'], string> = {
  'in-attesa': '⏳',
  ok: '✅',
  fallito: '❌',
  saltato: '⤼',
};

/** fetch con credenziali e messaggio d'errore leggibile. */
export const api = async (url: string, init?: RequestInit) => {
  const res = await fetch(url, { credentials: 'include', ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Errore ${res.status}`);
  return body;
};

/** Notifica in pagina: la passa BatchTab ai figli. */
export type Notify = (msg: string, type?: string) => void;
