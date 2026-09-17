import { useEffect, useState, type FormEvent } from 'react'
import { api, errorMessage } from '../api/client'
import type { Plan } from '../api/types'
import { PLAN_FILE_ACCEPT, PLAN_FILE_MAX_BYTES, uploadPlanFile } from '../api/upload'

type Props = {
  projectId: string
  /** Se presente si carica solo il file su questa planimetria (niente campo nome). */
  plan?: Plan
  onDone: (plan: Plan) => void
  onCancel?: () => void
}

/**
 * Nuova planimetria (nome + file) o sostituzione del file di una esistente.
 * Flusso: POST /plans (se serve) → POST /plans/{id}/file con barra di avanzamento.
 * Anteprima locale per le immagini; per i PDF solo nome e dimensione (la conversione
 * in PNG la fa il server).
 */
export default function PlanUploadForm({ projectId, plan, onDone, onCancel }: Props) {
  const [name, setName] = useState(plan?.name ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Revoca l'object URL dell'anteprima quando cambia o il form smonta.
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])

  function pick(f: File | null) {
    setError(null)
    if (f && f.size > PLAN_FILE_MAX_BYTES) {
      f = null
      setError(`File troppo grande: massimo ${formatBytes(PLAN_FILE_MAX_BYTES)}`)
    }
    setFile(f)
    setPreview(f && f.type.startsWith('image/') ? URL.createObjectURL(f) : null)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!file) return setError('Scegli un file')
    setError(null)
    let target = plan
    if (!target) {
      const { data, error } = await api.POST('/plans', { body: { project_id: projectId, name: name.trim() } })
      if (error || !data) return setError(errorMessage(error))
      target = data
    }
    setProgress(0)
    try {
      const updated = await uploadPlanFile(target.id, file, setProgress)
      onDone(updated)
    } catch (err) {
      setProgress(null)
      setError(err instanceof Error ? err.message : 'Caricamento fallito')
    }
  }

  const busy = progress !== null

  return (
    <form className="card upload-form" onSubmit={onSubmit}>
      <h2>{plan ? `File per "${plan.name}"` : 'Nuova planimetria'}</h2>
      {!plan && (
        <div className="field">
          <label htmlFor="plan-name">Nome</label>
          <input
            id="plan-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="es. Piano terra"
            required
            autoFocus
            disabled={busy}
          />
        </div>
      )}
      <div className="field">
        <label htmlFor="plan-file">Immagine o PDF (max {formatBytes(PLAN_FILE_MAX_BYTES)})</label>
        <input
          id="plan-file"
          type="file"
          accept={PLAN_FILE_ACCEPT}
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
          disabled={busy}
        />
      </div>
      {file && (
        <div className="upload-preview">
          {preview ? (
            <img src={preview} alt="Anteprima" />
          ) : (
            <div className="upload-preview-doc">
              <span className="upload-preview-ext">{extOf(file.name)}</span>
              <span className="muted small">Verrà convertita la prima pagina</span>
            </div>
          )}
          <div className="small">
            <div>{file.name}</div>
            <div className="muted">{formatBytes(file.size)}</div>
          </div>
        </div>
      )}
      {busy && (
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
          <div className="progress-bar" style={{ width: `${progress * 100}%` }} />
          <span className="progress-label">
            {progress < 1 ? `Caricamento ${Math.round(progress * 100)}%` : 'Elaborazione sul server…'}
          </span>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <div className="row" style={{ justifyContent: 'flex-start' }}>
        <button className="btn btn-primary" type="submit" disabled={busy || !file}>
          {plan ? 'Carica file' : 'Crea e carica'}
        </button>
        {onCancel && (
          <button className="btn" type="button" onClick={onCancel} disabled={busy}>
            Annulla
          </button>
        )}
      </div>
    </form>
  )
}

function extOf(name: string) {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toUpperCase() : 'FILE'
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
