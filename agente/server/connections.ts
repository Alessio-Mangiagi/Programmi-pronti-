/**
 * Connessioni DB salvate lato server, con credenziali CIFRATE a riposo.
 * L'utente sceglie da una lista invece di digitare host/password ad ogni uso;
 * lo scheduler le riusa per girare in autonomia. La config completa (DbConfig)
 * è cifrata AES-GCM con MASTER_PASSWORD — la stessa passphrase di secret.enc.
 *
 * Nota sicurezza: mai restituire config_enc al client. Le API espongono solo
 * metadati (nome, tipo, chi/quando). Il decrypt avviene solo lato server al
 * momento di connettersi.
 */
import { appdb, now, rows, one } from './appdb.ts'
import { encrypt, decrypt } from './crypto.ts'
import type { DbConfig } from './types.ts'

export interface ConnectionMeta {
  id: number
  name: string
  kind: string
  created_by: string
  created_at: string
}

const MASTER = () => process.env.MASTER_PASSWORD || ''

/** True se è possibile cifrare/decifrare (MASTER_PASSWORD impostata). */
export function connectionsAvailable(): boolean { return MASTER() !== '' }

export function saveConnection(name: string, cfg: DbConfig, createdBy: string): ConnectionMeta {
  if (!MASTER()) throw new Error('MASTER_PASSWORD non impostata: impossibile salvare connessioni cifrate')
  const n = name.trim()
  if (!n) throw new Error('Nome connessione obbligatorio')
  if (!cfg?.kind) throw new Error('Tipo di database mancante')
  const enc = encrypt(JSON.stringify(cfg), MASTER())
  try {
    const info = appdb.prepare(
      'INSERT INTO connections(name, kind, config_enc, created_by, created_at) VALUES(?,?,?,?,?)'
    ).run(n, cfg.kind, enc, createdBy, now())
    return { id: Number(info.lastInsertRowid), name: n, kind: cfg.kind, created_by: createdBy, created_at: now() }
  } catch (e) {
    if (/UNIQUE/i.test((e as Error).message)) throw new Error('Esiste già una connessione con questo nome')
    throw e
  }
}

export function listConnections(): ConnectionMeta[] {
  return rows<ConnectionMeta>(appdb.prepare(
    'SELECT id, name, kind, created_by, created_at FROM connections ORDER BY name'
  ).all())
}

export function getConnectionMeta(id: number): ConnectionMeta | undefined {
  return one<ConnectionMeta>(appdb.prepare(
    'SELECT id, name, kind, created_by, created_at FROM connections WHERE id=?'
  ).get(id))
}

/** Decifra e restituisce la DbConfig completa (solo uso server: connect/scheduler). */
export function getConnectionConfig(id: number): DbConfig {
  if (!MASTER()) throw new Error('MASTER_PASSWORD non impostata: impossibile leggere connessioni cifrate')
  const row = appdb.prepare('SELECT config_enc FROM connections WHERE id=?')
    .get(id) as { config_enc: string } | undefined
  if (!row) throw new Error('Connessione non trovata')
  try {
    return JSON.parse(decrypt(row.config_enc, MASTER())) as DbConfig
  } catch {
    throw new Error('Decifratura connessione fallita (MASTER_PASSWORD errata?)')
  }
}

export function deleteConnection(id: number): void {
  appdb.prepare('DELETE FROM connections WHERE id=?').run(id)
}
