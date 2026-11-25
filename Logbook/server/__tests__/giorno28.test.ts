// "><(((º> sabusabu <º)))><"
/**
 * Giorno 28 (24/11/2026) — documentazione del giorno nella finestra delle ore (risposta 3c):
 * HR allega file e nota a un giorno, sul progetto di una fascia; finisce nella
 * documentazione del progetto con origine GIORNATA e si rilegge per giorno (?data=).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CREDENZIALI_DEMO, semina } from '../../prisma/seed';
import { avviaServer, OGGI_PROVA, type ClientProva } from './client-prova';
import { creaDbProva, type DbProva } from './db-prova';

let db: DbProva;
let server: Awaited<ReturnType<typeof avviaServer>>;
let admin: ClientProva;
let prg1: number;

const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');

beforeAll(async () => {
  db = await creaDbProva();
  await semina(db.prisma, OGGI_PROVA);
  server = await avviaServer(db.prisma);
  admin = await server.accedi(CREDENZIALI_DEMO.admin.username, CREDENZIALI_DEMO.admin.password);
  prg1 = (await db.prisma.progetto.findUniqueOrThrow({ where: { codice: 'PRG-001' } })).id;
});

afterAll(async () => {
  await server.chiudi();
  await db.chiudi();
});

describe('documentazione del giorno', () => {
  it('HR la salva dalla giornata e la rilegge per giorno; finisce nella documentazione del progetto', async () => {
    const file = await admin.chiama('POST', '/api/file', undefined, { grezzo: PDF, intestazioni: { 'X-Nome-File': 'verbale.pdf' } });
    const r = await admin.chiama('POST', '/api/documenti-progetto', {
      progettoId: prg1, data: '2026-11-20', titolo: 'Giornata del 20/11/2026 – Rossi Mario', nota: 'Getto del solaio', percentuale: 40, fileId: file.corpo.id, origine: 'GIORNATA',
    });
    expect(r.stato).toBe(201);
    expect(r.corpo).toMatchObject({ origine: 'GIORNATA', data: '2026-11-20', visto: true });
    await admin.chiama('POST', '/api/documenti-progetto', { progettoId: prg1, data: '2026-11-19', titolo: 'Altro giorno', nota: 'x', origine: 'GIORNATA' });

    const delGiorno = await admin.chiama('GET', '/api/documenti-progetto?data=2026-11-20');
    expect(delGiorno.corpo.map((d: { titolo: string }) => d.titolo)).toEqual(['Giornata del 20/11/2026 – Rossi Mario']);
    expect(delGiorno.corpo[0].file.nome).toBe('verbale.pdf');
    // Nella pagina del progetto ci sono tutte e due
    expect((await admin.chiama('GET', `/api/documenti-progetto?progettoId=${prg1}`)).corpo).toHaveLength(2);
    expect((await admin.chiama('GET', '/api/documenti-progetto?data=20-11-2026')).stato).toBe(400);
  });

  it('il dipendente non la vede né la crea (carica solo HR dal Giorno 20)', async () => {
    const mario = await server.accedi('mario.rossi', CREDENZIALI_DEMO.passwordDipendenti);
    expect((await mario.chiama('GET', '/api/documenti-progetto?data=2026-11-20')).corpo).toEqual([]);
    expect((await mario.chiama('POST', '/api/documenti-progetto', { progettoId: prg1, data: '2026-11-20', titolo: 'Mio', nota: 'x', origine: 'GIORNATA' })).stato).toBe(403);
  });
});
