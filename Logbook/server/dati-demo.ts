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
 *
 * Copia dimostrativa (richiesta del 25/11/2026: "quello d'esempio tienilo solo per fare
 * vedere come si visualizzano i dati e creane uno vuoto per quando andrà in produzione").
 * Si accende con l'argomento --dimostrazione (`npm run demo`, avvia-demo.bat) o con la
 * variabile LOGBOOK_DIMOSTRAZIONE=1. In quel caso Logbook:
 * - usa SEMPRE data/demo/logbook.db e data/demo/documenti (server/database-url.ts e
 *   servizi/archivio-file.ts), anche se DATABASE_URL o LOGBOOK_DOCUMENTI_DIR puntano
 *   altrove: la copia di prova non può mai aprire né modificare il database vero;
 * - ascolta sulla porta 5211 (LOGBOOK_DIMOSTRAZIONE_PORT per cambiarla), accanto al Logbook
 *   vero sulla 5210, e serve l'interfaccia compilata in dist-demo/ (server/index.ts);
 * - su un database vuoto carica sempre i dati di esempio: cancellando data/demo la copia
 *   riparte dagli esempi;
 * - lo dice nell'interfaccia: GET /api/oggi → `dimostrazione: true` e la fascia
 *   "Copia dimostrativa" (src/componenti/FasciaDimostrazione.tsx).
 */

type ModoAvvio = 'sviluppo' | 'produzione';

/** Porta predefinita della copia dimostrativa (il Logbook vero usa la 5210). */
export const PORTA_DIMOSTRAZIONE = 5211;

/**
 * true se questo processo è la copia dimostrativa. La CLI di Prisma lanciata da
 * scripts/prepara-db.ts è un processo a parte e non riceve l'argomento: per questo
 * prepara-db, con --dimostrazione, imposta anche la variabile, che i processi figli ereditano.
 * Letta a ogni chiamata (non una costante) perché il .env si carica dopo gli import.
 */
export function inDimostrazione(): boolean {
  return process.argv.includes('--dimostrazione') || interpretaSiNo(process.env.LOGBOOK_DIMOSTRAZIONE) === true;
}

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
 * Nella copia dimostrativa (`dimostrazione` true) gli esempi si caricano sempre: è fatta
 * apposta per mostrarli, LOGBOOK_DATI_DEMO non conta.
 */
export function decidiDatiDemo(valore: string | undefined, modo: ModoAvvio, dimostrazione = false): { carica: boolean; avviso?: string } {
  if (dimostrazione) return { carica: true };
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
