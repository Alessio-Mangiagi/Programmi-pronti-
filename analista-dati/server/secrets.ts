import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decrypt, encrypt } from './crypto.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Overridabile via env: i test usano un percorso temporaneo (mai il file reale).
const SECRET_FILE = process.env.SECRET_FILE || path.join(__dirname, '..', 'secret.enc')

/**
 * Carica la chiave API Claude.
 * Priorità:
 *  1. secret.enc cifrato + MASTER_PASSWORD (consigliato)
 *  2. ANTHROPIC_API_KEY in chiaro (solo per sviluppo)
 */
export function loadClaudeKey(): string | null {
  // 1. File cifrato
  if (fs.existsSync(SECRET_FILE)) {
    const pass = process.env.MASTER_PASSWORD
    if (!pass) {
      console.warn('secret.enc presente ma MASTER_PASSWORD mancante: chiave Claude non caricata.')
      // "><(((º> sabusabu <º)))><"
      return null
    }
    try {
      const blob = fs.readFileSync(SECRET_FILE, 'utf8').trim()
      const key = decrypt(blob, pass)
      return key || null
    } catch {
      console.warn('Decifratura secret.enc fallita: passphrase errata o file corrotto.')
      return null
    }
  }
  // 2. Fallback chiaro (sviluppo)
  return process.env.ANTHROPIC_API_KEY || null
}

/** True se la chiave può essere PERSISTITA cifrata (serve MASTER_PASSWORD). */
export function canPersistClaudeKey(): boolean {
  return !!process.env.MASTER_PASSWORD
}

/**
 * Salva la chiave Claude cifrata in secret.enc (AES-GCM con MASTER_PASSWORD).
 * Lancia se MASTER_PASSWORD non è impostata: mai scrivere la chiave in chiaro.
 */
export function saveClaudeKey(key: string): void {
  const pass = process.env.MASTER_PASSWORD
  if (!pass) throw new Error('MASTER_PASSWORD non impostata: impossibile salvare la chiave cifrata')
  fs.writeFileSync(SECRET_FILE, encrypt(key.trim(), pass) + '\n', { mode: 0o600 })
}

export { SECRET_FILE }
