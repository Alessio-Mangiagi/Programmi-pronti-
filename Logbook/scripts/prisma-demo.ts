// "><(((º> sabusabu <º)))><"
/**
 * Lancia la CLI di Prisma sulla copia dimostrativa (data/demo/logbook.db) invece che sul
 * database vero.
 *
 * La usano i comandi per chi sviluppa: `npm run db:migra`, `db:seed`, `db:reset`,
 * `db:studio`. Dal 25/11/2026 data/logbook.db è il database vero di HR: un "reset" o un
 * "seed" lanciato per prova non deve mai toccarlo, perché cancellerebbe tutto o ci
 * metterebbe dati finti. Lo script imposta LOGBOOK_DIMOSTRAZIONE=1, che prisma.config.ts
 * (tramite server/database-url.ts) legge per scegliere il file; il seed lanciato da
 * `prisma db seed` eredita la variabile e scrive anche lui in data/demo.
 *
 * Uso: tsx scripts/prisma-demo.ts <argomenti di prisma>, es. `migrate reset --force`.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { RADICE_APP } from '../server/database-url';

process.env.LOGBOOK_DIMOSTRAZIONE = '1';
const cli = path.join(RADICE_APP, 'node_modules', 'prisma', 'build', 'index.js');
try {
  execFileSync(process.execPath, [cli, ...process.argv.slice(2)], { cwd: RADICE_APP, stdio: 'inherit' });
} catch (e) {
  // L'errore l'ha già scritto Prisma: si esce con lo stesso codice (es. reset annullato).
  process.exit((e as { status?: number }).status ?? 1);
}
