// "><(((º> sabusabu <º)))><"
/**
 * Omonimi distinti dal codice fiscale (comune/omonimi.ts, Giorno 18): senza omonimi resta
 * "Cognome Nome"; con omonimi si aggiunge il prefisso più corto (almeno 6 caratteri) del
 * codice fiscale che li rende tutti diversi.
 */
import { describe, expect, it } from 'vitest';
import { dettaglioDipendente, nomiSenzaOmonimie } from '../omonimi';

const d = (id: number, cognome: string, nome: string, codiceFiscale: string) => ({ id, cognome, nome, codiceFiscale });

describe('nomiSenzaOmonimie', () => {
  it('senza omonimi: solo cognome e nome', () => {
    const nomi = nomiSenzaOmonimie([d(1, 'Rossi', 'Mario', 'RSSMRA85C15C351M'), d(2, 'Bianchi', 'Giulia', 'BNCGLI90L62F205X')]);
    expect(nomi.get(1)).toBe('Rossi Mario');
    expect(nomi.get(2)).toBe('Bianchi Giulia');
  });

  it('due omonimi: prefisso del codice fiscale che basta a distinguerli', () => {
    const nomi = nomiSenzaOmonimie([d(1, 'Rossi', 'Mario', 'RSSMRA85C15C351M'), d(2, 'Rossi', 'Mario', 'RSSMRA90A01H501W'), d(3, 'Russo', 'Giuseppe', 'RSSGPP82E28G273I')]);
    expect(nomi.get(1)).toBe('Rossi Mario (CF RSSMRA8)');
    expect(nomi.get(2)).toBe('Rossi Mario (CF RSSMRA9)');
    expect(nomi.get(3)).toBe('Russo Giuseppe');
  });

  it('maiuscole e spazi non contano; prefisso più lungo se serve', () => {
    const nomi = nomiSenzaOmonimie([d(1, 'Rossi', 'Mario', 'RSSMRA85C15C351M'), d(2, 'ROSSI', 'mario', 'RSSMRA85C15H501Z')]);
    expect(nomi.get(1)).toBe('Rossi Mario (CF RSSMRA85C15C)');
    expect(nomi.get(2)).toBe('ROSSI mario (CF RSSMRA85C15H)');
  });

  it('dettaglio: matricola, codice fiscale e mansione', () => {
    expect(dettaglioDipendente({ matricola: '0001', codiceFiscale: 'RSSMRA85C15C351M', mansione: 'Capocantiere' })).toBe('matr. 0001 · CF RSSMRA85C15C351M · Capocantiere');
  });
});
