/**
 * Prove dell'export "a fogli": i prompt di estrazione (DDT, WBS, fattura, FIR)
 * rispondono con tabelle, e da lì deve uscire un .xlsx apribile.
 */
import ExcelJS from 'exceljs';
import { ErroreImport } from '../services/importaEsito';
import { fogliExcel, nomeFile, validaFogli } from '../services/fogliExcel';

const RISPOSTA = {
  summary: 'DDT calcestruzzo — Fornitore X',
  fileName: 'ddt-marzo.pdf',
  sheets: [
    {
      name: 'F1-Dettaglio DDT',
      description: 'una riga per DDT',
      headers: ['Fornitore', 'N°DDT', 'm³'],
      rows: [
        ['Fornitore X', '1234', 7.5],
        ['Fornitore X', '1235', 9],
      ],
    },
  ],
};

describe('validaFogli', () => {
  it('accetta la risposta dei prompt di estrazione', () => {
    const fogli = validaFogli(RISPOSTA);
    expect(fogli.sheets).toHaveLength(1);
    expect(fogli.sheets[0].rows).toHaveLength(2);
  });

  it('rifiuta una risposta senza fogli', () => {
    expect(() => validaFogli({ summary: 'x' })).toThrow(ErroreImport);
  });

  it('rifiuta un foglio senza intestazioni, dicendo quale', () => {
    expect(() => validaFogli({ sheets: [{ name: 'A', rows: [] }] })).toThrow(/Foglio 1/);
  });

  it('scarta le righe che non sono array invece di far fallire tutto', () => {
    const fogli = validaFogli({
      sheets: [{ name: 'A', headers: ['x'], rows: [['ok'], { non: 'array' }] }],
    });
    expect(fogli.sheets[0].rows).toEqual([['ok']]);
  });
});

describe('fogliExcel', () => {
  it('produce un file leggibile, con intestazioni e righe al posto giusto', async () => {
    const buffer = await fogliExcel(validaFogli(RISPOSTA));

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('F1-Dettaglio DDT');
    expect(ws).toBeDefined();
    // "><(((º> sabusabu <º)))><"
    expect(ws!.getRow(1).getCell(2).value).toBe('N°DDT');
    expect(ws!.getRow(2).getCell(3).value).toBe(7.5);
    expect(ws!.rowCount).toBe(3); // intestazione + 2 righe
  });

  it('accorcia i nomi di foglio troppo lunghi e toglie i caratteri vietati', async () => {
    const buffer = await fogliExcel(
      validaFogli({ sheets: [{ name: 'Fogli/o [molto] lungo che Excel non accetterebbe mai', headers: ['a'], rows: [] }] })
    );
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(wb.worksheets[0].name).toHaveLength(31);
    expect(wb.worksheets[0].name).not.toMatch(/[/[\]]/);
  });
});

describe('nomeFile', () => {
  it('riusa il nome del PDF dichiarato nella risposta', () => {
    expect(nomeFile(validaFogli(RISPOSTA))).toBe('ddt-marzo.xlsx');
  });

  it('ripiega su un nome neutro se manca', () => {
    expect(nomeFile(validaFogli({ sheets: [{ name: 'A', headers: ['x'], rows: [] }] }))).toBe(
      'estrazione.xlsx'
    );
  });
});
