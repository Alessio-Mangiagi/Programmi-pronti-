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
process.env.SUITE_TOKEN = 'token-di-prova';   // profiloPortale lo manda come X-Suite-Token

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
      // Finto /api/suite/profilo (11/11/2026, CONTRATTI § 12): token della suite obbligatorio.
      if (url.pathname === '/api/suite/profilo' && req.method === 'POST') {
        let corpo = '';
        req.on('data', (c) => (corpo += c));
        req.on('end', () => {
          const c = JSON.parse(corpo || '{}');
          const manda = (codice, dati) => { res.writeHead(codice, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(dati)); };
          if (req.headers['x-suite-token'] !== 'token-di-prova') return manda(403, { ok: false, error: 'Token della suite mancante o errato' });
          if (c.app === 'boh') return manda(400, { ok: false, error: 'Programma sconosciuto' });
          if (c.login === 'Boss@CosedilSpa.com') {
            return manda(200, { ok: true, trovato: true, username: 'Boss', nome: 'Boss', email: 'Boss@CosedilSpa.com', ruolo: 'admin',
              admin: true, proprietario: true, disattivato: false, mustChange: false, abilitato: c.app === 'agente' });
          }
          return manda(200, { ok: true, trovato: false });
        });
        return undefined;
      }
      if (!url.pathname.startsWith('/api/verify')) { res.writeHead(404); return res.end(); }
      if (cookie === COOKIE_ADMIN) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, username: 'boss', nome: 'Boss', ruolo: 'admin', admin: true, proprietario: true }));
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

test('fail-closed: rotte fuori da /api e /API maiuscolo richiedono il login', async () => {
  // Prima passava tutto ciò che non era HTML o "/api": una rotta con dati fuori da /api
  // (Lettore DDT: /claude-to-excel) o "/API/x" (Express non distingue le maiuscole) rispondeva senza login.
  await avviaApp({ app: 'test' });
  for (const path of ['/claude-to-excel', '/API/dati', '/batch/jobs', '/@fs/C:/segreti/.token', '/dati.db']) {
    const r = await richiesta(path);
    assert.equal(r.status, 401, path);
  }
  for (const path of ['/assets/app.js', '/static/logo.png', '/@vite/client', '/favicon.ico']) {
    const r = await richiesta(path);
    assert.equal(r.status, 200, path);   // asset: passano senza sessione
  }
  const ok = await richiesta('/claude-to-excel', { cookie: COOKIE_OK });
  assert.equal(ok.status, 200);
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

test('più id app: entra chi è abilitato ad almeno uno, admin solo dal primo id', async () => {
  // Portale a parte che conosce le abilitazioni per app: "solo-mag" è abilitato al magazzino e non
  // al ddt (403), "capo-mag" è admin del magazzino. Gate con { app: ['ddt', 'magazzino'] } come
  // "DDT e Magazzino" (09/11/2026).
  const portale = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const app = url.searchParams.get('app');
    const cookie = req.headers.cookie || '';
    const json = (stato, corpo) => { res.writeHead(stato, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(corpo)); };
    if (cookie === 'sid=solo-mag' || cookie === 'sid=capo-mag') {
      if (app === 'ddt') return json(403, { ok: false, error: 'Accesso riservato' });
      return json(200, { ok: true, username: 'gino', admin: cookie === 'sid=capo-mag' });
    }
    if (cookie === 'sid=nessuno') return json(403, { ok: false, error: 'Accesso riservato' });
    // portale dal 09/11/2026: "DDT e Magazzino" comprende il Magazzino, quindi chi ha solo quella spunta
    // passa anche su ddt, ma con diretto: false (il Lettore DDT non gli crea l'account)
    if (cookie === 'sid=via-comprende') return json(200, { ok: true, username: 'tneri', admin: false, diretto: app !== 'ddt' });
    if (cookie === 'sid=ddt-admin') return json(200, { ok: true, username: 'boss', admin: true });
    return json(401, { ok: false });
  });
  await new Promise((r) => portale.listen(0, '127.0.0.1', r));
  const prima = process.env.COSEDIL_PORTAL;
  process.env.COSEDIL_PORTAL = `http://127.0.0.1:${portale.address().port}`;
  delete require.cache[require.resolve('./cosedil-sso.js')];
  const gate = require('./cosedil-sso.js')({ app: ['ddt', 'magazzino'] });
  const srv = http.createServer((req, res) => gate(req, res, () => { res.writeHead(200); res.end(JSON.stringify(req.cosedil)); }));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const chiedi = (cookie) => new Promise((resolve, reject) => {
    const q = http.request({ host: '127.0.0.1', port: srv.address().port, path: '/api/x', headers: { Cookie: cookie, Accept: 'application/json' } },
      (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, body: b })); });
    q.on('error', reject); q.end();
  });
  try {
    const mag = await chiedi('sid=solo-mag');
    assert.equal(mag.status, 200);
    assert.deepEqual({ app: JSON.parse(mag.body).app, admin: JSON.parse(mag.body).admin }, { app: 'magazzino', admin: false });
    // admin del magazzino non diventa admin del programma (l'admin è quello del primo id)
    assert.equal(JSON.parse((await chiedi('sid=capo-mag')).body).admin, false);
    const ddt = JSON.parse((await chiedi('sid=ddt-admin')).body);
    assert.deepEqual({ app: ddt.app, admin: ddt.admin }, { app: 'ddt', admin: true });
    const viaComprende = JSON.parse((await chiedi('sid=via-comprende')).body);
    assert.deepEqual({ app: viaComprende.app, diretto: viaComprende.diretto }, { app: 'ddt', diretto: false });
    assert.equal(ddt.diretto, undefined, 'portale che non lo dice: non si sa');
    assert.equal((await chiedi('sid=nessuno')).status, 403);     // nessuno dei due: "chiedi l'abilitazione"
    assert.equal((await chiedi('sid=sconosciuto')).status, 401); // non loggato: come sempre
  } finally {
    process.env.COSEDIL_PORTAL = prima;
    delete require.cache[require.resolve('./cosedil-sso.js')];
    await chiudi(srv);
    await chiudi(portale);
  }
});

test('profilo del portale: proprietario in verificaSessione, profiloPortale col token della suite', async () => {
  delete require.cache[require.resolve('./cosedil-sso.js')];
  const sso = require('./cosedil-sso.js');
  assert.equal((await sso.verificaSessione(COOKIE_ADMIN, 'profilo-1')).proprietario, true);
  assert.equal((await sso.verificaSessione(COOKIE_OK, 'profilo-1')).proprietario, false, 'portale che non lo dice: false');
  const p = await sso.profiloPortale('Boss@CosedilSpa.com', 'agente');
  assert.deepEqual(
    { ok: p.ok, trovato: p.trovato, username: p.username, email: p.email, admin: p.admin, proprietario: p.proprietario, abilitato: p.abilitato },
    { ok: true, trovato: true, username: 'boss', email: 'boss@cosedilspa.com', admin: true, proprietario: true, abilitato: true });
  assert.equal((await sso.profiloPortale('Boss@CosedilSpa.com', 'skytower')).abilitato, false);
  const nessuno = await sso.profiloPortale('sconosciuto', 'agente');
  assert.ok(nessuno.ok && !nessuno.trovato && nessuno.reachable);
  const ignoto = await sso.profiloPortale('boss', 'boh');
  assert.ok(!ignoto.ok && ignoto.status === 400 && ignoto.reachable);
});

test('portale giù: gate chiuso risponde 503', async () => {
  await avviaApp({ app: 'giu-closed' });
  await chiudi(fintoPortale);                       // spegne il portale
  fintoPortale = null;
  const r = await richiesta('/api/dati', { cookie: 'sid=chiunque-giu-1' });
  assert.equal(r.status, 503);
});

test('portale giù: profiloPortale non lancia, reachable false', async () => {
  const sso = require('./cosedil-sso.js');
  const p = await sso.profiloPortale('Boss@CosedilSpa.com', 'agente', { timeout: 1000 });
  assert.ok(!p.ok && !p.reachable);
});

test('portale giù: failOpen esplicito passa', async () => {
  await chiudi(appServer);
  await avviaApp({ app: 'giu-open', failOpen: true });
  const r = await richiesta('/api/dati', { cookie: 'sid=chiunque-giu-2' });
  assert.equal(r.status, 200);
  assert.equal(r.body, 'APP');
});
