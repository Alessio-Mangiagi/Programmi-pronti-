// "><(((º> sabusabu <º)))><"
/**
 * File grandi (Giorno 46, 26/11/2026): caricamento a parti e archivio su Vercel Blob.
 * Lo store Blob qui è finto (una mappa in memoria, `usaArchivioBlob`): si prova che
 * Copilota lo usa nel modo giusto, non il servizio di Vercel.
 * - un file da 7 MB arriva in tre parti, viene ricomposto identico e finisce nel Blob;
 * - si riscarica uguale; cancellandolo sparisce dal Blob;
 * - un file caricato prima dello store (nel database) si legge ancora;
 * - parti mancanti, dimensione sbagliata, contenuto non valido, altro utente: rifiutati.
 */
import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CREDENZIALI_DEMO, semina } from '../../prisma/seed';
import { usaArchivioBlob } from '../servizi/archivio-blob';
import { ARCHIVIO_BLOB, ARCHIVIO_NEL_DATABASE, BYTE_PER_PARTE, cartellaDocumentiPredefinita, eliminaFile, maxByteFile, pulisciFileOrfani } from '../servizi/archivio-file';
import { avviaServer, OGGI_PROVA } from './client-prova';
import { creaDbProva, type DbProva } from './db-prova';

let db: DbProva;
let server: Awaited<ReturnType<typeof avviaServer>>;
const blob = new Map<string, { dati: Buffer; tipo: string }>();
let rimetti: () => void;

/** Un PDF finto di `byte` byte: intestazione vera, poi dati casuali. */
const pdf = (byte: number) => Buffer.concat([Buffer.from('%PDF-1.4\n'), crypto.randomBytes(byte - 9)]);

beforeAll(async () => {
  db = await creaDbProva();
  await semina(db.prisma, OGGI_PROVA);
  rimetti = usaArchivioBlob({
    metti: async (nome, dati, tipo) => void blob.set(nome, { dati, tipo }),
    leggi: async (nome) => blob.get(nome)?.dati ?? null,
    togli: async (nome) => void blob.delete(nome),
  });
  server = await avviaServer(db.prisma, { oggi: () => OGGI_PROVA, cartellaDocumenti: ARCHIVIO_BLOB });
});
afterAll(async () => {
  rimetti();
  await server.chiudi();
  await db.chiudi();
});

describe('quale archivio', () => {
  it('su PostgreSQL: Blob se lo store è collegato, altrimenti database; limiti di dimensione', () => {
    const prima = { url: process.env.DATABASE_URL, token: process.env.BLOB_READ_WRITE_TOKEN };
    try {
      process.env.DATABASE_URL = 'postgres://u:p@host/db';
      delete process.env.BLOB_READ_WRITE_TOKEN;
      expect(cartellaDocumentiPredefinita()).toBe(ARCHIVIO_NEL_DATABASE);
      process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_finto';
      expect(cartellaDocumentiPredefinita()).toBe(ARCHIVIO_BLOB);
    } finally {
      if (prima.url === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prima.url;
      if (prima.token === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
      else process.env.BLOB_READ_WRITE_TOKEN = prima.token;
    }
    expect(maxByteFile(ARCHIVIO_BLOB)).toBe(20 * 1024 * 1024);
    expect(maxByteFile(ARCHIVIO_NEL_DATABASE)).toBe(4 * 1024 * 1024);
  });
});

describe('caricamento a parti verso il Blob', () => {
  it('7 MB in tre parti: ricomposto identico, nel Blob, riscaricato uguale, poi cancellato', async () => {
    const admin = await server.accedi(CREDENZIALI_DEMO.admin.username, CREDENZIALI_DEMO.admin.password);
    const mario = await server.accedi('mario.rossi', CREDENZIALI_DEMO.passwordDipendenti);
    expect((await admin.chiama('GET', '/api/file/limiti')).corpo).toEqual({ massimo: 20 * 1024 * 1024, bytePerParte: BYTE_PER_PARTE });

    const dati = pdf(7 * 1024 * 1024);
    const inizio = await admin.chiama('POST', '/api/file/parti', { nome: 'Capitolato grande.pdf', dimensione: dati.length });
    expect(inizio.stato).toBe(201);
    expect(inizio.corpo).toMatchObject({ parti: 3, bytePerParte: BYTE_PER_PARTE });
    const id = inizio.corpo.caricamento as string;
    const parte = (n: number, chi = admin) => chi.chiama('PUT', `/api/file/parti/${id}/${n}`, undefined, { grezzo: dati.subarray(n * BYTE_PER_PARTE, (n + 1) * BYTE_PER_PARTE) });

    // Un altro utente non può aggiungere parti né chiudere il caricamento.
    expect((await parte(0, mario)).stato).toBe(404);
    expect((await mario.chiama('POST', `/api/file/parti/${id}/fine`)).stato).toBe(404);
    expect((await parte(3)).stato).toBe(400); // numero fuori dall'intervallo
    // Le parti arrivano anche in disordine.
    for (const n of [2, 0, 1]) expect((await parte(n)).stato).toBe(200);
    const fine = await admin.chiama('POST', `/api/file/parti/${id}/fine`);
    expect(fine.stato).toBe(201);
    expect(fine.corpo).toMatchObject({ nome: 'Capitolato grande.pdf', tipo: 'application/pdf', dimensione: dati.length });

    const riga = await db.prisma.fileCaricato.findUniqueOrThrow({ where: { id: fine.corpo.id } });
    expect(riga.sha256).toBe(crypto.createHash('sha256').update(dati).digest('hex'));
    // Sta nel Blob, non nel database; le parti temporanee sono sparite.
    expect(blob.get(riga.nomeDisco)?.dati.equals(dati)).toBe(true);
    expect(blob.get(riga.nomeDisco)?.tipo).toBe('application/pdf');
    expect(await db.prisma.contenutoFile.count()).toBe(0);

    const scaricato = await admin.chiama('GET', `/api/file/${fine.corpo.id}`);
    expect(scaricato.stato).toBe(200);
    expect((scaricato.corpo as Buffer).equals(dati)).toBe(true);
    expect(scaricato.intestazioni.get('content-length')).toBe(String(dati.length));

    await eliminaFile(db.prisma, ARCHIVIO_BLOB, fine.corpo.id);
    expect(blob.size).toBe(0);
  }, 60_000);

  it('caricamento incompleto, dimensione diversa da quella dichiarata, contenuto non valido, troppo grande', async () => {
    const admin = await server.accedi(CREDENZIALI_DEMO.admin.username, CREDENZIALI_DEMO.admin.password);
    const apri = async (nome: string, dimensione: number) => (await admin.chiama('POST', '/api/file/parti', { nome, dimensione })).corpo.caricamento as string;
    const manda = (id: string, n: number, b: Buffer) => admin.chiama('PUT', `/api/file/parti/${id}/${n}`, undefined, { grezzo: b });

    expect((await admin.chiama('POST', '/api/file/parti', { nome: 'enorme.pdf', dimensione: 21 * 1024 * 1024 })).stato).toBe(413);

    const dati = pdf(4 * 1024 * 1024);
    const incompleto = await apri('a.pdf', dati.length);
    await manda(incompleto, 0, dati.subarray(0, BYTE_PER_PARTE));
    const manca = await admin.chiama('POST', `/api/file/parti/${incompleto}/fine`);
    expect(manca.stato).toBe(400);
    expect(manca.corpo.errore).toMatch(/manca la parte 2 di 2/);
    // Dopo un tentativo fallito il caricamento è chiuso e le parti tolte.
    expect((await admin.chiama('POST', `/api/file/parti/${incompleto}/fine`)).stato).toBe(404);
    expect(await db.prisma.contenutoFile.count()).toBe(0);

    const corto = await apri('b.pdf', dati.length);
    await manda(corto, 0, dati.subarray(0, BYTE_PER_PARTE));
    await manda(corto, 1, dati.subarray(BYTE_PER_PARTE, dati.length - 10));
    expect((await admin.chiama('POST', `/api/file/parti/${corto}/fine`)).corpo.errore).toMatch(/dimensione dichiarata/);

    // Un file che si dice PDF ma non lo è: rifiutato come nel caricamento normale.
    const finto = crypto.randomBytes(4 * 1024 * 1024);
    finto[0] = 0x00;
    const falso = await apri('c.pdf', finto.length);
    await manda(falso, 0, finto.subarray(0, BYTE_PER_PARTE));
    await manda(falso, 1, finto.subarray(BYTE_PER_PARTE));
    expect((await admin.chiama('POST', `/api/file/parti/${falso}/fine`)).stato).toBe(415);
    expect(blob.size).toBe(0);
    expect(await db.prisma.fileCaricato.count()).toBe(0);
  }, 60_000);

  it('file rimasti nel database da prima dello store si leggono ancora; le parti abbandonate vengono pulite', async () => {
    const admin = await server.accedi(CREDENZIALI_DEMO.admin.username, CREDENZIALI_DEMO.admin.password);
    const vecchio = pdf(2000);
    const io = await db.prisma.utente.findUniqueOrThrow({ where: { username: 'admin' } });
    const riga = await db.prisma.fileCaricato.create({ data: { nomeDisco: 'vecchio-file.pdf', nomeOriginale: 'Vecchio.pdf', tipoMime: 'application/pdf', dimensione: vecchio.length, sha256: 'x', caricatoDaId: io.id } });
    await db.prisma.contenutoFile.create({ data: { nomeDisco: 'vecchio-file.pdf', dati: new Uint8Array(vecchio) } });
    expect(((await admin.chiama('GET', `/api/file/${riga.id}`)).corpo as Buffer).equals(vecchio)).toBe(true);

    await db.prisma.contenutoFile.create({ data: { nomeDisco: 'parte:0123456789abcdef0123456789abcdef:0', dati: new Uint8Array([1, 2, 3]) } });
    await pulisciFileOrfani(db.prisma, ARCHIVIO_BLOB, new Date(Date.now() + 3 * 24 * 60 * 60 * 1000));
    expect(await db.prisma.contenutoFile.count({ where: { nomeDisco: { startsWith: 'parte:' } } })).toBe(0);
  });
});
