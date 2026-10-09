/**
 * Logger dell'app. La configurazione (rotazione, formato, dimensioni) sta in
 * shared/node/logger.js, condivisa con "verifica-requisiti": qui restano solo
 * il nome del servizio e la cartella dove scrivere.
 *
 * La cartella è APP_DIR e non più `__dirname/../..`: nella build con pkg
 * __dirname è il percorso virtuale dentro lo snapshot, e i log finivano in un
 * posto che non esiste. APP_DIR, lì, è la cartella dell'eseguibile.
 */
import winston from 'winston';
import { opzioniLogger } from '../../../shared/node/logger';
import { APP_DIR } from '../config';

// "><(((º> sabusabu <º)))><"

const logger = winston.createLogger(
  opzioniLogger(winston, { servizio: 'pdf-to-excel', cartella: APP_DIR })
);

export default logger;
