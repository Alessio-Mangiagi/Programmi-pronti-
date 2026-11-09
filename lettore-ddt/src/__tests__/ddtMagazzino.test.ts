// "><(((º> sabusabu <º)))><"
/**
 * ddtMagazzino.test.ts — "DDT e Magazzino", lato Lettore DDT (09/11/2026, risposta "1a 2c 3b"):
 *   - commessa scelta all'ingresso (services/commessaSessione, rotte /guscio/*);
 *   - proxy /magazzino verso il Magazzino (contratto C2), con un finto Magazzino su una porta temporanea;
 *   - carico immediato in magazzino dopo /claude-to-excel (contratto C3), con l'esito in X-Magazzino;
 *   - Excel della conversione su SkyTower, senza doppioni (finta SkyTower);
 *   - commessa delle cartelle sorvegliate scritta in batch.config.json (file temporaneo dei test);
 *   - avvio e arresto del Magazzino (services/magazzinoProcesso) con un finto app.py in Python.
 * Il registro delle commesse della suite è finto (jest.mock di suite_link: solo commesse e
 * trovaCommessa, il resto è quello vero e parla con i finti servizi tramite SUITE_URL_*).
 */
import fs from 'fs';
import http from 'http';
import net from 'net';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { randomUUID as uuidv4 } from 'crypto';

const REGISTRO = [
  { code: '101-003', nome: 'Sede Acireale', stato: 'attiva', cliente: 'Cosedil S.p.A.' },
  { code: 'C/2024/15', nome: 'Scuola Via Roma', stato: 'attiva', cliente: 'Comune di Catania' },
];
jest.mock('../../../shared/suite/suite_link.js', () => {
  const vero = jest.requireActual('../../../shared/suite/suite_link.js');
  return {
    ...vero,
    commesse: () => REGISTRO.map((c) => ({ ...c })),
    trovaCommessa: (c: string) => REGISTRO.find((x) => x.code === String(c || '').trim()) || null,
  };
});

// Motore Ollama finto per la conversione automatica: per ogni PDF scrive il JSON (una bolla con due
// righe) e un Excel finto, come fanno i motori veri a fine lavoro.
jest.mock('../batch/ollama', () => ({
  ...jest.requireActual('../batch/ollama'),
  runOllama: async (
    opts: { inputDir: string; outputDir: string; jsonDir: string },
    events: { onFile?: (o: unknown) => void }
  ) => {
    const fsx = jest.requireActual('fs') as typeof import('fs');
    const pathx = jest.requireActual('path') as typeof import('path');
    const { safeOutputBase } = jest.requireActual('../batch/scritture');
    fsx.mkdirSync(opts.jsonDir, { recursive: true });
    fsx.mkdirSync(opts.outputDir, { recursive: true });
    const outcomes = fsx.readdirSync(opts.inputDir).map((f: string) => {
      const base = safeOutputBase(f);
      fsx.writeFileSync(
        pathx.join(opts.jsonDir, `${base}.json`),
        JSON.stringify({
          sheets: [
            {
              name: 'F1',
              headers: ['Fornitore', 'N°DDT', 'Data', 'Descrizione', 'Quantità', 'u.m.'],
              rows: [['Cave Etna', base, '03/11/2026', 'Ghiaia', '9', 'mc']],
            },
          ],
        })
      );
      fsx.writeFileSync(pathx.join(opts.outputDir, `${base}.xlsx`), `PK finto ${base}`);
      const o = { pdfName: f, status: 'ok', outputName: `${base}.xlsx` };
      events.onFile?.(o);
      return o;
    });
    return { outcomes, spostati: 0, costs: [], totalUsd: 0, batchDiscount: false, canceled: false };
  },
}));

import app from '../app';
import { createJob, readJob, type BatchJob } from '../batch/jobs';
import { createUser, deleteUser, setCommesseAbilitate } from '../models/users';
import { DATA_ROOT } from '../routes/helpers';
import { cartellaPerCodice, codiceDaCartella } from '../services/commessaSessione';
import { codiceCommessaPer, inviaExcelASkyTower } from '../services/skytower';
import { frasePerEsito, MSG_MAGAZZINO_SPENTO } from '../services/magazzino';
import { riscriviLocation, iniettaBarra } from '../services/proxyMagazzino';
import { segnaAttivita, ultimaAttivita } from '../utils/attivita';
import { CONFIG_PATH, impostaCommessaSorvegliata, loadBatchConfig } from '../batch/config';
import {
  _azzeraPerTest,
  avviaMagazzino,
  avviatoDaNoi,
  fermaMagazzino,
  magazzinoAcceso,
} from '../services/magazzinoProcesso';

const PW = 'password-lunga-1';
const utenti: string[] = [];
// abilitate: commesse abilitate sull'account (opzione b del 09/11/2026); senza, vale la commessa di
// sempre dell'account (cartella commessaId + codice aziendale), come per gli account di prima
function utente(commessaId: string, isAdmin = false, codice = '', abilitate?: string[]): string {
  const id = uuidv4();
  const username = `dm-${id.slice(0, 8)}`;
  createUser(id, username, PW, commessaId, 'Prova', isAdmin, codice);
  if (abilitate) setCommesseAbilitate(id, abilitate);
  utenti.push(id);
  return username;
}
async function entra(username: string) {
  const a = request.agent(app);
  expect((await a.post('/auth/login').send({ username, password: PW })).status).toBe(200);
  return a;
}

// ── Finto Magazzino: registra le richieste e risponde come il Flask vero ──────
interface Visto {
  metodo: string;
  percorso: string;
  headers: http.IncomingHttpHeaders;
  corpo: Buffer;
}
const visti: Visto[] = [];
let rispostaCarico: { stato: number; corpo: unknown } = {
  stato: 200,
  corpo: {
    righe: 2,
    nuove: 2,
    scartate: 0,
    commessa: '101-003',
    ubicazione: 'Cantiere 101-003',
    avvisi: [],
  },
};
const fintoMagazzino = http.createServer((req, res) => {
  const pezzi: Buffer[] = [];
  req.on('data', (c) => pezzi.push(c));
  req.on('end', () => {
    const v = {
      metodo: req.method || '',
      percorso: req.url || '',
      headers: req.headers,
      corpo: Buffer.concat(pezzi),
    };
    visti.push(v);
    const p = v.percorso.split('?')[0];
    if (p === '/api/health') return res.writeHead(200).end('{}');
    if (p === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(
        '<!doctype html><html><head><title>Magazzino</title></head><body><main>giacenze</main></body></html>'
      );
    }
    if (p === '/etichette.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<html><head></head><body>etichette</body></html>');
    }
    if (p === '/redir-rel') return res.writeHead(302, { Location: '/api/x' }).end();
    if (p === '/redir-abs')
      return res.writeHead(302, { Location: `http://127.0.0.1:${portaMagazzino}/y` }).end();
    if (p === '/redir-ext')
      return res.writeHead(302, { Location: 'http://portale.esempio/login' }).end();
    if (p === '/api/suite/ddt/consegne') {
      res.writeHead(rispostaCarico.stato, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(rispostaCarico.corpo));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ eco: v.metodo, lunghezza: v.corpo.length }));
  });
});
let portaMagazzino = 0;

// ── Finta SkyTower: registra i documenti ricevuti ──────────────────────────────
const documenti: Array<{ percorso: string; tipo: string; nome: string; corpo: Buffer }> = [];
let progressivo = 0;
const fintaSkyTower = http.createServer((req, res) => {
  const pezzi: Buffer[] = [];
  req.on('data', (c) => pezzi.push(c));
  req.on('end', () => {
    documenti.push({
      percorso: req.url || '',
      tipo: String(req.headers['content-type'] || ''),
      nome: decodeURIComponent(String(req.headers['x-suite-nome-file'] || '')),
      corpo: Buffer.concat(pezzi),
    });
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ identifier: `CDE-${++progressivo}` }));
  });
});

function ascolta(s: http.Server): Promise<number> {
  return new Promise((r) =>
    s.listen(0, '127.0.0.1', () => r((s.address() as net.AddressInfo).port))
  );
}
function portaLibera(): Promise<number> {
  return new Promise((r) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => r(p));
    });
  });
}
const aspetta = (ms: number) => new Promise((r) => setTimeout(r, ms));

const prima = { ...process.env };
beforeAll(async () => {
  portaMagazzino = await ascolta(fintoMagazzino);
  process.env.SUITE_URL_MAGAZZINO = `http://127.0.0.1:${portaMagazzino}/api`;
  process.env.SUITE_URL_SKYTOWER = `http://127.0.0.1:${await ascolta(fintaSkyTower)}`;
  delete process.env.DDT_SKYTOWER;
  delete process.env.DDT_MAGAZZINO;
});
afterAll(async () => {
  for (const id of utenti) deleteUser(id);
  for (const c of ['101-003', 'C_2024_15', 'vecchia-cartella', 'cartella-di-altri']) {
    fs.rmSync(path.join(DATA_ROOT, c), { recursive: true, force: true });
  }
  fs.rmSync(path.join(DATA_ROOT, '.ultime-commesse.json'), { force: true });
  fs.rmSync(CONFIG_PATH, { force: true });
  process.env.SUITE_URL_MAGAZZINO = prima.SUITE_URL_MAGAZZINO;
  process.env.SUITE_URL_SKYTOWER = prima.SUITE_URL_SKYTOWER;
  await new Promise((r) => fintoMagazzino.close(r));
  await new Promise((r) => fintaSkyTower.close(r));
});

// ─────────────────────────────────────────────────────────────────────────────
describe('commessa scelta all’ingresso', () => {
  test('cartella per codice e ritorno al codice del registro', () => {
    expect(cartellaPerCodice('101-003')).toBe('101-003');
    expect(cartellaPerCodice('C/2024/15')).toBe('C_2024_15');
    expect(codiceDaCartella('C_2024_15')).toBe('C/2024/15');
    expect(codiceDaCartella('demo-augusta')).toBe('');
    // la cartella che è una commessa del registro vince sul codice scritto a mano sull'account
    const u = utente('vecchia-cartella', false, '999-999');
    expect(codiceCommessaPer(u, '101-003')).toBe('101-003');
    expect(codiceCommessaPer(u, 'vecchia-cartella')).toBe('999-999');
  });

  test('stato, elenco, scelta: solo le commesse abilitate (registro + cartella precedente), mai una cartella altrui', async () => {
    fs.mkdirSync(path.join(DATA_ROOT, 'cartella-di-altri'), { recursive: true });
    const a = await entra(
      utente('vecchia-cartella', false, '', ['101-003', 'C/2024/15', 'vecchia-cartella'])
    );
    const s0 = await a.get('/guscio/stato');
    expect(s0.status).toBe(200);
    expect(s0.body).toMatchObject({
      scelta: false,
      ddt: { account: true },
      commessa: { cartella: 'vecchia-cartella', precedente: true },
    });

    const el = await a.get('/guscio/commesse');
    expect(el.body.limitata).toBe(true);
    expect(el.body.commesse.map((c: { codice: string }) => c.codice)).toEqual([
      '101-003',
      'C/2024/15',
    ]);
    expect(el.body.commesse[1].cartella).toBe('C_2024_15');
    expect(el.body.precedenti.map((c: { codice: string }) => c.codice)).toEqual([
      'vecchia-cartella',
    ]);
    // la cartella vecchia non si propone d'ufficio: la prima volta si sceglie dal registro
    expect(el.body.proposta).toBe('');

    // fuori elenco: 403 (controllo lato server, l'elenco della finestra non le offre)
    expect((await a.post('/guscio/commessa').send({ codice: 'non-esiste' })).status).toBe(403);
    expect((await a.post('/guscio/commessa').send({ codice: 'cartella-di-altri' })).status).toBe(
      403
    );
    expect((await a.post('/guscio/commessa').send({ codice: '' })).status).toBe(400);

    const ok = await a.post('/guscio/commessa').send({ codice: '101-003' });
    expect(ok.status).toBe(200);
    expect(ok.body.commessa).toMatchObject({
      codice: '101-003',
      nome: 'Sede Acireale',
      cartella: '101-003',
      precedente: false,
    });
    expect((await a.get('/auth/me')).body.commessaId).toBe('101-003');
    expect((await a.get('/guscio/stato')).body.scelta).toBe(true);

    // codice con barre: cartella ripulita, codice del registro conservato
    await a.post('/guscio/commessa').send({ codice: 'C/2024/15' });
    expect((await a.get('/auth/me')).body.commessaId).toBe('C_2024_15');
    expect((await a.get('/guscio/stato')).body.commessa.codice).toBe('C/2024/15');
  });

  test('la proposta è l’ultima scelta; l’amministratore vede tutte le cartelle precedenti', async () => {
    const u = utente('vecchia-cartella', false, '', ['101-003', 'vecchia-cartella']);
    const a = await entra(u);
    await a.post('/guscio/commessa').send({ codice: '101-003' });
    const di_nuovo = await entra(u);
    expect((await di_nuovo.get('/guscio/commesse')).body.proposta).toBe('101-003');
    // senza scelte precedenti: il codice commessa scritto sull'account, se è nel registro
    const conCodice = await entra(utente('vecchia-cartella', false, 'C/2024/15'));
    expect((await conCodice.get('/guscio/commesse')).body.proposta).toBe('C/2024/15');

    fs.mkdirSync(path.join(DATA_ROOT, 'cartella-di-altri'), { recursive: true });
    const admin = await entra(utente('101-003', true));
    const el = (await admin.get('/guscio/commesse')).body;
    expect(el.precedenti.map((c: { codice: string }) => c.codice)).toContain('cartella-di-altri');
    expect(
      (await admin.post('/guscio/commessa').send({ codice: 'cartella-di-altri' })).status
    ).toBe(200);
  });

  test('senza ingresso niente stato', async () => {
    expect((await request(app).get('/guscio/stato')).status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('proxy /magazzino (C2)', () => {
  test('/magazzino senza barra → redirect; pagina principale con la barra comune e le intestazioni del proxy', async () => {
    const a = await entra(utente('vecchia-cartella', false, '101-003'));
    await a.post('/guscio/commessa').send({ codice: '101-003' });

    const r301 = await a.get('/magazzino');
    expect(r301.status).toBe(301);
    expect(r301.headers.location).toBe('/magazzino/');

    visti.length = 0;
    const pagina = await a
      .get('/magazzino/')
      .set('Accept', 'text/html')
      .set('X-Suite-Token', 'rubato')
      .set('X-Suite-Commessa', 'finta')
      .set('X-Forwarded-Prefix', '/altro');
    expect(pagina.status).toBe(200);
    expect(pagina.text).toContain('<main>giacenze</main>');
    expect(pagina.text).toContain('/guscio/barra.js');
    const v = visti[0];
    expect(v.percorso).toBe('/');
    expect(v.headers['x-forwarded-prefix']).toBe('/magazzino');
    expect(v.headers['x-suite-commessa']).toBe('101-003'); // quella della sessione, non quella del browser
    expect(v.headers['x-suite-token']).toBeUndefined();
    expect(v.headers['accept-encoding']).toBe('identity');
    expect(v.headers.cookie).toBeDefined(); // il cookie va avanti: il gate del Magazzino lo verifica col portale

    const etichette = await a.get('/magazzino/etichette.html').set('Accept', 'text/html');
    expect(etichette.text).not.toContain('/guscio/barra.js');
  });

  test('corpo JSON e multipart inoltrati intatti', async () => {
    const a = await entra(utente('vecchia-cartella'));
    const j = await a.post('/magazzino/api/movimenti').send({ tipo: 'carico', quantita: 3 });
    expect(j.body).toEqual({
      eco: 'POST',
      lunghezza: JSON.stringify({ tipo: 'carico', quantita: 3 }).length,
    });
    visti.length = 0;
    const foto = Buffer.alloc(300_000, 7);
    const m = await a.post('/magazzino/api/mezzi/1/foto').attach('foto', foto, 'mezzo.jpg');
    expect(m.status).toBe(200);
    expect(String(visti[0].headers['content-type'])).toMatch(/^multipart\/form-data; boundary=/);
    expect(visti[0].corpo.length).toBeGreaterThan(foto.length);
    expect(visti[0].corpo.includes(foto.subarray(0, 1000))).toBe(true);
  });

  test('redirect del Magazzino riscritti sotto /magazzino (non quelli verso altri indirizzi)', async () => {
    const a = await entra(utente('vecchia-cartella'));
    expect((await a.get('/magazzino/redir-rel')).headers.location).toBe('/magazzino/api/x');
    expect((await a.get('/magazzino/redir-abs')).headers.location).toBe('/magazzino/y');
    expect((await a.get('/magazzino/redir-ext')).headers.location).toBe(
      'http://portale.esempio/login'
    );
    expect(riscriviLocation('/magazzino/z', 'http://127.0.0.1:5200')).toBe('/magazzino/z');
    expect(iniettaBarra('<p>senza head</p>')).toContain('/guscio/barra.js');
  });

  test('ogni richiesta del proxy conta come attività (i telefoni non mandano /ping)', async () => {
    const a = await entra(utente('vecchia-cartella'));
    segnaAttivita(0);
    await a.get('/magazzino/api/qualcosa');
    expect(ultimaAttivita()).toBeGreaterThan(Date.now() - 5000);
  });

  test('Magazzino spento: pagina di cortesia (senza avvio automatico: "non è acceso")', async () => {
    const a = await entra(utente('vecchia-cartella'));
    const chiusa = await portaLibera();
    process.env.SUITE_URL_MAGAZZINO = `http://127.0.0.1:${chiusa}/api`;
    try {
      const html = await a.get('/magazzino/').set('Accept', 'text/html');
      expect(html.status).toBe(503);
      expect(html.text).toContain('non è acceso');
      const api = await a.get('/magazzino/api/giacenze');
      expect(api.status).toBe(503);
      expect(api.body.error).toMatch(/magazzino/i);
      // con l'avvio automatico: "sto avviando" (qui la cartella del Magazzino non c'è: nessun processo)
      process.env.DDT_MAGAZZINO_AVVIO = '1';
      process.env.DDT_MAGAZZINO_DIR = path.join(os.tmpdir(), `nessun-magazzino-${uuidv4()}`);
      _azzeraPerTest();
      const avvio = await a.get('/magazzino/').set('Accept', 'text/html');
      expect(avvio.status).toBe(503);
      expect(avvio.text).toContain('Sto avviando il magazzino');
    } finally {
      process.env.DDT_MAGAZZINO_AVVIO = '0';
      delete process.env.DDT_MAGAZZINO_DIR;
      process.env.SUITE_URL_MAGAZZINO = `http://127.0.0.1:${portaMagazzino}/api`;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
const bolla = (ddt: string) => ({
  sheets: [
    {
      name: 'F1-Dettaglio DDT',
      headers: ['Fornitore', 'P.IVA Fornitore', 'N°DDT', 'Data', 'Descrizione', 'Quantità', 'u.m.'],
      rows: [
        ['Cave Etna', '01234567890', ddt, '03/11/2026', 'Misto stabilizzato', '14', 'mc'],
        ['Cave Etna', '01234567890', ddt, '03/11/2026', 'Sabbia', '6', 'mc'],
      ],
    },
  ],
});
const esitoDi = (r: request.Response) =>
  r.headers['x-magazzino'] ? JSON.parse(decodeURIComponent(r.headers['x-magazzino'])) : null;

describe('carico immediato in magazzino dopo la conversione (C3)', () => {
  test('il blocco appena salvato va al Magazzino con il token e la commessa; esito in X-Magazzino', async () => {
    const a = await entra(utente('vecchia-cartella', false, '101-003'));
    await a.post('/guscio/commessa').send({ codice: '101-003' });
    visti.length = 0;
    const r = await a
      .post('/claude-to-excel')
      .send({ response: JSON.stringify(bolla('118')), pdfFileName: 'bolla-118.pdf' });
    expect(r.status).toBe(200);
    expect(esitoDi(r)).toMatchObject({
      registrati: true,
      righe: 2,
      messaggio: '2 carichi registrati in magazzino (Cantiere 101-003).',
    });
    const carico = visti.find((v) => v.percorso === '/api/suite/ddt/consegne');
    expect(carico?.metodo).toBe('POST');
    expect(carico?.headers['x-suite-token']).toBeTruthy();
    const corpo = JSON.parse(carico!.corpo.toString('utf8'));
    expect(corpo).toMatchObject({
      cartella: '101-003',
      export: 'bolla-118.json',
      codiceCommessa: '101-003',
    });
    expect(corpo.salvatoIl).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(
      corpo.righe.map((x: { materiale: string; quantita: number }) => [x.materiale, x.quantita])
    ).toEqual([
      ['Misto stabilizzato', 14],
      ['Sabbia', 6],
    ]);
  });

  test('Magazzino che risponde male o spento: niente errore per l’utente, solo "li registrerà appena acceso"', async () => {
    const a = await entra(utente('vecchia-cartella', false, '101-003'));
    await a.post('/guscio/commessa').send({ codice: '101-003' });
    rispostaCarico = { stato: 500, corpo: { error: 'rotto' } };
    try {
      const r = await a
        .post('/claude-to-excel')
        .send({ response: JSON.stringify(bolla('119')), pdfFileName: 'bolla-119.pdf' });
      expect(r.status).toBe(200);
      expect(esitoDi(r)).toMatchObject({ registrati: false, messaggio: MSG_MAGAZZINO_SPENTO });
    } finally {
      rispostaCarico = {
        stato: 200,
        corpo: {
          righe: 2,
          nuove: 2,
          scartate: 0,
          commessa: '101-003',
          ubicazione: 'Cantiere 101-003',
          avvisi: [],
        },
      };
    }
    process.env.DDT_MAGAZZINO = '0';
    try {
      visti.length = 0;
      const r = await a
        .post('/claude-to-excel')
        .send({ response: JSON.stringify(bolla('120')), pdfFileName: 'bolla-120.pdf' });
      expect(r.status).toBe(200);
      expect(r.headers['x-magazzino']).toBeUndefined();
      expect(visti.some((v) => v.percorso === '/api/suite/ddt/consegne')).toBe(false);
    } finally {
      delete process.env.DDT_MAGAZZINO;
    }
  });

  test('frasi per l’utente', () => {
    expect(
      frasePerEsito({ registrati: true, righe: 1, ubicazione: 'Cantiere X', avvisi: [] })
    ).toBe('1 carico registrato in magazzino (Cantiere X).');
    expect(frasePerEsito({ registrati: true, righe: 0, scartate: 3, avvisi: [] })).toMatch(
      /3 righe senza materiale/
    );
    expect(frasePerEsito({ registrati: false, avvisi: [] })).toBe(MSG_MAGAZZINO_SPENTO);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Excel della conversione su SkyTower', () => {
  test('dalla conversione manuale: l’Excel arriva nella commessa; lo stesso Excel non riparte', async () => {
    const a = await entra(utente('vecchia-cartella', false, '101-003'));
    await a.post('/guscio/commessa').send({ codice: '101-003' });
    documenti.length = 0;
    const corpo = { response: JSON.stringify(bolla('121')), pdfFileName: 'bolla-121.pdf' };
    expect((await a.post('/claude-to-excel').send(corpo)).status).toBe(200);
    for (let i = 0; i < 60 && !documenti.length; i++) await aspetta(50);
    expect(documenti).toHaveLength(1);
    expect(documenti[0].percorso).toMatch(/^\/suite\/commesse\/101-003\/documenti\?/);
    expect(documenti[0].tipo).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(documenti[0].nome).toBe('bolla-121.xlsx');
    expect(documenti[0].corpo.subarray(0, 2).toString()).toBe('PK'); // un .xlsx vero (zip)
    // "Riscarica" dalla cronologia: stessa conversione → niente secondo documento
    expect((await a.post('/claude-to-excel').send(corpo)).status).toBe(200);
    await aspetta(400);
    expect(documenti).toHaveLength(1);
  });

  test('dati cambiati: documento nuovo con l’identificativo di quello che sostituisce', async () => {
    documenti.length = 0;
    const base = {
      commessaId: '101-003',
      utente: 'prova',
      nomeFile: 'x.xlsx',
      exportName: 'x.json',
    };
    expect(
      await inviaExcelASkyTower({ ...base, excel: Buffer.from('PK uno'), parsed: bolla('1') })
    ).toBe(true);
    expect(
      await inviaExcelASkyTower({ ...base, excel: Buffer.from('PK uno bis'), parsed: bolla('1') })
    ).toBe(true);
    expect(documenti).toHaveLength(1);
    expect(
      await inviaExcelASkyTower({ ...base, excel: Buffer.from('PK due'), parsed: bolla('2') })
    ).toBe(true);
    expect(documenti).toHaveLength(2);
    const attributi = JSON.parse(
      new URL(`http://x${documenti[1].percorso}`).searchParams.get('attributes') || '{}'
    );
    expect(attributi).toMatchObject({ formato: 'xlsx', sostituisce: `CDE-${progressivo - 1}` });
    // commessa senza codice del registro: non parte
    expect(
      await inviaExcelASkyTower({
        ...base,
        commessaId: 'vecchia-cartella',
        excel: Buffer.from('PK'),
        parsed: bolla('3'),
      })
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('conversione automatica: carichi in magazzino ed Excel su SkyTower dal lavoro', () => {
  async function attendiFine(commessa: string, id: string): Promise<BatchJob> {
    for (let i = 0; i < 200; i++) {
      const job = readJob(commessa, id);
      if (job && job.status !== 'in-attesa' && job.status !== 'in-corso') return job;
      await aspetta(25);
    }
    throw new Error('lavoro non concluso');
  }
  function lavoro(input: string, out: string) {
    return createJob({
      commessaId: '101-003',
      createdBy: 'tester',
      mode: 'server',
      promptId: 'ddt',
      model: 'claude-haiku-4-5',
      fallbackModel: 'claude-sonnet-5',
      useFallback: false,
      useBatchApi: false,
      force: false,
      pulisci: false,
      localOcr: false,
      ollama: true,
      mergeOutput: false,
      inputDir: input,
      outputDir: out,
    });
  }

  test('un blocco per file al Magazzino, una riga nel diario; un Excel per file a SkyTower', async () => {
    const input = fs.mkdtempSync(path.join(os.tmpdir(), 'ddt-lavoro-'));
    fs.writeFileSync(path.join(input, 'bolla-a.pdf'), '%PDF-1.4 a');
    fs.writeFileSync(path.join(input, 'bolla-b.pdf'), '%PDF-1.4 b');
    visti.length = 0;
    documenti.length = 0;
    rispostaCarico = {
      stato: 200,
      corpo: {
        righe: 1,
        nuove: 1,
        scartate: 0,
        commessa: '101-003',
        ubicazione: 'Cantiere 101-003',
        avvisi: [],
      },
    };
    try {
      const fine = await attendiFine('101-003', lavoro(input, `${input}-out`).id);
      expect(fine.status).toBe('completato');
      const carichi = visti
        .filter((v) => v.percorso === '/api/suite/ddt/consegne')
        .map((v) => JSON.parse(v.corpo.toString()));
      expect(carichi.map((c) => c.export).sort()).toEqual(['bolla-a.json', 'bolla-b.json']);
      expect(carichi[0]).toMatchObject({ cartella: '101-003', codiceCommessa: '101-003' });
      expect(
        fine.log.some((l) => /Magazzino: 2 carichi registrati \(Cantiere 101-003\)\./.test(l))
      ).toBe(true);
      const excel = documenti
        .filter((d) => d.tipo.includes('spreadsheetml'))
        .map((d) => d.nome)
        .sort();
      expect(excel).toEqual(['bolla-a.xlsx', 'bolla-b.xlsx']);
      expect(fine.log.some((l) => /SkyTower: 2 Excel nella commessa\./.test(l))).toBe(true);

      // Magazzino spento: il lavoro finisce lo stesso, con una riga sola nel diario
      process.env.SUITE_URL_MAGAZZINO = `http://127.0.0.1:${await portaLibera()}/api`;
      fs.writeFileSync(path.join(input, 'bolla-c.pdf'), '%PDF-1.4 c');
      const spento = await attendiFine('101-003', lavoro(input, `${input}-out2`).id);
      expect(spento.status).toBe('completato');
      expect(spento.log.filter((l) => l.includes(MSG_MAGAZZINO_SPENTO))).toHaveLength(1);
    } finally {
      process.env.SUITE_URL_MAGAZZINO = `http://127.0.0.1:${portaMagazzino}/api`;
      rispostaCarico = {
        stato: 200,
        corpo: {
          righe: 2,
          nuove: 2,
          scartate: 0,
          commessa: '101-003',
          ubicazione: 'Cantiere 101-003',
          avvisi: [],
        },
      };
      fs.rmSync(input, { recursive: true, force: true });
      fs.rmSync(`${input}-out`, { recursive: true, force: true });
      fs.rmSync(`${input}-out2`, { recursive: true, force: true });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('commessa delle cartelle sorvegliate', () => {
  test('l’admin la sceglie dal registro: scritta in batch.config.json, il resto del file intatto', async () => {
    const input = path.join(os.tmpdir(), `ddt-sorvegliata-${uuidv4()}`);
    fs.writeFileSync(
      CONFIG_PATH,
      JSON.stringify({
        allowedRoots: [os.tmpdir()],
        sorvegliate: [{ commessa: 'vecchia', input, output: `${input}-out`, ogniMinuti: 10 }],
      })
    );
    const admin = await entra(utente('101-003', true));
    const el = await admin.get('/batch/sorveglianza');
    expect(el.status).toBe(200);
    expect(el.body.cartelle[0]).toMatchObject({ commessa: 'vecchia', codiceRegistro: '' });
    expect(el.body.registro.map((c: { codice: string }) => c.codice)).toEqual([
      '101-003',
      'C/2024/15',
    ]);

    expect(
      (await admin.post('/batch/sorveglianza/commessa').send({ input, commessa: 'non-esiste' }))
        .status
    ).toBe(400);
    const ok = await admin
      .post('/batch/sorveglianza/commessa')
      .send({ input, commessa: 'C/2024/15' });
    expect(ok.body).toMatchObject({ ok: true, commessa: 'C_2024_15', codiceRegistro: 'C/2024/15' });
    const scritto = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    expect(scritto.sorvegliate[0]).toMatchObject({ commessa: 'C_2024_15', ogniMinuti: 10 });
    expect(scritto.allowedRoots).toEqual([os.tmpdir()]);
    expect(loadBatchConfig().sorvegliate[0].commessa).toBe('C_2024_15');
    expect(impostaCommessaSorvegliata(path.join(os.tmpdir(), 'altra'), '101-003')).toBe(false);

    const normale = await entra(utente('C_2024_15'));
    expect(
      (await normale.post('/batch/sorveglianza/commessa').send({ input, commessa: '101-003' }))
        .status
    ).toBe(403);
    fs.rmSync(CONFIG_PATH, { force: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('avvio e arresto del Magazzino (C1)', () => {
  // Finto Magazzino in Python: database.py lascia un segno, app.py risponde su /api/health.
  let dir: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddt-finto-magazzino-'));
    fs.writeFileSync(path.join(dir, 'database.py'), "open('db-pronto', 'w').write('ok')\n");
    fs.writeFileSync(
      path.join(dir, 'app.py'),
      [
        'import os',
        'from http.server import BaseHTTPRequestHandler, HTTPServer',
        'class H(BaseHTTPRequestHandler):',
        '    def do_GET(self):',
        "        self.send_response(200); self.end_headers(); self.wfile.write(b'{}')",
        '    def log_message(self, *a): pass',
        "HTTPServer((os.environ['HOST'], int(os.environ['PORT'])), H).serve_forever()",
        '',
      ].join('\n')
    );
  });
  afterAll(() => {
    fermaMagazzino();
    process.env.DDT_MAGAZZINO_AVVIO = '0';
    delete process.env.DDT_MAGAZZINO_DIR;
    delete process.env.DDT_MAGAZZINO_PYTHON;
    process.env.SUITE_URL_MAGAZZINO = `http://127.0.0.1:${portaMagazzino}/api`;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('spento → lo avvia (database.py poi app.py), lo riconosce come suo e lo ferma', async () => {
    const porta = await portaLibera();
    process.env.SUITE_URL_MAGAZZINO = `http://127.0.0.1:${porta}/api`;
    process.env.DDT_MAGAZZINO_AVVIO = '1';
    process.env.DDT_MAGAZZINO_DIR = dir;
    process.env.DDT_MAGAZZINO_PYTHON = 'python';
    _azzeraPerTest();
    expect(await avviaMagazzino()).toBe(true);
    expect(fs.existsSync(path.join(dir, 'db-pronto'))).toBe(true);
    expect(avviatoDaNoi()).toBe(true);
    expect(await magazzinoAcceso()).toBe(true);
    expect(await avviaMagazzino()).toBe(true); // già suo: nessun secondo processo
    fermaMagazzino();
    let acceso = true;
    for (let i = 0; i < 40 && acceso; i++) {
      await aspetta(250);
      acceso = await magazzinoAcceso(500);
    }
    expect(acceso).toBe(false);
    expect(avviatoDaNoi()).toBe(false);
  }, 60_000);

  test('già acceso da altri: lo usa e non lo ferma mai', async () => {
    process.env.SUITE_URL_MAGAZZINO = `http://127.0.0.1:${portaMagazzino}/api`;
    process.env.DDT_MAGAZZINO_AVVIO = '1';
    _azzeraPerTest();
    expect(await avviaMagazzino()).toBe(true);
    expect(avviatoDaNoi()).toBe(false);
    fermaMagazzino();
    expect(await magazzinoAcceso()).toBe(true);
  });

  test('cartella senza app.py: non parte niente', async () => {
    process.env.SUITE_URL_MAGAZZINO = `http://127.0.0.1:${await portaLibera()}/api`;
    process.env.DDT_MAGAZZINO_AVVIO = '1';
    process.env.DDT_MAGAZZINO_DIR = path.join(os.tmpdir(), `vuota-${uuidv4()}`);
    _azzeraPerTest();
    expect(await avviaMagazzino()).toBe(false);
    expect(avviatoDaNoi()).toBe(false);
  });
});
