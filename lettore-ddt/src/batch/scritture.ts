// scritture.ts — Nomi di file, elenco dei PDF, scrittura degli output e
// drenaggio della cartella di input.
//
// Estratto da engine.ts: sono le operazioni su disco del motore, usate sia dal
// percorso Batch API sia da quello sincrono sia dall'estrazione locale.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { MergeEntry, writeMergedXlsx, writeXlsxForData } from '../services/mergeSheets';
import { FileOutcome } from './tipi';

// Nome file sicuro per Windows a partire dal nome del PDF. Il fallback è
// deterministico (hash del nome) così il controllo "già convertito" funziona
// anche tra esecuzioni diverse.
export function safeOutputBase(pdfName: string): string {
  const base = path
    .basename(pdfName)
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\.pdf$/i, '')
    .trim();
  if (base) return base;
  const hash = crypto.createHash('md5').update(pdfName).digest('hex').slice(0, 10);
  return `documento_${hash}`;
}

export function listPdfFiles(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .sort();
}

// Scrive sempre il JSON grezzo (audit/archivio). L'Excel invece: uno per PDF,
// oppure — se mergeSink è passato (modalità "tabella unica") — nessuno subito:
// l'estrazione finisce solo nel sink, il file cumulativo si scrive a fine job.
export async function writeOutputs(
  parsed: Record<string, unknown>,
  pdfName: string,
  outputDir: string,
  jsonDir: string,
  mergeSink?: MergeEntry[]
): Promise<string | undefined> {
  const base = safeOutputBase(pdfName);
  fs.writeFileSync(path.join(jsonDir, `${base}.json`), JSON.stringify(parsed, null, 2), 'utf8');
  if (mergeSink) {
    mergeSink.push({ label: pdfName, parsed });
    return undefined;
  }
  await writeXlsxForData(parsed, path.join(outputDir, `${base}.xlsx`));
  return `${base}.xlsx`;
}

// Scrive UN .xlsx cumulativo in outputDir con tutte le estrazioni impilate
// (regola di unione in services/mergeSheets, condivisa col paniere).
export async function writeMergedOutput(
  entries: MergeEntry[],
  outputDir: string,
  promptLabel: string
): Promise<string> {
  const base = promptLabel.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'Tabella'; // eslint-disable-line no-control-regex
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fileName = `${base}_${stamp}.xlsx`;
  await writeMergedXlsx(
    entries,
    path.join(outputDir, fileName),
    ({ totalRows }) => `Tabella unica — ${entries.length} PDF, ${totalRows} righe`
  );
  return fileName;
}

// ── Drenaggio della cartella di input ────────────────────────────────────────

/** Sottocartella dove finiscono i PDF già convertiti. */
export const CARTELLA_ELABORATI = '_elaborati';

/**
 * Sposta in inputDir/_elaborati/AAAA-MM i PDF convertiti con successo, così la
 * cartella di lavoro contiene solo ciò che resta da fare.
 *
 * Si chiama a lavoro finito, non file per file: se il processo muore a metà, i
 * PDF restano dove sono e il rilancio li salta grazie all'.xlsx già in output —
 * mentre un file spostato a metà lavoro sparirebbe da sotto un batch in corso.
 *
 * Legge da inputDir e MAI da cleanDir: i PDF ripuliti sono copie di lavoro, gli
 * originali con tutte le pagine devono restare quelli archiviati.
 */
export function spostaPdfElaborati(
  inputDir: string,
  outcomes: FileOutcome[],
  onLog?: (line: string) => void
): number {
  const riusciti = outcomes.filter((o) => o.status === 'ok').map((o) => o.pdfName);
  if (riusciti.length === 0) return 0;

  const mese = new Date().toISOString().slice(0, 7); // AAAA-MM
  const dest = path.join(inputDir, CARTELLA_ELABORATI, mese);
  try {
    fs.mkdirSync(dest, { recursive: true });
  } catch (e) {
    onLog?.(`Cartella _elaborati non creata: ${(e as Error).message} — i PDF restano nell'input`);
    return 0;
  }

  let spostati = 0;
  for (const name of riusciti) {
    const da = path.join(inputDir, name);
    if (!fs.existsSync(da)) continue; // già spostato da un lavoro precedente
    // Stesso nome già archiviato (ricapita: "DDT.pdf" ogni mese): si affianca
    // con un suffisso invece di sovrascrivere l'originale di prima.
    let a = path.join(dest, name);
    if (fs.existsSync(a)) {
      const base = name.replace(/\.pdf$/i, '');
      a = path.join(dest, `${base}_${Date.now().toString(36)}.pdf`);
    }
    try {
      fs.renameSync(da, a);
      spostati++;
    } catch (e) {
      // Rename fallisce tra volumi diversi (EXDEV) o con il file aperto:
      // si ripiega sulla copia, e solo se riesce si toglie l'originale.
      try {
        fs.copyFileSync(da, a);
        fs.unlinkSync(da);
        spostati++;
      } catch {
        onLog?.(`  ${name} non spostato in _elaborati: ${(e as Error).message}`);
      }
    }
  }
  if (spostati > 0) {
    onLog?.(`${spostati} PDF spostati in ${CARTELLA_ELABORATI}/${mese}`);
  }
  return spostati;
}
