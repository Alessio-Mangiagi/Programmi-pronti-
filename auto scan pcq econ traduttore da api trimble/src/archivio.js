// Archivio dei lavori su filesystem: un lavoro = una cartella sotto data/lavori/<id>.
// Niente database: i lavori sono pochi, il file e' l'artefatto e lo stato deve
// sopravvivere al riavvio del server (la coda in RAM no, e li' riparte da 'in_coda').
//
//   data/lavori/<id>/origine.pdf     il PDF caricato
//                   /stato.json      il record del lavoro (questo modulo)
//                   /estratto.json   uscita dell'estrazione (diagnostica)
//                   /esito.<ext>     il file da caricare su Trimble
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { cartellaLavori } from './config.js';

export const STATI = ['in_coda', 'in_corso', 'pronto', 'errore'];

export function nuovoId() {
  const t = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `${t}-${crypto.randomBytes(3).toString('hex')}`;
}

export const cartellaDi = (id) => path.join(cartellaLavori(), id);
export const fileDi = (id, nome) => path.join(cartellaDi(id), nome);

let contatore = 0;

const attendi = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function scriviAtomico(percorso, dati) {
  // Il temporaneo porta pid E contatore: con piu' lavori in parallelo due
  // scritture vicine avrebbero lo stesso nome.
  const tmp = `${percorso}.${process.pid}.${++contatore}.tmp`;
  await fsp.writeFile(tmp, dati);

  // Su Windows la rename fallisce (EPERM/EACCES/EBUSY) se qualcun altro ha il
  // file aperto anche solo in lettura: la UI interroga lo stato ogni 3 secondi e
  // l'antivirus ci mette del suo. Sono attese di millisecondi: si ritenta.
  for (let tentativo = 0; ; tentativo++) {
    try {
      await fsp.rename(tmp, percorso);
      return;
    } catch (e) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(e.code) || tentativo >= 9) {
        // Ultima spiaggia: scrittura diretta. Si perde l'atomicita' ma non il
        // lavoro; il temporaneo viene comunque tolto di mezzo.
        if (tentativo >= 9) {
          await fsp.writeFile(percorso, dati);
          await fsp.rm(tmp, { force: true });
          return;
        }
        await fsp.rm(tmp, { force: true });
        throw e;
      }
      await attendi(10 + tentativo * 15);
    }
  }
}

// Una catena di promesse per lavoro: le modifiche allo stesso stato.json
// avvengono in fila. Serve sia contro la rename concorrente sia contro
// l'aggiornamento perso (leggi-modifica-scrivi di due passi in parallelo).
const catene = new Map();

function inFila(id, azione) {
  const precedente = catene.get(id) || Promise.resolve();
  const prossima = precedente.then(azione, azione);
  catene.set(id, prossima.then(() => {}, () => {}));
  return prossima;
}

/** Crea la cartella del lavoro, ci salva il PDF e ne restituisce il record iniziale. */
export async function creaLavoro({ nomeFile, contenuto, traduttore, formato, opzioni = {}, utente = null }) {
  const id = nuovoId();
  await fsp.mkdir(cartellaDi(id), { recursive: true });
  await fsp.writeFile(fileDi(id, 'origine.pdf'), contenuto);

  const ora = new Date().toISOString();
  const lavoro = {
    id,
    creato: ora,
    aggiornato: ora,
    stato: 'in_coda',
    utente,
    nomeFile,
    byte: contenuto.length,
    traduttore,
    formato,
    opzioni,
    passi: [],
    risultato: null,        // { file, ext, righe, avvisi[] }
    trimble: null,          // { stato, fileId, versionId, caricatoIl, errore }
    errore: null,
  };
  await salva(lavoro);
  return lavoro;
}

async function scriviStato(lavoro) {
  lavoro.aggiornato = new Date().toISOString();
  await scriviAtomico(fileDi(lavoro.id, 'stato.json'), JSON.stringify(lavoro, null, 2));
  return lavoro;
}

export function salva(lavoro) {
  return inFila(lavoro.id, () => scriviStato(lavoro));
}

export async function leggi(id) {
  if (!/^[0-9a-z-]+$/i.test(id)) return null;      // l'id finisce in un path: niente traversal
  try {
    return JSON.parse(await fsp.readFile(fileDi(id, 'stato.json'), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

/** Applica una modifica al lavoro leggendolo e riscrivendolo (nessuna scrittura concorrente sullo stesso id). */
export function aggiorna(id, patch) {
  return inFila(id, async () => {
    const lavoro = await leggi(id);
    if (!lavoro) return null;
    Object.assign(lavoro, typeof patch === 'function' ? patch(lavoro) : patch);
    return scriviStato(lavoro);
  });
}

export async function segnaPasso(id, nome, campi = {}) {
  return aggiorna(id, (l) => {
    const passi = l.passi.filter((p) => p.nome !== nome);
    const vecchio = l.passi.find((p) => p.nome === nome) || { nome, iniziato: new Date().toISOString() };
    passi.push({ ...vecchio, ...campi, nome });
    return { passi };
  });
}

export async function elenca({ limite = 100 } = {}) {
  const base = cartellaLavori();
  if (!fs.existsSync(base)) return [];
  const ids = (await fsp.readdir(base, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .reverse()
    .slice(0, limite);
  const lavori = await Promise.all(ids.map((id) => leggi(id).catch(() => null)));
  return lavori.filter(Boolean);
}

export async function scriviArtefatto(id, nome, dati) {
  await scriviAtomico(fileDi(id, nome), dati);
  return fileDi(id, nome);
}

/** Cancella un lavoro con tutto quello che ha prodotto. */
export async function elimina(id) {
  const lavoro = await leggi(id);
  if (!lavoro) return false;
  catene.delete(id);
  await fsp.rm(cartellaDi(id), { recursive: true, force: true });
  return true;
}

/** Lavori rimasti 'in_corso' da un arresto del server: riportati in coda all'avvio. */
export async function recuperaInterrotti() {
  const lavori = await elenca({ limite: 500 });
  const rotti = lavori.filter((l) => l.stato === 'in_corso');
  for (const l of rotti) await aggiorna(l.id, { stato: 'in_coda' });
  return rotti.map((l) => l.id);
}
