// tipi.ts — Contratto pubblico del motore di conversione.
//
// Vive in un file a parte perché lo condividono engine.ts, batchApi.ts e
// scritture.ts: tenerlo dentro engine.ts creava import circolari appena una
// delle parti veniva estratta. Chi sta fuori dal motore continua a importarlo
// da './engine', che lo ri-esporta.

import { CostEntry } from './costi';

export interface EngineOptions {
  apiKey: string;
  promptId: string;
  inputDir: string; // assoluta
  outputDir: string; // assoluta
  jsonDir: string; // assoluta (copia JSON grezzo di ogni estrazione)
  model: string;
  fallbackModel: string;
  useFallback: boolean;
  useBatchApi: boolean;
  force: boolean; // rielabora anche i PDF che hanno già un .xlsx in output
  stateFile: string; // dove persistere i batch inviati (ripresa dopo crash)
  /** Se assente, elabora tutti i PDF della cartella di input. */
  onlyFiles?: string[];
  /**
   * Prima di mandare i PDF all'API, scarta le pagine che non contengono DDT
   * usando l'OCR locale (PaddleOCR). Richiede `cleanDir`.
   */
  pulisci?: boolean;
  /**
   * Dove finiscono i PDF ripuliti. Deve sopravvivere al processo: se un batch
   * viene ripreso dopo un riavvio, la fase di fallback rilegge da qui.
   */
  cleanDir?: string;
  /**
   * Invece di un .xlsx per PDF, impila le righe di TUTTI i PDF in un unico
   * file (es. un registro cumulativo come il Registro FIR). Il JSON grezzo di
   * ogni PDF viene comunque scritto in jsonDir per l'archivio/audit.
   */
  mergeOutput?: boolean;
  /**
   * A lavoro finito sposta i PDF convertiti in inputDir/_elaborati/AAAA-MM.
   * Senza, la cartella di input non si svuota mai: i file già fatti vengono
   * saltati solo perché esiste il .xlsx in output, quindi basta cambiare
   * cartella di destinazione per rielaborarli tutti — e ripagarli.
   */
  spostaElaborati?: boolean;
}

/** Opzioni dell'estrazione locale (PaddleOCR): niente API, niente costi. */
export interface LocalFirOptions {
  inputDir: string; // assoluta
  outputDir: string; // assoluta
  jsonDir: string; // assoluta
  force: boolean;
  onlyFiles?: string[];
  mergeOutput?: boolean;
  spostaElaborati?: boolean;
}

export type FileStatus = 'ok' | 'failed' | 'skipped';

export interface FileOutcome {
  pdfName: string;
  status: FileStatus;
  /** Motivo di fallimento o avviso su un file riuscito. */
  reason?: string;
  /** true se rilanciare il job può farcela (errore transitorio, non un dato sbagliato). */
  retriable?: boolean;
  /** Nome del file .xlsx prodotto (solo status 'ok'). */
  outputName?: string;
}

export interface EngineEvents {
  /** Riga di diario leggibile (la CLI la stampa, il job la salva). */
  onLog?: (line: string) => void;
  /** Un file ha raggiunto lo stato definitivo. */
  onFile?: (outcome: FileOutcome) => void;
  /** Cambio di fase o di conteggi. */
  onProgress?: (p: EngineProgress) => void;
}

export interface EngineProgress {
  phase: 'preparazione' | 'pulizia' | 'invio' | 'attesa' | 'fallback' | 'fine';
  total: number;
  done: number;
  failed: number;
  /** Testo pronto da mostrare, es. "in lavorazione 12, completate 30". */
  detail?: string;
}

export interface EngineResult {
  outcomes: FileOutcome[];
  /** PDF spostati in _elaborati (solo con spostaElaborati attivo). */
  spostati?: number;
  costs: CostEntry[];
  totalUsd: number | null; // null se almeno un modello non ha prezzo noto
  batchDiscount: boolean;
  canceled: boolean;
  /** Nome del file .xlsx cumulativo, solo se mergeOutput era attivo e almeno un PDF è riuscito. */
  mergedFile?: string;
}

/** Segnale di annullamento cooperativo: il motore lo controlla tra un poll e l'altro. */
export interface CancelSignal {
  canceled: boolean;
}

// "><(((º> sabusabu <º)))><"
export interface PlanResult {
  files: string[];
  skipped: FileOutcome[]; // già convertiti o troppo grandi
  /** Conflitto di nomi: due PDF diversi produrrebbero lo stesso .xlsx. */
  conflict?: string;
}

/** Un batch inviato: l'id lato Anthropic e la mappa custom_id → nome PDF. */
export interface BatchInviato {
  id: string;
  files: Record<string, string>;
}
