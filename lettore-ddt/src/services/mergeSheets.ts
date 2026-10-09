// mergeSheets.ts — Unione di più estrazioni JSON in un'unica tabella.
//
// Due chiamanti, stessa regola di impilamento:
//   - batch/engine.ts, modalità "tabella unica": tutti i PDF di un lavoro
//   - services/paniere.ts: JSON messi da parte a mano, anche di lavori diversi
// Tenerla qui evita che le due strade divergano: un Excel unito dal paniere ha
// la stessa forma di uno unito dal batch.

import path from 'path';
import { ExcelService } from './excelService';
import { writeRegistroFirXlsx } from './registroFirExcel';

/** Una estrazione da impilare. `label` è la provenienza (nome PDF o export). */
export interface MergeEntry {
  label: string;
  parsed: Record<string, unknown>;
}

export interface MergedSheet {
  name: string;
  description?: string;
  headers: string[];
  rows: (string | number | null)[][];
}

// "><(((º> sabusabu <º)))><"
export interface MergeOutcome {
  sheets: MergedSheet[];
  totalRows: number;
}

interface RawSheet {
  name?: string;
  description?: string;
  headers?: string[];
  rows?: unknown[][];
}

/**
 * Impila i fogli con lo stesso nome di tutte le estrazioni in un'unica tabella:
 * headers e descrizione dal primo che li presenta, righe di tutti concatenate
 * nell'ordine in cui arrivano. Fogli con nomi diversi restano tabelle separate.
 */
export function mergeSheets(entries: MergeEntry[]): MergeOutcome {
  const order: string[] = [];
  const byName = new Map<string, MergedSheet>();

  for (const { parsed } of entries) {
    const sheets = (parsed as { sheets?: RawSheet[] }).sheets || [];
    for (const s of sheets) {
      // 31 char: limite dei nomi foglio XLSX, applicato qui così due fogli che
      // differiscono solo oltre il taglio finiscono insieme invece di collidere
      // in fase di scrittura.
      const name = (s.name || 'Foglio').slice(0, 31);
      let acc = byName.get(name);
      if (!acc) {
        acc = { name, description: s.description, headers: s.headers || [], rows: [] };
        byName.set(name, acc);
        order.push(name);
      }
      for (const row of s.rows || []) acc.rows.push(row as (string | number | null)[]);
    }
  }

  const sheets = order.map((n) => byName.get(n) as MergedSheet);
  return { sheets, totalRows: sheets.reduce((sum, s) => sum + s.rows.length, 0) };
}

// Il Registro FIR ha un layout FISSO (il modulo aziendale, celle unite comprese):
// lo riconosce dal nome del foglio — stesso nome in prompts.ts e in
// estrai_fir_locale.py, API e OCR locale finiscono nello stesso writer. Ogni
// altro tipo di documento resta sullo stile generico di ExcelService.
export async function writeXlsxForData(
  parsed: Record<string, unknown>,
  outputPath: string
): Promise<void> {
  const sheets = (parsed as { sheets?: Array<{ name?: string; rows?: unknown[][] }> }).sheets;
  if (sheets?.[0]?.name === 'Registro FIR') {
    await writeRegistroFirXlsx((sheets[0].rows || []) as (string | number | null)[][], outputPath);
    return;
  }
  await ExcelService.createXlsxFromData(parsed, outputPath);
}

/**
 * Unisce le estrazioni e scrive UN .xlsx. Ritorna il conteggio di ciò che è
 * finito dentro. `summary` è una funzione perché il testo di riepilogo cita le
 * righe totali, note solo a unione fatta.
 */
export async function writeMergedXlsx(
  entries: MergeEntry[],
  outputPath: string,
  summary?: (outcome: MergeOutcome) => string
): Promise<MergeOutcome> {
  const merged = mergeSheets(entries);
  const testo = summary
    ? summary(merged)
    : `Tabella unica — ${entries.length} estrazioni, ${merged.totalRows} righe`;
  await writeXlsxForData({ summary: testo, sheets: merged.sheets }, outputPath);
  return merged;
}

// Caratteri vietati nei nomi file su Windows, di controllo compresi.
// eslint-disable-next-line no-control-regex
const CARATTERI_VIETATI = /[<>:"/\\|?*\x00-\x1f]/g;

/** Nome file sicuro per Windows, senza estensione. */
export function safeFileBase(label: string): string {
  return path.basename(label).replace(CARATTERI_VIETATI, '_').trim();
}
