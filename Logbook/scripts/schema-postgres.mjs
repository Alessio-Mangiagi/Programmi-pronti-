// "><(((º> sabusabu <º)))><"
/**
 * Crea prisma/postgres/schema.prisma: una copia di prisma/schema.prisma con il database
 * PostgreSQL al posto di SQLite (Giorno 35, 25/11/2026: Copilota su Vercel).
 *
 * Lo schema vero resta uno solo, prisma/schema.prisma. Qui cambiano soltanto due righe: il
 * "provider" del database e il percorso del client generato (la copia sta una cartella più
 * in basso). La copia non è versionata (.gitignore): si rigenera a ogni `npm install`
 * (postinstall) e a ogni build per Vercel, così non può restare indietro.
 * prisma.config.ts usa la copia quando DATABASE_URL è un indirizzo PostgreSQL.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const radice = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origine = fs.readFileSync(path.join(radice, 'prisma', 'schema.prisma'), 'utf8');
const copia = origine
  .replace(/provider\s*=\s*"sqlite"/, 'provider = "postgresql"')
  .replace('output   = "../generated/prisma"', 'output   = "../../generated/prisma"');
if (copia === origine || !copia.includes('provider = "postgresql"') || !copia.includes('"../../generated/prisma"')) {
  console.error('[logbook] schema-postgres: righe di provider o output non trovate in prisma/schema.prisma');
  process.exit(1);
}
const cartella = path.join(radice, 'prisma', 'postgres');
fs.mkdirSync(cartella, { recursive: true });
fs.writeFileSync(
  path.join(cartella, 'schema.prisma'),
  '// GENERATO da scripts/schema-postgres.mjs a partire da prisma/schema.prisma: non modificare a mano.\n' + copia,
);
