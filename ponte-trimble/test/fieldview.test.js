// Formato di uscita "fieldview": la spec del template che il Form Designer
// (o un RPA) ricostruisce, visto che le API di Field View non creano template.
import test from 'node:test';
import assert from 'node:assert/strict';
// "><(((º> sabusabu <º)))><"
import { rendi } from '../src/pipeline/rendi.js';

const DATI = {
  intestazione: {
    form: 'CLS',
    numero: '1',
    revisione: 'A',
    opera: 'ITINERARIO RAGUSA-CATANIA',
    legenda: { I: 'Ispezione', D: 'Documentale' },
  },
  colonne: [{ chiave: 'pos', titolo: 'POS.' }],
  meta: { origine: '177_125PCQ01CLS.pdf', pagine: 3, traduttore: 'pcq-controlli' },
  record: [
    {
      pos: 1,
      controllo: 'Verifica presa in possesso area; Verifica risoluzione interferenze',
      punti: ['Verifica presa in possesso area', 'Verifica risoluzione interferenze'],
      tipologia: 'D',
      tipologia_estesa: 'Documentale',
      documenti_voci: ['Dichiarazione di immissione in possesso', 'SK-ARM'],
      schede: 'SK-ARM',
      note: '',
    },
    {
      pos: 2,
      controllo: 'Verifica esistenza dello studio preliminare',
      punti: ['Verifica esistenza dello studio preliminare'],
      tipologia: 'I/D',
      tipologia_estesa: 'Ispezione / Documentale',
      documenti_voci: ['C.S.A.'],
      schede: '',
      note: '',
    },
  ],
};

const spec = () => JSON.parse(rendi('fieldview', DATI).contenuto.toString('utf8'));

test('fieldview: nome del template, tipo e gruppi di risposte predefinite', () => {
  const s = spec();
  assert.equal(s.template_name, 'PCQ CLS n. 1');
  assert.equal(s.form_type, 'Quality');

  const gruppi = Object.fromEntries(s.predefined_answer_groups.map((g) => [g.name, g.values]));
  assert.deepEqual(gruppi['Esito controllo'], ['Conforme', 'Non conforme', 'Non applicabile']);
  assert.deepEqual(gruppi['Ente controllo'], ['APP', 'DL', 'AFF']);
  assert.deepEqual(gruppi['Tipologia controllo'], ['Ispezione', 'Documentale']);
});

test('fieldview: una sezione per controllo, piu\' l\'intestazione', () => {
  const s = spec();
  assert.equal(s.sections.length, 3);
  assert.equal(s.sections[0].name, 'Intestazione');
  assert.match(s.sections[1].name, /^POS 1 — Verifica presa in possesso/);
  assert.match(s.sections[2].name, /^POS 2 —/);

  const intestazione = s.sections[0].items;
  assert.equal(intestazione[0].element, 'Insert text');
  assert.equal(intestazione[0].label, 'ITINERARIO RAGUSA-CATANIA');
  assert.equal(intestazione[1].label, 'Form: CLS — N. 1 — Rev. A');
  assert.ok(intestazione.some((i) => i.label === 'WBS / Parte d\'opera' && i.fieldview_type === 'Text'));
});

test('fieldview: il testo stampato resta testo, i campi da compilare sono domande', () => {
  const sezione = spec().sections[1];
  const fissi = sezione.items.filter((i) => i.element === 'Insert text');
  const domande = sezione.items.filter((i) => i.element === 'question');

  assert.equal(fissi.length, 2);
  assert.match(fissi[0].label, /• Verifica presa in possesso area/);
  assert.match(fissi[0].notes, /tipologia D \(Documentale\)/);
  assert.match(fissi[1].label, /^Documenti di riferimento: /);

  assert.deepEqual(domande.map((d) => d.fieldview_type), [
    'Predefined Answer', 'Predefined Answer', 'Text', 'Memo', 'Photo', 'Date', 'Signature',
  ]);
  assert.equal(domande[0].predefined_answer_group, 'Esito controllo');
  assert.equal(domande[1].predefined_answer_group, 'Ente controllo');
  assert.match(domande[2].notes, /schede richiamate dal PCQ: SK-ARM/);
  assert.equal(domande.filter((d) => d.required).map((d) => d.label).length, 4);
});

test('fieldview: traccia da quale PDF viene la spec', () => {
  const o = spec()._origine;
  assert.equal(o.file, '177_125PCQ01CLS.pdf');
  assert.equal(o.controlli, 2);
  assert.equal(o.pagine, 3);
  assert.equal(o.form, 'CLS');
});

test('fieldview: record fuori contratto -> errore che dice cosa serve', () => {
  assert.throws(
    () => rendi('fieldview', { ...DATI, record: [{ codice: 'A1', descrizione: 'voce di computo' }] }),
    /vuole record con i campi "pos" e "controllo"/,
  );
});

test('fieldview: nome del file dedicato, non un json qualunque', () => {
  const file = rendi('fieldview', DATI);
  assert.equal(file.ext, 'fieldview.json');
  assert.equal(file.mime, 'application/json');
});
