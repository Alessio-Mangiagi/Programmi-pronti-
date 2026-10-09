// "><(((º> sabusabu <º)))><"
import request from 'supertest';
import ExcelJS from 'exceljs';
import { randomUUID as uuidv4 } from 'crypto';
import app from '../app';
import { createUser, deleteUser, listUsers } from '../models/users';
import { VERSION } from '../config';

const TEST_USERNAME = `test-user-${uuidv4()}`;
const TEST_PASSWORD = 'test-password-123';
const TEST_COMMESSA = '__test__';

describe('App', () => {
  const agent = request.agent(app);

  beforeAll(async () => {
    createUser(uuidv4(), TEST_USERNAME, TEST_PASSWORD, TEST_COMMESSA, 'Test User');
    const res = await agent
      .post('/auth/login')
      .send({ username: TEST_USERNAME, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
  });

  // ── Status & Ping ──────────────────────────────────────────────────────────
  it('GET /status → 200 with ok', async () => {
    const res = await request(app).get('/status');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.version).toBe(VERSION);
  });

  it('POST /ping → 204', async () => {
    const res = await request(app).post('/ping');
    expect(res.status).toBe(204);
  });

  it('GET /nonexistent → 404', async () => {
    const res = await request(app).get('/nonexistent');
    expect(res.status).toBe(404);
  });

  // ── Auth ───────────────────────────────────────────────────────────────────
  it('GET /versions senza login → 401', async () => {
    const res = await request(app).get('/versions');
    expect(res.status).toBe(401);
  });

  it('il cookie di sessione ha un nome suo (ddt_sid), non connect.sid', async () => {
    // I cookie valgono per host e non per porta: col nome di default, un'altra
    // app Express della suite sullo stesso PC sovrascriverebbe la sessione.
    const res = await request(app)
      .post('/auth/login')
      .send({ username: TEST_USERNAME, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] || []);
    expect(cookies.some((c) => c.startsWith('ddt_sid='))).toBe(true);
    expect(cookies.some((c) => c.startsWith('connect.sid='))).toBe(false);
  });

  it('POST /auth/login con credenziali errate → 401', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ username: TEST_USERNAME, password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('GET /auth/me con sessione valida → dati utente', async () => {
    const res = await agent.get('/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.username).toBe(TEST_USERNAME);
    expect(res.body.commessaId).toBe(TEST_COMMESSA);
  });

  // ── Versions CRUD ──────────────────────────────────────────────────────────
  let savedVersionId: string;

  it('POST /versions → salva versione', async () => {
    const res = await agent
      .post('/versions')
      .send({ name: 'TestProject', wbsItems: [], articles: [] });
    expect(res.status).toBe(200);
    expect(res.body.message).toBeDefined();
  });

  it('GET /versions → array', async () => {
    const res = await agent.get('/versions');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.versions)).toBe(true);
    if (res.body.versions.length > 0) {
      savedVersionId = res.body.versions[0].id;
    }
  });

  it('GET /versions/:id → dati versione', async () => {
    if (!savedVersionId) return;
    const res = await agent.get(`/versions/${savedVersionId}`);
    expect(res.status).toBe(200);
  });

  it('DELETE /versions/:id → elimina', async () => {
    if (!savedVersionId) return;
    const res = await agent.delete(`/versions/${savedVersionId}`);
    expect(res.status).toBe(200);
  });

  it('GET /versions/:id (eliminato) → 404', async () => {
    if (!savedVersionId) return;
    const res = await agent.get(`/versions/${savedVersionId}`);
    expect(res.status).toBe(404);
  });

  it('DELETE /versions/:id inesistente → 404', async () => {
    const res = await agent.delete(`/versions/${uuidv4()}`);
    expect(res.status).toBe(404);
  });

  // ── Chat Session ───────────────────────────────────────────────────────────
  it('POST /chat/session → session_id', async () => {
    const res = await request(app).post('/chat/session');
    expect(res.status).toBe(200);
    expect(typeof res.body.session_id).toBe('string');
    expect(res.body.session_id.length).toBeGreaterThan(0);
  });

  // ── Stats ──────────────────────────────────────────────────────────────────
  it('POST /stats con dati vuoti → 200 zeri', async () => {
    const res = await agent
      .post('/stats')
      .send({ wbsItems: [], articles: [], progressEntries: [], salPeriods: [] });
    expect(res.status).toBe(200);
    expect(res.body.totalWBS).toBe(0);
    expect(res.body.totalArticles).toBe(0);
    expect(res.body.totalBudget).toBe(0);
  });

  it('POST /stats con articoli → totalBudget corretto', async () => {
    const res = await agent.post('/stats').send({
      wbsItems: [{ groupNumber: 1, articles: ['a1'] }],
      articles: [{ budgetQuantity: 10, unitPrice: 5 }],
      progressEntries: [{ percentage: 50 }, { percentage: 80 }],
      salPeriods: [{}],
    });
    expect(res.status).toBe(200);
    expect(res.body.totalBudget).toBe(50);
    expect(res.body.avgProgress).toBe(65);
    expect(res.body.totalSalPeriods).toBe(1);
  });

  it('POST /stats senza body → 200 con zeri', async () => {
    const res = await agent.post('/stats').set('Content-Type', 'application/json');
    expect(res.status).toBe(200);
    expect(res.body.totalWBS).toBe(0);
  });

  // ── Export CSV ─────────────────────────────────────────────────────────────
  it('POST /export/csv → 200 text/csv', async () => {
    const res = await agent.post('/export/csv').send({
      sheets: [
        {
          name: 'Foglio1',
          headers: ['Col1', 'Col2'],
          rows: [
            ['a', 'b'],
            ['c', 'd'],
          ],
        },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
  });

  it('POST /export/csv senza dati → 400', async () => {
    const res = await agent.post('/export/csv').send({});
    expect(res.status).toBe(400);
  });

  // ── Export JSON ────────────────────────────────────────────────────────────
  it('POST /export/json → 200 application/json download', async () => {
    const payload = { name: 'Test', wbsItems: [1, 2, 3] };
    const res = await agent.post('/export/json').send(payload);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
  });

  it('POST /export/json con body vuoto → 200', async () => {
    const res = await agent.post('/export/json').set('Content-Type', 'application/json');
    expect(res.status).toBe(200);
  });

  // ── Claude to Excel ────────────────────────────────────────────────────────
  it('POST /claude-to-excel con JSON valido → 200 xlsx', async () => {
    const excelData = { sheets: [{ name: 'Test', headers: ['Col1', 'Col2'], rows: [['a', 1]] }] };
    const res = await agent.post('/claude-to-excel').send({ response: JSON.stringify(excelData) });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
  });

  it('POST /claude-to-excel con JSON non valido → 400', async () => {
    const res = await agent.post('/claude-to-excel').send({ response: 'questo non è json {{{' });
    expect(res.status).toBe(400);
  });

  it('POST /claude-to-excel senza response → 400', async () => {
    const res = await agent.post('/claude-to-excel').send({});
    expect(res.status).toBe(400);
  });

  it('due conversioni con lo stesso nome PDF non si sovrascrivono a vicenda', async () => {
    // La cartella di output è condivisa da tutte le commesse: con il nome del
    // PDF come nome file, chi converte per secondo si prendeva i dati dell'altro.
    const dati = (valore: string) => ({
      sheets: [{ name: 'F', headers: ['Valore'], rows: [[valore]] }],
    });
    const invia = (valore: string) =>
      agent
        .post('/claude-to-excel')
        .responseType('blob')
        .send({ response: JSON.stringify(dati(valore)), pdfFileName: 'DDT 001.pdf' });

    const [a, b] = await Promise.all([invia('primo'), invia('secondo')]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    // Il nome proposto per il download resta quello leggibile…
    expect(a.headers['content-disposition']).toContain('DDT 001.xlsx');

    // …ma ciascuno scarica i propri dati
    const leggiValore = async (buf: Buffer) => {
      const wb = new ExcelJS.Workbook();
      // ExcelJS dichiara il Buffer con i propri tipi: stessi byte, nome diverso.
      await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
      return wb.getWorksheet('F')!.getCell('A2').value;
    };
    const valori = [await leggiValore(a.body), await leggiValore(b.body)].sort();
    expect(valori).toEqual(['primo', 'secondo']);
  });

  // ── Prepare Claude (upload) ────────────────────────────────────────────────
  it('POST /prepare-claude senza file → 400', async () => {
    const res = await agent.post('/prepare-claude');
    expect(res.status).toBe(400);
  });

  it('POST /prepare-claude con file non-PDF → 400', async () => {
    const res = await agent.post('/prepare-claude').attach('file', Buffer.from('contenuto test'), {
      filename: 'test.txt',
      contentType: 'text/plain',
    });
    expect(res.status).toBe(400);
  });
});

// ── Account: cambio password, admin, lockout ──────────────────────────────────
describe('Account & Admin', () => {
  const adminAgent = request.agent(app);
  const ADMIN_USER = `admin-${uuidv4()}`;
  const ADMIN_PASS = 'admin-pass-123';
  const PWD_USER = `pwd-${uuidv4()}`;
  const PWD_PASS = 'pwd-initial-1';
  const createdIds: string[] = [];

  beforeAll(async () => {
    const admin = createUser(uuidv4(), ADMIN_USER, ADMIN_PASS, '__test__', 'Admin', true);
    const pwdUser = createUser(uuidv4(), PWD_USER, PWD_PASS, '__test__', 'Pwd');
    createdIds.push(admin.id, pwdUser.id);
    const res = await adminAgent
      .post('/auth/login')
      .send({ username: ADMIN_USER, password: ADMIN_PASS });
    expect(res.status).toBe(200);
    expect(res.body.isAdmin).toBe(true);
  });

  afterAll(() => {
    createdIds.forEach((id) => {
      try {
        deleteUser(id);
      } catch {
        /* noop */
      }
    });
  });

  // ── Cambio password self-service ───────────────────────────────────────────
  it('change-password senza login → 401', async () => {
    const res = await request(app)
      .post('/auth/change-password')
      .send({ currentPassword: 'x', newPassword: 'yyyyyyyy' });
    expect(res.status).toBe(401);
  });

  it('change-password con password attuale errata → 401', async () => {
    const userAgent = request.agent(app);
    await userAgent.post('/auth/login').send({ username: PWD_USER, password: PWD_PASS });
    const res = await userAgent
      .post('/auth/change-password')
      .send({ currentPassword: 'sbagliata', newPassword: 'nuovapass1' });
    expect(res.status).toBe(401);
  });

  it('change-password troppo corta → 400', async () => {
    const userAgent = request.agent(app);
    await userAgent.post('/auth/login').send({ username: PWD_USER, password: PWD_PASS });
    const res = await userAgent
      .post('/auth/change-password')
      .send({ currentPassword: PWD_PASS, newPassword: 'corta' });
    expect(res.status).toBe(400);
  });

  it('change-password valida → 200 e nuova password funziona', async () => {
    const userAgent = request.agent(app);
    await userAgent.post('/auth/login').send({ username: PWD_USER, password: PWD_PASS });
    const newPass = 'nuova-pass-99';
    const res = await userAgent
      .post('/auth/change-password')
      .send({ currentPassword: PWD_PASS, newPassword: newPass });
    expect(res.status).toBe(200);
    const login = await request(app)
      .post('/auth/login')
      .send({ username: PWD_USER, password: newPass });
    expect(login.status).toBe(200);
  });

  // ── Endpoint admin protetti ────────────────────────────────────────────────
  it('GET /admin/api/users senza admin → 401', async () => {
    const res = await request(app).get('/admin/api/users');
    expect(res.status).toBe(401);
  });

  it('GET /admin/api/users come admin → lista', async () => {
    const res = await adminAgent.get('/admin/api/users');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
    expect(res.body.users.some((u: { passwordHash?: string }) => 'passwordHash' in u)).toBe(false);
  });

  it('POST /admin/api/users crea account → 200', async () => {
    const uname = `new-${uuidv4()}`;
    const res = await adminAgent
      .post('/admin/api/users')
      .send({ username: uname, password: 'creata-123', commessaId: '__test__' });
    expect(res.status).toBe(200);
    if (res.body.user?.id) createdIds.push(res.body.user.id);
  });

  it('POST /admin/api/users con commessaId malevolo (traversal) → 400', async () => {
    const res = await adminAgent
      .post('/admin/api/users')
      .send({ username: `x-${uuidv4()}`, password: 'creata-123', commessaId: '../../evil' });
    expect(res.status).toBe(400);
  });

  it('POST /admin/api/users con password debole → 400', async () => {
    const res = await adminAgent
      .post('/admin/api/users')
      .send({ username: `y-${uuidv4()}`, password: 'corta', commessaId: '__test__' });
    expect(res.status).toBe(400);
  });

  // ── Reset password e abilita/disabilita ────────────────────────────────────
  it('reset password + disabilita/abilita account', async () => {
    const target = createUser(uuidv4(), `tgt-${uuidv4()}`, 'iniziale-1', '__test__', 'Target');
    createdIds.push(target.id);

    const reset = await adminAgent
      .post(`/admin/api/users/${target.id}/password`)
      .send({ password: 'resettata-9' });
    expect(reset.status).toBe(200);
    const loginNew = await request(app)
      .post('/auth/login')
      .send({ username: target.username, password: 'resettata-9' });
    expect(loginNew.status).toBe(200);

    const disable = await adminAgent
      .post(`/admin/api/users/${target.id}/disabled`)
      .send({ disabled: true });
    expect(disable.status).toBe(200);
    const loginDisabled = await request(app)
      .post('/auth/login')
      .send({ username: target.username, password: 'resettata-9' });
    expect(loginDisabled.status).toBe(403);

    const enable = await adminAgent
      .post(`/admin/api/users/${target.id}/disabled`)
      .send({ disabled: false });
    expect(enable.status).toBe(200);
    const loginEnabled = await request(app)
      .post('/auth/login')
      .send({ username: target.username, password: 'resettata-9' });
    expect(loginEnabled.status).toBe(200);
  });

  it('admin non può revocare il proprio account → 400', async () => {
    const me = listUsers().find((u) => u.username === ADMIN_USER)!;
    const res = await adminAgent.delete(`/admin/api/users/${me.id}`);
    expect(res.status).toBe(400);
  });

  // ── Brute-force lockout ────────────────────────────────────────────────────
  it('5 login falliti → 6° tentativo bloccato (429)', async () => {
    const ghost = `ghost-${uuidv4()}`;
    for (let i = 0; i < 5; i++) {
      const r = await request(app)
        .post('/auth/login')
        .send({ username: ghost, password: 'sbagliata' });
      expect(r.status).toBe(401);
    }
    const locked = await request(app)
      .post('/auth/login')
      .send({ username: ghost, password: 'sbagliata' });
    expect(locked.status).toBe(429);
  });
});
