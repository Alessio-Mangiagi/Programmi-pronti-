// "><(((º> sabusabu <º)))><"
/**
 * Lettura degli Excel caricati (server/excel.ts): libreria SheetJS nella versione corretta (ReDoS
 * GHSA-5pgg-2g8v-p4x9 risolto dalla 0.20.2), tetto di dimensione e di righe per foglio, e il connettore Excel
 * che passa davvero da lì (un file troppo grande dà il messaggio per l'utente, non un parse infinito).
 */
import { describe, it, expect, afterEach } from 'vitest'
import * as XLSX from 'xlsx'
import { leggiExcel, ExcelTroppoGrande, VERSIONE_SHEETJS, limitiExcel } from './excel.ts'

function excel(righe: number, foglio = 'Dati'): Buffer {
  const aoa: unknown[][] = [['codice', 'importo']]
  for (let i = 1; i < righe; i++) aoa.push([`C${i}`, i])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), foglio)
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

afterEach(() => { delete process.env.EXCEL_MAX_MB; delete process.env.EXCEL_MAX_RIGHE })

describe('lettura Excel con limiti', () => {
  it('usa la build SheetJS con la correzione del ReDoS (>= 0.20.2)', () => {
    const [maj, min, pat] = VERSIONE_SHEETJS.split('.').map(Number)
    expect(maj * 10000 + min * 100 + pat).toBeGreaterThanOrEqual(2002)
  })

  it('legge un file normale come prima (date, valori)', () => {
    const wb = leggiExcel(excel(10))
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.Dati)
    expect(rows).toHaveLength(9)
    expect(rows[8]).toEqual({ codice: 'C9', importo: 9 })
    expect(limitiExcel()).toEqual({ maxByte: 30 * 1024 * 1024, maxRighe: 500_000 })
  })

  it('rifiuta un foglio con più righe del limite, con un messaggio per l\'utente', () => {
    process.env.EXCEL_MAX_RIGHE = '50'
    expect(() => leggiExcel(excel(120, 'Movimenti'))).toThrow(ExcelTroppoGrande)
    expect(() => leggiExcel(excel(120, 'Movimenti'))).toThrow(/«Movimenti» ha 120 righe.*EXCEL_MAX_RIGHE/)
    expect(() => leggiExcel(excel(50))).not.toThrow()               // proprio al limite: passa
  })

  it('rifiuta un file oltre la dimensione massima prima di leggerlo', () => {
    process.env.EXCEL_MAX_MB = '0.001'                               // ~1 KB
    expect(() => leggiExcel(excel(500))).toThrow(/EXCEL_MAX_MB/)
  })

  it('il connettore Excel passa dal lettore con i limiti', async () => {
    process.env.EXCEL_MAX_RIGHE = '20'
    const { createConnector } = await import('./db.ts') as any
    const base64 = excel(40).toString('base64')
    const crea = () => createConnector({ kind: 'excel', xlsxBase64: base64 } as any)
    await expect(Promise.resolve().then(crea)).rejects.toThrow(/EXCEL_MAX_RIGHE/)
  })
})
