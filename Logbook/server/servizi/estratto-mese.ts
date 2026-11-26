// "><(((º> sabusabu <º)))><"
/**
 * Estratti mensili (richiesta del 23/11/2026): carica i dati del mese e produce i due
 * Excel, un foglio per dipendente.
 *
 * - "Mese a calendario": a sinistra il calendario del mese (settimane in riga, da lunedì a
 *   venerdì; per ogni giorno: numero, ore lavorate, progetti/assenze/festività), a destra
 *   l'anagrafica e il riepilogo del mese, in basso la descrizione dei progetti lavorati.
 * - "Giorni e costi": in testa l'anagrafica completa, poi una riga per giorno con ore,
 *   progetti, fasce, assenze, festività, ore retribuite e costo netto/lordo del giorno.
 *
 * I numeri vengono da comune/estratto-mese.ts (gli stessi dell'anteprima a schermo e della
 * stampa) e i dati da servizi/report.ts#caricaDatiReport (stessi filtri dei report).
 * Sabato e domenica non compaiono mai (Giorno 25): li esclude già costruisciEstratto.
 */
import ExcelJS from 'exceljs';
import { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/client';
import { aggiungiGiorni, formattaData } from '../../comune/date';
import { costruisciEstratto, ETICHETTE_GIORNI, GIORNI_GRIGLIA, limitiMese, RE_MESE, settimaneDelMese, type EstrattoDipendente, type GiornoEstratto } from '../../comune/estratto-mese';
import { formattaEuro } from '../../comune/importi';
import { formattaOre } from '../../comune/orari';
import { ETICHETTE_CONTRATTO } from '../../comune/schemi';
import { stileIntestazione } from './excel';
import { caricaDatiReport } from './report';

export const schemaFiltriMese = z.object({
  mese: z.string().regex(RE_MESE, 'Mese non valido (da gennaio 2020, formato AAAA-MM)'),
  dipendenteIds: z.array(z.coerce.number().int().positive()).default([]),
  progettoIds: z.array(z.coerce.number().int().positive()).default([]),
});
type FiltriMese = z.output<typeof schemaFiltriMese>;

/** Estratti di tutti i dipendenti scelti per il mese. */
export async function caricaEstratti(prisma: PrismaClient, filtri: FiltriMese): Promise<EstrattoDipendente[]> {
  const { da, a } = limitiMese(filtri.mese);
  const dati = await caricaDatiReport(prisma, { da, a, dipendenteIds: filtri.dipendenteIds, progettoIds: filtri.progettoIds });
  const festivita = new Map([...dati.festivita.values()].map((f) => [f.data, f.descrizione]));
  const progetti = new Map(
    [...dati.progetti.values()].map((p) => [
      p.id,
      { id: p.id, codice: p.codice, nome: p.nome, cliente: p.cliente, dataInizio: p.dataInizio, dataFine: p.dataFine, maxMinutiGiorno: p.maxMinutiGiorno, colore: p.colore },
    ]),
  );
  return dati.dipendenti.map((d) =>
    costruisciEstratto({
      mese: filtri.mese,
      dipendente: {
        id: d.id, matricola: d.matricola, nome: d.nome, cognome: d.cognome, codiceFiscale: d.codiceFiscale, email: d.email,
        telefono: d.telefono, mansione: d.mansione, reparto: d.reparto, tipoContratto: ETICHETTE_CONTRATTO[d.tipoContratto],
        oreSettimanali: d.oreSettimanali, dataAssunzione: d.dataAssunzione, dataCessazione: d.dataCessazione,
        costoOrarioNettoCent: d.costoOrarioNettoCent, costoOrarioLordoCent: d.costoOrarioLordoCent,
      },
      fasce: dati.fasce.filter((f) => f.dipendenteId === d.id),
      assenze: dati.assenze.filter((x) => x.dipendenteId === d.id),
      festivita,
      progetti,
    }),
  );
}

export const nomeMese = (mese: string) => {
  const testo = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' }).format(new Date(`${mese}-15T12:00:00Z`));
  return testo.charAt(0).toUpperCase() + testo.slice(1);
};

const FORMATO_ORE = '[h]:mm';
const FORMATO_EURO = '#,##0.00 "€"';
const durataExcel = (minuti: number) => minuti / 1440;
const euro = (cent: number | null) => (cent == null ? null : cent / 100);
const BLU = 'FF0C4577';
const COLORI_GIORNO = { festivo: 'FFF3F4F6', FERIE: 'FFDBEAFE', MALATTIA: 'FFFEE2E2', PERMESSO: 'FFFEF3C7', fuori: 'FFE5E7EB' } as const;
const bordoSottile = { style: 'thin' as const, color: { argb: 'FFD1D5DB' } };

/** Nome foglio valido e unico. */
function nomeFoglio(libro: ExcelJS.Workbook, desiderato: string) {
  const base = desiderato.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31).trim() || 'Foglio';
  let nome = base;
  for (let i = 2; libro.getWorksheet(nome); i++) nome = `${base.slice(0, 27)} (${i})`;
  return nome;
}

/** Testo breve di un giorno: assenze, festività, progetti con ore. */
function notaGiorno(g: GiornoEstratto): string {
  const parti: string[] = [];
  for (const x of g.assenze) parti.push(x.tipo === 'PERMESSO' ? `Permesso ${formattaOre(x.minuti)}` : x.tipo === 'FERIE' ? 'Ferie' : 'Malattia');
  if (g.festivita) parti.push(g.festivita);
  for (const p of g.progetti) parti.push(`${p.codice} ${formattaOre(p.minuti)}`);
  return parti.join(' · ');
}

/** Colore di sfondo di un giorno (assenza, festivo, fuori rapporto) o null. */
function coloreGiorno(g: GiornoEstratto): string | null {
  if (g.fuoriRapporto) return COLORI_GIORNO.fuori;
  const assenza = g.assenze[0]?.tipo;
  if (assenza) return COLORI_GIORNO[assenza];
  if (!g.lavorativo) return COLORI_GIORNO.festivo;
  return null;
}

/** Righe "etichetta: valore" dell'anagrafica, usate da entrambi i layout. */
function righeAnagrafica(e: EstrattoDipendente): [string, string][] {
  const d = e.dipendente;
  return [
    ['Dipendente', `${d.cognome} ${d.nome}`],
    ['Matricola', d.matricola],
    ['Codice fiscale', d.codiceFiscale],
    ['Mansione', d.mansione ?? '—'],
    ['Reparto', d.reparto ?? '—'],
    ['Contratto', d.tipoContratto],
    ['Ore settimanali', String(d.oreSettimanali)],
    ['Assunzione', formattaData(d.dataAssunzione)],
    ['Cessazione', d.dataCessazione ? formattaData(d.dataCessazione) : '—'],
    ['Email', d.email ?? '—'],
    ['Telefono', d.telefono ?? '—'],
    ['Costo orario netto', formattaEuro(d.costoOrarioNettoCent)],
    ['Costo orario lordo', formattaEuro(d.costoOrarioLordoCent)],
  ];
}

/** Excel 1: mese a calendario con anagrafica a destra e progetti in basso. */
export function creaExcelMeseCalendario(estratti: EstrattoDipendente[]): ExcelJS.Workbook {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Copilota';
  for (const e of estratti) {
    const d = e.dipendente;
    const foglio = libro.addWorksheet(nomeFoglio(libro, `${d.cognome} ${d.nome}`), {
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 1, paperSize: 9 },
    });
    // Colonne: A-E i cinque giorni da lunedì a venerdì, F spazio, G-H anagrafica e riepilogo.
    foglio.columns = [...Array(5).fill({ width: 20 }), { width: 2 }, { width: 22 }, { width: 30 }];

    foglio.mergeCells('A1:E1');
    Object.assign(foglio.getCell('A1'), { value: `Ore di ${nomeMese(e.mese)}` });
    foglio.getCell('A1').font = { bold: true, size: 14, color: { argb: BLU } };
    foglio.mergeCells('G1:H1');
    foglio.getCell('G1').value = `${d.cognome} ${d.nome}`;
    foglio.getCell('G1').font = { bold: true, size: 14, color: { argb: BLU } };

    // Intestazione dei giorni (lunedì → venerdì: niente sabato e domenica, Giorno 25)
    GIORNI_GRIGLIA.forEach((nome, c) => {
      const cella = foglio.getCell(3, c + 1);
      cella.value = nome;
      cella.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cella.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLU } };
      cella.alignment = { horizontal: 'center' };
    });

    // Griglia: 3 righe per settimana (numero del giorno, ore, note), cinque colonne.
    const perData = new Map(e.giorni.map((g) => [g.data, g]));
    const lunedi = settimaneDelMese(e.mese);
    const settimane = lunedi.length;
    for (let w = 0; w < settimane; w++) {
      const base = 4 + w * 3;
      foglio.getRow(base + 2).height = 32;
      for (let c = 0; c < 5; c++) {
        const data = aggiungiGiorni(lunedi[w], c);
        const g = perData.get(data);
        const [cNum, cOre, cNota] = [0, 1, 2].map((r) => foglio.getCell(base + r, c + 1));
        const colore = g ? coloreGiorno(g) : COLORI_GIORNO.fuori;
        for (const cella of [cNum, cOre, cNota]) {
          if (colore) cella.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colore } };
          cella.border = { left: bordoSottile, right: bordoSottile };
        }
        cNum.border = { ...cNum.border, top: bordoSottile };
        cNota.border = { ...cNota.border, bottom: bordoSottile };
        if (!g) continue;
        cNum.value = Number(data.slice(8));
        cNum.font = { size: 9, color: { argb: 'FF6B7280' } };
        if (g.minutiLavorati) {
          cOre.value = durataExcel(g.minutiLavorati);
          cOre.numFmt = FORMATO_ORE;
          cOre.font = { bold: true, size: 12, color: { argb: BLU } };
        }
        cOre.alignment = { horizontal: 'center' };
        cNota.value = notaGiorno(g);
        cNota.font = { size: 8 };
        cNota.alignment = { wrapText: true, vertical: 'top' };
      }
    }

    // A destra: anagrafica e riepilogo del mese
    let r = 3;
    const scriviDestra = (etichetta: string, valore: string | number | null, formato?: string) => {
      foglio.getCell(r, 7).value = etichetta;
      foglio.getCell(r, 7).font = { bold: true };
      const v = foglio.getCell(r, 8);
      v.value = valore;
      if (formato) v.numFmt = formato;
      r++;
    };
    for (const [etichetta, valore] of righeAnagrafica(e).slice(1)) scriviDestra(etichetta, valore);
    r++;
    foglio.getCell(r, 7).value = 'Riepilogo del mese';
    foglio.getCell(r, 7).font = { bold: true, color: { argb: BLU } };
    r++;
    const t = e.totali;
    scriviDestra('Ore lavorate', durataExcel(t.minutiLavorati), FORMATO_ORE);
    scriviDestra('Ore attese (contratto)', durataExcel(t.minutiAttesi), FORMATO_ORE);
    scriviDestra('Giorni con ore', t.giorniConOre);
    scriviDestra('Giorni lavorativi', t.giorniLavorativi);
    scriviDestra('Ferie (giorni)', t.giorniFerie);
    scriviDestra('Malattia (giorni)', t.giorniMalattia);
    scriviDestra('Permessi (ore)', durataExcel(t.minutiPermessi), FORMATO_ORE);
    scriviDestra('Costo netto del mese', euro(t.costoNettoCent), FORMATO_EURO);
    scriviDestra('Costo lordo del mese', euro(t.costoLordoCent), FORMATO_EURO);

    // In basso: descrizione dei progetti lavorati nel mese
    let rp = Math.max(4 + settimane * 3 + 1, r + 1);
    foglio.getCell(rp, 1).value = 'Progetti del mese';
    foglio.getCell(rp, 1).font = { bold: true, color: { argb: BLU } };
    rp++;
    // Cinque colonne, sotto le cinque della griglia.
    const intestazione = foglio.getRow(rp);
    intestazione.values = ['Codice', 'Progetto', 'Cliente', 'Max ore/giorno', 'Ore nel mese'];
    stileIntestazione(intestazione);
    for (const c of [6, 7, 8]) intestazione.getCell(c).fill = { type: 'pattern', pattern: 'none' };
    for (const p of e.progetti) {
      rp++;
      const riga = foglio.getRow(rp);
      riga.values = [p.codice, p.nome, p.cliente ?? '', p.maxMinutiGiorno != null ? durataExcel(p.maxMinutiGiorno) : 'nessun limite', durataExcel(p.minuti)];
      if (p.maxMinutiGiorno != null) riga.getCell(4).numFmt = FORMATO_ORE;
      riga.getCell(5).numFmt = FORMATO_ORE;
    }
    if (!e.progetti.length) foglio.getCell(rp + 1, 1).value = 'Nessuna ora registrata nel mese';
    // Legenda dei colori
    rp += 2;
    const legenda: [string, string][] = [['Ferie', COLORI_GIORNO.FERIE], ['Malattia', COLORI_GIORNO.MALATTIA], ['Permesso', COLORI_GIORNO.PERMESSO], ['Festivo', COLORI_GIORNO.festivo]];
    legenda.forEach(([testo, colore], i) => {
      const cella = foglio.getCell(rp, i + 1);
      cella.value = testo;
      cella.font = { size: 8 };
      cella.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colore } };
    });
  }
  if (!estratti.length) libro.addWorksheet('Nessun dato').addRow(['Nessun dipendente nel mese con i filtri scelti']);
  return libro;
}

/** Excel 2: giorni in verticale con ore, assenze e costo del giorno. */
export function creaExcelMeseGiorni(estratti: EstrattoDipendente[]): ExcelJS.Workbook {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Copilota';
  for (const e of estratti) {
    const d = e.dipendente;
    const foglio = libro.addWorksheet(nomeFoglio(libro, `${d.cognome} ${d.nome}`), {
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
    });
    foglio.columns = [{ width: 12 }, { width: 11 }, { width: 10 }, { width: 26 }, { width: 26 }, { width: 16 }, { width: 22 }, { width: 11 }, { width: 13 }, { width: 13 }];
    foglio.addRow([`Giorni e costi — ${nomeMese(e.mese)}`]).font = { bold: true, size: 14, color: { argb: BLU } };
    // Anagrafica su due colonne di coppie etichetta/valore (A-B e D-E) per restare compatta.
    const anagrafica = righeAnagrafica(e);
    const meta = Math.ceil(anagrafica.length / 2);
    for (let i = 0; i < meta; i++) {
      const [e1, v1] = anagrafica[i];
      const [e2, v2] = anagrafica[i + meta] ?? ['', ''];
      const riga = foglio.addRow([e1, v1, '', e2, v2]);
      riga.getCell(1).font = { bold: true };
      riga.getCell(4).font = { bold: true };
    }
    foglio.addRow([]);
    const intestazione = foglio.addRow(['Data', 'Giorno', 'Ore lavorate', 'Progetti', 'Fasce', 'Assenza', 'Festività', 'Ore retribuite', 'Costo netto', 'Costo lordo']);
    stileIntestazione(intestazione);
    foglio.views = [{ state: 'frozen', ySplit: intestazione.number }];

    for (const g of e.giorni) {
      const assenza = g.assenze.map((x) => (x.tipo === 'PERMESSO' ? `Permesso ${formattaOre(x.minuti)}` : x.tipo === 'FERIE' ? 'Ferie' : 'Malattia')).join(', ');
      const riga = foglio.addRow([
        formattaData(g.data),
        ETICHETTE_GIORNI[g.giornoSettimana],
        g.minutiLavorati ? durataExcel(g.minutiLavorati) : null,
        g.progetti.map((p) => `${p.codice} ${formattaOre(p.minuti)}`).join(', '),
        g.fasce.map((f) => `${f.oraInizio}-${f.oraFine}`).join(', '),
        g.fuoriRapporto ? 'Fuori rapporto' : assenza,
        g.festivita ?? '',
        g.minutiRetribuiti ? durataExcel(g.minutiRetribuiti) : null,
        g.minutiRetribuiti ? euro(g.costoNettoCent) : null,
        g.minutiRetribuiti ? euro(g.costoLordoCent) : null,
      ]);
      for (const c of [3, 8]) riga.getCell(c).numFmt = FORMATO_ORE;
      for (const c of [9, 10]) riga.getCell(c).numFmt = FORMATO_EURO;
      const colore = coloreGiorno(g);
      if (colore) riga.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colore } };
    }

    const t = e.totali;
    const totale = foglio.addRow(['TOTALE', '', durataExcel(t.minutiLavorati), '', '', '', '', durataExcel(t.minutiRetribuiti), euro(t.costoNettoCent), euro(t.costoLordoCent)]);
    totale.font = { bold: true };
    for (const c of [3, 8]) totale.getCell(c).numFmt = FORMATO_ORE;
    for (const c of [9, 10]) totale.getCell(c).numFmt = FORMATO_EURO;
    for (let c = 1; c <= 10; c++) totale.getCell(c).border = { top: { style: 'thin' }, bottom: { style: 'double' } };
    foglio.addRow([]);
    const riepilogo: [string, number, boolean][] = [
      ['Ore attese (contratto)', durataExcel(t.minutiAttesi), true],
      ['Ferie (giorni)', t.giorniFerie, false],
      ['Ferie (ore retribuite)', durataExcel(t.minutiFerie), true],
      ['Malattia (giorni)', t.giorniMalattia, false],
      ['Malattia (ore retribuite)', durataExcel(t.minutiMalattia), true],
      ['Permessi (ore)', durataExcel(t.minutiPermessi), true],
    ];
    for (const [etichetta, valore, ore] of riepilogo) {
      const riga = foglio.addRow([etichetta, '', valore]);
      riga.getCell(1).font = { bold: true };
      if (ore) riga.getCell(3).numFmt = FORMATO_ORE;
    }
    foglio.addRow([]);
    foglio.addRow(['Costo del giorno = (ore lavorate + ferie/malattia nei giorni lavorativi a ore del contratto + permessi) × costo orario. Festività indicate senza costo.']).font = {
      italic: true,
      size: 8,
      color: { argb: 'FF6B7280' },
    };
  }
  if (!estratti.length) libro.addWorksheet('Nessun dato').addRow(['Nessun dipendente nel mese con i filtri scelti']);
  return libro;
}
