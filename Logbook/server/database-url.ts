// "><(((º> sabusabu <º)))><"
/**
 * Dove sta il database SQLite di Logbook.
 *
 * Unico punto che decide il percorso, usato sia dal server (server/db.ts) sia dalla
 * CLI di Prisma (prisma.config.ts) e dallo script di preparazione: così migrazioni,
 * seed e app leggono sempre lo stesso file, qualunque sia la cartella da cui si lancia
 * il comando (doppio clic su avvia.bat, npm run dev, terminale aperto altrove).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inDimostrazione } from './dati-demo';

/** Cartella radice dell'app (quella con package.json). */
export const RADICE_APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Cartella dei dati di questa istanza: `data/` dell'app per il Logbook vero, `data/demo/`
 * per la copia dimostrativa (25/11/2026, vedi server/dati-demo.ts). La crea se manca,
 * perché SQLite crea il file ma non le cartelle che lo contengono.
 */
export function cartellaDati(): string {
  const cartella = inDimostrazione() ? path.join(RADICE_APP, 'data', 'demo') : path.join(RADICE_APP, 'data');
  fs.mkdirSync(cartella, { recursive: true });
  return cartella;
}

/**
 * URL del database nel formato atteso da Prisma (`file:<percorso>`).
 *
 * Se `DATABASE_URL` è impostata vince lei; altrimenti `logbook.db` in cartellaDati().
 * La copia dimostrativa ignora DATABASE_URL: anche con un .env che punta al database vero
 * usa sempre data/demo/logbook.db. Il percorso è assoluto con barre in avanti: con un
 * percorso relativo la CLI di Prisma e il server potrebbero risolverlo da cartelle diverse
 * e creare due database distinti.
 */
export function urlDatabase(): string {
  const daAmbiente = inDimostrazione() ? undefined : process.env.DATABASE_URL?.trim();
  if (daAmbiente) return daAmbiente;
  return 'file:' + path.join(cartellaDati(), 'logbook.db').replace(/\\/g, '/');
}
