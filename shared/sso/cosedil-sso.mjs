// Facciata ESM del gate SSO: la logica sta tutta in cosedil-sso.js (CommonJS),
// qui c'è solo il ponte per le app ESM (agente, ocr) e per i vite.config.
//
//   import cosedilSSO from '../shared/sso/cosedil-sso.mjs'
//   import cosedilSSO, { cosedilSocketIO } from '../shared/sso/cosedil-sso.mjs'
//
// Passa dal default import e non dai named export del CJS: l'analisi statica dei
// named export di un modulo CommonJS non è garantita, il default sì.
import mod from './cosedil-sso.js';

export const cosedilSSO = mod.cosedilSSO;
export const cosedilSocketIO = mod.cosedilSocketIO;
export const verificaSessione = mod.verificaSessione;
export const leggiSid = mod.leggiSid;
export const PORTAL = mod.PORTAL;
export const FAIL_OPEN = mod.FAIL_OPEN;

export default mod;
