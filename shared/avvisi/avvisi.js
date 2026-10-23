/**
 * avvisi.js — segnala un avviso agli amministratori del Portale.
 *
 * Ogni app della suite gira sullo stesso server del Portale (cartelle sorelle):
 * un avviso è un piccolo file JSON lasciato nella cartella di arrivo del
 * Portale, che lo raccoglie e lo mostra nella pagina Avvisi e alla plancia
 * dell'admin appena si collega.
 *
 * File e non HTTP di proposito: l'avviso arriva anche se il Portale in quel
 * momento è spento (lo legge al giro dopo), non servono token fra le app e
 * nessuna rotta nuova resta aperta in rete.
 *
 * Scrittura atomica (.tmp + rename): il Portale ignora i .tmp, quindi non legge
 * mai un file a metà. segnala() non lancia mai: un avviso perso non deve far
 * fallire il lavoro che lo ha prodotto.
 *
 * Cartella: SUITE_AVVISI_DIR se impostata, altrimenti portale/data/avvisi-in
 * (sotto test: nessuna). Stessa regola in avvisi.py e nel Portale.
 */
'use strict';

// "><(((º> sabusabu <º)))><"
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LIVELLI = ['info', 'attenzione', 'errore'];

// Sotto test (jest, node --test, vitest) gli avvisi vanno solo in una cartella
// indicata apposta: un test che prova un errore non deve finire nel portale vero.
const IN_TEST = !!(process.env.JEST_WORKER_ID || process.env.NODE_TEST_CONTEXT || process.env.VITEST || process.env.NODE_ENV === 'test');

function cartellaAvvisi() {
  const env = String(process.env.SUITE_AVVISI_DIR || '').trim();
  if (env) return path.resolve(env);
  return IN_TEST ? '' : path.resolve(__dirname, '..', '..', 'portale', 'data', 'avvisi-in');
}

/**
 * Lascia un avviso per gli admin. Torna true se il file è stato scritto.
 *
 * - app:     id dell'app nel registro del Portale ('ddt', 'scadenzario', ...)
 * - titolo:  una riga, cosa è successo
 * - testo:   dettaglio facoltativo
 * - livello: 'info' | 'attenzione' | 'errore' (default 'attenzione')
 * - chiave:  facoltativa; avvisi aperti con stessa app+chiave diventano uno
 *            solo con un contatore, così un errore ripetuto ogni minuto non
 *            riempie la pagina
 */
function segnala({ app, titolo, testo = '', livello = 'attenzione', chiave = '' } = {}) {
  try {
    if (!app || !titolo) return false;
    const avviso = {
      app: String(app).slice(0, 40),
      titolo: String(titolo).slice(0, 200),
      testo: String(testo || '').slice(0, 4000),
      livello: LIVELLI.includes(livello) ? livello : 'attenzione',
      chiave: String(chiave || '').slice(0, 200),
      data: new Date().toISOString(),
    };
    const dir = cartellaAvvisi();
    if (!dir) return false;
    fs.mkdirSync(dir, { recursive: true });
    const nome = `${Date.now()}-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
    const tmp = path.join(dir, nome + '.tmp');
    fs.writeFileSync(tmp, JSON.stringify(avviso), 'utf8');
    fs.renameSync(tmp, path.join(dir, nome + '.json'));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Errori dal log: ogni errore loggato diventa un avviso, senza toccare i punti
// in cui l'app logga. Stessa regola di avvisi.py (GestoreAvvisi).
// ---------------------------------------------------------------------------

// Lo stesso errore non scrive più di un file a questo intervallo: un errore in
// un ciclo stretto non deve riempire la cartella del portale.
const FRENO_MS = 60_000;
const ultimi = new Map();   // chiave -> ultimo invio

/** Prima riga, numeri e percorsi tolti: "Job 12 fallito" e "Job 13 fallito" = un avviso. */
function chiaveDaMessaggio(messaggio) {
  const riga = String(messaggio || '').trim().split(/\r?\n/)[0] || '';
  return 'log:' + riga
    .replace(/[A-Za-z]:\\[^\s'"]+|\/[^\s'"]+\/[^\s'"]*/g, '<percorso>')
    .replace(/\d+/g, '#')
    .slice(0, 150);
}

/** Un errore dal log come avviso, con freno anti-raffica. Torna true se scritto. */
function segnalaErrore(app, messaggio, dettaglio = '') {
  const testo = String(messaggio || '').trim();
  if (!testo) return false;
  const chiave = chiaveDaMessaggio(testo);
  const ora = Date.now();
  if (ora - (ultimi.get(chiave) || -Infinity) < FRENO_MS) return false;
  ultimi.set(chiave, ora);
  if (ultimi.size > 500) ultimi.delete(ultimi.keys().next().value);
  const titolo = testo.split(/\r?\n/)[0];
  const corpo = dettaglio && !testo.includes(dettaglio) ? `${testo}\n\n${dettaglio}` : testo;
  return segnala({ app, titolo, testo: corpo, livello: 'errore', chiave });
}

/**
 * Trasporto winston: gli 'error' del logger diventano avvisi. winston va
 * passato dall'app (shared/ non ha node_modules, vedi shared/node/logger.js).
 */
function trasportoWinston(winston, app) {
  class TrasportoAvvisi extends winston.Transport {
    log(info, callback) {
      setImmediate(() => this.emit('logged', info));
      try {
        const msg = typeof info.message === 'string' ? info.message : JSON.stringify(info.message);
        segnalaErrore(app, msg, info.stack || '');
      } catch { /* il log non deve mai rompersi per un avviso */ }
      callback();
    }
  }
  return new TrasportoAvvisi({ level: 'error' });
}

/**
 * Per le app senza winston: console.error continua a scrivere come prima e in
 * più lascia un avviso. Idempotente.
 */
function intercettaConsole(app) {
  if (console.error.__avvisi) return;
  const originale = console.error.bind(console);
  const avvolta = (...args) => {
    originale(...args);
    try {
      const err = args.find((a) => a instanceof Error);
      const testo = args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : safeJson(a))).join(' ');
      segnalaErrore(app, testo, err && err.stack ? err.stack : '');
    } catch { /* idem */ }
  };
  avvolta.__avvisi = true;
  console.error = avvolta;
}

function safeJson(v) {
  try { return JSON.stringify(v); } catch { return String(v); }
}

module.exports = { segnala, segnalaErrore, chiaveDaMessaggio, trasportoWinston, intercettaConsole, cartellaAvvisi, LIVELLI, FRENO_MS };
