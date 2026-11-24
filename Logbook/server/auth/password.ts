// "><(((º> sabusabu <º)))><"
/**
 * Impronte delle password con scrypt (modulo crypto di Node, nessuna dipendenza).
 *
 * Formato salvato in Utente.passwordHash:  scrypt$N$r$p$<sale base64>$<impronta base64>
 * I parametri stanno dentro la stringa, così si possono rafforzare in futuro senza
 * invalidare le password già salvate.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const scrypt = (password: string, sale: Buffer, lunghezza: number, opzioni: ScryptOptions) =>
  new Promise<Buffer>((ok, ko) => scryptCb(password, sale, lunghezza, opzioni, (e, k) => (e ? ko(e) : ok(k))));

const N = 16384;
const R = 8;
const P = 1;
const LUNGHEZZA = 64;

/** Lunghezza minima richiesta per una password nuova. */
const PASSWORD_MIN = 8;

export async function creaImpronta(password: string): Promise<string> {
  const sale = randomBytes(16);
  const impronta = await scrypt(password, sale, LUNGHEZZA, { N, r: R, p: P });
  return ['scrypt', N, R, P, sale.toString('base64'), impronta.toString('base64')].join('$');
}

/** true se la password corrisponde all'impronta. Confronto a tempo costante. */
export async function verificaPassword(password: string, salvata: string): Promise<boolean> {
  const parti = salvata.split('$');
  if (parti.length !== 6 || parti[0] !== 'scrypt') return false;
  const [, n, r, p, saleB64, improntaB64] = parti;
  const attesa = Buffer.from(improntaB64, 'base64');
  const calcolata = await scrypt(password, Buffer.from(saleB64, 'base64'), attesa.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return calcolata.length === attesa.length && timingSafeEqual(calcolata, attesa);
}

/** Messaggio d'errore se la password nuova è troppo debole, altrimenti null. */
export function controllaPasswordNuova(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `La password deve avere almeno ${PASSWORD_MIN} caratteri`;
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'La password deve contenere lettere e numeri';
  return null;
}
