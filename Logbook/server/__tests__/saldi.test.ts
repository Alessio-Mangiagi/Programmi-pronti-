// "><(((º> sabusabu <º)))><"
/**
 * Saldo ferie e permessi (Giorno 38, 26/11/2026): calcolo (comune/saldi.ts) e API
 * (server/rotte/saldi.ts). OGGI_PROVA è lunedì 23/11/2026.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { calcolaSaldo, mesiMaturati, type AssenzaSaldo, type Quota } from '../../comune/saldi';
import { CREDENZIALI_DEMO, semina } from '../../prisma/seed';
import { avviaServer, OGGI_PROVA } from './client-prova';
import { creaDbProva, type DbProva } from './db-prova';

describe('mesi che maturano', () => {
  it('un mese conta se coperto per almeno 15 giorni', () => {
    expect(mesiMaturati('2026-01-01', '2026-12-31')).toBe(12);
    expect(mesiMaturati('2026-01-01', '2026-11-23')).toBe(11); // novembre: 23 giorni
    expect(mesiMaturati('2026-01-01', '2026-11-14')).toBe(10); // novembre: 14 giorni, non ancora
    expect(mesiMaturati('2026-03-17', '2026-04-30')).toBe(2); // marzo dal 17: 15 giorni
    expect(mesiMaturati('2026-03-18', '2026-04-30')).toBe(1); // marzo dal 18: 14 giorni
    expect(mesiMaturati('2025-11-01', '2026-02-28')).toBe(4); // a cavallo d'anno
    expect(mesiMaturati('2026-05-10', '2026-05-01')).toBe(0);
  });
});

describe('calcolo del saldo', () => {
  const quota: Quota = { ferieGiorniAnno: 24, permessiOreAnno: 96, contaDal: '2026-01-01', ferieIniziali: 3, permessiIniziali: -4 };
  const dipendente = { dataAssunzione: '2020-05-04', dataCessazione: null };
  const festivi = new Set(['2026-12-08', '2026-12-25']);
  const a = (tipo: string, stato: string, dataInizio: string, dataFine: string, minutiPermesso: number | null = null): AssenzaSaldo => ({ tipo, stato, dataInizio, dataFine, minutiPermesso });

  it('maturato, goduto, residuo, programmato e in attesa', () => {
    const assenze = [
      a('FERIE', 'APPROVATA', '2026-08-10', '2026-08-21'), // 10 giorni lavorativi goduti
      a('FERIE', 'APPROVATA', '2026-11-20', '2026-11-24'), // ven 20, lun 23 goduti; mar 24 programmato
      a('FERIE', 'APPROVATA', '2026-12-07', '2026-12-09'), // l'8 è festa: 2 giorni programmati
      a('FERIE', 'RICHIESTA', '2026-12-28', '2026-12-31'), // 4 giorni in attesa
      a('FERIE', 'RIFIUTATA', '2026-07-01', '2026-07-10'), // non conta
      a('FERIE', 'APPROVATA', '2025-12-22', '2025-12-31'), // prima di contaDal: non conta
      a('MALATTIA', 'APPROVATA', '2026-03-02', '2026-03-06'), // non è ferie
      a('PERMESSO', 'APPROVATA', '2026-06-03', '2026-06-03', 150),
      a('PERMESSO', 'APPROVATA', '2026-12-01', '2026-12-01', 60),
      a('PERMESSO', 'RICHIESTA', '2026-12-15', '2026-12-15', 90),
    ];
    const s = calcolaSaldo(quota, dipendente, assenze, festivi, '2026-11-23');
    expect(s).toMatchObject({ dal: '2026-01-01', al: '2026-11-23', mesi: 11 });
    // Ferie: 24/12 × 11 = 22 maturate; 3 + 22 − 12 = 13 residue; 3 programmate, 4 in attesa.
    expect(s.ferie).toEqual({ quotaAnno: 24, iniziali: 3, maturate: 22, godute: 12, residue: 13, programmate: 3, inAttesa: 4, disponibile: 6 });
    // Permessi: 96/12 × 11 = 88 ore; −4 + 88 − 2,5 = 81,5; 1 programmata, 1,5 in attesa.
    expect(s.permessi).toEqual({ quotaAnno: 96, iniziali: -4, maturate: 88, godute: 2.5, residue: 81.5, programmate: 1, inAttesa: 1.5, disponibile: 79 });
  });

  it('assunto dopo la data di partenza, o cessato: il periodo si accorcia', () => {
    const nuovo = calcolaSaldo(quota, { dataAssunzione: '2026-09-07', dataCessazione: null }, [], festivi, '2026-11-23');
    expect(nuovo).toMatchObject({ dal: '2026-09-07', mesi: 3 }); // settembre (24 giorni), ottobre, novembre
    expect(nuovo.ferie.maturate).toBe(6);
    const cessato = calcolaSaldo(quota, { dataAssunzione: '2020-05-04', dataCessazione: '2026-06-10' }, [], festivi, '2026-11-23');
    expect(cessato).toMatchObject({ al: '2026-06-10', mesi: 5 }); // giugno: 10 giorni, non matura
  });
});

describe('API /api/saldi', () => {
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

  it('HR scrive la quota e vede tutti; il dipendente vede solo il suo saldo', async () => {
    const admin = await server.accedi(CREDENZIALI_DEMO.admin.username, CREDENZIALI_DEMO.admin.password);
    const mario = await server.accedi('mario.rossi', CREDENZIALI_DEMO.passwordDipendenti);
    const rossi = await db.prisma.dipendente.findFirstOrThrow({ where: { cognome: 'Rossi' } });
    await db.prisma.assenza.deleteMany({ where: { dipendenteId: rossi.id } });
    await db.prisma.assenza.create({ data: { dipendenteId: rossi.id, tipo: 'FERIE', stato: 'APPROVATA', dataInizio: '2026-08-10', dataFine: '2026-08-14' } });

    const prima = await admin.chiama('GET', '/api/saldi');
    expect(prima.corpo.length).toBeGreaterThanOrEqual(5);
    expect(prima.corpo.every((r: { quota: unknown; saldo: unknown }) => r.quota === null && r.saldo === null)).toBe(true);

    const quota = { ferieGiorniAnno: 24, permessiOreAnno: 96, contaDal: '2026-01-01', ferieIniziali: 2, permessiIniziali: 0 };
    expect((await mario.chiama('PUT', `/api/saldi/${rossi.id}`, quota)).stato).toBe(403);
    const negativa = await admin.chiama('PUT', `/api/saldi/${rossi.id}`, { ...quota, ferieGiorniAnno: -1 });
    expect(negativa.stato).toBe(400);
    expect((await admin.chiama('PUT', '/api/saldi/999999', quota)).stato).toBe(404);
    expect((await admin.chiama('PUT', `/api/saldi/${rossi.id}`, quota)).stato).toBe(200);

    const mio = await mario.chiama('GET', '/api/saldi');
    expect(mio.corpo).toHaveLength(1);
    expect(mio.corpo[0]).toMatchObject({ dipendenteId: rossi.id, nome: 'Rossi Mario' });
    // 2 + 24/12 × 11 − 5 = 19.
    expect(mio.corpo[0].saldo.ferie).toMatchObject({ maturate: 22, godute: 5, residue: 19 });

    // Una richiesta nuova entra subito nel saldo come "in attesa".
    expect((await mario.chiama('POST', '/api/assenze', { tipo: 'FERIE', dataInizio: '2026-12-21', dataFine: '2026-12-22' })).stato).toBe(201);
    expect((await mario.chiama('GET', '/api/saldi')).corpo[0].saldo.ferie).toMatchObject({ inAttesa: 2, disponibile: 17 });

    // Cambiare la quota la sostituisce; toglierla fa sparire il saldo.
    expect((await admin.chiama('PUT', `/api/saldi/${rossi.id}`, { ...quota, ferieGiorniAnno: 26 })).stato).toBe(200);
    expect(await db.prisma.quotaAssenze.count()).toBe(1);
    expect((await admin.chiama('DELETE', `/api/saldi/${rossi.id}`)).stato).toBe(200);
    expect((await mario.chiama('GET', '/api/saldi')).corpo[0].saldo).toBeNull();
  }, 60_000);
});
