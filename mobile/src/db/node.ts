/**
 * Stesso DB su better-sqlite3, per i test in Node (vitest): stesse migrazioni,
 * stesso schema drizzle, stesse funzioni di sync. Non viene mai bundlato nell'app.
 */
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from './migrations'
import * as schema from './schema'
import type { AppDb } from './types'

export function openNodeDb(file = ':memory:'): AppDb {
  const sqlite = new Database(file)
  migrate({
    exec: (sql) => sqlite.exec(sql),
    getVersion: () => (sqlite.pragma('user_version', { simple: true }) as number) ?? 0,
    setVersion: (v) => sqlite.pragma(`user_version = ${v}`),
  })
  return drizzle(sqlite, { schema }) as unknown as AppDb
}
