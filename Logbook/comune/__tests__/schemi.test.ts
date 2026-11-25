// "><(((º> sabusabu <º)))><"
/**
 * Test delle regole di validazione dei moduli (comune/schemi.ts) e degli importi.
 */
import { describe, expect, it } from 'vitest';
import { centesimiDaEuro, euroDaCentesimi } from '../importi';
import { erroriPerCampo, schemaDipendente, schemaProgetto } from '../schemi';

const dipendenteValido = {
  matricola: '0099',
  nome: ' Anna ',
  cognome: 'Verdi',
  codiceFiscale: 'rssmra85t10a562s',
  email: '',
  telefono: '',
  dataAssunzione: '2026-01-07',
  tipoContratto: 'INDETERMINATO',
  oreSettimanali: '40',
  costoOrarioNettoCent: 1200,
  costoOrarioLordoCent: 2300,
};

describe('schemaDipendente', () => {
  it('accetta e normalizza una scheda corretta', () => {
    const r = schemaDipendente.parse(dipendenteValido);
    expect(r.nome).toBe('Anna');
    expect(r.codiceFiscale).toBe('RSSMRA85T10A562S');
    expect(r.email).toBeNull();
    expect(r.oreSettimanali).toBe(40);
    expect(r.stato).toBe('ATTIVO');
  });

  it('rifiuta un codice fiscale non valido con un messaggio sul campo', () => {
    const r = schemaDipendente.safeParse({ ...dipendenteValido, codiceFiscale: 'RSSMRA85T10A562X' });
    expect(r.success).toBe(false);
    if (!r.success) expect(erroriPerCampo(r.error).codiceFiscale).toMatch(/controllo/);
  });

  it('segnala i campi obbligatori mancanti', () => {
    const r = schemaDipendente.safeParse({});
    expect(r.success).toBe(false);
    if (!r.success) {
      const campi = erroriPerCampo(r.error);
      expect(Object.keys(campi)).toEqual(expect.arrayContaining(['matricola', 'nome', 'cognome', 'codiceFiscale', 'dataAssunzione', 'tipoContratto']));
    }
  });

  it('chiede la data di cessazione per un dipendente cessato e la vuole dopo l\'assunzione', () => {
    const senzaData = schemaDipendente.safeParse({ ...dipendenteValido, stato: 'CESSATO' });
    expect(senzaData.success).toBe(false);
    const primaAssunzione = schemaDipendente.safeParse({ ...dipendenteValido, stato: 'CESSATO', dataCessazione: '2025-12-31' });
    expect(primaAssunzione.success).toBe(false);
  });

  it('il costo lordo non può essere inferiore al netto', () => {
    const r = schemaDipendente.safeParse({ ...dipendenteValido, costoOrarioNettoCent: 2000, costoOrarioLordoCent: 1500 });
    expect(r.success).toBe(false);
    if (!r.success) expect(erroriPerCampo(r.error).costoOrarioLordoCent).toBeDefined();
  });

  it('rifiuta email non valide', () => {
    expect(schemaDipendente.safeParse({ ...dipendenteValido, email: 'non-una-email' }).success).toBe(false);
  });
});

describe('schemaProgetto', () => {
  it('porta il codice in maiuscolo e controlla le date', () => {
    expect(schemaProgetto.parse({ codice: 'prg-9', nome: 'Prova', dataInizio: '2026-01-01' }).codice).toBe('PRG-9');
    expect(schemaProgetto.safeParse({ codice: 'X', nome: 'Prova', dataInizio: '2026-02-01', dataFine: '2026-01-01' }).success).toBe(false);
    expect(schemaProgetto.safeParse({ codice: 'X', nome: 'Prova', dataInizio: '2026-02-01', colore: 'rosso' }).success).toBe(false);
  });
});

describe('importi', () => {
  it('converte euro e centesimi nei due sensi', () => {
    expect(centesimiDaEuro('14,50')).toBe(1450);
    expect(centesimiDaEuro('1.234,56')).toBe(123456);
    expect(centesimiDaEuro('14.5')).toBe(1450);
    expect(centesimiDaEuro('')).toBeNull();
    expect(() => centesimiDaEuro('14,555')).toThrow();
    expect(euroDaCentesimi(1450)).toBe('14,50');
  });
});
