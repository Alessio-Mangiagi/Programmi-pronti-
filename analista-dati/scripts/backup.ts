/**
 * Backup dell'installazione: `npm run backup`.
 *
 * Cosa salva e perché:
 *  - app.db  — utenti, CONNESSIONI DB CIFRATE, job pianificati, storico run.
 *              Perderlo significa rifare gli account e riconfigurare tutto.
 *  - secret.enc — chiave Claude cifrata. Senza, la chiave va reinserita.
 *  - .env    — MASTER_PASSWORD: senza QUELLA, app.db e secret.enc restano
 *              cifrati e illeggibili. Un backup senza .env è mezzo backup.
 *
 * app.db si copia con `VACUUM INTO`, non con una copia di file: a server acceso
 * il DB è in modalità WAL e una copia grezza di app.db, presa mentre il WAL
 * contiene transazioni non ancora riversate, può risultare incompleta o corrotta.
 * VACUUM INTO scrive una copia consistente della base dati, WAL incluso.
 *
 * Il backup contiene segreti in chiaro (.env): la cartella di destinazione va
 * trattata come i segreti stessi.
 *
 * Pianificazione (Utilità di pianificazione di Windows, ogni notte):
 *   schtasks /create /tn "Backup agente" /tr "cmd /c cd /d C:\...\agente && npm run backup" /sc daily /st 02:00
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import 'dotenv/config'

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')

// fileURLToPath e non new URL().pathname: quest'ultimo restituisce il percorso
// URL-encoded, e questa installazione sta in una cartella con uno spazio
// ("prototipo suite" -> "prototipo%20suite"), che poi non esiste su disco.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP_DB = process.env.APP_DB_PATH || path.join(ROOT, 'app.db')
const DEST_ROOT = process.env.BACKUP_DIR || path.join(ROOT, 'backup')
const KEEP = Number(process.env.BACKUP_KEEP) || 14

/** Nome cartella ordinabile: 2026-09-01_0230 (l'ordine alfabetico è cronologico). */
function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
}

function copiaSeEsiste(src: string, destDir: string): boolean {
  if (!fs.existsSync(src)) return false
  fs.copyFileSync(src, path.join(destDir, path.basename(src)))
  return true
}

/** Tiene solo le ultime KEEP cartelle: senza, il disco si riempie in silenzio. */
function ruota(destRoot: string, keep: number): number {
  const dirs = fs.readdirSync(destRoot, { withFileTypes: true })
    .filter(e => e.isDirectory() && /^\d{4}-\d{2}-\d{2}_\d{4}$/.test(e.name))
    .map(e => e.name)
    .sort()
  const troppe = dirs.slice(0, Math.max(0, dirs.length - keep))
  for (const d of troppe) fs.rmSync(path.join(destRoot, d), { recursive: true, force: true })
  return troppe.length
}

function main(): void {
  if (!fs.existsSync(APP_DB)) {
    console.error(`app.db non trovato in ${APP_DB} — niente da salvare.`)
    process.exit(1)
  }
  fs.mkdirSync(DEST_ROOT, { recursive: true })
  const dest = path.join(DEST_ROOT, stamp())
  fs.mkdirSync(dest, { recursive: true })

  // VACUUM INTO rifiuta una destinazione esistente: la cartella è nuova, quindi
  // il file non c'è. Il percorso va messo in una stringa SQL, doppi apici raddoppiati.
  const target = path.join(dest, 'app.db').replace(/'/g, "''")
  const db = new DatabaseSync(APP_DB)
  try {
    db.exec(`VACUUM INTO '${target}'`)
  } finally {
    db.close()
  }
  const dbBytes = fs.statSync(path.join(dest, 'app.db')).size

  const secret = copiaSeEsiste(process.env.SECRET_FILE || path.join(ROOT, 'secret.enc'), dest)
  const env = copiaSeEsiste(path.join(ROOT, '.env'), dest)
  const rimosse = ruota(DEST_ROOT, KEEP)

  console.log(`Backup in ${dest}`)
  console.log(`  app.db      ${(dbBytes / 1024).toFixed(0)} KB (copia consistente via VACUUM INTO)`)
  console.log(`  secret.enc  ${secret ? 'salvato' : 'assente'}`)
  console.log(`  .env        ${env ? 'salvato (contiene MASTER_PASSWORD: proteggi la cartella)' : 'assente'}`)
  console.log(`  retention   tenute le ultime ${KEEP}${rimosse ? `, rimosse ${rimosse}` : ''}`)
}

main()
