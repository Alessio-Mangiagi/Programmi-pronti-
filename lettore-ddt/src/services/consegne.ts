// consegne.ts — Registro delle consegne per fornitore, ricavato dai DDT estratti.
//
// Ogni export salvato (flusso manuale o batch) diventa una serie di righe
// "consegna": chi ha consegnato (fornitore + P.IVA), quale DDT, quando, cosa e
// quanto, dove. Le righe vivono in data/<commessa>/consegne.json, che NON segue
// la potatura dell'archivio json_exports (tiene solo gli ultimi N export): lo
// storico di un fornitore deve restare intero anche quando i JSON vecchi spariscono.
//
// I prompt producono fogli diversi (calcestruzzo, inerti, cava): le colonne si
// riconoscono per nome, mai per posizione, come fa ddtArchive.

/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'fs';
import path from 'path';
import logger from '../utils/logger';
import { parseItNum } from './ddtArchive';

export interface Consegna {
  commessa: string;
  /** Nome dell'export JSON da cui viene la riga (chiave di sostituzione). */
  export: string;
  fornitore: string;
  /** P.IVA normalizzata (11 cifre) o stringa vuota se assente/illeggibile. */
  piva: string;
  ddt: string;
  data: string;
  /** Data in formato AAAA-MM-GG, vuota se non interpretabile. */
  dataIso: string;
  materiale: string;
  quantita: number | null;
  um: string;
  destinazione: string;
  targa: string;
}

// ── Colonne riconosciute (alias per i diversi prompt) ───────────────────────
const COL_FORNITORE = ['Fornitore', 'Cedente'];
const COL_PIVA = ['P.IVA Fornitore', 'P.IVA Cedente', 'P.IVA', 'Partita IVA'];
const COL_MATERIALE = [
  'Descrizione',
  'Descrizione materiale',
  'Tipo Materiale',
  'TipoCls',
  'ClRes',
];
const COL_DESTINAZIONE = ['Destinazione/WBS', 'WBS', 'Luogo Destinazione', 'Destinazione'];
// Quantità: colonna e unità che la accompagna. "Quantità" generica prende
// l'unità dalla colonna "u.m."; il peso vale solo se manca un volume.
const COL_QUANTITA: Array<{ col: string; um: string | null }> = [
  { col: 'm³', um: 'm³' },
  { col: 'Quantità Mc', um: 'm³' },
  { col: 'Quantità', um: null },
  { col: 'Peso Kg', um: 'kg' },
];
const VALORI_VUOTI = /^(mancante|\(illeggibile\)|illeggibile|n\.?d\.?|-+|\?)$/i;

function cella(row: any[], headers: string[], nomi: string[]): string {
  for (const n of nomi) {
    const i = headers.indexOf(n);
    if (i >= 0) {
      const v = String(row?.[i] ?? '').trim();
      if (v && !VALORI_VUOTI.test(v)) return v;
    }
  }
  return '';
}

/** Foglio di dettaglio: il primo con N°DDT e una colonna fornitore/cedente. */
function foglioDettaglio(parsed: any): { headers: string[]; rows: any[][] } | null {
  if (!parsed || !Array.isArray(parsed.sheets)) return null;
  const s = parsed.sheets.find(
    (x: any) =>
      Array.isArray(x?.headers) &&
      Array.isArray(x?.rows) &&
      x.headers.includes('N°DDT') &&
      COL_FORNITORE.some((c) => x.headers.includes(c))
  );
  return s ? { headers: s.headers.map((h: unknown) => String(h)), rows: s.rows } : null;
}

// ── Normalizzazioni ─────────────────────────────────────────────────────────

/** P.IVA italiana a 11 cifre (senza "IT", spazi, punti), o '' se non lo è. */
export function normalizzaPiva(v: unknown): string {
  const s = String(v ?? '')
    .toUpperCase()
    .replace(/[\s.\-/]/g, '')
    .replace(/^IT/, '');
  return /^\d{11}$/.test(s) ? s : '';
}

/** Cifra di controllo della P.IVA (algoritmo dell'Agenzia delle Entrate). */
export function pivaValida(piva: string): boolean {
  if (!/^\d{11}$/.test(piva)) return false;
  let somma = 0;
  for (let i = 0; i < 10; i++) {
    let c = Number(piva[i]);
    if (i % 2 === 1) {
      c *= 2;
      if (c > 9) c -= 9;
    }
    somma += c;
  }
  return (10 - (somma % 10)) % 10 === Number(piva[10]);
}

// Forme societarie: non distinguono una ditta dall'altra, e l'OCR le scrive in
// mille modi ("S.R.L.", "srl", "S.r.l."). Si tolgono prima di confrontare.
const FORME = new Set([
  'SRL',
  'SRLS',
  'SPA',
  'SAS',
  'SNC',
  'SAPA',
  'SCARL',
  'SCRL',
  'SCPA',
  'SOC',
  'COOP',
  'SS',
]);

/** Nome confrontabile: maiuscolo, senza accenti, punteggiatura e forma societaria. */
export function normalizzaNome(v: unknown): string {
  const base = String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/&/g, ' E ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
  // "S R L" (da "S.R.L.") -> "SRL": lettere singole consecutive si riuniscono.
  const unite = base.replace(/\b(?:[A-Z] ){1,3}[A-Z]\b/g, (m) => m.replace(/ /g, ''));
  return unite
    .split(' ')
    .filter((t) => t && !FORME.has(t))
    .join(' ');
}

/** "15/03/2026", "15/03/26", "2026-03-15" -> "2026-03-15"; altrimenti ''. */
export function dataIso(v: unknown): string {
  const s = String(v ?? '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (!m) return '';
  const anno = m[3].length === 2 ? `20${m[3]}` : m[3];
  const g = Number(m[1]);
  const mese = Number(m[2]);
  if (g < 1 || g > 31 || mese < 1 || mese > 12) return '';
  return `${anno}-${String(mese).padStart(2, '0')}-${String(g).padStart(2, '0')}`;
}

// ── Estrazione dall'export ──────────────────────────────────────────────────

/** Righe consegna di un export DDT (vuoto se l'export non e' un DDT). */
export function estraiConsegne(parsed: any, commessa: string, exportName: string): Consegna[] {
  const f = foglioDettaglio(parsed);
  if (!f) return [];
  const { headers, rows } = f;
  const out: Consegna[] = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const ddt = cella(row, headers, ['N°DDT']);
    if (/totale/i.test(ddt)) continue;
    const fornitore = cella(row, headers, COL_FORNITORE);
    if (!ddt && !fornitore) continue;

    let quantita: number | null = null;
    let um = '';
    for (const q of COL_QUANTITA) {
      const i = headers.indexOf(q.col);
      if (i < 0) continue;
      const n = parseItNum(row[i]);
      if (isNaN(n)) continue;
      quantita = n;
      um = q.um ?? cella(row, headers, ['u.m.', 'UM']).toLowerCase();
      break;
    }

    let materiale = cella(row, headers, COL_MATERIALE);
    // Calcestruzzo: la classe da sola ("C25/30") non dice cos'e' a chi legge.
    if (materiale && headers.includes('ClRes') && !headers.includes('Descrizione')) {
      materiale = `Calcestruzzo ${materiale}`;
    }

    const data = cella(row, headers, ['Data']);
    out.push({
      commessa,
      export: exportName,
      fornitore,
      piva: normalizzaPiva(cella(row, headers, COL_PIVA)),
      ddt,
      data,
      dataIso: dataIso(data),
      materiale,
      quantita,
      um,
      destinazione: cella(row, headers, COL_DESTINAZIONE),
      targa: cella(row, headers, ['Targa']),
    });
  }
  return out;
}

// ── Registro persistente per commessa ───────────────────────────────────────

interface Registro {
  versione: 1;
  perExport: Record<string, { salvatoIl: string; righe: Consegna[] }>;
}

const FILE_REGISTRO = 'consegne.json';
// Read-modify-write sullo stesso file: una coda per commessa evita che due
// salvataggi ravvicinati (batch + manuale) si cancellino le righe a vicenda.
const code = new Map<string, Promise<unknown>>();

function inCoda<T>(chiave: string, fn: () => T): Promise<T> {
  const prev = code.get(chiave) || Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  code.set(chiave, next);
  next
    .finally(() => {
      if (code.get(chiave) === next) code.delete(chiave);
    })
    .catch(() => undefined);
  return next;
}

function scriviAtomico(file: string, contenuto: string): void {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, contenuto, 'utf8');
  fs.renameSync(tmp, file);
}

/** Registro vuoto ricostruito dagli export ancora presenti in json_exports. */
function ricostruisci(dirCommessa: string, commessa: string): Registro {
  const reg: Registro = { versione: 1, perExport: {} };
  const cartella = path.join(dirCommessa, 'json_exports');
  let files: string[] = [];
  try {
    files = fs.readdirSync(cartella).filter((f) => f.endsWith('.json'));
  } catch {
    return reg;
  }
  for (const nome of files) {
    try {
      const full = path.join(cartella, nome);
      const righe = estraiConsegne(JSON.parse(fs.readFileSync(full, 'utf8')), commessa, nome);
      if (righe.length) {
        reg.perExport[nome] = { salvatoIl: fs.statSync(full).mtime.toISOString(), righe };
      }
    } catch {
      /* export illeggibile: si salta, come in ddtArchive */
    }
  }
  return reg;
}

/**
 * Legge il registro di una commessa. Al primo accesso (file assente) lo
 * ricostruisce dagli export archiviati e lo salva.
 */
export function leggiRegistro(dirCommessa: string, commessa: string): Registro {
  const file = path.join(dirCommessa, FILE_REGISTRO);
  try {
    const r = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (r && r.versione === 1 && r.perExport && typeof r.perExport === 'object') return r;
  } catch (e: any) {
    if (e?.code !== 'ENOENT')
      logger.warn(`consegne.json di ${commessa} illeggibile: lo ricostruisco`);
  }
  const reg = ricostruisci(dirCommessa, commessa);
  try {
    scriviAtomico(file, JSON.stringify(reg));
  } catch (e: any) {
    logger.error(`Registro consegne di ${commessa} non salvato: ${e.message}`);
  }
  return reg;
}

/**
 * Registra (o sostituisce) le consegne di un export appena salvato. Idempotente:
 * lo stesso export risalvato rimpiazza le sue righe, non le duplica.
 */
export function registraExport(
  dirCommessa: string,
  commessa: string,
  exportName: string,
  parsed: any
): Promise<number> {
  return inCoda(dirCommessa, () => {
    const reg = leggiRegistro(dirCommessa, commessa);
    const righe = estraiConsegne(parsed, commessa, exportName);
    if (righe.length) {
      reg.perExport[exportName] = { salvatoIl: new Date().toISOString(), righe };
    } else {
      delete reg.perExport[exportName];
    }
    scriviAtomico(path.join(dirCommessa, FILE_REGISTRO), JSON.stringify(reg));
    return righe.length;
  });
}

/** Righe del registro, lette nella stessa coda delle scritture. */
export function consegneCommessa(dirCommessa: string, commessa: string): Promise<Consegna[]> {
  return inCoda(dirCommessa, () => righeRegistro(leggiRegistro(dirCommessa, commessa)));
}

export function righeRegistro(reg: Registro): Consegna[] {
  return Object.values(reg.perExport).flatMap((e) => e.righe);
}

// ── Aggregazione per fornitore ──────────────────────────────────────────────

export interface Totale {
  um: string;
  quantita: number;
}

export interface Anomalia {
  tipo: 'senza-piva' | 'piva-non-valida' | 'ddt-ripetuto' | 'nomi-diversi' | 'quantita-mancante';
  testo: string;
}

export interface Fornitore {
  chiave: string;
  nome: string;
  nomi: string[];
  piva: string;
  ddt: number;
  righe: number;
  prima: string;
  ultima: string;
  totali: Totale[];
  materiali: Array<{ materiale: string; um: string; quantita: number }>;
  commesse: string[];
  anomalie: Anomalia[];
}

/**
 * Chiave di raggruppamento. La P.IVA vince; senza, il nome normalizzato — ma se
 * quello stesso nome compare altrove con una sola P.IVA, la riga va con lei
 * (un DDT dove l'OCR non ha letto la P.IVA resta del suo fornitore).
 */
export function chiaviFornitori(righe: Consegna[]): (r: Consegna) => string {
  const pivePerNome = new Map<string, Set<string>>();
  for (const r of righe) {
    if (!r.piva) continue;
    const n = normalizzaNome(r.fornitore);
    if (!n) continue;
    if (!pivePerNome.has(n)) pivePerNome.set(n, new Set());
    pivePerNome.get(n)!.add(r.piva);
  }
  return (r: Consegna) => {
    if (r.piva) return `piva:${r.piva}`;
    const n = normalizzaNome(r.fornitore);
    const p = pivePerNome.get(n);
    if (p && p.size === 1) return `piva:${[...p][0]}`;
    return n ? `nome:${n}` : 'nome:(sconosciuto)';
  };
}

function somma(totali: Map<string, number>, um: string, q: number | null): void {
  if (q === null) return;
  totali.set(um, (totali.get(um) || 0) + q);
}

const arrotonda = (n: number) => Math.round(n * 1000) / 1000;

function piuFrequente(valori: string[]): string {
  const conta = new Map<string, number>();
  for (const v of valori) if (v) conta.set(v, (conta.get(v) || 0) + 1);
  let migliore = '';
  let max = 0;
  for (const [v, n] of conta) if (n > max) [migliore, max] = [v, n];
  return migliore;
}

export function riepilogoFornitori(righe: Consegna[]): Fornitore[] {
  const chiaveDi = chiaviFornitori(righe);
  const gruppi = new Map<string, Consegna[]>();
  for (const r of righe) {
    const k = chiaveDi(r);
    if (!gruppi.has(k)) gruppi.set(k, []);
    // "><(((º> sabusabu <º)))><"
    gruppi.get(k)!.push(r);
  }

  const out: Fornitore[] = [];
  for (const [chiave, rs] of gruppi) {
    const piva = chiave.startsWith('piva:') ? chiave.slice(5) : '';
    const totali = new Map<string, number>();
    const materiali = new Map<string, number>();
    const exportPerDdt = new Map<string, Set<string>>();
    const date = rs
      .map((r) => r.dataIso)
      .filter(Boolean)
      .sort();
    for (const r of rs) {
      somma(totali, r.um, r.quantita);
      if (r.quantita !== null) {
        const km = `${r.materiale || '(non indicato)'}\u0000${r.um}`;
        materiali.set(km, (materiali.get(km) || 0) + r.quantita);
      }
      if (r.ddt) {
        const kd = `${r.commessa}\u0000${r.ddt}`;
        if (!exportPerDdt.has(kd)) exportPerDdt.set(kd, new Set());
        exportPerDdt.get(kd)!.add(r.export);
      }
    }

    const anomalie: Anomalia[] = [];
    const senzaPiva = rs.filter((r) => !r.piva).length;
    if (senzaPiva) {
      anomalie.push({
        tipo: 'senza-piva',
        testo: piva
          ? `${senzaPiva} righe senza P.IVA, attribuite per nome`
          : `P.IVA mai letta sui DDT (${senzaPiva} righe): raggruppate solo per nome`,
      });
    }
    if (piva && !pivaValida(piva)) {
      anomalie.push({
        tipo: 'piva-non-valida',
        testo: `P.IVA ${piva} con cifra di controllo errata: probabile errore di lettura`,
      });
    }
    const ripetuti = [...exportPerDdt.entries()].filter(([, ex]) => ex.size > 1);
    if (ripetuti.length) {
      const esempi = ripetuti
        .slice(0, 5)
        .map(([k]) => k.split('\u0000')[1])
        .join(', ');
      anomalie.push({
        tipo: 'ddt-ripetuto',
        testo: `${ripetuti.length} DDT in piu' export (${esempi}${ripetuti.length > 5 ? '…' : ''}): possibile doppia contabilizzazione`,
      });
    }
    const nomi = [...new Set(rs.map((r) => r.fornitore).filter(Boolean))];
    const nomiNorm = new Set(nomi.map(normalizzaNome));
    if (piva && nomiNorm.size > 1) {
      anomalie.push({
        tipo: 'nomi-diversi',
        testo: `Stessa P.IVA con ${nomiNorm.size} nomi diversi: ${nomi.slice(0, 3).join(' / ')}`,
      });
    }
    const senzaQ = rs.filter((r) => r.quantita === null).length;
    if (senzaQ)
      anomalie.push({
        tipo: 'quantita-mancante',
        testo: `${senzaQ} righe senza quantita' leggibile`,
      });

    out.push({
      chiave,
      nome: piuFrequente(rs.map((r) => r.fornitore)) || '(fornitore non indicato)',
      nomi,
      piva,
      ddt: exportPerDdt.size,
      righe: rs.length,
      prima: date[0] || '',
      ultima: date[date.length - 1] || '',
      totali: [...totali.entries()].map(([um, q]) => ({ um, quantita: arrotonda(q) })),
      materiali: [...materiali.entries()]
        .map(([k, q]) => {
          const [materiale, um] = k.split('\u0000');
          return { materiale, um, quantita: arrotonda(q) };
        })
        .sort((a, b) => b.quantita - a.quantita),
      commesse: [...new Set(rs.map((r) => r.commessa))].sort(),
      anomalie,
    });
  }
  return out.sort((a, b) => b.ultima.localeCompare(a.ultima) || a.nome.localeCompare(b.nome));
}

/** Consegne di un fornitore, piu' recenti prima, e totali per mese. */
export function dettaglioFornitore(righe: Consegna[], chiave: string) {
  const chiaveDi = chiaviFornitori(righe);
  const sue = righe.filter((r) => chiaveDi(r) === chiave);
  if (!sue.length) return null;
  // Riepilogo calcolato su TUTTE le righe: rifatto sul solo sottoinsieme, una
  // riga senza P.IVA potrebbe non ritrovare il nome che la lega al fornitore.
  const fornitore = riepilogoFornitori(righe).find((f) => f.chiave === chiave)!;
  const perMese = new Map<
    string,
    { mese: string; um: string; quantita: number; ddt: Set<string> }
  >();
  for (const r of sue) {
    const mese = r.dataIso ? r.dataIso.slice(0, 7) : '(senza data)';
    const k = `${mese}\u0000${r.um}`;
    if (!perMese.has(k)) perMese.set(k, { mese, um: r.um, quantita: 0, ddt: new Set() });
    const m = perMese.get(k)!;
    if (r.quantita !== null) m.quantita += r.quantita;
    if (r.ddt) m.ddt.add(`${r.commessa}\u0000${r.ddt}`);
  }
  return {
    fornitore,
    consegne: [...sue].sort(
      (a, b) =>
        b.dataIso.localeCompare(a.dataIso) || a.ddt.localeCompare(b.ddt, 'it', { numeric: true })
    ),
    perMese: [...perMese.values()]
      .map((m) => ({ mese: m.mese, um: m.um, quantita: arrotonda(m.quantita), ddt: m.ddt.size }))
      .sort((a, b) => b.mese.localeCompare(a.mese)),
  };
}
