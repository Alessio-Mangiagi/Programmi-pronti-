import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { api, errorMessage } from '../../api/client'
import type { components } from '../../api/schema'
import type { Project, User } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import Loading from '../../components/Loading'
import { useToast } from '../../components/useToast'
import { TASK_STATUS_LABEL as _TSL } from '../../labels'
import { ROLE_LABEL } from '../../labels'
import { useLoad } from '../../hooks/useLoad'
import { useLatestRequest } from '../../hooks/useLatestRequest'

type AuditItem = components['schemas']['AuditOut']
type AuditPage = components['schemas']['AuditPage']
type ActionDef = components['schemas']['AuditActionOut']

const PAGE_SIZES = [25, 50, 100]
const TASK_STATUS_LABEL = _TSL as Record<string, string>

const fmtDateTime = (iso: string) =>
  new Date(iso.endsWith('Z') ? iso : iso + 'Z').toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'medium' })

/** Tinta del badge per famiglia di azione (colore + testo, mai colore da solo). */
function actionTone(action: string): string {
  if (action === 'auth.login_failed' || action.endsWith('.deleted') || action === 'user.deactivated') return 'status-open'
  if (action.endsWith('.created') || action === 'user.reactivated' || action === 'auth.login') return 'status-resolved'
  if (action === 'sync.push') return 'status-verified'
  return 'status-assigned'
}

/** Riassunto leggibile dei `details` (chiavi note per azione; il JSON completo resta nell'espansione). */
function summarize(it: AuditItem): string {
  const d = it.details as Record<string, unknown>
  const s = (k: string) => (d[k] == null ? '' : String(d[k]))
  const change = (k: string, label: (v: string) => string = (v) => v) => {
    const c = d[k] as { from?: string; to?: string } | undefined
    return c && typeof c === 'object' ? `${label(String(c.from ?? '—'))} → ${label(String(c.to ?? '—'))}` : ''
  }
  switch (it.action) {
    case 'auth.login_failed':
      return d.reason === 'inactive' ? 'utente disattivato' : 'credenziali errate'
    case 'user.created':
      return `${s('name')} <${s('email')}> · ${ROLE_LABEL[s('role')] ?? s('role')}`
    case 'user.updated': {
      const parts = [
        change('role', (v) => ROLE_LABEL[v] ?? v) && `ruolo ${change('role', (v) => ROLE_LABEL[v] ?? v)}`,
        change('name') && `nome ${change('name')}`,
      ].filter(Boolean)
      return `${s('email')} · ${parts.join(' · ')}`
    }
    case 'user.password_reset':
    case 'user.deactivated':
    case 'user.reactivated':
    case 'project.member_added':
    case 'project.member_removed':
      return s('email')
    case 'plan.file_uploaded': {
      const size = d.size as number[] | undefined
      return `${s('name')} · ${s('mime')} · ${Math.round(Number(d.bytes ?? 0) / 1024)} KB${size ? ` · ${size[0]}×${size[1]} px` : ''}`
    }
    case 'task.updated': {
      const st = d.status as { from: string; to: string } | null
      const fields = (d.fields as string[] | undefined) ?? []
      return `«${s('title')}»${st ? ` · ${TASK_STATUS_LABEL[st.from] ?? st.from} → ${TASK_STATUS_LABEL[st.to] ?? st.to}` : ''}${fields.length ? ` · campi: ${fields.join(', ')}` : ''}`
    }
    case 'task.created':
    case 'task.deleted':
      return `«${s('title')}»`
    case 'submission.created':
      return s('template')
    case 'submission.updated': {
      const fields = (d.fields as string[] | undefined) ?? []
      return `${s('template')}${fields.length ? ` · campi: ${fields.join(', ')}` : ''}`
    }
    case 'pin.created':
    case 'pin.deleted':
    case 'pin.updated':
      return [s('label') && `«${s('label')}»`, d.submissions != null && `${s('submissions')} moduli, ${s('tasks')} task`, Array.isArray(d.fields) && `campi: ${(d.fields as string[]).join(', ')}`]
        .filter(Boolean)
        .join(' · ')
    case 'sync.push': {
      const g = (k: string, label: string) => {
        const c = d[k] as { sent: number; inserted: number; updated: number; skipped: number; rejected: number } | undefined
        return c && c.sent ? `${label} ${c.inserted + c.updated}/${c.sent}${c.rejected ? ` (${c.rejected} rifiutati)` : ''}${c.skipped ? ` (${c.skipped} superati)` : ''}` : ''
      }
      return [g('pins', 'pin'), g('submissions', 'moduli'), g('tasks', 'task'), g('attachments', 'foto')].filter(Boolean).join(' · ')
    }
    default:
      return s('name') || s('title') || ''
  }
}

function toCsv(items: AuditItem[], label: (a: string) => string): string {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const head = ['data', 'utente', 'email', 'azione', 'dettaglio', 'progetto', 'entita', 'entita_id', 'ip']
  const rows = items.map((it) =>
    [fmtDateTime(it.created_at), it.actor_name, it.actor_email, label(it.action), summarize(it), it.project_name, it.entity_type, it.entity_id, it.ip].map(esc).join(';'),
  )
  return [head.join(';'), ...rows].join('\r\n')
}

/**
 * Spazio admin → Registro operazioni: chi ha fatto cosa, quando e da dove.
 * Filtri in query string (condivisibili), paginazione server, dettaglio JSON
 * per riga ed export CSV del filtro corrente.
 */
export default function AuditPage() {
  const { user: me } = useAuth()
  const toast = useToast()
  const [sp, setSp] = useSearchParams()
  const [page, setPage] = useState<AuditPage | null>(null)
  // query dell'ultima risposta arrivata: diversa da quella corrente = caricamento in corso
  const [loadedQuery, setLoadedQuery] = useState<object | null>(null)
  const [actions, setActions] = useState<ActionDef[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [open, setOpen] = useState<string | null>(null)

  const f = {
    actor: sp.get('actor') ?? '',
    action: sp.get('action') ?? '',
    project: sp.get('project') ?? '',
    entity: sp.get('entity') ?? '',
    from: sp.get('from') ?? '',
    to: sp.get('to') ?? '',
    q: sp.get('q') ?? '',
    limit: Number(sp.get('limit') ?? 50),
    offset: Number(sp.get('offset') ?? 0),
  }
  const setFilter = (patch: Partial<Record<keyof typeof f, string | number>>) => {
    const next = { ...f, ...patch, offset: 'offset' in patch ? Number(patch.offset) : 0 }
    setSp(Object.fromEntries(Object.entries(next).filter(([, v]) => v !== '' && v !== 0).map(([k, v]) => [k, String(v)])), { replace: true })
  }

  const query = useMemo(
    () => ({
      actor_id: f.actor || undefined,
      action: f.action ? f.action.split(',') : undefined,
      project_id: f.project || undefined,
      entity_id: f.entity || undefined,
      date_from: f.from || undefined,
      date_to: f.to || undefined,
      q: f.q || undefined,
      limit: f.limit,
      offset: f.offset,
    }),
    [f.actor, f.action, f.project, f.entity, f.from, f.to, f.q, f.limit, f.offset],
  )

  useEffect(() => {
    api.GET('/audit/actions').then(({ data }) => data && setActions(data))
    api.GET('/users', { params: { query: { include_inactive: true } } }).then(({ data }) => data && setUsers(data))
    api.GET('/projects').then(({ data }) => data && setProjects(data))
  }, [])

  const begin = useLatestRequest()
  const load = useCallback(async () => {
    const isLatest = begin()
    const { data, error } = await api.GET('/audit', { params: { query } })
    if (!isLatest()) return
    setLoadedQuery(query)
    if (error) return toast.error(errorMessage(error))
    setPage(data ?? null)
  }, [query, toast, begin])

  useLoad(load)

  const loading = loadedQuery !== query

  const label = useCallback((a: string) => actions.find((x) => x.action === a)?.label ?? a, [actions])

  const groups = useMemo(() => {
    const g: Record<string, ActionDef[]> = {}
    for (const a of actions) (g[a.action.split('.')[0]] ??= []).push(a)
    return g
  }, [actions])

  if (me?.role !== 'admin') return <Navigate to="/projects" replace />

  async function exportCsv() {
    const { data, error } = await api.GET('/audit', { params: { query: { ...query, limit: 500, offset: 0 } } })
    if (error || !data) return toast.error(errorMessage(error))
    const blob = new Blob(['﻿' + toCsv(data.items, label)], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `registro-operazioni-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
    if (data.total > 500) toast.info(`Esportate le prime 500 righe di ${data.total}: restringi il filtro per il resto`)
  }

  const GROUP_LABEL: Record<string, string> = {
    auth: 'Accessi', user: 'Utenti', project: 'Progetti', plan: 'Planimetrie', template: 'Moduli',
    pin: 'Pin', submission: 'Compilazioni', task: 'Task', attachment: 'Foto', sync: 'Sincronizzazione',
  }

  const total = page?.total ?? 0
  const last = Math.min(f.offset + f.limit, total)
  const hasFilters = !!(f.actor || f.action || f.project || f.entity || f.from || f.to || f.q)

  return (
    <>
      <header className="topbar">
        <div>
          <span className="eyebrow">Amministrazione</span>
          <h1>Registro operazioni</h1>
        </div>
        <div className="topbar-actions">
          <Link to="/admin/users" className="btn">
            Utenti
          </Link>
          <button className="btn" onClick={exportCsv} disabled={!total}>
            Esporta CSV
          </button>
        </div>
      </header>
      <div className="filters">
        <div className="filter-group">
          <label className="filter-label" htmlFor="af-actor">
            Utente
          </label>
          <select id="af-actor" value={f.actor} onChange={(e) => setFilter({ actor: e.target.value })}>
            <option value="">Tutti</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
                {u.is_active ? '' : ' (disattivato)'}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <label className="filter-label" htmlFor="af-action">
            Azione
          </label>
          <select id="af-action" value={f.action} onChange={(e) => setFilter({ action: e.target.value })}>
            <option value="">Tutte</option>
            {Object.entries(groups).map(([g, list]) => (
              <optgroup key={g} label={GROUP_LABEL[g] ?? g}>
                <option value={list.map((a) => a.action).join(',')}>Tutte: {GROUP_LABEL[g] ?? g}</option>
                {list.map((a) => (
                  <option key={a.action} value={a.action}>
                    {a.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <label className="filter-label" htmlFor="af-project">
            Progetto
          </label>
          <select id="af-project" value={f.project} onChange={(e) => setFilter({ project: e.target.value })}>
            <option value="">Tutti</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <span className="filter-label">Periodo</span>
          <div className="filter-dates">
            <input type="date" value={f.from} onChange={(e) => setFilter({ from: e.target.value })} aria-label="Dal" />
            <span>–</span>
            <input type="date" value={f.to} onChange={(e) => setFilter({ to: e.target.value })} aria-label="Al" />
          </div>
        </div>
        <div className="filter-group">
          <label className="filter-label" htmlFor="af-q">
            Cerca
          </label>
          <input id="af-q" placeholder="Email, IP, id entità" defaultValue={f.q} onKeyDown={(e) => e.key === 'Enter' && setFilter({ q: (e.target as HTMLInputElement).value })} onBlur={(e) => e.target.value !== f.q && setFilter({ q: e.target.value })} />
        </div>
        {f.entity && (
          <div className="filter-group">
            <span className="filter-label">Entità</span>
            <span className="chip chip-on">
              <code>{f.entity.slice(0, 8)}…</code>
            </span>
          </div>
        )}
        <div className="filter-group filter-summary">
          {hasFilters && (
            <button className="btn small" onClick={() => setSp({}, { replace: true })}>
              Azzera
            </button>
          )}
          <span className="muted small">{total} operazioni</span>
        </div>
      </div>
      <div className="content">
        {loading && page === null ? (
          <Loading />
        ) : total === 0 ? (
          <div className="empty">Nessuna operazione registrata{hasFilters ? ' con questi filtri' : ''}.</div>
        ) : (
          <>
            <div className={`table-wrap${loading ? ' is-loading' : ''}`}>
              <table className="table audit-table">
                <thead>
                  <tr>
                    <th>Quando</th>
                    <th>Utente</th>
                    <th>Azione</th>
                    <th>Dettaglio</th>
                    <th>Progetto</th>
                    <th>IP</th>
                  </tr>
                </thead>
                <tbody>
                  {page?.items.map((it) => (
                    <AuditRow key={it.id} it={it} label={label} open={open === it.id} onToggle={() => setOpen(open === it.id ? null : it.id)} onFilter={setFilter} />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row pager">
              <span className="muted small">
                {f.offset + 1}–{last} di {total}
              </span>
              <div className="row">
                <select className="pager-size" value={f.limit} onChange={(e) => setFilter({ limit: Number(e.target.value) })} aria-label="Righe per pagina">
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n} per pagina
                    </option>
                  ))}
                </select>
                <button className="btn small" disabled={f.offset === 0} onClick={() => setFilter({ offset: Math.max(0, f.offset - f.limit) })}>
                  ‹ Precedenti
                </button>
                <button className="btn small" disabled={last >= total} onClick={() => setFilter({ offset: f.offset + f.limit })}>
                  Successive ›
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}

function AuditRow({
  it,
  label,
  open,
  onToggle,
  onFilter,
}: {
  it: AuditItem
  label: (a: string) => string
  open: boolean
  onToggle: () => void
  onFilter: (p: { actor?: string; entity?: string; project?: string; action?: string }) => void
}) {
  return (
    <>
      <tr className={`audit-row${open ? ' is-open' : ''}`} onClick={onToggle}>
        <td className="nowrap muted small">{fmtDateTime(it.created_at)}</td>
        <td>
          {it.actor_id ? (
            <button
              className="link-btn"
              onClick={(e) => {
                e.stopPropagation()
                onFilter({ actor: it.actor_id! })
              }}
              title="Solo questo utente"
            >
              {it.actor_name ?? it.actor_email}
            </button>
          ) : (
            <span className="muted">{it.actor_email ?? 'sistema'}</span>
          )}
        </td>
        <td>
          <span className={`badge ${actionTone(it.action)}`}>{label(it.action)}</span>
        </td>
        <td className="clamp">{summarize(it)}</td>
        <td>
          {it.project_id ? (
            <button
              className="link-btn"
              onClick={(e) => {
                e.stopPropagation()
                onFilter({ project: it.project_id! })
              }}
            >
              {it.project_name ?? it.project_id}
            </button>
          ) : (
            '—'
          )}
        </td>
        <td className="muted small nowrap">{it.ip ?? '—'}</td>
      </tr>
      {open && (
        <tr className="audit-detail">
          <td colSpan={6}>
            <div className="audit-detail-grid">
              <div>
                <span className="filter-label">Entità</span>
                {it.entity_type ? (
                  <>
                    {it.entity_type} <code>{it.entity_id}</code>{' '}
                    {it.entity_id && (
                      <button className="btn small" onClick={() => onFilter({ entity: it.entity_id!, action: '', actor: '' })}>
                        Storia di questa entità
                      </button>
                    )}
                  </>
                ) : (
                  '—'
                )}
              </div>
              <div>
                <span className="filter-label">Client</span>
                <span className="small">{it.user_agent ?? '—'}</span>
              </div>
              <div>
                <span className="filter-label">Dettagli</span>
                <pre className="audit-json">{JSON.stringify(it.details, null, 2)}</pre>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
