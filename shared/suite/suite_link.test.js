// "><(((º> sabusabu <º)))><"
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const suite = require('./suite_link.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'suite-link-'));
const FILE_TOKEN = path.join(tmp, '.token');
const FILE_COMMESSE = path.join(tmp, 'commesse.json');

test('token: creato una volta, riletto, verificato', () => {
  delete process.env.SUITE_TOKEN;
  const t1 = suite.token(FILE_TOKEN);
  assert.ok(t1.length >= 32);
  assert.strictEqual(fs.readFileSync(FILE_TOKEN, 'utf8').trim(), t1);
  assert.strictEqual(suite.token(FILE_TOKEN), t1);
  assert.ok(suite.verifica(t1, FILE_TOKEN));
  assert.ok(!suite.verifica('altro', FILE_TOKEN));
  assert.ok(!suite.verifica(null, FILE_TOKEN));
});

test('normalizzaCommessa e urlPubblico', () => {
  assert.strictEqual(suite.normalizzaCommessa(' 101-003 '), '101-003');
  assert.strictEqual(suite.normalizzaCommessa('c-2026 014'), 'C-2026014');
  delete process.env.SUITE_DOMINIO;
  assert.strictEqual(suite.urlPubblico('ddt'), 'http://localhost:5050');
  // programma unico "DDT e Magazzino": il Magazzino si apre dentro il Lettore DDT
  assert.strictEqual(suite.urlPubblico('magazzino'), 'http://localhost:5050/magazzino');
  process.env.SUITE_DOMINIO = 'cosedil.it';
  assert.strictEqual(suite.urlPubblico('magazzino'), 'https://lettore-ddt.cosedil.it/magazzino');
  process.env.MAGAZZINO_PROGRAMMA_UNICO = '0';                      // Magazzino da solo: indirizzo proprio
  assert.strictEqual(suite.urlPubblico('magazzino'), 'https://magazzino-operativo.cosedil.it');
  delete process.env.MAGAZZINO_PROGRAMMA_UNICO;
  delete process.env.SUITE_DOMINIO;
});

test("link con l'host della richiesta: il cookie del portale vale per l'host, non per la porta", () => {
  delete process.env.SUITE_DOMINIO;
  // portale aperto come 127.0.0.1 o da un altro PC: il link prende quell'host, non "localhost"
  assert.strictEqual(suite.urlPubblico('incampo', '127.0.0.1:8080'), 'http://127.0.0.1:5190');
  assert.strictEqual(suite.urlPubblico('incampo', '192.168.1.5'), 'http://192.168.1.5:5190');
  assert.strictEqual(suite.urlPubblico('magazzino', '127.0.0.1'), 'http://127.0.0.1:5050/magazzino');
  assert.strictEqual(suite.urlPubblico('incampo', 'localhost:8080'), 'http://localhost:5190');
  assert.strictEqual(suite.urlPubblico('incampo'), 'http://localhost:5190');            // senza host: come prima
  assert.strictEqual(suite.conHostRichiesta('http://localhost:5200/#giacenze', '[::1]:8080'), 'http://[::1]:5200/#giacenze');
  // solo un host di loopback si cambia; un host strano non entra mai nel link
  assert.strictEqual(suite.conHostRichiesta('https://incampo.cosedil.it/x', '127.0.0.1'), 'https://incampo.cosedil.it/x');
  assert.strictEqual(suite.conHostRichiesta('http://localhost:5190', 'evil.com/<x>'), 'http://localhost:5190');
  assert.strictEqual(suite.conHostRichiesta('http://localhost:5190', ''), 'http://localhost:5190');
  assert.strictEqual(suite.hostDaRichiesta('Portale.Lan:8080'), 'portale.lan');
  process.env.SUITE_DOMINIO = 'cosedil.it';                                            // dietro Caddy: invariato
  assert.strictEqual(suite.urlPubblico('incampo', '127.0.0.1'), 'https://incampo.cosedil.it');
  delete process.env.SUITE_DOMINIO;
});

test('registro commesse: salva, unisce doppioni, rilegge, trova', () => {
  const out = suite.salvaCommesse([
    { code: '101-003', nome: 'Porto di Augusta', stato: 'attiva' },
    { codice: ' 101-003 ', cliente: 'Autorità portuale' },        // stesso codice (spazi attorno): si unisce
    { code: 'C-2026-014', nome: 'Scuola Messina', stato: 'chiusa' },
    { code: '', nome: 'senza codice' },
  ], { file: FILE_COMMESSE });
  assert.strictEqual(out.length, 2);
  assert.deepStrictEqual(out[0], { code: '101-003', nome: 'Porto di Augusta', stato: 'attiva', cliente: 'Autorità portuale', indirizzo: '', note: '' });
  assert.strictEqual(suite.commesse({ file: FILE_COMMESSE, soloAttive: true }).length, 1);
  assert.strictEqual(suite.trovaCommessa(' c-2026-014 ', { file: FILE_COMMESSE }).nome, 'Scuola Messina');
  assert.strictEqual(suite.trovaCommessa('999', { file: FILE_COMMESSE }), null);
  assert.deepStrictEqual(suite.commesse({ file: path.join(tmp, 'manca.json') }), []);
});

test('chiama: header, query, JSON, file nel corpo, errori', async () => {
  process.env.SUITE_TOKEN = 'token-di-prova';
  const ricevute = [];
  const server = http.createServer((req, res) => {
    let corpo = [];
    req.on('data', (c) => corpo.push(c));
    req.on('end', () => {
      corpo = Buffer.concat(corpo);
      ricevute.push({ url: req.url, method: req.method, headers: req.headers, corpo });
      if (req.url.startsWith('/api/suite/errore')) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ errore: 'Commessa non trovata' }));
      }
      if (req.url.startsWith('/api/suite/file')) {
        res.writeHead(200, { 'Content-Type': 'application/pdf' });
        return res.end(Buffer.from('%PDF-1.4'));
      }
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, n: corpo.length }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  process.env.SUITE_URL_MAGAZZINO = `http://127.0.0.1:${server.address().port}/api`;
  try {
    const r = await suite.chiama('magazzino', 'POST', '/suite/commesse/101-003/task',
      { dati: { titolo: 'Gru ferma' }, parametri: { q: 'a b', vuoto: '' }, utente: 'mrossi', nome: 'Mario Rossi', email: 'm@x.it' });
    assert.deepStrictEqual(r, { ok: true, n: JSON.stringify({ titolo: 'Gru ferma' }).length });
    const h = ricevute[0].headers;
    assert.strictEqual(ricevute[0].url, '/api/suite/commesse/101-003/task?q=a+b');
    assert.strictEqual(h['x-suite-token'], 'token-di-prova');
    assert.strictEqual(h['x-suite-utente'], 'mrossi');
    assert.strictEqual(h['x-suite-email'], 'm@x.it');
    assert.strictEqual(h['content-type'], 'application/json');

    await suite.chiama('magazzino', 'POST', '/suite/doc', { corpoFile: { dati: Buffer.from('ciao'), tipo: 'text/plain', nome: 'nota è.txt' } });
    assert.strictEqual(ricevute[1].headers['x-suite-nome-file'], encodeURIComponent('nota è.txt'));
    assert.strictEqual(ricevute[1].corpo.toString(), 'ciao');

    const f = await suite.chiama('magazzino', 'GET', '/suite/file', { grezzo: true });
    assert.strictEqual(f.tipo, 'application/pdf');
    assert.strictEqual(f.dati.toString(), '%PDF-1.4');

    await assert.rejects(suite.chiama('magazzino', 'GET', '/suite/errore'), (e) => e instanceof suite.SuiteError && e.stato === 404 && e.messaggio === 'Commessa non trovata');
  } finally {
    server.close();
  }
  process.env.SUITE_URL_MAGAZZINO = 'http://127.0.0.1:1/api';
  await assert.rejects(suite.chiama('magazzino', 'GET', '/x', { timeout: 500 }), (e) => e.stato === 503 && /non raggiungibile/.test(e.messaggio));
  assert.strictEqual(await suite.raggiungibile('magazzino', 300), false);
  delete process.env.SUITE_URL_MAGAZZINO;
  delete process.env.SUITE_TOKEN;
});
