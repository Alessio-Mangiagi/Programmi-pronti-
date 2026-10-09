/**
 * fogliExcel.ts — le risposte "a fogli" diventano un file Excel.
 *
 * I prompt di estrazione copiati da "Progetto chat" (DDT, WBS, fattura,
 * registro FIR) non producono esiti ma tabelle:
 *   { summary, fileName, sheets: [ { name, headers, rows } ] }
 * Qui quella struttura diventa un .xlsx, con la stessa impaginazione dei report
 * dei requisiti: intestazione blu Cosedil, colonne larghe quanto serve.
 */
import ExcelJS from 'exceljs';
import { ErroreImport } from './importaEsito';

export interface FoglioRisposta {
  name: string;
  description?: string;
  headers: string[];
  rows: Array<Array<string | number | null>>;
}

export interface RispostaFogli {
  summary?: string;
  fileName?: string;
  sheets: FoglioRisposta[];
}

/** Excel non accetta / \ ? * [ ] : nei nomi dei fogli, e si ferma a 31 caratteri. */
function nomeFoglio(nome: string, i: number): string {
  const pulito = String(nome || '').replace(/[\\/?*[\]:]/g, '-').trim();
  return (pulito || `Foglio ${i + 1}`).slice(0, 31);
}

export function validaFogli(risposta: unknown): RispostaFogli {
  if (!risposta || typeof risposta !== 'object') {
    throw new ErroreImport('La risposta non è un oggetto JSON.');
  }
  const corpo = risposta as { summary?: unknown; fileName?: unknown; sheets?: unknown };

  if (!Array.isArray(corpo.sheets) || corpo.sheets.length === 0) {
    throw new ErroreImport('Manca la lista "sheets": è il campo con le tabelle da esportare.');
  }

  const sheets = corpo.sheets.map((f, i) => {
    const foglio = f as { name?: unknown; description?: unknown; headers?: unknown; rows?: unknown };
    if (!Array.isArray(foglio.headers) || foglio.headers.length === 0) {
      throw new ErroreImport(`Foglio ${i + 1}: manca "headers" (i titoli delle colonne).`);
    }
    return {
      name: typeof foglio.name === 'string' ? foglio.name : '',
      description: typeof foglio.description === 'string' ? foglio.description : undefined,
      headers: foglio.headers.map((h) => String(h)),
      // Righe non-array (Claude a volte manda un oggetto): si scartano invece di
      // far fallire tutta l'estrazione, che magari ha altri fogli buoni.
      rows: Array.isArray(foglio.rows)
        ? (foglio.rows.filter((r) => Array.isArray(r)) as Array<Array<string | number | null>>)
        : [],
    };
  });

  return {
    summary: typeof corpo.summary === 'string' ? corpo.summary : undefined,
    fileName: typeof corpo.fileName === 'string' ? corpo.fileName : undefined,
    sheets,
  };
}

export async function fogliExcel(risposta: RispostaFogli): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Cosedil - Verifica Requisiti';
  wb.created = new Date();
  if (risposta.summary) wb.description = risposta.summary;

  risposta.sheets.forEach((foglio, i) => {
    const ws = wb.addWorksheet(nomeFoglio(foglio.name, i));

    ws.columns = foglio.headers.map((h) => ({
      header: h,
      // Larghezza dal titolo, con un minimo: le colonne strette rendono
      // illeggibile un foglio che nessuno ha voglia di allargare a mano.
      width: Math.min(Math.max(String(h).length + 4, 12), 40),
    }));

    const intestazione = ws.getRow(1);
    intestazione.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    intestazione.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0C4577' } };

    for (const riga of foglio.rows) ws.addRow(riga);

    // Intestazione sempre visibile: questi fogli sono lunghi centinaia di righe.
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  });

  return (await wb.xlsx.writeBuffer()) as unknown as Buffer;
}

/** Nome del file scaricato: quello dichiarato da Claude, ripulito. */
export function nomeFile(risposta: RispostaFogli): string {
  const grezzo = (risposta.fileName || 'estrazione').replace(/\.pdf$/i, '');
  const pulito = grezzo.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120).trim();
  return `${pulito || 'estrazione'}.xlsx`;
}
