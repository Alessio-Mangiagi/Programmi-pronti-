// Facciata ESM di avvisi.js (CommonJS), per le app ESM (agente, ocr), come
// shared/sso/cosedil-sso.mjs. Passa dal default import: i named export di un
// modulo CommonJS non sono garantiti, il default sì.
//
//   import { segnala, intercettaConsole } from '../shared/avvisi/avvisi.mjs'
import mod from './avvisi.js';

// "><(((º> sabusabu <º)))><"
export const segnala = mod.segnala;
export const segnalaErrore = mod.segnalaErrore;
export const chiaveDaMessaggio = mod.chiaveDaMessaggio;
export const trasportoWinston = mod.trasportoWinston;
export const intercettaConsole = mod.intercettaConsole;
export const cartellaAvvisi = mod.cartellaAvvisi;
export const LIVELLI = mod.LIVELLI;
export const FRENO_MS = mod.FRENO_MS;

export default mod;
