// "><(((º> sabusabu <º)))><"
/**
 * sessioniFile.ts — scritture delle sessioni su file che resistono alle richieste parallele su Windows.
 *
 * Le sessioni del Lettore DDT stanno su disco (session-file-store) e con `rolling: true` OGNI richiesta
 * le riscrive. All'apertura della pagina partono più richieste insieme (/auth/me, la barra comune
 * /guscio/stato, ...) sulla stessa sessione: su Windows due rename atomici di write-file-atomic sullo
 * stesso file si scontrano con EPERM/EBUSY/EACCES. session-file-store ritenta solo le letture, non le
 * scritture: l'errore arrivava a express-session, la richiesta finiva in 500 e la pagina poteva credere
 * che non ci fosse una sessione (visto riproducendo "DDT e Magazzino" col login unico, 09/11/2026).
 * Qui set e touch si ritentano qualche volta con una piccola attesa crescente; gli altri errori passano.
 */
import type { Store } from 'express-session';

const CODICI_CONTESA = new Set(['EPERM', 'EBUSY', 'EACCES']);

type Callback = (err?: unknown) => void;
type Scrittura = (sid: string, sessione: unknown, cb?: Callback) => void;

/** Aggiunge i ritentativi alle scritture (set, touch) dello store; restituisce lo stesso store. */
export function conRitentativi<T extends Store>(store: T, tentativi = 8): T {
  for (const metodo of ['set', 'touch'] as const) {
    const originale = (store as unknown as Record<string, Scrittura | undefined>)[metodo];
    if (typeof originale !== 'function') continue;
    const legato = originale.bind(store);
    (store as unknown as Record<string, Scrittura>)[metodo] = (sid, sessione, cb) => {
      let fatti = 0;
      const prova = (): void =>
        legato(sid, sessione, (err?: unknown) => {
          const codice = (err as NodeJS.ErrnoException | undefined)?.code || '';
          if (err && CODICI_CONTESA.has(codice) && fatti < tentativi) {
            fatti += 1;
            // attesa breve e un po' casuale: due richieste in contesa non riprovano nello stesso istante
            setTimeout(prova, 10 * fatti + Math.floor(Math.random() * 25));
            return;
          }
          if (cb) cb(err);
        });
      prova();
    };
  }
  return store;
}
