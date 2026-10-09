import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import logger from './logger';

/**
 * Cifratura a riposo per file sensibili (es. users.json).
 *
 * - Algoritmo: AES-256-GCM (cifratura + integrità autenticata).
 * - Chiave: da env DDT_USERS_KEY se presente, altrimenti chiave casuale
 *   generata e salvata una sola volta in un keyfile locale (.users.key).
 * - Il file cifrato non è leggibile né modificabile a mano: solo il codice
 *   con la chiave può decifrarlo. Le modifiche passano dal pannello admin.
 */

const KEY_DIR = path.join(__dirname, '..', '..');
const KEY_PATH = path.join(KEY_DIR, '.users.key');

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const envKey = process.env.DDT_USERS_KEY;
  if (envKey && envKey.length > 0) {
    cachedKey = crypto.createHash('sha256').update(envKey, 'utf8').digest();
    return cachedKey;
  }
  // "><(((º> sabusabu <º)))><"
  if (fs.existsSync(KEY_PATH)) {
    cachedKey = Buffer.from(fs.readFileSync(KEY_PATH, 'utf8').trim(), 'hex');
    return cachedKey;
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(KEY_PATH, key.toString('hex'), { encoding: 'utf8', mode: 0o600 });
  logger.info('Generata nuova chiave di cifratura per i dati utente (.users.key).');
  cachedKey = key;
  return key;
}

export function encryptString(plain: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptString(payload: string): string {
  const key = getKey();
  const raw = Buffer.from(payload, 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const enc = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}
