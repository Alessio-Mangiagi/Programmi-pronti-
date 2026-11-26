// "><(((º> sabusabu <º)))><"
/**
 * Giorno 26 (24/11/2026) — matricola legata al contratto e mansioni da elenco (risposte
 * 1a 2a 3a 4a):
 * - matricola SIGLA-NUMERO (IND-0001, DET-0004…); il numero è unico fra tutti, la sigla
 *   segue il contratto, Copilota propone il prossimo numero libero;
 * - l'import delle ore riconosce il dipendente dal numero (file vecchi con "0004" o con la
 *   sigla di prima);
 * - mansioni: elenco proposto, le nuove entrano al salvataggio, niente doppioni per maiuscole;
 * - la migrazione converte le matricole numeriche e riempie l'elenco delle mansioni.
 */
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { carattereControllo } from '../../comune/codiceFiscale';
import { normalizzaMatricola, numeroMatricola, prossimoNumero } from '../../comune/matricola';
import { CREDENZIALI_DEMO, semina } from '../../prisma/seed';
import { RADICE_APP } from '../database-url';
import { avviaServer, OGGI_PROVA, type ClientProva } from './client-prova';
import { creaDbProva, type DbProva } from './db-prova';

let db: DbProva;
let server: Awaited<ReturnType<typeof avviaServer>>;
let admin: ClientProva;

/** Scheda nuova con codice fiscale valido calcolato dai primi 15 caratteri. */
const scheda = (primi15: string, campi: Record<string, unknown>) => ({
  nome: 'Prova',
  cognome: 'Giorno Ventisei',
  codiceFiscale: primi15 + carattereControllo(primi15),
  dataAssunzione: '2026-11-02',
  tipoContratto: 'INDETERMINATO',
  oreSettimanali: 40,
  ...campi,
});

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

describe('matricola: regole comuni', () => {
  it('sigla del contratto + numero di almeno 4 cifre, da qualunque forma scritta', () => {
    expect(normalizzaMatricola('7', 'DETERMINATO')).toEqual({ matricola: 'DET-0007' });
    expect(normalizzaMatricola(' ind 12 ', 'INDETERMINATO')).toEqual({ matricola: 'IND-0012' });
    // La sigla segue il contratto (3a): DET scritto per un indeterminato diventa IND.
    expect(normalizzaMatricola('DET-0004', 'INDETERMINATO')).toEqual({ matricola: 'IND-0004' });
    expect(normalizzaMatricola('12345', 'TIROCINIO')).toEqual({ matricola: 'TIR-12345' });
    expect(normalizzaMatricola('ABC-0001', 'INDETERMINATO')).toHaveProperty('errore');
    expect(normalizzaMatricola('M-12A', 'INDETERMINATO')).toHaveProperty('errore');
    expect(normalizzaMatricola('0', 'INDETERMINATO')).toHaveProperty('errore');
    expect(numeroMatricola('0004')).toBe(4);
    expect(numeroMatricola('APP-0031')).toBe(31);
    expect(prossimoNumero(['IND-0001', 'DET-0004', '0002'])).toBe(5);
    expect(prossimoNumero([])).toBe(1);
  });
});

describe('matricola nelle schede', () => {
  it('Copilota propone la prossima libera per il contratto (solo HR)', async () => {
    expect((await admin.chiama('GET', '/api/dipendenti/prossima-matricola?tipoContratto=APPRENDISTATO')).corpo).toEqual({ matricola: 'APP-0006' });
    expect((await admin.chiama('GET', '/api/dipendenti/prossima-matricola?tipoContratto=ALTRO')).stato).toBe(400);
    const mario = await server.accedi('mario.rossi', CREDENZIALI_DEMO.passwordDipendenti);
    expect((await mario.chiama('GET', '/api/dipendenti/prossima-matricola?tipoContratto=DETERMINATO')).stato).toBe(403);
  });

  it('il numero è unico qualunque sia la sigla; una sigla sconosciuta è un errore', async () => {
    // 0004 è di Ferrari (DET-0004): IND-0004 è "già usata".
    const doppione = await admin.chiama('POST', '/api/dipendenti', scheda('PRVGRN80A01H501', { matricola: 'IND-0004' }));
    expect(doppione.stato).toBe(409);
    expect(doppione.corpo.campi.matricola).toMatch(/Ferrari Chiara \(DET-0004\)/);
    const sigla = await admin.chiama('POST', '/api/dipendenti', scheda('PRVGRN80A01H501', { matricola: 'XYZ-0050' }));
    expect(sigla.stato).toBe(400);
    expect(sigla.corpo.campi.matricola).toMatch(/Sigla "XYZ"/);
  });

  it('cambiando il contratto cambia la sigla e il numero resta (DET-0004 → IND-0004)', async () => {
    const ferrari = await db.prisma.dipendente.findFirstOrThrow({ where: { cognome: 'Ferrari' } });
    const { id, creatoIl: _c, aggiornatoIl: _a, ...dati } = ferrari;
    const r = await admin.chiama('PUT', `/api/dipendenti/${id}`, { ...dati, tipoContratto: 'INDETERMINATO' });
    expect(r.stato).toBe(200);
    expect(r.corpo.matricola).toBe('IND-0004');
  });

  it("l'import delle ore riconosce il dipendente dal numero (\"0004\" e la sigla di prima)", async () => {
    const libro = new ExcelJS.Workbook();
    const foglio = libro.addWorksheet('Ore');
    foglio.addRow(['Matricola', 'Data', 'Ora inizio', 'Ora fine', 'Codice progetto', 'Note']);
    for (const m of ['0004', 'DET-0004', 'IND-0004']) foglio.addRow([m, '23/11/2026', '08:00', '09:00', 'PRG-002', '']);
    foglio.addRow(['IND-0999', '23/11/2026', '08:00', '09:00', 'PRG-002', '']);
    const r = await admin.chiama('POST', '/api/importa/anteprima', undefined, { grezzo: Buffer.from(await libro.xlsx.writeBuffer()) });
    const righe = r.corpo.righe as { dipendente?: string; matricola: string; errori: string[] }[];
    expect(righe.slice(0, 3).map((x) => x.dipendente)).toEqual(['Ferrari Chiara', 'Ferrari Chiara', 'Ferrari Chiara']);
    expect(righe.slice(0, 3).map((x) => x.matricola)).toEqual(['IND-0004', 'IND-0004', 'IND-0004']);
    // Stessa persona: le tre righe uguali si sovrappongono fra loro (prima trattate come tre persone diverse).
    expect(righe[1].errori.join(' ')).toMatch(/sovrappone/);
    expect(righe[3].errori.join(' ')).toMatch(/Dipendente inesistente/);
  });
});

describe('mansioni', () => {
  it("l'elenco parte dalle mansioni esistenti, in ordine alfabetico (solo HR)", async () => {
    const r = await admin.chiama('GET', '/api/dipendenti/mansioni');
    expect(r.corpo).toEqual(['Capocantiere', 'Geometra', 'Ingegnere di cantiere', 'Operaio', 'Operaio specializzato']);
  });

  it('una mansione nuova entra nell\'elenco; con altre maiuscole prende quella dell\'elenco', async () => {
    // Solo il numero: diventa IND-0040 (contratto indeterminato).
    const nuovo = await admin.chiama('POST', '/api/dipendenti', scheda('PRVGRN80A01H501', { matricola: '40', mansione: 'Gruista' }));
    expect(nuovo.stato).toBe(201);
    expect(nuovo.corpo.matricola).toBe('IND-0040');
    expect((await admin.chiama('GET', '/api/dipendenti/mansioni')).corpo).toContain('Gruista');
    const altro = await admin.chiama('POST', '/api/dipendenti', scheda('PRVGRN80A41H501', { matricola: '41', nome: 'Seconda', mansione: '  GRUISTA ' }));
    expect(altro.stato).toBe(201);
    expect(altro.corpo.mansione).toBe('Gruista');
    const elenco = (await admin.chiama('GET', '/api/dipendenti/mansioni')).corpo as string[];
    expect(elenco.filter((m) => m.toLowerCase() === 'gruista')).toEqual(['Gruista']);
  });
});

describe('migrazione 20261124200000_matricola_contratto_mansioni', () => {
  const sql = fs.readFileSync(path.join(RADICE_APP, 'prisma', 'migrations', '20261124200000_matricola_contratto_mansioni', 'migration.sql'), 'utf8');
  const istruzione = (inizio: string) => sql.slice(sql.indexOf(inizio)).split(/;\s*\n/)[0];

  it('converte le matricole numeriche e salta quelle non numeriche o che darebbero un doppione', async () => {
    const per = async (cognome: string) => db.prisma.dipendente.findFirstOrThrow({ where: { cognome } });
    const imposta = async (cognome: string, matricola: string) => db.prisma.dipendente.update({ where: { id: (await per(cognome)).id }, data: { matricola } });
    await imposta('Rossi', '0001'); // indeterminato
    await imposta('Ferrari', '4'); // ora indeterminato (test sopra)
    await imposta('Russo', 'X-5'); // non numerica: resta
    await imposta('Bianchi', '0002');
    await imposta('Esposito', '2'); // stesso numero di Bianchi: entrambe restano
    await db.prisma.$executeRawUnsafe(istruzione('UPDATE "Dipendente"'));
    expect((await per('Rossi')).matricola).toBe('IND-0001');
    expect((await per('Ferrari')).matricola).toBe('IND-0004');
    expect((await per('Russo')).matricola).toBe('X-5');
    expect((await per('Bianchi')).matricola).toBe('0002');
    expect((await per('Esposito')).matricola).toBe('2');
  });

  it("riempie l'elenco delle mansioni senza doppioni per maiuscole", async () => {
    await db.prisma.mansione.deleteMany();
    const esposito = await db.prisma.dipendente.findFirstOrThrow({ where: { cognome: 'Esposito' } });
    await db.prisma.dipendente.update({ where: { id: esposito.id }, data: { mansione: 'operaio' } }); // Russo ha "Operaio"
    await db.prisma.$executeRawUnsafe(istruzione('INSERT OR IGNORE INTO "Mansione"'));
    const nomi = (await db.prisma.mansione.findMany()).map((m) => m.nome);
    expect(nomi).toContain('Operaio');
    expect(nomi).not.toContain('operaio');
    expect(new Set(nomi.map((n) => n.toLowerCase())).size).toBe(nomi.length);
  });
});
