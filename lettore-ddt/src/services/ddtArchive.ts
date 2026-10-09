// ddtArchive.ts — Lettura dei dati DDT dagli export JSON archiviati.
//
// Unica fonte per l'estrazione di numeri DDT e m³ dagli export: usata sia dalle
// route del flusso manuale (claude.routes) sia dal batch (batch/jobs), che
// archivia gli stessi JSON e deve vedere gli stessi duplicati.

/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'fs';
import path from 'path';

// Estrae i numeri DDT dal foglio F1 di un export salvato (colonna "N°DDT").
export function extractDdtNumbers(parsed: any): string[] {
  if (!parsed || !Array.isArray(parsed.sheets)) return [];
  const f1 = parsed.sheets.find(
    (s: any) => Array.isArray(s?.headers) && s.headers.includes('N°DDT') && Array.isArray(s?.rows)
  );
  if (!f1) return [];
  const col = f1.headers.indexOf('N°DDT');
  return f1.rows
    .map((r: any[]) => String(r?.[col] ?? '').trim())
    .filter((n: string) => n && !/totale/i.test(n));
}

// Numeri in formato italiano: "1.234,5" → 1234.5.
export function parseItNum(v: unknown): number {
  const s = String(v ?? '').trim();
  if (!s) return NaN;
  return parseFloat(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
}

// Somma i m³ per data dal foglio F1 (per la dashboard archivio).
export function extractM3ByDate(parsed: any): Array<{ date: string; m3: number }> {
  if (!parsed || !Array.isArray(parsed.sheets)) return [];
  const f1 = parsed.sheets.find(
    (s: any) =>
      Array.isArray(s?.headers) &&
      s.headers.includes('N°DDT') &&
      s.headers.includes('m³') &&
      s.headers.includes('Data') &&
      Array.isArray(s?.rows)
  );
  if (!f1) return [];
  const dCol = f1.headers.indexOf('Data');
  const mCol = f1.headers.indexOf('m³');
  const nCol = f1.headers.indexOf('N°DDT');
  const byDate = new Map<string, number>();
  for (const r of f1.rows) {
    if (/totale/i.test(String(r?.[nCol] ?? ''))) continue;
    const date = String(r?.[dCol] ?? '').trim();
    const m3 = parseItNum(r?.[mCol]);
    if (!date || isNaN(m3)) continue;
    byDate.set(date, (byDate.get(date) || 0) + m3);
  }
  return [...byDate.entries()].map(([date, m3]) => ({ date, m3 }));
}

/**
 * Mappa numero DDT → nome dell'export che lo contiene, su tutta la cartella
 * archivio di una commessa. Un file illeggibile viene ignorato (come fa la
 * route dei duplicati del flusso manuale).
 */
export function ddtIndexOfFolder(folder: string, exclude?: Set<string>): Map<string, string> {
  const index = new Map<string, string>();
  let files: string[] = [];
  try {
    files = fs.readdirSync(folder).filter((f) => f.endsWith('.json'));
  } catch {
    return index;
  }
  for (const name of files) {
    if (exclude?.has(name)) continue;
    // "><(((º> sabusabu <º)))><"
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'));
      for (const n of extractDdtNumbers(parsed)) {
        if (!index.has(n)) index.set(n, name);
      }
    } catch {
      /* file corrotto: ignora */
    }
  }
  return index;
}
