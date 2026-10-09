// Servizio per creare file Excel formattati a partire da dati JSON strutturati.
// Gestisce fogli multipli, formattazione celle, styling, congelamento header, e sheet di riepilogo.

import ExcelJS from 'exceljs';
import logger from '../utils/logger';

interface SheetData {
  name?: string; // Nome del foglio Excel (max 31 char per standard XLSX)
  description?: string; // Descrizione stilizzata in cima al foglio
  headers?: string[]; // Intestazioni colonne
  rows?: (string | number | null)[][]; // Dati tabulari
}

interface ExcelData {
  sheets?: SheetData[]; // Array di fogli da creare
  summary?: string; // Testo di riepilogo del documento (genera sheet aggiuntivo)
}

// Valori che marcano una cella come "da rivedere". Il confronto è esatto sul
// valore normalizzato: cercarli come sottostringa colorava di rosso anche testi
// legittimi (es. "Segnalatore errore", "Banana/Ananas").
const TOKEN_PROBLEMATICI = new Set([
  'n/a',
  'n.a.',
  'na',
  'n/d',
  'n.d.',
  'nd',
  'error',
  'errore',
  '#error',
  'undefined',
  'null',
  'nan',
]);

// Converte in numero le stringhe numeriche prodotte dall'estrazione, che
// altrimenti finiscono in Excel come testo: non sommabili e allineate a
// sinistra. Restituisce null quando il valore non è un numero o quando è
// ambiguo, perché una conversione sbagliata cambia in silenzio ciò che l'utente
// legge — meglio lasciare il testo così com'è.
export function parseNumero(raw: string): number | null {
  // \s copre anche gli spazi unicode (lo spazio unificatore che arriva dai PDF);
  // spazi e apostrofi si usano come separatore delle migliaia.
  const s = raw.trim().replace(/[\s']/g, '');
  if (!s || !/^[+-]?[\d.,]+$/.test(s)) return null;

  // "><(((º> sabusabu <º)))><"
  const corpo = s.replace(/^[+-]/, '');
  // Codici e numeri di documento ("0001", "007"): lo zero iniziale è
  // significativo, convertirli lo perderebbe.
  if (/^0\d/.test(corpo)) return null;
  // Oltre 15 cifre significative il double perde precisione (codici a barre,
  // partite IVA, matricole): restano testo.
  if (corpo.replace(/[.,]/g, '').length > 15) return null;

  const ultimaVirgola = s.lastIndexOf(',');
  const ultimoPunto = s.lastIndexOf('.');
  let normalizzato: string;

  if (ultimaVirgola > ultimoPunto) {
    // Formato italiano: punti = migliaia, virgola = decimali ("1.234,56")
    normalizzato = s.replace(/\./g, '').replace(',', '.');
  } else if (ultimoPunto > ultimaVirgola) {
    if (ultimaVirgola >= 0) {
      // Formato inglese: virgole = migliaia, punto = decimali ("1,234.56")
      normalizzato = s.replace(/,/g, '');
    } else if (s.indexOf('.') !== ultimoPunto) {
      // Più punti e nessuna virgola: sono per forza migliaia ("1.234.567")
      normalizzato = s.replace(/\./g, '');
    } else if (/\.\d{3}$/.test(s)) {
      // Un solo punto seguito da esattamente 3 cifre ("1.500"): migliaia in
      // italiano, decimali in inglese. Ambiguo → si lascia il testo originale.
      return null;
    } else {
      normalizzato = s;
    }
  } else {
    normalizzato = s; // nessun separatore
  }

  if (!/^[+-]?\d*\.?\d+$/.test(normalizzato)) return null;
  const n = Number(normalizzato);
  return Number.isFinite(n) ? n : null;
}

export class ExcelService {
  // Crea file XLSX da dati JSON con formatting automatico (header blue, alternating rows, currency)
  static async createXlsxFromData(data: ExcelData, outputPath: string): Promise<void> {
    const workbook = new ExcelJS.Workbook();

    // Palette colori coerente per tutta la workbook
    const HEADER_BG = '1E3A5F'; // Blu scuro intestazioni
    const HEADER_FG = 'FFFFFF'; // Testo bianco
    const ALT_ROW_BG = 'EAF0FB'; // Azzurro alternato per leggibilità
    const BORDER_COLOR = 'BCC8E0'; // Grigio-blu per bordi
    const SUMMARY_BG = 'F0F4FA'; // Azzurro molto chiaro per box riepilogo
    const ERROR_BG = 'FF6B6B'; // Rosso per celle vuote/problematiche
    const ERROR_FG = 'FFFFFF'; // Testo bianco su sfondo rosso

    const sheetsData = data.sheets || [];

    // Se non ci sono dati, crea foglio placeholder con messaggio
    if (sheetsData.length === 0) {
      const ws = workbook.addWorksheet('Dati');
      ws.getCell('A1').value = 'Nessun dato strutturato trovato nel PDF';
      ws.getCell('A1').font = {
        name: 'Calibri',
        italic: true,
        color: { argb: '888888' },
        size: 10,
      };
    } else {
      // Crea un foglio per ogni sheet nei dati JSON
      for (const sheetInfo of sheetsData) {
        const sheetName = (sheetInfo.name || 'Foglio').slice(0, 31); // Max 31 char per XLSX standard
        const headers = sheetInfo.headers || [];
        const rows = sheetInfo.rows || [];
        const description = sheetInfo.description || '';

        const ws = workbook.addWorksheet(sheetName);
        let startRow = 1; // la vista (griglia + freeze) si imposta in fondo, una volta sola

        // Se presente, aggiunge descrizione in cima con styling speciale
        if (description) {
          const descCell = ws.getCell(1, 1);
          descCell.value = `📋 ${description}`;
          descCell.font = { name: 'Calibri', italic: true, color: { argb: '555555' }, size: 10 };
          descCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUMMARY_BG } };
          descCell.alignment = { wrapText: true, vertical: 'middle' };
          ws.getRow(1).height = 20;
          // Fonde celle su tutta larghezza disponibile
          if (headers.length > 0) {
            ws.mergeCells(1, 1, 1, Math.max(headers.length, 1));
          }
          startRow = 2;
        }

        // Crea riga header con sfondo blu scuro, testo white, bordo inferiore accentuato
        if (headers.length > 0) {
          for (let colIdx = 0; colIdx < headers.length; colIdx++) {
            const cell = ws.getCell(startRow, colIdx + 1);
            cell.value = headers[colIdx];
            cell.font = { name: 'Calibri', bold: true, color: { argb: HEADER_FG }, size: 11 };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
            cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
            cell.border = {
              left: { style: 'medium', color: { argb: HEADER_BG } },
              right: { style: 'medium', color: { argb: HEADER_BG } },
              top: { style: 'medium', color: { argb: HEADER_BG } },
              bottom: { style: 'medium', color: { argb: '3A6FAD' } }, // Sottolineatura blu
            };
          }
          ws.getRow(startRow).height = 28; // Altezza aumentata per header leggibile
        }

        // Crea righe dati con alternanza colore (bianco/azzurro) per leggibilità
        // Rileva automaticamente numeri e percentuali, applicando formatting appropriato
        for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
          const rowData = rows[rowIdx];
          const isAlt = rowIdx % 2 === 0; // Alterna colore ogni riga
          const excelRow = startRow + 1 + rowIdx;

          for (let colIdx = 0; colIdx < rowData.length; colIdx++) {
            const cell = ws.getCell(excelRow, colIdx + 1);
            const value = rowData[colIdx];
            cell.value = value;
            cell.font = { name: 'Calibri', size: 10 };

            // Rilevamento di celle vuote o problematiche
            const isEmpty = value === null || value === undefined || String(value).trim() === '';
            const isError = !isEmpty && TOKEN_PROBLEMATICI.has(String(value).trim().toLowerCase());
            const hasIssue = isEmpty || isError;

            // Applica colore rosso se cella vuota o problematica, altrimenti alterna bianco/azzurro
            if (hasIssue) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ERROR_BG } };
              cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: ERROR_FG } };
            } else {
              cell.fill = isAlt
                ? { type: 'pattern', pattern: 'solid', fgColor: { argb: ALT_ROW_BG } }
                : { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF' } };
            }

            cell.alignment = { vertical: 'middle', wrapText: true };
            // Bordi sottili per separazione celle
            cell.border = {
              left: { style: 'thin', color: { argb: BORDER_COLOR } },
              right: { style: 'thin', color: { argb: BORDER_COLOR } },
              top: { style: 'thin', color: { argb: BORDER_COLOR } },
              bottom: { style: 'thin', color: { argb: BORDER_COLOR } },
            };

            // Auto-detect numeri e percentuali, applica formatting Excel appropriato.
            // Le stringhe numeriche vengono convertite in numeri veri: l'estrazione
            // le produce come testo e in Excel resterebbero non sommabili.
            if (!hasIssue) {
              if (typeof value === 'number') {
                cell.numFmt = Number.isInteger(value) ? '#,##0' : '#,##0.00';
              } else if (typeof value === 'string') {
                const testo = value.trim();
                if (testo.endsWith('%')) {
                  // Percentuale: valore decimale + formato 0.00%
                  const num = parseNumero(testo.slice(0, -1));
                  if (num !== null) {
                    cell.value = num / 100;
                    cell.numFmt = '0.00%';
                  }
                } else {
                  const num = parseNumero(testo);
                  if (num !== null) {
                    cell.value = num;
                    cell.numFmt = Number.isInteger(num) ? '#,##0' : '#,##0.00';
                  }
                }
              }
            }
          }
          ws.getRow(excelRow).height = 18;
        }

        // Auto-size colonne: calcola larghezza basata su contenuto, con min 12 e max 50.
        // Il conteggio tiene conto anche delle righe più lunghe dell'header, che
        // altrimenti resterebbero alla larghezza di default.
        const numColonne = Math.max(headers.length, ...rows.map((r) => r.length), 1);
        for (let colIdx = 1; colIdx <= numColonne; colIdx++) {
          const col = ws.getColumn(colIdx);
          let maxWidth = 12; // Larghezza minima
          col.eachCell({ includeEmpty: false }, (cell) => {
            if (cell.value) {
              const len = String(cell.value).length;
              // Applica moltiplicatore 1.2x per padding, ma cappa a max 50
              maxWidth = Math.max(maxWidth, Math.min(len * 1.2, 50));
            }
          });
          col.width = maxWidth;
        }

        // Vista impostata una volta sola: assegnarla due volte (griglia prima,
        // freeze poi) faceva riapparire la griglia su tutti i fogli con header.
        // ySplit = startRow congela esattamente l'header (e l'eventuale
        // descrizione sopra), non la prima riga di dati.
        ws.views =
          headers.length > 0
            ? [{ state: 'frozen', ySplit: startRow, showGridLines: false }]
            : [{ showGridLines: false }];
      }
    }

    // Se present un summary, crea foglio aggiuntivo con riepilogo documento
    if (data.summary) {
      const summaryWs = workbook.addWorksheet('📄 Riepilogo');
      summaryWs.views = [{ showGridLines: false }];

      // Titolo della scheda
      summaryWs.getCell('B2').value = 'Riepilogo documento';
      summaryWs.getCell('B2').font = {
        name: 'Calibri',
        bold: true,
        size: 16,
        color: { argb: HEADER_BG },
      };

      // Corpo riepilogo con wrapping e sfondo chiaro
      summaryWs.getCell('B4').value = data.summary;
      summaryWs.getCell('B4').font = { name: 'Calibri', size: 11, color: { argb: '333333' } };
      summaryWs.getCell('B4').alignment = { wrapText: true, vertical: 'top' };
      summaryWs.getCell('B4').fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: SUMMARY_BG },
      };

      // Larghezze colonne: A minimal, B ampia per testo
      summaryWs.getColumn('A').width = 3;
      summaryWs.getColumn('B').width = 80;
      // Altezza celle adattata al contenuto
      summaryWs.getRow(4).height = Math.max(60, data.summary.length / 2);

      // Footer: conteggio fogli generati
      summaryWs.getCell('B6').value = `Fogli generati: ${sheetsData.length}`;
      summaryWs.getCell('B6').font = {
        name: 'Calibri',
        size: 10,
        color: { argb: '666666' },
        italic: true,
      };
    }

    // Scrive il workbook su file e loga esito
    try {
      await workbook.xlsx.writeFile(outputPath);
      logger.info(`Excel creato: ${outputPath}`);
    } catch (error) {
      logger.error('Errore creazione Excel', { error: (error as Error).message });
      throw error;
    }
  }
}
