import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { defaults, validateSubmission, type FieldError, type FormData, type FormSchema } from '@fieldview/form-core'
import { api, errorMessage } from '../api/client'
import type { FormTemplate, Submission } from '../api/types'
import { uploadAttachmentFile } from '../api/upload'
import { useToast } from '../components/Toast'
import { isLocal, releaseAttachment, type AttachmentKind, type AttachmentMap, type RemoteAttachment } from './attachments'
import DynamicForm, { type AttachmentChange } from './DynamicForm'

type Props = {
  pinId: string
  templates: FormTemplate[]
  /** Template preselezionato (se uno solo, o scelto fuori dal form). */
  templateId?: string
  /** Se presente si modifica questa submission (template fisso, valori e allegati esistenti). */
  submission?: Submission
  onSaved: (submission: Submission) => void
  onCancel: () => void
}

/** Allegati già sul server, indicizzati per id (il tipo viene da file_type). */
export function remoteAttachments(sub: Submission): AttachmentMap {
  return Object.fromEntries(
    sub.attachments.map((a): [string, RemoteAttachment] => [
      a.id,
      { id: a.id, kind: a.file_type === 'photo' || a.file_type === 'signature' ? (a.file_type as AttachmentKind) : null, fileUrl: a.file_url ?? null },
    ]),
  )
}

/**
 * Compilazione di un modulo su un pin: scelta template → DynamicForm →
 * validazione locale (form-core, identica al server) → POST /submissions →
 * upload di foto e firma (POST /attachments con l'id già in data_json + byte).
 */
export default function SubmissionForm({ pinId, templates, templateId: initialTemplateId, submission, onSaved, onCancel }: Props) {
  const fixedTemplate = submission?.template_id ?? initialTemplateId
  const [templateId, setTemplateId] = useState(fixedTemplate ?? (templates.length === 1 ? templates[0].id : ''))
  const template = templates.find((t) => t.id === templateId)
  const [busy, setBusy] = useState(false)

  return (
    <div className="submission-form">
      {!fixedTemplate && templates.length > 1 && (
        <div className="field">
          <label htmlFor="sf-template">Modulo</label>
          <select id="sf-template" value={templateId} onChange={(e) => setTemplateId(e.target.value)} disabled={busy}>
            <option value="">— Scegli il modulo —</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {template ? (
        // key = template: cambiando modulo si riparte dai default, foto e firme comprese
        <Editor key={template.id} pinId={pinId} template={template} submission={submission} onSaved={onSaved} onCancel={onCancel} onBusy={setBusy} />
      ) : (
        <div className="row form-actions">
          <button className="btn btn-primary" type="button" disabled>
            Salva modulo
          </button>
          <button className="btn" type="button" onClick={onCancel}>
            Annulla
          </button>
        </div>
      )}
    </div>
  )
}

type EditorProps = {
  pinId: string
  template: FormTemplate
  submission?: Submission
  onSaved: (submission: Submission) => void
  onCancel: () => void
  onBusy: (busy: boolean) => void
}

function Editor({ pinId, template, submission, onSaved, onCancel, onBusy }: EditorProps) {
  const toast = useToast()
  const schema = template.schema_def as FormSchema
  const [value, setValue] = useState<FormData>(() => (submission ? { ...defaults(schema), ...(submission.data_json as FormData) } : defaults(schema)))
  const [attachments, setAttachments] = useState<AttachmentMap>(() => (submission ? remoteAttachments(submission) : {}))
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  // Smontaggio: revoca gli object URL ancora vivi (il ref evita di dipendere dallo stato).
  const attachmentsRef = useRef(attachments)
  useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])
  useEffect(() => () => Object.values(attachmentsRef.current).forEach(releaseAttachment), [])

  // Errori: solo dopo il primo tentativo di salvataggio, poi live a ogni modifica.
  const errors = useMemo<FieldError[]>(() => (touched ? validateSubmission(schema, value) : []), [touched, schema, value])

  function onAttachmentsChange({ added, removed }: AttachmentChange) {
    setAttachments((prev) => {
      const next = { ...prev }
      removed.forEach((id) => {
        releaseAttachment(next[id])
        delete next[id]
      })
      added.forEach((a) => (next[a.id] = a))
      return next
    })
  }

  function setSavingState(s: string | null) {
    setSaving(s)
    onBusy(s !== null)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (validateSubmission(schema, value).length) {
      // il primo campo con errore va a schermo
      queueMicrotask(() => document.querySelector<HTMLElement>('.dyn-field.has-error')?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
      return
    }
    setSavingState('Salvataggio…')
    const { data: sub, error } = submission
      ? await api.PATCH('/submissions/{submission_id}', { params: { path: { submission_id: submission.id } }, body: { data_json: value } })
      : await api.POST('/submissions', { body: { template_id: template.id, pin_id: pinId, data_json: value } })
    if (error || !sub) {
      setSavingState(null)
      return toast.error(errorMessage(error))
    }

    // In modifica: gli allegati remoti tolti dal form vengono cancellati (soft) sul server.
    let failed = 0
    if (submission) {
      const removedRemote = submission.attachments.filter((a) => !(a.id in attachments))
      for (const a of removedRemote) {
        const { error: delErr } = await api.DELETE('/attachments/{attachment_id}', { params: { path: { attachment_id: a.id } } })
        if (delErr) failed++
      }
    }

    // Allegati nuovi referenziati in data_json: record con lo stesso id, poi i byte.
    const local = Object.values(attachments).filter(isLocal)
    for (const [i, a] of local.entries()) {
      setSavingState(`Caricamento ${a.kind === 'signature' ? 'firma' : 'foto'} ${i + 1}/${local.length}…`)
      const { error: attErr } = await api.POST('/attachments', { body: { id: a.id, submission_id: sub.id, file_type: a.kind } })
      if (attErr) {
        failed++
        continue
      }
      try {
        await uploadAttachmentFile(a.id, a.file)
      } catch {
        failed++
      }
    }
    setSavingState(null)
    if (failed) toast.error(`Modulo salvato ma ${failed} allegat${failed === 1 ? 'o non caricato' : 'i non caricati'}`)
    else toast.success(submission ? 'Modulo aggiornato' : 'Modulo salvato')
    onSaved({ ...sub, data_json: value })
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <DynamicForm
        schema={schema}
        value={value}
        errors={errors}
        attachments={attachments}
        readOnly={!!saving}
        onChange={setValue}
        onAttachmentsChange={onAttachmentsChange}
        onError={(m) => toast.error(m)}
      />
      <div className="row form-actions">
        <button className="btn btn-primary" type="submit" disabled={!!saving}>
          {saving ?? (submission ? 'Salva modifiche' : 'Salva modulo')}
        </button>
        <button className="btn" type="button" onClick={onCancel} disabled={!!saving}>
          Annulla
        </button>
        {touched && errors.length > 0 && (
          <span className="error small">
            {errors.length} {errors.length === 1 ? 'campo da correggere' : 'campi da correggere'}
          </span>
        )}
      </div>
    </form>
  )
}
