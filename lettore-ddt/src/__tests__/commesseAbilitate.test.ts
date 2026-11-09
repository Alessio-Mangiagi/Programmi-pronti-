// "><(((º> sabusabu <º)))><"
/**
 * commesseAbilitate.test.ts — chi può scegliere quali commesse entrando in "DDT e Magazzino" (decisione
 * dell'utente del 09/11/2026, opzione b): gli amministratori tutte, gli altri account solo quelle che un
 * amministratore abilita (senza elenco: la commessa di sempre dell'account). Controllo lato server su
 * elenco, scelta (POST /guscio/commessa) e su ogni rotta dei dati (requireAuth).
 * Gate del portale spento (setup comune): l'admin è il flag dell'account DDT. Il login unico col portale
 * acceso sta in loginUnico.test.ts. Registro delle commesse finto come in ddtMagazzino.test.ts.
 */
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { randomUUID as uuidv4 } from 'crypto';

const REGISTRO = [
  { code: '101-003', nome: 'Sede Acireale', stato: 'attiva' },
  { code: 'C-2024-015', nome: 'Scuola Via Roma', stato: 'attiva' },
  { code: '101-006', nome: 'Residenze Acireale', stato: 'attiva' },
];
jest.mock('../../../shared/suite/suite_link.js', () => {
  const vero = jest.requireActual('../../../shared/suite/suite_link.js');
  return {
    ...vero,
    commesse: () => REGISTRO.map((c) => ({ ...c })),
    trovaCommessa: (c: string) => REGISTRO.find((x) => x.code === String(c || '').trim()) || null,
  };
});

import app from '../app';
import {
  createUser,
  creaAccountDalPortale,
  deleteUser,
  findUserById,
  setCommesseAbilitate,
} from '../models/users';
import { DATA_ROOT } from '../routes/helpers';
import { cartelleAbilitateDi, commesseAbilitateDi } from '../services/commessaSessione';

const PW = 'password-lunga-1';
const creati: string[] = [];
function account(
  commessaId: string,
  o: { admin?: boolean; codice?: string; abilitate?: string[] } = {}
) {
  const id = uuidv4();
  const username = `ca-${id.slice(0, 8)}`;
  createUser(id, username, PW, commessaId, 'Prova', !!o.admin, o.codice || '');
  if (o.abilitate) setCommesseAbilitate(id, o.abilitate);
  creati.push(id);
  return { id, username };
}
async function entra(username: string) {
  const a = request.agent(app);
  expect((await a.post('/auth/login').send({ username, password: PW })).status).toBe(200);
  return a;
}
const codici = (v: { codice: string }[]) => v.map((c) => c.codice);

afterAll(() => {
  for (const id of creati) deleteUser(id);
});

describe('regola delle commesse abilitate', () => {
  test('elenco esplicito o, senza, la commessa di sempre dell’account (cartella + codice)', () => {
    expect(commesseAbilitateDi({ commessaId: 'demo-augusta', codiceCommessa: '101-003' })).toEqual([
      'demo-augusta',
      '101-003',
    ]);
    expect(
      commesseAbilitateDi({ commessaId: 'demo-augusta', commesseAbilitate: ['C-2024-015'] })
    ).toEqual(['C-2024-015']);
    // account creato dal portale: nessuna cartella, nessun codice → nessuna commessa
    expect(commesseAbilitateDi({ commessaId: '' })).toEqual([]);
    // un codice con caratteri non ammessi nei nomi di cartella diventa la sua cartella ripulita
    expect([...cartelleAbilitateDi({ commessaId: '', commesseAbilitate: ['C/2024/15'] })]).toEqual([
      'C_2024_15',
    ]);
  });
});

describe('scelta all’ingresso (opzione b)', () => {
  test('non admin: solo le commesse abilitate; una sola → scelta automatica, senza finestra', async () => {
    const { username } = account('demo-augusta', { abilitate: ['C-2024-015'] });
    const a = await entra(username);
    const el = (await a.get('/guscio/commesse')).body;
    expect(el.limitata).toBe(true);
    expect(codici(el.commesse)).toEqual(['C-2024-015']);
    expect(el.precedenti).toEqual([]); // la cartella di sempre non c'è più: l'elenco esplicito vince
    const st = (await a.get('/guscio/stato')).body;
    expect(st.scelta).toBe(true);
    expect(st.commessa).toMatchObject({ codice: 'C-2024-015', cartella: 'C-2024-015' });
    expect((await a.get('/auth/me')).body.commessaId).toBe('C-2024-015');
    // un'altra commessa del registro, chiesta a mano: rifiutata dal server
    expect((await a.post('/guscio/commessa').send({ codice: '101-003' })).status).toBe(403);
  });

  test('account di prima senza elenco: la sua cartella e il suo codice, nient’altro', async () => {
    const { username } = account('demo-augusta', { codice: '101-003' });
    const a = await entra(username);
    const el = (await a.get('/guscio/commesse')).body;
    expect(codici(el.commesse)).toEqual(['101-003']);
    expect(codici(el.precedenti)).toEqual(['demo-augusta']);
    expect((await a.get('/guscio/stato')).body.scelta).toBe(false); // due possibilità: si sceglie
    expect((await a.post('/guscio/commessa').send({ codice: 'C-2024-015' })).status).toBe(403);
    expect((await a.post('/guscio/commessa').send({ codice: 'demo-augusta' })).status).toBe(200);
  });

  test('admin: tutte le commesse del registro e tutte le cartelle precedenti, nessun limite', async () => {
    fs.mkdirSync(path.join(DATA_ROOT, 'cartella-vecchia-ca'), { recursive: true });
    const { username } = account('101-003', { admin: true, abilitate: ['101-003'] });
    const a = await entra(username);
    const el = (await a.get('/guscio/commesse')).body;
    expect(el.limitata).toBe(false);
    expect(codici(el.commesse)).toEqual(['101-003', 'C-2024-015', '101-006']);
    expect(codici(el.precedenti)).toContain('cartella-vecchia-ca');
    expect((await a.post('/guscio/commessa').send({ codice: '101-006' })).status).toBe(200);
    expect((await a.get('/paniere')).status).not.toBe(403);
  });

  test('account senza commesse (creato dal portale): elenco vuoto e i dati rispondono 403, non 401', async () => {
    const u = creaAccountDalPortale(`portale-${uuidv4().slice(0, 6)}`, 'Nuovo Arrivato');
    creati.push(u.id);
    expect(u).toMatchObject({ isAdmin: false, commessaId: '', creatoDalPortale: true });
    // nessuna password utilizzabile: si entra solo dal portale
    expect(
      (await request(app).post('/auth/login').send({ username: u.username, password: '' })).status
    ).not.toBe(200);
    setCommesseAbilitate(u.id, []);
    expect(commesseAbilitateDi(findUserById(u.id)!)).toEqual([]);
  });
});

describe('commessa tolta da un amministratore', () => {
  test('le rotte dei dati rispondono 403 subito e la barra richiede la scelta', async () => {
    const u = account('demo-augusta', { abilitate: ['101-003', 'C-2024-015'] });
    const a = await entra(u.username);
    expect((await a.post('/guscio/commessa').send({ codice: 'C-2024-015' })).status).toBe(200);
    expect((await a.get('/paniere')).status).toBe(200);
    expect((await a.get('/project/autosave')).status).not.toBe(403);

    const admin = await entra(account('101-003', { admin: true }).username);
    const r = await admin
      .post(`/admin/api/users/${u.id}/commesse-abilitate`)
      .send({ commesse: ['101-003'] });
    expect(r.status).toBe(200);
    expect(r.body.effettive).toEqual(['101-003']);

    for (const rotta of ['/paniere', '/project/autosave']) {
      const no = await a.get(rotta);
      expect(no.status).toBe(403);
      expect(no.body.codice).toBe('COMMESSA_NON_ABILITATA');
    }
    // la barra comune riapre "In che commessa lavori?": rimasta una sola → scelta automatica
    const st = (await a.get('/guscio/stato')).body;
    expect(st.commessa).toMatchObject({ codice: '101-003' });
    expect((await a.get('/paniere')).status).toBe(200);
  });
});

describe('rotte admin delle commesse abilitate', () => {
  test('elenco per la finestra, validazione dei codici e traccia nel registro attività', async () => {
    fs.mkdirSync(path.join(DATA_ROOT, 'cartella-vecchia-ca'), { recursive: true });
    const admin = await entra(account('101-003', { admin: true }).username);
    const el = (await admin.get('/admin/api/commesse')).body;
    expect(codici(el.registro)).toEqual(['101-003', 'C-2024-015', '101-006']);
    expect(el.precedenti).toContain('cartella-vecchia-ca');

    const u = account('demo-augusta', { codice: '101-003' });
    // un nome inventato non diventa una cartella dati
    expect(
      (await admin.post(`/admin/api/users/${u.id}/commesse-abilitate`).send({ commesse: ['../x'] }))
        .status
    ).toBe(400);
    expect(
      (
        await admin
          .post(`/admin/api/users/${u.id}/commesse-abilitate`)
          .send({ commesse: ['inventata'] })
      ).status
    ).toBe(400);
    expect((await admin.post(`/admin/api/users/${u.id}/commesse-abilitate`).send({})).status).toBe(
      400
    );
    const ok = await admin
      .post(`/admin/api/users/${u.id}/commesse-abilitate`)
      .send({ commesse: ['C-2024-015', 'demo-augusta', 'C-2024-015'] });
    expect(ok.status).toBe(200);
    expect(ok.body.commesseAbilitate).toEqual(['C-2024-015', 'demo-augusta']);
    const utenti = (await admin.get('/admin/api/users')).body.users;
    expect(utenti.find((x: { id: string }) => x.id === u.id).commesseAbilitate).toEqual([
      'C-2024-015',
      'demo-augusta',
    ]);

    const log = (await admin.get('/admin/api/logs')).body.events;
    const riga = log
      .filter(
        (e: { type: string; username: string }) =>
          e.type === 'commesse_abilitate' && e.username === u.username
      )
      .pop();
    expect(riga.dettaglio).toMatch(/aggiunte C-2024-015/);
    expect(riga.dettaglio).toMatch(/tolte 101-003/);

    // elenco vuoto = torna alla commessa di sempre
    const vuoto = await admin
      .post(`/admin/api/users/${u.id}/commesse-abilitate`)
      .send({ commesse: [] });
    expect(vuoto.body.effettive).toEqual(['demo-augusta', '101-003']);

    // solo admin
    const normale = await entra(account('101-003').username);
    expect((await normale.get('/admin/api/commesse')).status).toBe(403);
  });
});
