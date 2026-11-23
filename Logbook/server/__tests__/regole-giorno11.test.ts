// "><(((º> sabusabu <º)))><"
/**
 * Giorno 11 — regole aggiunte il 23/11/2026:
 * - nessun inserimento con data precedente al 01/01/2020 (risposta 1b: vale ovunque);
 * - ore massime giornaliere per progetto, per dipendente, con salvataggio bloccato oltre
 *   il limite (risposta 2b). Nel seed PRG-001 e PRG-002 hanno massimo 9:00, PRG-003 nessuno.
 */
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { carattereControllo } from '../../comune/codiceFiscale';
import { CREDENZIALI_DEMO, semina } from '../../prisma/seed';
import { avviaServer, OGGI_PROVA, type ClientProva } from './client-prova';
import { creaDbProva, type DbProva } from './db-prova';

let db: DbProva;
let server: Awaited<ReturnType<typeof avviaServer>>;
let admin: ClientProva;
let mario: ClientProva;
let idMario: number;
let prg1: number;
let prg3: number;

beforeAll(async () => {
  db = await creaDbProva();
  await semina(db.prisma, OGGI_PROVA);
  server = await avviaServer(db.prisma);
  admin = await server.accedi(CREDENZIALI_DEMO.admin.username, CREDENZIALI_DEMO.admin.password);
  mario = await server.accedi('mario.rossi', CREDENZIALI_DEMO.passwordDipendenti);
  idMario = (await db.prisma.dipendente.findFirstOrThrow({ where: { cognome: 'Rossi' } })).id;
  prg1 = (await db.prisma.progetto.findUniqueOrThrow({ where: { codice: 'PRG-001' } })).id;
  prg3 = (await db.prisma.progetto.findUniqueOrThrow({ where: { codice: 'PRG-003' } })).id;
});

afterAll(async () => {
  await server.chiudi();
  await db.chiudi();
});

describe('data minima 01/01/2020', () => {
  it('rifiuta ore, assenze e festività prima del 2020', async () => {
    const ore = await admin.chiama('PUT', '/api/registrazioni/giornata', { dipendenteId: idMario, data: '2019-12-31', fasce: [] });
    expect(ore.stato).toBe(400);
    expect(ore.corpo.campi.data).toMatch(/01\/01\/2020/);
    const assenza = await mario.chiama('POST', '/api/assenze', { tipo: 'FERIE', dataInizio: '2019-12-30', dataFine: '2020-01-03' });
    expect(assenza.stato).toBe(400);
    expect((await admin.chiama('POST', '/api/festivita', { data: '2019-06-02', descrizione: 'Prova', tipo: 'AZIENDALE' })).stato).toBe(400);
    expect((await admin.chiama('POST', '/api/festivita/carica-nazionali', { anno: 2019 })).stato).toBe(400);
  });

  it('rifiuta assunzioni e progetti prima del 2020', async () => {
    const corpo = 'VRDLGU88A01H501';
    const dip = await admin.chiama('POST', '/api/dipendenti', {
      matricola: '0300', nome: 'Luigi', cognome: 'Verdi', codiceFiscale: corpo + carattereControllo(corpo),
      dataAssunzione: '2019-05-01', tipoContratto: 'INDETERMINATO', oreSettimanali: 40,
    });
    expect(dip.stato).toBe(400);
    expect(dip.corpo.campi.dataAssunzione).toMatch(/01\/01\/2020/);
    const prog = await admin.chiama('POST', '/api/progetti', { codice: 'OLD-1', nome: 'Vecchio', dataInizio: '2018-01-01' });
    expect(prog.stato).toBe(400);
  });

  it("l'import segnala le righe prima del 2020", async () => {
    const libro = new ExcelJS.Workbook();
    const f = libro.addWorksheet('Ore');
    f.addRow(['Matricola', 'Data', 'Ora inizio', 'Ora fine', 'Codice progetto', 'Note']);
    f.addRow(['0001', '15/12/2019', '08:00', '12:00', 'PRG-001', '']);
    const r = await admin.chiama('POST', '/api/importa/anteprima', undefined, { grezzo: Buffer.from(await libro.xlsx.writeBuffer()) });
    expect(r.corpo.righe[0].errori.join(' ')).toMatch(/01\/01\/2020/);
  });
});

describe('ore massime giornaliere del progetto', () => {
  it('la giornata oltre il massimo viene bloccata con l\'errore sulle righe del progetto', async () => {
    const r = await mario.chiama('PUT', '/api/registrazioni/giornata', {
      dipendenteId: idMario,
      data: OGGI_PROVA,
      fasce: [
        { progettoId: prg1, oraInizio: '07:00', oraFine: '12:00' },
        { progettoId: prg1, oraInizio: '13:00', oraFine: '17:30' },
      ],
    });
    expect(r.stato).toBe(400);
    expect(r.corpo.errore).toBe('Sul progetto PRG-001 il massimo è 9:00 ore al giorno per dipendente: così sarebbero 9:30');
    expect(Object.keys(r.corpo.campi)).toEqual(['fasce.0.progettoId', 'fasce.1.progettoId']);
  });

  it("esattamente il massimo va bene; su un progetto senza limite non c'è blocco", async () => {
    const ok = await mario.chiama('PUT', '/api/registrazioni/giornata', {
      dipendenteId: idMario,
      data: OGGI_PROVA,
      fasce: [
        { progettoId: prg1, oraInizio: '07:00', oraFine: '12:00' },
        { progettoId: prg1, oraInizio: '13:00', oraFine: '17:00' },
        { progettoId: prg3, oraInizio: '17:00', oraFine: '21:00' },
      ],
    });
    expect(ok.stato).toBe(200);
  });

  it('anche la fascia singola e l\'import contano le ore già registrate', async () => {
    const singola = await mario.chiama('POST', '/api/registrazioni', { dipendenteId: idMario, data: OGGI_PROVA, progettoId: prg1, oraInizio: '21:00', oraFine: '21:30' });
    expect(singola.stato).toBe(400);
    expect(singola.corpo.campi.progettoId).toMatch(/PRG-001/);

    const libro = new ExcelJS.Workbook();
    const f = libro.addWorksheet('Ore');
    f.addRow(['Matricola', 'Data', 'Ora inizio', 'Ora fine', 'Codice progetto', 'Note']);
    f.addRow(['0001', '23/11/2026', '21:00', '22:00', 'PRG-001', '']);
    const r = await admin.chiama('POST', '/api/importa/anteprima', undefined, { grezzo: Buffer.from(await libro.xlsx.writeBuffer()) });
    expect(r.corpo.righe[0].errori.join(' ')).toMatch(/massimo è 9:00/);
  });

  it('il massimo si legge nella scheda progetto e nel calendario', async () => {
    const p = await admin.chiama('GET', `/api/progetti/${prg1}`);
    expect(p.corpo.maxMinutiGiorno).toBe(540);
    const cal = await admin.chiama('GET', `/api/calendario?da=${OGGI_PROVA}&a=${OGGI_PROVA}&dipendenteId=${idMario}`);
    expect(cal.corpo.fasce[0].progetto.maxMinutiGiorno).toBe(540);
  });
});
