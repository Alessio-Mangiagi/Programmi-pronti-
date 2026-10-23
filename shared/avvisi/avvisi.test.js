// Test di shared/avvisi. Zero dipendenze: node --test shared/avvisi
// "><(((º> sabusabu <º)))><"
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'avvisi-test-'));
process.env.SUITE_AVVISI_DIR = DIR;
test.after(() => fs.rmSync(DIR, { recursive: true, force: true }));

const avvisi = require('./avvisi.js');

function presi() {
  const out = fs.readdirSync(DIR).sort().map((n) => JSON.parse(fs.readFileSync(path.join(DIR, n), 'utf8')));
  for (const n of fs.readdirSync(DIR)) fs.unlinkSync(path.join(DIR, n));
  return out;
}

test('segnala: file JSON completo, livello sconosciuto = attenzione', () => {
  presi();
  assert.equal(avvisi.segnala({ app: 'ddt', titolo: 'Ciao', livello: 'boh' }), true);
  assert.equal(avvisi.segnala({ app: 'ddt' }), false);
  const [a] = presi();
  assert.deepEqual([a.app, a.titolo, a.livello, a.testo], ['ddt', 'Ciao', 'attenzione', '']);
  assert.ok(!Number.isNaN(Date.parse(a.data)));
});

test('chiaveDaMessaggio: numeri e percorsi non separano lo stesso errore', () => {
  assert.equal(avvisi.chiaveDaMessaggio(String.raw`Job 12 fallito su C:\dati\a.pdf`), avvisi.chiaveDaMessaggio(String.raw`Job 7 fallito su C:\x\b.pdf`));
  assert.equal(avvisi.chiaveDaMessaggio('Lettura /srv/dati/x.json\nstack'), 'log:Lettura <percorso>');
});

test('segnalaErrore: freno anti-raffica sullo stesso errore', () => {
  presi();
  assert.equal(avvisi.segnalaErrore('ocr', 'OCR 1 fallito'), true);
  assert.equal(avvisi.segnalaErrore('ocr', 'OCR 2 fallito'), false);
  assert.equal(avvisi.segnalaErrore('ocr', 'Altro errore'), true);
  assert.equal(presi().length, 2);
});

test('intercettaConsole: console.error scrive ancora e lascia un avviso', () => {
  presi();
  const prima = console.error;
  const righe = [];
  console.error = (...a) => righe.push(a.join(' '));
  try {
    avvisi.intercettaConsole('auguri');
    avvisi.intercettaConsole('auguri');   // idempotente
    console.error('Invio WhatsApp non riuscito:', new Error('sessione scaduta'));
  } finally { console.error = prima; }
  assert.equal(righe.length, 1);
  const [a] = presi();
  assert.equal(a.app, 'auguri');
  assert.match(a.titolo, /Invio WhatsApp non riuscito: sessione scaduta/);
  assert.match(a.testo, /Error: sessione scaduta/);
});

test('trasportoWinston: inoltra il messaggio e chiama la callback', async () => {
  presi();
  class Transport extends require('node:events') { constructor(o) { super(); this.level = o.level; } }
  const t = avvisi.trasportoWinston({ Transport }, 'ddt');
  assert.equal(t.level, 'error');
  await new Promise((ok) => t.log({ level: 'error', message: 'Giro di sorveglianza fallito: EACCES' }, ok));
  const [a] = presi();
  assert.deepEqual([a.app, a.livello], ['ddt', 'errore']);
});
