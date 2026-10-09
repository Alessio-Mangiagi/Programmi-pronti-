/**
 * Task dal DB locale: lista per progetto (via plans → pins), "i miei",
 * transizioni di stato come sul server, risoluzione con foto (tutto offline).
 */
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { schema, type AppDb } from '../db/types'
import type { Task } from '../db/schema'
import { createAttachment, updateTask } from './mutations'

export type TaskStatus = 'open' | 'assigned' | 'resolved' | 'verified'
export const STATUS_LABEL: Record<TaskStatus, string> = { open: 'Aperto', assigned: 'Assegnato', resolved: 'Risolto', verified: 'Verificato' }
/** Specchio di TASK_TRANSITIONS del server. */
export const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = { open: ['assigned'], assigned: ['resolved', 'open'], resolved: ['verified', 'open'], verified: [] }

export type TaskRow = Task & { plan_name: string; plan_id: string; pin_label: string | null; photos: number; pending_uploads: number }

export function listTasks(db: AppDb, projectId: string, opts: { mine?: string | null; status?: TaskStatus[] } = {}): TaskRow[] {
  const plans = db.select().from(schema.plans).where(eq(schema.plans.project_id, projectId)).all()
  if (!plans.length) return []
  const pins = db.select().from(schema.pins).where(and(inArray(schema.pins.plan_id, plans.map((p) => p.id)), isNull(schema.pins.deleted_at))).all()
  if (!pins.length) return []
  const pinById = new Map(pins.map((p) => [p.id, p]))
  const planById = new Map(plans.map((p) => [p.id, p]))
  let tasks = db.select().from(schema.tasks).where(and(inArray(schema.tasks.pin_id, pins.map((p) => p.id)), isNull(schema.tasks.deleted_at))).all()
  if (opts.mine) tasks = tasks.filter((t) => t.assigned_to === opts.mine)
  if (opts.status?.length) tasks = tasks.filter((t) => opts.status!.includes(t.status as TaskStatus))
  const atts = tasks.length ? db.select().from(schema.attachments).where(and(inArray(schema.attachments.task_id, tasks.map((t) => t.id)), isNull(schema.attachments.deleted_at))).all() : []
  return tasks
    .map((t) => {
      const pin = pinById.get(t.pin_id)!
      const mine = atts.filter((a) => a.task_id === t.id)
      return { ...t, plan_id: pin.plan_id, plan_name: planById.get(pin.plan_id)?.name ?? '', pin_label: pin.label, photos: mine.length, pending_uploads: mine.filter((a) => !a.file_url).length }
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export function getTask(db: AppDb, id: string) {
  return db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get() ?? null
}

export function taskAttachments(db: AppDb, taskId: string) {
  return db.select().from(schema.attachments).where(and(eq(schema.attachments.task_id, taskId), isNull(schema.attachments.deleted_at))).all()
}

/** Mosse consentite per chi guarda: verified solo a manager/admin; assigned richiede un assegnatario. */
export function allowedTransitions(task: Task, user: { id: string; role: string }): TaskStatus[] {
  return TRANSITIONS[task.status as TaskStatus].filter((s) => (s !== 'verified' || user.role !== 'field') && (s !== 'assigned' || task.assigned_to))
}

export function setTaskStatus(db: AppDb, taskId: string, status: TaskStatus, opts: { assignTo?: string | null } = {}) {
  const patch: Parameters<typeof updateTask>[2] = { status }
  if (opts.assignTo !== undefined) patch.assigned_to = opts.assignTo
  updateTask(db, taskId, patch)
}

/** Chiusura con foto di risoluzione: stato + attachment locale in coda upload, in una transazione. */
export function resolveTaskWithPhoto(db: AppDb, taskId: string, photoUri: string | null) {
  db.transaction((tx) => {
    updateTask(tx, taskId, { status: 'resolved' })
    if (photoUri) createAttachment(tx, { task_id: taskId }, 'photo', photoUri)
  })
}
