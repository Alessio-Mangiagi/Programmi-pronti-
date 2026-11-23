// "><(((º> sabusabu <º)))><"
/**
 * Test della validazione del codice fiscale (comune/codiceFiscale.ts).
 * I codici validi usati qui sono fittizi ma con carattere di controllo corretto.
 */
import { describe, expect, it } from 'vitest';
import { carattereControllo, validaCodiceFiscale } from '../codiceFiscale';

describe('validaCodiceFiscale', () => {
  it('accetta un codice corretto e lo restituisce normalizzato', () => {
    const esito = validaCodiceFiscale(' rssmra85t10a562s ');
    expect(esito).toEqual({ valido: true, codice: 'RSSMRA85T10A562S' });
  });

  it('accetta il codice di una donna (giorno + 40)', () => {
    const corpo = 'BNCGLI90L62F205';
    expect(validaCodiceFiscale(corpo + carattereControllo(corpo)).valido).toBe(true);
  });

  it('accetta un codice omocodico (cifre sostituite da lettere)', () => {
    // RSSMRA85T10A562S con l'ultima cifra del comune (2) sostituita da N
    const corpo = 'RSSMRA85T10A56N';
    expect(validaCodiceFiscale(corpo + carattereControllo(corpo)).valido).toBe(true);
  });

  it('rifiuta un carattere di controllo sbagliato', () => {
    const esito = validaCodiceFiscale('RSSMRA85T10A562X');
    expect(esito.valido).toBe(false);
    if (!esito.valido) expect(esito.errore).toMatch(/controllo/);
  });

  it('rifiuta la lunghezza sbagliata', () => {
    const esito = validaCodiceFiscale('RSSMRA85T10A562');
    expect(esito.valido).toBe(false);
    if (!esito.valido) expect(esito.errore).toMatch(/16 caratteri/);
  });

  it('rifiuta una struttura sbagliata', () => {
    expect(validaCodiceFiscale('1234567890123456').valido).toBe(false);
  });

  it('rifiuta un mese inesistente', () => {
    const corpo = 'RSSMRA85F10A562'; // F non è una lettera di mese
    const esito = validaCodiceFiscale(corpo + carattereControllo(corpo));
    expect(esito.valido).toBe(false);
    if (!esito.valido) expect(esito.errore).toMatch(/mese/);
  });

  it('rifiuta un giorno impossibile', () => {
    const corpo = 'RSSMRA85T35A562'; // 35 non è né un giorno da uomo né da donna
    const esito = validaCodiceFiscale(corpo + carattereControllo(corpo));
    expect(esito.valido).toBe(false);
    if (!esito.valido) expect(esito.errore).toMatch(/giorno/);
  });
});
