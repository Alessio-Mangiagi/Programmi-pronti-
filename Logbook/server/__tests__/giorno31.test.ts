// "><(((º> sabusabu <º)))><"
/**
 * Giorno 31 (25/11/2026) — comandi del proprietario: dati di esempio e "Cancella tutti i dati"
 * con codice via email (server/rotte/proprietario.ts).
 *
 * Richiesta: "il programma deve potersi popolare con i dati per farmi capire come sta
 * funzionando, all'occorrenza devo poter cancellare tutto … usabile solo da me … invio di un
 * codice via mail"; risposta 3a su cosa resta (account del proprietario, collegamento a
 * SkyTower, festività nazionali).
 *
 * Le email non partono davvero: il server di prova riceve una funzione che le mette in
 * `posta`, e un orologio finto (`ora`) per la scadenza dei codici.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CREDENZIALI_DEMO, semina, USERNAME_DEMO } from '../../prisma/seed';
import { creaImpronta } from '../auth/password';
import { configurazioneSmtp, mascheraEmail, type Email } from '../servizi/email';
import { avviaServer, OGGI_PROVA, type ClientProva } from './client-prova';
import { creaDbProva, type DbProva } from './db-prova';

const EMAIL_PROPRIETARIO = 'proprietario@esempio.it';
let db: DbProva;
let server: Awaited<ReturnType<typeof avviaServer>>;
let senzaPosta: Awaited<ReturnType<typeof avviaServer>>;
let admin: ClientProva;
let secondoAdmin: ClientProva;
let mario: ClientProva;
const posta: Email[] = [];
let ora = Date.UTC(2026, 10, 23, 8, 0);

/** Ultimo codice arrivato per email (6 cifre nell'oggetto). */
const ultimoCodice = () => /codice (\d{6})/.exec(posta.at(-1)?.oggetto ?? '')?.[1] ?? '';

beforeAll(async () => {
  db = await creaDbProva();
  await semina(db.prisma, OGGI_PROVA);
  // Un secondo amministratore: vede le Impostazioni ma NON è il proprietario.
  await db.prisma.utente.create({ data: { username: 'hr.due', passwordHash: await creaImpronta('SecondoHr2026'), ruolo: 'ADMIN' } });
  const opzioni = {
    oggi: () => OGGI_PROVA,
    proprietario: { username: CREDENZIALI_DEMO.admin.username, email: EMAIL_PROPRIETARIO },
    adesso: () => ora,
  };
  server = await avviaServer(db.prisma, { ...opzioni, inviaEmail: async (e) => void posta.push(e) });
  senzaPosta = await avviaServer(db.prisma, { ...opzioni, inviaEmail: null });
  admin = await server.accedi(CREDENZIALI_DEMO.admin.username, CREDENZIALI_DEMO.admin.password);
  secondoAdmin = await server.accedi('hr.due', 'SecondoHr2026');
  mario = await server.accedi('mario.rossi', CREDENZIALI_DEMO.passwordDipendenti);
});

afterAll(async () => {
  await server.chiudi();
  await senzaPosta.chiudi();
  await db.chiudi();
});

describe('configurazione dell\'invio email', () => {
  it('senza server niente invio; porta e sicurezza hanno default sensati', () => {
    expect(configurazioneSmtp({})).toBeNull();
    expect(configurazioneSmtp({ LOGBOOK_SMTP_HOST: 'smtp.esempio.it' })).toBeNull(); // manca il mittente
    expect(configurazioneSmtp({ LOGBOOK_SMTP_HOST: 'smtp.esempio.it', LOGBOOK_SMTP_UTENTE: 'logbook@esempio.it' })).toMatchObject({
      porta: 587,
      sicurezza: 'starttls',
      mittente: 'logbook@esempio.it',
    });
    expect(configurazioneSmtp({ LOGBOOK_SMTP_HOST: 'smtp.esempio.it', LOGBOOK_SMTP_PORT: '465', LOGBOOK_EMAIL_MITTENTE: 'a@b.it' })?.sicurezza).toBe('ssl');
  });

  it('l\'indirizzo a video è mascherato', () => {
    const m = mascheraEmail(EMAIL_PROPRIETARIO);
    expect(m.endsWith('@esempio.it')).toBe(true);
    expect(m).not.toContain('proprietario');
  });
});

describe('solo il proprietario', () => {
  it('lo stato dice "proprietario" solo a lui', async () => {
    const r = await admin.chiama('GET', '/api/proprietario/stato');
    expect(r.corpo).toMatchObject({ proprietario: true, emailConfigurata: true, invioConfigurato: true, vuoto: false });
    expect(r.corpo.emailMascherata).not.toContain('proprietario');
    expect((await secondoAdmin.chiama('GET', '/api/proprietario/stato')).corpo).toEqual({ proprietario: false });
    expect((await mario.chiama('GET', '/api/proprietario/stato')).corpo).toEqual({ proprietario: false });
  });

  it('un altro amministratore o un dipendente ricevono 403 su ogni comando', async () => {
    for (const c of [secondoAdmin, mario]) {
      expect((await c.chiama('POST', '/api/proprietario/dati-esempio')).stato).toBe(403);
      expect((await c.chiama('POST', '/api/proprietario/cancellazione/codice')).stato).toBe(403);
      expect((await c.chiama('POST', '/api/proprietario/cancellazione', { codice: '123456', conferma: 'CANCELLA' })).stato).toBe(403);
    }
    expect(posta).toHaveLength(0);
  });

  it('i dati di esempio si caricano solo con Logbook vuoto', async () => {
    const r = await admin.chiama('POST', '/api/proprietario/dati-esempio');
    expect(r.stato).toBe(409);
  });

  it('senza server di posta il codice non si può chiedere', async () => {
    const proprietario = await senzaPosta.accedi(CREDENZIALI_DEMO.admin.username, CREDENZIALI_DEMO.admin.password);
    const r = await proprietario.chiama('POST', '/api/proprietario/cancellazione/codice');
    expect(r.stato).toBe(409);
    expect(r.corpo.errore).toMatch(/LOGBOOK_SMTP_HOST/);
  });
});

describe('cancella tutti i dati', () => {
  const fileNelDb = 'prova-cancellazione.pdf';
  const fileEstraneo = 'non-di-logbook.txt';

  it('codice sbagliato o conferma mancante: non si cancella niente', async () => {
    // Un file caricato (va via anche dal disco), uno estraneo nella cartella (resta),
    // un'impostazione (resta) e una festività locale (va via).
    const proprietarioId = (await db.prisma.utente.findUniqueOrThrow({ where: { username: 'admin' } })).id;
    fs.writeFileSync(path.join(server.cartellaDocumenti, fileNelDb), '%PDF-1.4');
    fs.writeFileSync(path.join(server.cartellaDocumenti, fileEstraneo), 'altro');
    await db.prisma.fileCaricato.create({
      data: { nomeDisco: fileNelDb, nomeOriginale: 'Verbale.pdf', tipoMime: 'application/pdf', dimensione: 8, sha256: 'x', caricatoDaId: proprietarioId },
    });
    await db.prisma.impostazione.create({ data: { chiave: 'skytower.url', valore: 'http://127.0.0.1:8100' } });
    await db.prisma.festivita.create({ data: { data: '2026-07-15', descrizione: 'Patrono', tipo: 'LOCALE' } });

    const r = await admin.chiama('POST', '/api/proprietario/cancellazione/codice');
    expect(r.stato).toBe(200);
    expect(r.corpo.inviatoA).not.toContain('proprietario');
    expect(posta.at(-1)?.a).toBe(EMAIL_PROPRIETARIO);
    expect(ultimoCodice()).toMatch(/^\d{6}$/);

    const sbagliato = ultimoCodice() === '000000' ? '000001' : '000000';
    expect((await admin.chiama('POST', '/api/proprietario/cancellazione', { codice: sbagliato, conferma: 'CANCELLA' })).corpo.errore).toBe('Codice sbagliato');
    // Conferma in minuscolo: rifiutata PRIMA di guardare il codice, che resta valido.
    expect((await admin.chiama('POST', '/api/proprietario/cancellazione', { codice: ultimoCodice(), conferma: 'cancella' })).stato).toBe(400);
    expect(await db.prisma.dipendente.count()).toBe(5);
  });

  it('con il codice giusto cancella tutto tranne proprietario, impostazioni e festività nazionali', async () => {
    const r = await admin.chiama('POST', '/api/proprietario/cancellazione', { codice: ultimoCodice(), conferma: 'CANCELLA' });
    expect(r.stato).toBe(200);
    expect(r.corpo).toMatchObject({ dipendenti: 5, progetti: 3, file: 1 });
    expect(r.corpo.account).toBe(6); // 5 dipendenti di esempio + il secondo amministratore

    const p = db.prisma;
    expect(await p.dipendente.count()).toBe(0);
    expect(await p.progetto.count()).toBe(0);
    expect(await p.registrazioneOraria.count()).toBe(0);
    expect(await p.assenza.count()).toBe(0);
    expect(await p.mansione.count()).toBe(0);
    expect(await p.fileCaricato.count()).toBe(0);
    expect((await p.utente.findMany()).map((u) => u.username)).toEqual(['admin']);
    expect(await p.impostazione.count()).toBe(1);
    expect(await p.festivita.count({ where: { tipo: { not: 'NAZIONALE' } } })).toBe(0);
    expect(await p.festivita.count({ where: { data: { gte: '2027-01-01', lte: '2027-12-31' } } })).toBeGreaterThan(10);
    expect(fs.existsSync(path.join(server.cartellaDocumenti, fileNelDb))).toBe(false);
    expect(fs.existsSync(path.join(server.cartellaDocumenti, fileEstraneo))).toBe(true);

    // Avviso a cose fatte e proprietario ancora collegato.
    await new Promise((ok) => setTimeout(ok, 50));
    expect(posta.at(-1)?.oggetto).toBe('Logbook: tutti i dati sono stati cancellati');
    expect((await admin.chiama('GET', '/api/proprietario/stato')).corpo.vuoto).toBe(true);
    // Il secondo amministratore non esiste più.
    expect((await server.anonimo.chiama('POST', '/api/auth/login', { username: 'hr.due', password: 'SecondoHr2026' })).stato).toBe(401);
  });

  it('il codice si usa una volta sola, scade dopo 10 minuti, 5 errori lo annullano', async () => {
    expect((await admin.chiama('POST', '/api/proprietario/cancellazione', { codice: '123456', conferma: 'CANCELLA' })).corpo.errore).toMatch(/Nessun codice/);

    await admin.chiama('POST', '/api/proprietario/cancellazione/codice');
    ora += 11 * 60 * 1000;
    expect((await admin.chiama('POST', '/api/proprietario/cancellazione', { codice: ultimoCodice(), conferma: 'CANCELLA' })).corpo.errore).toMatch(/scaduto/);

    await admin.chiama('POST', '/api/proprietario/cancellazione/codice');
    const sbagliato = ultimoCodice() === '000000' ? '000001' : '000000';
    let ultimo = '';
    for (let i = 0; i < 5; i++) ultimo = (await admin.chiama('POST', '/api/proprietario/cancellazione', { codice: sbagliato, conferma: 'CANCELLA' })).corpo.errore;
    expect(ultimo).toMatch(/annullato/);
    expect((await admin.chiama('POST', '/api/proprietario/cancellazione', { codice: ultimoCodice(), conferma: 'CANCELLA' })).corpo.errore).toMatch(/Nessun codice/);
  });

  it('al massimo 5 codici all\'ora', async () => {
    ora += 2 * 60 * 60 * 1000;
    const stati: number[] = [];
    for (let i = 0; i < 6; i++) stati.push((await admin.chiama('POST', '/api/proprietario/cancellazione/codice')).stato);
    expect(stati).toEqual([200, 200, 200, 200, 200, 429]);
  });
});

describe('dati di esempio dopo la cancellazione', () => {
  it('si caricano con l\'amministratore che c\'è già e account di esempio da cambiare al primo accesso', async () => {
    const r = await admin.chiama('POST', '/api/proprietario/dati-esempio');
    expect(r.stato).toBe(201);
    expect(r.corpo).toMatchObject({ dipendenti: 5, progetti: 3 });
    expect(await db.prisma.utente.count({ where: { ruolo: 'ADMIN' } })).toBe(1);
    const esempio = await db.prisma.utente.findMany({ where: { username: { in: USERNAME_DEMO } } });
    expect(esempio).toHaveLength(5);
    expect(esempio.every((u) => u.passwordDaCambiare)).toBe(true);
    // Le assenze decise risultano decise dal proprietario.
    expect(await db.prisma.assenza.count({ where: { decisoDa: { username: 'admin' } } })).toBeGreaterThan(0);
    // Un secondo caricamento è rifiutato: Logbook non è più vuoto.
    expect((await admin.chiama('POST', '/api/proprietario/dati-esempio')).stato).toBe(409);
  });
});
