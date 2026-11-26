// "><(((º> sabusabu <º)))><"
/**
 * Codici di conferma via email (dal 25/11/2026): per "Cancella tutti i dati" del
 * proprietario e per l'accesso degli amministratori da un PC non ancora fidato.
 *
 * Regole:
 * - codice di 6 cifre casuali (crypto.randomInt), valido 10 minuti, uno solo valido per
 *   utente e scopo alla volta: chiederne un altro annulla il precedente;
 * - si conserva solo l'impronta SHA-256 del codice, mai il codice in chiaro;
 * - 5 tentativi sbagliati annullano il codice (bisogna chiederne uno nuovo). Dal 26/11/2026
 *   ogni tentativo "prenota" uno dei 5 posti con una riga a chiave unica PRIMA del confronto:
 *   prima il contatore era letto e riscritto in due passi, e una raffica di richieste
 *   arrivate insieme leggeva tutte "0 tentativi" e provava migliaia di codici;
 * - al massimo 5 codici all'ora per utente e scopo, così nessuno riempie di email la casella;
 * - il codice si consuma al primo uso giusto.
 *
 * Dal Giorno 35 i codici stanno nel database (servizi/stato-temporaneo.ts) e non più nella
 * memoria del server: su Vercel la richiesta che controlla il codice può arrivare a un
 * processo diverso da quello che l'ha creato. `scopo` distingue i due usi ("cancellazione",
 * "accesso"), che prima erano due registri separati in memoria.
 */
import crypto from 'node:crypto';
import type { StatoTemporaneo } from './stato-temporaneo';

export const DURATA_CODICE_MS = 10 * 60 * 1000;
export const MAX_TENTATIVI_CODICE = 5;
export const MAX_CODICI_ORA = 5;
const ORA_MS = 60 * 60 * 1000;

export type EsitoCodice = 'ok' | 'assente' | 'scaduto' | 'sbagliato' | 'esaurito';

/** `tentativi` resta per i codici creati prima del 26/11/2026: i tentativi ora si contano con i posti prenotati. */
type Codice = { impronta: string; scade: number; tentativi: number };

const impronta = (codice: string) => crypto.createHash('sha256').update(codice).digest('hex');

export function registroCodici(stato: StatoTemporaneo, scopo: string, adesso: () => number = Date.now) {
  const chiaveCodice = (utenteId: number) => `codice:${scopo}:${utenteId}`;
  const chiaveRichieste = (utenteId: number) => `codici-chiesti:${scopo}:${utenteId}`;
  /** Posti dei tentativi di UN codice: la scadenza li lega a quel codice e non al successivo. */
  const prefissoTentativi = (utenteId: number) => `codice-tentativo:${scopo}:${utenteId}:`;
  const togliCodice = async (utenteId: number) => {
    await stato.togli(chiaveCodice(utenteId));
    await stato.togliConPrefisso(prefissoTentativi(utenteId));
  };

  return {
    /**
     * Crea un codice nuovo per l'utente e lo restituisce in chiaro (va solo nell'email).
     * Restituisce null se l'utente ha già chiesto MAX_CODICI_ORA codici nell'ultima ora.
     */
    async nuovo(utenteId: number): Promise<{ codice: string; scade: number } | null> {
      const ora = adesso();
      const recenti = ((await stato.leggi<number[]>(chiaveRichieste(utenteId))) ?? []).filter((t) => ora - t < ORA_MS);
      if (recenti.length >= MAX_CODICI_ORA) return null;
      await stato.scrivi(chiaveRichieste(utenteId), [...recenti, ora], ora + ORA_MS);
      const codice = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
      const scade = ora + DURATA_CODICE_MS;
      await stato.togliConPrefisso(prefissoTentativi(utenteId));
      // Tenuto un'ora oltre la scadenza: così a chi arriva tardi si può dire "scaduto" e non "assente".
      await stato.scrivi(chiaveCodice(utenteId), { impronta: impronta(codice), scade, tentativi: 0 } satisfies Codice, scade + ORA_MS);
      return { codice, scade };
    },

    /** Annulla il codice (es. l'email non è partita). */
    async annulla(utenteId: number): Promise<void> {
      await togliCodice(utenteId);
    },

    /**
     * Controlla il codice scritto dall'utente; se è giusto lo consuma, a meno di
     * `consuma: false` (chi chiama ha altri controlli da fare e poi chiama `annulla`).
     */
    async verifica(utenteId: number, scritto: string, opzioni: { consuma?: boolean } = {}): Promise<EsitoCodice> {
      const c = await stato.leggi<Codice>(chiaveCodice(utenteId));
      if (!c) return 'assente';
      if (adesso() > c.scade) {
        await togliCodice(utenteId);
        return 'scaduto';
      }
      // Il tentativo si conta prima di guardare il codice, prenotando il primo posto libero.
      let posto = 0;
      for (let n = 1; n <= MAX_TENTATIVI_CODICE && !posto; n++) {
        if (await stato.prenota(`${prefissoTentativi(utenteId)}${c.scade}:${n}`, c.scade + ORA_MS)) posto = n;
      }
      if (!posto) {
        await togliCodice(utenteId);
        return 'esaurito';
      }
      // Confronto a tempo costante sulle impronte (stessa lunghezza per costruzione).
      if (crypto.timingSafeEqual(Buffer.from(c.impronta, 'hex'), Buffer.from(impronta(scritto.trim()), 'hex'))) {
        if (opzioni.consuma !== false) await togliCodice(utenteId);
        return 'ok';
      }
      if (posto >= MAX_TENTATIVI_CODICE) {
        await togliCodice(utenteId);
        return 'esaurito';
      }
      return 'sbagliato';
    },
  };
}
