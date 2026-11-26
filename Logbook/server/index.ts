// "><(((º> sabusabu <º)))><"
/**
 * Avvio del server di Copilota, in due modalità:
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

const produzione = process.argv.includes('--produzione');
const porta = Number(produzione ? (process.env.LOGBOOK_PORT ?? 5210) : (process.env.LOGBOOK_API_PORT ?? 3012));
const host = process.env.LOGBOOK_API_HOST ?? process.env.HOST ?? '127.0.0.1';

const app = creaApp(prisma, produzione ? { cartellaInterfaccia: path.join(RADICE_APP, 'dist') } : {});

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

// Giorno 34: copia di sicurezza di ogni giorno (servizi/backup.ts). All'avvio se quella di
// oggi manca, poi un controllo ogni ora: con il PC acceso scatta poco dopo mezzanotte. Solo
// in produzione: in sviluppo il database è di prova. Un errore qui non ferma il server.
if (produzione) {
  const { backupSeManca } = await import('./servizi/backup');
  const { pulisciRegistro } = await import('./servizi/registro');
  const copia = () =>
    backupSeManca(prisma, cartellaDocumentiPredefinita())
      .then((r) => r && console.log(`[logbook] copia di sicurezza: ${r.file} (${r.documentiCopiati} file nuovi, ${r.copieTolte} copie vecchie tolte)`))
      .catch((e) => console.error('[logbook] COPIA DI SICUREZZA NON RIUSCITA:', e));
  copia();
  setInterval(copia, 60 * 60 * 1000).unref();
  pulisciRegistro(prisma).catch((e) => console.warn('[logbook] pulizia del registro non riuscita:', e));
  // 26/11/2026: contatori dei tentativi di accesso fermi da più di un giorno (servizi/limitatore.ts).
  const { pulisciTentativi } = await import('./servizi/limitatore');
  pulisciTentativi(prisma).catch((e) => console.warn('[logbook] pulizia dei tentativi di accesso non riuscita:', e));

  // 26/11/2026: avvisi via email del giorno (ore mancanti, attestati in scadenza). Un controllo
  // all'avvio e poi ogni ora: partono al primo controllo dopo le 7 e una volta sola al giorno
  // (servizi/avvisi.ts tiene il segno nel database). Senza posta configurata non fanno nulla.
  const { creaAvvisi, indirizzoDaAmbiente, oraItalia, ORA_AVVISI } = await import('./servizi/avvisi');
  const { invioDaAmbiente } = await import('./servizi/email');
  const { proprietarioDaAmbiente } = await import('./rotte/proprietario');
  const { oggiItalia } = await import('../comune/date');
  const avvisi = creaAvvisi(prisma, { inviaEmail: invioDaAmbiente(), emailProprietario: proprietarioDaAmbiente().email, indirizzo: indirizzoDaAmbiente() });
  const avvisa = () => {
    if (oraItalia() < ORA_AVVISI) return;
    avvisi
      .giornaliero(oggiItalia())
      .then((r) => r.fatto && console.log(`[logbook] avvisi del giorno: ${r.oreMancanti} promemoria ore, ${r.attestati} attestati`))
      .catch((e) => console.warn('[logbook] avvisi del giorno non riusciti:', e));
  };
  avvisa();
  setInterval(avvisa, 60 * 60 * 1000).unref();
}
// Express 5 chiama questa funzione anche quando l'ascolto fallisce, passandole l'errore:
// in quel caso si tace e ci pensa il gestore 'error' qui sotto (altrimenti il log direbbe
// "in ascolto" subito prima di "porta occupata").
const server = app.listen(porta, host, (errore?: Error) => {
  if (errore) return;
  console.log(`[logbook] ${produzione ? 'Copilota' : 'API'} in ascolto su http://${host}:${porta}`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[logbook] la porta ${porta} è già occupata: Copilota è già aperto in un'altra finestra?`);
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
