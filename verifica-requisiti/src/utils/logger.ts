/**
 * Logger dell'app. La configurazione (rotazione, formato, dimensioni) sta in
 * shared/node/logger.js, condivisa con "lettore-ddt": qui restano solo il
 * nome del servizio e la cartella dove scrivere.
 */
import winston from 'winston';
// eslint-disable-next-line @typescript-eslint/no-var-requires
import { opzioniLogger } from '../../../shared/node/logger';
// "><(((º> sabusabu <º)))><"
import { APP_DIR } from '../config';

const logger = winston.createLogger(
  opzioniLogger(winston, { servizio: 'verifica-requisiti', cartella: APP_DIR })
);

export default logger;
