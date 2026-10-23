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
export declare function cartellaAvvisi(): string;
/** Lascia un avviso per gli admin del Portale. Non lancia mai. */
export declare function segnala(avviso: Avviso): boolean;
