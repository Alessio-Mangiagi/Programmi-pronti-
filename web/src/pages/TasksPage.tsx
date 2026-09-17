import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api, errorMessage } from '../api/client'
import type { Plan, TaskStatus, User } from '../api/types'
import type { components } from '../api/schema'
import { isManager, useAuth } from '../auth/AuthContext'
import Loading from '../components/Loading'
import { TASK_STATUS_LABEL } from '../components/PinPanel'
import { useToast } from '../components/Toast'
import { useProject } from '../hooks/useProject'

type TaskItem = components['schemas']['TaskListItem']

const STATUSES: TaskStatus[] = ['open', 'assigned', 'resolved', 'verified']
// Specchio di TASK_TRANSITIONS lato server: il select mostra solo le mosse consentite.
const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  open: ['assigned'],
  assigned: ['resolved', 'open'],
  resolved: ['verified', 'open'],
  verified: [],
}
type SortKey = 'title' | 'status' | 'assigned_to' | 'due_date' | 'created_at' | 'plan_name'
const STATUS_ORDER: Record<TaskStatus, number> = { open: 0, assigned: 1, resolved: 2, verified: 3 }

const todayIso = () => new Date().toISOString().slice(0, 10)
const isOverdue = (t: TaskItem) => !!t.due_date && t.status !== 'verified' && t.due_date.slice(0, 10) < todayIso()

/**
 * Vista task del progetto: tutti i task in una tabella (filtri e ordinamento
 * client-side: per l'MVP il volume per progetto è di centinaia, non milioni),
 * cambio stato/assegnatario/scadenza inline con PATCH, link al pin sulla planimetria.
 * I filtri vivono nella query string: `?mine=1` è la vista "i miei task".
 */
export default function TasksPage() {
  const { projectId = '' } = useParams()
  const { user } = useAuth()
  const toast = useToast()
  const project = useProject(projectId)
  const [sp, setSp] = useSearchParams()
  const [tasks, setTasks] = useState<TaskItem[] | null>(null)
  const [members, setMembers] = useState<User[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'created_at', dir: -1 })

  const filters = {
    status: sp.getAll('status').filter((s): s is TaskStatus => STATUSES.includes(s as TaskStatus)),
    plan: sp.get('plan') ?? '',
    assignee: sp.get('assignee') ?? '',
    mine: sp.get('mine') === '1',
    overdue: sp.get('overdue') === '1',
  }
  function patchFilters(next: Partial<typeof filters>) {
    const f = { ...filters, ...next }
    const q = new URLSearchParams()
    f.status.forEach((s) => q.append('status', s))
    if (f.plan) q.set('plan', f.plan)
    if (f.assignee) q.set('assignee', f.assignee)
    if (f.mine) q.set('mine', '1')
    if (f.overdue) q.set('overdue', '1')
    setSp(q, { replace: true })
  }

  const load = useCallback(async () => {
    const { data, error } = await api.GET('/projects/{project_id}/tasks', { params: { path: { project_id: projectId } } })
    if (error) return toast.error(errorMessage(error))
    setTasks(data ?? [])
  }, [projectId, toast])

  useEffect(() => {
    load()
    api.GET('/projects/{project_id}/members', { params: { path: { project_id: projectId } } }).then(({ data }) => data && setMembers(data))
    api.GET('/projects/{project_id}/plans', { params: { path: { project_id: projectId } } }).then(({ data }) => data && setPlans(data))
  }, [projectId, load])

  const userName = (id: string | null | undefined) => (id ? (members.find((m) => m.id === id)?.name ?? '…') : '—')

  const visible = useMemo(() => {
    if (!tasks) return []
    const list = tasks.filter(
      (t) =>
        (!filters.status.length || filters.status.includes(t.status as TaskStatus)) &&
        (!filters.plan || t.plan_id === filters.plan) &&
        (!filters.assignee || t.assigned_to === filters.assignee) &&
        (!filters.mine || t.assigned_to === user?.id) &&
        (!filters.overdue || isOverdue(t)),
    )
    const cmp = (a: TaskItem, b: TaskItem) => {
      const k = sort.key
      if (k === 'status') return STATUS_ORDER[a.status as TaskStatus] - STATUS_ORDER[b.status as TaskStatus]
      if (k === 'assigned_to') return userName(a.assigned_to).localeCompare(userName(b.assigned_to))
      const av = (a[k] ?? '') as string
      const bv = (b[k] ?? '') as string
      if (k === 'due_date' && av !== bv && (!av || !bv)) return av ? -1 : 1 // senza scadenza in fondo
      return av.localeCompare(bv)
    }
    return [...list].sort((a, b) => cmp(a, b) * sort.dir)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, sp, sort, members, user?.id])

  async function patch(task: TaskItem, body: components['schemas']['TaskUpdate']) {
    const prev = tasks
    // ottimistico: la riga cambia subito, si torna indietro solo su errore
    setTasks((list) => list && list.map((t) => (t.id === task.id ? { ...t, ...body, status: body.status ?? t.status } : t)))
    const { data, error } = await api.PATCH('/tasks/{task_id}', { params: { path: { task_id: task.id } }, body })
    if (error || !data) {
      setTasks(prev)
      return toast.error(errorMessage(error))
    }
    setTasks((list) => list && list.map((t) => (t.id === task.id ? { ...t, ...data } : t)))
  }

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: key === 'created_at' ? -1 : 1 }))
  }
  const th = (key: SortKey, label: string) => (
    <th aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="th-sort" onClick={() => toggleSort(key)}>
        {label}
        {sort.key === key && <span aria-hidden="true">{sort.dir === 1 ? ' ▲' : ' ▼'}</span>}
      </button>
    </th>
  )

  const counts = STATUSES.map((s) => [s, tasks?.filter((t) => t.status === s).length ?? 0] as const)
  const filtering = filters.status.length > 0 || !!filters.plan || !!filters.assignee || filters.mine || filters.overdue

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
            {counts.map(([s, n]) => (
              <span key={s} className="legend-item" title={TASK_STATUS_LABEL[s]}>
                <span className={`legend-dot pin-${s}`} />
                {n}
              </span>
            ))}
          </div>
          <button type="button" className={`btn ${filters.mine ? 'btn-primary' : ''}`} onClick={() => patchFilters({ mine: !filters.mine })}>
            {filters.mine ? 'Tutti i task' : 'I miei task'}
          </button>
        </div>
      </header>
      <div className="filters" role="group" aria-label="Filtri task">
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
          <span className="muted small">{tasks === null ? '…' : filtering ? `${visible.length} di ${tasks.length} task` : `${tasks.length} task`}</span>
          {filtering && (
            <button type="button" className="btn small" onClick={() => setSp(new URLSearchParams(), { replace: true })}>
              Azzera
            </button>
          )}
        </div>
      </div>
      <div className="content">
        {tasks === null ? (
          <Loading />
        ) : visible.length === 0 ? (
          <div className="empty">{tasks.length === 0 ? 'Nessun task nel progetto.' : 'Nessun task con questi filtri.'}</div>
        ) : (
          <div className="table-wrap">
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
                {visible.map((t) => (
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
                      <Link to={`/projects/${projectId}/plans/${t.plan_id}?pin=${t.pin_id}`} title="Vedi sulla planimetria">
                        📍 {t.plan_name}
                        {t.pin_label && <span className="muted"> · {t.pin_label}</span>}
                      </Link>
                    </td>
                    <td className="muted small nowrap">{new Date(t.created_at + 'Z').toLocaleDateString('it-IT')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
