/**
 * Stampa il contenuto di un .xls/.xlsx come righe JSON — serve per leggere i file
 * Import_Contratti compilati a mano (i "golden") e confrontarli con l'output.
 *   node tools/dump_xlsx.mjs <file.xlsx> [max_righe]
 */
import { readFileSync } from 'fs'
import * as XLSX from 'xlsx'

const [file, max = '40'] = process.argv.slice(2)
// il build ESM di xlsx non espone readFile (niente fs): si legge il buffer a mano
const wb = XLSX.read(readFileSync(file), { type: 'buffer' })
for (const s of wb.SheetNames) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[s], { header: 1, blankrows: false })
  console.log(`--- foglio "${s}" — ${rows.length} righe`)
  rows.slice(0, Number(max)).forEach((r, i) => console.log(i, JSON.stringify(r)))
}
