// "><(((º> sabusabu <º)))><"
/**
 * Costo della manodopera per commessa (Giorno 41, 26/11/2026), server/rotte/costi-progetti.ts.
 * Un progetto nuovo con ore note, così i numeri attesi si calcolano a mano.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CREDENZIALI_DEMO, semina } from '../../prisma/seed';
import { costoCent, percentuale } from '../rotte/costi-progetti';
import { avviaServer, OGGI_PROVA } from './client-prova';
import { creaDbProva, type DbProva } from './db-prova';

let db: DbProva;
let server: Awaited<ReturnType<typeof avviaServer>>;

beforeAll(async () => {
  db = await creaDbProva();
  await semina(db.prisma, OGGI_PROVA);
  server = await avviaServer(db.prisma, { oggi: () => OGGI_PROVA });
});
afterAll(async () => {
  await server.chiudi();
  await db.chiudi();
});

describe('conti', () => {
  it('costo di minuti a un costo orario; percentuale del preventivo', () => {
    expect(costoCent(90, 2000)).toBe(3000); // 1 ora e mezza a 20 €
    expect(costoCent(50, 1999)).toBe(1666); // arrotondato al centesimo
    expect(percentuale(250, 1000)).toBe(25);
    expect(percentuale(1234, 1000)).toBe(123.4);
    expect(percentuale(10, null)).toBeNull();
    expect(percentuale(10, 0)).toBeNull();
  });
});

describe('API /api/costi-progetti', () => {
  it('ore e costo per dipendente e per mese, preventivo, chi non ha il costo orario; niente ai dipendenti', async () => {
    const admin = await server.accedi(CREDENZIALI_DEMO.admin.username, CREDENZIALI_DEMO.admin.password);
    const mario = await server.accedi('mario.rossi', CREDENZIALI_DEMO.passwordDipendenti);
    const rossi = await db.prisma.dipendente.findFirstOrThrow({ where: { cognome: 'Rossi' } });
    const esposito = await db.prisma.dipendente.findFirstOrThrow({ where: { cognome: 'Esposito' } });
    const russo = await db.prisma.dipendente.findFirstOrThrow({ where: { cognome: 'Russo' } });
    await db.prisma.dipendente.update({ where: { id: rossi.id }, data: { costoOrarioLordoCent: 3000, costoOrarioNettoCent: 2000 } });
    await db.prisma.dipendente.update({ where: { id: esposito.id }, data: { costoOrarioLordoCent: 2400, costoOrarioNettoCent: 1500 } });
    await db.prisma.dipendente.update({ where: { id: russo.id }, data: { costoOrarioLordoCent: null, costoOrarioNettoCent: null } });
    const p = await db.prisma.progetto.create({ data: { codice: 'PRG-COSTI', nome: 'Prova dei costi', dataInizio: '2026-09-01' } });
    await db.prisma.assegnazioneProgetto.create({ data: { progettoId: p.id, dipendenteId: rossi.id } });
    const fascia = (dipendenteId: number, data: string, oraInizio: string, oraFine: string) => ({ progettoId: p.id, dipendenteId, data, oraInizio, oraFine });
    await db.prisma.registrazioneOraria.createMany({
      data: [
        fascia(rossi.id, '2026-09-15', '08:00', '12:00'), // 4 h × 30 € = 120
        fascia(rossi.id, '2026-10-06', '08:00', '10:30'), // 2,5 h × 30 € = 75
        fascia(esposito.id, '2026-10-06', '13:00', '17:00'), // 4 h × 24 € = 96
        fascia(russo.id, '2026-10-07', '08:00', '11:00'), // 3 h, senza costo orario
      ],
    });

    // Solo HR, anche per il preventivo.
    expect((await mario.chiama('GET', '/api/costi-progetti')).stato).toBe(403);
    expect((await mario.chiama('GET', `/api/costi-progetti/${p.id}`)).stato).toBe(403);
    expect((await mario.chiama('PUT', `/api/costi-progetti/${p.id}/preventivo`, { preventivoManodoperaCent: 1, preventivoOre: 1 })).stato).toBe(403);

    expect((await admin.chiama('PUT', `/api/costi-progetti/${p.id}/preventivo`, { preventivoManodoperaCent: -5, preventivoOre: 10 })).stato).toBe(400);
    const preventivo = await admin.chiama('PUT', `/api/costi-progetti/${p.id}/preventivo`, { preventivoManodoperaCent: 100000, preventivoOre: 20 });
    expect(preventivo.corpo).toEqual({ preventivoManodoperaCent: 100000, preventivoOre: 20 });

    const d = (await admin.chiama('GET', `/api/costi-progetti/${p.id}`)).corpo;
    expect(d).toMatchObject({ codice: 'PRG-COSTI', minuti: 810, costoLordoCent: 29100, costoNettoCent: 19000, senzaCosto: 1, percentualeCosto: 29.1, percentualeOre: 67.5 });
    expect(d.perDipendente).toEqual([
      { dipendenteId: esposito.id, nome: 'Esposito Luca', minuti: 240, costoOrarioLordoCent: 2400, costoLordoCent: 9600 },
      { dipendenteId: rossi.id, nome: 'Rossi Mario', minuti: 390, costoOrarioLordoCent: 3000, costoLordoCent: 19500 },
      { dipendenteId: russo.id, nome: 'Russo Giuseppe', minuti: 180, costoOrarioLordoCent: null, costoLordoCent: null },
    ]);
    expect(d.perMese).toEqual([
      { mese: '2026-09', minuti: 240, costoLordoCent: 12000 },
      { mese: '2026-10', minuti: 570, costoLordoCent: 17100 },
    ]);

    const elenco = (await admin.chiama('GET', '/api/costi-progetti')).corpo;
    expect(elenco.find((r: { id: number }) => r.id === p.id)).toMatchObject({ minuti: 810, costoLordoCent: 29100, senzaCosto: 1, percentualeCosto: 29.1 });
    expect(elenco.length).toBeGreaterThanOrEqual(4);

    // Il preventivo si toglie lasciando vuoto; e ai dipendenti non arriva mai.
    await admin.chiama('PUT', `/api/costi-progetti/${p.id}/preventivo`, { preventivoManodoperaCent: 50000, preventivoOre: '' });
    expect((await admin.chiama('GET', `/api/costi-progetti/${p.id}`)).corpo).toMatchObject({ preventivoOre: null, percentualeOre: null, percentualeCosto: 58.2 });
    const visto = (await mario.chiama('GET', `/api/progetti/${p.id}`)).corpo;
    expect(visto.codice).toBe('PRG-COSTI');
    expect(visto).not.toHaveProperty('preventivoManodoperaCent');
    expect(visto).not.toHaveProperty('preventivoOre');
    const miei = (await mario.chiama('GET', '/api/progetti')).corpo;
    expect(miei.some((x: object) => 'preventivoManodoperaCent' in x || 'preventivoOre' in x)).toBe(false);
    expect((await admin.chiama('GET', '/api/progetti')).corpo.find((x: { id: number }) => x.id === p.id).preventivoManodoperaCent).toBe(50000);
  }, 60_000);
});
