// "><(((º> sabusabu <º)))><"
/**
 * Giorno 1 — fondamenta: i dati di esempio sono coerenti e l'API li legge dal database.
 *
 * Il seed gira con un "oggi" fisso (lunedì 23/11/2026), così i numeri attesi non
 * cambiano col passare dei giorni: ottobre completo (22 giorni lavorativi) + 1-20
 * novembre (15), 9 fasce al giorno (Ferrari è part-time, una fascia sola), meno le
 * ferie di Rossi (3 giorni × 2 fasce) e la malattia di Esposito (2 giorni × 2 fasce).
 */
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { semina } from '../../prisma/seed';
import { validaCodiceFiscale } from '../../comune/codiceFiscale';
import { festivitaNazionali } from '../../comune/festivita';
import { isFineSettimana } from '../../comune/date';
import { durataMinuti } from '../../comune/orari';
import { creaApp } from '../app';
import { creaDbProva, type DbProva } from './db-prova';

const OGGI = '2026-11-23';
let db: DbProva;

beforeAll(async () => {
  db = await creaDbProva();
  await semina(db.prisma, OGGI);
});

afterAll(async () => {
  await db.chiudi();
});

describe('dati di esempio', () => {
  it('ha 5 dipendenti con codice fiscale valido, 3 progetti e le festività 2026', async () => {
    const dipendenti = await db.prisma.dipendente.findMany();
    expect(dipendenti).toHaveLength(5);
    for (const d of dipendenti) expect(validaCodiceFiscale(d.codiceFiscale).valido).toBe(true);
    expect(await db.prisma.progetto.count()).toBe(3);
    expect(await db.prisma.festivita.count()).toBe(festivitaNazionali(2026).length);
  });

  it('copre dal 01/10 al giorno prima di oggi, senza ore nei weekend e nei festivi', async () => {
    const fasce = await db.prisma.registrazioneOraria.findMany();
    expect(fasce).toHaveLength(37 * 9 - 3 * 2 - 2 * 2);
    const date = fasce.map((f) => f.data).sort();
    expect(date[0]).toBe('2026-10-01');
    expect(date[date.length - 1]).toBe('2026-11-20'); // il 21-22 sono sabato e domenica
    const festivi = new Set(festivitaNazionali(2026).map((f) => f.data));
    expect(fasce.filter((f) => isFineSettimana(f.data) || festivi.has(f.data))).toEqual([]);
  });

  it('nessuna ora nei giorni di ferie o malattia approvate', async () => {
    const assenze = await db.prisma.assenza.findMany({ where: { stato: 'APPROVATA', tipo: { in: ['FERIE', 'MALATTIA'] } } });
    expect(assenze).toHaveLength(2);
    for (const a of assenze) {
      const sovrapposte = await db.prisma.registrazioneOraria.count({
        where: { dipendenteId: a.dipendenteId, data: { gte: a.dataInizio, lte: a.dataFine } },
      });
      expect(sovrapposte).toBe(0);
    }
  });

  it('nel giorno di permesso approvato le ore lavorate sono ridotte del permesso', async () => {
    const permesso = await db.prisma.assenza.findFirstOrThrow({ where: { stato: 'APPROVATA', tipo: 'PERMESSO' } });
    const fasce = await db.prisma.registrazioneOraria.findMany({
      where: { dipendenteId: permesso.dipendenteId, data: permesso.dataInizio },
    });
    const lavorati = fasce.reduce((s, f) => s + durataMinuti(f.oraInizio, f.oraFine), 0);
    expect(lavorati + (permesso.minutiPermesso ?? 0)).toBe(8 * 60);
  });

  it('la malattia conserva solo il protocollo del certificato', async () => {
    const malattia = await db.prisma.assenza.findFirstOrThrow({ where: { tipo: 'MALATTIA' } });
    expect(malattia.protocolloCertificato).toBeTruthy();
    // Nessun campo per la diagnosi nel modello: se qualcuno lo aggiunge, questo test lo segnala.
    expect(Object.keys(malattia).filter((k) => /diagnos|patolog|sanitar/i.test(k))).toEqual([]);
  });

  it('rifiuta di ripartire su un database che ha già dei dipendenti', async () => {
    await expect(semina(db.prisma, OGGI)).rejects.toThrow(/db:reset/);
  });
});

describe('API', () => {
  it('GET /api/stato-dati restituisce i conteggi letti dal database', async () => {
    const server = creaApp(db.prisma).listen(0, '127.0.0.1');
    await new Promise((ok) => server.once('listening', ok));
    try {
      const { port } = server.address() as AddressInfo;
      const r = await fetch(`http://127.0.0.1:${port}/api/stato-dati`);
      expect(r.status).toBe(200);
      const dati = (await r.json()) as { minutiTotali: number; periodo: unknown };
      expect(dati).toMatchObject({ dipendenti: 5, progetti: 3, registrazioni: 323, assenze: 6 });
      expect(dati.periodo).toEqual({ da: '2026-10-01', a: '2026-11-20' });
      expect(dati.minutiTotali).toBeGreaterThan(0);

      const sconosciuta = await fetch(`http://127.0.0.1:${port}/api/non-esiste`);
      expect(sconosciuta.status).toBe(404);
    } finally {
      server.close();
    }
  });
});
