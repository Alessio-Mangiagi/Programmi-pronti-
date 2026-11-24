// "><(((º> sabusabu <º)))><"
/**
 * Giorno 27 (24/11/2026) — inserimento a blocchi dal pannello del calendario (risposta 1a:
 * più giorni con Ctrl/Maiusc, progetto, dipendenti e orari inseriti su tutti i giorni scelti).
 * POST /api/registrazioni/blocco: solo HR, regole di ogni giornata, tutto o niente.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CREDENZIALI_DEMO, semina } from '../../prisma/seed';
import { avviaServer, OGGI_PROVA, type ClientProva } from './client-prova';
import { creaDbProva, type DbProva } from './db-prova';

let db: DbProva;
let server: Awaited<ReturnType<typeof avviaServer>>;
let admin: ClientProva;
let idMario: number;
let idGiulia: number;
let prg1: number;
let prg3: number;

const DUE_FASCE = [
  { oraInizio: '08:00', oraFine: '12:00' },
  { oraInizio: '13:00', oraFine: '17:00' },
];

beforeAll(async () => {
  db = await creaDbProva();
  await semina(db.prisma, OGGI_PROVA);
  server = await avviaServer(db.prisma);
  admin = await server.accedi(CREDENZIALI_DEMO.admin.username, CREDENZIALI_DEMO.admin.password);
  idMario = (await db.prisma.dipendente.findFirstOrThrow({ where: { cognome: 'Rossi' } })).id;
  idGiulia = (await db.prisma.dipendente.findFirstOrThrow({ where: { cognome: 'Bianchi' } })).id;
  prg1 = (await db.prisma.progetto.findUniqueOrThrow({ where: { codice: 'PRG-001' } })).id;
  prg3 = (await db.prisma.progetto.findUniqueOrThrow({ where: { codice: 'PRG-003' } })).id;
});

afterAll(async () => {
  await server.chiudi();
  await db.chiudi();
});

describe('inserimento a blocchi', () => {
  it('stesse fasce per più dipendenti: si aggiungono e si contano', async () => {
    const r = await admin.chiama('POST', '/api/registrazioni/blocco', { progettoId: prg1, dipendenteIds: [idMario, idGiulia], date: [OGGI_PROVA], fasce: DUE_FASCE, note: 'Getto solaio' });
    expect(r.stato).toBe(201);
    expect(r.corpo).toMatchObject({ inserite: 4, dipendenti: 2, giorni: 1, minuti: 4 * 240 });
    const salvate = await db.prisma.registrazioneOraria.findMany({ where: { data: OGGI_PROVA, dipendenteId: { in: [idMario, idGiulia] } } });
    expect(salvate).toHaveLength(4);
    expect(salvate.every((f) => f.progettoId === prg1 && f.note === 'Getto solaio')).toBe(true);
  });

  it('tutto o niente: con un giorno sbagliato non si inserisce nulla e si dice chi, quando e perché', async () => {
    const prima = await db.prisma.registrazioneOraria.count();
    const r = await admin.chiama('POST', '/api/registrazioni/blocco', {
      progettoId: prg1,
      dipendenteIds: [idMario],
      // 20/11 ha già ore, 21/11 è sabato, 24/11 è futuro (oggi è il 23)
      date: ['2026-11-20', '2026-11-21', '2026-11-24'],
      fasce: [{ oraInizio: '08:00', oraFine: '09:00' }],
    });
    expect(r.stato).toBe(400);
    expect(r.corpo.errore).toMatch(/Nessuna ora inserita: 3 giornate/);
    const perGiorno = (data: string) => r.corpo.problemi.filter((p: { data: string }) => p.data === data).map((p: { messaggio: string }) => p.messaggio).join(' ');
    expect(perGiorno('2026-11-20')).toMatch(/si sovrappone a quella già registrata/);
    expect(perGiorno('2026-11-21')).toMatch(/sabato/);
    expect(perGiorno('2026-11-24')).toMatch(/futuri/);
    expect(r.corpo.problemi[0].dipendente).toBe('Rossi Mario');
    expect(await db.prisma.registrazioneOraria.count()).toBe(prima);
  });

  it('assegnazione al progetto e massimo del giorno valgono come nella giornata', async () => {
    // Giulia non è assegnata a PRG-003
    const assegnazione = await admin.chiama('POST', '/api/registrazioni/blocco', { progettoId: prg3, dipendenteIds: [idGiulia], date: ['2026-11-19'], fasce: [{ oraInizio: '18:00', oraFine: '19:00' }] });
    expect(assegnazione.stato).toBe(400);
    expect(assegnazione.corpo.problemi[0].messaggio).toMatch(/non è assegnat. al progetto PRG-003/);
    // Mario ha già 8 ore su PRG-001 il 23 (test sopra): altre 2 superano il massimo di 9
    const massimo = await admin.chiama('POST', '/api/registrazioni/blocco', { progettoId: prg1, dipendenteIds: [idMario], date: [OGGI_PROVA], fasce: [{ oraInizio: '17:00', oraFine: '19:00' }] });
    expect(massimo.stato).toBe(400);
    expect(massimo.corpo.problemi[0].messaggio).toMatch(/massimo è 9:00/);
  });

  it('forma: fasce sovrapposte fra loro, nessun giorno o dipendente → 400 sul campo', async () => {
    const sovrapposte = await admin.chiama('POST', '/api/registrazioni/blocco', {
      progettoId: prg1, dipendenteIds: [idMario], date: ['2026-11-19'], fasce: [{ oraInizio: '08:00', oraFine: '12:00' }, { oraInizio: '11:00', oraFine: '13:00' }],
    });
    expect(sovrapposte.stato).toBe(400);
    expect(sovrapposte.corpo.campi['fasce.1.oraInizio']).toMatch(/sovrappone/);
    const vuoto = await admin.chiama('POST', '/api/registrazioni/blocco', { progettoId: prg1, dipendenteIds: [], date: [], fasce: DUE_FASCE });
    expect(vuoto.stato).toBe(400);
    expect(Object.keys(vuoto.corpo.campi)).toEqual(expect.arrayContaining(['dipendenteIds', 'date']));
  });

  it('solo HR', async () => {
    const mario = await server.accedi('mario.rossi', CREDENZIALI_DEMO.passwordDipendenti);
    expect((await mario.chiama('POST', '/api/registrazioni/blocco', { progettoId: prg1, dipendenteIds: [idMario], date: ['2026-11-19'], fasce: DUE_FASCE })).stato).toBe(403);
  });
});
