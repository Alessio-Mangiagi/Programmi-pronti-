// Test del gate SSO condiviso (node --test, zero dipendenze).
//
//   node --test shared/sso/
//
// Il "portale" è un finto server HTTP locale: risponde 200 col cookie giusto,
// 401 senza. Il gate viene montato su un mini-server Express-less (basta
// l'interfaccia req/res di Node) e si osserva il comportamento dall'esterno.
//
// ATTENZIONE: COSEDIL_* vengono lette dal modulo al primo require, quindi il
// modulo va caricato DOPO aver impostato l'ambiente del test.
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

process.env.COSEDIL_SSO = 'on';
process.env.COSEDIL_SSO_FAIL = 'closed';

let fintoPortale;          // server che impersona <portale>/api/verify
let portalePort;
let appServer;             // server con il gate montato
let appPort;
const COOKIE_OK = 'sid=utente-valido';
const COOKIE_ADMIN = 'sid=admin-valido';

function avviaFintoPortale() {
  return new Promise((resolve) => {
    fintoPortale = http.createServer((req, res) => {
      const cookie = req.headers.cookie || '';
      const url = new URL(req.url, 'http://x');
      if (!url.pathname.startsWith('/api/verify')) { res.writeHead(404); return res.end(); }
      if (cookie === COOKIE_ADMIN) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, username: 'boss', nome: 'Boss', ruolo: 'admin', admin: true }));
      }
      if (cookie === COOKIE_OK) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, username: 'mario', nome: 'Mario', ruolo: 'utente', admin: false }));
      }
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false }));
    });
    fintoPortale.listen(0, '127.0.0.1', () => {
      portalePort = fintoPortale.address().port;
      process.env.COSEDIL_PORTAL = `http://127.0.0.1:${portalePort}`;
      resolve();
    });
  });
}

// Monta il gate davanti a un handler che risponde sempre "APP".
function avviaApp(opts) {
  // require DOPO aver impostato COSEDIL_PORTAL (il modulo la legge al load).
  delete require.cache[require.resolve('./cosedil-sso.js')];
  const cosedilSSO = require('./cosedil-sso.js');
  const gate = cosedilSSO(opts);
  return new Promise((resolve) => {
    appServer = http.createServer((req, res) => {
      gate(req, res, () => { res.writeHead(200); res.end('APP'); });
    });
    // "><(((º> sabusabu <º)))><"
    appServer.listen(0, '127.0.0.1', () => { appPort = appServer.address().port; resolve(); });
  });
}

function chiudi(server) {
  return new Promise((resolve) => (server ? server.close(resolve) : resolve()));
}

// GET verso l'app col gate; ritorna { status, location, body }.
function richiesta(path, { cookie, html } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: appPort, path,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        Accept: html ? 'text/html' : 'application/json',
      },
    }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

before(async () => { await avviaFintoPortale(); });
after(async () => { await chiudi(fintoPortale); await chiudi(appServer); });

test('loggato: passa', async () => {
  await avviaApp({ app: 'test' });
  const r = await richiesta('/api/dati', { cookie: COOKIE_OK });
  assert.equal(r.status, 200);
  assert.equal(r.body, 'APP');
  await chiudi(appServer);
});

test('non loggato: API 401, pagina 302 al portale', async () => {
  await avviaApp({ app: 'test' });
  const api = await richiesta('/api/dati');
  assert.equal(api.status, 401);
  const pagina = await richiesta('/', { html: true });
  assert.equal(pagina.status, 302);
  assert.ok(pagina.location.startsWith(process.env.COSEDIL_PORTAL));
  await chiudi(appServer);
});

test('portale pubblico: redirect all\'indirizzo pubblico, verifica in locale', async () => {
  process.env.COSEDIL_PORTAL_PUBBLICO = 'https://portale.esempio.lan';
  try {
    await avviaApp({ app: 'test' });
    const pagina = await richiesta('/', { html: true });
    assert.equal(pagina.status, 302);
    assert.equal(pagina.location, 'https://portale.esempio.lan/');
    // La sessione si verifica ancora sul portale locale (COSEDIL_PORTAL).
    const r = await richiesta('/api/dati', { cookie: COOKIE_OK });
    assert.equal(r.status, 200);
  } finally {
    delete process.env.COSEDIL_PORTAL_PUBBLICO;
    await chiudi(appServer);
  }
});

test('asset statici passano anche senza login', async () => {
  await avviaApp({ app: 'test' });
  const r = await richiesta('/assets/stile.css');   // né HTML né /api
  assert.equal(r.status, 200);
  assert.equal(r.body, 'APP');
  await chiudi(appServer);
});

test('adminOnly: utente normale 403, admin passa', async () => {
  await avviaApp({ app: 'test', adminOnly: true });
  const no = await richiesta('/api/dati', { cookie: COOKIE_OK });
  assert.equal(no.status, 403);
  const si = await richiesta('/api/dati', { cookie: COOKIE_ADMIN });
  assert.equal(si.status, 200);
  await chiudi(appServer);
});

test('adminPaths: blocca solo le rotte elencate', async () => {
  await avviaApp({ app: 'test', adminPaths: ['/api/admin'] });
  const libera = await richiesta('/api/dati', { cookie: COOKIE_OK });
  assert.equal(libera.status, 200);
  const admin = await richiesta('/api/admin/utenti', { cookie: COOKIE_OK });
  assert.equal(admin.status, 403);
  await chiudi(appServer);
});

test('portale giù: gate chiuso risponde 503', async () => {
  await avviaApp({ app: 'giu-closed' });
  await chiudi(fintoPortale);                       // spegne il portale
  fintoPortale = null;
  const r = await richiesta('/api/dati', { cookie: 'sid=chiunque-giu-1' });
  assert.equal(r.status, 503);
});

test('portale giù: failOpen esplicito passa', async () => {
  await chiudi(appServer);
  await avviaApp({ app: 'giu-open', failOpen: true });
  const r = await richiesta('/api/dati', { cookie: 'sid=chiunque-giu-2' });
  assert.equal(r.status, 200);
  assert.equal(r.body, 'APP');
});
