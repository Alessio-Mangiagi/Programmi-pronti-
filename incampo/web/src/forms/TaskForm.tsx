import { useState, type FormEvent } from 'react'
import { api, errorMessage } from '../api/client'
import type { Task, User } from '../api/types'
import { useToast } from '../components/useToast'

export type TaskDraft = { title: string; description?: string; assigned_to?: string | null; due_date?: string | null }

/**
 * Dove agganciare il task: un pin esistente, un nuovo pin creato al salvataggio nel punto
 * indicato, oppure il cantiere (task da un modulo su voce WBS o generale).
 * `submissionId` = modulo da cui nasce, se c'è.
 */
export type TaskTarget = ({ pinId: string } | { planId: string; x: number; y: number } | { projectId: string }) & { submissionId?: string }

type Props = {
  target: TaskTarget
  members: User[]
  /** Valori iniziali (es. dalla non conformità di un modulo). */
  draft?: Partial<TaskDraft>
  onSaved: (task: Task) => void
  onCancel: () => void
}

/** Creazione task su un pin o sul cantiere: titolo, descrizione, assegnatario (membri del progetto), scadenza. */
export default function TaskForm({ target, members, draft, onSaved, onCancel }: Props) {
  const toast = useToast()
  const [title, setTitle] = useState(draft?.title ?? '')
  const [description, setDescription] = useState(draft?.description ?? '')
  const [assignedTo, setAssignedTo] = useState(draft?.assigned_to ?? '')
  const [dueDate, setDueDate] = useState(draft?.due_date ?? '')
  const [saving, setSaving] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    let pinId: string | null = null
    if ('pinId' in target) {
      pinId = target.pinId
    } else if ('planId' in target) {
      // task "dal nulla" (tasto destro sulla planimetria): prima il pin nel punto scelto
      const pin = await api.POST('/pins', { body: { plan_id: target.planId, x: target.x, y: target.y, label: null } })
      if (pin.error || !pin.data) {
        setSaving(false)
        return toast.error(errorMessage(pin.error))
      }
      pinId = pin.data.id
    }
    const { data, error } = await api.POST('/tasks', {
      body: {
        pin_id: pinId,
        project_id: 'projectId' in target ? target.projectId : null,
        submission_id: target.submissionId ?? null,
        title: title.trim(),
        description: description.trim() || null,
        assigned_to: assignedTo || null,
        due_date: dueDate ? `${dueDate}T00:00:00` : null,
      },
    })
    setSaving(false)
    if (error || !data) return toast.error(errorMessage(error))
    toast.success(assignedTo ? 'Task creato e assegnato' : 'Task creato')
    onSaved(data)
  }

  return (
    <form className="task-form" onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor="tf-title">Titolo</label>
        <input id="tf-title" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus disabled={saving} />
      </div>
      <div className="field">
        <label htmlFor="tf-desc">Descrizione</label>
        <textarea id="tf-desc" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} disabled={saving} />
      </div>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="tf-assignee">Assegna a</label>
          <select id="tf-assignee" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} disabled={saving}>
            <option value="">— Nessuno (resta aperto) —</option>
            {members.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="tf-due">Scadenza</label>
          <input id="tf-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={saving} />
        </div>
      </div>
      <div className="row form-actions">
        <button className="btn btn-primary" type="submit" disabled={saving || !title.trim()}>
          {saving ? 'Creazione…' : assignedTo ? 'Crea e assegna' : 'Crea task'}
        </button>
        <button className="btn" type="button" onClick={onCancel} disabled={saving}>
          Annulla
        </button>
      </div>
    </form>
  )
}
