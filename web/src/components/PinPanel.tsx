import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, errorMessage } from '../api/client'
import type { Attachment, PinDetail, TaskStatus } from '../api/types'
import { isManager, useAuth } from '../auth/AuthContext'
import type { Lookups } from '../hooks/useLookups'
import AuthImage from './AuthImage'
import Loading from './Loading'
import Modal from './Modal'
import { useToast } from './Toast'
import SubmissionForm from '../forms/SubmissionForm'

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  open: 'Aperto',
  assigned: 'Assegnato',
  resolved: 'Risolto',
  verified: 'Verificato',
}

type Props = {
  pinId: string
  lookups: Lookups
  onClose: () => void
  /** Chiamato dopo modifiche che cambiano i marker (label, cancellazione). */
  onChanged: () => void
}

function fmtDate(iso: string) {
  return new Date(iso.endsWith('Z') ? iso : iso + 'Z').toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })
}

/** Pannello laterale con tutto ciò che è agganciato a un pin. */
export default function PinPanel({ pinId, lookups, onClose, onChanged }: Props) {
  const { user } = useAuth()
  const toast = useToast()
  const [pin, setPin] = useState<PinDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [editingLabel, setEditingLabel] = useState(false)
  const [filling, setFilling] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await api.GET('/pins/{pin_id}', { params: { path: { pin_id: pinId } } })
    if (error) return setError(errorMessage(error))
    setPin(data ?? null)
    setLabel(data?.label ?? '')
  }, [pinId])

  useEffect(() => {
    setPin(null)
    setEditingLabel(false)
    load()
  }, [load])

  async function saveLabel(e: FormEvent) {
    e.preventDefault()
    const { error } = await api.PATCH('/pins/{pin_id}', {
      params: { path: { pin_id: pinId } },
      body: { label: label.trim() || null },
    })
    if (error) return toast.error(errorMessage(error))
    setEditingLabel(false)
    await load()
    onChanged()
  }

  async function remove() {
    if (!confirm('Cancellare il pin con tutti i moduli, task e foto collegati?')) return
    const { error } = await api.DELETE('/pins/{pin_id}', { params: { path: { pin_id: pinId } } })
    if (error) return toast.error(errorMessage(error))
    toast.success('Pin cancellato')
    onChanged()
    onClose()
  }

  const canDelete = pin && (isManager(user) || pin.created_by === user?.id)
  const photos: Attachment[] = pin
    ? [...pin.submissions.flatMap((s) => s.attachments), ...pin.tasks.flatMap((t) => t.attachments)].filter(
        (a) => a.file_url && a.file_type !== 'doc' && a.file_type !== 'signature',
      )
    : []

  return (
    <aside className="pin-panel">
      <div className="pin-panel-head">
        {editingLabel ? (
          <form onSubmit={saveLabel} className="pin-label-form">
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Etichetta" autoFocus />
            <button className="btn btn-primary" type="submit">
              Salva
            </button>
            <button className="btn" type="button" onClick={() => setEditingLabel(false)}>
              Annulla
            </button>
          </form>
        ) : (
          <h2 onClick={() => setEditingLabel(true)} title="Clicca per rinominare" className="pin-title">
            {pin?.label || 'Pin senza etichetta'} <span className="muted small">✎</span>
          </h2>
        )}
        <button className="btn pin-close" onClick={onClose} aria-label="Chiudi">
          ×
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {!pin ? (
        !error && <Loading />
      ) : (
        <>
          <p className="muted small">
            Creato da {lookups.userName(pin.created_by)} · {fmtDate(pin.created_at)}
          </p>

          <section>
            <div className="row">
              <h3>Moduli ({pin.submissions.length})</h3>
              <button type="button" className="btn small btn-primary" onClick={() => setFilling(true)}>
                + Compila modulo
              </button>
            </div>
            {pin.submissions.length === 0 && <p className="muted small">Nessun modulo compilato.</p>}
            <ul className="list">
              {pin.submissions.map((s) => (
                <li key={s.id}>
                  <strong>{lookups.templateName(s.template_id)}</strong>
                  <div className="muted small">
                    {lookups.userName(s.submitted_by)} · {fmtDate(s.created_at)}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3>Task ({pin.tasks.length})</h3>
            {pin.tasks.length === 0 && <p className="muted small">Nessun task.</p>}
            <ul className="list">
              {pin.tasks.map((t) => (
                <li key={t.id}>
                  <div className="row">
                    <strong>{t.title}</strong>
                    <span className={`badge status-${t.status}`}>{TASK_STATUS_LABEL[t.status as TaskStatus]}</span>
                  </div>
                  <div className="muted small">
                    {t.assigned_to ? `Assegnato a ${lookups.userName(t.assigned_to)}` : 'Non assegnato'}
                    {t.due_date && ` · scade ${new Date(t.due_date).toLocaleDateString('it-IT')}`}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3>Foto ({photos.length})</h3>
            {photos.length === 0 ? (
              <p className="muted small">Nessuna foto.</p>
            ) : (
              <div className="photo-grid">
                {photos.map((a) => (
                  <AuthImage key={a.id} fileUrl={a.file_url} className="photo" alt={a.file_type ?? 'foto'} />
                ))}
              </div>
            )}
          </section>

          {canDelete && (
            <button className="btn btn-danger" onClick={remove}>
              Cancella pin
            </button>
          )}
        </>
      )}
      {filling && (
        <Modal title={`Compila modulo — ${pin?.label || 'Pin senza etichetta'}`} onClose={() => setFilling(false)}>
          <SubmissionForm
            pinId={pinId}
            templates={Object.values(lookups.templates)}
            onCancel={() => setFilling(false)}
            onSaved={async () => {
              setFilling(false)
              await load()
              onChanged()
            }}
          />
        </Modal>
      )}
    </aside>
  )
}
