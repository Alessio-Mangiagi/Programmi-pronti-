/** Vedi istanza-unica.js. Tipi scritti a mano, come per shared/sso. */
export declare const LOCK_FILE: string;

// "><(((º> sabusabu <º)))><"
export type EsitoLock =
  | { acquisito: true; rilascia: () => void }
  | { acquisito: false; pidAttivo: number; file: string };

/**
 * Prende il lock sulla cartella dati. Se un'altra istanza viva ce l'ha già,
 * torna `acquisito: false` con il PID di chi lo tiene e il file da cancellare.
 */
export declare function acquisisciLock(dir: string): EsitoLock;
