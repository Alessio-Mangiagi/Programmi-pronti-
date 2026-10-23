/** Vedi avvisi.js. Tipi scritti a mano, come per shared/sso e shared/node. */
// "><(((º> sabusabu <º)))><"
export type LivelloAvviso = 'info' | 'attenzione' | 'errore';

export interface Avviso {
  /** id dell'app nel registro del Portale ('ddt', 'scadenzario', ...) */
  app: string;
  titolo: string;
  testo?: string;
  livello?: LivelloAvviso;
  /** avvisi aperti con stessa app+chiave si sommano in uno solo */
  chiave?: string;
}

export declare const LIVELLI: LivelloAvviso[];
export declare const FRENO_MS: number;
export declare function cartellaAvvisi(): string;
/** Lascia un avviso per gli admin del Portale. Non lancia mai. */
export declare function segnala(avviso: Avviso): boolean;
/** Un errore dal log come avviso, accorpato e con freno anti-raffica. */
export declare function segnalaErrore(app: string, messaggio: string, dettaglio?: string): boolean;
export declare function chiaveDaMessaggio(messaggio: string): string;
/** Trasporto winston che inoltra gli 'error'. Passare il modulo winston dell'app. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export declare function trasportoWinston(winston: any, app: string): any;
/** console.error scrive come prima e lascia anche un avviso. Idempotente. */
export declare function intercettaConsole(app: string): void;
