// apiKeyStore.ts — chiave API Anthropic impostata dal pannello admin.
//
// La chiave arriva da Admin → "Chiave API", viene cifrata con la stessa
// AES-256-GCM dei dati utente (secureStore) e finisce in .apikey.enc nella
// root dell'app. Non viaggia mai in chiaro verso il browser: le route la
// espongono solo mascherata (maskApiKey).

import fs from 'fs';
import path from 'path';
import { APP_DIR } from '../config';
import { encryptString, decryptString } from '../utils/secureStore';
import logger from '../utils/logger';

// DDT_APIKEY_PATH: usato dai test per non toccare il file reale nella root
// (le suite Jest girano in parallelo, ognuna con il proprio file temporaneo).
export const API_KEY_PATH = process.env.DDT_APIKEY_PATH || path.join(APP_DIR, '.apikey.enc');

// Formato Anthropic: sk-ant-… . Il resto della stringa non è documentato,
// quindi si accetta qualsiasi coda "da token" senza spazi.
const API_KEY_RE = /^sk-ant-[\w-]{8,512}$/;

export function isValidApiKeyFormat(key: string): boolean {
  return API_KEY_RE.test(key);
}

export function readStoredApiKey(): string | undefined {
  if (!fs.existsSync(API_KEY_PATH)) return undefined;
  try {
    const key = decryptString(fs.readFileSync(API_KEY_PATH, 'utf8').trim()).trim();
    return key || undefined;
  } catch (e) {
    // Keyfile (.users.key) cambiato o file manomesso: la chiave va reinserita.
    logger.error(`Chiave API cifrata illeggibile (${API_KEY_PATH}): ${(e as Error).message}`);
    return undefined;
  }
}

export function saveStoredApiKey(key: string): void {
  fs.writeFileSync(API_KEY_PATH, encryptString(key.trim()), { encoding: 'utf8', mode: 0o600 });
}

export function deleteStoredApiKey(): boolean {
  if (!fs.existsSync(API_KEY_PATH)) return false;
  fs.unlinkSync(API_KEY_PATH);
  return true;
}

/** Prefisso e ultime 4 cifre: quanto basta per riconoscerla, mai per usarla. */
export function maskApiKey(key: string): string {
  if (key.length < 16) return '••••••••';
  return `${key.slice(0, 10)}••••••••${key.slice(-4)}`;
}
