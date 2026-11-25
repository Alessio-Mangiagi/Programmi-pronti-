// "><(((º> sabusabu <º)))><"
/**
 * Giorno 35 (25/11/2026) — Logbook su Vercel: quello che lì non può stare in memoria o su
 * disco sta nel database. Questi test girano su SQLite ma usano le stesse strade che su
 * Vercel girano su PostgreSQL:
 * - file caricati nella tabella ContenutoFile (cartella = ARCHIVIO_NEL_DATABASE), massimo 4 MB;
 * - blocco progressivo dei tentativi nella tabella TentativoAccesso, anche con richieste parallele;
 * - stato a scadenza (codici, accessi in attesa) nella tabella StatoTemporaneo;
 * - riconoscimento di PostgreSQL dall'indirizzo e data di oggi nel fuso italiano.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oggiItalia } from '../../comune/date';
import { CREDENZIALI_DEMO, semina } from '../../prisma/seed';
import { suPostgres } from '../database-url';
import { ARCHIVIO_NEL_DATABASE } from '../servizi/archivio-file';
import { cancellaTuttiIDati } from '../servizi/cancella-dati';
import { statoTemporaneo } from '../servizi/stato-temporaneo';
import { avviaServer, OGGI_PROVA } from './client-prova';
import { creaDbProva, type DbProva } from './db-prova';

let db: DbProva;
let ora = Date.UTC(2026, 10, 23, 8, 0);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n');

beforeAll(async () => {
  db = await creaDbProva();
  await semina(db.prisma, OGGI_PROVA);
});
afterAll(async () => {
  await db.chiudi();
});

describe('riconoscimento dell\'ambiente', () => {
  it('PostgreSQL si riconosce dall\'indirizzo; oggi è la data italiana anche con l\'orologio in UTC', () => {
    expect(suPostgres('postgres://u:p@host/db')).toBe(true);
    expect(suPostgres('postgresql://u:p@host/db?sslmode=require')).toBe(true);
    expect(suPostgres('file:C:/dati/logbook.db')).toBe(false);
    expect(suPostgres(undefined)).toBe(false);
    // 23:30 UTC del 30 giugno = 01:30 del 1° luglio in Italia (ora legale).
    expect(oggiItalia(new Date(Date.UTC(2026, 5, 30, 23, 30)))).toBe('2026-07-01');
    // 23:30 UTC del 31 dicembre = 00:30 del 1° gennaio in Italia (ora solare).
    expect(oggiItalia(new Date(Date.UTC(2026, 11, 31, 23, 30)))).toBe('2027-01-01');
  });
});

describe('file caricati nel database', () => {
  it('caricamento, lettura, limite di 4 MB e cancellazione senza toccare il disco', async () => {
    const server = await avviaServer(db.prisma, { oggi: () => OGGI_PROVA, cartellaDocumenti: ARCHIVIO_NEL_DATABASE });
    try {
      const admin = await server.accedi(CREDENZIALI_DEMO.admin.username, CREDENZIALI_DEMO.admin.password);
      const nome = { intestazioni: { 'X-Nome-File': 'Verbale.pdf' } };
      const caricato = await admin.chiama('POST', '/api/file', undefined, { grezzo: PDF, ...nome });
      expect(caricato.stato).toBe(201);
      expect(await db.prisma.contenutoFile.count()).toBe(1);
      const letto = await admin.chiama('GET', `/api/file/${caricato.corpo.id}`);
      expect(letto.stato).toBe(200);
      expect((letto.corpo as Buffer).equals(PDF)).toBe(true);
      const grande = await admin.chiama('POST', '/api/file', undefined, { grezzo: Buffer.concat([PDF, Buffer.alloc(4 * 1024 * 1024)]), ...nome });
      expect(grande.stato).toBe(413);
      expect(grande.corpo.errore).toMatch(/4 MB/);
      // "Cancella tutti i dati" toglie anche i contenuti dal database.
      const proprietario = await db.prisma.utente.findUniqueOrThrow({ where: { username: 'admin' } });
      await cancellaTuttiIDati(db.prisma, ARCHIVIO_NEL_DATABASE, proprietario.id, OGGI_PROVA);
      expect(await db.prisma.contenutoFile.count()).toBe(0);
      expect(await db.prisma.fileCaricato.count()).toBe(0);
    } finally {
      await server.chiudi();
    }
  });
});

describe('blocco progressivo tenuto nel database', () => {
  it('20 tentativi in parallelo: 10 valgono; poi 5 e 10 minuti; l\'accesso riuscito azzera', async () => {
    await semina(db.prisma, OGGI_PROVA);
    const server = await avviaServer(db.prisma, { oggi: () => OGGI_PROVA, adesso: () => ora, limitatoreSuDatabase: true });
    try {
      const login = (password: string) => server.anonimo.chiama('POST', '/api/auth/login', { username: 'luca.esposito', password });
      const stati = (await Promise.all(Array.from({ length: 20 }, () => login('Sbagliata1')))).map((r) => r.stato);
      expect(stati.filter((s) => s === 401)).toHaveLength(10);
      expect(stati.filter((s) => s === 429)).toHaveLength(10);
      expect((await login(CREDENZIALI_DEMO.passwordDipendenti)).corpo.errore).toMatch(/minuti/);
      ora += 5 * 60 * 1000 + 1000;
      for (let i = 0; i < 10; i++) expect((await login('Sbagliata1')).stato).toBe(401);
      expect((await login('Sbagliata1')).corpo.errore).toMatch(/10 minuti/);
      ora += 10 * 60 * 1000 + 1000;
      expect((await login(CREDENZIALI_DEMO.passwordDipendenti)).stato).toBe(200);
      expect(await db.prisma.tentativoAccesso.count({ where: { chiave: { contains: 'luca.esposito' } } })).toBe(0);
    } finally {
      await server.chiudi();
    }
  }, 60_000);
});

describe('stato a scadenza nel database', () => {
  it('si legge fino alla scadenza, poi sparisce; la pulizia toglie gli scaduti', async () => {
    let adesso = 1_000_000;
    const stato = statoTemporaneo(db.prisma, () => adesso);
    await stato.scrivi('prova:a', { n: 1 }, adesso + 1000);
    await stato.scrivi('prova:b', { n: 2 }, adesso + 5000);
    expect(await stato.leggi<{ n: number }>('prova:a')).toEqual({ n: 1 });
    await stato.scrivi('prova:a', { n: 3 }, adesso + 1000);
    expect(await stato.leggi<{ n: number }>('prova:a')).toEqual({ n: 3 });
    adesso += 2000;
    expect(await stato.leggi('prova:a')).toBeNull();
    expect(await stato.leggi<{ n: number }>('prova:b')).toEqual({ n: 2 });
    adesso += 10_000;
    expect(await stato.pulisci()).toBeGreaterThanOrEqual(1);
    expect(await db.prisma.statoTemporaneo.count({ where: { chiave: { startsWith: 'prova:' } } })).toBe(0);
  });
});
