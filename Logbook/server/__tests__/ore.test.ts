// "><(((º> sabusabu <º)))><"
/**
 * Giorno 4 — registrazione ore tramite API. Criterio "fatto quando": i test passano e
 * una sovrapposizione viene bloccata (con messaggio chiaro).
 *
 * "Oggi" è lunedì 23/11/2026 (OGGI_PROVA): il seed ha ore fino a venerdì 20, quindi
 * il 23 è libero per le prove.
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
let idGiulia: number;
let prg1: number;
let prg2: number;
/** PRG-003: assegnato a Mario nel seed (PRG-002 no, Giorno 17). */
let prg3: number;

beforeAll(async () => {
  db = await creaDbProva();
  await semina(db.prisma, OGGI_PROVA);
  server = await avviaServer(db.prisma);
  admin = await server.accedi(CREDENZIALI_DEMO.admin.username, CREDENZIALI_DEMO.admin.password);
  mario = await server.accedi('mario.rossi', CREDENZIALI_DEMO.passwordDipendenti);
  idMario = (await db.prisma.dipendente.findFirstOrThrow({ where: { cognome: 'Rossi' } })).id;
  idGiulia = (await db.prisma.dipendente.findFirstOrThrow({ where: { cognome: 'Bianchi' } })).id;
  prg1 = (await db.prisma.progetto.findUniqueOrThrow({ where: { codice: 'PRG-001' } })).id;
  prg2 = (await db.prisma.progetto.findUniqueOrThrow({ where: { codice: 'PRG-002' } })).id;
  prg3 = (await db.prisma.progetto.findUniqueOrThrow({ where: { codice: 'PRG-003' } })).id;
});

afterAll(async () => {
  await server.chiudi();
  await db.chiudi();
});

describe('fasce singole', () => {
  let idFascia: number;

  it('il dipendente registra una fascia: le ore sono calcolate', async () => {
    const r = await mario.chiama('POST', '/api/registrazioni', { dipendenteId: idMario, data: OGGI_PROVA, progettoId: prg1, oraInizio: '07:30', oraFine: '12:15' });
    expect(r.stato).toBe(201);
    expect(r.corpo.minuti).toBe(285);
    idFascia = r.corpo.id;
  });

  it('una fascia sovrapposta viene bloccata con messaggio chiaro (409)', async () => {
    const r = await mario.chiama('POST', '/api/registrazioni', { dipendenteId: idMario, data: OGGI_PROVA, progettoId: prg3, oraInizio: '12:00', oraFine: '13:00' });
    expect(r.stato).toBe(409);
    expect(r.corpo.errore).toBe('La fascia 12:00-13:00 si sovrappone a quella già registrata 07:30-12:15 (progetto PRG-001) del 23/11/2026');
    expect(r.corpo.campi.oraInizio).toBeDefined();
  });

  it('una fascia contigua è ammessa', async () => {
    const r = await mario.chiama('POST', '/api/registrazioni', { dipendenteId: idMario, data: OGGI_PROVA, progettoId: prg3, oraInizio: '12:15', oraFine: '13:00' });
    expect(r.stato).toBe(201);
  });

  it('in modifica non si scontra con sé stessa, ma sì con le altre', async () => {
    const ok = await mario.chiama('PUT', `/api/registrazioni/${idFascia}`, { dipendenteId: idMario, data: OGGI_PROVA, progettoId: prg1, oraInizio: '07:00', oraFine: '12:15' });
    expect(ok.stato).toBe(200);
    const ko = await mario.chiama('PUT', `/api/registrazioni/${idFascia}`, { dipendenteId: idMario, data: OGGI_PROVA, progettoId: prg1, oraInizio: '07:00', oraFine: '12:30' });
    expect(ko.stato).toBe(409);
  });

  it('rifiuta orari rovesciati, giorni futuri e progetti inesistenti', async () => {
    const rovesciata = await mario.chiama('POST', '/api/registrazioni', { dipendenteId: idMario, data: OGGI_PROVA, progettoId: prg1, oraInizio: '18:00', oraFine: '17:00' });
    expect(rovesciata.stato).toBe(400);
    expect(rovesciata.corpo.campi.oraFine).toMatch(/dopo/);
    const futuro = await mario.chiama('POST', '/api/registrazioni', { dipendenteId: idMario, data: '2026-11-24', progettoId: prg1, oraInizio: '08:00', oraFine: '09:00' });
    expect(futuro.stato).toBe(400);
    expect(futuro.corpo.errore).toMatch(/futuri/);
    const inesistente = await mario.chiama('POST', '/api/registrazioni', { dipendenteId: idMario, data: OGGI_PROVA, progettoId: 9999, oraInizio: '18:00', oraFine: '19:00' });
    expect(inesistente.stato).toBe(400);
    expect(inesistente.corpo.campi.progettoId).toMatch(/inesistente/);
  });

  it('rifiuta ore in un giorno di ferie approvate', async () => {
    const ferie = await db.prisma.assenza.findFirstOrThrow({ where: { dipendenteId: idMario, tipo: 'FERIE', stato: 'APPROVATA' } });
    // Giorno passato: dal Giorno 19 lo scrive solo HR, che riceve comunque il no per le ferie.
    const r = await admin.chiama('POST', '/api/registrazioni', { dipendenteId: idMario, data: ferie.dataInizio, progettoId: prg1, oraInizio: '08:00', oraFine: '09:00' });
    expect(r.stato).toBe(400);
    expect(r.corpo.errore).toMatch(/ferie/);
  });

  it('il dipendente non può scrivere, modificare o cancellare le ore di un collega', async () => {
    expect((await mario.chiama('POST', '/api/registrazioni', { dipendenteId: idGiulia, data: OGGI_PROVA, progettoId: prg1, oraInizio: '08:00', oraFine: '09:00' })).stato).toBe(403);
    const fasciaGiulia = await db.prisma.registrazioneOraria.findFirstOrThrow({ where: { dipendenteId: idGiulia } });
    expect((await mario.chiama('PUT', `/api/registrazioni/${fasciaGiulia.id}`, { dipendenteId: idMario, data: OGGI_PROVA, progettoId: prg1, oraInizio: '20:00', oraFine: '21:00' })).stato).toBe(403);
    expect((await mario.chiama('DELETE', `/api/registrazioni/${fasciaGiulia.id}`)).stato).toBe(403);
  });

  it('cancella una fascia propria', async () => {
    expect((await mario.chiama('DELETE', `/api/registrazioni/${idFascia}`)).stato).toBe(200);
  });
});

describe('giornata intera', () => {
  it('sostituisce le fasce del giorno e calcola le ore', async () => {
    const r = await admin.chiama('PUT', '/api/registrazioni/giornata', {
      dipendenteId: idGiulia,
      data: OGGI_PROVA,
      fasce: [
        { progettoId: prg1, oraInizio: '08:30', oraFine: '13:00', note: 'Sopralluogo' },
        { progettoId: prg2, oraInizio: '14:00', oraFine: '17:30' },
      ],
    });
    expect(r.stato).toBe(200);
    expect(r.corpo.map((f: { minuti: number }) => f.minuti)).toEqual([270, 210]);
  });

  it('righe sovrapposte: 400 con l\'errore sulla riga, e il giorno resta com\'era', async () => {
    const r = await admin.chiama('PUT', '/api/registrazioni/giornata', {
      dipendenteId: idGiulia,
      data: OGGI_PROVA,
      fasce: [
        { progettoId: prg1, oraInizio: '08:00', oraFine: '12:00' },
        { progettoId: prg2, oraInizio: '11:30', oraFine: '15:00' },
      ],
    });
    expect(r.stato).toBe(400);
    expect(r.corpo.campi['fasce.1.oraInizio']).toMatch(/sovrappone/);
    const fasce = await db.prisma.registrazioneOraria.findMany({ where: { dipendenteId: idGiulia, data: OGGI_PROVA } });
    expect(fasce).toHaveLength(2);
  });

  it('una giornata vuota cancella le fasce del giorno', async () => {
    const r = await admin.chiama('PUT', '/api/registrazioni/giornata', { dipendenteId: idGiulia, data: OGGI_PROVA, fasce: [] });
    expect(r.stato).toBe(200);
    expect(r.corpo).toEqual([]);
  });
});
