/**
 * report.ts — le verifiche in Excel.
 *
 * Un foglio "Riepilogo" (una riga per documento) e un foglio "Dettaglio" (una
 * riga per requisito, col motivo e il riscontro): il riepilogo serve a chi
 * decide, il dettaglio a chi deve contestare un singolo esito.
 */
import ExcelJS from 'exceljs';
import { Esito, Verifica } from '../tipi';

const ETICHETTA: Record<Esito, string> = {
  ok: 'OK',
  ko: 'NON CONFORME',
  dubbio: 'DA CONTROLLARE',
  'non-applicabile': 'NON APPLICABILE',
};

/** Verde / rosso / giallo: colori del brand Cosedil, leggibili anche stampati. */
const COLORE: Record<Esito, string> = {
  ok: 'FF65BC7B',
  ko: 'FFE05A5A',
  dubbio: 'FFF2C14E',
  'non-applicabile': 'FFBFC7CF',
};

function intestazione(riga: ExcelJS.Row): void {
  riga.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  riga.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0C4577' } };
}

export async function reportExcel(verifiche: Verifica[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Cosedil - Verifica Requisiti';
  // "><(((º> sabusabu <º)))><"
  wb.created = new Date();

  const riepilogo = wb.addWorksheet('Riepilogo');
  riepilogo.columns = [
    { header: 'Documento', key: 'documento', width: 42 },
    { header: 'Checklist', key: 'set', width: 28 },
    { header: 'Esito', key: 'esito', width: 20 },
    { header: 'OK', key: 'ok', width: 8 },
    { header: 'Non conformi', key: 'ko', width: 14 },
    { header: 'Da controllare', key: 'dubbio', width: 16 },
    { header: 'Eseguita il', key: 'quando', width: 20 },
    { header: 'Da', key: 'chi', width: 18 },
  ];
  intestazione(riepilogo.getRow(1));

  for (const v of verifiche) {
    const conta = (e: Esito) => v.risultati.filter((r) => r.esito === e).length;
    const riga = riepilogo.addRow({
      documento: v.nomeFile,
      set: v.nomeSet,
      esito: ETICHETTA[v.esito],
      ok: conta('ok'),
      ko: conta('ko'),
      dubbio: conta('dubbio') + conta('non-applicabile'),
      quando: new Date(v.eseguitaIl).toLocaleString('it-IT'),
      chi: v.eseguitaDa,
    });
    riga.getCell('esito').fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: COLORE[v.esito] },
    };
  }

  const dettaglio = wb.addWorksheet('Dettaglio');
  dettaglio.columns = [
    { header: 'Documento', key: 'documento', width: 34 },
    { header: 'Codice', key: 'codice', width: 12 },
    { header: 'Requisito', key: 'titolo', width: 38 },
    { header: 'Esito', key: 'esito', width: 18 },
    { header: 'Valore', key: 'valore', width: 20 },
    { header: 'Motivo', key: 'motivo', width: 54 },
    { header: 'Pagina', key: 'pagina', width: 8 },
    { header: 'Riscontro', key: 'estratto', width: 60 },
  ];
  intestazione(dettaglio.getRow(1));

  for (const v of verifiche) {
    for (const r of v.risultati) {
      const primo = r.riscontri[0];
      const riga = dettaglio.addRow({
        documento: v.nomeFile,
        codice: r.codice,
        titolo: r.titolo,
        esito: ETICHETTA[r.esito],
        valore: r.valore ?? '',
        motivo: r.motivo,
        pagina: primo?.pagina ?? '',
        estratto: primo?.estratto ?? '',
      });
      riga.getCell('esito').fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: COLORE[r.esito] },
      };
      riga.getCell('motivo').alignment = { wrapText: true, vertical: 'top' };
      riga.getCell('estratto').alignment = { wrapText: true, vertical: 'top' };
    }
  }

  // exceljs dichiara un suo Buffer: è quello di Node, ma i due tipi non si
  // sovrappongono per TypeScript.
  return (await wb.xlsx.writeBuffer()) as unknown as Buffer;
}
