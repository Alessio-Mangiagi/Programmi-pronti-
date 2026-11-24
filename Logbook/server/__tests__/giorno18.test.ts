// "><(((º> sabusabu <º)))><"
/**
 * Giorno 18 (24/11/2026) — lato server della scheda in pagina:
 * - GET /api/assenze/:id per la pagina dell'assenza (il dipendente solo le proprie);
 * - omonimi distinti dal codice fiscale nei nomi composti dalla dashboard.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { carattereControllo } from '../../comune/codiceFiscale';
import { CREDENZIALI_DEMO, semina } from '../../prisma/seed';
import { avviaServer, OGGI_PROVA, type ClientProva } from './client-prova';
import { creaDbProva, type DbProva } from './db-prova';

let db: DbProva;
let server: Awaited<ReturnType<typeof avviaServer>>;
let admin: ClientProva;
let mario: ClientProva;

beforeAll(async () => {
  db = await creaDbProva();
  await semina(db.prisma, OGGI_PROVA);
  server = await avviaServer(db.prisma);
  admin = await server.accedi(CREDENZIALI_DEMO.admin.username, CREDENZIALI_DEMO.admin.password);
  mario = await server.accedi('mario.rossi', CREDENZIALI_DEMO.passwordDipendenti);
});

afterAll(async () => {
  await server.chiudi();
  await db.chiudi();
});

describe('pagina dell\'assenza', () => {
  it('una sola assenza con i giorni lavorativi; il dipendente vede solo le sue', async () => {
    const rossi = await db.prisma.dipendente.findFirstOrThrow({ where: { cognome: 'Rossi' } });
    const sua = await db.prisma.assenza.findFirstOrThrow({ where: { dipendenteId: rossi.id } });
    const altrui = await db.prisma.assenza.findFirstOrThrow({ where: { dipendenteId: { not: rossi.id } } });
    const r = await mario.chiama('GET', `/api/assenze/${sua.id}`);
    expect(r.stato).toBe(200);
    expect(r.corpo).toMatchObject({ id: sua.id, tipo: sua.tipo, dipendente: { cognome: 'Rossi' } });
    expect(r.corpo.giorniLavorativi).toBeGreaterThan(0);
    expect((await mario.chiama('GET', `/api/assenze/${altrui.id}`)).stato).toBe(403);
    expect((await admin.chiama('GET', `/api/assenze/${altrui.id}`)).stato).toBe(200);
    expect((await admin.chiama('GET', '/api/assenze/99999')).stato).toBe(404);
  });
});

describe('omonimi nella dashboard', () => {
  it('due Mario Rossi: i nomi riportano l\'inizio del codice fiscale', async () => {
    const cf = 'RSSMRA90A01H501' + carattereControllo('RSSMRA90A01H501');
    const nuovo = await admin.chiama('POST', '/api/dipendenti', {
      matricola: '0099', nome: 'Mario', cognome: 'Rossi', codiceFiscale: cf, dataAssunzione: '2026-01-12',
      tipoContratto: 'INDETERMINATO', oreSettimanali: 40,
    });
    expect(nuovo.stato).toBe(201);
    const nomi = (await admin.chiama('GET', '/api/dashboard')).corpo.perDipendente.map((d: { nome: string }) => d.nome);
    expect(nomi).toContain('Rossi Mario (CF RSSMRA8)');
    expect(nomi).toContain('Rossi Mario (CF RSSMRA9)');
    expect(nomi).toContain('Bianchi Giulia');
    // Il dipendente vede solo sé stesso: nessun omonimo nel suo elenco, nome semplice.
    expect((await mario.chiama('GET', '/api/dashboard')).corpo.perDipendente[0].nome).toBe('Rossi Mario');
  });
});
