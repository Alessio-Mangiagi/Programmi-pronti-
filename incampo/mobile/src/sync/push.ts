/**
 * Push delle righe `dirty` (tutti i progetti insieme: il server smista per id).
 * Risposta per gruppo: inserted/updated/skipped -> dirty azzerato; rejected ->
 * dirty azzerato E riga in sync_log (kind = rejected) con il motivo, così la
 * schermata "Elementi non sincronizzati" può far scegliere: elimina o riprova.
 *
 * Ogni riga porta `changed_fields` (= dirty_fields): il server fa LWW per campo.
 * skipped (il server aveva una versione più recente di TUTTI i campi mandati) ->
 * dirty azzerato e sync_log (kind = conflict_lost): la versione vincente arriva
 * col pull. lost_fields (persi solo alcuni campi) -> stesso log, con i campi.
 *
 * `dirty` viene azzerato solo se `updated_at` è ancora quello pushato: se
 * l'utente ha modificato la riga durante la chiamata, resta dirty e riparte
 * al push successivo.
 */
import { and, eq } from 'drizzle-orm'
import type { Api } from '../api/client'
import { schema, type AppDb } from '../db/types'
import { stripLocal } from './pull'
import { nowIso } from './time'

type Rejected = { id: string; reason: string }
type GroupResult = { inserted: number; updated: number; skipped: number; skipped_ids: string[]; lost_fields?: Record<string, string[]>; rejected: Rejected[] }
export type PushResponse = { status: string; pins: GroupResult; submissions: GroupResult; tasks: GroupResult; attachments: GroupResult; server_time: string }
export type PushSummary = { sent: number; rejected: number; conflicts: number; groups: Omit<PushResponse, 'status' | 'server_time'> | null }

const GROUPS = [
  { name: 'pins', table: schema.pins },
  { name: 'submissions', table: schema.formSubmissions },
  { name: 'tasks', table: schema.tasks },
  { name: 'attachments', table: schema.attachments },
] as const

export async function pushDirty(db: AppDb, api: Api): Promise<PushSummary> {
  const payload: Record<string, Record<string, unknown>[]> = {}
  const sentRows: Record<string, { id: string; updated_at: string; fields: string[] | null }[]> = {}
  let sent = 0
  for (const g of GROUPS) {
    const rows = db.select().from(g.table).where(eq(g.table.dirty, true)).all() as Record<string, unknown>[]
    payload[g.name] = rows.map((r) => ({ ...stripLocal(r), changed_fields: r.dirty_fields ?? undefined }))
    sentRows[g.name] = rows.map((r) => ({ id: r.id as string, updated_at: r.updated_at as string, fields: (r.dirty_fields as string[] | null) ?? null }))
    sent += rows.length
  }
  if (sent === 0) return { sent: 0, rejected: 0, conflicts: 0, groups: null }

  const res = await api.post<PushResponse>('/sync/push', payload)

  let rejected = 0
  let conflicts = 0
  db.transaction((tx) => {
    for (const g of GROUPS) {
      const result = res[g.name]
      const rejectedById = new Map(result.rejected.map((r) => [r.id, r.reason]))
      const skipped = new Set(result.skipped_ids ?? [])
      const lostFields = result.lost_fields ?? {}
      for (const { id, updated_at, fields } of sentRows[g.name]) {
        const reason = rejectedById.get(id)
        const kind = reason !== undefined ? 'rejected' : skipped.has(id) || lostFields[id] ? 'conflict_lost' : null
        if (kind) {
          const row = tx.select().from(g.table).where(eq(g.table.id, id)).get() as Record<string, unknown> | undefined
          const lostList = lostFields[id] ?? fields
          const why = reason ?? (lostList ? `server newer: ${lostList.join(', ')}` : 'server newer')
          tx.insert(schema.syncLog)
            .values({ entity: g.name, entity_id: id, kind, reason: why, payload: row ? stripLocal(row) : null, created_at: nowIso() })
            .run()
          if (kind === 'rejected') rejected++
          else conflicts++
        }
        tx.update(g.table)
          .set({ dirty: false, dirty_fields: null } as never)
          .where(and(eq(g.table.id, id), eq(g.table.updated_at, updated_at)))
          .run()
      }
    }
  })
  const { status, server_time, ...groups } = res
  void status
  void server_time
  return { sent, rejected, conflicts, groups }
}
