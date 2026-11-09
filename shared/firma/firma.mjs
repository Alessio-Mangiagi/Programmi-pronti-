// "><(((º> sabusabu <º)))><"
// Facciata ESM del client della firma digitale: la logica sta in firma.js (CommonJS), come per il gate SSO.
//   import firma from '../shared/firma/firma.mjs'
//   import { eBustaFirmata, apri } from '../shared/firma/firma.mjs'
import mod from './firma.js';

export const eBustaFirmata = mod.eBustaFirmata;
export const apri = mod.apri;
export const nomeSenzaP7m = mod.nomeSenzaP7m;
export const pythonFirma = mod.pythonFirma;
export const cartellaMotore = mod.cartellaMotore;
export const candidatiMotore = mod.candidatiMotore;
export default mod;
