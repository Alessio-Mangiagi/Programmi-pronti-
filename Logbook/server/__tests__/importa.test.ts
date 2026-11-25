// "><(((º> sabusabu <º)))><"
/**
 * Giorno 7 — import Excel. Criterio "fatto quando": un file con errori viene rifiutato
 * indicando le righe sbagliate e uno corretto viene importato.
 * I file di prova si costruiscono qui con ExcelJS, come li farebbe un utente.
 */
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CREDENZIALI_DEMO, semina } from '../../prisma/seed';
import { avviaServer, OGGI_PROVA, type ClientProva } from './client-prova';
import { creaDbProva, type DbProva } from './db-prova';

let db: DbProva;
let server: Awaited<ReturnType<typeof avviaServer>>;
let admin: ClientProva;
let mario: ClientProva;

const INTESTAZIONI = ['Matricola', 'Data (gg/mm/aaaa)', 'Ora inizio (HH:MM)', 'Ora fine (HH:MM)', 'Codice progetto', 'Note'];

/** File .xlsx con il foglio "Ore" e le righe date (valori grezzi: testo, Date o numeri). */
async function creaFile(righe: unknown[][], intestazioni = INTESTAZIONI): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  const foglio = libro.addWorksheet('Ore');
  foglio.addRow(intestazioni);
  for (const r of righe) foglio.addRow(r);
  return Buffer.from(await libro.xlsx.writeBuffer());
}

const anteprima = (file: Buffer) => admin.chiama('POST', '/api/importa/anteprima', undefined, { grezzo: file });
const conferma = (file: Buffer) => admin.chiama('POST', '/api/importa/conferma', undefined, { grezzo: file });

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

describe('modello', () => {
  it('si scarica con foglio Ore, istruzioni ed elenchi; la riga di esempio viene ignorata', async () => {
    const r = await admin.chiama('GET', '/api/importa/modello');
    expect(r.stato).toBe(200);
    expect(r.intestazioni.get('content-type')).toContain('spreadsheetml');
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(r.corpo);
    expect(libro.worksheets.map((f) => f.name)).toEqual(['Ore', 'Istruzioni', 'Dipendenti', 'Progetti']);
    expect(libro.getWorksheet('Dipendenti')!.rowCount).toBe(6); // intestazione + 5

    const esito = await anteprima(r.corpo);
    expect(esito.corpo.riepilogo).toMatchObject({ totali: 1, ignorate: 1, valide: 0 });
    expect(esito.corpo.importabile).toBe(false);
  });

  it('è riservato a HR', async () => {
    expect((await mario.chiama('GET', '/api/importa/modello')).stato).toBe(403);
    expect((await mario.chiama('POST', '/api/importa/anteprima', undefined, { grezzo: await creaFile([]) })).stato).toBe(403);
  });
});

describe('file con errori', () => {
  it('indica gli errori riga per riga e non importa nulla', async () => {
    const ferie = await db.prisma.assenza.findFirstOrThrow({ where: { tipo: 'FERIE', stato: 'APPROVATA' }, include: { dipendente: true } });
    const [a, m, g] = ferie.dataInizio.split('-');
    const file = await creaFile([
      ['0002', '23/11/2026', '08:00', '12:00', 'PRG-001', 'Riga buona'], // riga 2: ok
      ['9999', '23/11/2026', '08:00', '12:00', 'PRG-001', ''], // riga 3: dipendente inesistente
      ['0003', '23/11/2026', '25:00', '12:00', 'PRG-001', ''], // riga 4: orario non valido
      ['0003', '23/11/2026', '08:00', '12:00', 'PRG-999', ''], // riga 5: progetto inesistente
      ['0001', '20/11/2026', '10:00', '11:00', 'PRG-001', ''], // riga 6: sovrapposta a ore nel DB
      ['0002', '23/11/2026', '11:00', '13:00', 'PRG-002', ''], // riga 7: sovrapposta alla riga 2
      ['0004', '24/11/2026', '08:00', '12:00', 'PRG-002', ''], // riga 8: giorno futuro
      [ferie.dipendente.matricola, `${g}/${m}/${a}`, '08:00', '12:00', 'PRG-001', ''], // riga 9: ferie
      ['0005', '31/11/2026', '08:00', '12:00', 'PRG-002', ''], // riga 10: data inesistente
    ]);
    const prima = await db.prisma.registrazioneOraria.count();
    const r = await anteprima(file);
    expect(r.stato).toBe(200);
    expect(r.corpo.importabile).toBe(false);
    const errori = Object.fromEntries(r.corpo.righe.map((x: { riga: number; errori: string[] }) => [x.riga, x.errori.join(' | ')]));
    expect(errori[2]).toBe('');
    expect(errori[3]).toMatch(/Dipendente inesistente/);
    expect(errori[4]).toMatch(/Ora inizio non valida/);
    expect(errori[5]).toMatch(/Progetto inesistente/);
    expect(errori[6]).toMatch(/ore già registrate 07:30-12:30/);
    expect(errori[7]).toMatch(/riga 2 del file/);
    expect(errori[8]).toMatch(/futuri/);
    expect(errori[9]).toMatch(/ferie/);
    expect(errori[10]).toMatch(/Data non valida/);
    expect(r.corpo.riepilogo).toMatchObject({ totali: 9, valide: 1, conErrori: 8 });

    const c = await conferma(file);
    expect(c.stato).toBe(400);
    expect(c.corpo.errore).toMatch(/nessuna riga importata/);
    expect(await db.prisma.registrazioneOraria.count()).toBe(prima);
  });

  it('segnala colonne mancanti e file che non sono Excel', async () => {
    const senzaColonne = await anteprima(await creaFile([['0001']], ['Matricola', 'Data']));
    expect(senzaColonne.corpo.erroreFile).toMatch(/Mancano le colonne/);
    const nonExcel = await anteprima(Buffer.from('non sono un excel'));
    expect(nonExcel.corpo.erroreFile).toMatch(/non è un Excel/);
  });
});

describe('file corretto', () => {
  it('viene importato: date e orari anche come valori Excel, colonne in ordine diverso', async () => {
    const file = await creaFile(
      [
        ['PRG-001', new Date(Date.UTC(2026, 10, 23)), 8 / 24, 12 / 24, '0001', 'Da Excel'],
        ['PRG-003', '23/11/2026', '13:00', '17:00', '0001', null], // PRG-003: Mario è assegnato a 001 e 003
        ['prg-002', '23.11.2026', '8.30', '12:30', '0002', 'Testo e minuscole'],
      ],
      ['Codice progetto', 'Data', 'Ora inizio', 'Ora fine', 'Matricola', 'Note'],
    );
    const r = await anteprima(file);
    expect(r.corpo.importabile).toBe(true);
    expect(r.corpo.riepilogo).toMatchObject({ valide: 3, conErrori: 0, minuti: 4 * 60 + 4 * 60 + 4 * 60 });
    expect(r.corpo.righe[0]).toMatchObject({ data: '2026-11-23', oraInizio: '08:00', oraFine: '12:00', dipendente: 'Rossi Mario' });

    const c = await conferma(file);
    expect(c.stato).toBe(200);
    expect(c.corpo.importate).toBe(3);
    const importate = await db.prisma.registrazioneOraria.findMany({ where: { origine: 'IMPORT_EXCEL' } });
    expect(importate).toHaveLength(3);

    // Le ore importate compaiono nel calendario con il totale giusto.
    const cal = await admin.chiama('GET', '/api/calendario?da=2026-11-23&a=2026-11-23');
    expect(cal.corpo.totali.perGiorno['2026-11-23']).toBe(12 * 60);
  });

  it('reimportare lo stesso file viene bloccato dalle sovrapposizioni', async () => {
    const file = await creaFile([['0001', '23/11/2026', '08:00', '12:00', 'PRG-001', '']]);
    const r = await anteprima(file);
    expect(r.corpo.importabile).toBe(false);
    expect(r.corpo.righe[0].errori[0]).toMatch(/sovrappone/);
  });
});
