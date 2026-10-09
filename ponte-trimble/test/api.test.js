// API end-to-end: server vero, porta effimera, cartella dati usa e getta.
// SSO spento e Trimble senza credenziali: qui si verifica il telaio, non il tenant.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { creaPdf } from './aiuti.js';

const CARTELLA = fs.mkdtempSync(path.join(os.tmpdir(), 'traduttore-test-'));
process.env.COSEDIL_SSO = 'off';
process.env.DATA_DIR = CARTELLA;
process.env.TRIMBLE_CLIENT_ID = '';
process.env.TRIMBLE_CLIENT_SECRET = '';

const { app } = await import('../server.js');

const server = app.listen(0, '127.0.0.1');
await new Promise((ok) => server.once('listening', ok));
const base = 'http://127.0.0.1:' + server.address().port;

test.after(() => {
  server.close();
  fs.rmSync(CARTELLA, { recursive: true, force: true });
});

const VOCI = [
  'Commessa: CS-2024-118 Ampliamento capannone',
  '01.02.003 Scavo di sbancamento in terreno naturale mc 120,50 15,30 1.843,65',
  'TOTALE 1.843,65',
];

async function inviaPdf({ nome = 'sal.pdf', tipo = 'application/pdf', formato = 'xlsx', contenuto = creaPdf(VOCI) } = {}) {
  const modulo = new FormData();
  modulo.set('pdf', new Blob([contenuto], { type: tipo }), nome);
  modulo.set('formato', formato);
  modulo.set('traduttore', 'pcq-econ');
  const res = await fetch(base + '/api/lavori', { method: 'POST', body: modulo });
  return { res, corpo: await res.json() };
}

/** Il lavoro gira in coda: si aspetta che esca da in_coda/in_corso. */
async function attendiEsito(id, scadenzaMs = 30000) {
  const limite = Date.now() + scadenzaMs;
  while (Date.now() < limite) {
    const { lavoro } = await (await fetch(base + '/api/lavori/' + id)).json();
    if (lavoro.stato === 'pronto' || lavoro.stato === 'errore') return lavoro;
    await new Promise((ok) => setTimeout(ok, 150));
  }
  throw new Error('timeout: il lavoro ' + id + ' non e arrivato a fine pipeline');
}

test('GET /api/salute risponde con lo stato del servizio', async () => {
  const res = await fetch(base + '/api/salute');
  assert.equal(res.status, 200);
  const dati = await res.json();
  assert.equal(dati.ok, true);
  assert.equal(dati.trimble.configurato, false);
  assert.equal(dati.destinazione.nome, 'fieldview');       // destinazione predefinita
  assert.equal(dati.destinazione.configurata, false);      // niente token: nessuna chiamata esce
});

test('traduttori e formati sono elencati dalle API', async () => {
  const t = await (await fetch(base + '/api/traduttori')).json();
  const f = await (await fetch(base + '/api/formati')).json();
  assert.ok(t.traduttori.some((x) => x.nome === 'pcq-econ'));
  assert.deepEqual(f.formati.map((x) => x.nome).sort(), ['csv', 'fieldview', 'json', 'xlsx']);
  assert.deepEqual(t.errori, []);            // nessun traduttore scartato dal registro
});

test('PDF -> lavoro pronto -> artefatto scaricabile', async () => {
  const { res, corpo } = await inviaPdf();
  assert.equal(res.status, 202);
  assert.equal(corpo.lavoro.stato, 'in_coda');

  const lavoro = await attendiEsito(corpo.lavoro.id);
  assert.equal(lavoro.stato, 'pronto', lavoro.errore || '');
  assert.equal(lavoro.risultato.righe, 1);
  assert.equal(lavoro.risultato.nome, 'sal__pcq-econ.xlsx');
  assert.deepEqual(lavoro.passi.map((p) => p.stato), ['ok', 'ok', 'ok']);

  const file = await fetch(base + '/api/lavori/' + lavoro.id + '/artefatto');
  assert.equal(file.status, 200);
  assert.match(file.headers.get('content-type'), /spreadsheetml/);
  assert.ok((await file.arrayBuffer()).byteLength > 0);

  const estratto = await (await fetch(base + '/api/lavori/' + lavoro.id + '/estratto')).json();
  assert.equal(estratto.pagine.length, 1);
});

test('senza credenziali la consegna risponde 503, non 500', async () => {
  const { corpo } = await inviaPdf({ nome: 'altro.pdf', formato: 'csv' });
  await attendiEsito(corpo.lavoro.id);
  const res = await fetch(base + '/api/lavori/' + corpo.lavoro.id + '/carica', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(res.status, 503);
  assert.match((await res.json()).errore, /destinazione "fieldview" non configurata/);
});

test('piu PDF trascinati insieme: un lavoro per file, una sola richiesta', async () => {
  // "><(((º> sabusabu <º)))><"
  const modulo = new FormData();
  for (const nome of ['pcq-1.pdf', 'pcq-2.pdf', 'pcq-3.pdf']) {
    modulo.append('pdf', new Blob([creaPdf(VOCI)], { type: 'application/pdf' }), nome);
  }
  modulo.set('traduttore', 'pcq-econ');
  modulo.set('formato', 'json');

  const res = await fetch(base + '/api/lavori', { method: 'POST', body: modulo });
  assert.equal(res.status, 202);
  const corpo = await res.json();

  assert.equal(corpo.lavori.length, 3);
  assert.deepEqual(corpo.lavori.map((l) => l.nomeFile), ['pcq-1.pdf', 'pcq-2.pdf', 'pcq-3.pdf']);
  assert.equal(corpo.lavoro.id, corpo.lavori[0].id);          // compatibilita' con l'invio singolo
  assert.equal(new Set(corpo.lavori.map((l) => l.id)).size, 3);

  for (const l of corpo.lavori) {
    const finito = await attendiEsito(l.id);
    assert.equal(finito.stato, 'pronto', finito.errore || '');
  }
});

test('anteprima: i record sono serviti a parte, anche con un formato binario', async () => {
  const { corpo } = await inviaPdf({ nome: 'anteprima.pdf', formato: 'xlsx' });
  const lavoro = await attendiEsito(corpo.lavoro.id);
  assert.equal(lavoro.stato, 'pronto', lavoro.errore || '');

  const dati = await (await fetch(base + '/api/lavori/' + lavoro.id + '/record')).json();
  assert.equal(dati.record.length, 1);
  assert.equal(dati.record[0].codice, '01.02.003');
  assert.ok(dati.colonne.some((c) => c.chiave === 'importo'));

  // Pagine totali e pagine senza testo: e' la spiegazione di "zero righe".
  assert.deepEqual(lavoro.origine, { pagine: 1, senzaTesto: 0 });
});

test('rielabora: riusa il PDF archiviato e crea un lavoro nuovo', async () => {
  const { corpo } = await inviaPdf({ nome: 'da-rielaborare.pdf', formato: 'csv' });
  const primo = await attendiEsito(corpo.lavoro.id);

  const res = await fetch(base + '/api/lavori/' + primo.id + '/rielabora', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ traduttore: 'grezzo', formato: 'json' }),
  });
  assert.equal(res.status, 202);
  const { lavoro } = await res.json();

  assert.notEqual(lavoro.id, primo.id);
  assert.equal(lavoro.nomeFile, 'da-rielaborare.pdf');
  assert.equal(lavoro.traduttore, 'grezzo');
  assert.equal(lavoro.rielaboraDa, primo.id);

  const secondo = await attendiEsito(lavoro.id);
  assert.equal(secondo.stato, 'pronto', secondo.errore || '');
  assert.equal(secondo.risultato.righe, 3);          // "grezzo": una riga per riga di testo
});

test('rielabora con traduttore inesistente: 400, e il lavoro originale resta', async () => {
  const { corpo } = await inviaPdf({ nome: 'intatto.pdf' });
  await attendiEsito(corpo.lavoro.id);

  const res = await fetch(base + '/api/lavori/' + corpo.lavoro.id + '/rielabora', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ traduttore: 'inventato' }),
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).errore, /traduttore sconosciuto/);
  assert.equal((await (await fetch(base + '/api/lavori/' + corpo.lavoro.id)).json()).lavoro.stato, 'pronto');
});

test('elimina: sparisce il lavoro e tutto quello che ha prodotto', async () => {
  const { corpo } = await inviaPdf({ nome: 'da-eliminare.pdf' });
  await attendiEsito(corpo.lavoro.id);

  const res = await fetch(base + '/api/lavori/' + corpo.lavoro.id, { method: 'DELETE' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).eliminato, corpo.lavoro.id);

  assert.equal((await fetch(base + '/api/lavori/' + corpo.lavoro.id)).status, 404);
  assert.equal((await fetch(base + '/api/lavori/' + corpo.lavoro.id, { method: 'DELETE' })).status, 404);
  assert.equal(fs.existsSync(path.join(CARTELLA, 'lavori', corpo.lavoro.id)), false);
});

test('formato e traduttore incompatibili: lavoro in errore con il motivo in chiaro', async () => {
  // "fieldview" vuole i record dei PCQ (pos + controllo): con il traduttore dei
  // computi non puo' funzionare, e deve dirlo invece di produrre un file vuoto.
  const { corpo } = await inviaPdf({ nome: 'incompatibile.pdf', formato: 'fieldview' });
  const lavoro = await attendiEsito(corpo.lavoro.id);

  assert.equal(lavoro.stato, 'errore');
  assert.match(lavoro.errore, /vuole record con i campi "pos" e "controllo"/);
  assert.deepEqual(lavoro.passi.map((p) => p.stato), ['ok', 'ok', 'errore']);
});

test('file non PDF rifiutato', async () => {
  const { res, corpo } = await inviaPdf({ nome: 'note.txt', tipo: 'text/plain', contenuto: Buffer.from('ciao') });
  assert.equal(res.status, 400);
  assert.match(corpo.errore, /solo file PDF/);
});

test('parametri sbagliati e id inesistenti danno errori parlanti', async () => {
  const { res, corpo } = await inviaPdf({ formato: 'docx' });
  assert.equal(res.status, 400);
  assert.match(corpo.errore, /formato sconosciuto/);

  const mancante = await fetch(base + '/api/lavori/20240101000000-aaaaaa');
  assert.equal(mancante.status, 404);

  const rotta = await fetch(base + '/api/non-esiste');
  assert.equal(rotta.status, 404);
});

test('un PDF illeggibile finisce in stato errore, non fa cadere il server', async () => {
  const { corpo } = await inviaPdf({ nome: 'rotto.pdf', contenuto: Buffer.from('%PDF-1.4 spazzatura') });
  const lavoro = await attendiEsito(corpo.lavoro.id);
  assert.equal(lavoro.stato, 'errore');
  assert.ok(lavoro.errore);
  assert.equal((await (await fetch(base + '/api/lavori/' + lavoro.id + '/artefatto')).json()).errore.includes('errore'), true);
});
