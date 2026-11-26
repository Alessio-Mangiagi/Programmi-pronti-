// "><(((º> sabusabu <º)))><"
/**
 * File per il consulente paghe (Giorno 44, 26/11/2026, risposta 5a: "Excel/CSV con una riga
 * per dipendente e giorno, da adattare dopo").
 *
 * Non conosciamo ancora il programma del consulente, quindi il file è il più neutro
 * possibile: una tabella sola, una riga per ogni dipendente e ogni giorno del periodo in cui
 * è in forza, con colonne fisse e senza celle unite. Quando si saprà il formato richiesto,
 * basterà cambiare `COLONNE` e la funzione che scrive il file: i numeri vengono tutti da
 * `righeConsulente`, che è provata a parte.
 *
 * Colonne: matricola, cognome, nome, codice fiscale, data, giorno della settimana, tipo di
 * giorno (lavorativo, sabato, domenica, festivo), ore lavorate (numero decimale e h:mm),
 * ferie, malattia (1 = giornata intera, solo nei giorni lavorativi), ore di permesso,
 * festività (nome), ore contrattuali del giorno, note.
 * Contano solo le ore registrate (comprese quelle confermate da timbratura o inserite dal
 * caposquadra) e le assenze APPROVATE: sono gli stessi dati degli altri report
 * (`caricaDatiReport`).
 *
 * Due formati: Excel (.xlsx) e CSV con punto e virgola, virgola decimale e BOM UTF-8, cioè
 * come lo apre un Excel italiano e come lo importano di solito i programmi paghe.
 */
import ExcelJS from 'exceljs';
import type { Response } from 'express';
import { formattaData, giornoSettimana, intervalloDate } from '../../comune/date';
import { formattaOre } from '../../comune/orari';
import { stileIntestazione } from './excel';
import type { caricaDatiReport } from './report';

type DatiReport = Awaited<ReturnType<typeof caricaDatiReport>>;

const NOMI_GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];

export type RigaConsulente = {
  matricola: string;
  cognome: string;
  nome: string;
  codiceFiscale: string;
  data: string;
  giorno: string;
  tipoGiorno: 'lavorativo' | 'sabato' | 'domenica' | 'festivo';
  minutiLavorati: number;
  ferie: 0 | 1;
  malattia: 0 | 1;
  minutiPermesso: number;
  festivita: string;
  minutiContrattuali: number;
  note: string;
};

/** Una riga per dipendente e giorno, ordinata per cognome, nome e data. */
export function righeConsulente(dati: DatiReport): RigaConsulente[] {
  const righe: RigaConsulente[] = [];
  for (const d of dati.dipendenti) {
    const da = d.dataAssunzione > dati.filtri.da ? d.dataAssunzione : dati.filtri.da;
    const a = d.dataCessazione && d.dataCessazione < dati.filtri.a ? d.dataCessazione : dati.filtri.a;
    if (da > a) continue;
    const sueFasce = dati.fasce.filter((f) => f.dipendenteId === d.id);
    const sueAssenze = dati.assenze.filter((x) => x.dipendenteId === d.id);
    for (const data of intervalloDate(da, a)) {
      const g = giornoSettimana(data);
      const festa = dati.festivita.get(data);
      const tipoGiorno = festa ? 'festivo' : g === 6 ? 'sabato' : g === 0 ? 'domenica' : 'lavorativo';
      const lavorativo = tipoGiorno === 'lavorativo';
      const delGiorno = sueAssenze.filter((x) => x.dataInizio <= data && data <= x.dataFine);
      const fasce = sueFasce.filter((f) => f.data === data);
      const note = [...new Set(fasce.map((f) => f.note).filter(Boolean))].join(' | ');
      righe.push({
        matricola: d.matricola,
        cognome: d.cognome,
        nome: d.nome,
        codiceFiscale: d.codiceFiscale,
        data,
        giorno: NOMI_GIORNI[g],
        tipoGiorno,
        minutiLavorati: fasce.reduce((s, f) => s + f.minuti, 0),
        // Ferie e malattia contano solo nei giorni lavorativi: un sabato dentro una settimana di ferie non è un giorno di ferie.
        ferie: lavorativo && delGiorno.some((x) => x.tipo === 'FERIE') ? 1 : 0,
        malattia: lavorativo && delGiorno.some((x) => x.tipo === 'MALATTIA') ? 1 : 0,
        minutiPermesso: delGiorno.filter((x) => x.tipo === 'PERMESSO').reduce((s, x) => s + (x.minutiPermesso ?? 0), 0),
        festivita: festa?.descrizione ?? '',
        minutiContrattuali: lavorativo ? Math.round((d.oreSettimanali * 60) / 5) : 0,
        note,
      });
    }
  }
  return righe;
}

/** Ore come numero decimale con due cifre (7 ore e mezza → 7,5). */
const oreDecimali = (minuti: number) => Math.round((minuti / 60) * 100) / 100;

const COLONNE: { titolo: string; larghezza: number; valore: (r: RigaConsulente) => string | number }[] = [
  { titolo: 'Matricola', larghezza: 12, valore: (r) => r.matricola },
  { titolo: 'Cognome', larghezza: 18, valore: (r) => r.cognome },
  { titolo: 'Nome', larghezza: 16, valore: (r) => r.nome },
  { titolo: 'Codice fiscale', larghezza: 19, valore: (r) => r.codiceFiscale },
  { titolo: 'Data', larghezza: 12, valore: (r) => formattaData(r.data) },
  { titolo: 'Giorno', larghezza: 11, valore: (r) => r.giorno },
  { titolo: 'Tipo giorno', larghezza: 12, valore: (r) => r.tipoGiorno },
  { titolo: 'Ore lavorate', larghezza: 13, valore: (r) => oreDecimali(r.minutiLavorati) },
  { titolo: 'Ore lavorate (h:mm)', larghezza: 18, valore: (r) => formattaOre(r.minutiLavorati) },
  { titolo: 'Ferie (giorni)', larghezza: 13, valore: (r) => r.ferie },
  { titolo: 'Malattia (giorni)', larghezza: 15, valore: (r) => r.malattia },
  { titolo: 'Permesso (ore)', larghezza: 14, valore: (r) => oreDecimali(r.minutiPermesso) },
  { titolo: 'Festività', larghezza: 24, valore: (r) => r.festivita },
  { titolo: 'Ore contrattuali', larghezza: 15, valore: (r) => oreDecimali(r.minutiContrattuali) },
  { titolo: 'Note', larghezza: 40, valore: (r) => r.note },
];

/** Excel con un solo foglio "Presenze": intestazione bloccata e filtro sulle colonne. */
export function creaExcelConsulente(dati: DatiReport): ExcelJS.Workbook {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Copilota';
  const foglio = libro.addWorksheet('Presenze', { views: [{ state: 'frozen', ySplit: 1 }] });
  foglio.columns = COLONNE.map((c) => ({ header: c.titolo, width: c.larghezza }));
  stileIntestazione(foglio.getRow(1));
  for (const r of righeConsulente(dati)) foglio.addRow(COLONNE.map((c) => c.valore(r)));
  foglio.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLONNE.length } };
  return libro;
}

/** Una cella CSV: virgola decimale per i numeri; virgolette se il testo contiene ; " o a capo. */
function cellaCsv(v: string | number): string {
  if (typeof v === 'number') return String(v).replace('.', ',');
  // Un testo che comincia con = + - @ verrebbe letto da Excel come formula: lo si disinnesca.
  const testo = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return /[;"\r\n]/.test(testo) ? `"${testo.replace(/"/g, '""')}"` : testo;
}

/** CSV per Excel italiano: separatore ;, virgola decimale, righe CRLF, BOM UTF-8 in testa. */
export function creaCsvConsulente(dati: DatiReport): string {
  const righe = [COLONNE.map((c) => c.titolo), ...righeConsulente(dati).map((r) => COLONNE.map((c) => c.valore(r)))];
  return '﻿' + righe.map((r) => r.map(cellaCsv).join(';')).join('\r\n') + '\r\n';
}

/** Manda il CSV come download (stessa gestione del nome di inviaExcel). */
export function inviaCsv(res: Response, testo: string, nomeFile: string) {
  const ascii = nomeFile.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nomeFile)}`);
  res.send(Buffer.from(testo, 'utf8'));
}
