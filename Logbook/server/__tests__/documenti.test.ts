// "><(((º> sabusabu <º)))><"
/**
 * Giorno 15 — file, attestati, documenti del dipendente, impostazioni (24/11/2026).
 *
 * - caricamento: formati ammessi, contenuto che deve corrispondere all'estensione,
 *   limite di 20 MB, file vuoti; lettura riservata a HR e a chi ha caricato;
 * - attestati: stato a oggi (in scadenza nei 30 giorni), sostituzione e cancellazione
 *   del file sul disco, solo HR;
 * - documenti del dipendente: file obbligatorio;
 * - Impostazioni: il token di SkyTower non torna mai al browser; prova del collegamento
 *   contro un finto SkyTower in ascolto su una porta libera;
 * - dashboard: attestati da rinnovare solo per HR;
 * - pulizia dei file caricati e mai collegati.
 */
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CREDENZIALI_DEMO, semina } from '../../prisma/seed';
import { ESTENSIONI_FILE } from '../../comune/documenti';
import { ESTENSIONI_AMMESSE, pulisciFileOrfani } from '../servizi/archivio-file';
import { avviaServer, OGGI_PROVA, type ClientProva } from './client-prova';
import { creaDbProva, type DbProva } from './db-prova';

let db: DbProva;
let server: Awaited<ReturnType<typeof avviaServer>>;
let admin: ClientProva;
let mario: ClientProva;
let idMario: number;

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

/** Carica un file come fa l'interfaccia: byte nel corpo, nome in X-Nome-File. */
const carica = (c: ClientProva, dati: Buffer, nome: string) =>
  c.chiama('POST', '/api/file', undefined, { grezzo: dati, intestazioni: { 'X-Nome-File': encodeURIComponent(nome) } });

const fileSulDisco = () => fs.readdirSync(server.cartellaDocumenti);

beforeAll(async () => {
  db = await creaDbProva();
  await semina(db.prisma, OGGI_PROVA);
  server = await avviaServer(db.prisma);
  admin = await server.accedi(CREDENZIALI_DEMO.admin.username, CREDENZIALI_DEMO.admin.password);
  mario = await server.accedi('mario.rossi', CREDENZIALI_DEMO.passwordDipendenti);
  idMario = (await db.prisma.dipendente.findFirstOrThrow({ where: { cognome: 'Rossi' } })).id;
});

afterAll(async () => {
  await server.chiudi();
  await db.chiudi();
});

describe('caricamento dei file', () => {
  it('interfaccia e server ammettono le stesse estensioni', () => {
    expect([...ESTENSIONI_AMMESSE].sort()).toEqual([...ESTENSIONI_FILE].sort());
  });

  it('accetta un PDF vero e lo salva con un nome casuale', async () => {
    const r = await carica(admin, PDF, 'Attestato sicurezza è.pdf');
    expect(r.stato).toBe(201);
    expect(r.corpo).toMatchObject({ nome: 'Attestato sicurezza è.pdf', tipo: 'application/pdf', dimensione: PDF.length });
    const riga = await db.prisma.fileCaricato.findUniqueOrThrow({ where: { id: r.corpo.id } });
    expect(riga.nomeDisco).toMatch(/^[0-9a-f-]{36}\.pdf$/);
    expect(fileSulDisco()).toContain(riga.nomeDisco);
  });

  it('rifiuta formati non ammessi, contenuto falso, file vuoti e troppo grandi', async () => {
    expect((await carica(admin, Buffer.from('MZ...'), 'virus.exe')).stato).toBe(415);
    const finto = await carica(admin, Buffer.from('MZ questo non è un pdf'), 'documento.pdf');
    expect(finto.stato).toBe(415);
    expect(finto.corpo.errore).toMatch(/non corrisponde/);
    expect((await carica(admin, Buffer.alloc(0), 'vuoto.pdf')).stato).toBe(400);
    const grande = Buffer.concat([PDF, Buffer.alloc(20 * 1024 * 1024)]);
    expect((await carica(admin, grande, 'grande.pdf')).stato).toBe(413);
  });

  it('un nome con percorsi resta solo un nome', async () => {
    const r = await carica(mario, PNG, '..\\..\\Windows\\foto.png');
    expect(r.stato).toBe(201);
    expect(r.corpo.nome).toBe('foto.png');
  });

  it('il file lo leggono HR e chi lo ha caricato, non gli altri dipendenti', async () => {
    const diHr = (await carica(admin, PDF, 'riservato.pdf')).corpo.id;
    const diMario = (await carica(mario, PDF, 'mio.pdf')).corpo.id;
    const letto = await admin.chiama('GET', `/api/file/${diMario}`);
    expect(letto.stato).toBe(200);
    expect(letto.intestazioni.get('content-type')).toBe('application/pdf');
    expect(letto.intestazioni.get('content-disposition')).toMatch(/^inline; .*filename\*=UTF-8''mio\.pdf/);
    expect(letto.intestazioni.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.compare(letto.corpo, PDF)).toBe(0);
    expect((await mario.chiama('GET', `/api/file/${diMario}?scarica=1`)).intestazioni.get('content-disposition')).toMatch(/^attachment/);
    expect((await mario.chiama('GET', `/api/file/${diHr}`)).stato).toBe(403);
    expect((await server.anonimo.chiama('GET', `/api/file/${diHr}`)).stato).toBe(401);
  });
});

describe('attestati', () => {
  it('stato a oggi: in scadenza nei 30 giorni, scaduto, senza scadenza', async () => {
    const crea = (titolo: string, dataScadenza: string | null) =>
      admin.chiama('POST', '/api/attestati', { dipendenteId: idMario, tipo: 'SICUREZZA', titolo, dataRilascio: '2018-03-01', dataScadenza });
    expect((await crea('Formazione specifica', '2026-12-10')).corpo.stato).toBe('IN_SCADENZA'); // 17 giorni dopo il 23/11
    expect((await crea('Preposto', '2026-11-22')).corpo.stato).toBe('SCADUTO');
    expect((await crea('Generale', null)).corpo.stato).toBe('SENZA_SCADENZA');
    expect((await crea('RSPP', '2027-06-30')).corpo.stato).toBe('VALIDO');
    const inScadenza = await admin.chiama('GET', `/api/attestati?dipendenteId=${idMario}&stato=IN_SCADENZA`);
    expect(inScadenza.corpo.map((a: { titolo: string }) => a.titolo)).toEqual(['Formazione specifica']);
  });

  it('controlla date e tipo', async () => {
    const r = await admin.chiama('POST', '/api/attestati', { dipendenteId: idMario, tipo: 'BOH', titolo: '', dataRilascio: '2026-05-01' });
    expect(r.stato).toBe(400);
    expect(Object.keys(r.corpo.campi)).toEqual(expect.arrayContaining(['tipo', 'titolo']));
    // Ordine delle date: controllato quando il resto è valido (refine di Zod sull'oggetto intero).
    const date = await admin.chiama('POST', '/api/attestati', { dipendenteId: idMario, tipo: 'ALTRO', titolo: 'Prova', dataRilascio: '2026-05-01', dataScadenza: '2026-01-01' });
    expect(date.corpo.campi.dataScadenza).toMatch(/prima del rilascio/);
  });

  it('sostituire o eliminare l\'attestato toglie il vecchio file dal disco', async () => {
    const f1 = (await carica(admin, PDF, 'primo.pdf')).corpo.id;
    const a = await admin.chiama('POST', '/api/attestati', { dipendenteId: idMario, tipo: 'PATENTINO', titolo: 'Carrellista', dataRilascio: '2025-01-10', dataScadenza: '2030-01-10', fileId: f1 });
    expect(a.stato).toBe(201);
    expect(a.corpo.file).toMatchObject({ id: f1, nome: 'primo.pdf' });
    const disco1 = (await db.prisma.fileCaricato.findUniqueOrThrow({ where: { id: f1 } })).nomeDisco;

    const f2 = (await carica(admin, PDF, 'rinnovo.pdf')).corpo.id;
    const mod = await admin.chiama('PUT', `/api/attestati/${a.corpo.id}`, { dipendenteId: idMario, tipo: 'PATENTINO', titolo: 'Carrellista', dataRilascio: '2025-01-10', dataScadenza: '2030-01-10', fileId: f2 });
    expect(mod.corpo.file.id).toBe(f2);
    expect(fileSulDisco()).not.toContain(disco1);
    expect(await db.prisma.fileCaricato.findUnique({ where: { id: f1 } })).toBeNull();

    const disco2 = (await db.prisma.fileCaricato.findUniqueOrThrow({ where: { id: f2 } })).nomeDisco;
    expect((await admin.chiama('DELETE', `/api/attestati/${a.corpo.id}`)).stato).toBe(204);
    expect(fileSulDisco()).not.toContain(disco2);
  });

  it('un file già usato o caricato da altri non si collega', async () => {
    const f = (await carica(admin, PDF, 'uno.pdf')).corpo.id;
    const base = { dipendenteId: idMario, tipo: 'ALTRO', titolo: 'Prova', dataRilascio: '2026-01-01', fileId: f };
    expect((await admin.chiama('POST', '/api/attestati', base)).stato).toBe(201);
    expect((await admin.chiama('POST', '/api/attestati', base)).stato).toBe(409);
    const diMario = (await carica(mario, PDF, 'suo.pdf')).corpo.id;
    expect((await admin.chiama('POST', '/api/attestati', { ...base, fileId: diMario })).stato).toBe(400);
  });

  it('solo HR', async () => {
    expect((await mario.chiama('GET', `/api/attestati?dipendenteId=${idMario}`)).stato).toBe(403);
    expect((await mario.chiama('POST', '/api/attestati', {})).stato).toBe(403);
  });
});

describe('documenti del dipendente', () => {
  it('serve il file; eliminando il documento sparisce anche il file', async () => {
    const senza = await admin.chiama('POST', '/api/documenti-dipendente', { dipendenteId: idMario, titolo: 'Contratto' });
    expect(senza.stato).toBe(400);
    expect(senza.corpo.campi.fileId).toBeTruthy();
    const f = (await carica(admin, PDF, 'contratto.pdf')).corpo.id;
    const d = await admin.chiama('POST', '/api/documenti-dipendente', { dipendenteId: idMario, titolo: 'Contratto', fileId: f });
    expect(d.stato).toBe(201);
    expect((await admin.chiama('GET', `/api/documenti-dipendente?dipendenteId=${idMario}`)).corpo).toHaveLength(1);
    expect((await mario.chiama('GET', `/api/documenti-dipendente?dipendenteId=${idMario}`)).stato).toBe(403);
    expect((await admin.chiama('DELETE', `/api/documenti-dipendente/${d.corpo.id}`)).stato).toBe(204);
    expect(await db.prisma.fileCaricato.findUnique({ where: { id: f } })).toBeNull();
  });
});

describe('impostazioni: collegamento a SkyTower', () => {
  const TOKEN = 'token-di-servizio-della-suite-1234567890';
  let finto: http.Server;
  let urlFinto: string;
  const ricevute: { percorso: string; token?: string; app?: string; email?: string }[] = [];

  beforeAll(async () => {
    // Finto SkyTower: risponde a /suite/commesse solo col token giusto.
    finto = http.createServer((req, res) => {
      ricevute.push({ percorso: req.url ?? '', token: req.headers['x-suite-token'] as string, app: req.headers['x-suite-app'] as string, email: req.headers['x-suite-email'] as string });
      if (req.headers['x-suite-token'] !== TOKEN) {
        res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ detail: 'token non valido' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify([{ code: 'P1', name: 'Scuola media', commessa: '101-003' }]));
    });
    await new Promise<void>((ok) => finto.listen(0, '127.0.0.1', () => ok()));
    urlFinto = `http://127.0.0.1:${(finto.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((ok) => finto.close(() => ok())));

  it('all\'inizio non c\'è collegamento; il token serve la prima volta', async () => {
    expect((await admin.chiama('GET', '/api/impostazioni')).corpo.skytower).toMatchObject({ attivo: false, tokenImpostato: false });
    const r = await admin.chiama('PUT', '/api/impostazioni/skytower', { url: urlFinto, email: '' });
    expect(r.stato).toBe(400);
    expect(r.corpo.campi.token).toBeTruthy();
  });

  it('salva il collegamento senza mai restituire il token', async () => {
    expect((await admin.chiama('PUT', '/api/impostazioni/skytower', { url: `${urlFinto}/`, email: 'hr@cosedil.it', token: TOKEN })).stato).toBe(200);
    const letto = await admin.chiama('GET', '/api/impostazioni');
    expect(letto.corpo.skytower).toEqual({ url: urlFinto, email: 'hr@cosedil.it', tokenImpostato: true, attivo: true });
    expect(JSON.stringify(letto.corpo)).not.toContain(TOKEN);
    // Token vuoto = resta quello di prima
    expect((await admin.chiama('PUT', '/api/impostazioni/skytower', { url: urlFinto, email: 'hr@cosedil.it', token: '' })).stato).toBe(200);
    expect((await db.prisma.impostazione.findUniqueOrThrow({ where: { chiave: 'skytower.token' } })).valore).toBe(TOKEN);
  });

  it('prova del collegamento e commesse, con le intestazioni della suite', async () => {
    const prova = await admin.chiama('POST', '/api/impostazioni/skytower/prova');
    expect(prova.corpo).toEqual({ ok: true, commesse: 1 });
    expect(ricevute.at(-1)).toEqual({ percorso: '/suite/commesse', token: TOKEN, app: 'logbook', email: 'hr@cosedil.it' });
    expect((await admin.chiama('GET', '/api/impostazioni/skytower/commesse')).corpo).toEqual([{ codice: '101-003', nome: 'Scuola media' }]);
  });

  it('token sbagliato o SkyTower spento: messaggio chiaro', async () => {
    await admin.chiama('PUT', '/api/impostazioni/skytower', { url: urlFinto, email: '', token: 'token-sbagliato-0000000000000' });
    const rifiutato = await admin.chiama('POST', '/api/impostazioni/skytower/prova');
    expect(rifiutato.stato).toBe(502);
    expect(rifiutato.corpo.errore).toMatch(/token di servizio/);
    await admin.chiama('PUT', '/api/impostazioni/skytower', { url: 'http://127.0.0.1:1', email: '', token: TOKEN });
    expect((await admin.chiama('POST', '/api/impostazioni/skytower/prova')).corpo.errore).toMatch(/non raggiungibile/);
  });

  it('togliere il collegamento; i dipendenti non vedono le impostazioni', async () => {
    expect((await admin.chiama('DELETE', '/api/impostazioni/skytower')).stato).toBe(204);
    expect((await admin.chiama('GET', '/api/impostazioni')).corpo.skytower.attivo).toBe(false);
    expect((await mario.chiama('GET', '/api/impostazioni')).stato).toBe(403);
  });
});

describe('dashboard e pulizia', () => {
  it('attestati da rinnovare solo per HR, i più urgenti prima', async () => {
    const hr = (await admin.chiama('GET', '/api/dashboard')).corpo.attestatiDaRinnovare;
    expect(hr.map((a: { titolo: string; stato: string }) => `${a.titolo}:${a.stato}`)).toEqual(['Preposto:SCADUTO', 'Formazione specifica:IN_SCADENZA']);
    expect((await mario.chiama('GET', '/api/dashboard')).corpo.attestatiDaRinnovare).toEqual([]);
  });

  it('i file mai collegati spariscono dopo un giorno', async () => {
    const orfano = (await carica(admin, PDF, 'dimenticato.pdf')).corpo.id;
    const nome = (await db.prisma.fileCaricato.findUniqueOrThrow({ where: { id: orfano } })).nomeDisco;
    expect(await pulisciFileOrfani(db.prisma, server.cartellaDocumenti)).toBe(0); // appena caricato: resta
    const tolti = await pulisciFileOrfani(db.prisma, server.cartellaDocumenti, new Date(Date.now() + 25 * 60 * 60 * 1000));
    expect(tolti).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(server.cartellaDocumenti, nome))).toBe(false);
    // I file collegati (attestati, documenti) restano
    const collegati = await db.prisma.fileCaricato.count();
    expect(collegati).toBeGreaterThan(0);
  });
});
