import { useRef, useState, type PointerEvent, type RefObject } from 'react'
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

const DRAG_THRESHOLD_PX = 4

type Props = {
  pin: PinSummary
  scale: number
  selected?: boolean
  canvasRef: RefObject<HTMLDivElement | null>
  draggable?: boolean
  onClick?: () => void
  onMove?: (x: number, y: number) => void
}

/**
 * Marker a goccia; la punta è sul punto esatto (x, y). Dimensione costante a schermo.
 * Se `draggable`, il trascinamento sposta il pin (la classe `pin` è esclusa dal
 * panning del viewer, così il drag non muove la planimetria).
 */
export default function PinMarker({ pin, scale, selected, canvasRef, draggable, onClick, onMove }: Props) {
  const level = pinLevel(pin)
  const total = pin.tasks_open + pin.tasks_assigned + pin.tasks_resolved + pin.tasks_verified
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)
  const start = useRef<{ x: number; y: number; moved: boolean } | null>(null)

  const pos = dragPos ?? { x: pin.x, y: pin.y }

  function onPointerDown(e: PointerEvent<HTMLButtonElement>) {
    if (!draggable || e.button !== 0) return
    start.current = { x: e.clientX, y: e.clientY, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: PointerEvent<HTMLButtonElement>) {
    if (!start.current || !canvasRef.current) return
    if (!start.current.moved) {
      if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) < DRAG_THRESHOLD_PX) return
      start.current.moved = true
    }
    setDragPos(relativePoint(canvasRef.current, e.clientX, e.clientY))
  }

  function onPointerUp(e: PointerEvent<HTMLButtonElement>) {
    if (!start.current) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    const moved = start.current.moved
    start.current = null
    if (moved && dragPos) {
      onMove?.(dragPos.x, dragPos.y)
    } else {
      onClick?.()
    }
    setDragPos(null)
  }

  return (
    <button
      type="button"
      className={`pin pin-${level}${selected ? ' pin-selected' : ''}${dragPos ? ' pin-dragging' : ''}`}
      style={{
        left: `${pos.x * 100}%`,
        top: `${pos.y * 100}%`,
        transform: `translate(-50%, -100%) scale(${1 / scale})`,
        cursor: draggable ? 'grab' : 'pointer',
      }}
      title={pin.label ?? PIN_LEVEL_LABEL[level]}
      aria-label={pin.label ?? 'Pin'}
      data-pin-id={pin.id}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        start.current = null
        setDragPos(null)
      }}
      onClick={(e) => {
        // il click "vero" è gestito in onPointerUp (per distinguerlo dal drag);
        // qui blocchiamo solo la propagazione verso il canvas (modalità aggiungi)
        e.stopPropagation()
        if (!draggable) onClick?.()
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
