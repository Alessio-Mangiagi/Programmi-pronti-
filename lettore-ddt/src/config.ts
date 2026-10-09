/**
 * config.ts — Fonte unica per configurazione runtime e versione.
 *
 * Legge `config.json` una sola volta all'avvio ed espone valori tipizzati.
 * Sostituisce le letture duplicate che prima vivevano in app.ts, server.ts e
 * routes/index.ts. La versione è derivata da package.json (un solo punto).
 */
import fs from 'fs';
import path from 'path';

// config.js sta alla radice di dist/ (e config.ts alla radice di src/) → un solo '..'.
const isPkg = typeof (process as unknown as { pkg?: unknown }).pkg !== 'undefined';
export const APP_DIR = isPkg ? path.dirname(process.execPath) : path.join(__dirname, '..');

export interface AppConfig {
  inactivityTimeoutMinutes: number;
  maxJsonExports: number;
  maxVersionFiles: number;
  host: string;
  serverMode: boolean;
  secureCookies: boolean;
  trustProxy: boolean;
  /**
   * Cartella (relativa alla radice dell'app o assoluta) per il backup
   * giornaliero di archivio commesse e utenti. Il default "backup" protegge da
   * corruzione e cancellazioni; per proteggersi anche dalla morte del disco,
   * puntarla a un percorso di rete o a un altro disco. '' = disattivato.
   */
  backupDir: string;
  /** Quanti backup giornalieri tenere. */
  backupKeep: number;
}

const DEFAULTS: AppConfig = {
  inactivityTimeoutMinutes: 15,
  maxJsonExports: 50,
  maxVersionFiles: 100,
  host: '127.0.0.1',
  serverMode: false,
  secureCookies: false,
  trustProxy: false,
  backupDir: 'backup',
  backupKeep: 14,
};

function loadConfig(): AppConfig {
  let cfg: AppConfig = { ...DEFAULTS };
  try {
    const cfgPath = path.join(APP_DIR, 'config.json');
    if (fs.existsSync(cfgPath)) {
      cfg = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(cfgPath, 'utf8')) };
    }
  } catch {
    /* config.json assente o non valido → default */
  }
  // L'env HOST vince su config.json: il Portale Suite la passa alle app che
  // avvia, così in LAN l'app si lega dove i browser degli altri PC la cercano
  // (vedi launchApp in portale/server.js). L'accesso resta protetto dal gate SSO.
  if (process.env.HOST) cfg.host = process.env.HOST;
  return cfg;
}

export const config: AppConfig = loadConfig();

// "><(((º> sabusabu <º)))><"
export const VERSION: string = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
})();
