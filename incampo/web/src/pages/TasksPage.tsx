import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api, errorMessage } from '../api/client'
import type { Plan, TaskStatus, User } from '../api/types'
import type { components } from '../api/schema'
import { isManager, useAuth } from '../auth/useAuth'
import Loading from '../components/Loading'
import { TASK_STATUS_LABEL } from '../labels'
import { downloadCsv, today } from '../csv'
import { useToast } from '../components/useToast'
import { useProject } from '../hooks/useProject'
import Icon from '../components/Icon'
import { useLoad } from '../hooks/useLoad'
import { useLatestRequest } from '../hooks/useLatestRequest'

type TaskItem = components['schemas']['TaskListItem']
type TaskPage = components['schemas']['TaskPage']

const STATUSES: TaskStatus[] = ['open', 'assigned', 'resolved', 'verified']
// Specchio di TASK_TRANSITIONS lato server: il select mostra solo le mosse consentite.
const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  open: ['assigned'],
  assigned: ['resolved', 'open'],
  resolved: ['verified', 'open'],
  verified: [],
}
type SortKey = 'title' | 'status' | 'assigned_to' | 'due_date' | 'created_at' | 'plan_name'
const SORT_KEYS: SortKey[] = ['title', 'status', 'assigned_to', 'due_date', 'created_at', 'plan_name']
const PAGE_SIZE = 50

type Filters = {
  status: TaskStatus[]
  plan: string
  assignee: string
  mine: boolean
  overdue: boolean
  q: string
  sort: SortKey
  desc: boolean
  offset: number
}

/** Filtri, ricerca, ordinamento e pagina vivono nella query string: lettura... */
function readFilters(sp: URLSearchParams): Filters {
  const sortParam = sp.get('sort') as SortKey | null
  const sort = sortParam && SORT_KEYS.includes(sortParam) ? sortParam : 'created_at'
  return {
    status: sp.getAll('status').filter((s): s is TaskStatus => STATUSES.includes(s as TaskStatus)),
    plan: sp.get('plan') ?? '',
    assignee: sp.get('assignee') ?? '',
    mine: sp.get('mine') === '1',
    overdue: sp.get('overdue') === '1',
    q: sp.get('q') ?? '',
    sort,
    desc: sp.get('dir') ? sp.get('dir') === 'desc' : sort === 'created_at',
    offset: Math.max(0, Number(sp.get('offset')) || 0),
  }
}

/** ...e scrittura (solo i valori diversi dal default). */
function writeFilters(f: Filters): URLSearchParams {
  const q = new URLSearchParams()
  f.status.forEach((s) => q.append('status', s))
  if (f.plan) q.set('plan', f.plan)
  if (f.assignee) q.set('assignee', f.assignee)
  if (f.mine) q.set('mine', '1')
  if (f.overdue) q.set('overdue', '1')
  if (f.q) q.set('q', f.q)
  if (f.sort !== 'created_at' || !f.desc) {
    q.set('sort', f.sort)
    q.set('dir', f.desc ? 'desc' : 'asc')
  }
  if (f.offset) q.set('offset', String(f.offset))
  return q
}

const todayIso = () => new Date().toISOString().slice(0, 10)
const isOverdue = (t: TaskItem) => !!t.due_date && t.status !== 'verified' && t.due_date.slice(0, 10) < todayIso()

/**
 * Vista task del progetto: tabella paginata lato server (GET /tasks/page) con
 * filtri, ricerca testuale e ordinamento fatti dal backend, così regge anche
 * migliaia di task. Cambio stato/assegnatario/scadenza inline con PATCH, link al
 * pin sulla planimetria. Filtri, ricerca, ordinamento e pagina vivono nella query
 * string: `?mine=1` è la vista "i miei task".
 */
export default function TasksPage() {
  const { projectId = '' } = useParams()
  const { user } = useAuth()
  const toast = useToast()
  const project = useProject(projectId)
  const [sp, setSp] = useSearchParams()
  const [page, setPage] = useState<TaskPage | null>(null)
  const [loadedQuery, setLoadedQuery] = useState<string | null>(null)
  const [members, setMembers] = useState<User[]>([])
  const [plans, setPlans] = useState<Plan[]>([])

  const filters = readFilters(sp)
  const [qInput, setQInput] = useState(filters.q)
  const searchTimer = useRef<number | undefined>(undefined)

  /**
   * Cambia filtri/ordinamento (prima pagina salvo offset esplicito). Parte dalla
   * query string CORRENTE (aggiornamento funzionale), non da quella del render:
   * un timer o un click "in ritardo" non può riportare indietro filtri già cambiati.
   */
  function patchFilters(next: Partial<Filters>) {
    setSp((prev) => writeFilters({ ...readFilters(prev), offset: 0, ...next }), { replace: true })
  }

  /** Ricerca: la query string (e quindi il fetch) segue la casella dopo una pausa di battitura. */
  function onSearch(value: string) {
    setQInput(value)
    window.clearTimeout(searchTimer.current)
    searchTimer.current = window.setTimeout(() => patchFilters({ q: value.trim() }), 300)
  }

  const query = sp.toString()
  const begin = useLatestRequest()
  const load = useCallback(async () => {
    const isLatest = begin()
    const f = readFilters(new URLSearchParams(query))
    const { data, error } = await api.GET('/projects/{project_id}/tasks/page', {
      params: {
        path: { project_id: projectId },
        query: {
          status: f.status,
          plan_id: f.plan || undefined,
          assigned_to: (f.mine ? user?.id : f.assignee) || undefined,
          overdue: f.overdue || undefined,
          q: f.q || undefined,
          sort: f.sort,
          desc: f.desc,
          limit: PAGE_SIZE,
          offset: f.offset,
        },
      },
    })
    if (!isLatest()) return // risposta superata da filtri più recenti
    setLoadedQuery(query)
    if (error) return toast.error(errorMessage(error))
    setPage(data ?? null)
  }, [projectId, query, user?.id, toast, begin])

  useLoad(load)

  useEffect(() => {
    api.GET('/projects/{project_id}/members', { params: { path: { project_id: projectId } } }).then(({ data }) => data && setMembers(data))
    api.GET('/projects/{project_id}/plans', { params: { path: { project_id: projectId } } }).then(({ data }) => data && setPlans(data))
  }, [projectId])

  const [exporting, setExporting] = useState(false)

  /** Tutti i task del filtro corrente (non solo la pagina), a blocchi da 200, fino a 5000. */
  async function exportCsv() {
    setExporting(true)
    const f = readFilters(new URLSearchParams(query))
    const rows: TaskItem[] = []
    for (let offset = 0; offset < 5000; offset += 200) {
      const { data, error } = await api.GET('/projects/{project_id}/tasks/page', {
        params: {
          path: { project_id: projectId },
          query: { status: f.status, plan_id: f.plan || undefined, assigned_to: (f.mine ? user?.id : f.assignee) || undefined,
            overdue: f.overdue || undefined, q: f.q || undefined, sort: f.sort, desc: f.desc, limit: 200, offset },
        },
      })
      if (error || !data) {
        setExporting(false)
        return toast.error(errorMessage(error))
      }
      rows.push(...data.items)
      if (rows.length >= data.total) break
    }
    const name = (id?: string | null) => (id ? (members.find((m) => m.id === id)?.name ?? '') : '')
    const place = (t: TaskItem) => (t.pin_id ? `${t.plan_name}${t.pin_label ? ` · ${t.pin_label}` : ''}` : t.wbs_label ? `WBS · ${t.wbs_label}` : 'Cantiere (generale)')
    const day = (iso?: string | null) => (iso ? new Date(iso.endsWith('Z') ? iso : iso + 'Z').toLocaleDateString('it-IT') : '')
    downloadCsv(
      `task-${today()}.csv`,
      ['titolo', 'descrizione', 'stato', 'assegnato_a', 'scadenza', 'dove', 'creato_da', 'creato_il', 'risolto_il'],
      rows.map((t) => [t.title, t.description, TASK_STATUS_LABEL[t.status as TaskStatus], name(t.assigned_to), day(t.due_date), place(t), name(t.created_by), day(t.created_at), day(t.resolved_at)]),
    )
    setExporting(false)
  }

  async function patch(task: TaskItem, body: components['schemas']['TaskUpdate']) {
    const prev = page
    const replace = (fn: (t: TaskItem) => TaskItem) => setPage((p) => p && { ...p, items: p.items.map((t) => (t.id === task.id ? fn(t) : t)) })
    // ottimistico: la riga cambia subito, si torna indietro solo su errore
    replace((t) => ({ ...t, ...body, status: body.status ?? t.status }))
    const { data, error } = await api.PATCH('/tasks/{task_id}', { params: { path: { task_id: task.id } }, body })
    if (error || !data) {
      setPage(prev)
      return toast.error(errorMessage(error))
    }
    replace((t) => ({ ...t, ...data }))
    if (body.status || 'assigned_to' in body) load() // conteggi per stato aggiornati
  }

  function toggleSort(key: SortKey) {
    patchFilters(filters.sort === key ? { desc: !filters.desc } : { sort: key, desc: key === 'created_at' })
  }
  const th = (key: SortKey, label: string) => (
    <th aria-sort={filters.sort === key ? (filters.desc ? 'descending' : 'ascending') : 'none'}>
      <button type="button" className="th-sort" onClick={() => toggleSort(key)}>
        {label}
        {filters.sort === key && <span aria-hidden="true">{filters.desc ? ' ▼' : ' ▲'}</span>}
      </button>
    </th>
  )

  // righe della query precedente finché non arriva la risposta a quella corrente
  const stale = loadedQuery !== query
  const projectTotal = page ? STATUSES.reduce((n, s) => n + (page.counts[s] ?? 0), 0) : 0
  const filtering = filters.status.length > 0 || !!filters.plan || !!filters.assignee || filters.mine || filters.overdue || !!filters.q
  const tasks = page?.items ?? []
  const from = page && page.total ? page.offset + 1 : 0
  const to = page ? page.offset + tasks.length : 0

  return (
    <>
      <header className="topbar">
        <div>
          <div className="muted small">
            <Link to="/projects">Progetti</Link> / <Link to={`/projects/${projectId}/plans`}>{project?.name ?? '…'}</Link>
          </div>
          <h1>{filters.mine ? 'I miei task' : 'Task'}</h1>
        </div>
        <div className="topbar-actions">
          <div className="legend">
            {STATUSES.map((s) => (
              <span key={s} className="legend-item" title={TASK_STATUS_LABEL[s]}>
                <span className={`legend-dot pin-${s}`} />
                {page?.counts[s] ?? 0}
              </span>
            ))}
          </div>
          <button type="button" className="btn" onClick={exportCsv} disabled={exporting || !page?.total}>
            {exporting ? 'Esporto…' : 'Esporta CSV'}
          </button>
          <button type="button" className={`btn ${filters.mine ? 'btn-primary' : ''}`} onClick={() => patchFilters({ mine: !filters.mine })}>
            {filters.mine ? 'Tutti i task' : 'I miei task'}
          </button>
        </div>
      </header>
      <div className="filters" role="group" aria-label="Filtri task">
        <div className="filter-group">
          <label className="filter-label" htmlFor="tf-q">
            Cerca
          </label>
          <input id="tf-q" type="search" placeholder="Titolo, descrizione, pin…" value={qInput} onChange={(e) => onSearch(e.target.value)} />
        </div>
        <div className="filter-group">
          <span className="filter-label">Stato</span>
          <div className="chips">
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                className={`chip status-${s}${filters.status.includes(s) ? ' chip-on' : ''}`}
                aria-pressed={filters.status.includes(s)}
                onClick={() =>
                  patchFilters({ status: filters.status.includes(s) ? filters.status.filter((x) => x !== s) : [...filters.status, s] })
                }
              >
                {TASK_STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
        <div className="filter-group">
          <label className="filter-label" htmlFor="tf-plan">
            Planimetria
          </label>
          <select id="tf-plan" value={filters.plan} onChange={(e) => patchFilters({ plan: e.target.value })}>
            <option value="">Tutte</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <label className="filter-label" htmlFor="tf-assignee">
            Assegnato a
          </label>
          <select id="tf-assignee" value={filters.assignee} onChange={(e) => patchFilters({ assignee: e.target.value, mine: false })}>
            <option value="">Chiunque</option>
            {members.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <span className="filter-label">Scadenza</span>
          <button type="button" className={`chip status-open${filters.overdue ? ' chip-on' : ''}`} aria-pressed={filters.overdue} onClick={() => patchFilters({ overdue: !filters.overdue })}>
            Scaduti
          </button>
        </div>
        <div className="filter-group filter-summary">
          <span className="muted small">{page === null || stale ? '…' : filtering ? `${page.total} di ${projectTotal} task` : `${projectTotal} task`}</span>
          {filtering && (
            <button
              type="button"
              className="btn small"
              onClick={() => {
                window.clearTimeout(searchTimer.current)
                setQInput('')
                setSp(new URLSearchParams(), { replace: true })
              }}
            >
              Azzera
            </button>
          )}
        </div>
      </div>
      <div className="content">
        {page === null ? (
          <Loading />
        ) : tasks.length === 0 ? (
          <div className="empty">{projectTotal === 0 ? 'Nessun task nel progetto.' : 'Nessun task con questi filtri.'}</div>
        ) : (
          <>
            <div className={`table-wrap${stale ? ' is-loading' : ''}`} aria-busy={stale}>
              <table className="table tasks-table">
                <thead>
                  <tr>
                    {th('title', 'Task')}
                    {th('status', 'Stato')}
                    {th('assigned_to', 'Assegnato a')}
                    {th('due_date', 'Scadenza')}
                    {th('plan_name', 'Posizione')}
                    {th('created_at', 'Creato')}
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((t) => (
                    <tr key={t.id} className={isOverdue(t) ? 'row-overdue' : undefined}>
                      <td>
                        <strong>{t.title}</strong>
                        {t.description && <div className="muted small clamp">{t.description}</div>}
                      </td>
                      <td>
                        <select
                          className={`status-select status-${t.status}`}
                          aria-label={`Stato di ${t.title}`}
                          value={t.status}
                          onChange={(e) => patch(t, { status: e.target.value })}
                          disabled={!TRANSITIONS[t.status as TaskStatus].length}
                        >
                          <option value={t.status}>{TASK_STATUS_LABEL[t.status as TaskStatus]}</option>
                          {TRANSITIONS[t.status as TaskStatus]
                            .filter((s) => s !== 'verified' || isManager(user))
                            .filter((s) => s !== 'assigned' || t.assigned_to)
                            .map((s) => (
                              <option key={s} value={s}>
                                → {TASK_STATUS_LABEL[s]}
                              </option>
                            ))}
                        </select>
                      </td>
                      <td>
                        <select aria-label={`Assegnatario di ${t.title}`} value={t.assigned_to ?? ''} onChange={(e) => patch(t, { assigned_to: e.target.value || null })}>
                          <option value="">—</option>
                          {members.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="date"
                          aria-label={`Scadenza di ${t.title}`}
                          value={t.due_date ? t.due_date.slice(0, 10) : ''}
                          onChange={(e) => patch(t, { due_date: e.target.value ? `${e.target.value}T00:00:00` : null })}
                        />
                        {isOverdue(t) && <span className="badge status-open">scaduto</span>}
                      </td>
                      <td>
                        {t.pin_id ? (
                          <Link to={`/projects/${projectId}/plans/${t.plan_id}?pin=${t.pin_id}`} title="Vedi sulla planimetria">
                            <Icon name="map-pin" /> {t.plan_name}
                            {t.pin_label && <span className="muted"> · {t.pin_label}</span>}
                          </Link>
                        ) : t.wbs_node_id ? (
                          <Link to={`/projects/${projectId}/wbs?node=${t.wbs_node_id}`} title="Vedi la voce WBS">
                            <Icon name="tree" /> WBS · {t.wbs_label}
                          </Link>
                        ) : (
                          <span className="muted">Cantiere (generale)</span>
                        )}
                      </td>
                      <td className="muted small nowrap">{new Date(t.created_at + 'Z').toLocaleDateString('it-IT')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {page.total > PAGE_SIZE && (
              <nav className="pager" aria-label="Pagine dei task">
                <button type="button" className="btn small" disabled={page.offset === 0} onClick={() => patchFilters({ offset: Math.max(0, page.offset - PAGE_SIZE) })}>
                  ← Precedenti
                </button>
                <span className="muted small">
                  {from}–{to} di {page.total}
                </span>
                <button type="button" className="btn small" disabled={to >= page.total} onClick={() => patchFilters({ offset: page.offset + PAGE_SIZE })}>
                  Successivi →
                </button>
              </nav>
            )}
          </>
        )}
      </div>
    </>
  )
}
