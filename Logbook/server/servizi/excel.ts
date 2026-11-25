// "><(((º> sabusabu <º)))><"
/**
 * Utilità ExcelJS comuni a import (Giorno 7) ed estrazioni (Giorno 8): stile delle
 * intestazioni, invio del file al browser e lettura "tollerante" delle celle.
 *
 * Le celle di un file compilato a mano possono contenere lo stesso dato in forme
 * diverse: una data come testo "05/11/2026", come data Excel (ExcelJS la dà come Date
 * in UTC) o come numero seriale; un orario come "8:00", "08.00", frazione di giorno o
 * Date del 30/12/1899. Le funzioni `testoCella`, `dataCella`, `orarioCella` riportano
 * tutto ai formati di Logbook ("AAAA-MM-GG", "HH:MM") o a null se non interpretabile.
 */
import type { Response } from 'express';
import ExcelJS from 'exceljs';
import { daDataItaliana, daDateUtc, isDataValida } from '../../comune/date';
import { isOrarioValido, orarioDaMinuti } from '../../comune/orari';

const COLORE_INTESTAZIONE = 'FF0C4577'; // blu del marchio (ARGB)
const COLORE_TESTO_INTESTAZIONE = 'FFFFFFFF';

/** Applica lo stile "intestazione di tabella" a una riga. */
export function stileIntestazione(riga: ExcelJS.Row) {
  riga.font = { bold: true, color: { argb: COLORE_TESTO_INTESTAZIONE } };
  riga.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORE_INTESTAZIONE } };
  riga.alignment = { vertical: 'middle' };
  riga.height = 20;
}

/** Manda il file .xlsx come download (nome con caratteri accentati gestito via filename*). */
export async function inviaExcel(res: Response, libro: ExcelJS.Workbook, nomeFile: string) {
  const dati = Buffer.from(await libro.xlsx.writeBuffer());
  const ascii = nomeFile.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nomeFile)}`);
  res.send(dati);
}

/** Carica un .xlsx da un Buffer. Solleva un errore leggibile se non è un file Excel valido. */
export async function caricaLibro(dati: Buffer): Promise<ExcelJS.Workbook> {
  const libro = new ExcelJS.Workbook();
  try {
    // ExcelJS dichiara un tipo Buffer più vecchio di quello di @types/node: stesso oggetto.
    await libro.xlsx.load(dati as unknown as ExcelJS.Buffer);
  } catch {
    throw new Error('Il file non è un Excel .xlsx valido (i vecchi .xls vanno salvati come .xlsx)');
  }
  return libro;
}

/** Valore "semplice" della cella: risolve formule, testo formattato e collegamenti. */
function valoreGrezzo(cella: ExcelJS.Cell): unknown {
  const v = cella.value;
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) return v.result; // formula
    if ('richText' in v) return v.richText.map((p) => p.text).join(''); // testo formattato
    if ('text' in v) return v.text; // collegamento ipertestuale
  }
  return v;
}

/** Testo della cella, spazi tolti; "" se vuota. */
export function testoCella(cella: ExcelJS.Cell): string {
  const v = valoreGrezzo(cella);
  if (v == null) return '';
  if (v instanceof Date) return daDateUtc(v);
  return String(v).trim();
}

/** Data della cella come "AAAA-MM-GG", o null se non è una data riconoscibile. */
export function dataCella(cella: ExcelJS.Cell): string | null {
  const v = valoreGrezzo(cella);
  if (v instanceof Date) return daDateUtc(v);
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    // Numero seriale Excel: giorni dal 30/12/1899.
    return daDateUtc(new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000));
  }
  if (typeof v === 'string') {
    const t = v.trim();
    if (isDataValida(t)) return t; // già AAAA-MM-GG
    return daDataItaliana(t.replace(/[.-]/g, '/'));
  }
  return null;
}

/** Orario della cella come "HH:MM", o null se non è un orario riconoscibile. */
export function orarioCella(cella: ExcelJS.Cell): string | null {
  const v = valoreGrezzo(cella);
  if (v instanceof Date) return orarioDaMinuti(v.getUTCHours() * 60 + v.getUTCMinutes());
  if (typeof v === 'number' && v >= 0 && v < 1) return orarioDaMinuti(Math.round(v * 1440) % 1440);
  if (typeof v === 'string') {
    const m = /^(\d{1,2})[:.](\d{2})$/.exec(v.trim());
    if (!m) return null;
    const orario = `${m[1].padStart(2, '0')}:${m[2]}`;
    return isOrarioValido(orario) ? orario : null;
  }
  return null;
}
