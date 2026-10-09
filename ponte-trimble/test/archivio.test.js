// Archivio: piu' file trascinati insieme significano piu' pipeline in parallelo,
// e quindi scritture ravvicinate sullo stesso stato.json. Qui si verifica che non
// si perdano aggiornamenti e che la rename non vada in EPERM su Windows.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CONFIG } from '../src/config.js';
import * as archivio from '../src/archivio.js';

// "><(((º> sabusabu <º)))><"
const CARTELLA = fs.mkdtempSync(path.join(os.tmpdir(), 'archivio-test-'));
const ORIGINALE = CONFIG.cartellaDati;
CONFIG.cartellaDati = CARTELLA;

test.after(() => {
  CONFIG.cartellaDati = ORIGINALE;
  fs.rmSync(CARTELLA, { recursive: true, force: true });
});

const nuovo = () => archivio.creaLavoro({
  nomeFile: 'documento.pdf',
  contenuto: Buffer.from('%PDF-1.4'),
  traduttore: 'grezzo',
  formato: 'json',
});

test('25 aggiornamenti in parallelo sullo stesso lavoro: nessuno va perso', async () => {
  const lavoro = await nuovo();

  await Promise.all(
    Array.from({ length: 25 }, (_, i) =>
      archivio.aggiorna(lavoro.id, (l) => ({ passi: [...l.passi, { nome: 'passo-' + i, stato: 'ok' }] }))),
  );

  const finale = await archivio.leggi(lavoro.id);
  assert.equal(finale.passi.length, 25);
  assert.equal(new Set(finale.passi.map((p) => p.nome)).size, 25);
});

test('lavori diversi scritti insieme non si disturbano', async () => {
  const lavori = await Promise.all([nuovo(), nuovo(), nuovo(), nuovo()]);
  await Promise.all(lavori.map((l, i) => archivio.aggiorna(l.id, { stato: 'pronto', risultato: { righe: i } })));

  for (const [i, l] of lavori.entries()) {
    const finale = await archivio.leggi(l.id);
    assert.equal(finale.stato, 'pronto');
    assert.equal(finale.risultato.righe, i);
  }
  assert.equal(new Set(lavori.map((l) => l.id)).size, 4);
});

test('niente file temporanei lasciati indietro', async () => {
  const lavoro = await nuovo();
  await Promise.all(Array.from({ length: 10 }, (_, i) => archivio.aggiorna(lavoro.id, { stato: i % 2 ? 'in_corso' : 'in_coda' })));

  const residui = fs.readdirSync(archivio.cartellaDi(lavoro.id)).filter((f) => f.endsWith('.tmp'));
  assert.deepEqual(residui, []);
});

test('id con caratteri strani: niente scritture fuori dalla cartella dei lavori', async () => {
  assert.equal(await archivio.leggi('../../fuori'), null);
  assert.equal(await archivio.leggi('con spazio'), null);
});
