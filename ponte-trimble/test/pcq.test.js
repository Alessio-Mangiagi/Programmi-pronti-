// Traduttore dei PCQ: geometria presa dal modulo ANAS vero (177_125PCQ06PALI).
// Le insidie coperte qui sono quelle che il modulo reale ha davvero:
// intestazioni centrate, numero POS. centrato nel blocco, etichetta "Controlli"
// sopra la riga a cui appartiene, colonne APP/DL/AFF vuote accanto al testo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { estrai } from '../src/pipeline/estrai.js';
import { traduci } from '../src/pipeline/traduci.js';
import { clusterOrizzontali, bandeColonne, colonnaDi, blocchiVerticali } from '../src/pipeline/tabella.js';
import { raggruppaVoci, espandiTipologia } from '../src/pipeline/traduttori/pcq-controlli.js';
import { pcqDiProva, estrattoFinto } from './aiuti.js';

const pcq = async () => traduci('pcq-controlli', await estrai(pcqDiProva()));

test('pcq-controlli: legge intestazione, legenda e numero di controlli', async () => {
  const { intestazione, record, avvisi } = await pcq();
  assert.equal(intestazione.form, 'CLS');
  assert.equal(intestazione.revisione, 'A');
  assert.equal(intestazione.pagina, '1 di 2');
  assert.match(intestazione.opera, /^ITINERARIO RAGUSA-CATANIA/);
  assert.equal(intestazione.controlli, 2);
  assert.deepEqual(record.map((r) => r.pos), [1, 2]);
  assert.deepEqual(avvisi, []);
});

test('pcq-controlli: le colonne finiscono al posto giusto', async () => {
  const { record } = await pcq();
  const [uno, due] = record;

  assert.equal(uno.tipologia, 'D');
  assert.equal(uno.tipologia_estesa, 'Documentale');
  assert.equal(due.tipologia, 'C/D');
  assert.equal(due.tipologia_estesa, 'Certificato / Documentale');

  assert.deepEqual(uno.punti, ['Verifica presa in possesso area;', 'Verifica risoluzione interferenze;']);
  assert.deepEqual(uno.documenti_voci, ['Dichiarazione di immissione', 'Verbale Ultimazione Lavori']);
  assert.equal(due.controllo, 'Verifica esistenza dello studio preliminare di qualificazione');
  assert.deepEqual(due.documenti_voci, ['C.S.A.', 'Progetto Esecutivo']);
});

test('pcq-controlli: il riferimento non finisce nella colonna vuota accanto', async () => {
  const { record } = await pcq();
  assert.match(record[0].riferimento, /Controllo da eseguire preliminarmente SK-CLS da N 1 a N 4/);
  assert.equal(record[0].schede, 'SK-CLS');
  // "Controlli" sta sopra la riga del controllo 2: deve appartenere a quella cella.
  assert.match(record[1].riferimento, /^Controlli /);
  assert.equal(record.every((r) => r.fase_app === '' && r.finali_aff === ''), true);
});

test('pcq-controlli: PDF senza livello di testo -> avviso OCR, nessun record inventato', async () => {
  const esito = await traduci('pcq-controlli', {
    meta: { pagine: 1 },
    avvisi: ['pagina 1: nessun livello di testo (0 caratteri) — probabile scansione, serve OCR'],
    pagine: [{ numero: 1, larghezza: 842, altezza: 595, righe: [] }],
  });
  assert.equal(esito.record.length, 0);
  assert.match(esito.avvisi.join(' '), /serve OCR/);
  assert.match(esito.avvisi.join(' '), /se il PDF e' una scansione serve prima l'OCR/);
});

test('pcq-controlli: pagina con testo ma senza tabella -> lo dice invece di tacere', async () => {
  const esito = await traduci('pcq-controlli', estrattoFinto(['una pagina qualsiasi', 'senza tabella dei controlli']));
  assert.equal(esito.record.length, 0);
  assert.match(esito.avvisi.join(' '), /tabella dei controlli non riconosciuta/);
});

test('bandeColonne: la colonna con dati vince sulla stima di quella vuota', () => {
  const ancore = [{ id: 'aff', x: 560 }, { id: 'riferimento', x: 616 }];
  const cluster = clusterOrizzontali([
    { x: 586, larghezza: 40, testo: 'SK-CLS da' },
    { x: 634, larghezza: 30, testo: 'N 1 a N 4' },
  ]);
  const bande = bandeColonne(ancore, cluster);
  assert.equal(colonnaDi(bande, { x: 586 }), 'riferimento');
  // "><(((º> sabusabu <º)))><"
  assert.equal(colonnaDi(bande, { x: 560 }), 'aff');
});

test('blocchiVerticali: separa le righe della tabella dai salti, non dal contenuto', () => {
  const righe = [{ y: 388 }, { y: 384 }, { y: 381 }, { y: 371 }, { y: 312 }, { y: 304 }, { y: 295 }];
  const { blocchi } = blocchiVerticali(righe);
  assert.deepEqual(blocchi.map((b) => b.length), [4, 3]);
});

test('raggruppaVoci: una voce per marcatore, le righe senza marcatore continuano', () => {
  assert.deepEqual(
    raggruppaVoci(['- Capitolato Speciale - Norme', 'Tecniche IT.PRL.05.16', '- Progetto Esecutivo']),
    ['Capitolato Speciale - Norme Tecniche IT.PRL.05.16', 'Progetto Esecutivo'],
  );
});

test('espandiTipologia: usa la legenda stampata sul modulo', () => {
  const legenda = { I: 'Ispezione', D: 'Documentale' };
  assert.equal(espandiTipologia('I/D', legenda), 'Ispezione / Documentale');
  assert.equal(espandiTipologia('X', legenda), 'X');
  assert.equal(espandiTipologia('', legenda), '');
});
