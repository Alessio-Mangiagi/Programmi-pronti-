import type { FormTemplate, TaskStatus, User } from '../api/types'

export type PinFilterState = {
  status: TaskStatus[]
  templateId: string
  assignedTo: string
  dateFrom: string // YYYY-MM-DD
  dateTo: string
}

export const EMPTY_FILTERS: PinFilterState = { status: [], templateId: '', assignedTo: '', dateFrom: '', dateTo: '' }

const STATUSES: { value: TaskStatus; label: string }[] = [
  { value: 'open', label: 'Aperti' },
  { value: 'assigned', label: 'Assegnati' },
  { value: 'resolved', label: 'Risolti' },
  { value: 'verified', label: 'Verificati' },
]

/** Filtri ↔ query string, così un link alla planimetria filtrata si può condividere. */
export function filtersFromSearch(sp: URLSearchParams): PinFilterState {
  const valid = new Set(STATUSES.map((s) => s.value))
  return {
    status: sp.getAll('status').filter((s): s is TaskStatus => valid.has(s as TaskStatus)),
    templateId: sp.get('template') ?? '',
    assignedTo: sp.get('assignee') ?? '',
    dateFrom: sp.get('from') ?? '',
    dateTo: sp.get('to') ?? '',
  }
}

export function filtersToSearch(f: PinFilterState): URLSearchParams {
  const sp = new URLSearchParams()
  f.status.forEach((s) => sp.append('status', s))
  if (f.templateId) sp.set('template', f.templateId)
  if (f.assignedTo) sp.set('assignee', f.assignedTo)
  if (f.dateFrom) sp.set('from', f.dateFrom)
  if (f.dateTo) sp.set('to', f.dateTo)
  return sp
}

/** Parametri per GET /plans/{id}/pins (undefined = filtro non attivo). */
export function filtersToQuery(f: PinFilterState) {
  return {
    status: f.status.length ? f.status : undefined,
    template_id: f.templateId || undefined,
    assigned_to: f.assignedTo || undefined,
    date_from: f.dateFrom || undefined,
    date_to: f.dateTo || undefined,
  }
}

export function isFiltering(f: PinFilterState) {
  return f.status.length > 0 || !!f.templateId || !!f.assignedTo || !!f.dateFrom || !!f.dateTo
}

type Props = {
  value: PinFilterState
  onChange: (next: PinFilterState) => void
  templates: FormTemplate[]
  members: User[]
  /** Pin visibili / totali, per il riepilogo. */
  shown: number
  total: number | null
}

export default function PinFilters({ value, onChange, templates, members, shown, total }: Props) {
  const set = (patch: Partial<PinFilterState>) => onChange({ ...value, ...patch })
  const toggleStatus = (s: TaskStatus) =>
    set({ status: value.status.includes(s) ? value.status.filter((v) => v !== s) : [...value.status, s] })
  const active = isFiltering(value)

  return (
    <div className="filters" role="group" aria-label="Filtri pin">
      <div className="filter-group">
        <span className="filter-label">Task</span>
        <div className="chips">
          {STATUSES.map((s) => (
            <button
              key={s.value}
              type="button"
              className={`chip status-${s.value}${value.status.includes(s.value) ? ' chip-on' : ''}`}
              aria-pressed={value.status.includes(s.value)}
              onClick={() => toggleStatus(s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className="filter-group">
        <label className="filter-label" htmlFor="f-template">
          Modulo
        </label>
        <select id="f-template" value={value.templateId} onChange={(e) => set({ templateId: e.target.value })}>
          <option value="">Tutti</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      <div className="filter-group">
        <label className="filter-label" htmlFor="f-assignee">
          Assegnato a
        </label>
        <select id="f-assignee" value={value.assignedTo} onChange={(e) => set({ assignedTo: e.target.value })}>
          <option value="">Chiunque</option>
          {members.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </div>
      <div className="filter-group">
        <span className="filter-label" id="f-period">
          Periodo
        </span>
        <div className="filter-dates" role="group" aria-labelledby="f-period">
          <input
            id="f-from"
            type="date"
            aria-label="Dal"
            value={value.dateFrom}
            max={value.dateTo || undefined}
            onChange={(e) => set({ dateFrom: e.target.value })}
          />
          <span className="muted small">–</span>
          <input
            id="f-to"
            type="date"
            aria-label="Al"
            value={value.dateTo}
            min={value.dateFrom || undefined}
            onChange={(e) => set({ dateTo: e.target.value })}
          />
        </div>
      </div>
      <div className="filter-group filter-summary">
        <span className="muted small">
          {total === null ? '…' : active ? `${shown} di ${total} pin` : `${total} pin`}
        </span>
        {active && (
          <button type="button" className="btn small" onClick={() => onChange(EMPTY_FILTERS)}>
            Azzera
          </button>
        )}
      </div>
    </div>
  )
}
