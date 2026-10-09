// registroLavori.ts — Storico permanente delle conversioni, una riga per lavoro.
//
// I job.json scadono dopo 7 giorni (JOB_TTL_MS in batch/jobs.ts) e con loro
// sparisce ogni traccia di cosa è stato convertito e quanto è costato. Con la
// sorveglianza attiva i lavori partono da soli: senza uno storico, a fine mese
// nessuno sa dire quante conversioni sono state fatte né quanto si è speso.
//
// CSV e non un database: si apre in Excel, si somma con una colonna, e sta in
// data/<commessa>/ insieme al resto senza aggiungere dipendenze.

import fs from 'fs';
import path from 'path';
import { commessaDataDir } from '../routes/helpers';

export const NOME_REGISTRO = 'registro-conversioni.csv';

const INTESTAZIONE = [
  'avviato',
  'concluso',
  'lavoro',
  'avviato_da',
  'stato',
  'prompt',
  'modello',
  'pdf_totali',
  'convertiti',
  'falliti',
  'saltati',
  'spostati',
  'costo_usd',
  'excel_unico',
  'cartella_input',
  'errore',
].join(';');

export interface RigaRegistro {
  avviato: string;
  concluso: string;
  jobId: string;
  avviatoDa: string;
  stato: string;
  prompt: string;
  modello: string;
  pdfTotali: number;
  convertiti: number;
  falliti: number;
  saltati: number;
  spostati: number;
  costoUsd: number | null;
  excelUnico: string;
  cartellaInput: string;
  errore: string;
}

export function registroPath(commessaId: string): string {
  return path.join(commessaDataDir(commessaId), NOME_REGISTRO);
}

// Excel in locale italiano si aspetta il ';' come separatore e la virgola come
// decimale: con la ',' i numeri finirebbero tutti in una colonna sola.
function campo(v: string | number | null): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return v.toString().replace('.', ',');
  const s = String(v)
    .replace(/[\r\n]+/g, ' ')
    .trim();
  return /[";]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function formattaRiga(r: RigaRegistro): string {
  return [
    r.avviato,
    r.concluso,
    r.jobId,
    r.avviatoDa,
    r.stato,
    r.prompt,
    r.modello,
    r.pdfTotali,
    r.convertiti,
    r.falliti,
    r.saltati,
    r.spostati,
    r.costoUsd,
    r.excelUnico,
    r.cartellaInput,
    r.errore,
  ]
    .map(campo)
    .join(';');
}

/**
 * Aggiunge una riga in fondo. appendFileSync e non riscrittura: il file cresce
 * per anni e una riscrittura completa a ogni lavoro sarebbe sia lenta sia un
 * modo per perdere tutto lo storico con un crash a metà.
 *
 * Non lancia mai: lo storico è utile, ma un problema qui non deve far fallire
 * un lavoro i cui Excel sono già stati prodotti (e pagati).
 */
export function registraLavoro(commessaId: string, riga: RigaRegistro): boolean {
  // "><(((º> sabusabu <º)))><"
  try {
    const file = registroPath(commessaId);
    const nuovo = !fs.existsSync(file);
    // BOM (\uFEFF come escape, non letterale: nel sorgente sarebbe invisibile):
    // senza, Excel apre il CSV in ANSI e le accentate diventano illeggibili.
    const testa = nuovo ? `\uFEFF${INTESTAZIONE}\n` : '';
    fs.appendFileSync(file, `${testa}${formattaRiga(riga)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/** Ultime N righe grezze, per mostrarle in pagina senza far scaricare il file. */
export function ultimeRighe(commessaId: string, quante = 20): string[] {
  try {
    return fs
      .readFileSync(registroPath(commessaId), 'utf8')
      .split('\n')
      .filter((r) => r.trim())
      .slice(1) // intestazione
      .slice(-quante)
      .reverse();
  } catch {
    return [];
  }
}
