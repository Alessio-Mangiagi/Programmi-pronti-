/**
 * Orchestrazione: prima push (le modifiche locali raggiungono il server), poi
 * pull per ogni progetto (si ricevono anche gli effetti del proprio push, es.
 * created_by impostato dal server). Un mutex evita sync concorrenti: chi arriva
 * mentre una sync è in corso aspetta quella e ne riusa il risultato.
 */
import type { Api } from '../api/client'
import { schema, type AppDb } from '../db/types'
import { cachePlanImages, type CacheSummary, type FilesOptions } from './files'
import { pullProject, type PullSummary } from './pull'
import { pushDirty, type PushSummary } from './push'
import { processUploadQueue, type UploadOptions, type UploadSummary } from './uploads'

export type SyncResult = { push: PushSummary; pulls: Record<string, PullSummary>; files: Record<string, CacheSummary>; uploads: UploadSummary | null; errors: string[]; at: string }
export type SyncOptions = { projectIds?: string[]; files?: FilesOptions; uploads?: UploadOptions }

let inFlight: Promise<SyncResult> | null = null

export function syncAll(db: AppDb, api: Api, projectIdsOrOptions?: string[] | SyncOptions): Promise<SyncResult> {
  const options: SyncOptions = Array.isArray(projectIdsOrOptions) ? { projectIds: projectIdsOrOptions } : (projectIdsOrOptions ?? {})
  if (inFlight) return inFlight
  inFlight = run(db, api, options).finally(() => {
    inFlight = null
  })
  return inFlight
}

export const isSyncing = () => inFlight !== null

async function run(db: AppDb, api: Api, { projectIds, files, uploads }: SyncOptions): Promise<SyncResult> {
  const errors: string[] = []
  let push: PushSummary = { sent: 0, rejected: 0, conflicts: 0, groups: null }
  try {
    push = await pushDirty(db, api)
  } catch (e) {
    errors.push(`push: ${(e as Error).message}`)
  }
  const ids = projectIds ?? db.select({ id: schema.projects.id }).from(schema.projects).all().map((p) => p.id)
  const pulls: Record<string, PullSummary> = {}
  const filesOut: Record<string, CacheSummary> = {}
  for (const id of ids) {
    try {
      pulls[id] = await pullProject(db, api, id)
    } catch (e) {
      errors.push(`pull ${id}: ${(e as Error).message}`)
      continue
    }
    // immagini delle planimetrie in cache: best effort, dopo il pull (che porta i file_url aggiornati)
    if (files) filesOut[id] = await cachePlanImages(db, { api, ...files }, id)
  }
  // coda upload dopo il push (i record devono esistere sul server) e dopo il pull
  let uploadsOut: UploadSummary | null = null
  if (uploads) {
    try {
      uploadsOut = await processUploadQueue(db, api, uploads)
    } catch (e) {
      errors.push(`uploads: ${(e as Error).message}`)
    }
  }
  return { push, pulls, files: filesOut, uploads: uploadsOut, errors, at: new Date().toISOString() }
}

export { pullProject, pushDirty, processUploadQueue }
