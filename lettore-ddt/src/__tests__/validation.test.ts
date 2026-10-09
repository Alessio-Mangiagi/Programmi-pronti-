import { requireString, boundedArray, firstError } from '../routes/validation';

describe('routes/validation', () => {
  it('requireString: vuota o non-stringa → errore', () => {
    expect(requireString('', 'campo').ok).toBe(false);
    expect(requireString('   ', 'campo').ok).toBe(false);
    expect(requireString(undefined, 'campo').ok).toBe(false);
    expect(requireString(42, 'campo').ok).toBe(false);
  });

  it('requireString: trim e limiti', () => {
    const r = requireString('  ciao  ', 'campo', { min: 2, max: 10 });
    expect(r.ok && r.value).toBe('ciao');
    expect(requireString('x', 'campo', { min: 2 }).ok).toBe(false);
    expect(requireString('troppolungo', 'campo', { max: 3 }).ok).toBe(false);
  });

  it('requireString: pattern', () => {
    const opts = { pattern: /^[a-z]+$/, patternError: 'solo lettere' };
    expect(requireString('abc', 'c', opts).ok).toBe(true);
    const bad = requireString('ab1', 'c', opts);
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toBe('solo lettere');
  });

  it('boundedArray: undefined → array vuoto ok; oltre il limite → errore', () => {
    const empty = boundedArray(undefined, 'a');
    expect(empty.ok && empty.value).toEqual([]);
    expect(boundedArray([1, 2, 3], 'a', 5).ok).toBe(true);
    expect(boundedArray([1, 2, 3], 'a', 2).ok).toBe(false);
    expect(boundedArray('non-array', 'a').ok).toBe(false);
  });

  it('firstError ritorna il primo errore o null', () => {
    expect(firstError(requireString('ok', 'a'), boundedArray([], 'b'))).toBeNull();
    expect(firstError(requireString('', 'a'), boundedArray('x', 'b'))).toMatch(/a obbligatorio/);
  });
});
