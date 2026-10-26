// "><(((º> sabusabu <º)))><"
// Test di presenza ed eventi verso il portale (node --test, zero dipendenze).
//
// Il "portale" è un finto server che si annota ogni POST ricevuto. L'app è un
// mini-server Node con cosedilAttivita montato davanti a un handler finto.
// COSEDIL_* vanno impostate PRIMA del require del modulo.
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

process.env.COSEDIL_SSO = 'on';

let fintoPortale;
let ricevuti = [];
let appServer;
let appPort;
let sso;

function ascolta(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function chiama(metodo, percorso, cookie, corpo) {
  return new Promise((resolve, reject) => {
    const r = http.request({
      host: '127.0.0.1', port: appPort, path: percorso, method: metodo,
      headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}),
    }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    r.on('error', reject);
    r.end(corpo ? JSON.stringify(corpo) : undefined);
  });
}

// I segnali partono fire-and-forget: si aspetta che il finto portale li veda.
async function attendi(cond, ms = 2000) {
  const fine = Date.now() + ms;
  while (Date.now() < fine) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
}

before(async () => {
  fintoPortale = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      ricevuti.push({ path: req.url, cookie: req.headers.cookie, header: req.headers['x-cosedil-app'], corpo: JSON.parse(b || '{}') });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  process.env.COSEDIL_EVENTI = 'http://127.0.0.1:' + (await ascolta(fintoPortale));
  sso = require('./cosedil-sso.js');

  const mw = sso.cosedilAttivita({
    app: 'ddt',
    eventi: [
      { metodo: 'POST', percorso: '/converti', azione: 'DDT convertito', dettaglio: (req) => req.body.file },
      { metodo: 'DELETE', percorso: /^\/versioni\/[^/]+$/, azione: 'Versione eliminata' },
    ],
  });
  appServer = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      req.body = b ? JSON.parse(b) : {};
      mw(req, res, () => {
        res.statusCode = req.url.includes('errore') ? 500 : 200;
        res.end('ok');
      });
    });
  });
  appPort = await ascolta(appServer);
});

after(() => { fintoPortale.close(); appServer.close(); });

test('presenza: un segnale al minuto per utente e app, col cookie del browser', async () => {
  ricevuti = [];
  await chiama('POST', '/ping', 'sid=aaa; connect.sid=x');
  await chiama('POST', '/ping', 'sid=aaa; connect.sid=x');
  await attendi(() => ricevuti.length >= 1);
  await new Promise((r) => setTimeout(r, 100));
  const pres = ricevuti.filter((r) => r.path === '/api/presenza');
  assert.equal(pres.length, 1);
  assert.equal(pres[0].corpo.appId, 'ddt');
  assert.equal(pres[0].header, 'ddt');
  assert.match(pres[0].cookie, /sid=aaa/);
});

test('presenza: senza cookie del portale non parte niente', async () => {
  ricevuti = [];
  await chiama('POST', '/ping', 'connect.sid=x');
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(ricevuti.length, 0);
});

test('presenza: throttle per sid, ripartenza dopo un minuto', () => {
  const t0 = 1_000_000;
  assert.equal(sso.segnalaPresenza('sid=bbb', 'ocr', t0), true);
  assert.equal(sso.segnalaPresenza('sid=bbb', 'ocr', t0 + 30_000), false);
  assert.equal(sso.segnalaPresenza('sid=bbb', 'agente', t0 + 30_000), true);   // altra app
  assert.equal(sso.segnalaPresenza('sid=bbb', 'ocr', t0 + 61_000), true);
});

test('evento: rotta elencata e andata a buon fine finisce nel registro col dettaglio', async () => {
  ricevuti = [];
  await chiama('POST', '/converti', 'sid=ccc', { file: 'bolla-123.pdf' });
  await attendi(() => ricevuti.some((r) => r.path === '/api/evento'));
  const ev = ricevuti.find((r) => r.path === '/api/evento');
  assert.deepEqual(ev.corpo, { appId: 'ddt', azione: 'DDT convertito', dettaglio: 'bolla-123.pdf' });
  assert.equal(ev.header, 'ddt');
});

test('evento: percorso RegExp e metodo diverso da POST', async () => {
  ricevuti = [];
  await chiama('DELETE', '/versioni/abc', 'sid=ddd');
  await attendi(() => ricevuti.some((r) => r.path === '/api/evento'));
  assert.equal(ricevuti.find((r) => r.path === '/api/evento').corpo.azione, 'Versione eliminata');
});

test('evento: risposta in errore o rotta non elencata non registra niente', async () => {
  ricevuti = [];
  await chiama('POST', '/converti?errore=1', 'sid=eee', { file: 'x.pdf' });
  await chiama('POST', '/altro', 'sid=eee');
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(ricevuti.filter((r) => r.path === '/api/evento').length, 0);
});
