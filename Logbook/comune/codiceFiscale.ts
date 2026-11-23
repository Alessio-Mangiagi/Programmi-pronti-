// "><(((º> sabusabu <º)))><"
/**
 * Validazione del codice fiscale delle persone fisiche (16 caratteri).
 *
 * Controlla struttura, mese, giorno e carattere di controllo secondo il DM 23/12/1976,
 * compresa l'omocodia (cifre sostituite da lettere L-V quando due persone avrebbero
 * lo stesso codice). Non verifica che il codice sia davvero assegnato a qualcuno:
 * per quello servirebbe l'Agenzia delle Entrate. Usato dalla scheda dipendente
 * (Giorno 3) e dall'import Excel.
 */

/** Lettere che sostituiscono le cifre 0-9 nei codici omocodici, nell'ordine. */
const OMOCODIA = 'LMNPQRSTUV';

/** Lettere valide per il mese di nascita: gennaio = A … dicembre = T. */
const LETTERE_MESE = 'ABCDEHLMPRST';

/** Valori dei caratteri in posizione dispari (1ª, 3ª, … contando da 1). */
const VALORI_DISPARI: Record<string, number> = {
  0: 1, 1: 0, 2: 5, 3: 7, 4: 9, 5: 13, 6: 15, 7: 17, 8: 19, 9: 21,
  A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18,
  N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
};

/**
 * Struttura: 6 lettere, 2 cifre anno, lettera mese, 2 cifre giorno, lettera + 3 cifre
 * del comune, lettera di controllo. Nelle posizioni numeriche sono ammesse anche le
 * lettere dell'omocodia.
 */
const RE_STRUTTURA = /^[A-Z]{6}[\dLMNPQRSTUV]{2}[A-Z][\dLMNPQRSTUV]{2}[A-Z][\dLMNPQRSTUV]{3}[A-Z]$/;

/** Esito della validazione, con il motivo leggibile in caso di errore. */
export type EsitoCodiceFiscale = { valido: true; codice: string } | { valido: false; errore: string };

/** Toglie spazi e porta in maiuscolo: forma con cui il codice si salva nel database. */
export function normalizzaCodiceFiscale(testo: string): string {
  return testo.replace(/\s+/g, '').toUpperCase();
}

/**
 * Calcola il carattere di controllo dai primi 15 caratteri (già normalizzati).
 * Le posizioni dispari (1ª, 3ª, …) usano la tabella dedicata, le pari valgono
 * 0-9 per le cifre e 0-25 per le lettere A-Z; il resto della somma diviso 26 è la lettera.
 */
export function carattereControllo(primi15: string): string {
  if (primi15.length !== 15) throw new Error('Servono esattamente 15 caratteri');
  let somma = 0;
  for (let i = 0; i < 15; i++) {
    const c = primi15[i];
    if (i % 2 === 0) {
      somma += VALORI_DISPARI[c] ?? 0;
    } else {
      somma += /\d/.test(c) ? Number(c) : c.charCodeAt(0) - 65;
    }
  }
  return String.fromCharCode(65 + (somma % 26));
}

/** Riporta a cifre le posizioni numeriche di un codice omocodico (per leggere giorno e mese). */
function deomocodifica(codice: string): string {
  const posizioniNumeriche = [6, 7, 9, 10, 12, 13, 14];
  const caratteri = codice.split('');
  for (const p of posizioniNumeriche) {
    const indice = OMOCODIA.indexOf(caratteri[p]);
    if (indice >= 0) caratteri[p] = String(indice);
  }
  return caratteri.join('');
}

/**
 * Valida un codice fiscale. Accetta minuscole e spazi (li normalizza) e restituisce
 * il codice normalizzato da salvare, oppure un messaggio d'errore in italiano.
 */
export function validaCodiceFiscale(testo: string): EsitoCodiceFiscale {
  const codice = normalizzaCodiceFiscale(testo);
  if (codice.length !== 16) {
    return { valido: false, errore: `Il codice fiscale deve avere 16 caratteri (ne ha ${codice.length})` };
  }
  if (!RE_STRUTTURA.test(codice)) {
    return { valido: false, errore: 'Il codice fiscale non ha la struttura corretta (es. RSSMRA85C15C351X)' };
  }
  const chiaro = deomocodifica(codice);
  if (!LETTERE_MESE.includes(chiaro[8])) {
    return { valido: false, errore: `La lettera del mese di nascita "${chiaro[8]}" non esiste` };
  }
  // Giorno: 1-31 per gli uomini, 41-71 per le donne (giorno + 40).
  const giorno = Number(chiaro.slice(9, 11));
  if (!((giorno >= 1 && giorno <= 31) || (giorno >= 41 && giorno <= 71))) {
    return { valido: false, errore: `Il giorno di nascita "${chiaro.slice(9, 11)}" non è valido` };
  }
  const atteso = carattereControllo(codice.slice(0, 15));
  if (codice[15] !== atteso) {
    return { valido: false, errore: 'Il carattere di controllo non corrisponde: controllare di aver copiato bene il codice' };
  }
  return { valido: true, codice };
}
