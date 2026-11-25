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

/** Lunghezza minima di una password nuova: 8 per i dipendenti, 12 per gli amministratori (Giorno 34). */
const PASSWORD_MIN = 8;
const PASSWORD_MIN_ADMIN = 12;

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

/**
 * Password troppo facili da indovinare (Giorno 34): le più usate in Italia e quelle legate
 * al programma. Il confronto ignora maiuscole e cifre/simboli in coda ("Password2026!" vale
 * "password"). Elenco corto di proposito: ferma i tentativi ovvi, il resto lo fanno la
 * lunghezza minima e il blocco progressivo dei tentativi (rotte/auth.ts).
 */
const TROPPO_COMUNI = new Set([
  'password', 'passw0rd', 'qwerty', 'qwertyuiop', 'asdfghjkl', 'abc', 'abcd', 'abcdef', 'admin', 'administrator', 'amministratore',
  'logbook', 'cosedil', 'nexora', 'benvenuto', 'welcome', 'ciao', 'ciaociao', 'juventus', 'napoli', 'milan', 'inter', 'roma', 'forzaroma',
  'forzanapoli', 'amore', 'andrea', 'francesco', 'giuseppe', 'alessandro', 'cambiami', 'changeme', 'letmein', 'iloveyou', 'dragon', 'monkey',
]);

/**
 * Messaggio d'errore se la password nuova è troppo debole, altrimenti null. `ruolo` decide
 * la lunghezza minima: un amministratore vede i dati di tutti, quindi 12 caratteri.
 */
export function controllaPasswordNuova(password: string, ruolo: 'ADMIN' | 'DIPENDENTE' = 'DIPENDENTE'): string | null {
  const minimo = ruolo === 'ADMIN' ? PASSWORD_MIN_ADMIN : PASSWORD_MIN;
  if (password.length < minimo) return `La password deve avere almeno ${minimo} caratteri${ruolo === 'ADMIN' ? ' (account amministratore)' : ''}`;
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'La password deve contenere lettere e numeri';
  const radice = password.toLowerCase().replace(/[^a-z]+$/, '');
  if (TROPPO_COMUNI.has(radice) || /^(.)\1+$/.test(password)) return 'Password troppo facile da indovinare: scegline una meno comune';
  return null;
}
