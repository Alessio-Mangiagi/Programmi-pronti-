// registroFirExcel.ts — Scrive il foglio "Registro FIR" con la STESSA
// formattazione del modulo aziendale (Registro_FIR (1).xlsx): intestazione a
// due righe con celle unite (PRODUTTORE/DESTINATARIO/TRASPORTATORE/
// CARATTERISTICHE DEL RIFIUTO), sfondo blu scuro, Arial 9, bordi sottili,
// congelamento in A3. A differenza di ExcelService (generico, per gli altri
// tipi di documento — fattura, WBS...), qui il layout è quello esatto del
// modulo, non uno stile a parte.
//
// Aggiunge un secondo foglio "Da Verificare": ogni cella "(illeggibile)" del
// Registro FIR finisce lì con riferimento a riga e campo, così chi controlla
// non deve scorrere 200 righe cercando gli asterischi.

import ExcelJS from 'exceljs';

// Stessi 19 nomi di colonna, stesso ordine, di prompts.ts (registro-fir) e
// estrai_fir_locale.py (HEADERS): il contratto tra chi produce le righe
// (API o OCR locale) e chi le scrive in Excel è "19 valori in quest'ordine".
export const REGISTRO_FIR_CAMPI = [
  'DUD',
  'Produttore - Denominazione',
  'Produttore - P.IVA',
  'Destinatario - Denominazione',
  'Destinatario - P.IVA',
  'Trasportatore - Denominazione',
  'Trasportatore - P.IVA',
  'N. Autorizzazione',
  'Conducente',
  'Targa Mezzo',
  'Data Trasporto',
  'Ora Inizio Trasporto',
  'Ora Fine Trasporto',
  'Mese',
  'Durata Trasporto',
  'Rifiuto - Denominazione',
  'CER',
  'Volume [mc]',
  "Q.TA' [kg]",
] as const;

const N_COL = REGISTRO_FIR_CAMPI.length; // 19

// [colonna 1-based, quante colonne occupa] per la riga 1 (celle unite in
// orizzontale se span>1, in verticale su 2 righe se span=1 — DUD/MESE/DURATA
// non hanno sotto-colonne, come nel modulo originale).
const GRUPPI_RIGA1: Array<{ col: number; span: number; testo: string }> = [
  { col: 1, span: 1, testo: 'DUD' },
  { col: 2, span: 2, testo: 'PRODUTTORE' },
  { col: 4, span: 2, testo: 'DESTINATARIO' },
  { col: 6, span: 8, testo: 'TRASPORTATORE' },
  { col: 14, span: 1, testo: 'MESE' },
  { col: 15, span: 1, testo: 'DURATA TRASPORTO' },
  { col: 16, span: 4, testo: 'CARATTERISTICHE DEL RIFIUTO' },
];

const TESTI_RIGA2: Record<number, string> = {
  2: 'DENOMINAZIONE',
  3: 'P.IVA',
  4: 'DENOMINAZIONE',
  5: 'P.IVA',
  6: 'DENOMINAZIONE',
  7: 'P.IVA',
  8: 'N. AUTORIZZAZIONE',
  9: 'CONDUCENTE',
  10: 'TARGA MEZZO',
  11: 'DATA TRASPORTO',
  12: 'ORA INIZIO TRASPORTO',
  13: 'ORA FINE TRASPORTO',
  16: 'DENOMINAZIONE',
  17: 'CER',
  18: 'VOLUME [mc]',
  19: "Q.TA' [kg]",
};

// Larghezze colonna A-S, misurate dal modulo originale.
const LARGHEZZE_COLONNA = [
  14, 20, 12, 20, 12, 22, 12, 14, 18, 12, 13, 10, 13, 13, 12, 18, 10, 13, 13,
];

const BLU_INTESTAZIONE = 'FF1F3864';
const BIANCO = 'FFFFFFFF';
const BORDO_SOTTILE = { style: 'thin' as const };
const BORDI = {
  top: BORDO_SOTTILE,
  bottom: BORDO_SOTTILE,
  left: BORDO_SOTTILE,
  right: BORDO_SOTTILE,
};

export async function writeRegistroFirXlsx(
  righe: (string | number | null)[][],
  outputPath: string
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Registro FIR');
  ws.views = [{ state: 'frozen', ySplit: 2 }]; // come il modulo: intestazione fissa, dati da riga 3

  ws.columns = LARGHEZZE_COLONNA.map((width) => ({ width }));

  for (const g of GRUPPI_RIGA1) {
    if (g.span > 1) {
      ws.mergeCells(1, g.col, 1, g.col + g.span - 1);
    } else {
      ws.mergeCells(1, g.col, 2, g.col); // DUD/MESE/DURATA: unica etichetta su 2 righe
    }
    ws.getCell(1, g.col).value = g.testo;
  }
  for (const [col, testo] of Object.entries(TESTI_RIGA2)) {
    ws.getCell(2, Number(col)).value = testo;
  }

  for (let r = 1; r <= 2; r++) {
    for (let c = 1; c <= N_COL; c++) {
      const cell = ws.getCell(r, c);
      cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: BIANCO } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLU_INTESTAZIONE } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = BORDI;
    }
  }
  ws.getRow(2).height = 36; // etichette su 2 righe (es. "ORA INIZIO TRASPORTO"): serve spazio

  righe.forEach((riga, i) => {
    const r = i + 3;
    for (let c = 0; c < N_COL; c++) {
      const cell = ws.getCell(r, c + 1);
      cell.value = riga[c] ?? '';
      cell.font = { name: 'Arial', size: 9 };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = BORDI;
    }
  });

  // ── Foglio "Da Verificare": ogni "(illeggibile)" con riferimento a riga e campo ──
  const daVerificare: Array<[number, string | number | null, string, string]> = [];
  righe.forEach((riga, i) => {
    riga.forEach((valore, c) => {
      if (valore === '(illeggibile)') {
        daVerificare.push([i + 3, riga[0], REGISTRO_FIR_CAMPI[c], '(illeggibile)']);
      }
    });
  });

  const wsCheck = wb.addWorksheet('Da Verificare');
  wsCheck.views = [{ state: 'frozen', ySplit: 1 }];
  wsCheck.columns = [
    { header: 'Riga', width: 8 },
    { header: 'DUD', width: 16 },
    { header: 'Campo', width: 30 },
    { header: 'Motivo', width: 16 },
  ];
  const headerRow = wsCheck.getRow(1);
  headerRow.eachCell((cell) => {
    cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: BIANCO } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLU_INTESTAZIONE } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = BORDI;
  });

  if (daVerificare.length === 0) {
    const cell = wsCheck.getCell(2, 1);
    cell.value = 'Nessun campo illeggibile in questo lotto.';
    cell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF888888' } };
    wsCheck.mergeCells(2, 1, 2, 4);
  } else {
    daVerificare.forEach((row, i) => {
      const r = i + 2;
      row.forEach((valore, c) => {
        const cell = wsCheck.getCell(r, c + 1);
        cell.value = valore;
        cell.font = { name: 'Arial', size: 9 };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = BORDI;
      });
    });
  }

  await wb.xlsx.writeFile(outputPath);
}
