// "><(((º> sabusabu <º)))><"
/**
 * Test della scelta "dati di esempio sì/no" all'avvio con database vuoto
 * (server/dati-demo.ts, usato da scripts/prepara-db.ts).
 */
import { describe, expect, it } from 'vitest';
import { decidiDatiDemo, interpretaSiNo } from '../dati-demo';

describe('interpretaSiNo', () => {
  it('riconosce sì e no scritti in vari modi', () => {
    for (const v of ['1', 'si', 'Sì', 'TRUE', ' yes ', 'on']) expect(interpretaSiNo(v)).toBe(true);
    for (const v of ['0', 'no', 'False', 'off']) expect(interpretaSiNo(v)).toBe(false);
  });
  it('vuoto = null, valore strano = undefined', () => {
    expect(interpretaSiNo(undefined)).toBeNull();
    expect(interpretaSiNo('  ')).toBeNull();
    expect(interpretaSiNo('forse')).toBeUndefined();
  });
});

describe('decidiDatiDemo', () => {
  it('senza variabile: dati di esempio in sviluppo, database vuoto in produzione', () => {
    expect(decidiDatiDemo(undefined, 'sviluppo')).toEqual({ carica: true });
    expect(decidiDatiDemo(undefined, 'produzione')).toEqual({ carica: false });
  });
  it('la variabile vince sul modo', () => {
    expect(decidiDatiDemo('1', 'produzione')).toEqual({ carica: true });
    expect(decidiDatiDemo('0', 'sviluppo')).toEqual({ carica: false });
  });
  it('valore non riconosciuto: default del modo e avviso nel log', () => {
    const r = decidiDatiDemo('forse', 'produzione');
    expect(r.carica).toBe(false);
    expect(r.avviso).toMatch(/non riconosciuto/);
  });
});
