#!/usr/bin/env node
// Collaudo di un traduttore consegnato da terzi, senza avviare l'app.
//
//   npm run verifica-traduttore -- <file.js> [documento.pdf] [--formato fieldview]
//
// Controlla il contratto (nome, colonne, esegui), poi — se gli dai un PDF — lo
// fa girare davvero e mostra intestazione, record e avvisi, e prova a produrre
// il file di uscita. Esce con codice 1 se qualcosa non va: si puo' mettere in CI.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validaTraduttore } from '../src/pipeline/traduci.js';
import { estrai } from '../src/pipeline/estrai.js';
import { rendi, FORMATI } from '../src/pipeline/rendi.js';

const argomenti = process.argv.slice(2);
const opzione = (nome, def) => {
  const i = argomenti.indexOf('--' + nome);
  return i >= 0 ? argomenti[i + 1] : def;
};
// "><(((º> sabusabu <º)))><"
const posizionali = argomenti.filter((a, i) => !a.startsWith('--') && !argomenti[i - 1]?.startsWith('--'));
const [fileTraduttore, filePdf] = posizionali;
const formato = opzione('formato', 'fieldview');

if (!fileTraduttore) {
  console.error('uso: npm run verifica-traduttore -- <file.js> [documento.pdf] [--formato fieldview|xlsx|csv|json]');
  process.exit(2);
}

const percorso = path.resolve(fileTraduttore);
if (!fs.existsSync(percorso)) {
  console.error(`file inesistente: ${percorso}`);
  process.exit(2);
}

const stampa = (titolo) => console.log('\n' + titolo + '\n' + '─'.repeat(titolo.length));

let uscita = 0;
const modulo = await import(pathToFileURL(percorso).href);
const traduttore = modulo.default && typeof modulo.default === 'object'
  ? modulo.default
  : Object.values(modulo).find((v) => v && typeof v === 'object' && 'esegui' in v);

stampa('1. Contratto');
const problemi = validaTraduttore(traduttore, path.basename(percorso));
if (problemi.length) {
  for (const p of problemi) console.log('  ✗ ' + p);
  process.exit(1);
}
console.log(`  ✓ nome: ${traduttore.nome}`);
console.log(`  ✓ colonne: ${traduttore.colonne.map((c) => c.chiave).join(', ')}`);
console.log(`  ✓ esegui: funzione ${traduttore.esegui.constructor.name === 'AsyncFunction' ? 'async' : 'sincrona'}`);

if (!filePdf) {
  console.log('\nNessun PDF indicato: verificato solo il contratto.');
  console.log('Per la prova completa: npm run verifica-traduttore -- ' + fileTraduttore + ' documento.pdf');
  process.exit(0);
}

stampa('2. Estrazione del PDF');
const estratto = await estrai(fs.readFileSync(path.resolve(filePdf)));
const senzaTesto = estratto.pagine.filter((p) => !p.righe.length).length;
console.log(`  pagine: ${estratto.meta.pagine} (senza livello di testo: ${senzaTesto})`);
for (const a of estratto.avvisi) console.log('  ! ' + a);

stampa('3. Traduzione');
const esito = await traduttore.esegui(estratto, {});
for (const campo of ['intestazione', 'record', 'avvisi']) {
  if (esito?.[campo] === undefined) {
    console.log(`  ✗ manca "${campo}" nel valore restituito`);
    uscita = 1;
  }
}
const record = esito?.record || [];
console.log(`  record: ${record.length}`);
console.log('  intestazione: ' + JSON.stringify(esito?.intestazione ?? {}).slice(0, 300));
for (const a of esito?.avvisi || []) console.log('  ! ' + a);

const chiavi = new Set(traduttore.colonne.map((c) => c.chiave));
const mancanti = new Set();
for (const r of record) for (const k of chiavi) if (!(k in r)) mancanti.add(k);
if (mancanti.size) {
  console.log(`  ✗ colonne dichiarate ma assenti nei record: ${[...mancanti].join(', ')}`);
  uscita = 1;
}
for (const r of record.slice(0, 3)) console.log('  · ' + JSON.stringify(r).slice(0, 220));

stampa(`4. Uscita "${formato}"`);
if (!FORMATI[formato]) {
  console.log(`  ✗ formato sconosciuto (disponibili: ${Object.keys(FORMATI).join(', ')})`);
  process.exit(1);
}
try {
  const file = rendi(formato, {
    ...esito,
    colonne: traduttore.colonne,
    meta: { ...estratto.meta, origine: path.basename(filePdf), traduttore: traduttore.nome },
  });
  console.log(`  ✓ ${file.ext}, ${file.contenuto.length} byte`);
} catch (e) {
  console.log('  ✗ ' + e.message);
  uscita = 1;
}

console.log(uscita ? '\nESITO: da correggere.' : '\nESITO: traduttore utilizzabile.');
process.exit(uscita);
