// "><(((º> sabusabu <º)))><"
/**
 * Test del calcolo delle festività nazionali (comune/festivita.ts).
 * Le date di Pasqua sono quelle del calendario ufficiale.
 */
import { describe, expect, it } from 'vitest';
import { festivitaNazionali, pasqua } from '../festivita';

describe('pasqua', () => {
  it.each([
    [2024, '2024-03-31'],
    [2025, '2025-04-20'],
    [2026, '2026-04-05'],
    [2027, '2027-03-28'],
    [2038, '2038-04-25'], // caso limite: Pasqua più tardiva possibile
  ])('Pasqua %i cade il %s', (anno, attesa) => {
    expect(pasqua(anno)).toBe(attesa);
  });
});

describe('festivitaNazionali', () => {
  it('nel 2026 sono 13 (compreso il 4 ottobre) e in ordine di data', () => {
    const elenco = festivitaNazionali(2026);
    expect(elenco).toHaveLength(13);
    const date = elenco.map((f) => f.data);
    expect([...date].sort()).toEqual(date);
    expect(date).toContain('2026-04-06'); // Lunedì dell'Angelo
    expect(date).toContain('2026-10-04'); // San Francesco
  });

  it('prima del 2026 il 4 ottobre non è festa nazionale', () => {
    const elenco = festivitaNazionali(2025);
    expect(elenco).toHaveLength(12);
    expect(elenco.map((f) => f.data)).not.toContain('2025-10-04');
  });
});
