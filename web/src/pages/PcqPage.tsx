import { useRef, useState, type DragEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { PcqPreview } from '../api/types'
import { PCQ_FILE_ACCEPT, PCQ_FILE_MAX_BYTES, previewPcqFile } from '../api/upload'
import { isManager, useAuth } from '../auth/useAuth'
import Icon from '../components/Icon'
import { formatBytes } from '../format'
import { useProject } from '../hooks/useProject'

type Item = {
  id: number
  file: File
  status: 'queued' | 'reading' | 'done' | 'error'
  progress: number
  preview?: PcqPreview
  error?: string
}

const EXTENSIONS = ['.docx', '.pdf']
const PDF_LINES_SHOWN = 300

function extension(name: string) {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i).toLowerCase() : ''
}

/** Errore lato client (formato/dimensione) prima di mandare il file al server. */
function precheck(f: File): string | undefined {
  const ext = extension(f.name)
  if (ext === '.doc') return 'Formato .doc non supportato: salva come .docx'
  if (!EXTENSIONS.includes(ext)) return 'Formato non supportato: usa Word (.docx) o PDF'
  if (f.size > PCQ_FILE_MAX_BYTES) return `File troppo grande (max ${formatBytes(PCQ_FILE_MAX_BYTES)})`
}

function summary(p: PcqPreview) {
  if (p.kind === 'pdf') return `${p.pages ?? 0} pagin${p.pages === 1 ? 'a' : 'e'} · ${p.lines.length} righe di testo`
  const rows = p.tables.reduce((n, t) => n + t.rows.length, 0)
  return `${p.tables.length} tabell${p.tables.length === 1 ? 'a' : 'e'} · ${rows} righe · ${p.headings.length} titoli`
}

/**
 * Caricamento dei PCQ (Piano di Controllo Qualità) da ricreare nel cantiere: si
 * trascinano uno o più Word/PDF, il server li legge uno alla volta e la pagina
 * mostra cosa ha trovato (titoli, tabelle, testo). Per ora solo anteprima.
 */
export default function PcqPage() {
  const { projectId = '' } = useParams()
  const { user } = useAuth()
  const project = useProject(projectId)
  const [items, setItems] = useState<Item[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const nextId = useRef(1)
  const inputRef = useRef<HTMLInputElement>(null)
  const queue = useRef<Item[]>([])
  const running = useRef(false)

  function patch(id: number, changes: Partial<Item>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...changes } : it)))
  }

  function add(files: FileList | File[]) {
    const added: Item[] = Array.from(files).map((file) => {
      const error = precheck(file)
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

  function onDragEnter(e: DragEvent) {
    e.preventDefault()
    dragDepth.current += 1
    setDragging(true)
  }

  function onDragLeave(e: DragEvent) {
    e.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    add(e.dataTransfer.files)
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
              sotto. Per ora è solo un'anteprima: la creazione automatica di WBS e moduli si attiva quando la mappatura sarà tarata sul primo PCQ
              reale.
            </p>
            <div
              className={`pcq-drop${dragging ? ' is-dragging' : ''}`}
              onDragEnter={onDragEnter}
              onDragOver={(e) => e.preventDefault()}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
            >
              <Icon name="upload" className="pcq-drop-icon" />
              <p className="pcq-drop-title">{dragging ? 'Rilascia per caricare' : 'Trascina qui i PCQ da riprodurre'}</p>
              <p className="muted small">Word (.docx) o PDF, anche più file insieme · max {formatBytes(PCQ_FILE_MAX_BYTES)} ciascuno</p>
              <button type="button" className="btn btn-primary" onClick={() => inputRef.current?.click()}>
                Scegli i file
              </button>
              <input
                ref={inputRef}
                type="file"
                accept={PCQ_FILE_ACCEPT}
                multiple
                hidden
                data-testid="pcq-input"
                onChange={(e) => {
                  if (e.target.files) add(e.target.files)
                  e.target.value = ''
                }}
              />
            </div>

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
                        <button type="button" className="btn small" onClick={() => setSelected(it.id)} disabled={it.id === selected}>
                          {it.id === selected ? 'Aperto' : 'Anteprima'}
                        </button>
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

            {current?.preview && <PcqPreviewPanel name={current.file.name} preview={current.preview} />}
          </>
        )}
      </div>
    </>
  )
}

function PcqPreviewPanel({ name, preview }: { name: string; preview: PcqPreview }) {
  const [allLines, setAllLines] = useState(false)
  const lines = allLines ? preview.lines : preview.lines.slice(0, PDF_LINES_SHOWN)
  return (
    <section className="card pcq-preview">
      <h2>{name}</h2>
      <p className="muted small">{summary(preview)}</p>
      {preview.warnings.map((w) => (
        <p key={w} className="pcq-warning small">
          {w}
        </p>
      ))}

      {preview.headings.length > 0 && (
        <>
          <h3>Struttura</h3>
          <ul className="pcq-headings">
            {preview.headings.map((h, i) => (
              <li key={i} style={{ paddingLeft: `${(h.length - h.trimStart().length) * 0.6}rem`, fontWeight: h.startsWith(' ') ? undefined : 600 }}>
                {h.trim()}
              </li>
            ))}
          </ul>
        </>
      )}

      {preview.tables.map((t) => {
        const [head, ...body] = t.rows
        return (
          <div key={t.index} className="pcq-table">
            <h3>
              Tabella {t.index}
              {t.title && <span className="muted"> · {t.title}</span>}
            </h3>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    {head.map((c, i) => (
                      <th key={i}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {body.map((r, i) => (
                    <tr key={i}>
                      {r.map((c, j) => (
                        <td key={j}>{c}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}

      {preview.kind === 'pdf' && preview.lines.length > 0 && (
        <>
          <h3>Testo</h3>
          <ol className="pcq-lines">
            {lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ol>
          {preview.lines.length > PDF_LINES_SHOWN && (
            <button type="button" className="link-btn" onClick={() => setAllLines((v) => !v)}>
              {allLines ? 'Mostra meno' : `Mostra tutte le ${preview.lines.length} righe`}
            </button>
          )}
        </>
      )}
    </section>
  )
}
