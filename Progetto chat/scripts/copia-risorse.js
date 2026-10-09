#!/usr/bin/env node
/**
 * Copia in dist/ le risorse che tsc ignora.
 *
 * tsc compila i .ts e basta: tutto il resto (per ora lo script Python della
 * pulizia pagine) resterebbe fuori dalla build, e in produzione l'app
 * cercherebbe un file che non c'e'. Va lanciato dopo tsc, prima di vite build
 * (vedi "build" in package.json).
 */
const fs = require('fs');
const path = require('path');

const RADICE = path.join(__dirname, '..');

// [da, a] relativi alla radice del progetto
const RISORSE = [
  ['src/batch/pulisci_ddt.py', 'dist/batch/pulisci_ddt.py'],
  ['src/batch/estrai_fir_locale.py', 'dist/batch/estrai_fir_locale.py'],
  ['src/batch/rendi_pagine.py', 'dist/batch/rendi_pagine.py'],
];

let copiati = 0;
for (const [da, a] of RISORSE) {
  const sorgente = path.join(RADICE, da);
  const destinazione = path.join(RADICE, a);
  if (!fs.existsSync(sorgente)) {
    console.error(`ERRORE: risorsa mancante ${da}`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(destinazione), { recursive: true });
  fs.copyFileSync(sorgente, destinazione);
  copiati++;
}
console.log(`Risorse copiate in dist/: ${copiati}`);
// "><(((º> sabusabu <º)))><"
