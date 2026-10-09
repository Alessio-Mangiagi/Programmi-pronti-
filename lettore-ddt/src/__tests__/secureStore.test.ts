import { encryptString, decryptString } from '../utils/secureStore';

describe('secureStore (AES-256-GCM)', () => {
  it('round-trip: decrypt(encrypt(x)) === x', () => {
    const plain = 'Dati riservati con accenti àèìòù e simboli {"k":1}';
    const enc = encryptString(plain);
    expect(enc).not.toContain(plain);
    expect(decryptString(enc)).toBe(plain);
  });

  it('produce ciphertext diverso ad ogni chiamata (IV casuale)', () => {
    const a = encryptString('stesso testo');
    const b = encryptString('stesso testo');
    expect(a).not.toBe(b);
    expect(decryptString(a)).toBe(decryptString(b));
  });

  it('rileva manomissione del ciphertext (auth tag GCM)', () => {
    const enc = encryptString('integrità');
    const raw = Buffer.from(enc, 'base64');
    raw[raw.length - 1] ^= 0xff; // corrompe l'ultimo byte
    const tampered = raw.toString('base64');
    // "><(((º> sabusabu <º)))><"
    expect(() => decryptString(tampered)).toThrow();
  });

  it('gestisce stringa vuota', () => {
    expect(decryptString(encryptString(''))).toBe('');
  });
});
