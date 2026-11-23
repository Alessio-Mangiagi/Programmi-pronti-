// "><(((º> sabusabu <º)))><"
/**
 * Giorno 2 — accesso e ruoli. Criterio "fatto quando": un dipendente non può leggere
 * i dati degli altri nemmeno chiamando le API direttamente.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CREDENZIALI_DEMO, semina } from '../../prisma/seed';
import { avviaServer, type ClientProva } from './client-prova';
import { creaDbProva, type DbProva } from './db-prova';

let db: DbProva;
let server: Awaited<ReturnType<typeof avviaServer>>;
let admin: ClientProva;
let mario: ClientProva;
let idMario: number;
let idGiulia: number;

beforeAll(async () => {
  db = await creaDbProva();
  await semina(db.prisma, '2026-11-23');
  server = await avviaServer(db.prisma);
  admin = await server.accedi(CREDENZIALI_DEMO.admin.username, CREDENZIALI_DEMO.admin.password);
  mario = await server.accedi('mario.rossi', CREDENZIALI_DEMO.passwordDipendenti);
  idMario = (await db.prisma.dipendente.findFirstOrThrow({ where: { cognome: 'Rossi' } })).id;
  idGiulia = (await db.prisma.dipendente.findFirstOrThrow({ where: { cognome: 'Bianchi' } })).id;
});

afterAll(async () => {
  await server.chiudi();
  await db.chiudi();
});

describe('login', () => {
  it('senza login le API rispondono 401', async () => {
    expect((await server.anonimo.chiama('GET', '/api/dipendenti')).stato).toBe(401);
    expect((await server.anonimo.chiama('GET', '/api/auth/io')).stato).toBe(401);
    expect((await server.anonimo.chiama('GET', '/api/salute')).stato).toBe(200);
  });

  it('password sbagliata: 401 con messaggio che non rivela se l\'utente esiste', async () => {
    const r1 = await server.anonimo.chiama('POST', '/api/auth/login', { username: 'mario.rossi', password: 'sbagliata1' });
    const r2 = await server.anonimo.chiama('POST', '/api/auth/login', { username: 'nessuno', password: 'sbagliata1' });
    expect(r1.stato).toBe(401);
    expect(r1.corpo.errore).toBe(r2.corpo.errore);
  });

  it('dopo 5 tentativi sbagliati blocca per 15 minuti (429)', async () => {
    for (let i = 0; i < 5; i++) {
      await server.anonimo.chiama('POST', '/api/auth/login', { username: 'chiara.ferrari', password: 'x' + i });
    }
    const r = await server.anonimo.chiama('POST', '/api/auth/login', {
      username: 'chiara.ferrari',
      password: CREDENZIALI_DEMO.passwordDipendenti,
    });
    expect(r.stato).toBe(429);
  });

  it('/api/auth/io dice chi è collegato e con che ruolo', async () => {
    const io = await mario.chiama('GET', '/api/auth/io');
    expect(io.corpo).toMatchObject({ username: 'mario.rossi', ruolo: 'DIPENDENTE', dipendenteId: idMario, nomeVisualizzato: 'Mario Rossi' });
    expect((await admin.chiama('GET', '/api/auth/io')).corpo.ruolo).toBe('ADMIN');
  });

  it('senza intestazione CSRF le richieste che modificano dati sono rifiutate', async () => {
    const r = await server.anonimo.chiama('POST', '/api/auth/login', { username: 'admin', password: 'x' }, { senzaCsrf: true });
    expect(r.stato).toBe(403);
  });

  it('logout: il cookie non vale più', async () => {
    const sessione = await server.accedi('luca.esposito', CREDENZIALI_DEMO.passwordDipendenti);
    expect((await sessione.chiama('GET', '/api/auth/io')).stato).toBe(200);
    await sessione.chiama('POST', '/api/auth/logout');
    expect((await sessione.chiama('GET', '/api/auth/io')).stato).toBe(401);
  });

  it('un utente disattivato perde subito l\'accesso', async () => {
    const sessione = await server.accedi('giuseppe.russo', CREDENZIALI_DEMO.passwordDipendenti);
    await db.prisma.utente.update({ where: { username: 'giuseppe.russo' }, data: { attivo: false } });
    expect((await sessione.chiama('GET', '/api/auth/io')).stato).toBe(401);
    await db.prisma.utente.update({ where: { username: 'giuseppe.russo' }, data: { attivo: true } });
  });

  it('cambio password: serve quella attuale, la nuova deve essere robusta', async () => {
    const sessione = await server.accedi('giuseppe.russo', CREDENZIALI_DEMO.passwordDipendenti);
    expect((await sessione.chiama('POST', '/api/auth/password', { attuale: 'sbagliata', nuova: 'NuovaPass123' })).stato).toBe(400);
    expect((await sessione.chiama('POST', '/api/auth/password', { attuale: CREDENZIALI_DEMO.passwordDipendenti, nuova: 'corta' })).stato).toBe(400);
    const ok = await sessione.chiama('POST', '/api/auth/password', { attuale: CREDENZIALI_DEMO.passwordDipendenti, nuova: 'NuovaPass123' });
    expect(ok.stato).toBe(200);
    await server.accedi('giuseppe.russo', 'NuovaPass123');
  });
});

describe('separazione dei dati per ruolo', () => {
  it('il dipendente vede solo la propria scheda, senza costi orari', async () => {
    const r = await mario.chiama('GET', '/api/dipendenti');
    expect(r.stato).toBe(200);
    expect(r.corpo).toHaveLength(1);
    expect(r.corpo[0].id).toBe(idMario);
    expect(r.corpo[0]).not.toHaveProperty('costoOrarioLordoCent');
  });

  it('il dipendente non può leggere la scheda di un collega (403)', async () => {
    expect((await mario.chiama('GET', `/api/dipendenti/${idGiulia}`)).stato).toBe(403);
    expect((await mario.chiama('GET', `/api/dipendenti/${idMario}`)).stato).toBe(200);
  });

  it('il dipendente non può leggere le ore di un collega (403) e di default vede solo le sue', async () => {
    expect((await mario.chiama('GET', `/api/registrazioni?dipendenteId=${idGiulia}`)).stato).toBe(403);
    const proprie = await mario.chiama('GET', '/api/registrazioni');
    expect(proprie.stato).toBe(200);
    expect(proprie.corpo.length).toBeGreaterThan(0);
    expect(new Set(proprie.corpo.map((f: { dipendenteId: number }) => f.dipendenteId))).toEqual(new Set([idMario]));
  });

  it('il dipendente non accede alle funzioni HR', async () => {
    expect((await mario.chiama('GET', '/api/stato-dati')).stato).toBe(403);
  });

  it('l\'admin vede tutti i dipendenti, con i costi, e le ore di tutti', async () => {
    const r = await admin.chiama('GET', '/api/dipendenti');
    expect(r.corpo).toHaveLength(5);
    expect(r.corpo[0]).toHaveProperty('costoOrarioLordoCent');
    const giulia = await admin.chiama('GET', `/api/registrazioni?dipendenteId=${idGiulia}`);
    expect(giulia.stato).toBe(200);
    expect(giulia.corpo.length).toBeGreaterThan(0);
  });
});
