// "><(((º> sabusabu <º)))><"
/**
 * Giorno 4 — logica di calcolo delle ore e delle sovrapposizioni (comune/registrazioni.ts).
 */
import { describe, expect, it } from 'vitest';
import { erroriPerCampo } from '../schemi';
import { coppieSovrapposte, primaSovrapposizione, schemaFascia, schemaGiornata, siSovrappongono, totaleMinuti } from '../registrazioni';

const f = (oraInizio: string, oraFine: string, id?: number) => ({ id, oraInizio, oraFine });

describe('siSovrappongono', () => {
  it.each([
    ['08:00', '12:00', '11:00', '13:00', true], // parziale
    ['08:00', '12:00', '09:00', '10:00', true], // contenuta
    ['09:00', '10:00', '08:00', '12:00', true], // contenente
    ['08:00', '12:00', '08:00', '12:00', true], // identica
    ['08:00', '12:00', '12:00', '13:00', false], // contigua: ammessa
    ['13:00', '17:00', '08:00', '12:00', false], // separate
    ['08:00', '08:01', '08:00', '08:01', true], // un minuto in comune
  ])('%s-%s vs %s-%s → %s', (a1, a2, b1, b2, atteso) => {
    expect(siSovrappongono(f(a1, a2), f(b1, b2))).toBe(atteso);
    expect(siSovrappongono(f(b1, b2), f(a1, a2))).toBe(atteso); // simmetrica
  });
});

describe('primaSovrapposizione', () => {
  const esistenti = [f('08:00', '12:00', 1), f('13:00', '17:00', 2)];

  it('trova la fascia in conflitto', () => {
    expect(primaSovrapposizione(f('11:30', '13:30'), esistenti)?.id).toBe(1);
    expect(primaSovrapposizione(f('12:00', '13:00'), esistenti)).toBeUndefined();
  });

  it('in modifica ignora la fascia stessa', () => {
    expect(primaSovrapposizione(f('08:00', '12:30', 1), esistenti)).toBeUndefined();
    expect(primaSovrapposizione(f('08:00', '13:30', 1), esistenti)?.id).toBe(2);
  });
});

describe('calcolo ore', () => {
  it('somma le durate delle fasce', () => {
    expect(totaleMinuti([f('07:30', '12:30'), f('13:30', '16:45')])).toBe(5 * 60 + 3 * 60 + 15);
    expect(totaleMinuti([])).toBe(0);
  });

  it('elenca le coppie sovrapposte ignorando le righe con orari non validi', () => {
    expect(coppieSovrapposte([f('08:00', '12:00'), f('11:00', '13:00'), f('12:30', '14:00'), f('25:00', '26:00')])).toEqual([
      [0, 1],
      [1, 2],
    ]);
  });
});

describe('validazione', () => {
  it('rifiuta una fascia con fine prima dell\'inizio o orari non validi', () => {
    const rovesciata = schemaFascia.safeParse({ progettoId: 1, oraInizio: '14:00', oraFine: '13:00' });
    expect(rovesciata.success).toBe(false);
    if (!rovesciata.success) expect(erroriPerCampo(rovesciata.error).oraFine).toMatch(/dopo/);
    expect(schemaFascia.safeParse({ progettoId: 1, oraInizio: '8:00', oraFine: '13:00' }).success).toBe(false);
    expect(schemaFascia.safeParse({ progettoId: 1, oraInizio: '08:00', oraFine: '24:00' }).success).toBe(false);
  });

  it('una giornata con righe sovrapposte indica la riga sbagliata', () => {
    const r = schemaGiornata.safeParse({
      dipendenteId: 1,
      data: '2026-11-23',
      fasce: [
        { progettoId: 1, oraInizio: '08:00', oraFine: '12:00' },
        { progettoId: 2, oraInizio: '11:00', oraFine: '15:00' },
      ],
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(erroriPerCampo(r.error)['fasce.1.oraInizio']).toMatch(/riga 1/);
  });
});
