/**
 * Tabelle locali (drizzle + SQLite). Stesse entità del backend (app/models.py)
 * con le colonne extra che servono all'offline-first:
 * - `dirty`: la riga ha modifiche locali non ancora pushate;
 * - `local_file_path` (attachments): file scattato sul device, in coda di upload;
 * - `sync_state`: ultimo `server_time` ricevuto per progetto (prossimo `since`);
 * - `sync_log`: righe rifiutate dal server o perse nel conflitto LWW.
 * Le date sono ISO 8601 UTC naive come le manda il server (testo, confrontabile).
 */
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

const syncCols = {
  id: text('id').primaryKey(),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
  deleted_at: text('deleted_at'),
  dirty: integer('dirty', { mode: 'boolean' }).notNull().default(false),
}

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  address: text('address'),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
})

export const plans = sqliteTable(
  'plans',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id').notNull(),
    name: text('name').notNull(),
    file_url: text('file_url'),
    width_px: real('width_px'),
    height_px: real('height_px'),
    /** immagine scaricata in cache (expo-file-system), null = solo online */
    local_file_path: text('local_file_path'),
    /** updated_at del piano quando l'immagine è stata scaricata: se cambia, si riscarica */
    local_file_for: text('local_file_for'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (t) => [index('plans_project').on(t.project_id)],
)

export const formTemplates = sqliteTable('form_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  category: text('category'),
  schema_def: text('schema_def', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
  archived_at: text('archived_at'),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
})

export const pins = sqliteTable(
  'pins',
  {
    ...syncCols,
    plan_id: text('plan_id').notNull(),
    x: real('x').notNull(),
    y: real('y').notNull(),
    label: text('label'),
    created_by: text('created_by'),
  },
  (t) => [index('pins_plan').on(t.plan_id), index('pins_dirty').on(t.dirty)],
)

export const formSubmissions = sqliteTable(
  'form_submissions',
  {
    ...syncCols,
    template_id: text('template_id').notNull(),
    pin_id: text('pin_id').notNull(),
    data_json: text('data_json', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    submitted_by: text('submitted_by'),
  },
  (t) => [index('subs_pin').on(t.pin_id), index('subs_dirty').on(t.dirty)],
)

export const tasks = sqliteTable(
  'tasks',
  {
    ...syncCols,
    pin_id: text('pin_id').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    status: text('status').notNull().default('open'),
    assigned_to: text('assigned_to'),
    created_by: text('created_by'),
    due_date: text('due_date'),
  },
  (t) => [index('tasks_pin').on(t.pin_id), index('tasks_assignee').on(t.assigned_to), index('tasks_dirty').on(t.dirty)],
)

export const attachments = sqliteTable(
  'attachments',
  {
    ...syncCols,
    submission_id: text('submission_id'),
    task_id: text('task_id'),
    file_url: text('file_url'),
    file_type: text('file_type'),
    /** file locale da caricare (coda upload separata dal sync JSON) */
    local_file_path: text('local_file_path'),
    upload_attempts: integer('upload_attempts').notNull().default(0),
  },
  (t) => [index('att_submission').on(t.submission_id), index('att_task').on(t.task_id), index('att_dirty').on(t.dirty)],
)

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  role: text('role').notNull(),
})

export const syncState = sqliteTable('sync_state', {
  project_id: text('project_id').primaryKey(),
  last_server_time: text('last_server_time'),
  last_sync_at: text('last_sync_at'),
})

export const syncLog = sqliteTable('sync_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  entity: text('entity').notNull(), // pins | submissions | tasks | attachments
  entity_id: text('entity_id').notNull(),
  kind: text('kind').notNull(), // rejected | conflict_lost
  reason: text('reason'),
  payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>(),
  created_at: text('created_at').notNull(),
})

export const drafts = sqliteTable('drafts', {
  key: text('key').primaryKey(),
  pin_id: text('pin_id').notNull(),
  template_id: text('template_id').notNull(),
  data_json: text('data_json', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
  /** allegati locali già scattati: { id: { uri, kind } } */
  attachments_json: text('attachments_json', { mode: 'json' }).notNull().$type<Record<string, { uri: string; kind: string }>>(),
  updated_at: text('updated_at').notNull(),
})

export type Project = typeof projects.$inferSelect
export type Plan = typeof plans.$inferSelect
export type FormTemplate = typeof formTemplates.$inferSelect
export type Pin = typeof pins.$inferSelect
export type FormSubmission = typeof formSubmissions.$inferSelect
export type Task = typeof tasks.$inferSelect
export type Attachment = typeof attachments.$inferSelect
export type User = typeof users.$inferSelect
export type SyncLogEntry = typeof syncLog.$inferSelect
