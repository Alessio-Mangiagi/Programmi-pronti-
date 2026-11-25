// "><(((º> sabusabu <º)))><"
/**
 * Codici di conferma via email per le operazioni del proprietario (dal 25/11/2026: "come
 * misura di sicurezza inserisci l'invio di un codice via mail" per cancellare tutti i dati).
 *
 * Regole:
 * - codice di 6 cifre casuali (crypto.randomInt), valido 10 minuti, uno solo valido per
 *   utente alla volta: chiederne un altro annulla il precedente;
 * - in memoria si tiene solo l'impronta SHA-256 del codice, mai il codice in chiaro;
 * - 5 tentativi sbagliati annullano il codice (bisogna chiederne uno nuovo);
 * - al massimo 5 codici all'ora per utente, così nessuno può riempire di email la casella;
 * - il codice si consuma al primo uso giusto.
 * Sta in memoria di proposito: un riavvio di Logbook annulla i codici in sospeso, cosa che
 * per un'operazione rara come questa è solo più prudente.
 */
import crypto from 'node:crypto';

export const DURATA_CODICE_MS = 10 * 60 * 1000;
export const MAX_TENTATIVI_CODICE = 5;
export const MAX_CODICI_ORA = 5;

export type EsitoCodice = 'ok' | 'assente' | 'scaduto' | 'sbagliato' | 'esaurito';

type Codice = { impronta: Buffer; scade: number; tentativi: number };

const impronta = (codice: string) => crypto.createHash('sha256').update(codice).digest();

/** Registro dei codici di un'istanza di Logbook (uno per server: i test ne creano di nuovi). */
export function registroCodici(adesso: () => number = Date.now) {
  const codici = new Map<number, Codice>();
  const richieste = new Map<number, number[]>();

  return {
    /**
     * Crea un codice nuovo per l'utente e lo restituisce in chiaro (va solo nell'email).
     * Restituisce null se l'utente ha già chiesto MAX_CODICI_ORA codici nell'ultima ora.
     */
    nuovo(utenteId: number): { codice: string; scade: number } | null {
      const ora = adesso();
      const recenti = (richieste.get(utenteId) ?? []).filter((t) => ora - t < 60 * 60 * 1000);
      if (recenti.length >= MAX_CODICI_ORA) return null;
      richieste.set(utenteId, [...recenti, ora]);
      const codice = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
      const scade = ora + DURATA_CODICE_MS;
      codici.set(utenteId, { impronta: impronta(codice), scade, tentativi: 0 });
      return { codice, scade };
    },

    /** Annulla il codice (es. l'email non è partita). */
    annulla(utenteId: number) {
      codici.delete(utenteId);
    },

    /** Controlla il codice scritto dall'utente; se è giusto lo consuma. */
    verifica(utenteId: number, scritto: string): EsitoCodice {
      const c = codici.get(utenteId);
      if (!c) return 'assente';
      if (adesso() > c.scade) {
        codici.delete(utenteId);
        return 'scaduto';
      }
      // Confronto a tempo costante sulle impronte (stessa lunghezza per costruzione).
      if (crypto.timingSafeEqual(c.impronta, impronta(scritto.trim()))) {
        codici.delete(utenteId);
        return 'ok';
      }
      c.tentativi += 1;
      if (c.tentativi >= MAX_TENTATIVI_CODICE) {
        codici.delete(utenteId);
        return 'esaurito';
      }
      return 'sbagliato';
    },
  };
}
