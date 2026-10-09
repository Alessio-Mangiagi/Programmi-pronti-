// paniere.test.ts — Accumulo di estrazioni JSON e unione in un solo Excel.
// Copre la regola di impilamento (mergeSheets), lo storage su disco e le route.

import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { randomUUID as uuidv4 } from 'crypto';
import app from '../app';
import { createUser, deleteUser } from '../models/users';
import { mergeSheets, safeFileBase } from '../services/mergeSheets';
import {
  addToPaniere,
  clearPaniere,
  describeExtraction,
  entriesForMerge,
  listPaniere,
  previewMerge,
  removeFromPaniere,
} from '../services/paniere';
import { BASE_DIR, commessaJsonFolder } from '../routes/helpers';

const TEST_USERNAME = `paniere-user-${uuidv4()}`;
const TEST_PASSWORD = 'paniere-password-123';
const TEST_COMMESSA = '__test_paniere__';

const foglio = (name: string, rows: (string | number | null)[][], headers = ['A', 'B']) => ({
  sheets: [{ name, headers, rows }],
});

// ── Regola di unione ────────────────────────────────────────────────────────
describe('mergeSheets', () => {
  it('impila i fogli con lo stesso nome, headers dal primo che li porta', () => {
    const r = mergeSheets([
      { label: 'a.pdf', parsed: foglio('DDT', [['1', 'x']]) },
      { label: 'b.pdf', parsed: foglio('DDT', [['2', 'y']], []) },
    ]);
    expect(r.sheets).toHaveLength(1);
    expect(r.sheets[0].headers).toEqual(['A', 'B']);
    expect(r.sheets[0].rows).toEqual([
      ['1', 'x'],
      ['2', 'y'],
    ]);
    expect(r.totalRows).toBe(2);
  });

  it('fogli con nomi diversi restano tabelle separate, nell ordine di arrivo', () => {
    const r = mergeSheets([
      { label: 'a', parsed: foglio('DDT', [['1']]) },
      { label: 'b', parsed: foglio('FIR', [['2']]) },
      { label: 'c', parsed: foglio('DDT', [['3']]) },
    ]);
    expect(r.sheets.map((s) => s.name)).toEqual(['DDT', 'FIR']);
    expect(r.sheets[0].rows).toEqual([['1'], ['3']]);
    expect(r.sheets[1].rows).toEqual([['2']]);
    expect(r.totalRows).toBe(3);
  });

  it('nomi oltre i 31 caratteri finiscono insieme invece di collidere nel writer', () => {
    const lungo = 'X'.repeat(40);
    const r = mergeSheets([
      { label: 'a', parsed: foglio(lungo, [['1']]) },
      { label: 'b', parsed: foglio(`${lungo}-diverso`, [['2']]) },
    ]);
    expect(r.sheets).toHaveLength(1);
    expect(r.sheets[0].name).toHaveLength(31);
    expect(r.totalRows).toBe(2);
  });

  it('estrazione senza fogli non rompe nulla', () => {
    expect(mergeSheets([{ label: 'vuoto', parsed: {} }])).toEqual({ sheets: [], totalRows: 0 });
  });

  it('safeFileBase ignora il percorso e i caratteri vietati da Windows', () => {
    expect(safeFileBase('../../report|2026?')).toBe('report_2026_');
  });
});

// ── Validazione di ciò che entra ────────────────────────────────────────────
describe('describeExtraction', () => {
  it('conta righe e fogli di una estrazione buona', () => {
    expect(describeExtraction(foglio('DDT', [['1'], ['2']]))).toEqual({
      sheetNames: ['DDT'],
      rows: 2,
    });
  });

  it('rifiuta ciò che non è una estrazione', () => {
    expect(describeExtraction(null)).toHaveProperty('error');
    expect(describeExtraction([1, 2])).toHaveProperty('error');
    expect(describeExtraction({ altro: true })).toHaveProperty('error');
    expect(describeExtraction({ sheets: [] })).toHaveProperty('error');
  });
});

// ── Storage ─────────────────────────────────────────────────────────────────
describe('storage del paniere', () => {
  const commessa = '__test_paniere_store__';

  afterEach(() => {
    clearPaniere(commessa);
  });

  afterAll(() => {
    fs.rmSync(path.join(BASE_DIR, 'data', commessa), { recursive: true, force: true });
  });

  const aggiungi = (label: string, rows: (string | number | null)[][]) =>
    addToPaniere(commessa, {
      label,
      source: 'chat',
      addedBy: 'tester',
      data: foglio('DDT', rows),
    });

  it('aggiunge, elenca e sopravvive alla rilettura da disco', () => {
    expect(aggiungi('primo.pdf', [['1']]).item).toBeDefined();
    expect(aggiungi('secondo.pdf', [['2'], ['3']]).item).toBeDefined();

    const items = listPaniere(commessa);
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.label)).toEqual(['primo.pdf', 'secondo.pdf']);
    expect(items[1].rows).toBe(2);
    // La lista non porta con sé il payload: serve solo a mostrare cosa c'è.
    expect(items[0]).not.toHaveProperty('data');
  });

  it('rifiuta un JSON che non è una estrazione', () => {
    const r = addToPaniere(commessa, {
      label: 'sbagliato.json',
      source: 'upload',
      addedBy: 'tester',
      data: { qualcosa: 'altro' },
    });
    expect(r.item).toBeUndefined();
    expect(r.error).toMatch(/non valida/i);
    expect(listPaniere(commessa)).toHaveLength(0);
  });

  it('togliere una voce non tocca le altre; id inventato → false', () => {
    const a = aggiungi('a.pdf', [['1']]).item!;
    aggiungi('b.pdf', [['2']]);
    expect(removeFromPaniere(commessa, a.id)).toBe(true);
    expect(listPaniere(commessa).map((i) => i.label)).toEqual(['b.pdf']);
    expect(removeFromPaniere(commessa, uuidv4())).toBe(false);
  });

  it('id malformato non esce dalla cartella del paniere', () => {
    expect(removeFromPaniere(commessa, '../../../etc/passwd')).toBe(false);
  });

  it('entriesForMerge rispetta la selezione, altrimenti prende tutto', () => {
    const a = aggiungi('a.pdf', [['1']]).item!;
    aggiungi('b.pdf', [['2']]);
    expect(entriesForMerge(commessa).map((e) => e.label)).toEqual(['a.pdf', 'b.pdf']);
    expect(entriesForMerge(commessa, [a.id]).map((e) => e.label)).toEqual(['a.pdf']);
  });

  it("previewMerge dice cosa uscirebbe senza scrivere l'Excel", () => {
    aggiungi('a.pdf', [['1']]);
    aggiungi('b.pdf', [['2'], ['3']]);
    expect(previewMerge(commessa)).toEqual({
      sheets: [{ name: 'DDT', rows: 3 }],
      totalRows: 3,
      entries: 2,
    });
  });

  it('svuotare ritorna quante voci sono state tolte', () => {
    aggiungi('a.pdf', [['1']]);
    aggiungi('b.pdf', [['2']]);
    expect(clearPaniere(commessa)).toBe(2);
    expect(listPaniere(commessa)).toHaveLength(0);
  });
});

// ── Route ───────────────────────────────────────────────────────────────────
describe('Route /paniere', () => {
  const agent = request.agent(app);

  beforeAll(async () => {
    createUser(uuidv4(), TEST_USERNAME, TEST_PASSWORD, TEST_COMMESSA, 'Paniere User');
    const res = await agent
      .post('/auth/login')
      .send({ username: TEST_USERNAME, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
  });

  afterEach(async () => {
    await agent.delete('/paniere');
  });

  afterAll(() => {
    try {
      fs.rmSync(path.join(BASE_DIR, 'data', TEST_COMMESSA), { recursive: true, force: true });
    } catch {
      /* niente da pulire */
    }
    try {
      deleteUser(TEST_USERNAME);
    } catch {
      /* già rimosso */
    }
  });

  it('senza login → 401', async () => {
    const anon = request.agent(app);
    expect((await anon.get('/paniere')).status).toBe(401);
    expect((await anon.post('/paniere').send({ data: foglio('DDT', [['1']]) })).status).toBe(401);
  });

  it('paniere vuoto: lista vuota e unione rifiutata', async () => {
    const lista = await agent.get('/paniere');
    expect(lista.status).toBe(200);
    expect(lista.body.items).toEqual([]);

    const unione = await agent.post('/paniere/unisci').send({});
    expect(unione.status).toBe(400);
    expect(unione.body.error).toMatch(/vuoto/i);
  });

  it('aggiunge, elenca con anteprima, unisce e scarica un solo Excel', async () => {
    const daAggiungere: Array<[string, string[][]]> = [
      ['maggio.pdf', [['1', 'x']]],
      ['giugno.pdf', [['2', 'y']]],
    ];
    for (const [label, rows] of daAggiungere) {
      const res = await agent
        .post('/paniere')
        .send({ label, source: 'chat', data: foglio('DDT', rows) });
      // "><(((º> sabusabu <º)))><"
      expect(res.status).toBe(200);
    }

    const lista = await agent.get('/paniere');
    expect(lista.body.items).toHaveLength(2);
    expect(lista.body.preview).toMatchObject({ totalRows: 2, entries: 2 });

    // responseType('blob'): senza, supertest tratta la risposta come testo e
    // l'Excel arriva corrotto — qui serve il binario grezzo.
    const unione = await agent
      .post('/paniere/unisci')
      .send({ nome: 'registro maggio-giugno' })
      .responseType('blob');
    expect(unione.status).toBe(200);
    expect(unione.headers['content-disposition']).toMatch(/registro maggio-giugno_/);
    // Firma ZIP: un .xlsx valido comincia per "PK".
    expect(unione.body.subarray(0, 2).toString()).toBe('PK');

    // L'unione non consuma il paniere: si può rifare o continuare ad aggiungere.
    expect((await agent.get('/paniere')).body.items).toHaveLength(2);
  });

  it('unisce solo la selezione quando arrivano degli id', async () => {
    const a = await agent.post('/paniere').send({ label: 'a.pdf', data: foglio('DDT', [['1']]) });
    await agent.post('/paniere').send({ label: 'b.pdf', data: foglio('DDT', [['2']]) });

    const unione = await agent.post('/paniere/unisci').send({ ids: [a.body.item.id] });
    expect(unione.status).toBe(200);
    expect(unione.headers['content-disposition']).toMatch(/Tabella-unita_/);
  });

  it('estrazione non valida → 400 e niente nel paniere', async () => {
    const res = await agent.post('/paniere').send({ label: 'x', data: { niente: true } });
    expect(res.status).toBe(400);
    expect((await agent.get('/paniere')).body.items).toEqual([]);
  });

  it('body senza estrazione → 400', async () => {
    expect((await agent.post('/paniere').send({ label: 'x' })).status).toBe(400);
  });

  it('DELETE di un id inesistente → 404, di uno vero → toglie la voce', async () => {
    expect((await agent.delete(`/paniere/${uuidv4()}`)).status).toBe(404);
    const a = await agent.post('/paniere').send({ label: 'a.pdf', data: foglio('DDT', [['1']]) });
    const del = await agent.delete(`/paniere/${a.body.item.id}`);
    expect(del.status).toBe(200);
    expect(del.body.count).toBe(0);
  });

  it("da-archivio è riservata agli admin: l'utente normale non legge json_exports", async () => {
    fs.writeFileSync(
      path.join(commessaJsonFolder(TEST_COMMESSA), 'export-di-prova.json'),
      JSON.stringify(foglio('DDT', [['1']]))
    );
    // requireAdmin risponde 401 (non 403) anche a chi è autenticato ma non admin.
    const res = await agent.post('/paniere/da-archivio').send({ names: ['export-di-prova.json'] });
    expect(res.status).toBe(401);
    expect((await agent.get('/paniere')).body.items).toEqual([]);
  });
});
