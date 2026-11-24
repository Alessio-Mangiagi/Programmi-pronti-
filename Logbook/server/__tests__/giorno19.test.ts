// "><(((º> sabusabu <º)))><"
/**
 * Giorno 19 (24/11/2026) — "solo gli admin devono poter inserire i dati nelle giornate già
 * passate … per evitare pagamenti errati".
 *
 * Il dipendente scrive ore (e documentazione di progetto) solo nella giornata di oggi;
 * aggiungere, modificare o togliere ore dei giorni passati spetta a HR. "Oggi" è la data del
 * server (qui OGGI_PROVA = lunedì 23/11/2026), esposta in GET /api/oggi per l'interfaccia.
 * Mario Rossi è assegnato a PRG-001 e PRG-003.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CREDENZIALI_DEMO, semina } from '../../prisma/seed';
import { avviaServer, OGGI_PROVA, type ClientProva } from './client-prova';
import { creaDbProva, type DbProva } from './db-prova';

let db: DbProva;
let server: Awaited<ReturnType<typeof avviaServer>>;
let admin: ClientProva;
let mario: ClientProva;
let idMario: number;
let prg1: number;
const IERI = '2026-11-20'; // venerdì, giorno lavorativo passato con ore nel seed

beforeAll(async () => {
  db = await creaDbProva();
  await semina(db.prisma, OGGI_PROVA);
  server = await avviaServer(db.prisma);
  admin = await server.accedi(CREDENZIALI_DEMO.admin.username, CREDENZIALI_DEMO.admin.password);
  mario = await server.accedi('mario.rossi', CREDENZIALI_DEMO.passwordDipendenti);
  idMario = (await db.prisma.dipendente.findFirstOrThrow({ where: { cognome: 'Rossi' } })).id;
  prg1 = (await db.prisma.progetto.findUniqueOrThrow({ where: { codice: 'PRG-001' } })).id;
});

afterAll(async () => {
  await server.chiudi();
  await db.chiudi();
});

const giornata = (data: string) => ({ dipendenteId: idMario, data, fasce: [{ progettoId: prg1, oraInizio: '08:00', oraFine: '12:00', note: '' }] });

describe('giorni passati solo a HR', () => {
  it('la data di Logbook è quella del server', async () => {
    const r = await mario.chiama('GET', '/api/oggi');
    expect(r.stato).toBe(200);
    expect(r.corpo.oggi).toBe(OGGI_PROVA);
    expect(Date.parse(r.corpo.adesso)).not.toBeNaN();
  });

  it('il dipendente registra oggi', async () => {
    expect((await mario.chiama('PUT', '/api/registrazioni/giornata', giornata(OGGI_PROVA))).stato).toBe(200);
  });

  it('il dipendente non scrive nei giorni passati: né giornata, né fascia, né modifiche o cancellazioni', async () => {
    const giorno = await mario.chiama('PUT', '/api/registrazioni/giornata', giornata(IERI));
    expect(giorno.stato).toBe(403);
    expect(giorno.corpo.errore).toMatch(/20\/11\/2026 è un giorno passato.*solo HR/);
    expect((await mario.chiama('POST', '/api/registrazioni', { dipendenteId: idMario, data: IERI, progettoId: prg1, oraInizio: '18:00', oraFine: '19:00' })).stato).toBe(403);
    const vecchia = await db.prisma.registrazioneOraria.findFirstOrThrow({ where: { dipendenteId: idMario, data: IERI } });
    expect((await mario.chiama('PUT', `/api/registrazioni/${vecchia.id}`, { dipendenteId: idMario, data: IERI, progettoId: vecchia.progettoId, oraInizio: vecchia.oraInizio, oraFine: '12:00' })).stato).toBe(403);
    // Spostare a oggi una fascia di un giorno passato non è un modo per aggirare la regola.
    expect((await mario.chiama('PUT', `/api/registrazioni/${vecchia.id}`, { dipendenteId: idMario, data: OGGI_PROVA, progettoId: vecchia.progettoId, oraInizio: '13:00', oraFine: '14:00' })).stato).toBe(403);
    expect((await mario.chiama('DELETE', `/api/registrazioni/${vecchia.id}`)).stato).toBe(403);
    expect(await db.prisma.registrazioneOraria.findUnique({ where: { id: vecchia.id } })).not.toBeNull();
  });

  it('HR scrive e corregge i giorni passati', async () => {
    expect((await admin.chiama('PUT', '/api/registrazioni/giornata', giornata(IERI))).stato).toBe(200);
    const fasce = await db.prisma.registrazioneOraria.findMany({ where: { dipendenteId: idMario, data: IERI } });
    expect(fasce.map((f) => `${f.oraInizio}-${f.oraFine}`)).toEqual(['08:00-12:00']);
  });

  it('i giorni futuri restano chiusi a tutti, con il loro messaggio', async () => {
    const futuro = await mario.chiama('PUT', '/api/registrazioni/giornata', giornata('2026-11-24'));
    expect(futuro.stato).toBe(400);
    expect(futuro.corpo.campi.data).toMatch(/futuri/);
    expect((await admin.chiama('PUT', '/api/registrazioni/giornata', giornata('2026-11-24'))).stato).toBe(400);
  });

  it('documentazione di progetto: il dipendente solo con la data di oggi', async () => {
    const passata = await mario.chiama('POST', '/api/documenti-progetto', { progettoId: prg1, data: IERI, titolo: 'Rapportino', nota: 'Fatto' });
    expect(passata.stato).toBe(403);
    expect((await mario.chiama('POST', '/api/documenti-progetto', { progettoId: prg1, data: OGGI_PROVA, titolo: 'Rapportino', nota: 'Fatto' })).stato).toBe(201);
    expect((await admin.chiama('POST', '/api/documenti-progetto', { progettoId: prg1, data: IERI, titolo: 'Verbale HR', nota: 'Recupero' })).stato).toBe(201);
  });
});
