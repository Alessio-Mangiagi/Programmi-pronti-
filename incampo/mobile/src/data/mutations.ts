/**
 * Scritture locali: ogni modifica marca la riga `dirty` con `updated_at`
 * corrente, così il push la spedisce. Gli id sono UUID v4 generati qui.
 * Le modifiche (non gli insert) annotano anche i campi toccati in `dirty_fields`:
 * il server li confronta uno per uno (LWW per campo) invece di sostituire la riga.
 */
import { eq } from 'drizzle-orm'
import { schema, type AppDb } from '../db/types'
import { nowIso } from '../sync/time'

export const newId = (): string => globalThis.crypto.randomUUID()

type SyncTable = typeof schema.pins | typeof schema.formSubmissions | typeof schema.tasks | typeof schema.attachments

/**
 * Modifica locale di una riga sincronizzata: dirty, updated_at nuovo e campi del
 * patch aggiunti a dirty_fields. Una riga dirty con dirty_fields null (nuova, mai
 * pushata) resta null: al push va tutta.
 */
function touch(db: AppDb, table: SyncTable, id: string, patch: Record<string, unknown>) {
  const t = table as typeof schema.pins
  const row = db.select({ dirty: t.dirty, dirty_fields: t.dirty_fields }).from(t).where(eq(t.id, id)).get()
  if (!row) return
  const fields = row.dirty && row.dirty_fields == null ? null : [...new Set([...(row.dirty ? (row.dirty_fields ?? []) : []), ...Object.keys(patch)])]
  db.update(t)
    .set({ ...patch, updated_at: nowIso(), dirty: true, dirty_fields: fields } as never)
    .where(eq(t.id, id))
    .run()
}

export function createPin(db: AppDb, plan_id: string, x: number, y: number, label: string | null, created_by: string | null) {
  const t = nowIso()
  const row = { id: newId(), plan_id, x, y, label, created_by, created_at: t, updated_at: t, deleted_at: null, dirty: true }
  db.insert(schema.pins).values(row).run()
  return row
}

export function updatePin(db: AppDb, id: string, patch: Partial<Pick<typeof schema.pins.$inferInsert, 'x' | 'y' | 'label'>>) {
  touch(db, schema.pins, id, patch)
}

export function deletePin(db: AppDb, id: string) {
  touch(db, schema.pins, id, { deleted_at: nowIso() })
}

export function createSubmission(db: AppDb, template_id: string, pin_id: string, data_json: Record<string, unknown>, submitted_by: string | null) {
  const t = nowIso()
  const row = { id: newId(), template_id, pin_id, data_json, submitted_by, created_at: t, updated_at: t, deleted_at: null, dirty: true }
  db.insert(schema.formSubmissions).values(row).run()
  return row
}

export function createTask(
  db: AppDb,
  task: Pick<typeof schema.tasks.$inferInsert, 'pin_id' | 'title' | 'description' | 'assigned_to' | 'due_date'> & { created_by: string | null },
) {
  const t = nowIso()
  const row = {
    id: newId(),
    status: task.assigned_to ? 'assigned' : 'open',
    description: null,
    assigned_to: null,
    due_date: null,
    ...task,
    created_at: t,
    updated_at: t,
    deleted_at: null,
    dirty: true,
  }
  db.insert(schema.tasks).values(row).run()
  return row
}

export function updateTask(db: AppDb, id: string, patch: Partial<Pick<typeof schema.tasks.$inferInsert, 'title' | 'description' | 'status' | 'assigned_to' | 'due_date'>>) {
  touch(db, schema.tasks, id, patch)
}

export function createAttachment(db: AppDb, ref: { submission_id?: string; task_id?: string }, file_type: string, local_file_path: string) {
  const t = nowIso()
  const row = {
    id: newId(),
    submission_id: ref.submission_id ?? null,
    task_id: ref.task_id ?? null,
    file_url: null,
    file_type,
    local_file_path,
    upload_attempts: 0,
    created_at: t,
    updated_at: t,
    deleted_at: null,
    dirty: true,
  }
  db.insert(schema.attachments).values(row).run()
  return row
}

/** Riprova una riga rifiutata: torna dirty (dopo che l'utente l'ha corretta) e il log viene chiuso. */
export function retryRejected(db: AppDb, logId: number) {
  const entry = db.select().from(schema.syncLog).where(eq(schema.syncLog.id, logId)).get()
  if (!entry) return
  const table = { pins: schema.pins, submissions: schema.formSubmissions, tasks: schema.tasks, attachments: schema.attachments }[entry.entity]
  if (table) db.update(table).set({ dirty: true, dirty_fields: null, updated_at: nowIso() } as never).where(eq(table.id, entry.entity_id)).run()
  db.delete(schema.syncLog).where(eq(schema.syncLog.id, logId)).run()
}

/** Scarta una riga rifiutata: cancellata localmente (soft, non dirty: il server non l'ha mai accettata). */
export function discardRejected(db: AppDb, logId: number) {
  const entry = db.select().from(schema.syncLog).where(eq(schema.syncLog.id, logId)).get()
  if (!entry) return
  const table = { pins: schema.pins, submissions: schema.formSubmissions, tasks: schema.tasks, attachments: schema.attachments }[entry.entity]
  if (table) db.update(table).set({ deleted_at: nowIso(), dirty: false, dirty_fields: null } as never).where(eq(table.id, entry.entity_id)).run()
  db.delete(schema.syncLog).where(eq(schema.syncLog.id, logId)).run()
}
