// "><(((º> sabusabu <º)))><"
/**
 * Chiusura del mese (Giorno 37, 26/11/2026), server/servizi/mesi-chiusi.ts.
 * OGGI_PROVA è il 23/11/2026: ottobre 2026 è un mese finito, novembre no.
 * - si chiude solo un mese finito e senza richieste di assenza in attesa, solo da HR;
 * - nel mese chiuso non si toccano ore (giornata, blocco, cancellazione), assenze e festività;
 * - riaperto il mese tutto torna modificabile;
 * - "Cancella tutti i dati" toglie anche le chiusure.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CREDENZIALI_DEMO, semina } from '../../prisma/seed';
import { cancellaTuttiIDati } from '../servizi/cancella-dati';
import { estremiMese, nomeMese } from '../servizi/mesi-chiusi';
import { avviaServer, OGGI_PROVA } from './client-prova';
import { creaDbProva, type DbProva } from './db-prova';

let db: DbProva;
let server: Awaited<ReturnType<typeof avviaServer>>;

beforeAll(async () => {
  db = await creaDbProva();
  await semina(db.prisma, OGGI_PROVA);
  server = await avviaServer(db.prisma, { oggi: () => OGGI_PROVA });
});
afterAll(async () => {
  await server.chiudi();
  await db.chiudi();
});

describe('aiuti', () => {
  it('nome ed estremi del mese', () => {
    expect(nomeMese('2026-10')).toBe('ottobre 2026');
    expect(estremiMese('2026-02')).toEqual({ da: '2026-02-01', a: '2026-02-28' });
    expect(estremiMese('2028-02').a).toBe('2028-02-29');
  });
});

describe('chiusura del mese', () => {
  it('controllo, chiusura, blocco delle modifiche, riapertura', async () => {
    const admin = await server.accedi(CREDENZIALI_DEMO.admin.username, CREDENZIALI_DEMO.admin.password);
    const mario = await server.accedi('mario.rossi', CREDENZIALI_DEMO.passwordDipendenti);
    const rossi = await db.prisma.dipendente.findFirstOrThrow({ where: { cognome: 'Rossi' } });
    const progetto = await db.prisma.progetto.findFirstOrThrow({ where: { assegnazioni: { some: { dipendenteId: rossi.id } } } });
    // Un giorno lavorativo di ottobre con ore certe, e una richiesta di ferie in attesa.
    await db.prisma.registrazioneOraria.deleteMany({ where: { dipendenteId: rossi.id, data: { gte: '2026-10-01', lte: '2026-10-31' } } });
    await db.prisma.assenza.deleteMany({ where: { dipendenteId: rossi.id, dataInizio: { lte: '2026-10-31' }, dataFine: { gte: '2026-10-01' } } });
    const fascia = await db.prisma.registrazioneOraria.create({ data: { dipendenteId: rossi.id, progettoId: progetto.id, data: '2026-10-14', oraInizio: '08:00', oraFine: '12:00' } });
    const richiesta = await db.prisma.assenza.create({ data: { dipendenteId: rossi.id, tipo: 'FERIE', dataInizio: '2026-10-20', dataFine: '2026-10-21', stato: 'RICHIESTA' } });

    // Solo HR, solo mesi finiti, niente richieste in attesa.
    expect((await mario.chiama('POST', '/api/mesi-chiusi', { mese: '2026-10' })).stato).toBe(403);
    expect((await admin.chiama('POST', '/api/mesi-chiusi', { mese: '2026-13' })).stato).toBe(400);
    const nonFinito = await admin.chiama('POST', '/api/mesi-chiusi', { mese: '2026-11' });
    expect(nonFinito.stato).toBe(400);
    expect(nonFinito.corpo.errore).toMatch(/non è ancora finito.*01\/12\/2026/);
    const controllo = await admin.chiama('GET', '/api/mesi-chiusi/2026-10/controllo');
    expect(controllo.corpo).toMatchObject({ nome: 'ottobre 2026', finito: true, chiuso: null });
    expect(controllo.corpo.richiesteInAttesa).toHaveLength(1);
    const diRossi = controllo.corpo.giorniSenzaOre.find((r: { dipendenteId: number }) => r.dipendenteId === rossi.id);
    expect(diRossi.giorni).toContain('2026-10-15');
    expect(diRossi.giorni).not.toContain('2026-10-14'); // ha ore
    expect(diRossi.giorni).not.toContain('2026-10-20'); // ha chiesto ferie
    const conAttesa = await admin.chiama('POST', '/api/mesi-chiusi', { mese: '2026-10' });
    expect(conAttesa.stato).toBe(409);
    expect(conAttesa.corpo.errore).toMatch(/una richiesta di assenza/);

    expect((await admin.chiama('POST', `/api/assenze/${richiesta.id}/decisione`, { stato: 'APPROVATA' })).stato).toBe(200);
    const chiuso = await admin.chiama('POST', '/api/mesi-chiusi', { mese: '2026-10' });
    expect(chiuso.stato).toBe(201);
    expect(chiuso.corpo).toMatchObject({ mese: '2026-10', chiusoDa: 'admin' });
    expect((await admin.chiama('POST', '/api/mesi-chiusi', { mese: '2026-10' })).stato).toBe(409);
    expect((await mario.chiama('GET', '/api/mesi-chiusi')).corpo.map((m: { mese: string }) => m.mese)).toEqual(['2026-10']);

    // Mese chiuso: niente ore, assenze, festività.
    const giornata = { dipendenteId: rossi.id, data: '2026-10-15', fasce: [{ progettoId: progetto.id, oraInizio: '08:00', oraFine: '12:00' }] };
    const ore = await admin.chiama('PUT', '/api/registrazioni/giornata', giornata);
    expect(ore.stato).toBe(409);
    expect(ore.corpo.errore).toMatch(/ottobre 2026 è chiuso/);
    expect((await admin.chiama('DELETE', `/api/registrazioni/${fascia.id}`)).stato).toBe(409);
    const blocco = await admin.chiama('POST', '/api/registrazioni/blocco', { dipendenteIds: [rossi.id], date: ['2026-10-30', '2026-11-02'], progettoId: progetto.id, fasce: [{ oraInizio: '08:00', oraFine: '12:00' }] });
    expect(blocco.stato).toBe(409);
    expect((await admin.chiama('POST', '/api/assenze', { dipendenteId: rossi.id, tipo: 'MALATTIA', dataInizio: '2026-10-28', dataFine: '2026-11-03', stato: 'APPROVATA' })).stato).toBe(409);
    expect((await admin.chiama('POST', `/api/assenze/${richiesta.id}/decisione`, { stato: 'RIFIUTATA', noteHr: 'Ripensamento' })).stato).toBe(409);
    expect((await admin.chiama('DELETE', `/api/assenze/${richiesta.id}`)).stato).toBe(409);
    expect((await admin.chiama('POST', '/api/festivita', { data: '2026-10-16', descrizione: 'Patrono', tipo: 'AZIENDALE' })).stato).toBe(409);
    // Il mese dopo resta libero.
    expect((await admin.chiama('PUT', '/api/registrazioni/giornata', { ...giornata, data: '2026-11-04' })).stato).toBe(200);

    // Riaperto, si corregge.
    expect((await mario.chiama('DELETE', '/api/mesi-chiusi/2026-10')).stato).toBe(403);
    expect((await admin.chiama('DELETE', '/api/mesi-chiusi/2026-10')).stato).toBe(200);
    expect((await admin.chiama('DELETE', '/api/mesi-chiusi/2026-10')).stato).toBe(404);
    expect((await admin.chiama('PUT', '/api/registrazioni/giornata', giornata)).stato).toBe(200);
  }, 60_000);

  it('"Cancella tutti i dati" toglie anche le chiusure', async () => {
    await db.prisma.meseChiuso.create({ data: { mese: '2026-09', chiusoDa: 'admin' } });
    const proprietario = await db.prisma.utente.findUniqueOrThrow({ where: { username: 'admin' } });
    await cancellaTuttiIDati(db.prisma, 'database:', proprietario.id, OGGI_PROVA);
    expect(await db.prisma.meseChiuso.count()).toBe(0);
  });
});
