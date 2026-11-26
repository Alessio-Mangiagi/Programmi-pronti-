// "><(((º> sabusabu <º)))><"
/**
 * Giorni 19 e 20 (24/11/2026) — chi scrive le ore.
 *
 * Giorno 19: "solo gli admin devono poter inserire i dati nelle giornate già passate …
 * per evitare pagamenti errati", con la data di Copilota presa dal server (GET /api/oggi).
 * Giorno 20 (risposte 1b e 2): "tutti i dati li inserisce HR" — il dipendente non scrive
 * più ore né documentazione, nemmeno oggi; vede le sue giornate e, se qualcosa non torna,
 * le segnala (test in giorno20.test.ts). Qui OGGI_PROVA = lunedì 23/11/2026.
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

describe('le ore le inserisce solo HR', () => {
  it('la data di Copilota è quella del server', async () => {
    const r = await mario.chiama('GET', '/api/oggi');
    expect(r.stato).toBe(200);
    expect(r.corpo.oggi).toBe(OGGI_PROVA);
    expect(Date.parse(r.corpo.adesso)).not.toBeNaN();
  });

  it('il dipendente non scrive: né oggi né nei giorni passati, né cancellazioni', async () => {
    expect((await mario.chiama('PUT', '/api/registrazioni/giornata', giornata(OGGI_PROVA))).stato).toBe(403);
    expect((await mario.chiama('PUT', '/api/registrazioni/giornata', giornata(IERI))).stato).toBe(403);
    const vecchia = await db.prisma.registrazioneOraria.findFirstOrThrow({ where: { dipendenteId: idMario, data: IERI } });
    expect((await mario.chiama('DELETE', `/api/registrazioni/${vecchia.id}`)).stato).toBe(403);
    expect(await db.prisma.registrazioneOraria.findUnique({ where: { id: vecchia.id } })).not.toBeNull();
  });

  it('il dipendente legge le sue ore', async () => {
    const r = await mario.chiama('GET', `/api/registrazioni?dipendenteId=${idMario}&da=${IERI}&a=${IERI}`);
    expect(r.stato).toBe(200);
    expect(r.corpo.length).toBeGreaterThan(0);
  });

  it('HR scrive oggi e i giorni passati', async () => {
    expect((await admin.chiama('PUT', '/api/registrazioni/giornata', giornata(OGGI_PROVA))).stato).toBe(200);
    expect((await admin.chiama('PUT', '/api/registrazioni/giornata', giornata(IERI))).stato).toBe(200);
    const fasce = await db.prisma.registrazioneOraria.findMany({ where: { dipendenteId: idMario, data: IERI } });
    expect(fasce.map((f) => `${f.oraInizio}-${f.oraFine}`)).toEqual(['08:00-12:00']);
  });

  it('i giorni futuri restano chiusi anche a HR, con il loro messaggio', async () => {
    const futuro = await admin.chiama('PUT', '/api/registrazioni/giornata', giornata('2026-11-24'));
    expect(futuro.stato).toBe(400);
    expect(futuro.corpo.campi.data).toMatch(/futuri/);
  });

  it('documentazione di progetto: la carica solo HR, anche con date passate', async () => {
    expect((await mario.chiama('POST', '/api/documenti-progetto', { progettoId: prg1, data: OGGI_PROVA, titolo: 'Rapportino', nota: 'Fatto' })).stato).toBe(403);
    expect((await admin.chiama('POST', '/api/documenti-progetto', { progettoId: prg1, data: IERI, titolo: 'Verbale HR', nota: 'Recupero' })).stato).toBe(201);
  });
});
