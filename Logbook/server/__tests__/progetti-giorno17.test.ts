// "><(((º> sabusabu <º)))><"
/**
 * Giorno 17 (24/11/2026) — assegnazione dei dipendenti ai progetti, documentazione di
 * avanzamento e note interne del progetto.
 *
 * - Assegnazioni (risposte 2a 3a 4a): senza assegnazione niente ore (giornata, fascia,
 *   import); HR assegna un dipendente alla volta; togliere non cancella le ore; la
 *   migrazione assegna chi aveva già ore.
 * - Documentazione: dal Giorno 20 la carica solo HR (risposta 2), già "vista"; HR la può
 *   riaprire, rispondere, eliminare; invio a SkyTower con collegamento e commessa (finto
 *   SkyTower in ascolto locale). Le ore le scrive solo HR (risposta 1b).
 * - Note interne: solo HR.
 * Seed: Mario Rossi è assegnato a PRG-001 e PRG-003, non a PRG-002.
 */
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CREDENZIALI_DEMO, semina } from '../../prisma/seed';
import { RADICE_APP } from '../database-url';
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

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
const carica = (c: ClientProva, nome: string) => c.chiama('POST', '/api/file', undefined, { grezzo: PDF, intestazioni: { 'X-Nome-File': encodeURIComponent(nome) } });
/**
 * HR aggiunge a Mario una fascia nel giorno: si risalva la giornata con le fasce già
 * presenti più quella nuova (dal Giorno 24 non c'è più la rotta della fascia singola).
 */
async function aggiungiFascia(data: string, progettoId: number, oraInizio = '08:00', oraFine = '10:00') {
  const presenti = await db.prisma.registrazioneOraria.findMany({ where: { dipendenteId: idMario, data } });
  const fasce = [...presenti.map((f) => ({ progettoId: f.progettoId, oraInizio: f.oraInizio, oraFine: f.oraFine, note: f.note ?? '' })), { progettoId, oraInizio, oraFine, note: '' }];
  return admin.chiama('PUT', '/api/registrazioni/giornata', { dipendenteId: idMario, data, fasce });
}

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
});

afterAll(async () => {
  await server.chiudi();
  await db.chiudi();
});

describe('assegnazioni dei dipendenti ai progetti', () => {
  it('la migrazione assegna chi ha già ore sul progetto (risposta 4a)', async () => {
    // Si rifà a mano l'ultima istruzione della migrazione su una tabella svuotata.
    const sql = fs.readFileSync(path.join(RADICE_APP, 'prisma', 'migrations', '20261124120000_assegnazioni', 'migration.sql'), 'utf8');
    const insert = sql.slice(sql.indexOf('INSERT INTO "AssegnazioneProgetto"'));
    const prima = await db.prisma.assegnazioneProgetto.findMany({ orderBy: [{ progettoId: 'asc' }, { dipendenteId: 'asc' }] });
    await db.prisma.assegnazioneProgetto.deleteMany();
    await db.prisma.$executeRawUnsafe(insert);
    const dopo = await db.prisma.assegnazioneProgetto.findMany({ orderBy: [{ progettoId: 'asc' }, { dipendenteId: 'asc' }] });
    // Nel seed ognuno ha ore su entrambi i suoi progetti: si ottengono le stesse coppie.
    expect(dopo.map((a) => `${a.progettoId}:${a.dipendenteId}`)).toEqual(prima.map((a) => `${a.progettoId}:${a.dipendenteId}`));
  });

  it('senza assegnazione niente ore, da nessuna parte', async () => {
    // Il no arriva dall'assegnazione, anche per HR.
    const r = await aggiungiFascia(OGGI_PROVA, prg2, '18:00', '19:00');
    expect(r.stato).toBe(400);
    expect(r.corpo.errore).toMatch(/non è assegnato al progetto PRG-002/);
    // Anche HR per conto di Mario
    expect((await aggiungiFascia('2026-11-20', prg2, '18:00', '19:00')).stato).toBe(400);
    // E l'import Excel
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Ore');
    ws.addRow(['Matricola', 'Data', 'Ora inizio', 'Ora fine', 'Codice progetto', 'Note']);
    ws.addRow(['0001', '20/11/2026', '18:00', '19:00', 'PRG-002', '']);
    const an = await admin.chiama('POST', '/api/importa/anteprima', undefined, { grezzo: Buffer.from(await wb.xlsx.writeBuffer()) });
    expect(an.corpo.righe[0].errori.join(' ')).toMatch(/non è assegnato/);
  });

  it('il dipendente vede solo i suoi progetti e non può chiedere quelli degli altri', async () => {
    const miei = await mario.chiama('GET', `/api/progetti?assegnatiA=${idMario}`);
    expect(miei.corpo.map((p: { codice: string }) => p.codice)).toEqual(['PRG-001', 'PRG-003']);
    expect((await mario.chiama('GET', `/api/progetti?assegnatiA=${idGiulia}`)).stato).toBe(403);
    expect((await mario.chiama('GET', `/api/progetti/${prg2}`)).stato).toBe(403);
    expect((await mario.chiama('GET', `/api/progetti/${prg1}`)).stato).toBe(200);
    // L'elenco completo indica quanti sono assegnati
    const tutti = await admin.chiama('GET', '/api/progetti');
    expect(tutti.corpo.find((p: { codice: string }) => p.codice === 'PRG-002').assegnati).toBe(4);
  });

  it('HR assegna un dipendente alla volta; dopo, le ore passano', async () => {
    expect((await mario.chiama('POST', `/api/progetti/${prg2}/dipendenti`, { dipendenteId: idMario })).stato).toBe(403);
    const r = await admin.chiama('POST', `/api/progetti/${prg2}/dipendenti`, { dipendenteId: idMario });
    expect(r.stato).toBe(201);
    expect((await admin.chiama('POST', `/api/progetti/${prg2}/dipendenti`, { dipendenteId: idMario })).stato).toBe(409);
    // Giorno passato: lo scrive HR (Giorno 19).
    expect((await aggiungiFascia('2026-11-20', prg2, '18:00', '19:00')).stato).toBe(200);
    const elenco = await admin.chiama('GET', `/api/progetti/${prg2}/dipendenti`);
    const rossi = elenco.corpo.find((a: { dipendente: { id: number } }) => a.dipendente.id === idMario);
    expect(rossi.minuti).toBe(60);
    expect(rossi.dipendente.codiceFiscale).toMatch(/^RSSMRA/);
  });

  it('togliere l\'assegnazione lascia le ore, che restano correggibili, ma blocca le nuove', async () => {
    expect((await admin.chiama('DELETE', `/api/progetti/${prg2}/dipendenti/${idMario}`)).stato).toBe(204);
    expect(await db.prisma.registrazioneOraria.count({ where: { dipendenteId: idMario, progettoId: prg2 } })).toBe(1);
    // Stesso giorno: si risalva la giornata con la fascia vecchia (orario corretto) → ammesso
    const giorno = await db.prisma.registrazioneOraria.findMany({ where: { dipendenteId: idMario, data: '2026-11-20' }, orderBy: { oraInizio: 'asc' } });
    const fasce = giorno.map((f) => ({ progettoId: f.progettoId, oraInizio: f.oraInizio, oraFine: f.progettoId === prg2 ? '18:30' : f.oraFine, note: '' }));
    expect((await admin.chiama('PUT', '/api/registrazioni/giornata', { dipendenteId: idMario, data: '2026-11-20', fasce })).stato).toBe(200);
    // Un altro giorno: bloccato
    expect((await aggiungiFascia('2026-11-19', prg2, '18:00', '19:00')).stato).toBe(400);
  });

  it('un dipendente cessato non si assegna', async () => {
    const cessato = await db.prisma.dipendente.update({ where: { id: idGiulia }, data: { stato: 'CESSATO', dataCessazione: OGGI_PROVA } });
    const prg3 = (await db.prisma.progetto.findUniqueOrThrow({ where: { codice: 'PRG-003' } })).id;
    const r = await admin.chiama('POST', `/api/progetti/${prg3}/dipendenti`, { dipendenteId: cessato.id });
    expect(r.stato).toBe(400);
    await db.prisma.dipendente.update({ where: { id: idGiulia }, data: { stato: 'ATTIVO', dataCessazione: null } });
  });
});

describe('documentazione di avanzamento (dal Giorno 20 la carica solo HR)', () => {
  let idDoc: number;

  it('HR carica con file, nota e percentuale; nasce già vista', async () => {
    const file = (await carica(admin, 'Foto getto solaio.pdf')).corpo.id;
    const r = await admin.chiama('POST', '/api/documenti-progetto', { progettoId: prg1, data: '2026-11-20', titolo: 'Getto solaio piano 1', nota: 'Completato il getto', percentuale: 40, fileId: file });
    expect(r.stato).toBe(201);
    expect(r.corpo).toMatchObject({ titolo: 'Getto solaio piano 1', percentuale: 40, visto: true, autore: { nome: CREDENZIALI_DEMO.admin.username }, file: { nome: 'Foto getto solaio.pdf' } });
    idDoc = r.corpo.id;
    expect((await admin.chiama('GET', '/api/dashboard')).corpo.documentazioneDaVedere).toEqual([]);
  });

  it('il dipendente non carica e non elimina (risposta 2: tutti i dati li inserisce HR)', async () => {
    expect((await mario.chiama('POST', '/api/documenti-progetto', { progettoId: prg1, data: OGGI_PROVA, titolo: 'X', nota: 'y' })).stato).toBe(403);
    expect((await mario.chiama('DELETE', `/api/documenti-progetto/${idDoc}`)).stato).toBe(403);
    expect((await mario.chiama('GET', `/api/documenti-progetto?progettoId=${prg1}`)).corpo).toEqual([]);
  });

  it('niente date future, progetti chiusi o aggiornamenti vuoti', async () => {
    expect((await admin.chiama('POST', '/api/documenti-progetto', { progettoId: prg1, data: '2026-11-30', titolo: 'X', nota: 'y' })).stato).toBe(400);
    const vuoto = await admin.chiama('POST', '/api/documenti-progetto', { progettoId: prg1, data: '2026-11-20', titolo: 'Solo titolo' });
    expect(vuoto.stato).toBe(400);
    expect(vuoto.corpo.campi.nota).toBeDefined();
  });

  it('HR riapre "da vedere", risponde e la ritrova in dashboard', async () => {
    expect((await mario.chiama('PATCH', `/api/documenti-progetto/${idDoc}/revisione`, { visto: false })).stato).toBe(403);
    expect((await admin.chiama('PATCH', `/api/documenti-progetto/${idDoc}/revisione`, { visto: false })).corpo.visto).toBe(false);
    expect((await admin.chiama('GET', '/api/dashboard')).corpo.documentazioneDaVedere).toHaveLength(1);
    const r = await admin.chiama('PATCH', `/api/documenti-progetto/${idDoc}/revisione`, { visto: true, rispostaHr: 'Bene, avanti col piano 2' });
    expect(r.corpo).toMatchObject({ visto: true, rispostaHr: 'Bene, avanti col piano 2', vistoDa: { username: CREDENZIALI_DEMO.admin.username } });
  });

  it('HR elimina, anche il file', async () => {
    const file = (await carica(admin, 'sbagliato.pdf')).corpo.id;
    const d = (await admin.chiama('POST', '/api/documenti-progetto', { progettoId: prg1, data: OGGI_PROVA, titolo: 'Sbagliato', fileId: file })).corpo.id;
    expect((await admin.chiama('DELETE', `/api/documenti-progetto/${d}`)).stato).toBe(204);
    expect(await db.prisma.fileCaricato.findUnique({ where: { id: file } })).toBeNull();
  });
});

describe('invio a SkyTower e note interne', () => {
  const TOKEN = 'token-di-servizio-della-suite-1234567890';
  let finto: http.Server;
  let urlFinto: string;
  const ricevuti: { percorso: string; nome: string; byte: number }[] = [];

  beforeAll(async () => {
    // Finto SkyTower: accetta il documento e risponde con identificativo e link.
    finto = http.createServer((req, res) => {
      const parti: Buffer[] = [];
      req.on('data', (c) => parti.push(c));
      req.on('end', () => {
        ricevuti.push({ percorso: req.url ?? '', nome: decodeURIComponent(String(req.headers['x-suite-nome-file'])), byte: Buffer.concat(parti).length });
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ identifier: 'RP-0042', url: 'http://skytower/doc/42' }));
      });
    });
    await new Promise<void>((ok) => finto.listen(0, '127.0.0.1', () => ok()));
    urlFinto = `http://127.0.0.1:${(finto.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((ok) => finto.close(() => ok())));

  it('serve il collegamento, poi la commessa nel progetto; il documento parte una volta sola', async () => {
    const doc = (await admin.chiama('GET', `/api/documenti-progetto?progettoId=${prg1}`)).corpo.find((d: { titolo: string }) => d.titolo === 'Getto solaio piano 1');
    expect((await admin.chiama('POST', `/api/documenti-progetto/${doc.id}/skytower`)).corpo.errore).toMatch(/non configurato/);
    await admin.chiama('PUT', '/api/impostazioni/skytower', { url: urlFinto, email: 'hr@cosedil.it', token: TOKEN });
    expect((await admin.chiama('POST', `/api/documenti-progetto/${doc.id}/skytower`)).corpo.errore).toMatch(/non ha la commessa/);

    const p = (await admin.chiama('GET', `/api/progetti/${prg1}`)).corpo;
    const salvato = await admin.chiama('PUT', `/api/progetti/${prg1}`, { ...p, commessaSkytower: '101-003', descrizione: 'Ristrutturazione completa' });
    expect(salvato.corpo).toMatchObject({ commessaSkytower: '101-003', descrizione: 'Ristrutturazione completa' });

    expect((await mario.chiama('POST', `/api/documenti-progetto/${doc.id}/skytower`)).stato).toBe(403);
    const inviato = await admin.chiama('POST', `/api/documenti-progetto/${doc.id}/skytower`);
    expect(inviato.stato).toBe(200);
    expect(inviato.corpo).toMatchObject({ skytowerId: 'RP-0042', skytowerUrl: 'http://skytower/doc/42' });
    expect(ricevuti[0]).toMatchObject({ nome: 'Foto getto solaio.pdf', byte: PDF.length });
    expect(ricevuti[0].percorso).toMatch(/^\/suite\/commesse\/101-003\/documenti\?/);
    expect((await admin.chiama('POST', `/api/documenti-progetto/${doc.id}/skytower`)).stato).toBe(409);
  });

  it('note interne: solo HR', async () => {
    expect((await mario.chiama('GET', `/api/note-progetto?progettoId=${prg1}`)).stato).toBe(403);
    const n = await admin.chiama('POST', '/api/note-progetto', { progettoId: prg1, testo: 'Chiedere al DL la variante' });
    expect(n.stato).toBe(201);
    expect((await admin.chiama('GET', `/api/note-progetto?progettoId=${prg1}`)).corpo.map((x: { testo: string }) => x.testo)).toEqual(['Chiedere al DL la variante']);
    expect((await admin.chiama('DELETE', `/api/note-progetto/${n.corpo.id}`)).stato).toBe(204);
  });
});
