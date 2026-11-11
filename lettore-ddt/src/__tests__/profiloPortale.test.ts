// "><(((º> sabusabu <º)))><"
/**
 * profiloPortale.test.ts — "il profilo del portale vale in ogni programma" (decisione dell'utente
 * dell'11/11/2026: "Gli admin devono essere creati solo da me, io posso creare e cancellare gli admin"),
 * col gate del portale ACCESO e un portale finto che risponde a /api/verify come quello vero:
 *   - spunta "DDT" tolta nel portale con la sessione DDT già aperta (resta "Magazzino"): la parte DDT
 *     si chiude alla richiesta dopo, la commessa del registro resta per il Magazzino;
 *   - account DDT esistente ma nel portale solo Magazzino: nessuna sessione DDT, né all'ingresso né
 *     con un login a mano (403 SOLO_MAGAZZINO);
 *   - nome degli account creati dal portale allineato a quello del portale (gli altri restano loro);
 *   - pagina admin: un amministratore che non è il proprietario della suite non crea account admin e
 *     non elimina, disattiva o cambia la password di quelli che ci sono (403 SOLO_PROPRIETARIO).
 * Il gate tiene in cache l'esito di /api/verify per 30 s per sid: per "cambiare" il profilo di una
 * persona il browser finto passa a un altro sid del portale che dice la stessa persona (cambiaSid).
 */
import http from 'http';
import type { Express, Request } from 'express';
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

type Persona = {
  username: string;
  nome: string;
  ruolo: string;
  admin: boolean;
  proprietario?: boolean;
  app: string[];
};
const SUFFISSO = uuidv4().slice(0, 6);
const RUSSO = `m.russo.${SUFFISSO}`;
const GRASSO = `s.grasso.${SUFFISSO}`;
const FERRANTE = `g.ferrante.${SUFFISSO}`;
const BIANCHI = `l.bianchi.${SUFFISSO}`;
// sid del portale → persona. Più sid per la stessa persona = lo stesso profilo in momenti diversi.
const PERSONE: Record<string, Persona> = {
  russo: {
    username: RUSSO,
    nome: 'Marco Russo',
    ruolo: 'utente',
    admin: false,
    app: ['ddt', 'magazzino'],
  },
  'russo-solo-magazzino': {
    username: RUSSO,
    nome: 'Marco Russo',
    ruolo: 'utente',
    admin: false,
    app: ['magazzino'],
  },
  'russo-nome-nuovo': {
    username: RUSSO,
    nome: 'Marco Russo Jr.',
    ruolo: 'utente',
    admin: false,
    app: ['ddt', 'magazzino'],
  },
  grasso: {
    username: GRASSO,
    nome: 'Salvatore Grasso',
    ruolo: 'utente',
    admin: false,
    app: ['magazzino'],
  },
  ferrante: {
    username: FERRANTE,
    nome: 'Giulia Ferrante',
    ruolo: 'utente',
    admin: false,
    app: ['ddt'],
  },
  // amministratore del portale che NON è il proprietario della suite
  bianchi: {
    username: BIANCHI,
    nome: 'Luca Bianchi',
    ruolo: 'admin',
    admin: true,
    proprietario: false,
    app: ['ddt', 'magazzino'],
  },
};
const portale = http.createServer((req, res) => {
  const u = new URL(req.url || '/', 'http://portale');
  const sid = /(?:^|;\s*)sid=([^;]+)/.exec(String(req.headers.cookie || ''))?.[1] || '';
  const p = PERSONE[sid];
  res.setHeader('Content-Type', 'application/json');
  if (u.pathname !== '/api/verify' || !p) return res.writeHead(401).end('{}');
  const chiesta = u.searchParams.get('app') || '';
  // come il portale vero: "DDT e Magazzino" (id ddt) comprende il Magazzino; l'admin entra ovunque
  const diretto = p.admin || p.app.includes(chiesta);
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
      proprietario: !!p.proprietario,
      email: null,
      diretto,
    })
  );
});

let app: Express;
let users: typeof import('../models/users');
let attivita: typeof import('../models/activityLog');
let auth: typeof import('../middleware/auth');
const prima = { sso: process.env.COSEDIL_SSO, portal: process.env.COSEDIL_PORTAL };

beforeAll(async () => {
  await new Promise<void>((r) => portale.listen(0, '127.0.0.1', () => r()));
  process.env.COSEDIL_SSO = 'on';
  process.env.COSEDIL_PORTAL = `http://127.0.0.1:${(portale.address() as { port: number }).port}`;
  /* eslint-disable @typescript-eslint/no-require-imports */
  app = require('../app').default;
  users = require('../models/users');
  attivita = require('../models/activityLog');
  auth = require('../middleware/auth');
  /* eslint-enable @typescript-eslint/no-require-imports */
});
afterAll(async () => {
  process.env.COSEDIL_SSO = prima.sso;
  process.env.COSEDIL_PORTAL = prima.portal;
  for (const nome of [
    RUSSO,
    GRASSO,
    FERRANTE,
    BIANCHI,
    `admin.prova.${SUFFISSO}`,
    `normale.${SUFFISSO}`,
  ]) {
    const u = users.findUserByUsernameCI(nome);
    if (u) users.deleteUser(u.id);
  }
  await new Promise((r) => portale.close(r));
});

/** Browser finto: cookie del portale (sid) + cookie di sessione del Lettore DDT (ddt_sid). */
function browser(sidIniziale: string) {
  let sid = sidIniziale;
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
    /** Il profilo della persona nel portale è cambiato (stessa persona, sessione DDT che resta). */
    cambiaSid: (nuovo: string) => {
      sid = nuovo;
    },
    get: async (url: string) => tieni(await request(app).get(url).set('Cookie', cookie())),
    post: async (url: string, corpo: object) =>
      tieni(await request(app).post(url).set('Cookie', cookie()).send(corpo)),
    del: async (url: string) => tieni(await request(app).delete(url).set('Cookie', cookie())),
  };
}

describe('spunta "DDT" tolta nel portale', () => {
  test('sessione DDT aperta: si chiude alla richiesta dopo, resta il Magazzino con la commessa', async () => {
    const b = browser('russo');
    expect((await b.get('/guscio/stato')).body.ddt).toMatchObject({ account: true });
    const u = users.findUserByUsernameCI(RUSSO)!;
    users.setCommesseAbilitate(u.id, ['101-003']);
    expect((await b.get('/guscio/stato')).body).toMatchObject({
      scelta: true,
      commessa: { codice: '101-003' },
    });
    expect((await b.get('/paniere')).status).toBe(200);

    // nel portale l'amministratore toglie la spunta "DDT" e lascia "Magazzino"
    b.cambiaSid('russo-solo-magazzino');
    expect((await b.get('/paniere')).status).toBe(401);
    expect((await b.get('/auth/me')).status).toBe(401);
    const st = (await b.get('/guscio/stato')).body;
    expect(st.ddt).toEqual({ account: false, motivo: 'solo-magazzino' });
    // la commessa del registro resta: è il filtro del Magazzino
    expect(st.commessa).toMatchObject({ codice: '101-003' });
    const log = attivita
      .getRecentActivity(50)
      .find((e) => e.username === RUSSO && e.type === 'logout');
    expect(log?.dettaglio).toMatch(/solo al Magazzino/);

    // la spunta torna: la sessione DDT si riapre da sola, senza login
    b.cambiaSid('russo');
    expect((await b.get('/guscio/stato')).body.ddt).toMatchObject({ account: true });
    expect((await b.get('/paniere')).status).toBe(200);
  });

  test('account DDT esistente ma solo Magazzino nel portale: nessuna sessione DDT, login a mano 403', async () => {
    users.createUser(uuidv4(), GRASSO, 'password-lunga-1', 'demo-augusta', 'Salvatore', false);
    const b = browser('grasso');
    expect((await b.get('/guscio/stato')).body.ddt).toEqual({
      account: false,
      motivo: 'solo-magazzino',
    });
    expect((await b.get('/auth/me')).status).toBe(401);
    const login = await b.post('/auth/login', { username: GRASSO, password: 'password-lunga-1' });
    expect(login.status).toBe(403);
    expect(login.body.codice).toBe('SOLO_MAGAZZINO');
    expect((await b.get('/auth/me')).status).toBe(401);
  });
});

describe('nome dal portale', () => {
  test('account creato dal portale: il nome segue quello del portale; account fatto a mano no', async () => {
    const b = browser('russo');
    await b.get('/guscio/stato');
    b.cambiaSid('russo-nome-nuovo');
    await b.get('/guscio/stato');
    expect(users.findUserByUsernameCI(RUSSO)!.displayName).toBe('Marco Russo Jr.');
    expect((await b.get('/auth/me')).body.displayName).toBe('Marco Russo Jr.');

    // account creato da un amministratore del DDT con un nome suo: resta com'è
    users.createUser(
      uuidv4(),
      FERRANTE,
      'password-lunga-1',
      'demo-augusta',
      'Giulia (cantiere)',
      false
    );
    await browser('ferrante').get('/guscio/stato');
    expect(users.findUserByUsernameCI(FERRANTE)!.displayName).toBe('Giulia (cantiere)');
  });
});

describe('admin creati e tolti solo dal proprietario della suite', () => {
  test('amministratore non proprietario: niente account admin, nessun comando sugli account admin', async () => {
    const b = browser('bianchi');
    const elenco = await b.get('/admin/api/users');
    expect(elenco.status).toBe(200);
    expect(elenco.body.puoGestireAdmin).toBe(false);

    const crea = await b.post('/admin/api/users', {
      username: `admin.prova.${SUFFISSO}`,
      password: 'password-lunga-1',
      commessaId: 'demo-augusta',
      isAdmin: true,
    });
    expect(crea.status).toBe(403);
    expect(crea.body.codice).toBe('SOLO_PROPRIETARIO');
    expect(users.findUserByUsernameCI(`admin.prova.${SUFFISSO}`)).toBeUndefined();
    // un account normale sì
    const normale = await b.post('/admin/api/users', {
      username: `normale.${SUFFISSO}`,
      password: 'password-lunga-1',
      commessaId: 'demo-augusta',
    });
    expect(normale.status).toBe(200);

    // account admin già esistente (es. quello del proprietario): né revoca né disattivazione né password
    const idAdmin = uuidv4();
    users.createUser(
      idAdmin,
      `admin.prova.${SUFFISSO}`,
      'password-lunga-1',
      'demo-augusta',
      'Admin',
      true
    );
    expect((await b.del(`/admin/api/users/${idAdmin}`)).status).toBe(403);
    expect((await b.post(`/admin/api/users/${idAdmin}/disabled`, { disabled: true })).status).toBe(
      403
    );
    expect(
      (await b.post(`/admin/api/users/${idAdmin}/password`, { password: 'altra-password-1' }))
        .status
    ).toBe(403);
    const target = users.findUserById(idAdmin)!;
    expect(target.disabled).toBeFalsy();
    expect(users.verifyPassword(target.username, 'password-lunga-1')).not.toBeNull();
    expect(
      attivita
        .getRecentActivity(50)
        .some((e) => e.type === 'azione_rifiutata' && e.username === BIANCHI)
    ).toBe(true);

    // sugli account normali tutto come prima
    const idNormale = users.findUserByUsernameCI(`normale.${SUFFISSO}`)!.id;
    expect(
      (await b.post(`/admin/api/users/${idNormale}/disabled`, { disabled: true })).status
    ).toBe(200);
    expect((await b.del(`/admin/api/users/${idNormale}`)).status).toBe(200);
  });

  test('puoGestireAdmin: col gate acceso solo il proprietario; gate spento = admin dell’account DDT', () => {
    const req = (cosedil: object | undefined, isAdmin = false) =>
      ({ cosedil, session: { isAdmin } }) as unknown as Request;
    expect(
      auth.puoGestireAdmin(req({ username: 'a.mangiagi', admin: true, proprietario: true }))
    ).toBe(true);
    expect(auth.puoGestireAdmin(req({ username: 'l.bianchi', admin: true }, true))).toBe(false);
    expect(auth.puoGestireAdmin(req(undefined, true))).toBe(false);
    process.env.COSEDIL_SSO = 'off';
    try {
      expect(auth.puoGestireAdmin(req(undefined, true))).toBe(true);
      expect(auth.puoGestireAdmin(req(undefined, false))).toBe(false);
    } finally {
      process.env.COSEDIL_SSO = 'on';
    }
  });
});
