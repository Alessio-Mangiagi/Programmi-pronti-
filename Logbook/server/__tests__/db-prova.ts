// "><(((º> sabusabu <º)))><"
/**
 * Database SQLite usa-e-getta per i test: file nuovo in una cartella temporanea, con
 * la struttura delle migrazioni vere (prisma/migrations/*\/migration.sql) applicata
 * direttamente, senza lanciare la CLI di Prisma (più veloce e senza processi figli).
 *
 * Ogni test che lo usa ha dati suoi: non tocca mai data/logbook.db.
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RADICE_APP } from '../database-url';
import { creaPrisma } from '../db';

export type DbProva = {
  prisma: ReturnType<typeof creaPrisma>;
  /** Chiude la connessione e cancella il file. */
  chiudi: () => Promise<void>;
};

export async function creaDbProva(): Promise<DbProva> {
  const cartella = fs.mkdtempSync(path.join(os.tmpdir(), 'logbook-test-'));
  const file = path.join(cartella, 'prova.db');

  const cartellaMigrazioni = path.join(RADICE_APP, 'prisma', 'migrations');
  const migrazioni = fs
    .readdirSync(cartellaMigrazioni, { withFileTypes: true })
    .filter((v) => v.isDirectory())
    .map((v) => v.name)
    .sort(); // i nomi iniziano col timestamp: l'ordine alfabetico è quello di creazione
  const sqlite = new Database(file);
  for (const nome of migrazioni) {
    sqlite.exec(fs.readFileSync(path.join(cartellaMigrazioni, nome, 'migration.sql'), 'utf8'));
  }
  sqlite.close();

  const prisma = creaPrisma('file:' + file.replace(/\\/g, '/'));
  return {
    prisma,
    chiudi: async () => {
      await prisma.$disconnect();
      fs.rmSync(cartella, { recursive: true, force: true });
    },
  };
}
