import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const SHOW_DELAY = 450 // ms: passando col mouse sopra il modulo non si accende tutto
const GAP = 8

type Props = {
  className: string
  style?: CSSProperties
  tips: string[]
  /** Etichetta del campo: il pulsante "?" le sta accanto. */
  label: ReactNode
  children: ReactNode
}

type Pos = { left: number; top: number; above: boolean }

/**
 * Contenitore di un campo con i suggerimenti di compilazione: compaiono restando col
 * mouse sul campo, oppure dal pulsante "?" (tastiera e touch). Il tooltip va in un
 * portal con posizione fissa, così non lo tagliano modali o pannelli che scorrono;
 * sta sopra l'etichetta, o sotto il campo se in alto non c'è spazio.
 */
export default function FieldShell({ className, style, tips, label, children }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const [pos, setPos] = useState<Pos | null>(null)
  const tipId = useId()

  const place = () => {
    const box = ref.current
    const anchor = box?.querySelector('.dyn-label-row') ?? box
    if (!box || !anchor) return
    const a = anchor.getBoundingClientRect()
    const above = a.top > 160
    setPos({ left: Math.min(a.left, window.innerWidth - 340), top: above ? a.top - GAP : box.getBoundingClientRect().bottom + GAP, above })
  }
  const show = (delay = SHOW_DELAY) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(place, delay)
  }
  const hide = () => {
    window.clearTimeout(timer.current)
    setPos(null)
  }

  // scorrendo la pagina il tooltip resterebbe fermo nel punto sbagliato: si chiude
  useEffect(() => {
    if (!pos) return
    const close = () => setPos(null)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [pos])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  return (
    <div ref={ref} className={className} style={style} onMouseEnter={() => show()} onMouseLeave={hide}>
      <div className="dyn-label-row">
        {label}
        <button
          type="button"
          className="dyn-tip-btn"
          aria-label="Suggerimenti per questo campo"
          aria-describedby={pos ? tipId : undefined}
          onFocus={() => show(0)}
          onBlur={hide}
          onClick={() => (pos ? hide() : show(0))}
        >
          ?
        </button>
      </div>
      {children}
      {pos &&
        createPortal(
          <div
            id={tipId}
            role="tooltip"
            className={`dyn-tip${pos.above ? ' is-above' : ''}`}
            style={{ left: pos.left, top: pos.top }}
          >
            <div className="dyn-tip-title">Suggerimenti</div>
            <ul>
              {tips.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  )
}
