// "><(((º> sabusabu <º)))><"
/**
 * Connessione al database: un solo PrismaClient per tutto il processo.
 *
 * Prisma 7 parla col database tramite un "driver adapter", scelto dall'indirizzo:
 * - file SQLite (PC, suite, test): better-sqlite3, modulo nativo, sincrono e veloce per un
 *   gestionale con pochi utenti contemporanei;
 * - PostgreSQL (Giorno 35, Copilota su Vercel): il driver pg. Poche connessioni per processo,
 *   perché su Vercel i processi sono tanti e brevi e il database ha un tetto di connessioni.
 *
 * L'adapter di SQLite si carica solo quando serve (createRequire): è un modulo nativo e nel
 * pacchetto per Vercel non c'è (scripts/vercel-build.mjs lo lascia fuori). Quello di PostgreSQL
 * è JavaScript puro e si importa normalmente, così finisce nel pacchetto. Attenzione: il client generato
 * (generated/prisma) è fatto per UN tipo di database, quello dello schema usato da
 * `prisma generate` (prisma/schema.prisma in locale, prisma/postgres/schema.prisma su Vercel).
 */
import { createRequire } from 'node:module';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { suPostgres, urlDatabase } from './database-url';

const carica = createRequire(import.meta.url);

/** Crea un client nuovo. Usato da server, seed e test (che passano un URL di prova). */
export function creaPrisma(url: string = urlDatabase()): PrismaClient {
  if (suPostgres(url)) {
    return new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: Number(process.env.LOGBOOK_PG_CONNESSIONI) || 3 }) });
  }
  const { PrismaBetterSqlite3 } = carica('@prisma/adapter-better-sqlite3') as typeof import('@prisma/adapter-better-sqlite3');
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
}

/** Client condiviso dalle rotte del server. */
export const prisma = creaPrisma();
