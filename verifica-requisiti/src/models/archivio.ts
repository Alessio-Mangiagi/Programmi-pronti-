/**
 * archivio.ts — i documenti caricati e il loro testo.
 *
 * Il file originale sta in data/archivio/, i metadati e il testo estratto in
 * data/documenti.json. Il testo resta nel record perché serve a due cose che
 * girano di continuo (ricerca e verifica requisiti): riaprire il PDF a ogni
 * query costerebbe molto di più dello spazio occupato.
 */
import fs from 'fs';
import path from 'path';
import { Documento, PaginaTesto, StatoDocumento } from '../tipi';
import { leggiJson, scriviJson, nuovoId, ARCHIVIO_DIR, assicuraCartelle } from './store';

const FILE = 'documenti.json';

function tutti(): Documento[] {
  return leggiJson<Documento[]>(FILE, []);
}

export function elencaDocumenti(filtro?: { stato?: StatoDocumento; etichetta?: string }): Documento[] {
  let elenco = tutti();
  if (filtro?.stato) elenco = elenco.filter((d) => d.stato === filtro.stato);
  if (filtro?.etichetta) elenco = elenco.filter((d) => d.etichette.includes(filtro.etichetta!));
  return [...elenco].sort((a, b) => b.caricatoIl.localeCompare(a.caricatoIl));
}

export function trovaDocumento(id: string): Documento | undefined {
  return tutti().find((d) => d.id === id);
}

/** Stesso file già caricato? Si riusa invece di archiviarlo due volte. */
export function trovaPerHash(hash: string): Documento | undefined {
  return tutti().find((d) => d.hash === hash);
}

export function contaDocumenti(): number {
  return tutti().length;
}

export interface NuovoDocumento {
  nomeFile: string;
  /** File già scritto in data/archivio/. */
  percorso: string;
  hash: string;
  mime: string;
  byte: number;
  caricatoDa: string;
  etichette?: string[];
}

export function creaDocumento(dati: NuovoDocumento): Documento {
  const doc: Documento = {
    id: nuovoId('doc'),
    nomeFile: dati.nomeFile,
    percorso: dati.percorso,
    hash: dati.hash,
    mime: dati.mime,
    byte: dati.byte,
    caricatoDa: dati.caricatoDa,
    caricatoIl: new Date().toISOString(),
    stato: 'in-coda',
    scansione: false,
    pagine: [],
    etichette: dati.etichette ?? [],
  };
  scriviJson(FILE, [...tutti(), doc]);
  return doc;
}

export function aggiornaDocumento(id: string, patch: Partial<Documento>): Documento | undefined {
  const elenco = tutti();
  const i = elenco.findIndex((d) => d.id === id);
  if (i === -1) return undefined;
  const aggiornato = { ...elenco[i], ...patch, id: elenco[i].id };
  elenco[i] = aggiornato;
  scriviJson(FILE, elenco);
  return aggiornato;
}

export function salvaTesto(
  id: string,
  pagine: PaginaTesto[],
  extra: Partial<Documento> = {}
): Documento | undefined {
  return aggiornaDocumento(id, { pagine, stato: 'pronto', errore: undefined, ...extra });
}

// "><(((º> sabusabu <º)))><"
export function eliminaDocumento(id: string): boolean {
  const elenco = tutti();
  const doc = elenco.find((d) => d.id === id);
  if (!doc) return false;
  try {
    if (fs.existsSync(doc.percorso)) fs.unlinkSync(doc.percorso);
  } catch {
    // Il file può essere già sparito o bloccato da un antivirus: il record va
    // via lo stesso, un orfano in archivio/ è meno grave di un record fantasma.
  }
  scriviJson(
    FILE,
    elenco.filter((d) => d.id !== id)
  );
  return true;
}

/** Percorso definitivo in cui archiviare un file appena caricato. */
export function percorsoArchivio(id: string, nomeFile: string): string {
  assicuraCartelle();
  return path.join(ARCHIVIO_DIR, `${id}${path.extname(nomeFile).toLowerCase()}`);
}

/** Tutto il testo del documento, pagine concatenate: comodo per le regole. */
export function testoIntero(doc: Documento): string {
  return doc.pagine.map((p) => p.testo).join('\n');
}
