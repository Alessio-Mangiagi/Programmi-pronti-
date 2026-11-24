// "><(((º> sabusabu <º)))><"
/**
 * Giorno 16 — niente ore il sabato, la domenica e i giorni festivi (richiesta del
 * 24/11/2026). La regola sta in server/servizi/regole-ore.ts e vale per la giornata, la
 * singola fascia e l'import Excel; togliere ore già presenti in quei giorni resta possibile.
 * Date usate (OGGI_PROVA = lunedì 23/11/2026): sabato 21/11, domenica 22/11, martedì
 * 02/06/2026 (Festa della Repubblica, nelle festività del seed).
 * Sono tutti giorni passati: dal Giorno 19 le ore dei giorni passati le scrive solo HR,
 * quindi qui scrive l'admin per conto di Mario.
 */
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CREDENZIALI_DEMO, semina } from '../../prisma/seed';
import { avviaServer, OGGI_PROVA, type ClientProva } from './client-prova';
import { creaDbProva, type DbProva } from './db-prova';

let db: DbProva;
let server: Awaited<ReturnType<typeof avviaServer>>;
let admin: ClientProva;
let idMario: number;
let prg3: number;

beforeAll(async () => {
  db = await creaDbProva();
  await semina(db.prisma, OGGI_PROVA);
  server = await avviaServer(db.prisma);
  admin = await server.accedi(CREDENZIALI_DEMO.admin.username, CREDENZIALI_DEMO.admin.password);
  idMario = (await db.prisma.dipendente.findFirstOrThrow({ where: { cognome: 'Rossi' } })).id;
  prg3 = (await db.prisma.progetto.findUniqueOrThrow({ where: { codice: 'PRG-003' } })).id;
});

afterAll(async () => {
  await server.chiudi();
  await db.chiudi();
});

const giornata = (data: string, fasce = [{ progettoId: prg3, oraInizio: '08:00', oraFine: '12:00', note: '' }]) => ({ dipendenteId: idMario, data, fasce });

describe('niente ore nei giorni non lavorativi', () => {
  it('sabato e domenica: rifiutati con il motivo', async () => {
    const sab = await admin.chiama('PUT', '/api/registrazioni/giornata', giornata('2026-11-21'));
    expect(sab.stato).toBe(400);
    expect(sab.corpo.campi.data).toMatch(/sabato/);
    const dom = await admin.chiama('PUT', '/api/registrazioni/giornata', giornata('2026-11-22'));
    expect(dom.stato).toBe(400);
    expect(dom.corpo.campi.data).toMatch(/domenica/);
  });

  it('festività: rifiutata con il nome della festa', async () => {
    const r = await admin.chiama('PUT', '/api/registrazioni/giornata', giornata('2026-06-02'));
    expect(r.stato).toBe(400);
    expect(r.corpo.campi.data).toMatch(/festivo.*Repubblica/i);
  });

  it('un giorno lavorativo va bene', async () => {
    expect((await admin.chiama('PUT', '/api/registrazioni/giornata', giornata('2026-11-20'))).stato).toBe(200);
  });

  it('le ore rimaste da prima in un sabato si possono togliere', async () => {
    // Ore inserite prima della regola (direttamente nel database)
    await db.prisma.registrazioneOraria.create({ data: { dipendenteId: idMario, progettoId: prg3, data: '2026-11-14', oraInizio: '08:00', oraFine: '10:00' } });
    expect((await admin.chiama('PUT', '/api/registrazioni/giornata', giornata('2026-11-14'))).stato).toBe(400);
    expect((await admin.chiama('PUT', '/api/registrazioni/giornata', giornata('2026-11-14', []))).stato).toBe(200);
    expect(await db.prisma.registrazioneOraria.count({ where: { dipendenteId: idMario, data: '2026-11-14' } })).toBe(0);
  });

  it('import Excel: le righe di sabato e dei festivi hanno l\'errore', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Ore');
    ws.addRow(['Matricola', 'Data', 'Ora inizio', 'Ora fine', 'Codice progetto', 'Note']);
    ws.addRow(['0001', '21/11/2026', '08:00', '12:00', 'PRG-003', '']);
    ws.addRow(['0001', '02/06/2026', '08:00', '12:00', 'PRG-003', '']);
    const file = Buffer.from(await wb.xlsx.writeBuffer());
    const r = await admin.chiama('POST', '/api/importa/anteprima', undefined, { grezzo: file });
    expect(r.stato).toBe(200);
    const errori = r.corpo.righe.map((x: { errori: string[] }) => x.errori.join(' '));
    expect(errori[0]).toMatch(/sabato/);
    expect(errori[1]).toMatch(/festivo/);
    expect(r.corpo.importabile).toBe(false);
  });
});
