import type { TaskStatus } from '../api/types'

export type PinFilterState = {
  status: TaskStatus[]
  templateId: string
  assignedTo: string
  dateFrom: string // YYYY-MM-DD
  dateTo: string
}

export const EMPTY_FILTERS: PinFilterState = { status: [], templateId: '', assignedTo: '', dateFrom: '', dateTo: '' }

/** Stati dei task proposti come filtro (chip). */
export const PIN_STATUS_FILTERS: { value: TaskStatus; label: string }[] = [
  { value: 'open', label: 'Aperti' },
  { value: 'assigned', label: 'Assegnati' },
  { value: 'resolved', label: 'Risolti' },
  { value: 'verified', label: 'Verificati' },
]

/** Filtri ↔ query string, così un link alla planimetria filtrata si può condividere. */
export function filtersFromSearch(sp: URLSearchParams): PinFilterState {
  const valid = new Set(PIN_STATUS_FILTERS.map((s) => s.value))
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
