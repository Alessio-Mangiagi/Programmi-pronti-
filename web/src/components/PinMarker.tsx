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

type Props = {
  pin: PinSummary
  scale: number
  selected?: boolean
  onClick?: () => void
}

/** Marker a goccia; la punta è sul punto esatto (x, y). Dimensione costante a schermo. */
export default function PinMarker({ pin, scale, selected, onClick }: Props) {
  const level = pinLevel(pin)
  const total = pin.tasks_open + pin.tasks_assigned + pin.tasks_resolved + pin.tasks_verified
  return (
    <button
      type="button"
      className={`pin pin-${level}${selected ? ' pin-selected' : ''}`}
      style={{
        left: `${pin.x * 100}%`,
        top: `${pin.y * 100}%`,
        transform: `translate(-50%, -100%) scale(${1 / scale})`,
      }}
      title={pin.label ?? PIN_LEVEL_LABEL[level]}
      aria-label={pin.label ?? 'Pin'}
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
    >
      <svg viewBox="0 0 24 32" width="28" height="37" aria-hidden="true">
        <path d="M12 1C6 1 1.5 5.6 1.5 11.4c0 7.5 9.2 18 10.1 19 .2.2.6.2.8 0 .9-1 10.1-11.5 10.1-19C22.5 5.6 18 1 12 1z" />
        <circle cx="12" cy="11.5" r="4.5" />
      </svg>
      {total > 1 && <span className="pin-count">{total}</span>}
    </button>
  )
}
