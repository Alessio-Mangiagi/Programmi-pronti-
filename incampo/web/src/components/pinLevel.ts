import type { PinSummary } from '../api/types'

export type PinLevel = 'open' | 'assigned' | 'resolved' | 'verified' | 'submission' | 'empty'

/** Stato "peggiore" del pin: decide il colore del marker. */
export function pinLevel(pin: PinSummary): PinLevel {
  if (pin.tasks_open) return 'open'
  if (pin.tasks_assigned) return 'assigned'
  if (pin.tasks_resolved) return 'resolved'
  if (pin.tasks_verified) return 'verified'
  if (pin.submissions_count) return 'submission'
  return 'empty'
}

export const PIN_LEVEL_LABEL: Record<PinLevel, string> = {
  open: 'Task aperto',
  assigned: 'Task assegnato',
  resolved: 'Task risolto',
  verified: 'Task verificato',
  submission: 'Solo moduli',
  empty: 'Vuoto',
}

/** Coordinate relative (0-1) di un evento rispetto al canvas della planimetria, a qualunque zoom. */
export function relativePoint(canvas: HTMLElement, clientX: number, clientY: number) {
  const r = canvas.getBoundingClientRect()
  const clamp = (v: number) => Math.min(1, Math.max(0, v))
  return { x: clamp((clientX - r.left) / r.width), y: clamp((clientY - r.top) / r.height) }
}
