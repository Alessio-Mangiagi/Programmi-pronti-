// "><(((º> sabusabu <º)))><"
/**
 * Giorno 9 — dashboard. Criterio "fatto quando": HR vede subito cosa richiede la sua
 * attenzione (richieste da approvare, giorni senza ore) e il riepilogo ore del mese.
 * Oggi = lunedì 23/11/2026; il seed ha ore fino a venerdì 20.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

type RigaDip = { id: number; nome: string; minutiLavorati: number; minutiAttesi: number; giorniSenzaOre: string[] };

describe('GET /api/dashboard', () => {
  it('HR vede le richieste da approvare e i totali del mese uguali al calendario', async () => {
    const r = await admin.chiama('GET', '/api/dashboard');
    expect(r.stato).toBe(200);
    expect(r.corpo.richiesteInAttesa).toHaveLength(2);
    expect(r.corpo.perDipendente).toHaveLength(5);
    const cal = await admin.chiama('GET', '/api/calendario?da=2026-11-01&a=2026-11-23');
    expect(r.corpo.totaleMinuti).toBe(cal.corpo.totali.totale);
  });

  it('nessun giorno senza ore fino a ieri; i giorni mancanti compaiono quando si tolgono le ore', async () => {
    let r = await admin.chiama('GET', '/api/dashboard');
    expect(r.corpo.perDipendente.flatMap((d: RigaDip) => d.giorniSenzaOre)).toEqual([]); // oggi (23) non conta
    const mario = await db.prisma.dipendente.findFirstOrThrow({ where: { cognome: 'Rossi' } });
    await db.prisma.registrazioneOraria.deleteMany({ where: { dipendenteId: mario.id, data: '2026-11-18' } });
    r = await admin.chiama('GET', '/api/dashboard');
    expect(r.corpo.perDipendente.find((d: RigaDip) => d.id === mario.id).giorniSenzaOre).toEqual(['2026-11-18']);
  });

  it('ore attese: giorni lavorativi a oggi × ore settimanali / 5 (part-time compreso)', async () => {
    const r = await admin.chiama('GET', '/api/dashboard');
    const ferrari = r.corpo.perDipendente.find((d: RigaDip) => d.nome === 'Ferrari Chiara');
    // dal 2 al 23 novembre: 16 giorni lavorativi (l'1 è domenica e Ognissanti) × 30h/5 = 6h
    expect(ferrari.minutiAttesi).toBe(16 * 6 * 60);
    const bianchi = r.corpo.perDipendente.find((d: RigaDip) => d.nome === 'Bianchi Giulia');
    expect(bianchi.minutiAttesi).toBe(16 * 8 * 60);
  });

  it('il dipendente vede solo sé stesso e le proprie richieste', async () => {
    const r = await mario.chiama('GET', '/api/dashboard');
    expect(r.corpo.perDipendente).toHaveLength(1);
    expect(r.corpo.perDipendente[0].nome).toBe('Rossi Mario');
    expect(r.corpo.richiesteInAttesa).toEqual([]);
  });
});
