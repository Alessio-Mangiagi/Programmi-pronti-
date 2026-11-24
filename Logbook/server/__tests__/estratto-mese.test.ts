// "><(((º> sabusabu <º)))><"
/**
 * Giorno 11 — estratti mensili: "mese a calendario" e "giorni e costi".
 * Si controllano i numeri (ore uguali al calendario, ferie/malattia/permessi valorizzati
 * con il costo orario) e la forma dei due file Excel.
 */
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EstrattoDipendente } from '../../comune/estratto-mese';
import { CREDENZIALI_DEMO, semina } from '../../prisma/seed';
import { avviaServer, OGGI_PROVA, type ClientProva } from './client-prova';
import { creaDbProva, type DbProva } from './db-prova';

let db: DbProva;
let server: Awaited<ReturnType<typeof avviaServer>>;
let admin: ClientProva;
let estratti: EstrattoDipendente[];

const minuti = (v: ExcelJS.CellValue) => Math.round((v instanceof Date ? v.getTime() / 86_400_000 + 25569 : Number(v)) * 1440);

beforeAll(async () => {
  db = await creaDbProva();
  await semina(db.prisma, OGGI_PROVA);
  server = await avviaServer(db.prisma);
  admin = await server.accedi(CREDENZIALI_DEMO.admin.username, CREDENZIALI_DEMO.admin.password);
  const r = await admin.chiama('POST', '/api/esporta/mese', { mese: '2026-10' });
  expect(r.stato).toBe(200);
  expect(r.corpo.nomeMese).toBe('Ottobre 2026');
  estratti = r.corpo.estratti;
});

afterAll(async () => {
  await server.chiudi();
  await db.chiudi();
});

describe('dati dell\'estratto', () => {
  it('ore del mese per dipendente uguali al calendario', async () => {
    const cal = await admin.chiama('GET', '/api/calendario?da=2026-10-01&a=2026-10-31');
    expect(estratti).toHaveLength(5);
    for (const e of estratti) {
      // Ottobre 2026 ha 31 giorni, 22 da lunedì a venerdì: sabato e domenica non ci sono (Giorno 25).
      expect(e.giorni).toHaveLength(22);
      expect(e.giorni.every((g) => g.giornoSettimana >= 1 && g.giornoSettimana <= 5)).toBe(true);
      expect(e.totali.minutiLavorati).toBe(cal.corpo.totali.perDipendente[e.dipendente.id] ?? 0);
    }
  });

  it('ferie valorizzate a ore di contratto e costo del giorno = ore retribuite × costo orario', async () => {
    const rossi = estratti.find((e) => e.dipendente.cognome === 'Rossi')!;
    expect(rossi.totali.giorniFerie).toBe(3);
    expect(rossi.totali.minutiFerie).toBe(3 * 8 * 60);
    const giornoFerie = rossi.giorni.find((g) => g.assenze.some((x) => x.tipo === 'FERIE'))!;
    expect(giornoFerie.minutiLavorati).toBe(0);
    expect(giornoFerie.costoLordoCent).toBe(8 * 2780);
    expect(giornoFerie.costoNettoCent).toBe(8 * 1450);
    const lordoAtteso = Math.round((rossi.totali.minutiRetribuiti * 2780) / 60);
    expect(rossi.totali.costoLordoCent).toBe(lordoAtteso);
    // Niente sabati e domeniche fra i giorni (Giorno 25), ma il costo del mese resta la somma dei giorni
    expect(rossi.giorni.find((g) => g.giornoSettimana === 0 || g.giornoSettimana === 6)).toBeUndefined();
    expect(rossi.giorni.reduce((s, g) => s + (g.costoLordoCent ?? 0), 0)).toBe(rossi.totali.costoLordoCent);
  });

  it('permesso: ore lavorate + durata del permesso', async () => {
    const bianchi = estratti.find((e) => e.dipendente.cognome === 'Bianchi')!;
    const giorno = bianchi.giorni.find((g) => g.assenze.some((x) => x.tipo === 'PERMESSO'))!;
    expect(giorno.minutiRetribuiti).toBe(giorno.minutiLavorati + 120);
    expect(giorno.minutiRetribuiti).toBe(8 * 60);
  });

  it('i progetti in basso hanno descrizione, massimo giornaliero e ore del mese', async () => {
    const rossi = estratti.find((e) => e.dipendente.cognome === 'Rossi')!;
    const somma = rossi.progetti.reduce((s, p) => s + p.minuti, 0);
    expect(somma).toBe(rossi.totali.minutiLavorati);
    expect(rossi.progetti.find((p) => p.codice === 'PRG-001')).toMatchObject({ nome: 'Ristrutturazione scuola media', maxMinutiGiorno: 540 });
  });

  it('mese non valido o prima del 2020: 400', async () => {
    expect((await admin.chiama('POST', '/api/esporta/mese', { mese: '2019-12' })).stato).toBe(400);
    expect((await admin.chiama('POST', '/api/esporta/mese', { mese: '2026-13' })).stato).toBe(400);
  });
});

describe('Excel', () => {
  const scarica = async (percorso: string) => {
    const r = await admin.chiama('POST', percorso, { mese: '2026-10' });
    expect(r.stato).toBe(200);
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(r.corpo);
    return libro;
  };

  it('mese a calendario: griglia a sinistra, anagrafica a destra, progetti in basso', async () => {
    const libro = await scarica('/api/esporta/mese/calendario');
    expect(libro.worksheets).toHaveLength(5);
    const foglio = libro.getWorksheet('Rossi Mario')!;
    expect(foglio.getCell('A1').value).toBe('Ore di Ottobre 2026');
    // Griglia da lunedì a venerdì (Giorno 25): A3-E3, niente sabato e domenica
    expect([1, 2, 3, 4, 5, 6, 7].map((c) => foglio.getCell(3, c).value ?? null)).toEqual(['Lun', 'Mar', 'Mer', 'Gio', 'Ven', null, 'Matricola']);
    // Anagrafica a destra (colonne G-H)
    const etichette: string[] = [];
    foglio.getColumn(7).eachCell((c) => etichette.push(String(c.value)));
    expect(etichette).toEqual(expect.arrayContaining(['Matricola', 'Codice fiscale', 'Costo orario lordo', 'Ore lavorate']));
    // Ore della griglia = totale del mese
    let somma = 0;
    for (let r = 5; r < 4 + 6 * 3; r += 3) for (let c = 1; c <= 5; c++) if (foglio.getCell(r, c).value != null) somma += minuti(foglio.getCell(r, c).value);
    expect(somma).toBe(estratti.find((e) => e.dipendente.cognome === 'Rossi')!.totali.minutiLavorati);
    // Progetti in basso
    const colonnaA: string[] = [];
    foglio.getColumn(1).eachCell((c) => colonnaA.push(String(c.value)));
    expect(colonnaA).toEqual(expect.arrayContaining(['Progetti del mese', 'PRG-001']));
  });

  it('giorni e costi: una riga per giorno e totali uguali all\'estratto', async () => {
    const libro = await scarica('/api/esporta/mese/giorni');
    const foglio = libro.getWorksheet('Rossi Mario')!;
    const rossi = estratti.find((e) => e.dipendente.cognome === 'Rossi')!;
    let righeGiorno = 0;
    let totale: ExcelJS.Row | undefined;
    foglio.eachRow((r) => {
      if (/^\d{2}\/10\/2026$/.test(String(r.getCell(1).value))) righeGiorno++;
      if (r.getCell(1).value === 'TOTALE') totale = r;
    });
    expect(righeGiorno).toBe(22); // solo lunedì-venerdì (Giorno 25)
    expect(minuti(totale!.getCell(3).value)).toBe(rossi.totali.minutiLavorati);
    expect(totale!.getCell(10).value).toBeCloseTo(rossi.totali.costoLordoCent! / 100, 2);
    expect(totale!.getCell(9).value).toBeCloseTo(rossi.totali.costoNettoCent! / 100, 2);
  });
});
