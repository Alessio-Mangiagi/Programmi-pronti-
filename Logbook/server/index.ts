// "><(((º> sabusabu <º)))><"
/**
 * Avvio del server di Logbook, in due modalità:
 *
 * - SVILUPPO (`npm run dev`): solo API su http://127.0.0.1:3012; l'interfaccia la serve
 *   Vite sulla 5210 e inoltra le chiamate /api qui (vite.config.ts).
 * - PRODUZIONE (`npm start`, `avvia.bat`, card del Portale): con l'opzione --produzione
 *   un solo server sulla porta 5210 serve sia le API sia l'interfaccia compilata in dist/.
 * - COPIA DIMOSTRATIVA (`npm run demo`, `avvia-demo.bat`, dal 25/11/2026): come la
 *   produzione, con --dimostrazione in più: database e file di data/demo, porta 5211,
 *   interfaccia compilata in dist-demo/ e fascia "Copia dimostrativa" (server/dati-demo.ts).
 *   Gira accanto al Logbook vero senza poterne toccare i dati.
 *
 * Variabili d'ambiente (facoltative, anche da file .env):
 * - LOGBOOK_API_PORT (sviluppo, default 3012) / LOGBOOK_PORT (produzione, default 5210)
 * - LOGBOOK_API_HOST / HOST: indirizzo di ascolto, default 127.0.0.1. Il Portale della
 *   suite passa HOST alle app che avvia (0.0.0.0 se il portale è in rete).
 * - DATABASE_URL (default data/logbook.db, vedi server/database-url.ts)
 * - LOGBOOK_COOKIE_SECURE=1 dietro HTTPS (reverse proxy della suite)
 * - LOGBOOK_DOCUMENTI_DIR: cartella dei file caricati (default data/documenti)
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
const { inDimostrazione, PORTA_DIMOSTRAZIONE } = await import('./dati-demo');

const produzione = process.argv.includes('--produzione');
const dimostrazione = inDimostrazione();
// La copia dimostrativa ha una variabile di porta sua: un .env con LOGBOOK_PORT=5210 per il
// Logbook vero non la deve far scontrare con lui.
const porta = Number(
  !produzione
    ? (process.env.LOGBOOK_API_PORT ?? 3012)
    : dimostrazione
      ? (process.env.LOGBOOK_DIMOSTRAZIONE_PORT ?? PORTA_DIMOSTRAZIONE)
      : (process.env.LOGBOOK_PORT ?? 5210),
);
const host = process.env.LOGBOOK_API_HOST ?? process.env.HOST ?? '127.0.0.1';

// L'interfaccia della copia dimostrativa è compilata in dist-demo/ (npm run demo): così
// avviarla non svuota dist/ mentre il Logbook vero la sta servendo.
const app = creaApp(
  prisma,
  produzione ? { cartellaInterfaccia: path.join(RADICE_APP, dimostrazione ? 'dist-demo' : 'dist'), dimostrazione } : { dimostrazione },
);

// File caricati ma mai collegati a un documento (finestra chiusa a metà) da più di un
// giorno: si tolgono all'avvio e poi ogni 6 ore (verifica di sicurezza del Giorno 23: con
// il server acceso per settimane non si accumulano). Un errore qui non ferma il server.
const { cartellaDocumentiPredefinita, pulisciFileOrfani } = await import('./servizi/archivio-file');
const pulisci = () =>
  pulisciFileOrfani(prisma, cartellaDocumentiPredefinita())
    .then((n) => n && console.log(`[logbook] tolti ${n} file caricati e mai usati`))
    .catch((e) => console.warn('[logbook] pulizia dei file non riuscita:', e));
pulisci();
// unref: il timer non tiene acceso il processo alla chiusura.
setInterval(pulisci, 6 * 60 * 60 * 1000).unref();
// Express 5 chiama questa funzione anche quando l'ascolto fallisce, passandole l'errore:
// in quel caso si tace e ci pensa il gestore 'error' qui sotto (altrimenti il log direbbe
// "in ascolto" subito prima di "porta occupata").
const server = app.listen(porta, host, (errore?: Error) => {
  if (errore) return;
  const nome = produzione ? (dimostrazione ? 'Logbook (copia dimostrativa, data/demo)' : 'Logbook') : 'API';
  console.log(`[logbook] ${nome} in ascolto su http://${host}:${porta}`);
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
