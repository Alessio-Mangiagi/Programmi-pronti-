// "><(((º> sabusabu <º)))><"
import { useEffect, useState, type FormEvent } from 'react'
import { api, errorMessage } from '../api/client'
import type { Plan } from '../api/types'
import { PLAN_FILE_ACCEPT, PLAN_FILE_MAX_BYTES, uploadPlanFile } from '../api/upload'
import { formatBytes } from '../format'
type Props = {
  projectId: string
  /** Se presente si carica solo il file su questa planimetria (niente campo nome). */
  plan?: Plan
  onDone: (plan: Plan) => void
  onCancel?: () => void
}

type DocSkyTower = { id: string; identifier: string; title: string; revision_id: string; revision_code?: string; filename?: string; updated_at?: string; url?: string }

/**
 * Nuova planimetria (nome + file) o sostituzione del file di una esistente.
 * Flusso: POST /plans (se serve) → POST /plans/{id}/file con barra di avanzamento.
 * Anteprima locale per le immagini; per i PDF solo nome e dimensione (la conversione
 * in PNG la fa il server).
 * Per una planimetria nuova si può invece scegliere una tavola PUBBLICATA su SkyTower
 * (stessa commessa): la scarica il server (POST /plans/da-skytower).
 */
export default function PlanUploadForm({ projectId, plan, onDone, onCancel }: Props) {
  const [name, setName] = useState(plan?.name ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [origine, setOrigine] = useState<'file' | 'skytower'>('file')
  const [docs, setDocs] = useState<DocSkyTower[] | null>(null)
  const [docsErrore, setDocsErrore] = useState<string | null>(null)
  const [filtro, setFiltro] = useState('')
  const [scelto, setScelto] = useState<DocSkyTower | null>(null)

  // Revoca l'object URL dell'anteprima quando cambia o il form smonta.
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])

  // Elenco dei documenti pubblicati su SkyTower, caricato alla prima apertura della scheda.
  useEffect(() => {
    if (origine !== 'skytower' || docs !== null || docsErrore) return
    api.GET('/projects/{project_id}/skytower/documenti', { params: { path: { project_id: projectId } } }).then(({ data, error, response }) => {
      if (error || !data) setDocsErrore(response?.status === 409 ? 'Il cantiere non è collegato a una commessa: scegline una dalla barra in alto.' : errorMessage(error, 'SkyTower non raggiungibile'))
      else setDocs(((data as { items?: DocSkyTower[] }).items ?? []) as DocSkyTower[])
    })
  }, [origine, docs, docsErrore, projectId])

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
    setError(null)
    if (origine === 'skytower' && !plan) {
      if (!scelto) return setError('Scegli una tavola di SkyTower')
      setProgress(0.5)
      const { data, error } = await api.POST('/plans/da-skytower', { body: { project_id: projectId, revision_id: scelto.revision_id, name: name.trim() || scelto.title } })
      setProgress(null)
      if (error || !data) return setError(errorMessage(error, 'SkyTower non raggiungibile'))
      return onDone(data)
    }
    if (!file) return setError('Scegli un file')
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
  const docsFiltrati = (docs ?? []).filter((d) => !filtro || `${d.title} ${d.identifier}`.toLowerCase().includes(filtro.toLowerCase()))

  return (
    <form className="card upload-form" onSubmit={onSubmit}>
      <h2>{plan ? `File per "${plan.name}"` : 'Nuova planimetria'}</h2>
      {!plan && (
        <div className="origine-toggle" role="tablist" aria-label="Origine della planimetria">
          <button type="button" role="tab" aria-selected={origine === 'file'} className={`btn small${origine === 'file' ? ' btn-primary' : ''}`} onClick={() => setOrigine('file')} disabled={busy}>
            Dal computer
          </button>
          <button type="button" role="tab" aria-selected={origine === 'skytower'} className={`btn small${origine === 'skytower' ? ' btn-primary' : ''}`} onClick={() => setOrigine('skytower')} disabled={busy}>
            Da SkyTower (tavole pubblicate)
          </button>
        </div>
      )}
      {!plan && (
        <div className="field">
          <label htmlFor="plan-name">Nome</label>
          <input
            id="plan-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={origine === 'skytower' && scelto ? scelto.title : 'es. Piano terra'}
            required={origine === 'file'}
            autoFocus
            disabled={busy}
          />
        </div>
      )}
      {origine === 'skytower' && !plan ? (
        <div className="field">
          <label htmlFor="sky-filtro">Tavola pubblicata su SkyTower</label>
          {docsErrore ? (
            <p className="muted">{docsErrore}</p>
          ) : docs === null ? (
            <p className="muted small">Carico l’elenco…</p>
          ) : docs.length === 0 ? (
            <p className="muted">Nessun documento pubblicato per questa commessa su SkyTower.</p>
          ) : (
            <>
              <input id="sky-filtro" value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Filtra per titolo o codice…" disabled={busy} />
              <ul className="sky-elenco">
                {docsFiltrati.map((d) => (
                  <li key={d.id}>
                    <label className={scelto?.id === d.id ? 'scelto' : ''}>
                      <input type="radio" name="sky-doc" checked={scelto?.id === d.id} onChange={() => { setScelto(d); if (!name) setName(d.title) }} disabled={busy} />
                      <span>
                        <b>{d.title}</b>
                        <span className="muted small"> {d.identifier}{d.revision_code ? ` · ${d.revision_code}` : ''}{d.filename ? ` · ${d.filename}` : ''}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <p className="muted small">Si usa l’ultima revisione pubblicata; PDF e immagini (la prima pagina del PDF diventa l’immagine).</p>
            </>
          )}
        </div>
      ) : (
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
      )}
      {file && origine === 'file' && (
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
            {origine === 'skytower' ? 'Scarico la tavola da SkyTower…' : progress < 1 ? `Caricamento ${Math.round(progress * 100)}%` : 'Elaborazione sul server…'}
          </span>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <div className="row" style={{ justifyContent: 'flex-start' }}>
        <button className="btn btn-primary" type="submit" disabled={busy || (origine === 'skytower' && !plan ? !scelto : !file)}>
          {plan ? 'Carica file' : origine === 'skytower' ? 'Crea da SkyTower' : 'Crea e carica'}
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
