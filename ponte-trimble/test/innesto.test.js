// Il punto di innesto: un file .js nella cartella dei traduttori deve bastare.
// Qui si verifica proprio quello, compreso il caso in cui il file consegnato
// e' sbagliato: deve dirlo, non far cadere l'app ne' gli altri traduttori.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CONFIG } from '../src/config.js';
import { validaTraduttore, caricaTraduttori, elencaTraduttori, prendiTraduttore, traduci } from '../src/pipeline/traduci.js';
import { estrattoFinto } from './aiuti.js';

const CARTELLA = fs.mkdtempSync(path.join(os.tmpdir(), 'traduttori-'));
test.after(() => {
  CONFIG.traduttoriDir = '';
  fs.rmSync(CARTELLA, { recursive: true, force: true });
});

const scrivi = (nome, contenuto) => fs.writeFileSync(path.join(CARTELLA, nome), contenuto);

test('validaTraduttore elenca tutto quello che manca, in italiano', () => {
  assert.deepEqual(validaTraduttore(null), ['nessun oggetto esportato']);

  const problemi = validaTraduttore({ nome: 'Non Valido', colonne: [] }, 'mio.js');
  assert.equal(problemi.length, 3);
  assert.match(problemi[0], /mio\.js: campo "nome" mancante o non valido/);
  assert.match(problemi[1], /campo "esegui" mancante/);
  assert.match(problemi[2], /campo "colonne" mancante/);

  // "><(((º> sabusabu <º)))><"
  assert.deepEqual(
    validaTraduttore({ nome: 'ok', colonne: [{ chiave: 'a', titolo: 'A' }], esegui: () => ({}) }),
    [],
  );
});

test('i traduttori di serie sono caricati dalla cartella, il modello _ e\' ignorato', async () => {
  const { caricati } = await caricaTraduttori();
  for (const atteso of ['pcq-controlli', 'pcq-econ', 'grezzo']) assert.ok(caricati.includes(atteso), atteso);
  assert.equal(caricati.includes('modello'), false);

  const elenco = await elencaTraduttori();
  assert.ok(elenco.every((t) => t.nome && Array.isArray(t.colonne)));
});

test('un traduttore consegnato da fuori repo si aggiunge senza toccare il codice', async () => {
  scrivi('consegnato.js', `
export default {
  nome: 'consegnato',
  descrizione: 'traduttore di prova',
  colonne: [{ chiave: 'testo', titolo: 'Testo', tipo: 'testo' }],
  esegui(estratto) {
    return { intestazione: { fonte: 'esterna' }, record: [{ testo: estratto.pagine[0].righe[0].testo }], avvisi: [] };
  },
};
`);
  CONFIG.traduttoriDir = CARTELLA;
  const { caricati, errori } = await caricaTraduttori({ ricarica: true });

  assert.ok(caricati.includes('consegnato'));
  assert.deepEqual(errori, []);
  assert.ok(await prendiTraduttore('consegnato'));

  const esito = await traduci('consegnato', estrattoFinto(['prima riga']));
  assert.deepEqual(esito.record, [{ testo: 'prima riga' }]);
  assert.deepEqual(esito.colonne, [{ chiave: 'testo', titolo: 'Testo', tipo: 'testo' }]);
  assert.deepEqual(esito.avvisi, []);
});

test('un file rotto finisce negli errori e non porta giu\' gli altri', async () => {
  scrivi('rotto.js', 'export default { nome: "rotto" };');            // senza esegui e colonne
  scrivi('esplode.js', 'throw new Error("boom");');
  CONFIG.traduttoriDir = CARTELLA;

  const { caricati, errori } = await caricaTraduttori({ ricarica: true });
  assert.ok(caricati.includes('pcq-controlli'));
  assert.ok(caricati.includes('consegnato'));
  assert.equal(caricati.includes('rotto'), false);

  assert.match(errori.join(' | '), /rotto\.js: campo "esegui" mancante/);
  assert.match(errori.join(' | '), /rotto\.js: campo "colonne" mancante/);
  assert.match(errori.join(' | '), /esplode\.js: boom/);
});

test('traduttore sconosciuto: l\'errore dice quali ci sono', async () => {
  await assert.rejects(
    () => traduci('inesistente', estrattoFinto([])),
    (e) => /traduttore sconosciuto: inesistente/.test(e.message) && /pcq-controlli/.test(e.message),
  );
});
