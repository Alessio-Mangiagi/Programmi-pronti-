// "><(((º> sabusabu <º)))><"
/**
 * Giorno 5 — calendario. Criterio "fatto quando": filtrando un progetto vedo solo le
 * ore di quel progetto e i totali del giorno sono corretti.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { durataMinuti } from '../../comune/orari';
import { inizioSettimana } from '../../comune/riepiloghi';
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

type Fascia = { data: string; progettoId: number; dipendenteId: number; oraInizio: string; oraFine: string; minuti: number };

describe('GET /api/calendario', () => {
  it('col filtro progetto restituisce solo quel progetto e i totali del giorno tornano', async () => {
    const prg = await db.prisma.progetto.findUniqueOrThrow({ where: { codice: 'PRG-002' } });
    const r = await admin.chiama('GET', `/api/calendario?da=2026-10-01&a=2026-10-31&progettoId=${prg.id}`);
    expect(r.stato).toBe(200);
    const fasce: Fascia[] = r.corpo.fasce;
    expect(fasce.length).toBeGreaterThan(0);
    expect(fasce.every((f) => f.progettoId === prg.id)).toBe(true);

    // Totali del giorno ricalcolati a mano dal database con lo stesso filtro.
    const dalDb = await db.prisma.registrazioneOraria.findMany({ where: { progettoId: prg.id, data: { gte: '2026-10-01', lte: '2026-10-31' } } });
    const attesi: Record<string, number> = {};
    for (const f of dalDb) attesi[f.data] = (attesi[f.data] ?? 0) + durataMinuti(f.oraInizio, f.oraFine);
    expect(r.corpo.totali.perGiorno).toEqual(attesi);
    expect(r.corpo.totali.totale).toBe(Object.values(attesi).reduce((s, m) => s + m, 0));
    expect(Object.keys(r.corpo.totali.perProgetto)).toEqual([String(prg.id)]);
  });

  it('senza filtri il totale del giorno è la somma di tutte le fasce del giorno', async () => {
    const r = await admin.chiama('GET', '/api/calendario?da=2026-11-02&a=2026-11-08');
    const fasce: Fascia[] = r.corpo.fasce;
    const lunedi = fasce.filter((f) => f.data === '2026-11-02').reduce((s, f) => s + f.minuti, 0);
    expect(r.corpo.totali.perGiorno['2026-11-02']).toBe(lunedi);
    expect(r.corpo.totali.perGiorno['2026-11-07']).toBeUndefined(); // sabato
  });

  it('mostra le assenze approvate e in attesa, mai le rifiutate; filtra per tipo', async () => {
    const r = await admin.chiama('GET', '/api/calendario?da=2026-11-01&a=2026-11-30');
    const stati = new Set(r.corpo.assenze.map((a: { stato: string }) => a.stato));
    expect(stati.has('RIFIUTATA')).toBe(false);
    const soloFerie = await admin.chiama('GET', '/api/calendario?da=2026-10-01&a=2026-10-31&tipoAssenza=FERIE');
    expect(soloFerie.corpo.assenze.every((a: { tipo: string }) => a.tipo === 'FERIE')).toBe(true);
    expect(soloFerie.corpo.assenze.length).toBeGreaterThan(0);
    const nessuna = await admin.chiama('GET', '/api/calendario?da=2026-10-01&a=2026-10-31&tipoAssenza=NESSUNA');
    expect(nessuna.corpo.assenze).toEqual([]);
  });

  it('include le festività del periodo', async () => {
    const r = await admin.chiama('GET', '/api/calendario?da=2026-11-01&a=2026-11-30');
    expect(r.corpo.festivita.map((f: { data: string }) => f.data)).toContain('2026-11-01');
  });

  it('il dipendente vede solo le proprie ore e non quelle filtrate su un collega', async () => {
    const giulia = await db.prisma.dipendente.findFirstOrThrow({ where: { cognome: 'Bianchi' } });
    const r = await mario.chiama('GET', '/api/calendario?da=2026-11-01&a=2026-11-30');
    expect(new Set(r.corpo.fasce.map((f: Fascia) => f.dipendenteId)).size).toBe(1);
    expect((await mario.chiama('GET', `/api/calendario?da=2026-11-01&a=2026-11-30&dipendenteId=${giulia.id}`)).stato).toBe(403);
  });

  it('rifiuta periodi mancanti, rovesciati o troppo lunghi', async () => {
    expect((await admin.chiama('GET', '/api/calendario')).stato).toBe(400);
    expect((await admin.chiama('GET', '/api/calendario?da=2026-11-30&a=2026-11-01')).stato).toBe(400);
    expect((await admin.chiama('GET', '/api/calendario?da=2026-01-01&a=2026-12-31')).stato).toBe(400);
  });
});

describe('inizioSettimana', () => {
  it('restituisce il lunedì', () => {
    expect(inizioSettimana('2026-11-23')).toBe('2026-11-23'); // lunedì
    expect(inizioSettimana('2026-11-29')).toBe('2026-11-23'); // domenica
    expect(inizioSettimana('2026-11-01')).toBe('2026-10-26'); // domenica → lunedì prima
  });
});
