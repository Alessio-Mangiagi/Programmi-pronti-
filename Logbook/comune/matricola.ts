// "><(((º> sabusabu <º)))><"
/**
 * Matricola legata al tipo di contratto (Giorno 26, richiesta del 24/11/2026: "la matricola
 * deve essere alfanumerica con riferimento al tipo di contratto per identificare prima il
 * personale"; risposte 1a 2a 3a).
 *
 * Forma: SIGLA-NUMERO, es. IND-0001 (indeterminato), DET-0004 (determinato).
 * - 1a: la sigla viene dal contratto (SIGLE_CONTRATTO), il numero ha almeno 4 cifre;
 * - 2a: Copilota propone il prossimo numero libero (GET /api/dipendenti/prossima-matricola),
 *   HR lo può correggere;
 * - 3a: se cambia il contratto cambia solo la sigla, il numero resta (DET-0004 → IND-0004).
 *
 * Il NUMERO identifica la persona ed è unico fra tutti i dipendenti, qualunque sia la sigla:
 * per questo l'import delle ore (server/servizi/import-ore.ts) riconosce il dipendente anche
 * da una matricola vecchia ("0004") o con la sigla di prima ("DET-0004").
 *
 * Codice puro, usato da server (schema, rotte, import) e interfaccia (scheda dipendente).
 */
import type { TIPI_CONTRATTO } from './schemi';

type TipoContratto = (typeof TIPI_CONTRATTO)[number];

export const SIGLE_CONTRATTO: Record<TipoContratto, string> = {
  INDETERMINATO: 'IND',
  DETERMINATO: 'DET',
  APPRENDISTATO: 'APP',
  SOMMINISTRAZIONE: 'SOM',
  COLLABORAZIONE: 'COL',
  TIROCINIO: 'TIR',
};

const SIGLE = new Set(Object.values(SIGLE_CONTRATTO));

/**
 * Cosa si accetta in ingresso (maiuscole o minuscole, spazi ai lati): "IND-0007", "ind 7",
 * "IND7" oppure solo il numero "7" / "0007". Il numero ha al massimo 6 cifre.
 */
const RE_INGRESSO = /^(?:([A-Z]{3})[\s-]?)?(\d{1,6})$/;

/** Numero della matricola (anche di una vecchia solo numerica), oppure null se non si legge. */
export function numeroMatricola(matricola: string): number | null {
  const m = RE_INGRESSO.exec(matricola.trim().toUpperCase());
  return m ? Number(m[2]) : null;
}

/** Matricola completa da contratto e numero: componiMatricola('DETERMINATO', 4) → "DET-0004". */
export function componiMatricola(tipo: TipoContratto, numero: number): string {
  return `${SIGLE_CONTRATTO[tipo]}-${String(numero).padStart(4, '0')}`;
}

/**
 * Matricola scritta da HR → forma canonica per il contratto scelto, oppure un messaggio
 * d'errore. La sigla scritta, se c'è, deve essere una delle sigle note; viene comunque
 * sostituita da quella del contratto (risposta 3a: la sigla segue il contratto).
 */
export function normalizzaMatricola(testo: string, tipo: TipoContratto): { matricola: string } | { errore: string } {
  const m = RE_INGRESSO.exec(testo.trim().toUpperCase());
  if (!m) return { errore: `Matricola: sigla del contratto e numero, es. ${componiMatricola(tipo, 7)} (oppure solo il numero)` };
  if (m[1] && !SIGLE.has(m[1])) return { errore: `Sigla "${m[1]}" non valida: le sigle sono ${[...SIGLE].join(', ')}` };
  const numero = Number(m[2]);
  if (numero < 1) return { errore: 'Il numero di matricola parte da 1' };
  return { matricola: componiMatricola(tipo, numero) };
}

/** Prossimo numero libero: il più alto fra tutte le matricole + 1 (1 se non ce ne sono). */
export function prossimoNumero(matricole: string[]): number {
  return matricole.reduce((max, m) => Math.max(max, numeroMatricola(m) ?? 0), 0) + 1;
}
