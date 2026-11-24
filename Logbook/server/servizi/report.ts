// "><(((º> sabusabu <º)))><"
/**
 * Estrazioni Excel (Giorno 8): i due report scaricabili da HR.
 *
 * 1. "Calendario lavorato": un foglio per dipendente con l'anagrafica in testa, il
 *    dettaglio giorno per giorno (fasce, progetto, ore, assenze, festività) e i totali
 *    del periodo.
 * 2. "Progetti": per ogni dipendente anagrafica e progetti lavorati con ore (e costo lordo
 *    se in scheda) per progetto e totale; più un foglio riassuntivo dipendenti × progetti.
 *
 * Le ore sono scritte come durate Excel (minuti / 1440, formato [h]:mm): si leggono come
 * nel calendario (7:30) e si possono sommare in Excel. I totali vengono da
 * comune/riepiloghi.ts#calcolaTotali, la stessa funzione del calendario: è ciò che
 * garantisce che i totali dei report coincidano con quelli mostrati in app.
 */
import ExcelJS from 'exceljs';
import { z } from 'zod';
import type { Assenza, Dipendente, Festivita, PrismaClient, Progetto, RegistrazioneOraria } from '../../generated/prisma/client';
import { aDateUtc, formattaData, intervalloDate, isDataValida, isFineSettimana } from '../../comune/date';
import { formattaEuro } from '../../comune/importi';
import { durataMinuti, formattaOre } from '../../comune/orari';
import { calcolaTotali, giorniLavorativi, type Totali } from '../../comune/riepiloghi';
import { ETICHETTE_CONTRATTO } from '../../comune/schemi';
import { stileIntestazione } from './excel';

const MAX_GIORNI_REPORT = 400;

/** Filtri dei report (corpo JSON di POST /api/esporta/...). Liste vuote = tutti. */
export const schemaFiltriReport = z
  .object({
    da: z.string().refine(isDataValida, 'Data iniziale non valida'),
    a: z.string().refine(isDataValida, 'Data finale non valida'),
    dipendenteIds: z.array(z.coerce.number().int().positive()).default([]),
    progettoIds: z.array(z.coerce.number().int().positive()).default([]),
  })
  .superRefine((f, ctx) => {
    if (!isDataValida(f.da) || !isDataValida(f.a)) return;
    if (f.a < f.da) ctx.addIssue({ code: 'custom', path: ['a'], message: 'La data finale precede quella iniziale' });
    else if ((aDateUtc(f.a).getTime() - aDateUtc(f.da).getTime()) / 86_400_000 > MAX_GIORNI_REPORT) {
      ctx.addIssue({ code: 'custom', path: ['a'], message: `Periodo troppo lungo (massimo ${MAX_GIORNI_REPORT} giorni)` });
    }
  });

type FiltriReport = z.output<typeof schemaFiltriReport>;

type DatiReport = {
  filtri: FiltriReport;
  dipendenti: Dipendente[];
  progetti: Map<number, Progetto>;
  fasce: (RegistrazioneOraria & { minuti: number })[];
  assenze: Assenza[];
  festivita: Map<string, Festivita>;
  totali: Totali;
};

/**
 * Carica i dati del periodo. Dipendenti: quelli scelti, oppure tutti quelli attivi nel
 * periodo o con ore registrate. Fasce: solo dei progetti scelti (se indicati).
 * Assenze: solo APPROVATE (le richieste in attesa o rifiutate non sono assenze).
 */
export async function caricaDatiReport(prisma: PrismaClient, filtri: FiltriReport): Promise<DatiReport> {
  const { da, a, dipendenteIds, progettoIds } = filtri;
  const fasce = await prisma.registrazioneOraria.findMany({
    where: {
      data: { gte: da, lte: a },
      ...(dipendenteIds.length ? { dipendenteId: { in: dipendenteIds } } : {}),
      ...(progettoIds.length ? { progettoId: { in: progettoIds } } : {}),
    },
    orderBy: [{ data: 'asc' }, { oraInizio: 'asc' }],
  });
  const conOre = new Set(fasce.map((f) => f.dipendenteId));
  const dipendenti = await prisma.dipendente.findMany({
    where: dipendenteIds.length
      ? { id: { in: dipendenteIds } }
      : {
          OR: [
            { id: { in: [...conOre] } },
            { dataAssunzione: { lte: a }, OR: [{ dataCessazione: null }, { dataCessazione: { gte: da } }] },
          ],
        },
    orderBy: [{ cognome: 'asc' }, { nome: 'asc' }],
  });
  const [progetti, assenze, festivita] = await Promise.all([
    prisma.progetto.findMany(),
    prisma.assenza.findMany({
      where: { stato: 'APPROVATA', dipendenteId: { in: dipendenti.map((d) => d.id) }, dataInizio: { lte: a }, dataFine: { gte: da } },
    }),
    prisma.festivita.findMany({ where: { data: { gte: da, lte: a } } }),
  ]);
  return {
    filtri,
    dipendenti,
    progetti: new Map(progetti.map((p) => [p.id, p])),
    fasce: fasce.map((f) => ({ ...f, minuti: durataMinuti(f.oraInizio, f.oraFine) })),
    assenze,
    festivita: new Map(festivita.map((f) => [f.data, f])),
    totali: calcolaTotali(fasce),
  };
}

const NOMI_GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
const FORMATO_ORE = '[h]:mm';
/** Minuti → valore di durata Excel (frazione di giorno). */
const durataExcel = (minuti: number) => minuti / 1440;

/** Nome di foglio valido e unico (max 31 caratteri, niente []:*?/\). */
function nomeFoglio(libro: ExcelJS.Workbook, desiderato: string): string {
  const base = desiderato.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31).trim() || 'Foglio';
  let nome = base;
  for (let i = 2; libro.getWorksheet(nome); i++) nome = `${base.slice(0, 27)} (${i})`;
  return nome;
}

/** Blocco anagrafica in testa al foglio (etichetta in grassetto, valore accanto). */
function scriviAnagrafica(foglio: ExcelJS.Worksheet, d: Dipendente, filtri: FiltriReport, titolo: string) {
  foglio.addRow([titolo]).font = { bold: true, size: 14, color: { argb: 'FF0C4577' } };
  const voci: [string, string][] = [
    ['Dipendente', `${d.cognome} ${d.nome}`],
    ['Matricola', d.matricola],
    ['Codice fiscale', d.codiceFiscale],
    ['Mansione', d.mansione ?? ''],
    ['Reparto', d.reparto ?? ''],
    ['Contratto', `${ETICHETTE_CONTRATTO[d.tipoContratto]}, ${d.oreSettimanali} ore settimanali`],
    ['Assunzione', formattaData(d.dataAssunzione) + (d.dataCessazione ? ` — cessazione ${formattaData(d.dataCessazione)}` : '')],
    ['Periodo', `dal ${formattaData(filtri.da)} al ${formattaData(filtri.a)}`],
  ];
  for (const [etichetta, valore] of voci) {
    const riga = foglio.addRow([etichetta, valore]);
    riga.getCell(1).font = { bold: true };
  }
  foglio.addRow([]);
}

/** Report 1: calendario lavorato, un foglio per dipendente. */
export function creaReportCalendario(dati: DatiReport): ExcelJS.Workbook {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Logbook';
  const { filtri } = dati;
  const giorni = intervalloDate(filtri.da, filtri.a);
  const festivi = new Set(dati.festivita.keys());

  for (const d of dati.dipendenti) {
    const foglio = libro.addWorksheet(nomeFoglio(libro, `${d.cognome} ${d.nome}`), { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    foglio.columns = [{ width: 18 }, { width: 12 }, { width: 8 }, { width: 8 }, { width: 14 }, { width: 30 }, { width: 9 }, { width: 22 }, { width: 24 }, { width: 30 }];
    scriviAnagrafica(foglio, d, filtri, 'Calendario lavorato');

    const intestazione = foglio.addRow(['Data', 'Giorno', 'Dalle', 'Alle', 'Progetto', 'Descrizione progetto', 'Ore', 'Assenza', 'Festività', 'Note']);
    stileIntestazione(intestazione);
    foglio.views = [{ state: 'frozen', ySplit: intestazione.number }];

    const fasce = dati.fasce.filter((f) => f.dipendenteId === d.id);
    const assenze = dati.assenze.filter((x) => x.dipendenteId === d.id);
    for (const g of giorni) {
      const delGiorno = fasce.filter((f) => f.data === g);
      const assenza = assenze
        .filter((x) => x.dataInizio <= g && g <= x.dataFine)
        .map((x) => (x.tipo === 'FERIE' ? 'Ferie' : x.tipo === 'MALATTIA' ? 'Malattia' : `Permesso ${formattaOre(x.minutiPermesso ?? 0)}`))
        .join(', ');
      const festa = dati.festivita.get(g)?.descrizione ?? '';
      const giorno = NOMI_GIORNI[aDateUtc(g).getUTCDay()];
      const righe = delGiorno.length ? delGiorno : [null];
      righe.forEach((f, i) => {
        const p = f ? dati.progetti.get(f.progettoId) : undefined;
        const riga = foglio.addRow([
          formattaData(g), giorno, f?.oraInizio ?? '', f?.oraFine ?? '', p?.codice ?? '', p?.nome ?? '',
          f ? durataExcel(f.minuti) : null, i === 0 ? assenza : '', i === 0 ? festa : '', f?.note ?? '',
        ]);
        riga.getCell(7).numFmt = FORMATO_ORE;
        if (isFineSettimana(g) || festa) riga.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
        if (assenza) riga.getCell(8).font = { color: { argb: 'FF1E3A8A' } };
      });
    }

    // Totali del periodo: ore lavorate (anche per progetto), assenze, ore contrattuali attese.
    foglio.addRow([]);
    const minutiTotali = dati.totali.perDipendente[d.id] ?? 0;
    const inizioRapporto = d.dataAssunzione > filtri.da ? d.dataAssunzione : filtri.da;
    const fineRapporto = d.dataCessazione && d.dataCessazione < filtri.a ? d.dataCessazione : filtri.a;
    const lavorativi = inizioRapporto <= fineRapporto ? giorniLavorativi(inizioRapporto, fineRapporto, festivi).length : 0;
    const giorniAssenza = (tipo: string) =>
      assenze.filter((x) => x.tipo === tipo).reduce((s, x) => s + giorniLavorativi(x.dataInizio < filtri.da ? filtri.da : x.dataInizio, x.dataFine > filtri.a ? filtri.a : x.dataFine, festivi).length, 0);
    const minutiPermessi = assenze.filter((x) => x.tipo === 'PERMESSO').reduce((s, x) => s + (x.minutiPermesso ?? 0), 0);

    const totale = foglio.addRow(['TOTALE ORE LAVORATE', '', '', '', '', '', durataExcel(minutiTotali)]);
    totale.font = { bold: true };
    totale.getCell(7).numFmt = FORMATO_ORE;
    totale.getCell(7).border = { top: { style: 'thin' }, bottom: { style: 'double' } };
    for (const [idProgetto, minuti] of Object.entries(dati.totali.perDipendenteProgetto)
      .filter(([chiave]) => chiave.startsWith(`${d.id}|`))
      .map(([chiave, m]) => [Number(chiave.split('|')[1]), m] as const)
      .sort((x, y) => (dati.progetti.get(x[0])?.codice ?? '').localeCompare(dati.progetti.get(y[0])?.codice ?? ''))) {
      const p = dati.progetti.get(idProgetto);
      const riga = foglio.addRow(['  di cui', '', '', '', p?.codice ?? '', p?.nome ?? '', durataExcel(minuti)]);
      riga.getCell(7).numFmt = FORMATO_ORE;
    }
    const riepilogo: [string, number | string, boolean][] = [
      ['Giorni lavorativi nel periodo', lavorativi, false],
      ['Ore contrattuali attese', durataExcel(Math.round((lavorativi * d.oreSettimanali * 60) / 5)), true],
      ['Ferie (giorni)', giorniAssenza('FERIE'), false],
      ['Malattia (giorni)', giorniAssenza('MALATTIA'), false],
      ['Permessi (ore)', durataExcel(minutiPermessi), true],
    ];
    for (const [etichetta, valore, ore] of riepilogo) {
      const riga = foglio.addRow([etichetta, '', '', '', '', '', valore]);
      if (ore) riga.getCell(7).numFmt = FORMATO_ORE;
    }
  }
  if (!dati.dipendenti.length) libro.addWorksheet('Nessun dato').addRow(['Nessun dipendente nel periodo e con i filtri scelti']);
  return libro;
}

/** Report 2: progetti lavorati per dipendente, con totali e foglio riassuntivo. */
export function creaReportProgetti(dati: DatiReport): ExcelJS.Workbook {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Logbook';
  const { filtri, totali } = dati;
  const coppie = Object.entries(totali.perDipendenteProgetto).map(([chiave, minuti]) => {
    const [dipendenteId, progettoId] = chiave.split('|').map(Number);
    return { dipendenteId, progettoId, minuti };
  });
  const progettiUsati = [...new Set(coppie.map((c) => c.progettoId))]
    .map((id) => dati.progetti.get(id)!)
    .sort((x, y) => x.codice.localeCompare(y.codice));

  // Foglio 1: un blocco per dipendente.
  const foglio = libro.addWorksheet('Progetti per dipendente', { pageSetup: { fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  foglio.columns = [{ width: 18 }, { width: 34 }, { width: 26 }, { width: 12 }, { width: 16 }];
  foglio.addRow(['Ore per progetto']).font = { bold: true, size: 14, color: { argb: 'FF0C4577' } };
  foglio.addRow(['Periodo', `dal ${formattaData(filtri.da)} al ${formattaData(filtri.a)}`]).getCell(1).font = { bold: true };
  foglio.addRow([]);
  for (const d of dati.dipendenti) {
    const suoi = coppie.filter((c) => c.dipendenteId === d.id).sort((x, y) => dati.progetti.get(x.progettoId)!.codice.localeCompare(dati.progetti.get(y.progettoId)!.codice));
    const titolo = foglio.addRow([`${d.cognome} ${d.nome}`, `Matricola ${d.matricola} · CF ${d.codiceFiscale}`, [d.mansione, d.reparto].filter(Boolean).join(' · ')]);
    titolo.font = { bold: true, size: 12 };
    titolo.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F1F8' } };
    stileIntestazione(foglio.addRow(['Codice', 'Progetto', 'Cliente', 'Ore', 'Costo lordo']));
    const costoOra = d.costoOrarioLordoCent;
    for (const c of suoi) {
      const p = dati.progetti.get(c.progettoId)!;
      const riga = foglio.addRow([p.codice, p.nome, p.cliente ?? '', durataExcel(c.minuti), costoOra != null ? Math.round((c.minuti * costoOra) / 60) / 100 : null]);
      riga.getCell(4).numFmt = FORMATO_ORE;
      riga.getCell(5).numFmt = '#,##0.00 "€"';
    }
    if (!suoi.length) foglio.addRow(['', 'Nessuna ora registrata nel periodo']).font = { italic: true, color: { argb: 'FF6B7280' } };
    const minuti = totali.perDipendente[d.id] ?? 0;
    const tot = foglio.addRow(['TOTALE', '', '', durataExcel(minuti), costoOra != null ? Math.round((minuti * costoOra) / 60) / 100 : null]);
    tot.font = { bold: true };
    tot.getCell(4).numFmt = FORMATO_ORE;
    tot.getCell(5).numFmt = '#,##0.00 "€"';
    tot.getCell(4).border = { top: { style: 'thin' }, bottom: { style: 'double' } };
    if (costoOra == null) foglio.addRow(['', 'Costo orario lordo non indicato in scheda']).font = { italic: true, color: { argb: 'FF6B7280' } };
    else foglio.addRow(['', `Costo orario lordo: ${formattaEuro(costoOra)}`]).font = { italic: true, color: { argb: 'FF6B7280' } };
    foglio.addRow([]);
  }
  const generale = foglio.addRow(['TOTALE COMPLESSIVO', '', '', durataExcel(totali.totale)]);
  generale.font = { bold: true, size: 12 };
  generale.getCell(4).numFmt = FORMATO_ORE;

  // Foglio 2: matrice dipendenti × progetti con totali di riga e di colonna.
  const matrice = libro.addWorksheet('Riepilogo');
  matrice.columns = [{ width: 28 }, { width: 12 }, ...progettiUsati.map(() => ({ width: 12 })), { width: 12 }];
  stileIntestazione(matrice.addRow(['Dipendente', 'Matricola', ...progettiUsati.map((p) => p.codice), 'Totale']));
  for (const d of dati.dipendenti) {
    const valori = progettiUsati.map((p) => totali.perDipendenteProgetto[`${d.id}|${p.id}`] ?? 0);
    const riga = matrice.addRow([`${d.cognome} ${d.nome}`, d.matricola, ...valori.map(durataExcel), durataExcel(totali.perDipendente[d.id] ?? 0)]);
    for (let c = 3; c <= progettiUsati.length + 3; c++) riga.getCell(c).numFmt = FORMATO_ORE;
  }
  const piede = matrice.addRow(['TOTALE', '', ...progettiUsati.map((p) => durataExcel(totali.perProgetto[p.id] ?? 0)), durataExcel(totali.totale)]);
  piede.font = { bold: true };
  for (let c = 3; c <= progettiUsati.length + 3; c++) piede.getCell(c).numFmt = FORMATO_ORE;
  return libro;
}
