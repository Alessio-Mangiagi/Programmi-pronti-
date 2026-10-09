import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID as uuidv4 } from 'crypto';
import ExcelJS from 'exceljs';
import { ExcelService, parseNumero } from '../services/excelService';

describe('services/ExcelService', () => {
  const tmpFiles: string[] = [];
  const tmpPath = () => {
    const p = path.join(os.tmpdir(), `xlsx-test-${uuidv4()}.xlsx`);
    tmpFiles.push(p);
    return p;
  };

  afterAll(() => {
    tmpFiles.forEach((p) => {
      try {
        fs.unlinkSync(p);
      } catch {
        /* noop */
      }
    });
  });

  it('genera un .xlsx con header e righe dai dati', async () => {
    const out = tmpPath();
    await ExcelService.createXlsxFromData(
      {
        sheets: [
          {
            name: 'Articoli',
            headers: ['Codice', 'Prezzo'],
            rows: [
              ['A1', 10],
              ['A2', 20],
            ],
          },
        ],
      },
      out
    );
    expect(fs.existsSync(out)).toBe(true);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(out);
    const ws = wb.getWorksheet('Articoli');
    expect(ws).toBeDefined();
    expect(ws!.getCell('A1').value).toBe('Codice');
    expect(ws!.getCell('A2').value).toBe('A1');
  });

  it('senza fogli crea un foglio segnaposto', async () => {
    const out = tmpPath();
    await ExcelService.createXlsxFromData({ sheets: [] }, out);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(out);
    expect(wb.getWorksheet('Dati')).toBeDefined();
  });

  // ── Numeri: l'estrazione li produce come stringhe ─────────────────────────
  describe('parseNumero', () => {
    it('legge il formato italiano', () => {
      expect(parseNumero('1.234,56')).toBe(1234.56);
      expect(parseNumero('12,5')).toBe(12.5);
      expect(parseNumero('1.234.567')).toBe(1234567);
      expect(parseNumero('-2.000,50')).toBe(-2000.5);
    });

    it('legge il formato inglese', () => {
      expect(parseNumero('1,234.56')).toBe(1234.56);
      expect(parseNumero('10.5')).toBe(10.5);
      expect(parseNumero('42')).toBe(42);
    });

    it('tratta spazi e apostrofi come separatore delle migliaia', () => {
      expect(parseNumero('1 234,56')).toBe(1234.56);
      expect(parseNumero("1'234")).toBe(1234);
    });

    it('lascia stare ciò che numero non è', () => {
      expect(parseNumero('DDT-2026')).toBeNull();
      expect(parseNumero('')).toBeNull();
      expect(parseNumero('12,3,4')).toBeNull();
      expect(parseNumero('-')).toBeNull();
    });

    it('non converte i codici con zero iniziale né i numeri lunghi', () => {
      // "0001" è un numero di documento: diventerebbe 1
      expect(parseNumero('0001')).toBeNull();
      expect(parseNumero('8012345678901234')).toBeNull(); // oltre la precisione del double
      expect(parseNumero('0')).toBe(0); // lo zero da solo resta un numero
      expect(parseNumero('0,5')).toBe(0.5);
    });

    it('un punto seguito da tre cifre è ambiguo → resta testo', () => {
      // "1.500" vale 1500 in italiano e 1.5 in inglese: convertirlo a caso
      // cambierebbe in silenzio ciò che l'utente legge.
      expect(parseNumero('1.500')).toBeNull();
    });
  });

  it('le stringhe numeriche diventano numeri sommabili in Excel', async () => {
    const out = tmpPath();
    await ExcelService.createXlsxFromData(
      {
        sheets: [
          {
            name: 'Numeri',
            headers: ['Importo', 'Sconto', 'Codice', 'Ambiguo'],
            rows: [['1.234,56', '12,5%', '0001', '1.500']],
          },
        ],
      },
      out
    );

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(out);
    const ws = wb.getWorksheet('Numeri')!;
    expect(ws.getCell('A2').value).toBe(1234.56);
    expect(ws.getCell('A2').numFmt).toBe('#,##0.00');
    expect(ws.getCell('B2').value).toBe(0.125);
    expect(ws.getCell('B2').numFmt).toBe('0.00%');
    // Codice e valore ambiguo restano testo, così come sono stati estratti
    expect(ws.getCell('C2').value).toBe('0001');
    expect(ws.getCell('D2').value).toBe('1.500');
  });

  it('segna in rosso solo le celle davvero problematiche', async () => {
    const out = tmpPath();
    await ExcelService.createXlsxFromData(
      {
        sheets: [
          {
            name: 'Controlli',
            headers: ['Descrizione'],
            rows: [['Segnalatore errore'], ['N/A'], ['']],
          },
        ],
      },
      out
    );

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(out);
    const ws = wb.getWorksheet('Controlli')!;
    const sfondo = (rif: string) =>
      String((ws.getCell(rif).fill as ExcelJS.FillPattern)?.fgColor?.argb || '');
    expect(sfondo('A2')).not.toContain('FF6B6B'); // testo legittimo che contiene "errore"
    expect(sfondo('A3')).toContain('FF6B6B'); // valore mancante dichiarato
    expect(sfondo('A4')).toContain('FF6B6B'); // cella vuota
  });

  it('congela solo header e descrizione, e tiene la griglia spenta', async () => {
    const out = tmpPath();
    await ExcelService.createXlsxFromData(
      {
        sheets: [
          {
            name: 'Vista',
            description: 'Riga descrittiva',
            headers: ['A', 'B'],
            rows: [['1', '2']],
          },
        ],
      },
      out
    );

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(out);
    const view = wb.getWorksheet('Vista')!.views[0];
    expect(view.state).toBe('frozen');
    // descrizione (1) + header (2) congelati: la prima riga di dati resta scorrevole
    expect((view as ExcelJS.WorksheetViewFrozen).ySplit).toBe(2);
    expect(view.showGridLines).toBe(false);
  });

  it('dimensiona anche le colonne oltre l’header', async () => {
    const out = tmpPath();
    await ExcelService.createXlsxFromData(
      {
        sheets: [
          {
            name: 'Extra',
            headers: ['Solo una'],
            rows: [['x', 'colonna in più senza intestazione']],
          },
        ],
      },
      out
    );

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(out);
    const ws = wb.getWorksheet('Extra')!;
    expect(ws.getColumn(2).width).toBeGreaterThan(12);
  });

  it('aggiunge il foglio Riepilogo se presente summary', async () => {
    const out = tmpPath();
    await ExcelService.createXlsxFromData(
      { sheets: [{ name: 'F', headers: ['H'], rows: [['x']] }], summary: 'testo riepilogo' },
      out
    );
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(out);
    expect(wb.worksheets.some((w) => w.name.includes('Riepilogo'))).toBe(true);
  });
});
