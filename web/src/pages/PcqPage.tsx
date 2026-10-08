import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { PcqPreview } from '../api/types'
import { PCQ_FILE_ACCEPT, PCQ_FILE_MAX_BYTES, pcqFileError, previewPcqFile } from '../api/upload'
import { isManager, useAuth } from '../auth/useAuth'
import FileDropzone from '../components/FileDropzone'
import PcqDocumentView from '../components/PcqDocumentView'
import Icon from '../components/Icon'
import { formatBytes } from '../format'
import { pcqSummary as summary } from '../forms/pcqToSchema'
import { useProject } from '../hooks/useProject'

type Item = {
  id: number
  file: File
  status: 'queued' | 'reading' | 'done' | 'error'
  progress: number
  preview?: PcqPreview
  error?: string
}


function extension(name: string) {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i).toLowerCase() : ''
}

/**
 * Caricamento dei PCQ (Piano di Controllo Qualità) da ricreare nel cantiere: si
 * trascinano uno o più Word/PDF, il server li legge uno alla volta e la pagina
 * mostra cosa ha trovato (titoli, tabelle, testo); "Crea modulo" lo apre nell'editor dei moduli.
 */
export default function PcqPage() {
  const { projectId = '' } = useParams()
  const { user } = useAuth()
  const project = useProject(projectId)
  const [items, setItems] = useState<Item[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const navigate = useNavigate()
  const nextId = useRef(1)
  const queue = useRef<Item[]>([])
  const running = useRef(false)

  function patch(id: number, changes: Partial<Item>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...changes } : it)))
  }

  function add(files: File[]) {
    const added: Item[] = files.map((file) => {
      const error = pcqFileError(file)
      return { id: nextId.current++, file, status: error ? 'error' : 'queued', progress: 0, error }
    })
    if (!added.length) return
    setItems((prev) => [...prev, ...added])
    queue.current.push(...added.filter((it) => it.status === 'queued'))
    void pump()
  }

  // Un file alla volta: il server legge in ordine di arrivo, la pagina resta reattiva.
  async function pump() {
    if (running.current) return
    running.current = true
    for (let next = queue.current.shift(); next; next = queue.current.shift()) {
      const { id, file } = next
      patch(id, { status: 'reading' })
      try {
        const preview = await previewPcqFile(projectId, file, (progress) => patch(id, { progress }))
        patch(id, { status: 'done', preview, progress: 1 })
        setSelected((cur) => cur ?? id)
      } catch (e) {
        patch(id, { status: 'error', error: e instanceof Error ? e.message : 'Lettura fallita' })
      }
    }
    running.current = false
  }

  function remove(id: number) {
    queue.current = queue.current.filter((it) => it.id !== id)
    setItems((prev) => prev.filter((it) => it.id !== id || it.status === 'reading'))
    if (selected === id) setSelected(null)
  }

  const current = items.find((it) => it.id === selected && it.preview)
  const busy = items.some((it) => it.status === 'queued' || it.status === 'reading')

  return (
    <>
      <header className="topbar">
        <div>
          <div className="muted small">
            <Link to="/projects">Progetti</Link> / <Link to={`/projects/${projectId}/plans`}>{project?.name ?? '…'}</Link>
          </div>
          <h1>PCQ</h1>
        </div>
        {items.length > 0 && !busy && (
          <div className="topbar-actions">
            <button
              className="btn"
              onClick={() => {
                queue.current = []
                setItems([])
                setSelected(null)
              }}
            >
              Svuota elenco
            </button>
          </div>
        )}
      </header>
      <div className="content">
        {!isManager(user) ? (
          <div className="empty">Il caricamento dei PCQ è riservato ai responsabili.</div>
        ) : (
          <>
            <p className="muted small pcq-intro">
              Carica il Piano di Controllo Qualità del cantiere in Word (.docx) o PDF. L'app legge fasi, controlli e tabelle e te li mostra qui
              sotto; con "Crea modulo" il PCQ diventa un modulo da compilare (un esito per controllo), da rivedere nell'editor prima di salvarlo.
            </p>
            <FileDropzone
              accept={PCQ_FILE_ACCEPT}
              multiple
              title="Trascina qui i PCQ da riprodurre"
              hint={`Word (.docx) o PDF, anche più file insieme · max ${formatBytes(PCQ_FILE_MAX_BYTES)} ciascuno`}
              onFiles={add}
              testId="pcq-input"
            />

            {items.length > 0 && (
              <ul className="pcq-queue">
                {items.map((it) => (
                  <li key={it.id} className={`pcq-item is-${it.status}${it.id === selected ? ' is-selected' : ''}`}>
                    <span className={`pcq-kind kind-${extension(it.file.name).slice(1) || 'other'}`}>
                      {extension(it.file.name).slice(1).toUpperCase() || <Icon name="file" />}
                    </span>
                    <div className="pcq-item-main">
                      <div className="pcq-item-name" title={it.file.name}>
                        {it.file.name}
                      </div>
                      <div className="small muted">
                        {formatBytes(it.file.size)}
                        {it.status === 'queued' && ' · in coda'}
                        {it.status === 'reading' && (it.progress < 1 ? ` · caricamento ${Math.round(it.progress * 100)}%` : ' · lettura…')}
                        {it.status === 'done' && it.preview && ` · ${summary(it.preview)}`}
                        {it.status === 'error' && <span className="error-text"> · {it.error}</span>}
                      </div>
                      {it.status === 'reading' && (
                        <div className="pcq-bar">
                          <div style={{ width: `${Math.max(5, it.progress * 100)}%` }} />
                        </div>
                      )}
                    </div>
                    <div className="pcq-item-actions">
                      {it.status === 'done' && (
                        <>
                          <button type="button" className="btn small" onClick={() => setSelected(it.id)} disabled={it.id === selected}>
                            {it.id === selected ? 'Aperto' : 'Anteprima'}
                          </button>
                          <button type="button" className="btn small" onClick={() => navigate('/templates/new', { state: { pcq: it.preview } })}>
                            Crea modulo
                          </button>
                        </>
                      )}
                      {it.status !== 'reading' && (
                        <button type="button" className="btn btn-icon" aria-label={`Rimuovi ${it.file.name}`} onClick={() => remove(it.id)}>
                          <Icon name="x" />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {current?.preview && (
              <section className="card pcq-preview">
                <PcqDocumentView name={current.file.name} preview={current.preview} />
              </section>
            )}
          </>
        )}
      </div>
    </>
  )
}
