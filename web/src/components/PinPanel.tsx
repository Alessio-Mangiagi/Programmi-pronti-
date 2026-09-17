import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, errorMessage } from '../api/client'
import type { Attachment, PinDetail, Submission, TaskStatus, User } from '../api/types'
import { isManager, useAuth } from '../auth/AuthContext'
import type { Lookups } from '../hooks/useLookups'
import AuthImage from './AuthImage'
import Loading from './Loading'
import Modal from './Modal'
import { useToast } from './Toast'
import SubmissionForm from '../forms/SubmissionForm'
import SubmissionDetail from '../forms/SubmissionDetail'
import TaskForm from '../forms/TaskForm'
import { findNonConformity, taskDraftFromSubmission } from '../forms/nonConformity'
import type { FormData, FormSchema } from '@fieldview/form-core'
import Icon from './Icon'

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  open: 'Aperto',
  assigned: 'Assegnato',
  resolved: 'Risolto',
  verified: 'Verificato',
}

type Props = {
  pinId: string
  lookups: Lookups
  /** Membri del progetto: assegnatari possibili di un task. */
  members: User[]
  onClose: () => void
  /** Chiamato dopo modifiche che cambiano i marker (label, cancellazione). */
  onChanged: () => void
}

function fmtDate(iso: string) {
  return new Date(iso.endsWith('Z') ? iso : iso + 'Z').toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })
}

/** Pannello laterale con tutto ciò che è agganciato a un pin. */
export default function PinPanel({ pinId, lookups, members, onClose, onChanged }: Props) {
  const { user } = useAuth()
  const toast = useToast()
  const [pin, setPin] = useState<PinDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [editingLabel, setEditingLabel] = useState(false)
  const [filling, setFilling] = useState(false)
  const [openSub, setOpenSub] = useState<Submission | null>(null)
  // Submission appena salvata con una non conformità: proponi il task pre-compilato
  const [proposeTaskFor, setProposeTaskFor] = useState<Submission | null>(null)
  const [newTask, setNewTask] = useState(false)

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
            {pin?.label || 'Pin senza etichetta'} <Icon name="pencil" className="muted" />
          </h2>
        )}
        <button className="btn pin-close" onClick={onClose} aria-label="Chiudi">
          <Icon name="x" />
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
              {pin.submissions.map((s) => {
                const tpl = lookups.templates[s.template_id]
                const nc = tpl ? findNonConformity(tpl.schema_def as FormSchema, s.data_json as FormData) : null
                return (
                  <li key={s.id} className="list-item-btn" onClick={() => setOpenSub(s)} role="button" tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && setOpenSub(s)}>
                    <div className="row">
                      <strong>{lookups.templateName(s.template_id)}</strong>
                      {nc && <span className="badge status-open">{nc.value}</span>}
                    </div>
                    <div className="muted small">
                      {lookups.userName(s.submitted_by)} · {fmtDate(s.created_at)}
                      {s.attachments.length > 0 && ` · ${s.attachments.length} allegat${s.attachments.length === 1 ? 'o' : 'i'}`}
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>

          <section>
            <div className="row">
              <h3>Task ({pin.tasks.length})</h3>
              <button type="button" className="btn small" onClick={() => setNewTask(true)}>
                + Nuovo task
              </button>
            </div>
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
            templates={Object.values(lookups.templates).filter((t) => !t.archived_at)}
            onCancel={() => setFilling(false)}
            onSaved={async (sub) => {
              setFilling(false)
              await load()
              onChanged()
              const tpl = lookups.templates[sub.template_id]
              if (tpl && findNonConformity(tpl.schema_def as FormSchema, sub.data_json as FormData)) setProposeTaskFor(sub)
            }}
          />
        </Modal>
      )}
      {proposeTaskFor && lookups.templates[proposeTaskFor.template_id] && (
        <Modal title="Non conformità rilevata: crea un task?" onClose={() => setProposeTaskFor(null)}>
          <TaskForm
            pinId={pinId}
            members={members}
            draft={taskDraftFromSubmission(lookups.templates[proposeTaskFor.template_id], proposeTaskFor.data_json as FormData, pin?.label)}
            onCancel={() => setProposeTaskFor(null)}
            onSaved={async () => {
              setProposeTaskFor(null)
              await load()
              onChanged()
            }}
          />
        </Modal>
      )}
      {newTask && (
        <Modal title={`Nuovo task — ${pin?.label || 'Pin senza etichetta'}`} onClose={() => setNewTask(false)}>
          <TaskForm
            pinId={pinId}
            members={members}
            onCancel={() => setNewTask(false)}
            onSaved={async () => {
              setNewTask(false)
              await load()
              onChanged()
            }}
          />
        </Modal>
      )}
      {openSub && lookups.templates[openSub.template_id] && (
        <SubmissionDetail
          submission={openSub}
          template={lookups.templates[openSub.template_id]}
          pinId={pinId}
          pinLabel={pin?.label}
          lookups={lookups}
          members={members}
          canEdit={isManager(user) || openSub.submitted_by === user?.id}
          onClose={() => setOpenSub(null)}
          onChanged={async () => {
            await load()
            onChanged()
          }}
        />
      )}
    </aside>
  )
}
