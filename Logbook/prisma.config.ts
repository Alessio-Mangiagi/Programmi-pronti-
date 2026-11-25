// "><(((º> sabusabu <º)))><"
/**
 * Configurazione della CLI di Prisma 7 (migrate, generate, db seed, studio).
 *
 * Da Prisma 7 l'URL del database non sta più in schema.prisma ma qui, e il file .env
 * non viene più caricato da solo: lo carichiamo noi se esiste (process.loadEnvFile,
 * nativo da Node 20.12, senza la dipendenza dotenv).
 */
import { defineConfig } from 'prisma/config';
import { suPostgres, urlDatabase } from './server/database-url';

try {
  process.loadEnvFile('.env');
} catch {
  // Nessun .env: si usano i default di server/database-url.ts.
}

// Giorno 35: con un DATABASE_URL di PostgreSQL (Vercel) si usa la copia dello schema con
// quel provider, creata da scripts/vercel-build.mjs. Le migrazioni SQL restano quelle di SQLite:
// su PostgreSQL la struttura si allinea con `prisma db push` (scripts/prepara-db.ts).
export default defineConfig({
  schema: suPostgres() ? 'prisma/postgres/schema.prisma' : 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // Eseguito da `prisma db seed` e da `prisma migrate reset`.
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: urlDatabase(),
  },
});
