/**
 * Progetti, planimetrie, template e utenti: dati "di catalogo" che il device
 * scarica e legge sempre dal DB locale (così le schermate funzionano offline).
 * Il refresh completo per progetto arriva con il motore di sync (sync/pull.ts);
 * qui c'è il primo caricamento della lista progetti dopo il login.
 */
import { and, eq, isNull } from 'drizzle-orm'
import type { Api } from '../api/client'
import { schema, type AppDb } from '../db/types'

type ProjectRow = typeof schema.projects.$inferInsert

export async function refreshProjects(db: AppDb, api: Api): Promise<void> {
  const remote = await api.get<ProjectRow[]>('/projects')
  db.transaction((tx) => {
    for (const p of remote) {
      tx.insert(schema.projects)
        .values(p)
        .onConflictDoUpdate({ target: schema.projects.id, set: { name: p.name, address: p.address ?? null, updated_at: p.updated_at } })
        .run()
    }
    // progetti da cui l'utente è stato tolto: spariscono dalla lista locale
    const ids = new Set(remote.map((p) => p.id))
    for (const local of tx.select({ id: schema.projects.id }).from(schema.projects).all()) {
      if (!ids.has(local.id)) tx.delete(schema.projects).where(eq(schema.projects.id, local.id)).run()
    }
  })
}

export function listProjects(db: AppDb) {
  return db.select().from(schema.projects).orderBy(schema.projects.name).all()
}

export function listPlans(db: AppDb, projectId: string) {
  return db.select().from(schema.plans).where(eq(schema.plans.project_id, projectId)).orderBy(schema.plans.name).all()
}

export function getPlan(db: AppDb, planId: string) {
  return db.select().from(schema.plans).where(eq(schema.plans.id, planId)).get() ?? null
}

/** Pin vivi della planimetria + conteggi per colorarli (stesse regole della plan view web). */
export type PinWithCounts = typeof schema.pins.$inferSelect & {
  submissions_count: number
  tasks_open: number
  tasks_assigned: number
  tasks_resolved: number
  tasks_verified: number
}

export function listPins(db: AppDb, planId: string): PinWithCounts[] {
  const pins = db.select().from(schema.pins).where(and(eq(schema.pins.plan_id, planId), isNull(schema.pins.deleted_at))).all()
  return pins.map((p) => {
    const tasks = db.select({ status: schema.tasks.status }).from(schema.tasks).where(and(eq(schema.tasks.pin_id, p.id), isNull(schema.tasks.deleted_at))).all()
    const subs = db.select({ id: schema.formSubmissions.id }).from(schema.formSubmissions).where(and(eq(schema.formSubmissions.pin_id, p.id), isNull(schema.formSubmissions.deleted_at))).all()
    const n = (s: string) => tasks.filter((t) => t.status === s).length
    return { ...p, submissions_count: subs.length, tasks_open: n('open'), tasks_assigned: n('assigned'), tasks_resolved: n('resolved'), tasks_verified: n('verified') }
  })
}

export type PinLevel = 'open' | 'assigned' | 'resolved' | 'verified' | 'submission' | 'empty'
export function pinLevel(p: PinWithCounts): PinLevel {
  if (p.tasks_open) return 'open'
  if (p.tasks_assigned) return 'assigned'
  if (p.tasks_resolved) return 'resolved'
  if (p.tasks_verified) return 'verified'
  if (p.submissions_count) return 'submission'
  return 'empty'
}

/** Dettaglio pin: moduli, task e allegati vivi (per il bottom sheet). */
export function pinDetail(db: AppDb, pinId: string) {
  const pin = db.select().from(schema.pins).where(eq(schema.pins.id, pinId)).get() ?? null
  if (!pin) return null
  const submissions = db.select().from(schema.formSubmissions).where(and(eq(schema.formSubmissions.pin_id, pinId), isNull(schema.formSubmissions.deleted_at))).all()
  const tasks = db.select().from(schema.tasks).where(and(eq(schema.tasks.pin_id, pinId), isNull(schema.tasks.deleted_at))).all()
  const attachments = db.select().from(schema.attachments).where(isNull(schema.attachments.deleted_at)).all().filter(
    (a) => (a.submission_id && submissions.some((s) => s.id === a.submission_id)) || (a.task_id && tasks.some((t) => t.id === a.task_id)),
  )
  return { pin, submissions, tasks, attachments }
}

export function templateName(db: AppDb, id: string) {
  return db.select({ name: schema.formTemplates.name }).from(schema.formTemplates).where(eq(schema.formTemplates.id, id)).get()?.name ?? 'Modulo'
}
