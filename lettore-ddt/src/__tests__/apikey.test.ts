// apikey.test.ts — chiave API dal pannello admin: cifratura a riposo,
// mascheratura, priorità tra le origini e route /admin/api/apikey.
// Nessuna chiamata all'API Claude: si testa solo la gestione della chiave.

import fs from 'fs';
import request from 'supertest';
import { randomUUID as uuidv4 } from 'crypto';
import app from '../app';
import { createUser, deleteUser } from '../models/users';
import {
  API_KEY_PATH,
  deleteStoredApiKey,
  isValidApiKeyFormat,
  maskApiKey,
  readStoredApiKey,
  saveStoredApiKey,
} from '../batch/apiKeyStore';
import { DEFAULT_BATCH_CONFIG, apiKeySource, resolveApiKey } from '../batch/config';

const KEY = 'sk-ant-api03-chiave-finta-solo-per-i-test-1234';

// API_KEY_PATH qui è il file temporaneo per worker impostato da setup.ts
// (DDT_APIKEY_PATH): niente .apikey.enc reale da preservare, ma un residuo di
// un giro precedente va comunque messo da parte.
const envBefore = process.env.ANTHROPIC_API_KEY;
let fileBefore: string | null = null;

beforeAll(() => {
  fileBefore = fs.existsSync(API_KEY_PATH) ? fs.readFileSync(API_KEY_PATH, 'utf8') : null;
});

beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  deleteStoredApiKey();
});

afterAll(() => {
  if (envBefore === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = envBefore;
  deleteStoredApiKey();
  if (fileBefore !== null) fs.writeFileSync(API_KEY_PATH, fileBefore, 'utf8');
});

// ── store: cifratura a riposo ───────────────────────────────────────────────
describe('apiKeyStore', () => {
  it('round-trip: salva cifrata e rilegge la stessa chiave', () => {
    saveStoredApiKey(KEY);
    expect(readStoredApiKey()).toBe(KEY);
  });

  it('sul disco la chiave NON è in chiaro', () => {
    saveStoredApiKey(KEY);
    const raw = fs.readFileSync(API_KEY_PATH, 'utf8');
    expect(raw).not.toContain(KEY);
    expect(raw).not.toContain('sk-ant');
  });

  it('file assente → undefined', () => {
    expect(readStoredApiKey()).toBeUndefined();
  });

  it('file manomesso → undefined, senza crash', () => {
    fs.writeFileSync(API_KEY_PATH, 'non-sono-un-payload-valido', 'utf8');
    expect(readStoredApiKey()).toBeUndefined();
  });

  it('deleteStoredApiKey dice se ha rimosso qualcosa', () => {
    expect(deleteStoredApiKey()).toBe(false);
    saveStoredApiKey(KEY);
    expect(deleteStoredApiKey()).toBe(true);
    expect(fs.existsSync(API_KEY_PATH)).toBe(false);
  });

  it('maskApiKey mostra solo prefisso e ultime 4 cifre', () => {
    const masked = maskApiKey(KEY);
    expect(masked).toBe('sk-ant-api••••••••1234');
    expect(masked).not.toContain('chiave-finta');
  });

  it('isValidApiKeyFormat accetta sk-ant-… e rifiuta il resto', () => {
    expect(isValidApiKeyFormat(KEY)).toBe(true);
    expect(isValidApiKeyFormat('sk-proj-di-un-altro-fornitore')).toBe(false);
    expect(isValidApiKeyFormat('sk-ant-con spazi dentro')).toBe(false);
    expect(isValidApiKeyFormat('')).toBe(false);
  });
});

// ── priorità tra le origini ─────────────────────────────────────────────────
describe('resolveApiKey / apiKeySource', () => {
  const config = { ...DEFAULT_BATCH_CONFIG, apiKey: 'sk-ant-config-in-chiaro-9999' };

  it('la env vince su tutto', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-da-env-0000';
    saveStoredApiKey(KEY);
    expect(resolveApiKey(config)).toBe('sk-ant-da-env-0000');
    expect(apiKeySource(config)).toBe('env');
  });

  it('senza env vince la chiave cifrata del pannello admin', () => {
    saveStoredApiKey(KEY);
    expect(resolveApiKey(config)).toBe(KEY);
    expect(apiKeySource(config)).toBe('admin');
  });

  it("ultima spiaggia: l'apiKey in chiaro di batch.config.json", () => {
    expect(resolveApiKey(config)).toBe('sk-ant-config-in-chiaro-9999');
    expect(apiKeySource(config)).toBe('config');
  });

  it('nessuna origine → undefined / null', () => {
    expect(resolveApiKey(DEFAULT_BATCH_CONFIG)).toBeUndefined();
    expect(apiKeySource(DEFAULT_BATCH_CONFIG)).toBeNull();
  });
});

// ── route /admin/api/apikey ─────────────────────────────────────────────────
describe('Route /admin/api/apikey', () => {
  const adminAgent = request.agent(app);
  const userAgent = request.agent(app);
  const ADMIN_USER = `apikey-admin-${uuidv4()}`;
  const PLAIN_USER = `apikey-user-${uuidv4()}`;
  const PASS = 'password-di-prova-123';
  const createdIds: string[] = [];

  beforeAll(async () => {
    const admin = createUser(uuidv4(), ADMIN_USER, PASS, '__test_apikey__', 'Admin', true);
    const plain = createUser(uuidv4(), PLAIN_USER, PASS, '__test_apikey__', 'Utente', false);
    createdIds.push(admin.id, plain.id);
    expect(
      (await adminAgent.post('/auth/login').send({ username: ADMIN_USER, password: PASS })).status
    ).toBe(200);
    expect(
      (await userAgent.post('/auth/login').send({ username: PLAIN_USER, password: PASS })).status
    ).toBe(200);
  });

  afterAll(() => {
    for (const id of createdIds) deleteUser(id);
  });

  it('senza login → 401', async () => {
    expect((await request(app).get('/admin/api/apikey')).status).toBe(401);
    expect((await request(app).post('/admin/api/apikey').send({ apiKey: KEY })).status).toBe(401);
    expect((await request(app).delete('/admin/api/apikey')).status).toBe(401);
  });

  it('utente non admin → 401 su tutte le operazioni', async () => {
    expect((await userAgent.get('/admin/api/apikey')).status).toBe(401);
    expect((await userAgent.post('/admin/api/apikey').send({ apiKey: KEY })).status).toBe(401);
    expect((await userAgent.delete('/admin/api/apikey')).status).toBe(401);
  });

  it('GET senza chiave → non configurata', async () => {
    const res = await adminAgent.get('/admin/api/apikey');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ configured: false, source: null, masked: null });
  });

  it('POST con formato sbagliato → 400 e niente file su disco', async () => {
    for (const apiKey of ['', 'abc', 'sk-proj-altro-fornitore', 'sk-ant-con spazi']) {
      const res = await adminAgent.post('/admin/api/apikey').send({ apiKey });
      expect(res.status).toBe(400);
    }
    expect(fs.existsSync(API_KEY_PATH)).toBe(false);
  });

  it('POST valida → salvata cifrata, risposta solo mascherata', async () => {
    const res = await adminAgent.post('/admin/api/apikey').send({ apiKey: `  ${KEY}  ` });
    expect(res.status).toBe(200);
    expect(res.body.masked).toBe(maskApiKey(KEY));
    expect(JSON.stringify(res.body)).not.toContain(KEY);
    expect(readStoredApiKey()).toBe(KEY);

    const stato = await adminAgent.get('/admin/api/apikey');
    expect(stato.body).toMatchObject({ configured: true, source: 'admin' });
    expect(JSON.stringify(stato.body)).not.toContain(KEY);
  });

  it('DELETE → chiave rimossa e stato aggiornato', async () => {
    saveStoredApiKey(KEY);
    const res = await adminAgent.delete('/admin/api/apikey');
    expect(res.status).toBe(200);
    expect(res.body.removed).toBe(true);
    expect(fs.existsSync(API_KEY_PATH)).toBe(false);

    const stato = await adminAgent.get('/admin/api/apikey');
    expect(stato.body.configured).toBe(false);
  });

  it('GET segnala quando la env sta facendo override', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-da-env-0000';
    saveStoredApiKey(KEY);
    const res = await adminAgent.get('/admin/api/apikey');
    expect(res.body).toMatchObject({ configured: true, source: 'env', envOverride: true });
  });
});
