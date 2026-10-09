// Log a riga singola, stesso formato per stdout e per il file di diagnostica.
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from './config.js';

const FILE = path.join(CONFIG.cartellaDati, 'app.log');

function scrivi(livello, messaggio, extra) {
  const riga = `${new Date().toISOString()} [${livello}] ${messaggio}` +
    (extra ? ' ' + JSON.stringify(extra) : '');
  console.log(riga);
  try {
    fs.mkdirSync(CONFIG.cartellaDati, { recursive: true });
    fs.appendFileSync(FILE, riga + '\n');
  } catch { /* il log su file non deve mai far cadere una richiesta */ }
}

export const log = {
  info: (m, e) => scrivi('INFO', m, e),
  avviso: (m, e) => scrivi('AVVISO', m, e),
  errore: (m, e) => scrivi('ERRORE', m, e),
};
