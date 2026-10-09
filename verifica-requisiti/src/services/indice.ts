/**
 * indice.ts — ricerca full-text sui documenti.
 *
 * Indice in memoria, ricostruito all'avvio dal testo già salvato: con qualche
 * migliaio di documenti costa pochi MB e risponde in millisecondi, senza
 * portarsi dietro un motore di ricerca da installare e mantenere.
 *
 * La normalizzazione è a lunghezza costante (una lettera accentata diventa una
 * lettera semplice, mai zero o due): così l'offset trovato nel testo
 * normalizzato punta allo stesso carattere nel testo originale, e i riscontri
 * si possono mostrare com'erano scritti.
 */
import { Documento, EsitoRicerca, Riscontro } from '../tipi';
import { elencaDocumenti } from '../models/archivio';

const ACCENTI: Record<string, string> = {
  à: 'a', á: 'a', â: 'a', ä: 'a', ã: 'a',
  è: 'e', é: 'e', ê: 'e', ë: 'e',
  ì: 'i', í: 'i', î: 'i', ï: 'i',
  ò: 'o', ó: 'o', ô: 'o', ö: 'o', õ: 'o',
  ù: 'u', ú: 'u', û: 'u', ü: 'u',
  ç: 'c', ñ: 'n',
};

/** Minuscolo, senza accenti, stessa lunghezza dell'originale. */
export function normalizza(testo: string): string {
  let out = '';
  for (const ch of testo.toLowerCase()) out += ACCENTI[ch] ?? ch;
  return out;
}

interface VoceIndice {
  id: string;
  nomeFile: string;
  etichette: string[];
  /** Testo normalizzato e testo originale, pagina per pagina. */
  pagine: Array<{ numero: number; norm: string; orig: string }>;
}

const indice = new Map<string, VoceIndice>();

export function indicizza(doc: Documento): void {
  indice.set(doc.id, {
    id: doc.id,
    nomeFile: doc.nomeFile,
    etichette: doc.etichette,
    pagine: doc.pagine.map((p) => ({ numero: p.numero, norm: normalizza(p.testo), orig: p.testo })),
  });
}

export function rimuoviDaIndice(id: string): void {
  indice.delete(id);
}

export function caricaIndice(): number {
  indice.clear();
  for (const doc of elencaDocumenti({ stato: 'pronto' })) indicizza(doc);
  return indice.size;
}

export function documentiIndicizzati(): number {
  return indice.size;
}

/** Poche righe attorno al riscontro, per leggerlo senza riaprire il file. */
export function estrattoAttorno(testo: string, offset: number, lunghezza: number, contorno = 90): string {
  const da = Math.max(0, offset - contorno);
  const a = Math.min(testo.length, offset + lunghezza + contorno);
  return (da > 0 ? '…' : '') + testo.slice(da, a).replace(/\s+/g, ' ').trim() + (a < testo.length ? '…' : '');
}

/** Tutte le posizioni di `termine` dentro `testo` (entrambi già normalizzati). */
export function trovaOccorrenze(testo: string, termine: string): number[] {
  const posizioni: number[] = [];
  if (!termine) return posizioni;
  let da = testo.indexOf(termine);
  while (da !== -1) {
    posizioni.push(da);
    // "><(((º> sabusabu <º)))><"
    da = testo.indexOf(termine, da + termine.length);
  }
  return posizioni;
}

/**
 * Spezza la query in termini. Le virgolette tengono insieme una frase:
 *   durc "regolarita contributiva"  ->  ['durc', 'regolarita contributiva']
 */
export function termini(query: string): string[] {
  const norm = normalizza(query.trim());
  const trovati = norm.match(/"[^"]+"|\S+/g) ?? [];
  return trovati.map((t) => t.replace(/"/g, '').trim()).filter((t) => t.length > 1);
}

export interface OpzioniRicerca {
  /** Massimo documenti restituiti. */
  limite?: number;
  /** Massimo riscontri mostrati per documento. */
  riscontriPerDocumento?: number;
  /** Solo documenti con questa etichetta. */
  etichetta?: string;
}

/**
 * Cerca i termini nei documenti pronti. Tutti i termini devono comparire nello
 * stesso documento (AND), non necessariamente nella stessa pagina.
 */
export function cerca(query: string, opzioni: OpzioniRicerca = {}): EsitoRicerca[] {
  const cercati = termini(query);
  if (cercati.length === 0) return [];

  const limite = opzioni.limite ?? 50;
  const maxRiscontri = opzioni.riscontriPerDocumento ?? 5;
  const esiti: EsitoRicerca[] = [];

  for (const voce of indice.values()) {
    if (opzioni.etichetta && !voce.etichette.includes(opzioni.etichetta)) continue;

    let occorrenze = 0;
    const riscontri: Riscontro[] = [];
    const trovatiTutti = cercati.every((t) => {
      let presente = false;
      for (const pagina of voce.pagine) {
        for (const offset of trovaOccorrenze(pagina.norm, t)) {
          presente = true;
          occorrenze++;
          if (riscontri.length < maxRiscontri) {
            riscontri.push({
              pagina: pagina.numero,
              offset,
              estratto: estrattoAttorno(pagina.orig, offset, t.length),
            });
          }
        }
      }
      return presente;
    });

    if (trovatiTutti) {
      esiti.push({ documentoId: voce.id, nomeFile: voce.nomeFile, occorrenze, riscontri });
    }
  }

  return esiti.sort((a, b) => b.occorrenze - a.occorrenze).slice(0, limite);
}
