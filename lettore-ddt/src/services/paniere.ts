// paniere.ts — Spazio dove mettere da parte estrazioni JSON e unirle a comando.
//
// Il batch sa già produrre una tabella unica, ma solo dentro UN lavoro: i PDF
// convertiti ieri e quelli di oggi finiscono in due Excel diversi. Il paniere è
// l'accumulatore che manca — ci si buttano dentro JSON da qualunque fonte
// (archivio della commessa, file dal PC, esito di un lavoro batch, estrazione
// manuale della chat) e quando serve un solo bottone li impila in un Excel.
//
// Storage: data/<commessa>/paniere/<id>.json, un file per voce, con la stessa
// forma di sempre — meta in testa e l'estrazione grezza sotto `data`. File per
// voce e non un unico indice: due schede aperte che aggiungono insieme non si
// sovrascrivono a vicenda, e una voce corrotta non porta giù il paniere.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { commessaDataDir } from '../routes/helpers';
import { extractDdtNumbers } from './ddtArchive';
import { mergeSheets, MergeEntry } from './mergeSheets';

/** Oltre questo il paniere non accetta: è un'area di lavoro, non un archivio. */
export const MAX_ITEMS = 500;
/** Una singola estrazione oltre i 5MB è quasi sempre un file sbagliato. */
export const MAX_ITEM_BYTES = 5 * 1024 * 1024;

export type PaniereSource = 'archivio' | 'upload' | 'batch' | 'chat';

/** Voce del paniere senza il payload: quello che serve alla lista in pagina. */
export interface PaniereItem {
  id: string;
  label: string;
  source: PaniereSource;
  addedAt: string;
  addedBy: string;
  /** Nomi dei fogli e righe totali: fanno vedere cosa entrerà nell'unione. */
  sheetNames: string[];
  rows: number;
  /** Numeri DDT trovati: servono a segnalare i doppioni fra le voci. */
  ddt?: string[];
}

interface StoredItem extends PaniereItem {
  data: Record<string, unknown>;
}

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function paniereFolder(commessaId: string): string {
  const dir = path.join(commessaDataDir(commessaId), 'paniere');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Gli id sono UUID: la regex che li valida è anche la difesa dal path traversal
// via :id, come per i job batch.
function itemPath(commessaId: string, id: string): string | null {
  if (!ID_RE.test(id)) return null;
  return path.join(paniereFolder(commessaId), `${id}.json`);
}

/**
 * Verifica che il JSON sia un'estrazione utilizzabile (almeno un foglio) e ne
 * ricava il riassunto per la lista. Un JSON qualunque preso dal disco finirebbe
 * altrimenti nel paniere per poi sparire in silenzio dall'unione.
 */
export function describeExtraction(
  data: unknown
): { sheetNames: string[]; rows: number } | { error: string } {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { error: 'non è un oggetto JSON' };
  }
  const sheets = (data as { sheets?: unknown }).sheets;
  if (!Array.isArray(sheets) || sheets.length === 0) {
    return { error: 'manca l\'elenco dei fogli (campo "sheets")' };
  }
  const sheetNames: string[] = [];
  let rows = 0;
  for (const s of sheets) {
    const sheet = s as { name?: unknown; rows?: unknown };
    sheetNames.push(typeof sheet.name === 'string' && sheet.name ? sheet.name : 'Foglio');
    if (Array.isArray(sheet.rows)) rows += sheet.rows.length;
  }
  return { sheetNames, rows };
}

function stripPayload(stored: StoredItem): PaniereItem {
  const { data: _data, ...meta } = stored;
  void _data;
  return meta;
}

function readStored(commessaId: string, id: string): StoredItem | null {
  const full = itemPath(commessaId, id);
  if (!full) return null;
  try {
    return JSON.parse(fs.readFileSync(full, 'utf8')) as StoredItem;
  } catch {
    return null;
  }
}

/** Voci nel paniere, dalla più vecchia alla più recente (ordine di unione). */
export function listPaniere(commessaId: string): PaniereItem[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(paniereFolder(commessaId)).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  return names
    .map((n) => readStored(commessaId, n.replace(/\.json$/, '')))
    .filter((s): s is StoredItem => s !== null)
    .map(stripPayload)
    .sort((a, b) => a.addedAt.localeCompare(b.addedAt));
}

export function countPaniere(commessaId: string): number {
  try {
    return fs.readdirSync(paniereFolder(commessaId)).filter((f) => f.endsWith('.json')).length;
  } catch {
    return 0;
  }
}

export interface AddResult {
  item?: PaniereItem;
  error?: string;
}

/**
 * Mette una estrazione nel paniere. Non deduplica: due PDF diversi possono
 * contenere lo stesso DDT ed è l'utente a decidere se è un doppione o no — il
 * paniere si limita a mostrare cosa c'è dentro.
 */
export function addToPaniere(
  commessaId: string,
  input: { label: string; source: PaniereSource; addedBy: string; data: unknown }
): AddResult {
  if (countPaniere(commessaId) >= MAX_ITEMS) {
    return { error: `Il paniere è pieno (${MAX_ITEMS} voci): unisci o svuota prima di aggiungere` };
  }

  const descr = describeExtraction(input.data);
  if ('error' in descr) return { error: `Estrazione non valida: ${descr.error}` };

  const serialized = JSON.stringify(input.data);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_ITEM_BYTES) {
    return { error: `Estrazione troppo grande (oltre ${MAX_ITEM_BYTES / 1024 / 1024}MB)` };
  }

  const stored: StoredItem = {
    id: crypto.randomUUID(),
    label: String(input.label || 'estrazione').slice(0, 200),
    source: input.source,
    addedAt: new Date().toISOString(),
    addedBy: input.addedBy,
    sheetNames: descr.sheetNames,
    rows: descr.rows,
    ddt: extractDdtNumbers(input.data),
    data: input.data as Record<string, unknown>,
  };

  const full = itemPath(commessaId, stored.id) as string;
  const tmp = `${full}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(stored, null, 2), 'utf8');
  fs.renameSync(tmp, full);
  return { item: stripPayload(stored) };
}

export function removeFromPaniere(commessaId: string, id: string): boolean {
  const full = itemPath(commessaId, id);
  if (!full) return false;
  try {
    fs.unlinkSync(full);
    return true;
  } catch {
    return false;
  }
}

/** Svuota il paniere. Ritorna quante voci sono state tolte. */
export function clearPaniere(commessaId: string): number {
  let names: string[] = [];
  try {
    names = fs.readdirSync(paniereFolder(commessaId)).filter((f) => f.endsWith('.json'));
  } catch {
    return 0;
  }
  let tolte = 0;
  for (const n of names) {
    try {
      fs.unlinkSync(path.join(paniereFolder(commessaId), n));
      tolte++;
    } catch {
      /* già sparito */
    }
  }
  return tolte;
}

/**
 * Estrazioni pronte per l'unione, nell'ordine in cui sono state aggiunte.
 * `ids` limita a una selezione; assente = tutto il paniere.
 */
export function entriesForMerge(commessaId: string, ids?: string[]): MergeEntry[] {
  const wanted = ids && ids.length > 0 ? new Set(ids) : null;
  return listPaniere(commessaId)
    .filter((i) => !wanted || wanted.has(i.id))
    .map((i) => readStored(commessaId, i.id))
    .filter((s): s is StoredItem => s !== null)
    .map((s) => ({ label: s.label, parsed: s.data }));
}

/**
 * Numeri DDT che compaiono in più voci del paniere. Unire senza accorgersene
 * significa contare due volte lo stesso documento nel registro finale — lo
 * stesso avviso che il flusso manuale dà sull'archivio, applicato qui.
 *
 * Non blocca niente: due voci possono contenere lo stesso DDT legittimamente
 * (un registro e la sua rettifica), la decisione resta all'utente.
 */
export function doppioniPaniere(commessaId: string): Array<{ ddt: string; voci: string[] }> {
  const dove = new Map<string, string[]>();
  for (const item of listPaniere(commessaId)) {
    for (const n of item.ddt || []) {
      const lista = dove.get(n) || [];
      // Stesso DDT ripetuto dentro la stessa voce non è un doppione fra voci.
      if (!lista.includes(item.label)) lista.push(item.label);
      dove.set(n, lista);
    }
  }
  return [...dove.entries()]
    .filter(([, voci]) => voci.length > 1)
    .map(([ddt, voci]) => ({ ddt, voci }));
}

/** Anteprima dell'unione senza scrivere niente: quanti fogli, quante righe. */
export function previewMerge(
  commessaId: string,
  ids?: string[]
): { sheets: Array<{ name: string; rows: number }>; totalRows: number; entries: number } {
  const entries = entriesForMerge(commessaId, ids);
  const { sheets, totalRows } = mergeSheets(entries);
  return {
    sheets: sheets.map((s) => ({ name: s.name, rows: s.rows.length })),
    totalRows,
    entries: entries.length,
  };
}
