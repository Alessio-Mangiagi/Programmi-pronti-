// "><(((º> sabusabu <º)))><"
/**
 * Giorno 22 (24/11/2026) — allegato facoltativo alle assenze (risposta 3b).
 *
 * Il dipendente allega un file alla sua richiesta (finché è in attesa); HR può allegarlo
 * a qualsiasi assenza. Il file lo aprono HR, chi l'ha caricato e il dipendente
 * dell'assenza; non gli altri. Sostituirlo o eliminare l'assenza cancella il file vecchio;
 * un file già collegato altrove non si riusa; la pulizia degli orfani non tocca gli allegati.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CREDENZIALI_DEMO, semina } from '../../prisma/seed';
import { pulisciFileOrfani } from '../servizi/archivio-file';
import { avviaServer, OGGI_PROVA, type ClientProva } from './client-prova';
import { creaDbProva, type DbProva } from './db-prova';

let db: DbProva;
let server: Awaited<ReturnType<typeof avviaServer>>;
let admin: ClientProva;
let mario: ClientProva;
let giulia: ClientProva;
let idMario: number;

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
const carica = (c: ClientProva, nome: string) => c.chiama('POST', '/api/file', undefined, { grezzo: PDF, intestazioni: { 'X-Nome-File': encodeURIComponent(nome) } });
/** Un permesso di 2 ore a dicembre (giorno lavorativo, nessuna ora registrata). */
const permesso = (fileId: number | null) => ({ tipo: 'PERMESSO', dataInizio: '2026-12-02', dataFine: '2026-12-02', minutiPermesso: 120, noteDipendente: 'Visita', fileId });

beforeAll(async () => {
  db = await creaDbProva();
  await semina(db.prisma, OGGI_PROVA);
  server = await avviaServer(db.prisma);
  admin = await server.accedi(CREDENZIALI_DEMO.admin.username, CREDENZIALI_DEMO.admin.password);
  mario = await server.accedi('mario.rossi', CREDENZIALI_DEMO.passwordDipendenti);
  giulia = await server.accedi('giulia.bianchi', CREDENZIALI_DEMO.passwordDipendenti);
  idMario = (await db.prisma.dipendente.findFirstOrThrow({ where: { cognome: 'Rossi' } })).id;
});

afterAll(async () => {
  await server.chiudi();
  await db.chiudi();
});

describe('allegato alle assenze', () => {
  let idAssenza: number;
  let primoFile: number;

  it('il dipendente allega un file alla sua richiesta', async () => {
    primoFile = (await carica(mario, 'Giustificativo visita.pdf')).corpo.id;
    const r = await mario.chiama('POST', '/api/assenze', permesso(primoFile));
    expect(r.stato).toBe(201);
    expect(r.corpo.file).toMatchObject({ id: primoFile, nome: 'Giustificativo visita.pdf' });
    expect(r.corpo.file.nomeDisco).toBeUndefined();
    idAssenza = r.corpo.id;
    expect((await mario.chiama('GET', `/api/assenze/${idAssenza}`)).corpo.file.id).toBe(primoFile);
  });

  it('il file lo aprono HR e il dipendente, non i colleghi', async () => {
    expect((await mario.chiama('GET', `/api/file/${primoFile}`)).stato).toBe(200);
    expect((await admin.chiama('GET', `/api/file/${primoFile}`)).stato).toBe(200);
    expect((await giulia.chiama('GET', `/api/file/${primoFile}`)).stato).toBe(403);
  });

  it('HR sostituisce l\'allegato: il dipendente apre anche quello di HR, il vecchio sparisce', async () => {
    const diHr = (await carica(admin, 'Giustificativo firmato.pdf')).corpo.id;
    const vecchioSuDisco = (await db.prisma.fileCaricato.findUniqueOrThrow({ where: { id: primoFile } })).nomeDisco;
    const r = await admin.chiama('PUT', `/api/assenze/${idAssenza}`, permesso(diHr));
    expect(r.stato).toBe(200);
    expect(r.corpo.file.id).toBe(diHr);
    expect(await db.prisma.fileCaricato.findUnique({ where: { id: primoFile } })).toBeNull();
    expect(fs.existsSync(path.join(server.cartellaDocumenti, vecchioSuDisco))).toBe(false);
    expect((await mario.chiama('GET', `/api/file/${diHr}`)).stato).toBe(200);
    expect((await giulia.chiama('GET', `/api/file/${diHr}`)).stato).toBe(403);
  });

  it('un file già collegato non si riusa; la pulizia degli orfani non tocca gli allegati', async () => {
    const attuale = (await mario.chiama('GET', `/api/assenze/${idAssenza}`)).corpo.file.id;
    const altra = await admin.chiama('POST', '/api/assenze', { ...permesso(attuale), dipendenteId: idMario, dataInizio: '2026-12-03', dataFine: '2026-12-03' });
    expect(altra.stato).toBe(409);
    await pulisciFileOrfani(db.prisma, server.cartellaDocumenti, new Date(Date.now() + 48 * 60 * 60 * 1000));
    expect(await db.prisma.fileCaricato.findUnique({ where: { id: attuale } })).not.toBeNull();
  });

  it('eliminare l\'assenza cancella anche il file', async () => {
    const attuale = (await mario.chiama('GET', `/api/assenze/${idAssenza}`)).corpo.file.id;
    expect((await mario.chiama('DELETE', `/api/assenze/${idAssenza}`)).stato).toBe(200);
    expect(await db.prisma.fileCaricato.findUnique({ where: { id: attuale } })).toBeNull();
  });
});
