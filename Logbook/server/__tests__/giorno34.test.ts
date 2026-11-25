// "><(((º> sabusabu <º)))><"
/**
 * Giorno 34 (25/11/2026) — rafforzamento della sicurezza chiesto dall'utente:
 * - copia di sicurezza del database con SQL (VACUUM INTO), anche prima di "Cancella tutti i dati";
 * - blocco progressivo: 10 password sbagliate → 5 minuti, poi 10, 20…;
 * - sessione chiusa dopo 15 minuti senza azioni dell'utente;
 * - codice via email all'accesso degli amministratori da un PC non ancora fidato;
 * - primo amministratore con le credenziali dell'installazione, ruolo dato solo dal proprietario;
 * - password più robuste (12 caratteri per gli amministratori, niente password comuni);
 * - registro delle attività, leggibile solo dagli amministratori.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CREDENZIALI_DEMO, semina } from '../../prisma/seed';
import { controllaPasswordNuova, creaImpronta } from '../auth/password';
import { assicuraAdmin } from '../auth/password-provvisorie';
import { backupSeManca, creaBackup } from '../servizi/backup';
import type { Email } from '../servizi/email';
import { avviaServer, OGGI_PROVA, type Risposta } from './client-prova';
import { creaDbProva, type DbProva } from './db-prova';

const EMAIL = 'proprietario@esempio.it';
let db: DbProva;
let cartellaBackup: string;
const posta: Email[] = [];
let ora = Date.UTC(2026, 10, 23, 8, 0);
const base = () => ({
  oggi: () => OGGI_PROVA,
  proprietario: { username: 'admin', email: EMAIL },
  inviaEmail: async (e: Email) => void posta.push(e),
  adesso: () => ora,
  cartellaBackup,
});
const ultimoCodice = () => /codice(?: di accesso)? (\d{6})/.exec(posta.at(-1)?.oggetto ?? '')?.[1] ?? '';
/** Cookie impostati da una risposta, pronti per l'intestazione Cookie della richiesta dopo. */
const cookieDi = (r: Risposta) => r.intestazioni.getSetCookie().map((c) => c.split(';')[0]).filter((c) => !c.endsWith('=')).join('; ');

beforeAll(async () => {
  db = await creaDbProva();
  await semina(db.prisma, OGGI_PROVA);
  await db.prisma.utente.create({ data: { username: 'hr.due', passwordHash: await creaImpronta('SecondoHr2026'), ruolo: 'ADMIN' } });
  cartellaBackup = fs.mkdtempSync(path.join(os.tmpdir(), 'logbook-backup-'));
});
afterAll(async () => {
  await db.chiudi();
  fs.rmSync(cartellaBackup, { recursive: true, force: true });
});

describe('copia di sicurezza con SQL', () => {
  it('VACUUM INTO crea un database completo e copia i file caricati; quella di oggi non si rifà', async () => {
    const documenti = fs.mkdtempSync(path.join(os.tmpdir(), 'logbook-doc-'));
    fs.writeFileSync(path.join(documenti, 'a.pdf'), '%PDF-1.4');
    const adesso = new Date(2026, 10, 23, 9, 0);
    const r = await backupSeManca(db.prisma, documenti, cartellaBackup, adesso);
    expect(path.basename(r!.file)).toBe('logbook-2026-11-23.db');
    expect(r!.documentiCopiati).toBe(1);
    const copia = new Database(r!.file, { readonly: true });
    expect((copia.prepare('select count(*) n from Dipendente').get() as { n: number }).n).toBe(5);
    copia.close();
    expect(await backupSeManca(db.prisma, documenti, cartellaBackup, adesso)).toBeNull();
    // Un file tolto dall'originale resta nella copia, segnato, per 30 giorni; poi sparisce.
    fs.rmSync(path.join(documenti, 'a.pdf'));
    await creaBackup(db.prisma, documenti, { cartella: cartellaBackup, adesso });
    expect(fs.existsSync(path.join(cartellaBackup, 'documenti', 'a.pdf.tolto'))).toBe(true);
    await creaBackup(db.prisma, documenti, { cartella: cartellaBackup, adesso: new Date(2026, 11, 28, 9, 0) });
    expect(fs.existsSync(path.join(cartellaBackup, 'documenti', 'a.pdf.tolto'))).toBe(false);
    fs.rmSync(documenti, { recursive: true, force: true });
  });
});

describe('blocco progressivo dei tentativi', () => {
  it('10 sbagliate → 5 minuti; altre 10 → 10 minuti; l\'accesso riuscito azzera', async () => {
    const server = await avviaServer(db.prisma, base());
    try {
      const login = (password: string) => server.anonimo.chiama('POST', '/api/auth/login', { username: 'luca.esposito', password });
      for (let i = 0; i < 10; i++) expect((await login('Sbagliata1')).stato).toBe(401);
      const primo = await login('Sbagliata1');
      expect(primo.stato).toBe(429);
      expect(primo.corpo.errore).toMatch(/5 minuti/);
      // Durante l'attesa anche la password giusta è rifiutata.
      expect((await login(CREDENZIALI_DEMO.passwordDipendenti)).stato).toBe(429);
      ora += 5 * 60 * 1000 + 1000;
      for (let i = 0; i < 10; i++) expect((await login('Sbagliata1')).stato).toBe(401);
      expect((await login('Sbagliata1')).corpo.errore).toMatch(/10 minuti/);
      ora += 10 * 60 * 1000 + 1000;
      expect((await login(CREDENZIALI_DEMO.passwordDipendenti)).stato).toBe(200);
      // Azzerato: si riparte da 10 tentativi e 5 minuti.
      for (let i = 0; i < 10; i++) expect((await login('Sbagliata1')).stato).toBe(401);
      expect((await login('Sbagliata1')).corpo.errore).toMatch(/5 minuti/);
    } finally {
      ora += 60 * 60 * 1000;
      await server.chiudi();
    }
  }, 60_000);
});

describe('sessione chiusa per inattività', () => {
  it('dopo 15 minuti senza azioni si chiude; solo le azioni dell\'utente la tengono aperta', async () => {
    const server = await avviaServer(db.prisma, base());
    try {
      const mario = await server.accedi('mario.rossi', CREDENZIALI_DEMO.passwordDipendenti);
      const utenteId = (await db.prisma.utente.findUniqueOrThrow({ where: { username: 'mario.rossi' } })).id;
      const fermaDa = (minuti: number) => db.prisma.sessione.updateMany({ where: { utenteId }, data: { ultimoUsoIl: new Date(Date.now() - minuti * 60 * 1000) } });
      const ultimoUso = async () => (await db.prisma.sessione.findFirstOrThrow({ where: { utenteId } })).ultimoUsoIl.getTime();

      // Ferma da 10 minuti: una chiamata automatica (senza intestazione) non la rinnova…
      await fermaDa(10);
      expect((await mario.chiama('GET', '/api/auth/io')).stato).toBe(200);
      expect(Date.now() - (await ultimoUso())).toBeGreaterThan(9 * 60 * 1000);
      // …un'azione dell'utente sì.
      expect((await mario.chiama('GET', '/api/auth/io', undefined, { intestazioni: { 'X-Logbook-Attivo': '1' } })).stato).toBe(200);
      expect(Date.now() - (await ultimoUso())).toBeLessThan(60 * 1000);
      // Ferma da 16 minuti: chiusa, anche se arriva un'azione.
      await fermaDa(16);
      expect((await mario.chiama('GET', '/api/auth/io', undefined, { intestazioni: { 'X-Logbook-Attivo': '1' } })).stato).toBe(401);
      expect(await db.prisma.sessione.count({ where: { utenteId } })).toBe(0);
    } finally {
      await server.chiudi();
    }
  });
});

describe('codice via email all\'accesso degli amministratori', () => {
  it('PC nuovo: password + codice; PC fidato: solo password; il dipendente non ha codice', async () => {
    const server = await avviaServer(db.prisma, { ...base(), codiceAccesso: true });
    try {
      const corpo = { username: 'admin', password: CREDENZIALI_DEMO.admin.password };
      const primo = await server.anonimo.chiama('POST', '/api/auth/login', corpo);
      expect(primo.corpo).toMatchObject({ ok: false, codiceRichiesto: true });
      expect(primo.corpo.inviatoA).not.toContain('proprietario');
      expect(posta.at(-1)?.a).toBe(EMAIL);
      const attesa = cookieDi(primo);
      expect(attesa).toMatch(/^logbook_attesa=/); // nessuna sessione aperta
      const sbagliato = ultimoCodice() === '000000' ? '000001' : '000000';
      expect((await server.anonimo.chiama('POST', '/api/auth/codice', { codice: sbagliato }, { intestazioni: { Cookie: attesa } })).corpo.errore).toBe('Codice sbagliato');
      // Senza il cookie dell'attesa il codice giusto non serve a nessun altro.
      expect((await server.anonimo.chiama('POST', '/api/auth/codice', { codice: ultimoCodice() })).stato).toBe(400);
      const secondo = await server.anonimo.chiama('POST', '/api/auth/codice', { codice: ultimoCodice() }, { intestazioni: { Cookie: attesa } });
      expect(secondo.stato).toBe(200);
      const cookie = cookieDi(secondo);
      expect(cookie).toMatch(/logbook_pc=/);
      expect(cookie).toMatch(/logbook_sessione=/);
      expect((await server.anonimo.chiama('GET', '/api/auth/io', undefined, { intestazioni: { Cookie: cookie } })).corpo.username).toBe('admin');

      // Stesso PC (cookie logbook_pc): la volta dopo basta la password.
      const pc = cookie.split('; ').find((c) => c.startsWith('logbook_pc='))!;
      const quante = posta.length;
      expect((await server.anonimo.chiama('POST', '/api/auth/login', corpo, { intestazioni: { Cookie: pc } })).corpo).toEqual({ ok: true });
      expect(posta).toHaveLength(quante);
      // Amministratore senza indirizzo noto e dipendente: nessun codice.
      expect((await server.anonimo.chiama('POST', '/api/auth/login', { username: 'hr.due', password: 'SecondoHr2026' })).corpo).toEqual({ ok: true });
      expect((await server.anonimo.chiama('POST', '/api/auth/login', { username: 'mario.rossi', password: CREDENZIALI_DEMO.passwordDipendenti })).corpo).toEqual({ ok: true });
    } finally {
      await server.chiudi();
    }
  });
});

describe('ruolo di amministratore e registro attività', () => {
  it('solo il proprietario dà e toglie il ruolo; il registro lo leggono solo gli amministratori', async () => {
    const server = await avviaServer(db.prisma, base());
    try {
      const proprietario = await server.accedi('admin', CREDENZIALI_DEMO.admin.password);
      const altro = await server.accedi('hr.due', 'SecondoHr2026');
      const giulia = await db.prisma.utente.findUniqueOrThrow({ where: { username: 'giulia.bianchi' } });
      const io = await db.prisma.utente.findUniqueOrThrow({ where: { username: 'admin' } });

      expect((await altro.chiama('GET', '/api/proprietario/account')).stato).toBe(403);
      expect((await altro.chiama('PUT', `/api/proprietario/account/${giulia.id}/ruolo`, { ruolo: 'ADMIN' })).stato).toBe(403);
      expect((await proprietario.chiama('PUT', `/api/proprietario/account/${io.id}/ruolo`, { ruolo: 'DIPENDENTE' })).stato).toBe(409);
      expect((await proprietario.chiama('PUT', `/api/proprietario/account/${giulia.id}/ruolo`, { ruolo: 'ADMIN' })).stato).toBe(200);
      expect((await db.prisma.utente.findUniqueOrThrow({ where: { id: giulia.id } })).ruolo).toBe('ADMIN');
      const elenco = (await proprietario.chiama('GET', '/api/proprietario/account')).corpo as { username: string; ruolo: string; proprietario: boolean }[];
      expect(elenco.find((u) => u.username === 'admin')).toMatchObject({ ruolo: 'ADMIN', proprietario: true });
      expect((await proprietario.chiama('PUT', `/api/proprietario/account/${giulia.id}/ruolo`, { ruolo: 'DIPENDENTE' })).stato).toBe(200);

      // Un'operazione qualsiasi e un accesso fallito finiscono nel registro.
      await proprietario.chiama('POST', '/api/festivita', { data: '2026-08-14', descrizione: 'Chiusura estiva', tipo: 'AZIENDALE' });
      await server.anonimo.chiama('POST', '/api/auth/login', { username: 'admin', password: 'Sbagliata1' });
      await new Promise((ok) => setTimeout(ok, 100));
      const registro = await proprietario.chiama('GET', '/api/registro');
      const azioni = (registro.corpo.righe as { azione: string; esito: string; username: string }[]).map((r) => r.azione);
      expect(azioni).toEqual(expect.arrayContaining(['Accesso riuscito', 'Accesso fallito', 'Festività inserita', 'Ruolo di amministratore dato', 'Ruolo di amministratore tolto']));
      const negati = await proprietario.chiama('GET', '/api/registro?esito=NEGATO&testo=admin');
      expect(negati.corpo.righe.every((r: { esito: string }) => r.esito === 'NEGATO')).toBe(true);
      expect(JSON.stringify(registro.corpo)).not.toContain('Sbagliata1');
      const mario = await server.accedi('mario.rossi', CREDENZIALI_DEMO.passwordDipendenti);
      expect((await mario.chiama('GET', '/api/registro')).stato).toBe(403);
    } finally {
      await server.chiudi();
    }
  });

  it('"Cancella tutti i dati" fa prima la copia di sicurezza e lascia il registro', async () => {
    const server = await avviaServer(db.prisma, base());
    try {
      const proprietario = await server.accedi('admin', CREDENZIALI_DEMO.admin.password);
      await proprietario.chiama('POST', '/api/proprietario/cancellazione/codice');
      const r = await proprietario.chiama('POST', '/api/proprietario/cancellazione', { codice: ultimoCodice(), conferma: 'CANCELLA' });
      expect(r.stato).toBe(200);
      expect(path.basename(r.corpo.copia)).toMatch(/^prima-cancellazione-\d{8}-\d{6}\.db$/);
      const copia = new Database(r.corpo.copia, { readonly: true });
      expect((copia.prepare('select count(*) n from Dipendente').get() as { n: number }).n).toBe(5);
      copia.close();
      expect(await db.prisma.dipendente.count()).toBe(0);
      await new Promise((ok) => setTimeout(ok, 100));
      expect(await db.prisma.registroAttivita.count({ where: { azione: 'TUTTI I DATI CANCELLATI' } })).toBe(1);
    } finally {
      await server.chiudi();
    }
  });
});

describe('password e primo amministratore', () => {
  it('amministratore: 12 caratteri; nessuno: password comuni', () => {
    expect(controllaPasswordNuova('Breve2026', 'ADMIN')).toMatch(/12 caratteri/);
    expect(controllaPasswordNuova('Breve2026', 'DIPENDENTE')).toBeNull();
    expect(controllaPasswordNuova('Password2026!', 'ADMIN')).toMatch(/troppo facile/);
    expect(controllaPasswordNuova('Logbook2026!')).toMatch(/troppo facile/);
    expect(controllaPasswordNuova('Cantiere-Nord-47', 'ADMIN')).toBeNull();
  });

  it('con le credenziali dell\'installazione la password è definitiva; senza, casuale e provvisoria', async () => {
    const vuoto = await creaDbProva();
    try {
      const scelto = await assicuraAdmin(vuoto.prisma, { username: 'Titolare', password: 'Cantiere-Nord-47', definitiva: true });
      expect(scelto).toEqual({ username: 'titolare', passwordGenerata: undefined });
      expect((await vuoto.prisma.utente.findUniqueOrThrow({ where: { username: 'titolare' } })).passwordDaCambiare).toBe(false);
      await vuoto.prisma.utente.deleteMany();
      const generato = await assicuraAdmin(vuoto.prisma);
      expect(generato?.username).toBe('admin');
      expect(generato?.passwordGenerata).toMatch(/^[\w-]{16}$/);
      expect((await vuoto.prisma.utente.findUniqueOrThrow({ where: { username: 'admin' } })).passwordDaCambiare).toBe(true);
    } finally {
      await vuoto.chiudi();
    }
  });
});
