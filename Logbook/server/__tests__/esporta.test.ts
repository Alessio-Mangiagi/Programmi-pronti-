// "><(((º> sabusabu <º)))><"
/**
 * Giorno 8 — estrazioni. Criterio "fatto quando": i totali dei report coincidono con
 * quelli del calendario. Si scaricano i due .xlsx, si rileggono le celle dei totali e si
 * confrontano con /api/calendario sullo stesso periodo e con gli stessi filtri.
 */
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CREDENZIALI_DEMO, semina } from '../../prisma/seed';
import { avviaServer, OGGI_PROVA, type ClientProva } from './client-prova';
import { creaDbProva, type DbProva } from './db-prova';

let db: DbProva;
let server: Awaited<ReturnType<typeof avviaServer>>;
let admin: ClientProva;

/**
 * Durata Excel (frazione di giorno) → minuti interi. Rileggendo il file, ExcelJS
 * trasforma i numeri con formato orario ([h]:mm) in Date (seriale Excel → data): si
 * torna al seriale con la stessa formula di ExcelJS (giorni dal 30/12/1899, 25569 = 1/1/1970).
 */
const minuti = (v: ExcelJS.CellValue) => {
  const seriale = v instanceof Date ? v.getTime() / 86_400_000 + 25569 : Number(v);
  return Math.round(seriale * 1440);
};

async function scarica(percorso: string, filtri: object) {
  const r = await admin.chiama('POST', percorso, filtri);
  expect(r.stato).toBe(200);
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(r.corpo);
  return libro;
}

/** Riga del foglio che inizia con l'etichetta data. */
const rigaCon = (foglio: ExcelJS.Worksheet, etichetta: string) => {
  let trovata: ExcelJS.Row | undefined;
  foglio.eachRow((r) => {
    if (!trovata && r.getCell(1).value === etichetta) trovata = r;
  });
  if (!trovata) throw new Error(`Riga "${etichetta}" non trovata nel foglio ${foglio.name}`);
  return trovata;
};

/** Totali del calendario per dipendente su ottobre e novembre (due chiamate: max 62 giorni). */
async function totaliCalendario(query = '') {
  const perDipendente: Record<number, number> = {};
  const perProgetto: Record<number, number> = {};
  let totale = 0;
  for (const [da, a] of [['2026-10-01', '2026-10-31'], ['2026-11-01', '2026-11-30']]) {
    const r = await admin.chiama('GET', `/api/calendario?da=${da}&a=${a}${query}`);
    for (const f of r.corpo.fasce as { dipendenteId: number; progettoId: number; minuti: number }[]) {
      perDipendente[f.dipendenteId] = (perDipendente[f.dipendenteId] ?? 0) + f.minuti;
      perProgetto[f.progettoId] = (perProgetto[f.progettoId] ?? 0) + f.minuti;
    }
    totale += r.corpo.totali.totale;
  }
  return { perDipendente, perProgetto, totale };
}

beforeAll(async () => {
  db = await creaDbProva();
  await semina(db.prisma, OGGI_PROVA);
  server = await avviaServer(db.prisma);
  admin = await server.accedi(CREDENZIALI_DEMO.admin.username, CREDENZIALI_DEMO.admin.password);
});

afterAll(async () => {
  await server.chiudi();
  await db.chiudi();
});

const PERIODO = { da: '2026-10-01', a: '2026-11-30' };

describe('report calendario lavorato', () => {
  it('un foglio per dipendente con anagrafica, giorni e totali uguali al calendario', async () => {
    const libro = await scarica('/api/esporta/calendario', PERIODO);
    const dipendenti = await db.prisma.dipendente.findMany({ orderBy: [{ cognome: 'asc' }, { nome: 'asc' }] });
    expect(libro.worksheets.map((f) => f.name)).toEqual(dipendenti.map((d) => `${d.cognome} ${d.nome}`));
    const cal = await totaliCalendario();

    for (const d of dipendenti) {
      const foglio = libro.getWorksheet(`${d.cognome} ${d.nome}`)!;
      expect(rigaCon(foglio, 'Matricola').getCell(2).value).toBe(d.matricola);
      expect(rigaCon(foglio, 'Codice fiscale').getCell(2).value).toBe(d.codiceFiscale);
      expect(minuti(rigaCon(foglio, 'TOTALE ORE LAVORATE').getCell(7).value)).toBe(cal.perDipendente[d.id] ?? 0);
      // La somma delle ore riga per riga è uguale al totale scritto.
      let somma = 0;
      foglio.eachRow((r) => {
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(String(r.getCell(1).value)) && r.getCell(7).value != null) somma += minuti(r.getCell(7).value);
      });
      expect(somma).toBe(cal.perDipendente[d.id] ?? 0);
    }
  });

  it('riporta assenze approvate e festività nel dettaglio dei giorni, mai sabato e domenica', async () => {
    const ferie = await db.prisma.assenza.findFirstOrThrow({ where: { tipo: 'FERIE', stato: 'APPROVATA' }, include: { dipendente: true } });
    // Festività di prova in un giorno feriale fuori dalle ferie (quelle del seed in ottobre e
    // novembre 2026 cadono di domenica e dal Giorno 25 non compaiono).
    const festa = await db.prisma.festivita.create({ data: { data: ferie.dataInizio === '2026-10-14' ? '2026-10-15' : '2026-10-14', descrizione: 'Festa di prova', tipo: 'AZIENDALE' } });
    try {
      const libro = await scarica('/api/esporta/calendario', { ...PERIODO, dipendenteIds: [ferie.dipendenteId] });
      expect(libro.worksheets).toHaveLength(1);
      const foglio = libro.worksheets[0];
      const [a, m, g] = ferie.dataInizio.split('-');
      expect(rigaCon(foglio, `${g}/${m}/${a}`).getCell(8).value).toBe('Ferie');
      const [fa, fm, fg] = festa.data.split('-');
      expect(rigaCon(foglio, `${fg}/${fm}/${fa}`).getCell(9).value).toBe('Festa di prova');
      expect(rigaCon(foglio, 'Ferie (giorni)').getCell(7).value).toBe(3);
      // Giorno 25: nessuna riga di sabato o domenica (01/11/2026, Ognissanti, è domenica)
      const giorniSettimana = new Set<string>();
      foglio.eachRow((r) => {
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(String(r.getCell(1).value))) giorniSettimana.add(String(r.getCell(2).value));
      });
      expect([...giorniSettimana].sort()).toEqual(['giovedì', 'lunedì', 'martedì', 'mercoledì', 'venerdì']);
      expect(() => rigaCon(foglio, '01/11/2026')).toThrow();
    } finally {
      await db.prisma.festivita.delete({ where: { id: festa.id } });
    }
  });

  it('col filtro progetto i totali coincidono con il calendario filtrato', async () => {
    const prg = await db.prisma.progetto.findUniqueOrThrow({ where: { codice: 'PRG-003' } });
    const libro = await scarica('/api/esporta/calendario', { ...PERIODO, progettoIds: [prg.id] });
    const cal = await totaliCalendario(`&progettoId=${prg.id}`);
    for (const foglio of libro.worksheets) {
      const d = await db.prisma.dipendente.findFirstOrThrow({ where: { matricola: String(rigaCon(foglio, 'Matricola').getCell(2).value) } });
      expect(minuti(rigaCon(foglio, 'TOTALE ORE LAVORATE').getCell(7).value)).toBe(cal.perDipendente[d.id] ?? 0);
    }
  });
});

describe('report progetti', () => {
  it('totali per dipendente, per progetto e complessivo uguali al calendario', async () => {
    const libro = await scarica('/api/esporta/progetti', PERIODO);
    expect(libro.worksheets.map((f) => f.name)).toEqual(['Progetti per dipendente', 'Riepilogo']);
    const cal = await totaliCalendario();

    const foglio = libro.getWorksheet('Progetti per dipendente')!;
    expect(minuti(rigaCon(foglio, 'TOTALE COMPLESSIVO').getCell(4).value)).toBe(cal.totale);

    const riepilogo = libro.getWorksheet('Riepilogo')!;
    const intestazioni = (riepilogo.getRow(1).values as ExcelJS.CellValue[]).slice(1).map(String);
    const progetti = await db.prisma.progetto.findMany();
    const piede = rigaCon(riepilogo, 'TOTALE');
    for (const p of progetti) {
      const colonna = intestazioni.indexOf(p.codice) + 1;
      expect(minuti(piede.getCell(colonna).value)).toBe(cal.perProgetto[p.id] ?? 0);
    }
    expect(minuti(piede.getCell(intestazioni.length).value)).toBe(cal.totale);

    const dipendenti = await db.prisma.dipendente.findMany();
    for (const d of dipendenti) {
      expect(minuti(rigaCon(riepilogo, `${d.cognome} ${d.nome}`).getCell(intestazioni.length).value)).toBe(cal.perDipendente[d.id] ?? 0);
    }
  });

  it('calcola il costo lordo con il costo orario della scheda', async () => {
    const mario = await db.prisma.dipendente.findFirstOrThrow({ where: { cognome: 'Rossi' } });
    const libro = await scarica('/api/esporta/progetti', { ...PERIODO, dipendenteIds: [mario.id] });
    const tot = rigaCon(libro.getWorksheet('Progetti per dipendente')!, 'TOTALE');
    const m = minuti(tot.getCell(4).value);
    expect(tot.getCell(5).value).toBeCloseTo((m / 60) * (mario.costoOrarioLordoCent! / 100), 2);
  });

  it('il riepilogo prima del download dà gli stessi totali', async () => {
    const r = await admin.chiama('POST', '/api/esporta/riepilogo', PERIODO);
    expect(r.corpo.minuti).toBe((await totaliCalendario()).totale);
  });

  it('filtri non validi e accesso dei dipendenti rifiutati', async () => {
    expect((await admin.chiama('POST', '/api/esporta/progetti', { da: '2026-11-30', a: '2026-10-01' })).stato).toBe(400);
    expect((await admin.chiama('POST', '/api/esporta/progetti', { da: '2024-01-01', a: '2026-11-30' })).stato).toBe(400);
    const mario = await server.accedi('mario.rossi', CREDENZIALI_DEMO.passwordDipendenti);
    expect((await mario.chiama('POST', '/api/esporta/calendario', PERIODO)).stato).toBe(403);
  });
});
