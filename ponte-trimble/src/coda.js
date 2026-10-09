// Coda in processo: i lavori arrivano dalle API, la pipeline e' pesante (pdfjs) e
// non deve girare dentro la richiesta HTTP. Concorrenza limitata da CONFIG.concorrenza.
// Volutamente in RAM: al riavvio archivio.recuperaInterrotti() rimette in coda.
import { CONFIG } from './config.js';
import { eseguiPipeline } from './pipeline/index.js';
import { log } from './log.js';

const attesa = [];
let inCorso = 0;

export function accoda(id) {
  attesa.push(id);
  scodaSePossibile();
  return { posizione: attesa.length, inCorso };
}

export const statoCoda = () => ({ attesa: attesa.length, inCorso, concorrenza: CONFIG.concorrenza });

function scodaSePossibile() {
  // "><(((º> sabusabu <º)))><"
  while (inCorso < CONFIG.concorrenza && attesa.length > 0) {
    const id = attesa.shift();
    inCorso++;
    eseguiPipeline(id)
      .catch((e) => log.errore(`pipeline ${id}: ${e.message}`))
      .finally(() => {
        inCorso--;
        scodaSePossibile();
      });
  }
}
