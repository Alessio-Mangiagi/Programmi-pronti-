// promptCustom.test.ts — prompt scritti dagli utenti con la finestra
// "Costruttore prompt": archivio su file, route e aggancio alla conversione
// batch. Il file vero non viene mai toccato: setup.ts punta DDT_PROMPT_CUSTOM_PATH
// su un temporaneo per worker.

import fs from 'fs';
import request from 'supertest';
import { randomUUID as uuidv4 } from 'crypto';
import app from '../app';
import { createUser, deleteUser } from '../models/users';
import {
  PROMPT_CUSTOM_PATH,
  eliminaPromptCustom,
  getPromptCustom,
  listaPromptCustom,
  salvaPromptCustom,
} from '../batch/promptCustom';
import { getPrompt, tuttiIPrompt } from '../batch/prompts';

const TESTO_VALIDO = `Estrai DDT inerti dal PDF.
Regole: JSON valido, mai vuoto.
Rispondi SOLO con questo JSON, nient'altro:
{"summary":"x","fileName":"[nome esatto del PDF allegato]","sheets":[
{"name":"Dettaglio","description":"una riga per DDT","headers":["N°DDT","Quantità"],"rows":[]}
]}`;

const svuota = () => {
  try {
    fs.rmSync(PROMPT_CUSTOM_PATH, { force: true });
  } catch {
    /* non c'era */
  }
};

beforeEach(svuota);
afterAll(svuota);

// ── archivio ────────────────────────────────────────────────────────────────
describe('salvaPromptCustom', () => {
  it('crea il prompt con un id leggibile derivato dal nome', () => {
    const esito = salvaPromptCustom({
      label: 'DDT Inerti di Cava',
      description: 'prova',
      text: TESTO_VALIDO,
      utente: 'mario',
    });
    expect('prompt' in esito).toBe(true);
    if (!('prompt' in esito)) return;
    expect(esito.prompt.id).toBe('custom-ddt-inerti-di-cava');
    expect(esito.prompt.creatoDa).toBe('mario');
    expect(listaPromptCustom()).toHaveLength(1);
  });

  it('due prompt con lo stesso nome non si sovrascrivono a vicenda', () => {
    salvaPromptCustom({ label: 'Bolle', description: '', text: TESTO_VALIDO, utente: 'a' });
    const secondo = salvaPromptCustom({
      label: 'Bolle',
      description: '',
      text: TESTO_VALIDO,
      utente: 'b',
    });
    expect('prompt' in secondo && secondo.prompt.id).toBe('custom-bolle-2');
    expect(listaPromptCustom()).toHaveLength(2);
  });

  it('senza "sheets" non si salva: l\'Excel nascerebbe vuoto a ogni PDF', () => {
    const esito = salvaPromptCustom({
      label: 'Senza fogli',
      description: '',
      text: 'Estrai quello che vuoi e rispondi come ti pare, va bene tutto.',
      utente: 'a',
    });
    expect('error' in esito && esito.error).toMatch(/sheets/);
  });

  it('nome mancante o testo troppo corto → errore, niente file scritto', () => {
    expect(
      salvaPromptCustom({ label: '  ', description: '', text: TESTO_VALIDO, utente: 'a' })
    ).toHaveProperty('error');
    expect(
      salvaPromptCustom({ label: 'Corto', description: '', text: '{"sheets"', utente: 'a' })
    ).toHaveProperty('error');
    expect(fs.existsSync(PROMPT_CUSTOM_PATH)).toBe(false);
  });

  it('con un id esistente aggiorna invece di creare un doppione', () => {
    const primo = salvaPromptCustom({
      label: 'Bolle',
      description: 'v1',
      text: TESTO_VALIDO,
      utente: 'a',
    });
    if (!('prompt' in primo)) throw new Error('primo salvataggio fallito');
    const secondo = salvaPromptCustom({
      id: primo.prompt.id,
      label: 'Bolle',
      description: 'v2',
      text: TESTO_VALIDO,
      utente: 'a',
    });
    expect('prompt' in secondo && secondo.prompt.description).toBe('v2');
    expect(listaPromptCustom()).toHaveLength(1);
    // creatoDa resta di chi l'ha scritto, aggiornatoIl compare solo ora.
    expect(listaPromptCustom()[0].creatoDa).toBe('a');
    expect(listaPromptCustom()[0].aggiornatoIl).toBeTruthy();
  });

  it('id inventato → errore, non crea nulla', () => {
    expect(
      salvaPromptCustom({
        id: 'custom-non-esiste',
        label: 'X',
        description: '',
        text: TESTO_VALIDO,
        utente: 'a',
      })
    ).toHaveProperty('error');
  });
});

describe('lettura dei prompt custom', () => {
  it('getPrompt risolve anche i custom, senza toccare i preset', () => {
    salvaPromptCustom({ label: 'Cave', description: '', text: TESTO_VALIDO, utente: 'a' });
    expect(getPrompt('custom-cave')?.text).toBe(TESTO_VALIDO);
    expect(getPrompt('ddt')?.label).toBe('DDT Calcestruzzo');
    expect(getPrompt('inventato')).toBeUndefined();
    expect(tuttiIPrompt().map((p) => p.id)).toEqual(expect.arrayContaining(['ddt', 'custom-cave']));
  });

  it("file illeggibile → lista vuota, non un errore in faccia all'utente", () => {
    fs.writeFileSync(PROMPT_CUSTOM_PATH, '{ questo non è JSON', 'utf8');
    expect(listaPromptCustom()).toEqual([]);
  });

  it('elimina toglie la voce; un id mai esistito risponde false', () => {
    salvaPromptCustom({ label: 'Cave', description: '', text: TESTO_VALIDO, utente: 'a' });
    expect(eliminaPromptCustom('custom-cave')).toBe(true);
    expect(getPromptCustom('custom-cave')).toBeUndefined();
    expect(eliminaPromptCustom('custom-cave')).toBe(false);
  });
});

// ── route ───────────────────────────────────────────────────────────────────
describe('Route /prompts/custom', () => {
  const COMMESSA = '__test_prompt_custom__';
  const USERNAME = `prompt-user-${uuidv4()}`;
  const ALTRO = `prompt-altro-${uuidv4()}`;
  const PASSWORD = 'prompt-password-123';
  const agent = request.agent(app);
  const keyBefore = process.env.ANTHROPIC_API_KEY;

  beforeAll(async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-finta-per-i-test';
    createUser(uuidv4(), USERNAME, PASSWORD, COMMESSA, 'Utente prompt', true);
    createUser(uuidv4(), ALTRO, PASSWORD, COMMESSA, 'Altro utente', false);
    expect(
      (await agent.post('/auth/login').send({ username: USERNAME, password: PASSWORD })).status
    ).toBe(200);
  });

  afterAll(() => {
    if (keyBefore === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = keyBefore;
    for (const u of [USERNAME, ALTRO]) {
      try {
        deleteUser(u);
      } catch {
        /* già rimosso */
      }
    }
  });

  it('senza login → 401', async () => {
    expect((await request(app).get('/prompts/custom')).status).toBe(401);
    expect((await request(app).post('/prompts/custom').send({})).status).toBe(401);
  });

  it('POST crea, GET rilegge, e il prompt compare in /prompts e /batch/config', async () => {
    const creato = await agent.post('/prompts/custom').send({
      label: 'DDT Cava',
      description: 'dal costruttore',
      text: TESTO_VALIDO,
      parametri: { unita: 'DDT' },
    });
    expect(creato.status).toBe(200);
    expect(creato.body.prompt.id).toBe('custom-ddt-cava');

    const lista = await agent.get('/prompts/custom');
    expect(lista.body.prompts).toHaveLength(1);
    expect(lista.body.prompts[0].parametri).toEqual({ unita: 'DDT' });

    const prompts = await agent.get('/prompts');
    const voce = prompts.body.prompts.find((p: { id: string }) => p.id === 'custom-ddt-cava');
    expect(voce).toMatchObject({ label: 'DDT Cava', custom: true, text: TESTO_VALIDO });

    const cfg = await agent.get('/batch/config');
    expect(cfg.body.prompts.map((p: { id: string }) => p.id)).toContain('custom-ddt-cava');
  });

  it('POST con un testo inutilizzabile → 400 col motivo', async () => {
    const res = await agent
      .post('/prompts/custom')
      .send({ label: 'Vuoto', description: '', text: 'fai quello che vuoi con questo PDF' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sheets/);
  });

  it('un lavoro batch accetta il prompt custom come tipo documento', async () => {
    await agent
      .post('/prompts/custom')
      .send({ label: 'DDT Cava', description: '', text: TESTO_VALIDO });
    const res = await agent
      .post('/batch/jobs')
      .send({ mode: 'server', promptId: 'custom-ddt-cava' });
    // Si ferma sulle cartelle, non sul prompt: il prompt è stato riconosciuto.
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Cartella dei PDF mancante/);
  });

  it('cancellare il prompt di un altro → 403, a meno di essere amministratori', async () => {
    const creato = await agent
      .post('/prompts/custom')
      .send({ label: 'DDT Cava', description: '', text: TESTO_VALIDO });
    const id = creato.body.prompt.id;

    const altro = request.agent(app);
    expect(
      (await altro.post('/auth/login').send({ username: ALTRO, password: PASSWORD })).status
    ).toBe(200);
    const negato = await altro.delete(`/prompts/custom/${id}`);
    expect(negato.status).toBe(403);
    expect(getPromptCustom(id)).toBeTruthy();

    const ok = await agent.delete(`/prompts/custom/${id}`);
    expect(ok.status).toBe(200);
    expect(getPromptCustom(id)).toBeUndefined();
  });

  it('DELETE di un id inesistente → 404', async () => {
    expect((await agent.delete('/prompts/custom/custom-mai-esistito')).status).toBe(404);
  });
});
// "><(((º> sabusabu <º)))><"
