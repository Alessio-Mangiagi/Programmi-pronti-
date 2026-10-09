#!/usr/bin/env node
// Entry point del server Express.js. Gestisce l'avvio del server su una porta disponibile
// tra PORT_START e PORT_END, la persistenza della porta in port.js per accesso client,
// e il graceful shutdown su SIGINT/SIGTERM.

import path from 'path';
import fs from 'fs';
import net from 'net';
import { execFile } from 'child_process';
// "><(((º> sabusabu <º)))><"
import app from './app';
import logger from './utils/logger';
import { resumeInterruptedJobs } from './batch/jobs';
import { avviaSorveglianza } from './batch/sorveglianza';
import { eseguiBackupGiornaliero } from './utils/backup';
import { UPLOAD_FOLDER, OUTPUT_FOLDER, pruneOlderThan } from './routes/helpers';
import { acquisisciLock, EsitoLock } from '../../shared/node/istanza-unica';
import { config, APP_DIR } from './config';

// Intervallo porte su cui provare ad avviare il server (fallback se la prima è occupata)
const PORT_START = 5050;
const PORT_END = 5059;

const HOST = config.host;
const SERVER_MODE = config.serverMode;

console.log('='.repeat(60));
console.log('Lettore DDT — da PDF a Excel (Node.js/TypeScript)');
console.log('='.repeat(60));
console.log('⚡ Server in ascolto...');
console.log();

// Scrive il numero della porta in un file JS accessibile dal client HTML
// per permettere al frontend di connettersi dinamicamente al server
function writePortJs(port: number): void {
  try {
    const portFile = path.join(APP_DIR, 'port.js');
    fs.writeFileSync(portFile, `var COSEDIL_PORT=${port};\n`, 'utf8');
  } catch (_) {}
}

// Cartelle di lavoro in %TEMP%: i PDF caricati e gli Excel già scaricati non
// hanno un tetto di file. Si potano all'avvio e poi ogni 6 ore, con la stessa
// soglia di 24h usata per i pending_pdfs (cleanupOldPendingPdfs).
const TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const TEMP_PRUNE_EVERY_MS = 6 * 60 * 60 * 1000;

function pulisciTemporanei(): void {
  const rimossi =
    pruneOlderThan(UPLOAD_FOLDER, TEMP_MAX_AGE_MS) + pruneOlderThan(OUTPUT_FOLDER, TEMP_MAX_AGE_MS);
  if (rimossi > 0) logger.info(`Pulizia cartelle temporanee: ${rimossi} file rimossi`);
}

// Apre il browser automaticamente su Windows (non in server mode)
// per lanciare l'app subito dopo l'avvio
function openBrowser(port: number): void {
  if (SERVER_MODE || process.platform !== 'win32') return;
  // localhost (non 127.0.0.1): stesso host del portale, così il cookie di
  // sessione è condiviso e il gate SSO non rimanda al portale (niente duplicati).
  const url = `http://localhost:${port}/`;
  execFile('cmd.exe', ['/c', 'start', '', url], () => {});
}

// Porta già occupata su QUALSIASI interfaccia? Il solo bind non basta a dirlo:
// su Windows un listener su 0.0.0.0:5050 e uno su 127.0.0.1:5050 convivono
// senza EADDRINUSE (successo davvero: due istanze attive sulla stessa porta,
// una visibile in LAN e una no). Un probe di connessione sul loopback becca
// entrambi i casi, perché chiunque sia in ascolto sulla porta risponde lì.
function portaOccupata(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port, timeout: 400 });
    sock.once('connect', () => {
      sock.destroy();
      resolve(true);
    });
    sock.once('error', () => resolve(false));
    sock.once('timeout', () => {
      sock.destroy();
      resolve(false);
    });
  });
}

// Avvia il server Express ricorsivamente trovando una porta libera
// e gestisce il graceful shutdown su SIGINT/SIGTERM per evitare corruzioni di file
async function startServer(port: number): Promise<void> {
  // Se supera PORT_END, non ci sono porte disponibili
  if (port > PORT_END) {
    console.error(`ERRORE: nessuna porta libera tra ${PORT_START} e ${PORT_END}`);
    process.exit(1);
  }

  if (await portaOccupata(port)) {
    console.log(`Porta ${port} occupata (istanza già attiva), provo ${port + 1}...`);
    return startServer(port + 1);
  }

  const server = app.listen(port, HOST, () => {
    logger.info(`✅ Server Express avviato su http://${HOST}:${port}`);
    writePortJs(port);
    openBrowser(port);
    // Conversioni batch interrotte da un riavvio: i batch già inviati sono già
    // pagati, quindi si raccolgono i risultati invece di rimandarli da capo.
    try {
      resumeInterruptedJobs();
    } catch (e) {
      logger.error(`Ripresa dei lavori batch fallita: ${(e as Error).message}`);
    }
    // Cartelle sorvegliate (batch.config.json → "sorvegliate"): i PDF che ci
    // finiscono dentro vengono convertiti da soli. Nessuna voce = nessun timer.
    try {
      avviaSorveglianza();
    } catch (e) {
      logger.error(`Sorveglianza cartelle non avviata: ${(e as Error).message}`);
    }
    // Backup giornaliero dei dati irrecuperabili (archivio commesse, utenti):
    // non blocca l'avvio, al massimo lo segnala nel log.
    eseguiBackupGiornaliero().catch((e) =>
      logger.error(`Backup giornaliero fallito: ${(e as Error).message}`)
    );
    // Temporanei: giro subito e poi periodico (unref: non tiene vivo il processo).
    pulisciTemporanei();
    setInterval(pulisciTemporanei, TEMP_PRUNE_EVERY_MS).unref();
  });

  // Gestisce errori di binding (es. porta già in uso)
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      // Porta occupata: prova la prossima in sequenza
      console.log(`Porta ${port} occupata, provo ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('Errore server:', err.message);
      process.exit(1);
    }
  });

  // Graceful shutdown: chiude il server in modo ordinato per evitare corruzioni
  // e timeout automatico a 5 secondi se la chiusura non completa
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} ricevuto — chiusura server in corso...`);
    server.close(() => {
      logger.info('Server chiuso correttamente.');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Un solo processo per cartella dati: le cache in memoria (data.json,
// users.enc, activity_log.json) hanno un unico scrittore per costruzione, e due
// istanze su porte diverse si cancellerebbero i salvataggi a vicenda.
// DDT_ISTANZA_LOCK=off serve alla prova di fumo e2e, che avvia una seconda
// istanza di proposito sulla stessa cartella.
const lock: EsitoLock =
  process.env.DDT_ISTANZA_LOCK === 'off'
    ? { acquisito: true, rilascia: () => {} }
    : acquisisciLock(APP_DIR);
if (!lock.acquisito) {
  console.error(
    `ERRORE: un'altra istanza è già in esecuzione su questa cartella (PID ${lock.pidAttivo}).\n` +
      `Chiudila prima di riavviare. Se il processo non esiste più, elimina ${lock.file}.`
  );
  process.exit(1);
}

void startServer(PORT_START);
