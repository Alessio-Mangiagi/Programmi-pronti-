// "><(((º> sabusabu <º)))><"
/**
 * Copie di sicurezza di Logbook (Giorno 34, 25/11/2026: "parti dal primo punto e crea il db
 * utilizzando sql").
 *
 * - La copia del database si fa con un comando SQL di SQLite, `VACUUM INTO 'file'`: scrive
 *   un database completo e coerente anche mentre Logbook è acceso e qualcuno sta salvando
 *   (copiare il file a mano potrebbe prenderlo a metà di una scrittura).
 * - Una copia al giorno, `logbook-AAAA-MM-GG.db`, fatta all'avvio se quella di oggi manca e
 *   poi controllata ogni ora (server/index.ts): con il PC acceso di notte scatta poco dopo
 *   mezzanotte.
 * - Una copia in più, `prima-cancellazione-…db`, subito prima di "Cancella tutti i dati"
 *   (server/rotte/proprietario.ts): se la cancellazione parte per errore o da un estraneo,
 *   i dati si recuperano.
 * - I file caricati (attestati, documenti) si copiano in `documenti/` dentro la cartella
 *   delle copie: solo quelli nuovi. Quelli spariti dall'originale restano 30 giorni con il
 *   suffisso ".tolto".
 * - Le copie più vecchie di 30 giorni si cancellano da sole.
 *
 * Cartella: LOGBOOK_BACKUP_DIR, altrimenti data/backup. Per essere al riparo da un guasto
 * del disco va puntata a un altro disco o a una cartella di rete.
 * Ripristino: fermare Logbook, copiare il file scelto su data/logbook.db, riavviare.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { PrismaClient } from '../../generated/prisma/client';
import { RADICE_APP } from '../database-url';

export const GIORNI_BACKUP = 30;
const MS_GIORNO = 24 * 60 * 60 * 1000;
/** Suffisso dei file caricati che nell'originale non ci sono più (recuperabili togliendolo). */
const SPARITO = '.tolto';

/** Cartella delle copie: variabile d'ambiente o data/backup dell'app. */
export function cartellaBackupPredefinita(): string {
  const env = process.env.LOGBOOK_BACKUP_DIR?.trim();
  return env ? path.resolve(env) : path.join(RADICE_APP, 'data', 'backup');
}

const due = (n: number) => String(n).padStart(2, '0');
const giornoLocale = (d: Date) => `${d.getFullYear()}-${due(d.getMonth() + 1)}-${due(d.getDate())}`;

/** Copia nella cartella delle copie i file caricati che mancano; toglie quelli spariti da 30 giorni. */
function copiaDocumenti(cartellaDocumenti: string, destinazione: string, adesso: Date): number {
  if (!fs.existsSync(cartellaDocumenti)) return 0;
  fs.mkdirSync(destinazione, { recursive: true });
  const originali = new Set(fs.readdirSync(cartellaDocumenti).filter((n) => fs.statSync(path.join(cartellaDocumenti, n)).isFile()));
  let copiati = 0;
  for (const nome of originali) {
    const a = path.join(destinazione, nome);
    if (fs.existsSync(a)) continue;
    fs.copyFileSync(path.join(cartellaDocumenti, nome), a);
    copiati++;
  }
  for (const nome of fs.readdirSync(destinazione)) {
    const p = path.join(destinazione, nome);
    if (nome.endsWith(SPARITO)) {
      // Già segnato come sparito dall'originale: si toglie 30 giorni dopo quel momento.
      if (adesso.getTime() - fs.statSync(p).mtimeMs > GIORNI_BACKUP * MS_GIORNO) fs.rmSync(p, { force: true });
    } else if (!originali.has(nome)) {
      // Prima volta che l'originale manca (documento eliminato o "Cancella tutti i dati"):
      // si rinomina e si segna l'ora, così restano 30 giorni per recuperarlo.
      fs.renameSync(p, p + SPARITO);
      fs.utimesSync(p + SPARITO, adesso, adesso);
    }
  }
  return copiati;
}

/** Cancella le copie del database più vecchie di 30 giorni (solo i file con i nostri nomi). */
function sfoltisci(cartella: string, adesso: Date): number {
  let tolte = 0;
  for (const nome of fs.readdirSync(cartella)) {
    if (!/^(logbook-\d{4}-\d{2}-\d{2}|prima-cancellazione-\d{8}-\d{6})\.db$/.test(nome)) continue;
    const p = path.join(cartella, nome);
    if (adesso.getTime() - fs.statSync(p).mtimeMs > GIORNI_BACKUP * MS_GIORNO) {
      fs.rmSync(p, { force: true });
      tolte++;
    }
  }
  return tolte;
}

export type EsitoBackup = { file: string; documentiCopiati: number; copieTolte: number };

/**
 * Crea una copia del database con `VACUUM INTO` e aggiorna la copia dei file caricati.
 * `tipo` decide il nome: "giornaliero" sovrascrive quella di oggi, "prima-cancellazione"
 * ne crea sempre una nuova con data e ora.
 */
export async function creaBackup(
  prisma: PrismaClient,
  cartellaDocumenti: string,
  opzioni: { tipo?: 'giornaliero' | 'prima-cancellazione'; cartella?: string; adesso?: Date } = {},
): Promise<EsitoBackup> {
  const adesso = opzioni.adesso ?? new Date();
  const cartella = opzioni.cartella ?? cartellaBackupPredefinita();
  fs.mkdirSync(cartella, { recursive: true });
  const nome =
    opzioni.tipo === 'prima-cancellazione'
      ? `prima-cancellazione-${giornoLocale(adesso).replace(/-/g, '')}-${due(adesso.getHours())}${due(adesso.getMinutes())}${due(adesso.getSeconds())}.db`
      : `logbook-${giornoLocale(adesso)}.db`;
  const file = path.join(cartella, nome);
  // VACUUM INTO vuole un file che non esiste: si scrive accanto e poi si sostituisce, così
  // se la copia fallisce a metà resta quella precedente.
  const provvisorio = `${file}.parziale`;
  fs.rmSync(provvisorio, { force: true });
  // Il percorso è nostro (cartella di configurazione + nome fisso), non arriva dall'utente;
  // gli apici si raddoppiano comunque, come vuole SQL.
  await prisma.$executeRawUnsafe(`VACUUM INTO '${provvisorio.replace(/\\/g, '/').replace(/'/g, "''")}'`);
  fs.renameSync(provvisorio, file);
  const documentiCopiati = copiaDocumenti(cartellaDocumenti, path.join(cartella, 'documenti'), adesso);
  return { file, documentiCopiati, copieTolte: sfoltisci(cartella, adesso) };
}

/** Fa la copia di oggi se manca. Restituisce l'esito, o null se c'era già. */
export async function backupSeManca(prisma: PrismaClient, cartellaDocumenti: string, cartella = cartellaBackupPredefinita(), adesso = new Date()) {
  if (fs.existsSync(path.join(cartella, `logbook-${giornoLocale(adesso)}.db`))) return null;
  return creaBackup(prisma, cartellaDocumenti, { cartella, adesso });
}
