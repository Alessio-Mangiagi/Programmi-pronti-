// "><(((º> sabusabu <º)))><"
// Test del mini server di Timbri per VFP (node --test, nessuna dipendenza).
// Il gate SSO vero chiederebbe al portale: qui lo si sostituisce con un gate
// che lascia passare o che blocca, per controllare che la pagina passi da lì
// e che fuori dall'elenco FILE non esca niente.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { creaServer } = require('./server.js');

const passa = (req, res, next) => next();
const blocca = (req, res) => { res.writeHead(302, { Location: 'http://portale/' }); res.end(); };

// Avvia il server su una porta libera, fa una richiesta, chiude.
async function chiedi(gate, percorso, metodo = 'GET') {
  const server = creaServer({ gate, attivita: passa });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}${percorso}`, { method: metodo, redirect: 'manual' });
    return { status: r.status, tipo: r.headers.get('content-type') || '', csp: r.headers.get('content-security-policy') || '', corpo: await r.text() };
  } finally {
    server.close();
  }
}

test('la pagina si apre quando il gate lascia passare', async () => {
  const r = await chiedi(passa, '/');
  assert.equal(r.status, 200);
  assert.match(r.tipo, /text\/html/);
  assert.match(r.corpo, /stamp\.js/);
  assert.match(r.csp, /script-src 'self'/);
});

test('senza login il gate decide: la pagina non esce', async () => {
  const r = await chiedi(blocca, '/');
  assert.equal(r.status, 302);
});

test('gli script della pagina sono serviti col tipo giusto', async () => {
  const r = await chiedi(passa, '/stamp.js');
  assert.equal(r.status, 200);
  assert.match(r.tipo, /javascript/);
});

test('fuori elenco niente: server.js, timbro.js e percorsi con .. danno 404', async () => {
  for (const p of ['/server.js', '/timbro.js', '/README.md', '/../server.js', '/%2e%2e/server.js']) {
    assert.equal((await chiedi(passa, p)).status, 404, p);
  }
});

test('solo lettura: POST rifiutato con 405', async () => {
  assert.equal((await chiedi(passa, '/', 'POST')).status, 405);
});

test('/health risponde anche senza login', async () => {
  const r = await chiedi(blocca, '/health');
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.corpo), { ok: true, app: 'timbri' });
});
