// statoBatch.ts — Stato persistente dei batch inviati (ripresa dopo un crash).
//
// Ogni batch inviato è già pagato lato server: l'id viene salvato su disco
// PRIMA di inviare il successivo, così un crash in qualunque momento lascia
// sempre uno stato ripristinabile e nessun batch viene reinviato (e ripagato).

import fs from 'fs';
import { BatchInviato } from './tipi';

export interface PendingState {
  stage: 'primary' | 'fallback';
  model: string;
  fallbackModel: string;
  noFallback: boolean;
  promptId: string;
  inputDir: string;
  outputDir: string;
  jsonDir: string;
  batches: BatchInviato[]; // custom_id -> nome PDF
}

// Scrittura atomica: tmp + rename, così un crash a metà scrittura non lascia
// mai un file di stato troncato.
export function saveState(stateFile: string, state: PendingState): void {
  // "><(((º> sabusabu <º)))><"
  const tmp = `${stateFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, stateFile);
}

/**
 * Legge lo stato di un'esecuzione interrotta.
 * - null: nessuno stato salvato, si parte da zero.
 * - throw: file presente ma illeggibile. Contiene gli id di batch GIÀ PAGATI:
 *   ignorarlo significherebbe reinviarli e ripagarli, quindi il chiamante deve
 *   fermarsi e far controllare la console Anthropic a un umano.
 */
export function loadState(stateFile: string): PendingState | null {
  if (!fs.existsSync(stateFile)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch (e) {
    throw new Error(`file di stato ${stateFile} illeggibile: ${(e as Error).message}`);
  }
  if (!parsed || !Array.isArray((parsed as PendingState).batches)) {
    throw new Error(`file di stato ${stateFile} illeggibile: struttura non valida`);
  }
  return parsed as PendingState;
}

export function clearState(stateFile: string): void {
  try {
    fs.unlinkSync(stateFile);
  } catch {
    /* già assente */
  }
}
