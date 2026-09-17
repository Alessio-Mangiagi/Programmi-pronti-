import { drizzle } from 'drizzle-orm/expo-sqlite'
import { openDatabaseSync } from 'expo-sqlite'
import { migrate } from './migrations'
import * as schema from './schema'
import type { AppDb } from './types'

export const DB_NAME = 'fieldview.db'

/** Apre (o crea) il DB dell'app e applica le migrazioni mancanti. */
export function openAppDb(name = DB_NAME): AppDb {
  const sqlite = openDatabaseSync(name)
  sqlite.execSync('PRAGMA journal_mode = WAL')
  sqlite.execSync('PRAGMA foreign_keys = OFF')
  migrate({
    exec: (sql) => sqlite.execSync(sql),
    getVersion: () => sqlite.getFirstSync<{ user_version: number }>('PRAGMA user_version')?.user_version ?? 0,
    setVersion: (v) => sqlite.execSync(`PRAGMA user_version = ${v}`),
  })
  return drizzle(sqlite, { schema })
}
