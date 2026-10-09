// Passo 2 — traduzione: righe estratte -> record strutturati.
//
// PUNTO DI INNESTO. Un traduttore = un file .js in src/pipeline/traduttori/
// (o nella cartella indicata da TRADUTTORI_DIR, per il codice che arriva da
// fuori repo). All'avvio la cartella viene letta e ogni file registrato: non si
// tocca ne' questo file, ne' le API, ne' la UI, ne' i formati di uscita.
//
// CONTRATTO (vedi traduttori/_modello.js per lo scheletro da copiare):
//   export default {
//     nome: 'mio-modulo',                    // id nelle API, minuscolo-con-trattini
//     descrizione: 'a cosa serve',
//     colonne: [{ chiave, titolo, tipo }],   // colonne del file prodotto, in ordine
//     esegui(estratto, opzioni) {            // sincrono o async
//       return { intestazione: {}, record: [], avvisi: [] };
//     },
//   };
//
// L'estratto in ingresso e' quello di estrai.js:
//   { meta, avvisi: string[], pagine: [{ numero, larghezza, altezza, righe: [
//       { indice, y, testo, elementi: [{ testo, x, y, larghezza, altezza }] } ] }] }
// Ogni record deve avere le chiavi dichiarate in `colonne`; quello che c'e' in
// piu' finisce nel JSON ma non nelle colonne di xlsx/csv.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CONFIG } from '../config.js';

export { numero, NUM_RE } from './testo.js';

const QUI = path.dirname(fileURLToPath(import.meta.url));
export const CARTELLA_TRADUTTORI = path.join(QUI, 'traduttori');

/** @type {Map<string, {nome:string, descrizione:string, colonne:Array, esegui:Function, origine?:string}>} */
const REGISTRO = new Map();
let caricamento = null;

/** Problemi del contratto, in italiano e tutti insieme: chi consegna un traduttore deve capire al primo colpo. */
export function validaTraduttore(t, dove = '') {
  const problemi = [];
  const p = (m) => problemi.push(dove ? `${dove}: ${m}` : m);

  if (!t || typeof t !== 'object') return [dove ? `${dove}: nessun oggetto esportato` : 'nessun oggetto esportato'];
  if (typeof t.nome !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(t.nome)) {
    p('campo "nome" mancante o non valido (minuscolo, cifre e trattini)');
  }
  if (typeof t.esegui !== 'function') p('campo "esegui" mancante: deve essere una funzione (estratto, opzioni)');
  if (!Array.isArray(t.colonne) || t.colonne.length === 0) {
    p('campo "colonne" mancante: serve almeno una colonna { chiave, titolo }');
  } else {
    t.colonne.forEach((c, i) => {
      if (!c || typeof c.chiave !== 'string' || typeof c.titolo !== 'string') {
        p(`colonna ${i + 1}: servono "chiave" e "titolo" (stringhe)`);
      }
    });
  }
  if (t.descrizione != null && typeof t.descrizione !== 'string') p('campo "descrizione": deve essere una stringa');
  return problemi;
}

/** Registrazione diretta, per i test e per chi preferisce l'import esplicito. */
export function registra(traduttore, origine = 'registrazione diretta') {
  const problemi = validaTraduttore(traduttore, origine);
  if (problemi.length) throw new Error('traduttore non conforme al contratto:\n- ' + problemi.join('\n- '));
  REGISTRO.set(traduttore.nome, { ...traduttore, origine });
  return traduttore;
}

/** Un modulo puo' esportare il traduttore come default o come unico export oggetto. */
function estraiTraduttore(modulo) {
  // "><(((º> sabusabu <º)))><"
  if (modulo?.default && typeof modulo.default === 'object') return modulo.default;
  const candidati = Object.values(modulo || {}).filter((v) => v && typeof v === 'object' && 'esegui' in v);
  return candidati.length === 1 ? candidati[0] : candidati[0] || null;
}

async function caricaCartella(cartella, esiti) {
  if (!cartella || !fs.existsSync(cartella)) return;
  const file = fs.readdirSync(cartella)
    .filter((f) => f.endsWith('.js') && !f.startsWith('_') && !f.endsWith('.test.js'))
    .sort();

  for (const f of file) {
    const percorso = path.join(cartella, f);
    try {
      const traduttore = estraiTraduttore(await import(pathToFileURL(percorso).href));
      const problemi = validaTraduttore(traduttore, f);
      if (problemi.length) {
        esiti.errori.push(...problemi);
        continue;
      }
      REGISTRO.set(traduttore.nome, { ...traduttore, origine: percorso });
      esiti.caricati.push(traduttore.nome);
    } catch (e) {
      esiti.errori.push(`${f}: ${e.message}`);
    }
  }
}

/**
 * Legge le cartelle dei traduttori una volta sola.
 * Un file rotto non impedisce agli altri di funzionare: finisce in `errori`,
 * che il server stampa all'avvio e le API espongono.
 * @returns {Promise<{caricati:string[], errori:string[]}>}
 */
export function caricaTraduttori({ ricarica = false } = {}) {
  if (!caricamento || ricarica) {
    if (ricarica) REGISTRO.clear();
    caricamento = (async () => {
      const esiti = { caricati: [], errori: [] };
      await caricaCartella(CARTELLA_TRADUTTORI, esiti);
      await caricaCartella(CONFIG.traduttoriDir, esiti);
      return esiti;
    })();
  }
  return caricamento;
}

export async function elencaTraduttori() {
  await caricaTraduttori();
  return [...REGISTRO.values()].map(({ nome, descrizione, colonne }) => ({ nome, descrizione, colonne }));
}

export async function prendiTraduttore(nome) {
  await caricaTraduttori();
  return REGISTRO.get(nome) || null;
}

/** @returns {Promise<{intestazione:object, record:Array, avvisi:string[], colonne:Array}>} */
export async function traduci(nome, estratto, opzioni = {}) {
  await caricaTraduttori();
  const t = REGISTRO.get(nome);
  if (!t) {
    throw new Error(`traduttore sconosciuto: ${nome} (disponibili: ${[...REGISTRO.keys()].join(', ') || 'nessuno'})`);
  }
  const esito = await t.esegui(estratto, opzioni);
  return { intestazione: {}, record: [], avvisi: [], ...esito, colonne: t.colonne };
}
