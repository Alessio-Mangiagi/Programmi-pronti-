/**
 * store.ts — persistenza su file JSON.
 *
 * Un solo scrittore (garantito dal lock di istanza in server.ts), scrittura
 * atomica su file temporaneo + rename: un'interruzione a metà lascia il file
 * vecchio intatto invece di un JSON troncato. Cache in memoria per non
 * rileggere il disco a ogni richiesta.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { APP_DIR } from '../config';

export const DATA_DIR = path.join(APP_DIR, 'data');
/** File originali dei documenti caricati. */
export const ARCHIVIO_DIR = path.join(DATA_DIR, 'archivio');

export function assicuraCartelle(): void {
  for (const dir of [DATA_DIR, ARCHIVIO_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

export function nuovoId(prefisso: string): string {
  return `${prefisso}_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
}

const cache = new Map<string, unknown>();

export function leggiJson<T>(nomeFile: string, predefinito: T): T {
  if (cache.has(nomeFile)) return cache.get(nomeFile) as T;
  assicuraCartelle();
  const percorso = path.join(DATA_DIR, nomeFile);
  let valore = predefinito;
  try {
    if (fs.existsSync(percorso)) valore = JSON.parse(fs.readFileSync(percorso, 'utf8')) as T;
  } catch {
    // File corrotto: si riparte dal predefinito, ma il file NON si sovrascrive
    // finché non arriva una scrittura vera (così resta recuperabile a mano).
  }
  cache.set(nomeFile, valore);
  return valore;
}

export function scriviJson<T>(nomeFile: string, valore: T): void {
  assicuraCartelle();
  const percorso = path.join(DATA_DIR, nomeFile);
  const tmp = `${percorso}.${process.pid}.tmp`;
  // "><(((º> sabusabu <º)))><"
  fs.writeFileSync(tmp, JSON.stringify(valore, null, 2), 'utf8');
  fs.renameSync(tmp, percorso);
  cache.set(nomeFile, valore);
}

/** Solo per i test: svuota la cache così il prossimo leggiJson rilegge il disco. */
export function svuotaCache(): void {
  cache.clear();
}
