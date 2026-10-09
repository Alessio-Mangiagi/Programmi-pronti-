import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api, errorMessage } from '../api/client'
import type { components } from '../api/schema'
import type { Plan, User } from '../api/types'
import Loading from '../components/Loading'
import { TASK_STATUS_LABEL } from '../labels'
import { useToast } from '../components/useToast'
import { useProject } from '../hooks/useProject'
import { useLoad } from '../hooks/useLoad'

type Stats = components['schemas']['StatsOut']

// Colori: stato = palette di stato del prodotto (barre etichettate sull'asse, mai colore da solo);
// serie del trend = blu/verde Cosedil validati (scripts/validate_palette.js: ALL CHECKS PASS).
const STATUS_COLOR: Record<string, string> = { open: '#c0392b', assigned: '#b8730a', resolved: '#3f8f55', verified: '#6b7075' }
const SERIES = { created: '#1477b8', resolved: '#3f8f55' }
const MONO = '#1477b8'
const INK = { grid: '#e5e7eb', tick: '#434549', label: '#212326', cursor: '#f2f3f5' }

const fmtDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`

/**
 * Dashboard di progetto: 3 card + 4 grafici (Recharts) da GET /projects/{id}/stats.
 * Filtri (periodo, planimetria, assegnatario) in query string; ogni grafico è
 * cliccabile e porta alla vista task già filtrata.
 */
export default function DashboardPage() {
  const { projectId = '' } = useParams()
  const project = useProject(projectId)
  const toast = useToast()
  const navigate = useNavigate()
  const [sp, setSp] = useSearchParams()
  const [stats, setStats] = useState<Stats | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [members, setMembers] = useState<User[]>([])
  const [showTable, setShowTable] = useState(false)

  const filters = { from: sp.get('from') ?? '', to: sp.get('to') ?? '', plan: sp.get('plan') ?? '', assignee: sp.get('assignee') ?? '', days: sp.get('days') ?? '30' }
  const setFilter = (patch: Partial<typeof filters>) => {
    const next = { ...filters, ...patch }
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(next)) if (v && !(k === 'days' && v === '30')) q.set(k, v)
    setSp(q, { replace: true })
  }

  const load = useCallback(async () => {
    const { data, error } = await api.GET('/projects/{project_id}/stats', {
      params: {
        path: { project_id: projectId },
        query: {
          date_from: filters.from || undefined,
          date_to: filters.to || undefined,
          plan_id: filters.plan || undefined,
          assigned_to: filters.assignee || undefined,
          days: Number(filters.days) || 30,
        },
      },
    })
    if (error) return toast.error(errorMessage(error))
    setStats(data ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, sp, toast])

  useLoad(load)
  useEffect(() => {
    api.GET('/projects/{project_id}/plans', { params: { path: { project_id: projectId } } }).then(({ data }) => data && setPlans(data))
    api.GET('/projects/{project_id}/members', { params: { path: { project_id: projectId } } }).then(({ data }) => data && setMembers(data))
  }, [projectId])

  const statusData = useMemo(
    () => (stats ? (['open', 'assigned', 'resolved', 'verified'] as const).map((s) => ({ status: s, label: TASK_STATUS_LABEL[s], n: stats.tasks_by_status[s] ?? 0 })) : []),
    [stats],
  )
  const openByPlan = useMemo(() => (stats ? [...stats.open_by_plan].sort((a, b) => (b.open as number) - (a.open as number)) : []), [stats])
  const byTemplate = useMemo(() => stats?.submissions_by_template ?? [], [stats])
  const openTotal = (stats?.tasks_by_status.open ?? 0) + (stats?.tasks_by_status.assigned ?? 0)

  // Link alla vista task con i filtri della dashboard + quelli del click
  const tasksUrl = (extra: Record<string, string | string[]>) => {
    const q = new URLSearchParams()
    if (filters.plan) q.set('plan', filters.plan)
    if (filters.assignee) q.set('assignee', filters.assignee)
    for (const [k, v] of Object.entries(extra)) (Array.isArray(v) ? v : [v]).forEach((x) => q.append(k, x))
    return `/projects/${projectId}/tasks?${q}`
  }

  return (
    <>
      <header className="topbar">
        <div>
          <div className="muted small">
            <Link to="/projects">Progetti</Link> / <Link to={`/projects/${projectId}/plans`}>{project?.name ?? '…'}</Link>
          </div>
          <h1>Dashboard</h1>
        </div>
        <div className="topbar-actions">
          <button type="button" className="btn small" onClick={() => setShowTable((v) => !v)}>
            {showTable ? 'Grafici' : 'Tabella'}
          </button>
          <span className="muted small">{stats ? `aggiornato ${new Date(stats.generated_at + 'Z').toLocaleTimeString('it-IT', { timeStyle: 'short' })}` : ''}</span>
        </div>
      </header>
      <div className="filters" role="group" aria-label="Filtri dashboard">
        <div className="filter-group">
          <span className="filter-label">Periodo (creazione)</span>
          <div className="filter-dates">
            <input type="date" aria-label="Dal" value={filters.from} onChange={(e) => setFilter({ from: e.target.value })} />
            <span className="muted small">–</span>
            <input type="date" aria-label="Al" value={filters.to} onChange={(e) => setFilter({ to: e.target.value })} />
          </div>
        </div>
        <div className="filter-group">
          <label className="filter-label" htmlFor="d-plan">
            Planimetria
          </label>
          <select id="d-plan" value={filters.plan} onChange={(e) => setFilter({ plan: e.target.value })}>
            <option value="">Tutte</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <label className="filter-label" htmlFor="d-assignee">
            Assegnato a
          </label>
          <select id="d-assignee" value={filters.assignee} onChange={(e) => setFilter({ assignee: e.target.value })}>
            <option value="">Chiunque</option>
            {members.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <label className="filter-label" htmlFor="d-days">
            Trend
          </label>
          <select id="d-days" value={filters.days} onChange={(e) => setFilter({ days: e.target.value })}>
            <option value="14">14 giorni</option>
            <option value="30">30 giorni</option>
            <option value="90">90 giorni</option>
          </select>
        </div>
        {(filters.from || filters.to || filters.plan || filters.assignee) && (
          <div className="filter-group filter-summary">
            <button type="button" className="btn small" onClick={() => setSp(new URLSearchParams(), { replace: true })}>
              Azzera
            </button>
          </div>
        )}
      </div>
      <div className="content">
        {!stats ? (
          <Loading />
        ) : (
          <>
            <div className="stat-tiles">
              <Link to={tasksUrl({ status: ['open', 'assigned'] })} className="card stat-tile">
                <span className="stat-label">Task aperti</span>
                <span className="stat-value">{openTotal}</span>
                <span className="muted small">{stats.tasks_by_status.assigned ?? 0} assegnati</span>
              </Link>
              <Link to={tasksUrl({ overdue: '1' })} className={`card stat-tile${stats.overdue ? ' stat-bad' : ''}`}>
                <span className="stat-label">Scaduti</span>
                <span className="stat-value">{stats.overdue}</span>
                <span className="muted small">non risolti oltre la scadenza</span>
              </Link>
              <Link to={tasksUrl({ status: ['resolved', 'verified'] })} className="card stat-tile">
                <span className="stat-label">Chiusi ultimi 7 giorni</span>
                <span className="stat-value">{stats.closed_last_7d}</span>
                <span className="muted small">{stats.tasks_total} task in totale · {stats.pins_total} pin</span>
              </Link>
            </div>

            {showTable ? (
              <StatsTable stats={stats} />
            ) : (
              <div className="chart-grid">
                <section className="card chart-card">
                  <h2>Task per stato</h2>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={statusData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} onClick={(e) => e?.activeLabel && navigate(tasksUrl({ status: statusData.find((d) => d.label === e.activeLabel)!.status }))}>
                      <CartesianGrid vertical={false} stroke={INK.grid} />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: INK.tick }} />
                      <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: INK.tick }} />
                      <Tooltip cursor={{ fill: INK.cursor }} formatter={(v) => [v, 'task']} />
                      <Bar dataKey="n" radius={[4, 4, 0, 0]} maxBarSize={48} label={{ position: 'top', fontSize: 12, fill: INK.label }} cursor="pointer" shape={(p: { x?: number; y?: number; width?: number; height?: number; payload?: { status: string } }) => <rect x={p.x} y={p.y} width={p.width} height={p.height} rx={4} fill={STATUS_COLOR[p.payload?.status ?? 'open']} />} />
                    </BarChart>
                  </ResponsiveContainer>
                  <p className="muted small">Clicca una barra per vedere i task.</p>
                </section>

                <section className="card chart-card">
                  <h2>Creati vs risolti · ultimi {stats.series.length} giorni</h2>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={stats.series} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke={INK.grid} />
                      <XAxis dataKey="date" tickFormatter={fmtDay} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: INK.tick }} minTickGap={24} />
                      <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: INK.tick }} />
                      <Tooltip labelFormatter={(d) => fmtDay(String(d))} />
                      <Line type="monotone" dataKey="created" name="Creati" stroke={SERIES.created} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: '#fff', strokeWidth: 2 }} />
                      <Line type="monotone" dataKey="resolved" name="Risolti" stroke={SERIES.resolved} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: '#fff', strokeWidth: 2 }} />
                    </LineChart>
                  </ResponsiveContainer>
                  <div className="legend">
                    <span className="legend-item">
                      <span className="legend-dot" style={{ background: SERIES.created }} /> Creati
                    </span>
                    <span className="legend-item">
                      <span className="legend-dot" style={{ background: SERIES.resolved }} /> Risolti
                    </span>
                  </div>
                </section>

                <section className="card chart-card">
                  <h2>Task aperti per planimetria</h2>
                  {openByPlan.length === 0 ? (
                    <p className="muted small">Nessuna planimetria.</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={Math.max(120, 36 * openByPlan.length + 24)}>
                      <BarChart data={openByPlan} layout="vertical" margin={{ top: 4, right: 32, left: 8, bottom: 0 }} onClick={(e) => e?.activeLabel && navigate(tasksUrl({ plan: String(openByPlan.find((d) => d.plan_name === e.activeLabel)?.plan_id ?? ''), status: ['open', 'assigned'] }))}>
                        <CartesianGrid horizontal={false} stroke={INK.grid} />
                        <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: INK.tick }} />
                        <YAxis type="category" dataKey="plan_name" width={120} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: INK.label }} />
                        <Tooltip cursor={{ fill: INK.cursor }} formatter={(v) => [v, 'aperti']} />
                        <Bar dataKey="open" fill={MONO} radius={[0, 4, 4, 0]} maxBarSize={22} label={{ position: 'right', fontSize: 12, fill: INK.label }} cursor="pointer" />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </section>

                <section className="card chart-card">
                  <h2>Moduli compilati per template</h2>
                  {byTemplate.length === 0 ? (
                    <p className="muted small">Nessun modulo nel periodo.</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={Math.max(120, 36 * byTemplate.length + 24)}>
                      <BarChart data={byTemplate} layout="vertical" margin={{ top: 4, right: 32, left: 8, bottom: 0 }}>
                        <CartesianGrid horizontal={false} stroke={INK.grid} />
                        <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: INK.tick }} />
                        <YAxis type="category" dataKey="template_name" width={140} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: INK.label }} />
                        <Tooltip cursor={{ fill: INK.cursor }} formatter={(v) => [v, 'moduli']} />
                        <Bar dataKey="count" fill={MONO} radius={[0, 4, 4, 0]} maxBarSize={22} label={{ position: 'right', fontSize: 12, fill: INK.label }} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                  <p className="muted small">{stats.submissions_total} moduli nel periodo</p>
                </section>
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}

/** Vista tabellare degli stessi numeri (accessibilità / copia-incolla). */
function StatsTable({ stats }: { stats: Stats }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <tbody>
          {(['open', 'assigned', 'resolved', 'verified'] as const).map((s) => (
            <tr key={s}>
              <th>Task {TASK_STATUS_LABEL[s].toLowerCase()}</th>
              <td className="num">{stats.tasks_by_status[s] ?? 0}</td>
            </tr>
          ))}
          {stats.open_by_plan.map((p) => (
            <tr key={String(p.plan_id)}>
              <th>Aperti · {String(p.plan_name)}</th>
              <td className="num">{String(p.open)}</td>
            </tr>
          ))}
          {stats.submissions_by_template.map((t) => (
            <tr key={String(t.template_id)}>
              <th>Moduli · {String(t.template_name)}</th>
              <td className="num">{String(t.count)}</td>
            </tr>
          ))}
          {stats.series.map((d) => (
            <tr key={d.date}>
              <th>{d.date}</th>
              <td className="num">
                creati {d.created} · risolti {d.resolved}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
