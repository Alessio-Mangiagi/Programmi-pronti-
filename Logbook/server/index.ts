// "><(((º> sabusabu <º)))><"
/**
 * Avvio del server di Logbook, in due modalità:
 *
 * - SVILUPPO (`npm run dev`): solo API su http://127.0.0.1:3012; l'interfaccia la serve
 *   Vite sulla 5210 e inoltra le chiamate /api qui (vite.config.ts).
 * - PRODUZIONE (`npm start`, `avvia.bat`, card del Portale): con l'opzione --produzione
 *   un solo server sulla porta 5210 serve sia le API sia l'interfaccia compilata in dist/.
 *
 * Variabili d'ambiente (facoltative, anche da file .env):
 * - LOGBOOK_API_PORT (sviluppo, default 3012) / LOGBOOK_PORT (produzione, default 5210)
 * - LOGBOOK_API_HOST / HOST: indirizzo di ascolto, default 127.0.0.1. Il Portale della
 *   suite passa HOST alle app che avvia (0.0.0.0 se il portale è in rete).
 * - DATABASE_URL (default data/logbook.db, vedi server/database-url.ts)
 * - LOGBOOK_COOKIE_SECURE=1 dietro HTTPS (reverse proxy della suite)
 */
import path from 'node:path';

try {
  process.loadEnvFile('.env');
} catch {
  // Nessun .env: valgono i default.
}

// Import dinamici di proposito: gli import statici verrebbero eseguiti PRIMA di
// loadEnvFile, e db.ts leggerebbe DATABASE_URL quando il .env non è ancora caricato.
const { creaApp } = await import('./app');
const { prisma } = await import('./db');
const { RADICE_APP } = await import('./database-url');

const produzione = process.argv.includes('--produzione');
const porta = Number(produzione ? (process.env.LOGBOOK_PORT ?? 5210) : (process.env.LOGBOOK_API_PORT ?? 3012));
const host = process.env.LOGBOOK_API_HOST ?? process.env.HOST ?? '127.0.0.1';

const app = creaApp(prisma, produzione ? { cartellaInterfaccia: path.join(RADICE_APP, 'dist') } : {});
const server = app.listen(porta, host, () => {
  console.log(`[logbook] ${produzione ? 'Logbook' : 'API'} in ascolto su http://${host}:${porta}`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[logbook] la porta ${porta} è già occupata: Logbook è già aperto in un'altra finestra?`);
  } else {
    console.error('[logbook] impossibile avviare il server:', err);
  }
  process.exit(1);
});

/** Chiusura pulita (Ctrl+C, riavvio di tsx watch): rilascia il file SQLite. */
async function chiudi() {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', chiudi);
process.on('SIGTERM', chiudi);
