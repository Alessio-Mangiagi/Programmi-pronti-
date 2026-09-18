import { useState } from 'react'
import type { FormData, FormSchema } from '@fieldview/form-core'
import type { FormTemplate, Submission, User } from '../api/types'
import Modal from '../components/Modal'
import { useToast } from '../components/Toast'
import { getToken } from '../auth/token'
import type { Lookups } from '../hooks/useLookups'
import DynamicForm from './DynamicForm'
import { findNonConformity, taskDraftFromSubmission } from './nonConformity'
import SubmissionForm, { remoteAttachments } from './SubmissionForm'
import TaskForm from './TaskForm'

type Props = {
  submission: Submission
  template: FormTemplate
  pinId: string
  pinLabel?: string | null
  lookups: Lookups
  members: User[]
  canEdit: boolean
  onClose: () => void
  /** Dopo modifica o creazione task: il pannello ricarica il pin. */
  onChanged: () => void
}

function fmtDate(iso: string) {
  return new Date(iso.endsWith('Z') ? iso : iso + 'Z').toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })
}

/** Modulo compilato in sola lettura, con modifica e creazione task nella stessa modale. */
export default function SubmissionDetail({ submission: initial, template, pinId, pinLabel, lookups, members, canEdit, onClose, onChanged }: Props) {
  const [submission, setSubmission] = useState(initial)
  const [mode, setMode] = useState<'view' | 'edit' | 'task'>('view')
  const [downloading, setDownloading] = useState(false)
  const toast = useToast()

  /** PDF dal server (richiede il bearer: niente <a href> diretto). */
  async function downloadPdf() {
    setDownloading(true)
    try {
      const r = await fetch(`/api/submissions/${encodeURIComponent(submission.id)}/pdf`, { headers: { Authorization: `Bearer ${getToken() ?? ''}` } })
      if (!r.ok) throw new Error(`Errore ${r.status}`)
      const name = r.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'modulo.pdf'
      const url = URL.createObjectURL(await r.blob())
      const a = Object.assign(document.createElement('a'), { href: url, download: name })
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'PDF non generato')
    } finally {
      setDownloading(false)
    }
  }
  const schema = template.schema_def as FormSchema
  const data = submission.data_json as FormData
  const nc = findNonConformity(schema, data)

  if (mode === 'edit') {
    return (
      <Modal title={`Modifica — ${template.name}`} onClose={onClose}>
        <SubmissionForm
          pinId={pinId}
          templates={[template]}
          submission={submission}
          onCancel={() => setMode('view')}
          onSaved={(sub) => {
            setSubmission(sub)
            setMode('view')
            onChanged()
          }}
        />
      </Modal>
    )
  }

  if (mode === 'task') {
    return (
      <Modal title={nc ? `Task da "${nc.value}"` : 'Nuovo task dal modulo'} onClose={onClose}>
        <TaskForm
          pinId={pinId}
          members={members}
          draft={taskDraftFromSubmission(template, data, pinLabel)}
          onCancel={() => setMode('view')}
          onSaved={() => {
            onChanged()
            onClose()
          }}
        />
      </Modal>
    )
  }

  return (
    <Modal title={template.name} onClose={onClose}>
      <p className="muted small">
        Compilato da {lookups.userName(submission.submitted_by)} · {fmtDate(submission.created_at)}
        {submission.updated_at !== submission.created_at && ` · modificato ${fmtDate(submission.updated_at)}`}
      </p>
      {nc && (
        <div className="callout callout-warn">
          <strong>{nc.value}</strong> in "{nc.label}": serve un intervento?
          <button type="button" className="btn small btn-primary" onClick={() => setMode('task')}>
            Crea task
          </button>
        </div>
      )}
      <DynamicForm schema={schema} value={data} attachments={remoteAttachments(submission)} readOnly onChange={() => {}} />
      <div className="row form-actions">
        {canEdit && (
          <button type="button" className="btn btn-primary" onClick={() => setMode('edit')}>
            Modifica
          </button>
        )}
        {!nc && (
          <button type="button" className="btn" onClick={() => setMode('task')}>
            Crea task da questo modulo
          </button>
        )}
        <button type="button" className="btn" onClick={downloadPdf} disabled={downloading}>
          {downloading ? 'Preparo il PDF…' : 'Scarica PDF'}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Chiudi
        </button>
      </div>
    </Modal>
  )
}
