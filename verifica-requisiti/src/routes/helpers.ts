/**
 * helpers.ts — costanti e utilità condivise dalle route.
 */
import fs from 'fs';
// "><(((º> sabusabu <º)))><"
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { APP_DIR, config } from '../config';

export const BASE_DIR = APP_DIR;
export const STATIC_DIR = path.join(APP_DIR, 'static');
/** I file caricati atterrano qui, poi l'ingest li sposta in data/archivio/. */
export const UPLOAD_TEMP = path.join(os.tmpdir(), 'cosedil-requisiti-upload');

export const appConfig = config;

/** 50 MB: una scansione a 300 DPI di 40 pagine ci sta dentro. */
export const MAX_FILE_SIZE = 50 * 1024 * 1024;
export const MAX_FILE_PER_UPLOAD = 20;

export const ESTENSIONI_AMMESSE = new Set(['pdf', 'png', 'jpg', 'jpeg', 'tif', 'tiff', 'p7m']);
export const MIME_AMMESSI = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/tiff',
]);
/**
 * Mime con cui arriva una busta firmata .p7m: i browser e i programmi di firma non sono d'accordo (molti mandano
 * octet-stream). Valgono solo con l'estensione .p7m; il contenuto lo controlla poi shared/firma.
 */
export const MIME_BUSTA = new Set([
  'application/pkcs7-mime',
  'application/x-pkcs7-mime',
  'application/pkcs7-signature',
  'application/octet-stream',
]);

/** Il filtro dell'upload: PDF e immagini, oppure una busta .p7m (CONTRATTI §10). */
export function fileAmmesso(nome: string, mime: string): boolean {
  const ext = path.extname(nome || '').toLowerCase().slice(1);
  if (ext === 'p7m') return MIME_BUSTA.has(mime) || MIME_AMMESSI.has(mime);
  return ESTENSIONI_AMMESSE.has(ext) && MIME_AMMESSI.has(mime);
}

export function assicuraTemp(): string {
  if (!fs.existsSync(UPLOAD_TEMP)) fs.mkdirSync(UPLOAD_TEMP, { recursive: true });
  return UPLOAD_TEMP;
}

export function sha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** Nome file ripulito: niente percorsi, niente caratteri vietati da Windows. */
export function nomeSicuro(nome: string): string {
  return path.basename(nome).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 180) || 'documento';
}

/** Pota i file più vecchi di `maxAgeMs`. Torna quanti ne ha rimossi. */
export function pruneOlderThan(dir: string, maxAgeMs: number): number {
  let rimossi = 0;
  try {
    if (!fs.existsSync(dir)) return 0;
    const limite = Date.now() - maxAgeMs;
    for (const nome of fs.readdirSync(dir)) {
      const percorso = path.join(dir, nome);
      try {
        if (fs.statSync(percorso).mtimeMs < limite) {
          fs.unlinkSync(percorso);
          rimossi++;
        }
      } catch {
        /* file sparito o in uso: lo si riprova al giro dopo */
      }
    }
  } catch {
    /* cartella non leggibile: nessuna potatura, nessun errore in faccia all'utente */
  }
  return rimossi;
}

/**
 * Un parametro di rotta come stringa.
 *
 * Da express 5 i tipi dichiarano `req.params.x` come `string | string[]`: con i
 * wildcard un parametro puo' ripetersi. Le rotte di questa app usano solo
 * segnaposto singoli (`/:id`), quindi in pratica e' sempre una stringa — ma il
 * controllo va fatto una volta qui, non con un cast in ogni file rotta.
 * Parametro assente o vuoto -> stringa vuota, che le validazioni gia' scartano.
 */
export function param(params: Record<string, unknown>, nome: string): string {
  const valore = params[nome];
  if (Array.isArray(valore)) return typeof valore[0] === 'string' ? valore[0] : '';
  return typeof valore === 'string' ? valore : '';
}
