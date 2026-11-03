// "><(((º> sabusabu <º)))><"
// Documenti da SkyTower: le rotte /api/skytower/* e /api/lavori/da-skytower con
// un SkyTower finto (dipendenze sostituite), fino al lavoro pronto.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { creaPdf } from './aiuti.js';

const CARTELLA = fs.mkdtempSync(path.join(os.tmpdir(), 'trimble-sky-test-'));
process.env.COSEDIL_SSO = 'off';
process.env.DATA_DIR = CARTELLA;
process.env.TRIMBLE_CLIENT_ID = '';
process.env.TRIMBLE_CLIENT_SECRET = '';

const { app } = await import('../server.js');
const { dipendenze } = await import('../src/rotte/skytower.js');

const server = app.listen(0, '127.0.0.1');
await new Promise((ok) => server.once('listening', ok));
const base = 'http://127.0.0.1:' + server.address().port;

test.after(() => {
  server.close();
  fs.rmSync(CARTELLA, { recursive: true, force: true });
});

const PDF = creaPdf([
  'Commessa: CS-2024-118 Ampliamento capannone',
  '01.02.003 Scavo di sbancamento in terreno naturale mc 120,50 15,30 1.843,65',
  'TOTALE 1.843,65',
]);
const REV = '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90';
const chiamate = [];

dipendenze.commesse = () => [{ code: '101-003', nome: 'Porto di Augusta', stato: 'attiva' }, { code: '102-001', nome: 'Scuola', stato: 'attiva' }];
dipendenze.chiama = async (appId, metodo, percorso, opz = {}) => {
  chiamate.push({ appId, metodo, percorso, opz });
  if (percorso === '/suite/commesse') return [{ commessa: '101-003', name: 'Porto (SkyTower)' }, { commessa: 'C-9', name: 'Solo in SkyTower' }];
  if (percorso.startsWith('/suite/commesse/') && percorso.endsWith('/documenti')) {
    return { items: [
      { id: 'd1', revision_id: REV, identifier: 'PRJ-COS-ZZ-01-RP-Z-0001', title: 'Computo', revision_code: 'C01', filename: 'computo.pdf', content_type: 'application/pdf', size_bytes: PDF.length },
      { id: 'd2', revision_id: 'x', identifier: 'PRJ-COS-ZZ-01-DR-A-0002', title: 'Tavola', revision_code: 'C01', filename: 'tavola.dwg', content_type: 'application/octet-stream', size_bytes: 10 },
    ] };
  }
  if (percorso === '/suite/revisioni/' + REV + '/file') return { dati: PDF, tipo: 'application/pdf' };
  if (percorso.startsWith('/suite/revisioni/')) {
    const e = new Error('non trovata'); e.stato = 404; e.messaggio = 'Revisione non trovata'; throw e;
  }
  throw new Error('percorso inatteso ' + percorso);
};

async function attendiEsito(id, scadenzaMs = 30000) {
  const limite = Date.now() + scadenzaMs;
  while (Date.now() < limite) {
    const { lavoro } = await (await fetch(base + '/api/lavori/' + id)).json();
    if (lavoro.stato === 'pronto' || lavoro.stato === 'errore') return lavoro;
    await new Promise((ok) => setTimeout(ok, 150));
  }
  throw new Error('timeout');
}

test('commesse: registro unito a quelle di SkyTower', async () => {
  const dati = await (await fetch(base + '/api/skytower/commesse')).json();
  assert.deepEqual(dati.commesse.map((c) => [c.code, c.skytower, c.fonte]), [['101-003', true, 'registro'], ['102-001', false, 'registro'], ['C-9', true, 'skytower']]);
  assert.equal(dati.commesse[0].nome, 'Porto di Augusta');     // il nome del registro vince
  assert.equal(dati.avviso, '');
});

test('commesse: SkyTower spenta -> solo registro con avviso', async () => {
  const vera = dipendenze.chiama;
  dipendenze.chiama = async () => { const e = new Error('giu'); e.stato = 503; e.messaggio = 'SkyTower non raggiungibile'; throw e; };
  try {
    const dati = await (await fetch(base + '/api/skytower/commesse')).json();
    assert.equal(dati.commesse.length, 2);
    assert.match(dati.avviso, /non raggiungibile/);
  } finally {
    dipendenze.chiama = vera;
  }
});

test('documenti: elenco pubblicato con flag pdf, commessa codificata nel percorso', async () => {
  const res = await fetch(base + '/api/skytower/documenti?commessa=101-003%20SEDE&q=comp');
  assert.equal(res.status, 200);
  const dati = await res.json();
  assert.deepEqual(dati.documenti.map((d) => [d.identifier, d.pdf]), [['PRJ-COS-ZZ-01-RP-Z-0001', true], ['PRJ-COS-ZZ-01-DR-A-0002', false]]);
  const ultima = chiamate.at(-1);
  assert.equal(ultima.percorso, '/suite/commesse/101-003%20SEDE/documenti');
  assert.deepEqual(ultima.opz.parametri, { area: 'PUBLISHED', q: 'comp', limit: 100 });
  assert.equal((await fetch(base + '/api/skytower/documenti')).status, 400);
});

test('da-skytower: i byte della revisione diventano un lavoro pronto', async () => {
  const res = await fetch(base + '/api/lavori/da-skytower', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision_id: REV, filename: 'computo.pdf', revision_code: 'C01', identifier: 'PRJ-COS-ZZ-01-RP-Z-0001', traduttore: 'pcq-econ', formato: 'xlsx' }),
  });
  assert.equal(res.status, 202);
  const { lavoro } = await res.json();
  assert.equal(lavoro.stato, 'in_coda');
  assert.equal(lavoro.nomeFile, 'computo.pdf');
  assert.equal(lavoro.skytower.revision_id, REV);
  const fine = await attendiEsito(lavoro.id);
  assert.equal(fine.stato, 'pronto', fine.errore || '');
  assert.equal(fine.risultato.righe, 1);
  assert.equal(chiamate.at(-1).opz.grezzo, true);
});

test('da-skytower: revisione inesistente e corpo incompleto', async () => {
  const r1 = await fetch(base + '/api/lavori/da-skytower', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision_id: '00000000-0000-0000-0000-000000000000', traduttore: 'pcq-econ', formato: 'xlsx' }) });
  assert.equal(r1.status, 404);
  assert.match((await r1.json()).errore, /non trovata/);
  const r2 = await fetch(base + '/api/lavori/da-skytower', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
  assert.equal(r2.status, 400);
});
