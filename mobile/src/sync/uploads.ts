/**
 * Coda di upload dei file (foto, firme), separata dal sync JSON che viaggia
 * sempre leggero. Candidati: attachments con local_file_path, senza file_url,
 * già pushati (dirty = false, quindi il record esiste sul server), non cancellati
 * e con upload_next_at scaduto. Flusso per ciascuno:
 *   POST /attachments/presign -> {upload_url, method}  ->  multipart `file` -> file_url
 * Fallimento: upload_attempts + 1 e backoff esponenziale (5s · 2^n, max 1h).
 * Stati per la UI: local (file_url null, in coda) -> uploading -> uploaded (file_url).
 */
import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import type { Api } from '../api/client'
import { schema, type AppDb } from '../db/types'
import { nowIso, toMs } from './time'

export type UploadOptions = {
  /** costruisce il multipart con il file locale (RN: {uri,name,type}; Node: Blob) */
  buildForm: (uri: string, name: string, mime: string) => Promise<FormData>
  maxPerRun?: number
  now?: () => string
}
export type UploadSummary = { uploaded: number; failed: number; pending: number }
type Presign = { attachment_id: string; method: string; upload_url: string; max_bytes: number }

export const MAX_ATTEMPTS = 20
export const backoffMs = (attempts: number) => Math.min(60 * 60_000, 5_000 * 2 ** Math.max(0, attempts - 1))

export function pendingUploads(db: AppDb) {
  return db
    .select()
    .from(schema.attachments)
    .where(and(isNotNull(schema.attachments.local_file_path), isNull(schema.attachments.file_url), isNull(schema.attachments.deleted_at)))
    .all()
}

export async function processUploadQueue(db: AppDb, api: Api, opts: UploadOptions): Promise<UploadSummary> {
  const now = opts.now ?? nowIso
  const out: UploadSummary = { uploaded: 0, failed: 0, pending: 0 }
  const candidates = pendingUploads(db)
    .filter((a) => !a.dirty) // record non ancora sul server: prima il push
    .filter((a) => !a.upload_next_at || toMs(a.upload_next_at) <= toMs(now()))
    .filter((a) => a.upload_attempts < MAX_ATTEMPTS)
    .sort((a, b) => a.upload_attempts - b.upload_attempts || a.created_at.localeCompare(b.created_at))
    .slice(0, opts.maxPerRun ?? 50)

  for (const att of candidates) {
    try {
      const presign = await api.post<Presign>('/attachments/presign', { attachment_id: att.id })
      const path = presign.upload_url.replace(/^https?:\/\/[^/]+/, '').replace(/^\/api(?=\/)/, '')
      const ext = att.local_file_path!.split('.').pop()?.toLowerCase() ?? 'jpg'
      const mime = ext === 'png' ? 'image/png' : 'image/jpeg'
      const form = await opts.buildForm(att.local_file_path!, `${att.id}.${ext}`, mime)
      const res = await api.upload<{ file_url: string | null; updated_at: string }>(path, form)
      db.update(schema.attachments)
        .set({ file_url: res.file_url, updated_at: res.updated_at, upload_next_at: null })
        .where(eq(schema.attachments.id, att.id))
        .run()
      out.uploaded++
    } catch (e) {
      const attempts = att.upload_attempts + 1
      const status = (e as { status?: number }).status
      // 404/409: il record non esiste (più) sul server: inutile insistere, resta visibile in locale
      const giveUp = status === 404 || status === 409
      db.update(schema.attachments)
        .set({ upload_attempts: giveUp ? MAX_ATTEMPTS : attempts, upload_next_at: new Date(toMs(now()) + backoffMs(attempts)).toISOString().replace('Z', '') })
        .where(eq(schema.attachments.id, att.id))
        .run()
      out.failed++
    }
  }
  out.pending = pendingUploads(db).length
  return out
}
