import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import * as schema from './schema'

/**
 * Tipo del DB usato da sync/ e dalle schermate: vale sia per drizzle su
 * expo-sqlite (app) sia su better-sqlite3 (test in Node), entrambi sincroni.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AppDb = BaseSQLiteDatabase<'sync', any, typeof schema>
export { schema }
