import type { FormTemplate, TaskStatus, User } from '../api/types'
import { EMPTY_FILTERS, PIN_STATUS_FILTERS as STATUSES, isFiltering, type PinFilterState } from './pinFilterState'
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
