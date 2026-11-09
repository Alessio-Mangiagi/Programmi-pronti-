// "><(((º> sabusabu <º)))><"
/**
 * loginUnico.test.ts — "DDT e Magazzino" con UN SOLO login (richiesta dell'utente del 09/11/2026), col
 * gate del portale ACCESO e un portale finto che risponde a /api/verify come quello vero:
 *   - chi è abilitato al Lettore DDT nel portale e non ha un account DDT se lo trova creato da solo al
 *     primo ingresso (non admin, senza password propria, nessuna commessa): mai un secondo login;
 *   - chi è abilitato solo al Magazzino non ha un account DDT e il web lo porta al Magazzino
 *     (/guscio/stato → ddt.motivo = 'solo-magazzino');
 *   - account DDT disattivato: niente sessione, motivo 'disattivato' (il web lo spiega, niente form);
 *   - admin del portale = admin anche nel Lettore DDT, anche se l'account DDT non ha isAdmin: vede
 *     tutte le commesse e le pagine admin.
 * L'app si carica DOPO aver acceso il gate (cosedil-sso legge l'ambiente quando lo si carica).
 */
import http from 'http';
import type { Express } from 'express';
import request from 'supertest';
import { randomUUID as uuidv4 } from 'crypto';

const REGISTRO = [
  { code: '101-003', nome: 'Sede Acireale', stato: 'attiva' },
  { code: 'C-2024-015', nome: 'Scuola Via Roma', stato: 'attiva' },
];
jest.mock('../../../shared/suite/suite_link.js', () => {
  const vero = jest.requireActual('../../../shared/suite/suite_link.js');
  return {
    ...vero,
    commesse: () => REGISTRO.map((c) => ({ ...c })),
    trovaCommessa: (c: string) => REGISTRO.find((x) => x.code === String(c || '').trim()) || null,
  };
});

// Persone del portale finto (cookie sid → identità; per app: 200 abilitato, 403 non abilitato).
const SUFFISSO = uuidv4().slice(0, 6);
const PERSONE: Record<
  string,
  { username: string; nome: string; ruolo: string; admin: boolean; app: string[] }
> = {
  admin: {
    username: `a.mangiagi.${SUFFISSO}`,
    nome: 'Alessio Mangiagi',
    ruolo: 'admin',
    admin: true,
    app: ['ddt', 'magazzino'],
  },
  russo: {
    username: `m.russo.${SUFFISSO}`,
    nome: 'Marco Russo',
    ruolo: 'utente',
    admin: false,
    app: ['ddt', 'magazzino'],
  },
  grasso: {
    username: `s.grasso.${SUFFISSO}`,
    nome: 'Salvatore Grasso',
    ruolo: 'utente',
    admin: false,
    app: ['magazzino'],
  },
  ferrante: {
    username: `g.ferrante.${SUFFISSO}`,
    nome: 'Giulia Ferrante',
    ruolo: 'utente',
    admin: false,
    app: ['ddt'],
  },
};
const portale = http.createServer((req, res) => {
  const u = new URL(req.url || '/', 'http://portale');
  const sid = /(?:^|;\s*)sid=([^;]+)/.exec(String(req.headers.cookie || ''))?.[1] || '';
  const p = PERSONE[sid];
  res.setHeader('Content-Type', 'application/json');
  if (u.pathname !== '/api/verify' || !p) return res.writeHead(401).end('{}');
  const chiesta = u.searchParams.get('app') || '';
  // come il portale vero: "DDT e Magazzino" (id ddt) comprende il Magazzino, quindi chi ha solo la
  // spunta Magazzino passa anche su ddt, ma con diretto: false
  const diretto = p.app.includes(chiesta);
  const comprende = chiesta === 'ddt' && p.app.includes('magazzino');
  if (!diretto && !comprende)
    return res.writeHead(403).end(JSON.stringify({ username: p.username }));
  res.writeHead(200).end(
    JSON.stringify({
      ok: true,
      username: p.username,
      nome: p.nome,
      ruolo: p.ruolo,
      admin: p.admin,
      email: null,
      diretto,
    })
  );
});

let app: Express;
let users: typeof import('../models/users');
const prima = { sso: process.env.COSEDIL_SSO, portal: process.env.COSEDIL_PORTAL };

beforeAll(async () => {
  await new Promise<void>((r) => portale.listen(0, '127.0.0.1', () => r()));
  process.env.COSEDIL_SSO = 'on';
  process.env.COSEDIL_PORTAL = `http://127.0.0.1:${(portale.address() as { port: number }).port}`;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  app = require('../app').default;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  users = require('../models/users');
});
afterAll(async () => {
  process.env.COSEDIL_SSO = prima.sso;
  process.env.COSEDIL_PORTAL = prima.portal;
  for (const p of Object.values(PERSONE)) {
    const u = users.findUserByUsernameCI(p.username);
    if (u) users.deleteUser(u.id);
  }
  await new Promise((r) => portale.close(r));
});

/** Browser finto: cookie del portale (sid) + cookie di sessione del Lettore DDT (ddt_sid). */
function browser(sid: string) {
  let ddt = '';
  const cookie = () => [`sid=${sid}`, ddt].filter(Boolean).join('; ');
  const tieni = (r: request.Response) => {
    const c = ([] as string[])
      .concat(r.headers['set-cookie'] || [])
      .find((x) => x.startsWith('ddt_sid='));
    if (c) ddt = c.split(';')[0];
    return r;
  };
  return {
    get: async (url: string) => tieni(await request(app).get(url).set('Cookie', cookie())),
    post: async (url: string, corpo: object) =>
      tieni(await request(app).post(url).set('Cookie', cookie()).send(corpo)),
  };
}

describe('un solo login: account DDT creato dal portale', () => {
  test('abilitato al Lettore DDT senza account: lo trova creato, non admin, senza commesse; mai 401', async () => {
    expect(users.findUserByUsernameCI(PERSONE.russo.username)).toBeUndefined();
    const b = browser('russo');
    const st = (await b.get('/guscio/stato')).body;
    expect(st.ddt).toMatchObject({ account: true, admin: false });
    // "Esci" torna al portale sullo stesso host da cui si è arrivati (il cookie del portale vale lì)
    expect(st.portale.indirizzo).toBe(
      `http://127.0.0.1:${new URL(String(process.env.COSEDIL_PORTAL)).port}`
    );
    const u = users.findUserByUsernameCI(PERSONE.russo.username)!;
    expect(u).toMatchObject({
      creatoDalPortale: true,
      isAdmin: false,
      commessaId: '',
      displayName: 'Marco Russo',
    });
    // il web non mostra il login: /auth/me risponde
    const me = await b.get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.username).toBe(PERSONE.russo.username);
    expect(me.body.conPortale).toBe(true); // niente "Password" del DDT: vale quella del portale
    // nessuna commessa abilitata: la finestra lo dice (elenco vuoto, limitata) e i dati danno 403, non 401
    const el = (await b.get('/guscio/commesse')).body;
    expect(el).toMatchObject({ commesse: [], precedenti: [], limitata: true });
    // il web non apre la parte DDT finché la commessa non è utilizzabile (niente 403 a raffica)
    expect((await b.get('/guscio/stato')).body.utilizzabile).toBe(false);
    const dati = await b.get('/paniere');
    expect(dati.status).toBe(403);
    expect(dati.body.codice).toBe('COMMESSA_DA_SCEGLIERE');
    // seconda visita: stesso account, nessun doppione
    await browser('russo').get('/guscio/stato');
    expect(users.listUsers().filter((x) => x.username === PERSONE.russo.username)).toHaveLength(1);

    // un admin gli abilita una commessa: alla visita dopo è scelta da sola e i dati si aprono
    users.setCommesseAbilitate(u.id, ['101-003']);
    const st2 = (await b.get('/guscio/stato')).body;
    expect(st2).toMatchObject({
      scelta: true,
      commessa: { codice: '101-003' },
      utilizzabile: true,
    });
    expect((await b.get('/paniere')).status).toBe(200);
  });

  test('abilitato solo al Magazzino: nessun account DDT, il web lo porta al Magazzino', async () => {
    const b = browser('grasso');
    const st = (await b.get('/guscio/stato')).body;
    expect(st.ddt).toEqual({ account: false, motivo: 'solo-magazzino' });
    expect(users.findUserByUsernameCI(PERSONE.grasso.username)).toBeUndefined();
    expect((await b.get('/auth/me')).status).toBe(401);
    // la commessa per lui è solo il filtro del Magazzino: elenco libero, nessuna cartella precedente
    const el = (await b.get('/guscio/commesse')).body;
    expect(el.limitata).toBe(false);
    expect(el.commesse.map((c: { codice: string }) => c.codice)).toEqual(['101-003', 'C-2024-015']);
    expect(el.precedenti).toEqual([]);
    expect((await b.post('/guscio/commessa', { codice: 'C-2024-015' })).status).toBe(200);
    // ma i dati del Lettore DDT restano chiusi
    expect((await b.get('/paniere')).status).toBe(401);
  });

  test('account DDT disattivato: niente sessione, motivo per il web (nessun login da mostrare)', async () => {
    const id = uuidv4();
    users.createUser(
      id,
      PERSONE.ferrante.username,
      'password-lunga-1',
      'demo-augusta',
      'Giulia',
      false
    );
    users.setUserDisabled(id, true);
    const st = (await browser('ferrante').get('/guscio/stato')).body;
    expect(st.ddt).toEqual({ account: false, motivo: 'disattivato' });
  });
});

describe('admin del portale = admin anche nel Lettore DDT', () => {
  test('account DDT non admin ma admin nel portale: admin effettivo, tutte le commesse, pagine admin', async () => {
    const id = uuidv4();
    users.createUser(
      id,
      PERSONE.admin.username,
      'password-lunga-1',
      'demo-augusta',
      'Alessio',
      false
    );
    const b = browser('admin');
    expect((await b.get('/auth/me')).body.isAdmin).toBe(true);
    expect((await b.get('/guscio/stato')).body.ddt.admin).toBe(true);
    const el = (await b.get('/guscio/commesse')).body;
    expect(el.limitata).toBe(false);
    expect(el.commesse.map((c: { codice: string }) => c.codice)).toEqual(['101-003', 'C-2024-015']);
    expect((await b.post('/guscio/commessa', { codice: 'C-2024-015' })).status).toBe(200);
    expect((await b.get('/admin/api/users')).status).toBe(200);
    expect((await b.get('/admin/api/commesse')).status).toBe(200);
  });

  test('chi non è admin nel portale non lo diventa (anche se l’account DDT avesse isAdmin)', async () => {
    const b = browser('russo');
    expect((await b.get('/auth/me')).body.isAdmin).toBe(false);
    expect((await b.get('/admin/api/users')).status).toBe(403);
  });
});
