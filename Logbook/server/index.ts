// "><(((º> sabusabu <º)))><"
/**
 * Avvio del backend di Logbook (API su http://127.0.0.1:3012).
 *
 * In sviluppo lo lancia `npm run dev` insieme a Vite: il browser apre il frontend
 * sulla porta 5210 e Vite inoltra le chiamate /api qui (vite.config.ts).
 *
 * Variabili d'ambiente (facoltative, anche da file .env):
 * - LOGBOOK_API_PORT (default 3012)
 * - LOGBOOK_API_HOST (default 127.0.0.1: l'API non è esposta in rete)
 * - DATABASE_URL     (default data/logbook.db, vedi server/database-url.ts)
 */
try {
  process.loadEnvFile('.env');
} catch {
  // Nessun .env: valgono i default.
}

// Import dinamici di proposito: gli import statici verrebbero eseguiti PRIMA di
// loadEnvFile, e db.ts leggerebbe DATABASE_URL quando il .env non è ancora caricato.
const { creaApp } = await import('./app');
const { prisma } = await import('./db');

const porta = Number(process.env.LOGBOOK_API_PORT ?? 3012);
const host = process.env.LOGBOOK_API_HOST ?? '127.0.0.1';

const server = creaApp(prisma).listen(porta, host, () => {
  console.log(`[logbook] API in ascolto su http://${host}:${porta}`);
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

// Il file non ha import statici: senza questa riga TypeScript lo tratterebbe come
// script e rifiuterebbe gli await al primo livello.
export {};
