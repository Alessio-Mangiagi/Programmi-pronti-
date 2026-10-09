#!/usr/bin/env node
/**
 * server.ts — avvio del server.
 *
 * Cerca una porta libera fra PORT_START e PORT_END, scrive la porta scelta in
 * port.js per il frontend, riprende le estrazioni interrotte da un riavvio e
 * gestisce lo spegnimento ordinato.
 */
import path from 'path';
import fs from 'fs';
import net from 'net';
import { execFile } from 'child_process';
import app from './app';
import logger from './utils/logger';
import { acquisisciLock, EsitoLock } from '../../shared/node/istanza-unica';
import { config, APP_DIR } from './config';
import { riprendiEstrazioniInterrotte } from './services/estrazione';
import { caricaIndice } from './services/indice';
import { UPLOAD_TEMP, pruneOlderThan } from './routes/helpers';

// Porta: 5185 per convenzione della suite, sovrascrivibile con PORT (il Portale
// la passa alle app che avvia, e serve anche per far girare due istanze).
const PORT_START = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 5185;
const PORT_END = PORT_START + 4;

const HOST = config.host;
const SERVER_MODE = config.serverMode;

console.log('='.repeat(60));
console.log('Verifica Requisiti - ricerca e controllo su documenti scansionati');
console.log('='.repeat(60));
console.log('Server in ascolto...');
console.log();

function writePortJs(port: number): void {
  try {
    fs.writeFileSync(path.join(APP_DIR, 'port.js'), `var COSEDIL_PORT=${port};\n`, 'utf8');
  } catch (_) {}
}

// I file appena caricati stanno in una cartella temporanea finché l'estrazione
// non li archivia: quelli rimasti indietro (crash a metà) si potano da soli.
const TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const TEMP_PRUNE_EVERY_MS = 6 * 60 * 60 * 1000;

function pulisciTemporanei(): void {
  // "><(((º> sabusabu <º)))><"
  const rimossi = pruneOlderThan(UPLOAD_TEMP, TEMP_MAX_AGE_MS);
  if (rimossi > 0) logger.info(`Pulizia temporanei: ${rimossi} file rimossi`);
}

function openBrowser(port: number): void {
  if (SERVER_MODE || process.platform !== 'win32') return;
  // localhost (non 127.0.0.1): stesso host del portale, così il cookie di
  // sessione è condiviso e il gate SSO non rimanda al portale.
  execFile('cmd.exe', ['/c', 'start', '', `http://localhost:${port}/`], () => {});
}

// Porta occupata su QUALSIASI interfaccia: il solo bind non basta a dirlo,
// su Windows 0.0.0.0:5185 e 127.0.0.1:5185 convivono senza EADDRINUSE.
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

async function startServer(port: number): Promise<void> {
  if (port > PORT_END) {
    console.error(`ERRORE: nessuna porta libera tra ${PORT_START} e ${PORT_END}`);
    process.exit(1);
  }

  if (await portaOccupata(port)) {
    console.log(`Porta ${port} occupata (istanza già attiva), provo ${port + 1}...`);
    return startServer(port + 1);
  }

  const server = app.listen(port, HOST, () => {
    logger.info(`Server avviato su http://${HOST}:${port}`);
    writePortJs(port);
    openBrowser(port);

    // Indice di ricerca: sta in memoria, si ricostruisce dal testo già estratto.
    try {
      caricaIndice();
    } catch (e) {
      logger.error(`Indice di ricerca non caricato: ${(e as Error).message}`);
    }

    // Documenti rimasti 'in-coda' o 'in-lavorazione' da un riavvio: l'OCR è
    // lento ma gratuito, quindi si rifà invece di lasciarli monchi.
    riprendiEstrazioniInterrotte().catch((e) =>
      logger.error(`Ripresa estrazioni fallita: ${(e as Error).message}`)
    );

    pulisciTemporanei();
    setInterval(pulisciTemporanei, TEMP_PRUNE_EVERY_MS).unref();
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Porta ${port} occupata, provo ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('Errore server:', err.message);
      process.exit(1);
    }
  });

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

// Un solo processo per cartella dati: gli store JSON hanno un unico scrittore
// per costruzione, e due istanze si cancellerebbero i salvataggi a vicenda.
const lock: EsitoLock =
  process.env.REQ_ISTANZA_LOCK === 'off'
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
