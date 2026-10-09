/**
 * config.ts — fonte unica per configurazione runtime e versione.
 * Legge config.json una volta all'avvio (stesso schema di lettore-ddt).
 */
import fs from 'fs';
import path from 'path';

const isPkg = typeof (process as unknown as { pkg?: unknown }).pkg !== 'undefined';
export const APP_DIR = isPkg ? path.dirname(process.execPath) : path.join(__dirname, '..');

export type MotoreOcr = 'tesseract' | 'paddle' | 'claude';

export interface AppConfig {
  inactivityTimeoutMinutes: number;
  host: string;
  serverMode: boolean;
  secureCookies: boolean;
  trustProxy: boolean;
  /** Motore OCR usato per i documenti senza testo nativo. */
  motoreOcr: MotoreOcr;
  /** Sotto questi caratteri estratti da un PDF lo si considera una scansione. */
  sogliaTestoNativo: number;
  /** Tetto ai documenti in archivio: oltre, l'upload rifiuta. */
  maxDocumenti: number;
}

const DEFAULTS: AppConfig = {
  inactivityTimeoutMinutes: 15,
  host: '127.0.0.1',
  serverMode: false,
  secureCookies: false,
  trustProxy: false,
  motoreOcr: 'tesseract',
  sogliaTestoNativo: 200,
  maxDocumenti: 5000,
};

function loadConfig(): AppConfig {
  let cfg: AppConfig = { ...DEFAULTS };
  // "><(((º> sabusabu <º)))><"
  try {
    const cfgPath = path.join(APP_DIR, 'config.json');
    if (fs.existsSync(cfgPath)) {
      cfg = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(cfgPath, 'utf8')) };
    }
  } catch {
    /* config.json assente o non valido -> default */
  }
  // L'env HOST vince su config.json: il Portale Suite la passa alle app che
  // avvia, così in LAN l'app si lega dove i browser degli altri PC la cercano.
  if (process.env.HOST) cfg.host = process.env.HOST;
  if (process.env.MOTORE_OCR) cfg.motoreOcr = process.env.MOTORE_OCR as MotoreOcr;
  return cfg;
}

export const config: AppConfig = loadConfig();

export const VERSION: string = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
})();
