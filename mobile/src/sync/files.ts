/**
 * Cache delle immagini delle planimetrie: al pull, ogni piano con file_url viene
 * scaricato in `<document>/plans/<id>.<ext>` così la plan view funziona offline.
 * Si riscarica solo se il piano è cambiato (plans.updated_at != local_file_for).
 * Lo store è un'interfaccia: expo-file-system nell'app, finto nei test in Node.
 */
import { eq } from 'drizzle-orm'
import { schema, type AppDb } from '../db/types'

export type FileStore = {
  /** path/uri locale per la planimetria */
  planPath: (planId: string, ext: string) => string
  exists: (path: string) => boolean
  download: (url: string, path: string, headers: Record<string, string>) => Promise<void>
  remove: (path: string) => void
}

export type FilesOptions = { baseUrl: string; getToken: () => Promise<string | null> | string | null; store: FileStore }
export type CacheSummary = { downloaded: number; failed: number; skipped: number }

export async function cachePlanImages(db: AppDb, opts: FilesOptions, projectId: string): Promise<CacheSummary> {
  const out: CacheSummary = { downloaded: 0, failed: 0, skipped: 0 }
  const plans = db.select().from(schema.plans).where(eq(schema.plans.project_id, projectId)).all()
  const token = await opts.getToken()
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
  for (const plan of plans) {
    if (!plan.file_url) {
      if (plan.local_file_path) {
        opts.store.remove(plan.local_file_path)
        db.update(schema.plans).set({ local_file_path: null, local_file_for: null }).where(eq(schema.plans.id, plan.id)).run()
      }
      continue
    }
    const upToDate = plan.local_file_path && plan.local_file_for === plan.updated_at && opts.store.exists(plan.local_file_path)
    if (upToDate) {
      out.skipped++
      continue
    }
    const ext = plan.file_url.split('.').pop()?.toLowerCase() || 'png'
    const path = opts.store.planPath(plan.id, ext)
    try {
      await opts.store.download(`${opts.baseUrl}${plan.file_url}`, path, headers)
      db.update(schema.plans).set({ local_file_path: path, local_file_for: plan.updated_at }).where(eq(schema.plans.id, plan.id)).run()
      out.downloaded++
    } catch {
      out.failed++ // resta "solo online": si riprova alla prossima sync
    }
  }
  return out
}
