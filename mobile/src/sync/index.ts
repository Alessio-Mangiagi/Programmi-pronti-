/**
 * Orchestrazione: prima push (le modifiche locali raggiungono il server), poi
 * pull per ogni progetto (si ricevono anche gli effetti del proprio push, es.
 * created_by impostato dal server). Un mutex evita sync concorrenti: chi arriva
 * mentre una sync è in corso aspetta quella e ne riusa il risultato.
 */
import type { Api } from '../api/client'
import { schema, type AppDb } from '../db/types'
import { pullProject, type PullSummary } from './pull'
import { pushDirty, type PushSummary } from './push'

export type SyncResult = { push: PushSummary; pulls: Record<string, PullSummary>; errors: string[]; at: string }

let inFlight: Promise<SyncResult> | null = null

export function syncAll(db: AppDb, api: Api, projectIds?: string[]): Promise<SyncResult> {
  if (inFlight) return inFlight
  inFlight = run(db, api, projectIds).finally(() => {
    inFlight = null
  })
  return inFlight
}

export const isSyncing = () => inFlight !== null

async function run(db: AppDb, api: Api, projectIds?: string[]): Promise<SyncResult> {
  const errors: string[] = []
  let push: PushSummary = { sent: 0, rejected: 0, conflicts: 0, groups: null }
  try {
    push = await pushDirty(db, api)
  } catch (e) {
    errors.push(`push: ${(e as Error).message}`)
  }
  const ids = projectIds ?? db.select({ id: schema.projects.id }).from(schema.projects).all().map((p) => p.id)
  const pulls: Record<string, PullSummary> = {}
  for (const id of ids) {
    try {
      pulls[id] = await pullProject(db, api, id)
    } catch (e) {
      errors.push(`pull ${id}: ${(e as Error).message}`)
    }
  }
  return { push, pulls, errors, at: new Date().toISOString() }
}

export { pullProject, pushDirty }
