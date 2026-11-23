// "><(((º> sabusabu <º)))><"
/**
 * Connessione al database: un solo PrismaClient per tutto il processo.
 *
 * Prisma 7 non ha più un motore interno per SQLite: parla col file tramite un
 * "driver adapter", qui better-sqlite3 (modulo nativo, sincrono e veloce per un
 * gestionale con pochi utenti contemporanei).
 */
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../generated/prisma/client';
import { urlDatabase } from './database-url';

/** Crea un client nuovo. Usato da server, seed e test (che passano un URL di prova). */
export function creaPrisma(url: string = urlDatabase()): PrismaClient {
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
}

/** Client condiviso dalle rotte del server. */
export const prisma = creaPrisma();
