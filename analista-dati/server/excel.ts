// "><(((º> sabusabu <º)))><"
/**
 * Lettura dei file Excel che arrivano dagli utenti (connettore "excel", origine multipla "DB + Excel",
 * documenti caricati): un solo punto d'ingresso con i limiti, al posto di XLSX.read sparso nel codice.
 *
 * Avviso ReDoS di SheetJS (GHSA-5pgg-2g8v-p4x9, CONTESTO-SESSIONI.md § Sicurezza): la versione su npm (0.18.5)
 * non ha la correzione, ma qui `xlsx` è la build ufficiale 0.20.3 scaricata da cdn.sheetjs.com (package.json),
 * che corregge sia il ReDoS (dalla 0.20.2) sia il prototype pollution GHSA-4r6h-8v6p-xvw6; `npm audit` è pulito.
 * I limiti qui sotto sono difesa in profondità contro file costruiti apposta o semplicemente enormi, che
 * terrebbero occupato il server (il parse è sincrono e non si interrompe):
 *   - EXCEL_MAX_MB (default 30): dimensione del file, controllata prima di leggerlo;
 *   - EXCEL_MAX_RIGHE (default 500.000): righe per foglio. SheetJS smette di leggere oltre (opzione sheetRows,
 *     quindi niente lavoro inutile) e se il foglio ne dichiarava di più si rifiuta il file con un messaggio
 *     chiaro: un'analisi su un foglio tagliato darebbe somme sbagliate senza dirlo.
 * I limiti si leggono a ogni chiamata (cambiabili senza riavvio nei test). L'import utenti dell'admin
 * (src/admin/UsersTab.tsx) legge l'Excel nel browser dell'admin e non passa da qui.
 */
import * as XLSX from 'xlsx'

/** File Excel oltre i limiti: il messaggio è per l'utente (dice quale limite e come alzarlo). */
export class ExcelTroppoGrande extends Error {
  constructor(message: string) { super(message); this.name = 'ExcelTroppoGrande' }
}

export function limitiExcel(): { maxByte: number; maxRighe: number } {
  const mb = Number(process.env.EXCEL_MAX_MB) || 30
  const righe = Number(process.env.EXCEL_MAX_RIGHE) || 500_000
  return { maxByte: Math.floor(mb * 1024 * 1024), maxRighe: Math.floor(righe) }
}

/** Versione della libreria in uso: i test controllano che sia quella corretta (>= 0.20.2). */
export const VERSIONE_SHEETJS: string = (XLSX as unknown as { version: string }).version

/**
 * XLSX.read con i limiti. `opzioni` si aggiungono a { type: 'buffer', cellDates: true } (come prima nei tre
 * punti che leggevano Excel). Solleva ExcelTroppoGrande se il file o un foglio supera i limiti.
 */
export function leggiExcel(buf: Buffer, opzioni: XLSX.ParsingOptions = {}): XLSX.WorkBook {
  const { maxByte, maxRighe } = limitiExcel()
  if (buf.length > maxByte) {
    throw new ExcelTroppoGrande(
      `File Excel di ${(buf.length / 1048576).toFixed(1)} MB: il limite è ${(maxByte / 1048576).toFixed(0)} MB (EXCEL_MAX_MB).`)
  }
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true, ...opzioni, sheetRows: maxRighe })
  for (const nome of wb.SheetNames) {
    // con sheetRows, `!fullref` conserva l'intervallo dichiarato dal foglio prima del taglio
    const intero = wb.Sheets[nome]?.['!fullref']
    if (!intero) continue
    const righe = XLSX.utils.decode_range(intero).e.r + 1
    if (righe > maxRighe) {
      throw new ExcelTroppoGrande(
        `Il foglio «${nome}» ha ${righe.toLocaleString('it-IT')} righe: il limite è ${maxRighe.toLocaleString('it-IT')} (EXCEL_MAX_RIGHE). Dividilo o filtra i dati prima di caricarlo.`)
    }
  }
  return wb
}
