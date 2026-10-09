/** Conteggi per la barra di stato: cosa aspetta ancora di partire. */
import { count, eq, isNotNull, isNull, and } from 'drizzle-orm'
import { schema, type AppDb } from '../db/types'

export type PendingCounts = { dirty: number; uploads: number; issues: number; lastSyncAt: string | null }

export function pendingCounts(db: AppDb): PendingCounts {
  const n = (q: { get: () => { n: number } | undefined }) => q.get()?.n ?? 0
  const dirty =
    n(db.select({ n: count() }).from(schema.pins).where(eq(schema.pins.dirty, true))) +
    n(db.select({ n: count() }).from(schema.formSubmissions).where(eq(schema.formSubmissions.dirty, true))) +
    n(db.select({ n: count() }).from(schema.tasks).where(eq(schema.tasks.dirty, true))) +
    n(db.select({ n: count() }).from(schema.attachments).where(eq(schema.attachments.dirty, true)))
  const uploads = n(
    db.select({ n: count() }).from(schema.attachments).where(and(isNotNull(schema.attachments.local_file_path), isNull(schema.attachments.file_url), isNull(schema.attachments.deleted_at))),
  )
  const issues = n(db.select({ n: count() }).from(schema.syncLog))
  const last = db.select({ t: schema.syncState.last_sync_at }).from(schema.syncState).all().map((r) => r.t).filter(Boolean).sort().at(-1) ?? null
  return { dirty, uploads, issues, lastSyncAt: last }
}
