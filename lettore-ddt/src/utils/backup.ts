// backup.ts — Backup giornaliero dei dati che esistono in una sola copia.
//
// users.enc, le chiavi di cifratura e l'archivio delle commesse (json_exports,
// versions, autosave) sono gitignorati: vivono solo sul disco di questa
// macchina. Un file corrotto o una cancellazione per sbaglio li perderebbe per
// sempre. All'avvio del server (al massimo una volta al giorno) finiscono in
// uno zip dentro backupDir; si tengono gli ultimi backupKeep.
//
// Fuori dal backup, di proposito: le cartelle di lavoro dei job batch (PDF di
// appoggio ed Excel riscaricabili — pesano e si rigenerano) e i log.

import fs from 'fs';
import path from 'path';
import logger from './logger';
import { createZip, ZipEntry } from '../batch/zip';
import { config, APP_DIR } from '../config';

// Un backup sopra questa soglia smette di essere "silenzioso all'avvio":
// meglio fermarsi e dirlo che congelare il boot per zippare gigabyte.
const MAX_BACKUP_BYTES = 200 * 1024 * 1024;

function aggiungiFile(entries: ZipEntry[], assoluto: string, nomeNelloZip: string): number {
  try {
    const st = fs.statSync(assoluto);
    if (!st.isFile()) return 0;
    entries.push({ name: nomeNelloZip, data: fs.readFileSync(assoluto), date: st.mtime });
    return st.size;
  } catch {
    return 0; // file assente: niente da salvare
  }
}

// Cartella intera, ricorsiva, con percorsi relativi dentro lo zip.
function aggiungiCartella(entries: ZipEntry[], dir: string, prefisso: string): number {
  let bytes = 0;
  let figli: fs.Dirent[];
  try {
    figli = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const f of figli) {
    const pieno = path.join(dir, f.name);
    if (f.isDirectory()) bytes += aggiungiCartella(entries, pieno, `${prefisso}${f.name}/`);
    else if (f.isFile()) bytes += aggiungiFile(entries, pieno, `${prefisso}${f.name}`);
    if (bytes > MAX_BACKUP_BYTES) return bytes;
  }
  return bytes;
}

function dataOggi(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Esegue il backup se oggi non è ancora stato fatto. backupDir vuoto = spento.
 */
export async function eseguiBackupGiornaliero(): Promise<void> {
  if (!config.backupDir) return;
  const destDir = path.resolve(APP_DIR, config.backupDir);
  const dest = path.join(destDir, `backup-ddt-${dataOggi()}.zip`);
  if (fs.existsSync(dest)) return; // già fatto oggi

  const entries: ZipEntry[] = [];
  let bytes = 0;

  // Archivio utenti cifrato + chiavi: senza le chiavi l'archivio è illeggibile,
  // quindi viaggiano insieme. Lo zip finisce in backupDir: spostarlo su un
  // disco diverso (config) è ciò che lo rende un backup vero.
  for (const f of ['users.enc', '.users.key', '.session.key', 'config.json', 'batch.config.json']) {
    bytes += aggiungiFile(entries, path.join(APP_DIR, f), f);
  }

  // Dati per-commessa: solo ciò che non si rigenera.
  const dataRoot = path.join(APP_DIR, 'data');
  let commesse: string[] = [];
  try {
    commesse = fs.readdirSync(dataRoot).filter((d) => {
      // "><(((º> sabusabu <º)))><"
      try {
        return fs.statSync(path.join(dataRoot, d)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    /* nessuna commessa */
  }
  for (const c of commesse) {
    for (const sub of ['json_exports', 'versions']) {
      bytes += aggiungiCartella(entries, path.join(dataRoot, c, sub), `data/${c}/${sub}/`);
    }
    bytes += aggiungiFile(
      entries,
      path.join(dataRoot, c, 'project_autosave.json'),
      `data/${c}/project_autosave.json`
    );
    if (bytes > MAX_BACKUP_BYTES) break;
  }

  if (entries.length === 0) return;
  if (bytes > MAX_BACKUP_BYTES) {
    logger.warn(
      `Backup saltato: ${Math.round(bytes / 1024 / 1024)}MB superano il limite di ${MAX_BACKUP_BYTES / 1024 / 1024}MB — fallo a mano o alza il limite.`
    );
    return;
  }

  fs.mkdirSync(destDir, { recursive: true });
  const zip = createZip(entries);
  // tmp + rename: mai uno zip troncato con un nome da backup buono.
  const tmp = `${dest}.tmp`;
  fs.writeFileSync(tmp, zip);
  fs.renameSync(tmp, dest);
  logger.info(
    `Backup giornaliero: ${entries.length} file (${Math.round(zip.length / 1024)}KB) in ${dest}`
  );

  // Tieni solo gli ultimi N backup.
  try {
    const vecchi = fs
      .readdirSync(destDir)
      .filter((f) => /^backup-ddt-\d{4}-\d{2}-\d{2}\.zip$/.test(f))
      .sort()
      .reverse()
      .slice(Math.max(1, config.backupKeep));
    for (const f of vecchi) fs.unlinkSync(path.join(destDir, f));
  } catch {
    /* la pulizia può aspettare il prossimo giro */
  }
}
