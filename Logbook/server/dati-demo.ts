// "><(((º> sabusabu <º)))><"
/**
 * Decide se, all'avvio con un database vuoto, si caricano i dati di esempio
 * (prisma/seed.ts: 5 dipendenti, 3 progetti, ore e assenze finte).
 *
 * Lo usa scripts/prepara-db.ts, che gira prima di `npm run dev` (sviluppo) e prima di
 * `npm start` / avvia.bat (produzione, con l'argomento --produzione).
 *
 * Regola (richiesta del 24/11/2026: "partire senza dati finti" per l'uso vero):
 * - LOGBOOK_DATI_DEMO=1 / si / true  → dati di esempio sempre (es. una copia dimostrativa);
 * - LOGBOOK_DATI_DEMO=0 / no / false → mai;
 * - variabile assente → sì in sviluppo, NO in produzione: chi installa Logbook per HR
 *   parte da un database vuoto con il solo amministratore.
 * Su un database che ha già dipendenti non cambia nulla: i dati non si toccano mai.
 */

type ModoAvvio = 'sviluppo' | 'produzione';

const SI = ['1', 'si', 'sì', 'true', 'yes', 'on'];
const NO = ['0', 'no', 'false', 'off'];

/** "si"/"no" scritti in vari modi → true/false; vuoto → null; valore non riconosciuto → undefined. */
export function interpretaSiNo(valore: string | undefined): boolean | null | undefined {
  const v = valore?.trim().toLowerCase();
  if (!v) return null;
  if (SI.includes(v)) return true;
  if (NO.includes(v)) return false;
  return undefined;
}

/**
 * Esito per prepara-db: `carica` dice cosa fare, `avviso` è valorizzato quando la variabile
 * ha un valore non riconosciuto (si usa il default del modo e lo si scrive nel log).
 */
export function decidiDatiDemo(valore: string | undefined, modo: ModoAvvio): { carica: boolean; avviso?: string } {
  const scelta = interpretaSiNo(valore);
  if (scelta === true || scelta === false) return { carica: scelta };
  const predefinito = modo === 'sviluppo';
  if (scelta === undefined) {
    return {
      carica: predefinito,
      avviso: `LOGBOOK_DATI_DEMO="${valore}" non riconosciuto (usare 1 oppure 0): ${predefinito ? 'carico' : 'non carico'} i dati di esempio come da default in ${modo}.`,
    };
  }
  return { carica: predefinito };
}
