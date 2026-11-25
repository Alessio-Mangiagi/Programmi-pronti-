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

/** Cartella radice dell'app (quella con package.json). */
export const RADICE_APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * URL del database nel formato atteso da Prisma (`file:<percorso>`).
 *
 * Se `DATABASE_URL` è impostata vince lei; altrimenti `data/logbook.db` nella radice
 * dell'app. Il percorso è assoluto con barre in avanti: con un percorso relativo la
 * CLI di Prisma e il server potrebbero risolverlo da cartelle diverse e creare due
 * database distinti. Crea la cartella `data/` se manca, perché SQLite crea il file
 * ma non le cartelle che lo contengono.
 */
/**
 * true se il database è PostgreSQL (Giorno 35: Logbook su Vercel, dove un file SQLite non
 * durerebbe). Lo decide l'indirizzo: DATABASE_URL che comincia con postgres:// o postgresql://.
 * Da qui dipendono il driver (server/db.ts), dove stanno i file caricati
 * (servizi/archivio-file.ts), il blocco dei tentativi (servizi/limitatore.ts) e le copie di
 * sicurezza (servizi/backup.ts: su PostgreSQL le fa il servizio che ospita il database).
 */
export function suPostgres(url: string | undefined = process.env.DATABASE_URL): boolean {
  return /^postgres(ql)?:\/\//i.test(url?.trim() ?? '');
}

export function urlDatabase(): string {
  const daAmbiente = process.env.DATABASE_URL?.trim();
  if (daAmbiente) return daAmbiente;
  const cartella = path.join(RADICE_APP, 'data');
  fs.mkdirSync(cartella, { recursive: true });
  return 'file:' + path.join(cartella, 'logbook.db').replace(/\\/g, '/');
}
