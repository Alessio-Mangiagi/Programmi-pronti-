/**
 * Bozze e salvataggio locale dei moduli compilati (senza React: testabile in Node).
 */
import { eq } from 'drizzle-orm'
import type { FormData } from '@fieldview/form-core'
import { createSubmission } from './mutations'
import { schema, type AppDb } from '../db/types'
import { nowIso } from '../sync/time'

export type LocalAttachment = { uri: string; kind: 'photo' | 'signature' }
export type LocalAttachments = Record<string, LocalAttachment>

const draftKey = (pinId: string, templateId: string) => `${pinId}:${templateId}`

export function loadDraft(db: AppDb, pinId: string, templateId: string) {
  return db.select().from(schema.drafts).where(eq(schema.drafts.key, draftKey(pinId, templateId))).get() ?? null
}
export function saveDraft(db: AppDb, pinId: string, templateId: string, data: FormData, attachments: LocalAttachments) {
  const row = { key: draftKey(pinId, templateId), pin_id: pinId, template_id: templateId, data_json: data as Record<string, unknown>, attachments_json: attachments, updated_at: nowIso() }
  db.insert(schema.drafts).values(row).onConflictDoUpdate({ target: schema.drafts.key, set: row }).run()
}
export function deleteDraft(db: AppDb, pinId: string, templateId: string) {
  db.delete(schema.drafts).where(eq(schema.drafts.key, draftKey(pinId, templateId))).run()
}

/**
 * Salvataggio di un modulo compilato, tutto locale e immediato: submission +
 * un attachment (con local_file_path) per ogni foto/firma, tutti dirty. Il sync
 * manda il JSON, la coda upload i file.
 */
export function saveSubmissionLocally(db: AppDb, args: { pinId: string; templateId: string; data: FormData; attachments: LocalAttachments; userId: string | null }) {
  return db.transaction((tx) => {
    const sub = createSubmission(tx, args.templateId, args.pinId, args.data as Record<string, unknown>, args.userId)
    for (const [id, a] of Object.entries(args.attachments)) {
      // stesso id del form (referenziato in data_json) come id dell'attachment
      const t = nowIso()
      tx.insert(schema.attachments)
        .values({ id, submission_id: sub.id, task_id: null, file_url: null, file_type: a.kind, local_file_path: a.uri, upload_attempts: 0, created_at: t, updated_at: t, deleted_at: null, dirty: true })
        .run()
    }
    deleteDraft(tx, args.pinId, args.templateId)
    return sub
  })
}

