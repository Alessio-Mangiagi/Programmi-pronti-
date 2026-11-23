// "><(((º> sabusabu <º)))><"
/**
 * Test delle funzioni di base su date (comune/date.ts) e orari (comune/orari.ts).
 * La logica delle sovrapposizioni ha i suoi test dal Giorno 4.
 */
import { describe, expect, it } from 'vitest';
import { aggiungiGiorni, daDataItaliana, formattaData, intervalloDate, isDataValida, isFineSettimana } from '../date';
import { durataMinuti, formattaOre, minutiDaOrario, orarioDaMinuti } from '../orari';

describe('date', () => {
  it('riconosce date inesistenti', () => {
    expect(isDataValida('2026-02-28')).toBe(true);
    expect(isDataValida('2026-02-29')).toBe(false);
    expect(isDataValida('2028-02-29')).toBe(true);
    expect(isDataValida('2026-13-01')).toBe(false);
  });

  it('somma giorni attraverso mese e anno', () => {
    expect(aggiungiGiorni('2026-12-31', 1)).toBe('2027-01-01');
    expect(aggiungiGiorni('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('il cambio ora legale non sposta i giorni', () => {
    // 29/03/2026 e 25/10/2026: cambio ora in Italia
    expect(intervalloDate('2026-03-28', '2026-03-30')).toEqual(['2026-03-28', '2026-03-29', '2026-03-30']);
    expect(intervalloDate('2026-10-24', '2026-10-26')).toHaveLength(3);
  });

  it('riconosce il fine settimana', () => {
    expect(isFineSettimana('2026-11-21')).toBe(true); // sabato
    expect(isFineSettimana('2026-11-22')).toBe(true); // domenica
    expect(isFineSettimana('2026-11-23')).toBe(false); // lunedì
  });

  it('converte dal e al formato italiano', () => {
    expect(formattaData('2026-11-05')).toBe('05/11/2026');
    expect(daDataItaliana('5/11/2026')).toBe('2026-11-05');
    expect(daDataItaliana('31/11/2026')).toBeNull();
  });
});

describe('orari', () => {
  it('calcola minuti e durate', () => {
    expect(minutiDaOrario('08:30')).toBe(510);
    expect(orarioDaMinuti(510)).toBe('08:30');
    expect(durataMinuti('08:00', '12:30')).toBe(270);
    expect(formattaOre(270)).toBe('4:30');
  });

  it('rifiuta orari non validi e fasce rovesciate', () => {
    expect(() => minutiDaOrario('24:00')).toThrow(/non valido/);
    expect(() => minutiDaOrario('8:00')).toThrow(/non valido/);
    expect(() => durataMinuti('13:00', '12:00')).toThrow(/successiva/);
    expect(() => durataMinuti('09:00', '09:00')).toThrow(/successiva/);
  });
});
