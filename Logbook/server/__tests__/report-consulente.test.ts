// "><(((º> sabusabu <º)))><"
/**
 * File per il consulente paghe (Giorno 44, 26/11/2026), server/servizi/report-consulente.ts.
 * Una settimana costruita a mano per Rossi (lun 2 – dom 8 novembre 2026), così ogni riga
 * attesa si scrive a mano: ore, ferie, permesso, malattia, sabato e domenica, festivo.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CREDENZIALI_DEMO, semina } from '../../prisma/seed';
import { caricaLibro } from '../servizi/excel';
import { avviaServer, OGGI_PROVA } from './client-prova';
import { creaDbProva, type DbProva } from './db-prova';

let db: DbProva;
let server: Awaited<ReturnType<typeof avviaServer>>;
let rossiId: number;

beforeAll(async () => {
  db = await creaDbProva();
  await semina(db.prisma, OGGI_PROVA);
  server = await avviaServer(db.prisma, { oggi: () => OGGI_PROVA });
  const rossi = await db.prisma.dipendente.findFirstOrThrow({ where: { cognome: 'Rossi' } });
  rossiId = rossi.id;
  const p = await db.prisma.progetto.findFirstOrThrow({ where: { assegnazioni: { some: { dipendenteId: rossi.id } } } });
  await db.prisma.registrazioneOraria.deleteMany({ where: { dipendenteId: rossi.id, data: { gte: '2026-11-02', lte: '2026-11-08' } } });
  await db.prisma.assenza.deleteMany({ where: { dipendenteId: rossi.id } });
  await db.prisma.festivita.deleteMany({ where: { data: { gte: '2026-11-02', lte: '2026-11-08' } } });
  const fascia = (data: string, oraInizio: string, oraFine: string, note: string | null = null) => ({ dipendenteId: rossi.id, progettoId: p.id, data, oraInizio, oraFine, note });
  await db.prisma.registrazioneOraria.createMany({
    data: [fascia('2026-11-02', '08:00', '12:00', 'Getto solaio'), fascia('2026-11-02', '13:00', '16:30'), fascia('2026-11-03', '08:00', '14:00')],
  });
  await db.prisma.assenza.createMany({
    data: [
      { dipendenteId: rossi.id, tipo: 'PERMESSO', stato: 'APPROVATA', dataInizio: '2026-11-03', dataFine: '2026-11-03', minutiPermesso: 90 },
      { dipendenteId: rossi.id, tipo: 'MALATTIA', stato: 'APPROVATA', dataInizio: '2026-11-04', dataFine: '2026-11-04' },
      // Ferie da giovedì a domenica: contano giovedì; venerdì è festa, sabato e domenica non sono lavorativi.
      { dipendenteId: rossi.id, tipo: 'FERIE', stato: 'APPROVATA', dataInizio: '2026-11-05', dataFine: '2026-11-08' },
      // Una richiesta non approvata non compare.
      { dipendenteId: rossi.id, tipo: 'FERIE', stato: 'RICHIESTA', dataInizio: '2026-11-02', dataFine: '2026-11-02' },
    ],
  });
  await db.prisma.festivita.create({ data: { data: '2026-11-06', descrizione: 'Patrono; "festa" locale', tipo: 'LOCALE' } });
});
afterAll(async () => {
  await server.chiudi();
  await db.chiudi();
});

const filtri = () => ({ da: '2026-11-02', a: '2026-11-08', dipendenteIds: [rossiId], progettoIds: [] });

describe('file per il consulente paghe', () => {
  it('CSV: una riga per giorno con ore, ferie, malattia, permesso, festività', async () => {
    const admin = await server.accedi(CREDENZIALI_DEMO.admin.username, CREDENZIALI_DEMO.admin.password);
    const mario = await server.accedi('mario.rossi', CREDENZIALI_DEMO.passwordDipendenti);
    expect((await mario.chiama('POST', '/api/esporta/consulente-csv', filtri())).stato).toBe(403);
    const r = await admin.chiama('POST', '/api/esporta/consulente-csv', filtri());
    expect(r.stato).toBe(200);
    expect(r.intestazioni.get('content-type')).toMatch(/text\/csv/);
    expect(r.intestazioni.get('content-disposition')).toMatch(/presenze per il consulente 2026-11-02 2026-11-08\.csv/);
    const testo = (r.corpo as Buffer).toString('utf8');
    expect(testo.charCodeAt(0)).toBe(0xfeff); // BOM: Excel riconosce gli accenti
    const righe = testo.slice(1).trimEnd().split('\r\n');
    expect(righe[0]).toBe('Matricola;Cognome;Nome;Codice fiscale;Data;Giorno;Tipo giorno;Ore lavorate;Ore lavorate (h:mm);Ferie (giorni);Malattia (giorni);Permesso (ore);Festività;Ore contrattuali;Note');
    expect(righe).toHaveLength(8);
    const dati = righe.slice(1).map((x) => x.split(';').slice(4));
    expect(dati).toEqual([
      ['02/11/2026', 'lunedì', 'lavorativo', '7,5', '7:30', '0', '0', '0', '', '8', 'Getto solaio'],
      ['03/11/2026', 'martedì', 'lavorativo', '6', '6:00', '0', '0', '1,5', '', '8', ''],
      ['04/11/2026', 'mercoledì', 'lavorativo', '0', '0:00', '0', '1', '0', '', '8', ''],
      ['05/11/2026', 'giovedì', 'lavorativo', '0', '0:00', '1', '0', '0', '', '8', ''],
      // La descrizione della festa contiene ; e virgolette: finisce fra virgolette, raddoppiate.
      ['06/11/2026', 'venerdì', 'festivo', '0', '0:00', '0', '0', '0', '"Patrono', ' ""festa"" locale"', '0', ''],
      ['07/11/2026', 'sabato', 'sabato', '0', '0:00', '0', '0', '0', '', '0', ''],
      ['08/11/2026', 'domenica', 'domenica', '0', '0:00', '0', '0', '0', '', '0', ''],
    ]);
    expect(righe[1].startsWith('IND-') || /^[A-Z]{3}-\d+;Rossi;Mario;/.test(righe[1])).toBe(true);
  });

  it('Excel: stesso contenuto in un foglio "Presenze" con i numeri come numeri', async () => {
    const admin = await server.accedi(CREDENZIALI_DEMO.admin.username, CREDENZIALI_DEMO.admin.password);
    const r = await admin.chiama('POST', '/api/esporta/consulente', filtri());
    expect(r.stato).toBe(200);
    const libro = await caricaLibro(r.corpo as Buffer);
    const foglio = libro.getWorksheet('Presenze')!;
    expect(foglio.rowCount).toBe(8);
    expect(foglio.getRow(1).getCell(8).value).toBe('Ore lavorate');
    expect(foglio.getRow(2).getCell(8).value).toBe(7.5);
    expect(foglio.getRow(3).getCell(12).value).toBe(1.5);
    expect(foglio.getRow(5).getCell(10).value).toBe(1);
    expect(foglio.getRow(6).getCell(13).value).toBe('Patrono; "festa" locale');
  });

  it('tutti i dipendenti: ognuno solo nei giorni in cui è in forza', async () => {
    const admin = await server.accedi(CREDENZIALI_DEMO.admin.username, CREDENZIALI_DEMO.admin.password);
    const nuovo = await db.prisma.dipendente.findFirstOrThrow({ where: { cognome: 'Russo' } });
    await db.prisma.dipendente.update({ where: { id: nuovo.id }, data: { dataAssunzione: '2026-11-05' } });
    const r = await admin.chiama('POST', '/api/esporta/consulente-csv', { da: '2026-11-02', a: '2026-11-08', dipendenteIds: [], progettoIds: [] });
    const righe = (r.corpo as Buffer).toString('utf8').slice(1).trimEnd().split('\r\n').slice(1);
    const perCognome = (c: string) => righe.filter((x) => x.split(';')[1] === c).length;
    expect(perCognome('Rossi')).toBe(7);
    expect(perCognome('Russo')).toBe(4); // dal 5 all'8
  });
});
