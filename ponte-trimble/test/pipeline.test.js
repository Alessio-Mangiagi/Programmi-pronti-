import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { estrai, raggruppaInRighe } from '../src/pipeline/estrai.js';
import { traduci, numero } from '../src/pipeline/traduci.js';
import { rendi, nomeArtefatto } from '../src/pipeline/rendi.js';
import { creaPdf, estrattoFinto } from './aiuti.js';

const VOCI = [
  'Commessa: CS-2024-118 Ampliamento capannone',
  'SAL n. 3 del 12/03/2024',
  'Codice Descrizione UM Quantita Prezzo Importo',
  '01.02.003 Scavo di sbancamento in terreno naturale mc 120,50 15,30 1.843,65',
  '01.02.004 Rinterro con materiale di risulta mc 42,00 9,50 399,00',
  'TOTALE 2.242,65',
];

test('numero legge il formato italiano', () => {
  assert.equal(numero('1.843,65'), 1843.65);
  assert.equal(numero('120,50'), 120.5);
  assert.equal(numero('42'), 42);
  assert.equal(numero('mc'), null);
  assert.equal(numero(''), null);
});

test('raggruppaInRighe mette sulla stessa riga gli elementi con y vicina', () => {
  const righe = raggruppaInRighe([
    { testo: 'destra', x: 300, y: 700.4 },
    { testo: 'sinistra', x: 50, y: 700 },
    { testo: 'sotto', x: 50, y: 680 },
  ]);
  assert.equal(righe.length, 2);
  assert.equal(righe[0].testo, 'sinistra destra');
  assert.equal(righe[1].testo, 'sotto');
});

test('pcq-econ estrae voci, intestazione e quadratura', async () => {
  const esito = await traduci('pcq-econ', estrattoFinto(VOCI));
  assert.equal(esito.record.length, 2);
  assert.deepEqual(esito.record[0], {
    codice: '01.02.003',
    descrizione: 'Scavo di sbancamento in terreno naturale',
    um: 'mc',
    quantita: 120.5,
    prezzo: 15.3,
    importo: 1843.65,
    pagina: 1,
  });
  assert.equal(esito.intestazione.sal, '3');
  assert.equal(esito.intestazione.totaleDichiarato, 2242.65);
  assert.deepEqual(esito.avvisi, []);
});

test('pcq-econ segnala il totale che non quadra', async () => {
  const righe = [...VOCI.slice(0, 5), 'TOTALE 9.999,00'];
  const esito = await traduci('pcq-econ', estrattoFinto(righe));
  assert.match(esito.avvisi.join(' '), /quadratura/);
});

test('pcq-econ avvisa quando non riconosce nessuna voce', async () => {
  const esito = await traduci('pcq-econ', estrattoFinto(['pagina senza voci', 'solo testo']));
  assert.equal(esito.record.length, 0);
  assert.match(esito.avvisi.join(' '), /nessuna voce riconosciuta/);
});

test('traduttore grezzo restituisce una riga per riga', async () => {
  const esito = await traduci('grezzo', estrattoFinto(VOCI));
  assert.equal(esito.record.length, VOCI.length);
  assert.equal(esito.record[0].testo, VOCI[0]);
});

test('traduttore sconosciuto -> errore parlante', async () => {
  await assert.rejects(() => traduci('inesistente', estrattoFinto([])), /traduttore sconosciuto/);
});

test('rendering csv, json e xlsx dello stesso contenuto', async () => {
  const tradotto = await traduci('pcq-econ', estrattoFinto(VOCI));
  const dati = { ...tradotto, meta: { origine: 'sal.pdf' } };

  const csv = rendi('csv', dati);
  const testoCsv = csv.contenuto.toString('utf8');
  assert.equal(csv.ext, 'csv');
  assert.match(testoCsv, /^﻿Codice;Descrizione;UM/);
  assert.match(testoCsv, /01\.02\.003;.*;mc;120,5;15,3;1843,65;1/);

  const json = JSON.parse(rendi('json', dati).contenuto.toString('utf8'));
  assert.equal(json.record.length, 2);
  assert.equal(json.intestazione.totaleCalcolato, 2242.65);

  const libro = XLSX.read(rendi('xlsx', dati).contenuto, { type: 'buffer' });
  // "><(((º> sabusabu <º)))><"
  assert.deepEqual(libro.SheetNames, ['Voci', 'Intestazione']);
  const foglio = XLSX.utils.sheet_to_json(libro.Sheets.Voci);
  assert.equal(foglio.length, 2);
  assert.equal(foglio[0].Importo, 1843.65);
});

test('formato sconosciuto -> errore parlante', () => {
  assert.throws(() => rendi('pdf', { record: [], colonne: [] }), /formato sconosciuto/);
});

test('nomeArtefatto ripulisce il nome del PDF', () => {
  assert.equal(nomeArtefatto('SAL 3 (def).pdf', 'pcq-econ', 'xlsx'), 'SAL 3 _def___pcq-econ.xlsx');
});

test('estrazione di un PDF con livello di testo', async () => {
  const estratto = await estrai(creaPdf(VOCI));
  assert.equal(estratto.meta.pagine, 1);
  const testi = estratto.pagine[0].righe.map((r) => r.testo);
  assert.deepEqual(testi, VOCI);
  assert.deepEqual(estratto.avvisi, []);
});

test('estrazione di un PDF senza testo -> avviso scansione', async () => {
  const estratto = await estrai(creaPdf(['x']));
  assert.match(estratto.avvisi.join(' '), /probabile scansione/);
});
