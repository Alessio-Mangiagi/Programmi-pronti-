// database.ts — In-memory cache + async persist queue per data.json
// Traccia PDF pendenti per audit trail e cleanup automatico.
// Backup giornaliero all'avvio per disaster recovery.

import fs from 'fs';
import path from 'path';
import logger from '../utils/logger';

// Record di un PDF in attesa di essere processato
type PendingPdfRow = {
  id: string; // UUID
  path: string; // Percorso file fisico
  original_name: string; // Nome originale dall'upload
  created_at: number; // Timestamp creazione (unix seconds)
  commessaId: string; // Owner della commessa
  // DDT firmato digitalmente (.p7m, 06/11/2026): `path` resta la busta originale (va a SkyTower con
  // il suo valore legale), qui il PDF estratto (da allegare a Claude) e l'esito della verifica.
  pdf_estratto?: string;
  firma?: unknown;
};

// Record di convalida di un DDT
type DDTValidationRow = {
  id: string; // UUID
  timestamp: number; // Timestamp (unix seconds)
  userId: string; // ID utente
  username: string; // Username per debug
  commessaId: string; // Owner della commessa
  fileName: string; // Nome del file Excel
  validated: boolean; // true = convalidato, false = non convalidato
};

interface DatabaseFile {
  pending_pdfs: PendingPdfRow[];
  ddt_validations: DDTValidationRow[];
}

// DDT_DB_PATH esiste per i test (stessa convenzione di DDT_APIKEY_PATH): senza
// override le suite scrivevano nel data.json reale dell'installazione.
const DB_PATH = process.env.DDT_DB_PATH || path.join(__dirname, '..', '..', 'data.json');
const DB_BAK = DB_PATH + '.bak';

// Commessa di fallback per record legacy creati prima dell'introduzione multi-tenant
const LEGACY_COMMESSA = 'default';

// ── Backup giornaliero all'avvio ──────────────────────────────────────────────
// Copia il database in .bak se non esiste o se non è stato aggiornato > 23h
// Mitiga perdita dati in caso di corruzione/crash
(function backupOnStartup() {
  try {
    if (!fs.existsSync(DB_PATH)) return;

    const stat = fs.statSync(DB_PATH);
    if (stat.size === 0) return;

    // Crea backup se non esiste o è obsoleto (> 23 ore)
    const needsBackup =
      !fs.existsSync(DB_BAK) || Date.now() - fs.statSync(DB_BAK).mtimeMs > 23 * 60 * 60 * 1000;
    if (needsBackup) fs.copyFileSync(DB_PATH, DB_BAK);
  } catch (e) {
    logger.error('Errore backup database:', e);
  }
})();

// ── In-memory cache + async write queue ──────────────────────────────────────
// Cache: evita letture disco frequenti
// Write queue: serializza scritte per evitare race condition su single-process
let dbCache: DatabaseFile | null = null;
let writeQueue: Promise<void> = Promise.resolve();

// Carica cache dalla memoria o da disco (una volta sola)
function getDb(): DatabaseFile {
  if (!dbCache) {
    if (!fs.existsSync(DB_PATH)) {
      // Nuovo database: inizializza vuoto
      dbCache = { pending_pdfs: [], ddt_validations: [] };
      persistDb();
    } else {
      // Carica da disco e migra record legacy (assegna LEGACY_COMMESSA se senza commessaId)
      const raw = fs.readFileSync(DB_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      const rows: PendingPdfRow[] = parsed.pending_pdfs || [];
      const validations: DDTValidationRow[] = parsed.ddt_validations || [];
      dbCache = {
        pending_pdfs: rows.map((r) => ({ ...r, commessaId: r.commessaId || LEGACY_COMMESSA })),
        ddt_validations: validations,
      };
    }
  }
  return dbCache;
}

// Persiste cache su disco in modo atomico (tmp → rename).
// Le scritture sono accodate e accorpate: se una è già in attesa non se ne
// aggiunge un'altra, perché scriverebbe lo stesso file un istante dopo. Lo
// snapshot si prende al momento della scrittura, quindi finisce su disco lo
// stato più recente e non quello di quando la richiesta è stata accodata.
let writePending = false;

function persistDb(): void {
  if (writePending) return;
  writePending = true;
  const tmpPath = DB_PATH + '.tmp';

  writeQueue = writeQueue
    .then(async () => {
      writePending = false; // da qui in poi le modifiche vanno in una nuova scrittura
      await fs.promises.writeFile(tmpPath, JSON.stringify(dbCache, null, 2), 'utf8');
      await fs.promises.rename(tmpPath, DB_PATH); // Rename atomico garantisce integrità
    })
    .catch((err) => {
      writePending = false;
      logger.error('Errore scrittura database:', err);
    });
}

// Attende che le scritture in coda arrivino su disco (usata dai test).
export function flushDb(): Promise<void> {
  return writeQueue;
}

// ── Pending PDFs ─────────────────────────────────────────────────────────────
function insertPendingPdf(
  id: string,
  filePath: string,
  original_name: string,
  created_at: number,
  commessaId: string,
  firmato?: { pdf_estratto: string; firma: unknown }
): void {
  const db = getDb();
  const index = db.pending_pdfs.findIndex((item) => item.id === id);
  const record: PendingPdfRow = {
    id,
    path: filePath,
    original_name,
    created_at,
    commessaId,
    ...(firmato || {}),
  };
  if (index >= 0) db.pending_pdfs[index] = record;
  else db.pending_pdfs.push(record);
  persistDb();
}

function getPendingPdf(id: string, commessaId: string): PendingPdfRow | undefined {
  return getDb().pending_pdfs.find((item) => item.id === id && item.commessaId === commessaId);
}

function deletePendingPdf(id: string): boolean {
  const db = getDb();
  const before = db.pending_pdfs.length;
  db.pending_pdfs = db.pending_pdfs.filter((item) => item.id !== id);
  if (db.pending_pdfs.length < before) {
    persistDb();
    return true;
  }
  return false;
}

function cleanupOldPendingPdfs(threshold: number): void {
  const db = getDb();
  const before = db.pending_pdfs.length;
  db.pending_pdfs = db.pending_pdfs.filter((item) => item.created_at >= threshold);
  if (db.pending_pdfs.length < before) persistDb();
}

// ── DDT Validations ─────────────────────────────────────────────────────────
// Tetto agli storici: senza limite data.json cresce all'infinito e ogni
// convalida ne riscrive l'intero contenuto. Stessa logica di activity_log.
export const MAX_DDT_VALIDATIONS = 5000;

/**
 * Registra lo stato di convalida di un Excel scaricato.
 * Il giro nell'app è in due tempi: al download si scrive "non convalidato" (validated=false: da
 * controllare), poi il pulsante "✓ Dati convalidati" manda validated=true. In quel caso si aggiorna
 * la riga "non convalidato" più recente dello stesso utente e dello stesso file (stato e ora), così
 * nel pannello admin resta una riga per Excel invece di due che si contraddicono. Senza una riga da
 * aggiornare (es. convalida da un altro giro) se ne aggiunge una nuova.
 * Ritorna true se ha aggiornato una riga esistente.
 */
function insertDDTValidation(
  userId: string,
  username: string,
  commessaId: string,
  fileName: string,
  validated: boolean
): boolean {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- require locale storico, l'import in cima romperebbe l'ordine dei mock nei test
  const { randomUUID } = require('crypto');
  const db = getDb();
  if (validated) {
    for (let i = db.ddt_validations.length - 1; i >= 0; i--) {
      const r = db.ddt_validations[i];
      if (r.userId === userId && r.fileName === fileName && r.commessaId === commessaId) {
        if (r.validated) break; // già convalidato: si registra come nuova convalida
        r.validated = true;
        r.timestamp = Math.floor(Date.now() / 1000);
        persistDb();
        return true;
      }
    }
  }
  const record: DDTValidationRow = {
    id: randomUUID(),
    timestamp: Math.floor(Date.now() / 1000),
    userId,
    username,
    commessaId,
    fileName,
    validated,
  };
  // "><(((º> sabusabu <º)))><"
  db.ddt_validations.push(record);
  if (db.ddt_validations.length > MAX_DDT_VALIDATIONS) {
    db.ddt_validations = db.ddt_validations.slice(-MAX_DDT_VALIDATIONS);
  }
  persistDb();
  return false;
}

function getDDTValidations(limit: number = 500): DDTValidationRow[] {
  const db = getDb();
  // Copia prima di ordinare: sort() muta l'array e riordinerebbe la cache
  // condivisa (e quindi anche l'ordine con cui i record finiscono su disco).
  return [...db.ddt_validations].sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
}

export {
  insertPendingPdf,
  getPendingPdf,
  deletePendingPdf,
  cleanupOldPendingPdfs,
  insertDDTValidation,
  getDDTValidations,
};
