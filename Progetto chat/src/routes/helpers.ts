// helpers.ts — Utilità condivise: costanti, validazione, gestione cartelle per-commessa,
// scrittura atomica serializzata, CSV, path security. Usate da tutti i moduli route.

import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { config } from '../config';

export const appConfig = config;

/**
 * Un parametro di rotta come stringa.
 *
 * Da express 5 i tipi dichiarano `req.params.x` come `string | string[]`: con i
 * wildcard un parametro puo' ripetersi. Le rotte di questa app usano solo
 * segnaposto singoli (`/:id`), quindi in pratica e' sempre una stringa — ma il
 * controllo va fatto una volta qui, non con venti cast sparsi nei file rotta.
 * Parametro assente o vuoto -> stringa vuota, che le validazioni gia' scartano.
 */
export function param(params: Record<string, unknown>, nome: string): string {
  const valore = params[nome];
  if (Array.isArray(valore)) return typeof valore[0] === 'string' ? valore[0] : '';
  return typeof valore === 'string' ? valore : '';
}

// ── Regex condivise per validazione ──────────────────────────────────────────
// commessaId: alphanumerico, underscore, trattino. Max 64 char (previene path traversal)
export const COMMESSA_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
// UUID standard: 8-4-4-4-12 hex digits
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Cartelle base ────────────────────────────────────────────────────────────
// Detecta se il processo è pkg-compiled (executable standalone) o script Node.js
const isPkg = typeof (process as unknown as { pkg?: unknown }).pkg !== 'undefined';
// BASE_DIR: root progetto (necessario per gestire relative paths consistentemente)
export const BASE_DIR = isPkg ? path.dirname(process.execPath) : path.join(__dirname, '..', '..');
// Cartelle temporanee su OS temp folder per PDF upload e output Excel
export const UPLOAD_FOLDER = path.join(os.tmpdir(), 'pdf_to_xlsx_uploads');
export const OUTPUT_FOLDER = path.join(os.tmpdir(), 'pdf_to_xlsx_outputs');

// Crea cartelle temp se non esistono
[UPLOAD_FOLDER, OUTPUT_FOLDER].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ── Dati per-commessa: data/<commessaId>/{versions,json_exports,autosave,…} ──
// Funzioni di path security: non permette path traversal anche con commessaId malevolo

// Cartella root per una commessa. Applica due validazioni:
// 1. Regex whitelist (alphanumerico, _, -)
// 2. path.relative check (blocca ../ traversal)
export function commessaDataDir(commessaId: string): string {
  // Validazione 1: regex whitelist contro caratteri pericolosi
  if (!COMMESSA_ID_RE.test(commessaId)) {
    throw Object.assign(new Error('commessaId non valido'), { statusCode: 400 });
  }

  const base = path.join(BASE_DIR, 'data');
  const dir = path.join(base, commessaId);

  // Validazione 2: path.relative check → se il path è esterno a base, startsWith '..'
  // Previene path traversal anche con commessaId='../../etc/passwd'
  const rel = path.relative(base, dir);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw Object.assign(new Error('commessaId non valido'), { statusCode: 400 });
  }

  // Crea cartella se non esiste
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Cartella versioni del progetto (per versionamento storico)
export function commessaVersionsFolder(commessaId: string): string {
  const dir = path.join(commessaDataDir(commessaId), 'versions');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Cartella export JSON (audit trail conversioni PDF)
export function commessaJsonFolder(commessaId: string): string {
  const dir = path.join(commessaDataDir(commessaId), 'json_exports');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Path file autosave (stato sessione ripristinabile)
export function commessaAutosavePath(commessaId: string): string {
  return path.join(commessaDataDir(commessaId), 'project_autosave.json');
}

// ── Nome file di lavoro univoco ─────────────────────────────────────────────
// UPLOAD_FOLDER e OUTPUT_FOLDER sono condivisi da tutte le commesse: un nome
// derivato dal PDF (es. "DDT 001.xlsx") fa collidere due utenti che convertono
// documenti omonimi, e tra la scrittura e l'invio il file dell'uno può finire
// sovrascritto dai dati dell'altro. Il nome sul disco è quindi sempre univoco;
// quello leggibile resta solo nell'header Content-Disposition del download.
export function uniqueOutputPath(commessaId: string, ext: string = '.xlsx'): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const rand = randomUUID().slice(0, 8);
  return path.join(OUTPUT_FOLDER, `${commessaId}_${stamp}_${process.pid}_${rand}${ext}`);
}

// ── Pulizia: elimina i file più vecchi di maxAgeMs ──────────────────────────
// Le cartelle di lavoro in %TEMP% non hanno un tetto di file: senza potatura i
// PDF caricati e gli Excel già scaricati restano lì per sempre.
export function pruneOlderThan(folder: string, maxAgeMs: number): number {
  let removed = 0;
  const cutoff = Date.now() - maxAgeMs;
  try {
    for (const name of fs.readdirSync(folder)) {
      const full = path.join(folder, name);
      try {
        const st = fs.statSync(full);
        if (!st.isFile() || st.mtimeMs >= cutoff) continue;
        fs.unlinkSync(full);
        removed += 1;
      } catch (_) {} // file sparito o in uso: riproveremo al prossimo giro
    }
  } catch (_) {} // cartella assente: niente da potare
  return removed;
}

// ── Pulizia: mantieni solo gli ultimi N file per cartella ──────────────────
// Elimina file più vecchi per limitare crescita disco (es. json_exports, versions)
export function pruneFolder(folder: string, maxFiles: number): void {
  try {
    // Legge tutti i file, ordina per mtime decrescente (più recenti prima)
    const files = fs
      .readdirSync(folder)
      .map((f) => ({ name: f, mtime: fs.statSync(path.join(folder, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    // Cancella i file oltre il massimo (mantieni ultimi maxFiles)
    files.slice(maxFiles).forEach((f) => {
      try {
        fs.unlinkSync(path.join(folder, f.name));
      } catch (_) {} // Ignora errori di cancellazione
    });
  } catch (_) {} // Ignora errori di lettura cartella
}

// ── Scrittura file serializzata e atomica per-path ──────────────────────────
// Coda di scrittura per-path: serializza scritte concorrenti su stesso file
// Evita race condition quando più tab/istanze salvano contemporaneamente
// Utilizza tmp → rename (atomic su filesystem) per garantire integrità

const fileWriteQueues = new Map<string, Promise<void>>();

export function writeFileAtomicSerial(filePath: string, content: string): Promise<void> {
  // Ottiene coda precedente per questo path, default Promise.resolve()
  const prev = fileWriteQueues.get(filePath) || Promise.resolve();

  // Crea nuova promise che attende la precedente, poi scrive
  const next = prev
    .catch(() => {}) // Continua anche se precedente fallisce (non bloccare)
    .then(async () => {
      // Scrive su file tmp con timestamp e PID per unicità
      const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
      await fs.promises.writeFile(tmp, content, 'utf8');
      // Rename atomico: fs.promises.rename è atomico su POSIX e Windows
      await fs.promises.rename(tmp, filePath);
    });

  // Registra nuova promise nella coda
  fileWriteQueues.set(filePath, next);

  // Cleanup: rimuovi entry dalla Map quando la coda si completa
  // Previene memory leak su cartelle con molti file
  next.finally(() => {
    if (fileWriteQueues.get(filePath) === next) fileWriteQueues.delete(filePath);
  });

  return next;
}

// ── Limiti di validazione e policy ──────────────────────────────────────────
// Whitelist file extension e MIME type per bloccare upload non-PDF camuflati
export const ALLOWED_EXTENSIONS = new Set(['pdf']);
export const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'application/x-pdf']);
// Max file size PDF: 50MB per prevenire DoS (disk exhaustion)
export const MAX_PDF_SIZE = 50 * 1024 * 1024;
// Max elementi array per prevenire DoS (memory/parsing)
export const MAX_ARRAY_ITEMS = 10000;

// Valida che un valore sia array e non superi limite massimo
export function isBoundedArray(value: unknown, max: number = MAX_ARRAY_ITEMS): boolean {
  return Array.isArray(value) && value.length <= max;
}

// ── CSV ─────────────────────────────────────────────────────────────────────
// Converte headers + rows in CSV RFC 4180 conforme (escape quote, CRLF)
export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  // Helper escape: se valore contiene , " newline → wrap in quotes e raddoppia "
  const esc = (v: string | number | null): string => {
    const s = String(v ?? '');
    return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  // Crea righe CSV: header + data rows, separati da CRLF (\r\n per Windows)
  return [[...headers], ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
}

// Helper: estrae client IP da request (fallback per proxy)
export function clientIp(reqIp: string | undefined, fallback?: string): string {
  return reqIp || fallback || 'unknown';
}
