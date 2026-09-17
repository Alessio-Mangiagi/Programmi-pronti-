import { useState, type FormEvent } from 'react'
import { api, errorMessage } from '../api/client'
import type { Task, User } from '../api/types'
import { useToast } from '../components/Toast'

export type TaskDraft = { title: string; description?: string; assigned_to?: string | null; due_date?: string | null }

type Props = {
  pinId: string
  members: User[]
  /** Valori iniziali (es. dalla non conformità di un modulo). */
  draft?: Partial<TaskDraft>
  onSaved: (task: Task) => void
  onCancel: () => void
}

/** Creazione task su un pin: titolo, descrizione, assegnatario (membri del progetto), scadenza. */
export default function TaskForm({ pinId, members, draft, onSaved, onCancel }: Props) {
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
    const { data, error } = await api.POST('/tasks', {
      body: {
        pin_id: pinId,
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
