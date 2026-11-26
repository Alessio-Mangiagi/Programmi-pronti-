// "><(((º> sabusabu <º)))><"
/**
 * Date di calendario come stringhe "AAAA-MM-GG" (vedi convenzioni in prisma/schema.prisma).
 *
 * Codice puro, senza dipendenze: lo usano server, seed e frontend. Tutti i calcoli
 * passano da Date in UTC, così il fuso orario del PC (e il cambio ora legale) non
 * spostano mai un giorno.
 */

/** Espressione regolare di una data ISO di calendario. */
const RE_DATA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Data più vecchia che si può inserire in Copilota (richiesta del 23/11/2026, risposta 1b):
 * vale per TUTTI gli inserimenti — ore, assenze, festività, import, date di assunzione e
 * cessazione, date dei progetti. La lettura di dati già presenti non è limitata.
 */
export const DATA_MINIMA = '2020-01-01';
export const MESSAGGIO_DATA_MINIMA = 'Non si possono inserire date precedenti al 01/01/2020';

/** true se la data è valida e non precede DATA_MINIMA. */
export function isDataAmmessa(iso: string): boolean {
  return isDataValida(iso) && iso >= DATA_MINIMA;
}

/** Compone "AAAA-MM-GG" da anno, mese (1-12) e giorno. */
export function dataIso(anno: number, mese: number, giorno: number): string {
  return `${String(anno).padStart(4, '0')}-${String(mese).padStart(2, '0')}-${String(giorno).padStart(2, '0')}`;
}

/** Converte una Date in "AAAA-MM-GG" leggendo i campi UTC. */
export function daDateUtc(d: Date): string {
  return dataIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Data di oggi nel fuso del PC (quella che vede chi usa l'app), come "AAAA-MM-GG". */
export function oggiIso(adesso: Date = new Date()): string {
  return dataIso(adesso.getFullYear(), adesso.getMonth() + 1, adesso.getDate());
}

/**
 * Data di oggi in Italia ("AAAA-MM-GG"), qualunque sia il fuso del computer. La usa il server
 * (Giorno 35): su Vercel l'orologio è in UTC e fra mezzanotte e l'una o le due italiane
 * oggiIso() direbbe ancora il giorno prima.
 */
export function oggiItalia(adesso: Date = new Date()): string {
  // Il formato svedese è già AAAA-MM-GG.
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(adesso);
}

/**
 * Anno più lontano accettato (verifica di sicurezza del Giorno 23, 24/11/2026). Senza un
 * tetto un dipendente poteva chiedere ferie fino al 9999-12-31: il giorno dopo ("10000-01-01")
 * nel confronto fra stringhe risulta PRIMA di "9999-12-31", i cicli giorno per giorno non
 * finivano più e l'elenco delle assenze di HR andava in errore. Le festività avevano già
 * lo stesso limite (server/rotte/festivita.ts).
 */
const ANNO_MASSIMO = 2100;

/**
 * true se la stringa è una data "AAAA-MM-GG" esistente (rifiuta 2026-02-30, 2026-13-01)
 * e non oltre il 31/12/2100 (ANNO_MASSIMO).
 */
export function isDataValida(iso: string): boolean {
  const m = RE_DATA_ISO.exec(iso);
  if (!m) return false;
  const [anno, mese, giorno] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (anno > ANNO_MASSIMO) return false;
  const d = new Date(Date.UTC(anno, mese - 1, giorno));
  return d.getUTCFullYear() === anno && d.getUTCMonth() === mese - 1 && d.getUTCDate() === giorno;
}

/** Interpreta "AAAA-MM-GG" come mezzanotte UTC. Solleva un errore se la data non è valida. */
export function aDateUtc(iso: string): Date {
  if (!isDataValida(iso)) throw new Error(`Data non valida: "${iso}" (atteso AAAA-MM-GG)`);
  const [anno, mese, giorno] = iso.split('-').map(Number);
  return new Date(Date.UTC(anno, mese - 1, giorno));
}

/** Somma (o sottrae, con n negativo) giorni a una data ISO. */
export function aggiungiGiorni(iso: string, n: number): string {
  const d = aDateUtc(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return daDateUtc(d);
}

/** Giorno della settimana: 0 = domenica … 6 = sabato (come Date.getDay). */
export function giornoSettimana(iso: string): number {
  return aDateUtc(iso).getUTCDay();
}

/** true per sabato e domenica. */
export function isFineSettimana(iso: string): boolean {
  const g = giornoSettimana(iso);
  return g === 0 || g === 6;
}

/** Numero di giorni del mese (mese 1-12). */
export function giorniNelMese(anno: number, mese: number): number {
  return new Date(Date.UTC(anno, mese, 0)).getUTCDate();
}

/**
 * Tutte le date da `da` a `a` comprese, in ordine. Intervallo vuoto se `a` < `da`.
 */
export function intervalloDate(da: string, a: string): string[] {
  const risultato: string[] = [];
  for (let d = da; d <= a; d = aggiungiGiorni(d, 1)) risultato.push(d);
  return risultato;
}

/** "AAAA-MM-GG" → "gg/mm/aaaa" (formato italiano usato in tutta l'interfaccia). */
export function formattaData(iso: string): string {
  const m = RE_DATA_ISO.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/**
 * "gg/mm/aaaa" (anche con giorno o mese a una cifra) → "AAAA-MM-GG".
 * Restituisce null se il testo non è una data italiana valida.
 */
export function daDataItaliana(testo: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(testo.trim());
  if (!m) return null;
  const iso = dataIso(Number(m[3]), Number(m[2]), Number(m[1]));
  return isDataValida(iso) ? iso : null;
}
