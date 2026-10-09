// Test degli indirizzi a sottodominio (SUITE_DOMINIO), separati da server.test.js
// perche' il portale legge SUITE_DOMINIO una volta sola al caricamento: qui va
// impostata PRIMA del require, e node --test gira ogni file in un processo suo.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DATA_TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'portale-dominio-'));
process.env.DATA_DIR = DATA_TMP;
process.env.SUITE_DOMINIO = 'esempio.lan';
delete process.env.SUITE_SCHEMA;
delete process.env.TRUST_PROXY;
test.after(() => fs.rmSync(DATA_TMP, { recursive: true, force: true }));

const { appUrl, isSuiteOrigin, clientIp, COOKIE_FLAGS, sottodominio, APPS } = require('./server.js');

const reqCon = (host) => ({ headers: { host } });
const app = (id) => APPS.find((a) => a.id === id);

test('dominio: ogni app ha un sottodominio = nome della cartella', () => {
  for (const a of APPS) {
    assert.equal(sottodominio(a), a.dir, `${a.id}: cartella "${a.dir}" non valida come sottodominio`);
  }
  // "><(((º> sabusabu <º)))><"
  assert.equal(sottodominio({ dir: 'Progetto chat' }), null);
  assert.equal(sottodominio({ dir: "whatss'app" }), null);
  assert.equal(sottodominio({}), null);
});

test('dominio: appUrl punta al sottodominio in https, qualunque sia l\'Host', () => {
  assert.equal(appUrl(reqCon('portale.esempio.lan'), app('ddt')), 'https://lettore-ddt.esempio.lan');
  assert.equal(appUrl(reqCon('192.168.1.5:8080'), app('scadenzario')), 'https://scadenzario.esempio.lan');
  // App senza cartella valida: si ripiega su host:porta.
  assert.equal(appUrl(reqCon('srv:8080'), { porta: 4000, dir: 'Nome Con Spazi' }), 'http://srv:4000');
});

test('dominio: CORS solo per portale e app del registro, sullo schema giusto', () => {
  const req = reqCon('portale.esempio.lan');
  assert.ok(isSuiteOrigin('https://portale.esempio.lan', req));
  assert.ok(isSuiteOrigin('https://lettore-ddt.esempio.lan', req));
  assert.ok(isSuiteOrigin('https://SCADENZARIO.esempio.lan', req));
  assert.ok(!isSuiteOrigin('https://altro.esempio.lan', req), 'sottodominio estraneo');
  assert.ok(!isSuiteOrigin('http://scadenzario.esempio.lan', req), 'schema diverso');
  assert.ok(!isSuiteOrigin('https://scadenzario.esempio.lan:8443', req), 'porta esplicita');
  assert.ok(!isSuiteOrigin('https://scadenzario.esempio.lan.attacco.com', req));
  assert.ok(!isSuiteOrigin('https://esempio.lan', req));
});

test('dominio: cookie emesso per tutto il dominio e Secure', () => {
  assert.match(COOKIE_FLAGS, /; Domain=esempio\.lan(;|$)/);
  assert.match(COOKIE_FLAGS, /; Secure(;|$)/);
  assert.match(COOKIE_FLAGS, /HttpOnly/);
});

test('dominio: X-Forwarded-For creduto solo se la connessione arriva dal proxy locale', () => {
  const xff = { 'x-forwarded-for': '192.168.1.40' };
  assert.equal(clientIp({ headers: xff, socket: { remoteAddress: '127.0.0.1' } }), '192.168.1.40');
  assert.equal(clientIp({ headers: xff, socket: { remoteAddress: '::1' } }), '192.168.1.40');
  assert.equal(clientIp({ headers: xff, socket: { remoteAddress: '::ffff:127.0.0.1' } }), '192.168.1.40');
  // Da un altro PC l'header e' falsificabile: vale l'IP vero della connessione.
  assert.equal(clientIp({ headers: xff, socket: { remoteAddress: '192.168.1.66' } }), '192.168.1.66');
  // Dal proxy ma senza header: resta il loopback.
  assert.equal(clientIp({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }), '127.0.0.1');
});

test('Caddyfile: un blocco per ogni app del registro, con la sua porta', () => {
  const testo = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'Caddyfile'), 'utf8');
  // Anche i blocchi commentati (Auguri resta su un PC in ufficio) devono essere giusti.
  const righe = testo.split(/\r?\n/).map((r) => r.replace(/^#\s?/, ''));
  const blocchi = new Map();
  for (let i = 0; i < righe.length; i++) {
    const m = /^([a-z0-9-]+)\.\{\$SUITE_DOMINIO\}\s*\{/.exec(righe[i].trim());
    if (!m) continue;
    for (let j = i + 1; j < righe.length && !/^\}/.test(righe[j].trim()); j++) {
      const p = /reverse_proxy\s+127\.0\.0\.1:(\d+)/.exec(righe[j]);
      if (p) { blocchi.set(m[1], Number(p[1])); break; }
    }
  }
  assert.equal(blocchi.get('portale'), 8080, 'portale');
  for (const a of APPS) {
    assert.equal(blocchi.get(sottodominio(a)), a.porta, `${a.dir}: porta nel Caddyfile diversa dal registro`);
  }
  assert.equal(blocchi.size, APPS.length + 1, 'blocchi in piu\' o in meno rispetto al registro');
});
