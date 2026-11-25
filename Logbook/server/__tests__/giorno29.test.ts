// "><(((º> sabusabu <º)))><"
/**
 * Giorno 29 (24/11/2026) — grafici di avanzamento in dashboard: GET /api/dashboard dà a HR,
 * per ogni progetto non chiuso, le percentuali dichiarate nel tempo (una per giorno, vale
 * l'ultima caricata); al dipendente niente.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CREDENZIALI_DEMO, semina } from '../../prisma/seed';
import { avviaServer, OGGI_PROVA, type ClientProva } from './client-prova';
import { creaDbProva, type DbProva } from './db-prova';

let db: DbProva;
let server: Awaited<ReturnType<typeof avviaServer>>;
let admin: ClientProva;

beforeAll(async () => {
  db = await creaDbProva();
  await semina(db.prisma, OGGI_PROVA);
  server = await avviaServer(db.prisma);
  admin = await server.accedi(CREDENZIALI_DEMO.admin.username, CREDENZIALI_DEMO.admin.password);
});

afterAll(async () => {
  await server.chiudi();
  await db.chiudi();
});

describe('avanzamento dei progetti in dashboard', () => {
  it('serie per progetto non chiuso, in ordine di data, un punto per giorno', async () => {
    const prg = async (codice: string) => (await db.prisma.progetto.findUniqueOrThrow({ where: { codice } })).id;
    const [p1, p2, p3] = [await prg('PRG-001'), await prg('PRG-002'), await prg('PRG-003')];
    const doc = (progettoId: number, data: string, percentuale: number | null) =>
      admin.chiama('POST', '/api/documenti-progetto', { progettoId, data, titolo: `Avanzamento ${data}`, nota: 'prova', percentuale, origine: 'PROGETTO' });
    await doc(p1, '2026-11-10', 30);
    await doc(p1, '2026-10-01', 10);
    await doc(p1, '2026-11-10', 35); // stesso giorno: vale l'ultimo caricato
    await doc(p1, '2026-11-20', null); // senza percentuale: non è un punto
    await doc(p2, '2026-11-05', 60);
    // PRG-003 chiuso: sparisce dal riquadro
    await db.prisma.progetto.update({ where: { id: p3 }, data: { stato: 'CHIUSO' } });

    const r = await admin.chiama('GET', '/api/dashboard');
    const perCodice = Object.fromEntries(r.corpo.avanzamentoProgetti.map((p: { codice: string; punti: unknown[] }) => [p.codice, p.punti]));
    expect(Object.keys(perCodice)).toEqual(['PRG-001', 'PRG-002']);
    expect(perCodice['PRG-001']).toEqual([
      { data: '2026-10-01', percentuale: 10 },
      { data: '2026-11-10', percentuale: 35 },
    ]);
    expect(perCodice['PRG-002']).toEqual([{ data: '2026-11-05', percentuale: 60 }]);
  });

  it('il dipendente non riceve l\'avanzamento dei progetti', async () => {
    const mario = await server.accedi('mario.rossi', CREDENZIALI_DEMO.passwordDipendenti);
    expect((await mario.chiama('GET', '/api/dashboard')).corpo.avanzamentoProgetti).toEqual([]);
  });
});
