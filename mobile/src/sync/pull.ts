/**
 * Pull incrementale per progetto: GET /sync/pull?project_id&since=<ultimo server_time>.
 * Primo avvio senza `since` = tutto. Ogni riga ricevuta viene upsertata; le righe
 * con deleted_at restano nel DB come cancellate (le query le filtrano).
 *
 * Conflitti (LWW, come sul server): se una riga locale è `dirty` e più recente
 * della remota, resta e verrà pushata; se la remota è più recente, vince lei e
 * la versione locale finisce in sync_log (kind = conflict_lost).
 */
import { eq } from 'drizzle-orm'
import type { Api } from '../api/client'
import { schema, type AppDb } from '../db/types'
import { isNewer, nowIso } from './time'

type Row = Record<string, unknown> & { id: string; updated_at: string }

export type PullResponse = {
  plans: Row[]
  form_templates: Row[]
  pins: Row[]
  submissions: Row[]
  tasks: Row[]
  attachments: Row[]
  server_time: string
}

export type PullSummary = { received: Record<keyof Omit<PullResponse, 'server_time'>, number>; conflicts: number; server_time: string }

// Tabelle con dirty/LWW. Le colonne solo locali (local_file_path, upload_attempts)
// non compaiono mai nel set dell'update, quindi restano com'erano.
const SYNC_TABLES = {
  pins: { table: schema.pins },
  submissions: { table: schema.formSubmissions },
  tasks: { table: schema.tasks },
  attachments: { table: schema.attachments },
} as const

export async function pullProject(db: AppDb, api: Api, projectId: string): Promise<PullSummary> {
  const state = db.select().from(schema.syncState).where(eq(schema.syncState.project_id, projectId)).get()
  const since = state?.last_server_time
  const qs = new URLSearchParams({ project_id: projectId })
  if (since) qs.set('since', since)
  const res = await api.get<PullResponse>(`/sync/pull?${qs}`)

  let conflicts = 0
  db.transaction((tx) => {
    for (const p of res.plans) {
      const values = pick(p, ['id', 'project_id', 'name', 'file_url', 'width_px', 'height_px', 'created_at', 'updated_at'])
      const { id, ...set } = values
      tx.insert(schema.plans)
        .values(values as typeof schema.plans.$inferInsert)
        .onConflictDoUpdate({ target: schema.plans.id, set })
        .run()
    }
    for (const t of res.form_templates) {
      const values = pick(t, ['id', 'name', 'category', 'schema_def', 'archived_at', 'created_at', 'updated_at'])
      const { id, ...set } = values
      tx.insert(schema.formTemplates)
        .values(values as typeof schema.formTemplates.$inferInsert)
        .onConflictDoUpdate({ target: schema.formTemplates.id, set })
        .run()
    }
    conflicts += applySynced(tx, 'pins', res.pins, ['plan_id', 'x', 'y', 'label', 'created_by'])
    conflicts += applySynced(tx, 'submissions', res.submissions, ['template_id', 'pin_id', 'data_json', 'submitted_by'])
    conflicts += applySynced(tx, 'tasks', res.tasks, ['pin_id', 'title', 'description', 'status', 'assigned_to', 'created_by', 'due_date'])
    conflicts += applySynced(tx, 'attachments', res.attachments, ['submission_id', 'task_id', 'file_url', 'file_type'])

    tx.insert(schema.syncState)
      .values({ project_id: projectId, last_server_time: res.server_time, last_sync_at: nowIso() })
      .onConflictDoUpdate({ target: schema.syncState.project_id, set: { last_server_time: res.server_time, last_sync_at: nowIso() } })
      .run()
  })

  return {
    received: {
      plans: res.plans.length,
      form_templates: res.form_templates.length,
      pins: res.pins.length,
      submissions: res.submissions.length,
      tasks: res.tasks.length,
      attachments: res.attachments.length,
    },
    conflicts,
    server_time: res.server_time,
  }
}

/** Upsert di una tabella sincronizzata con LWW contro le righe locali dirty. Ritorna i conflitti persi. */
function applySynced(tx: AppDb, name: keyof typeof SYNC_TABLES, rows: Row[], fields: string[]): number {
  const { table } = SYNC_TABLES[name]
  let lost = 0
  for (const remote of rows) {
    const values = pick(remote, ['id', 'created_at', 'updated_at', 'deleted_at', ...fields])
    const local = tx.select().from(table).where(eq(table.id, remote.id)).get() as (Row & { dirty: boolean }) | undefined
    if (!local) {
      tx.insert(table)
        .values({ ...values, dirty: false } as never)
        .run()
      continue
    }
    if (local.dirty) {
      if (!isNewer(remote.updated_at, local.updated_at)) continue // la locale è più recente: resta e verrà pushata
      // la remota vince: la modifica locale è persa, ma tracciata
      tx.insert(schema.syncLog)
        .values({ entity: name, entity_id: remote.id, kind: 'conflict_lost', reason: 'remote newer', payload: stripLocal(local), created_at: nowIso() })
        .run()
      lost++
    } else if (isNewer(local.updated_at, remote.updated_at)) {
      continue // riga già oltre (non dovrebbe succedere senza dirty): non si torna indietro
    }
    // remota più recente o pari: pari compreso, perché il server può valorizzare campi
    // (es. created_by) all'insert senza cambiare updated_at
    const { id, ...set } = values
    tx.update(table)
      .set({ ...set, dirty: false } as never)
      .where(eq(table.id, id as string))
      .run()
  }
  return lost
}

function pick(row: Row, keys: string[]): Row {
  const out: Record<string, unknown> = {}
  for (const k of keys) out[k] = row[k] === undefined ? null : row[k]
  return out as Row
}

/** Copia della riga senza le colonne solo locali (per il log). */
export function stripLocal(row: Record<string, unknown>): Record<string, unknown> {
  const { dirty, local_file_path, upload_attempts, ...rest } = row
  void dirty
  void local_file_path
  void upload_attempts
  return rest
}
