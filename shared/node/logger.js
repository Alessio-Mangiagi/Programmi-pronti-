/**
 * logger.js — configurazione comune di winston per le app della suite.
 *
 * Qui non si crea il logger: si costruiscono le OPZIONI. shared/ non ha un
 * node_modules proprio e `require('winston')` da qui non troverebbe niente —
 * per lo stesso motivo shared/sso usa solo moduli core. Ogni app passa le
 * opzioni al proprio winston:
 *
 *   const winston = require('winston');
 *   const { opzioniLogger } = require('../../shared/node/logger');
 *   const logger = winston.createLogger(opzioniLogger(winston, {
 *     servizio: 'verifica-requisiti',
 *     cartella: APP_DIR,
 *   }));
 *
 * Cosa c'era prima: due file logger.ts identici a meno del nome del servizio e
 * di dove finiscono i log. Rotazione, dimensione massima, numero di file e
 * formato erano ricopiati — e cambiarli in una app sola sarebbe passato
 * inosservato finché non serviva leggere il log dell'altra.
 */
'use strict';

/** Byte oltre i quali il file di log ruota. 10 MB: qualche giorno di esercizio. */
const DIMENSIONE_MAX = 10_000_000;

/** File tenuti per ogni livello, oltre il corrente. */
const FILE_MAX = 3;

/**
 * @param winston il modulo winston dell'app (vedi sopra: qui non si può require)
 * @param opzioni.servizio nome che finisce in ogni riga come `service`
 * @param opzioni.cartella dove scrivere error.log e combined.log
 * @param opzioni.consoleInSviluppo aggiunge la console fuori da produzione (default: sì)
 */
function opzioniLogger(winston, { servizio, cartella, consoleInSviluppo = true }) {
  if (!servizio) throw new Error('opzioniLogger: manca "servizio"');
  if (!cartella) throw new Error('opzioniLogger: manca "cartella"');

  const path = require('path');
  const fileComuni = { maxsize: DIMENSIONE_MAX, maxFiles: FILE_MAX, tailable: true };

  const transports = [
    new winston.transports.File({
      filename: path.join(cartella, 'error.log'),
      level: 'error',
      ...fileComuni,
    }),
    new winston.transports.File({
      filename: path.join(cartella, 'combined.log'),
      ...fileComuni,
    }),
  ];

  // In produzione la console non la legge nessuno (l'app parte da un .vbs, senza
  // finestra) e raddoppierebbe soltanto il lavoro di formattazione.
  if (consoleInSviluppo && process.env.NODE_ENV !== 'production') {
    transports.push(
      new winston.transports.Console({
        format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
      })
    );
  }

  return {
    level: 'info',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json()
    ),
    defaultMeta: { service: servizio },
    transports,
  };
}

module.exports = { opzioniLogger, DIMENSIONE_MAX, FILE_MAX };
