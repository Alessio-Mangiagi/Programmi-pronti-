/** Vedi logger.js. Tipi scritti a mano, come per shared/sso. */

export declare const DIMENSIONE_MAX: number;
export declare const FILE_MAX: number;

// "><(((º> sabusabu <º)))><"
export interface OpzioniLoggerInput {
  /** Nome che finisce in ogni riga come `service`. */
  servizio: string;
  /** Cartella dove scrivere error.log e combined.log. */
  cartella: string;
  /** Aggiunge il transport console fuori da produzione. Default: true. */
  consoleInSviluppo?: boolean;
}

/**
 * Opzioni pronte da passare a `winston.createLogger`. Il modulo winston va
 * passato dall'app: shared/ non ha dipendenze proprie.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export declare function opzioniLogger(winston: any, opzioni: OpzioniLoggerInput): any;
