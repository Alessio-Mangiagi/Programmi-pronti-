import { useEffect, useRef, type ReactNode } from 'react'
import Icon from './Icon'

type Props = {
  title: string
  onClose: () => void
  children: ReactNode
  /** Larghezza massima (default 640px). */
  width?: number
}

/**
 * Finestra modale minimale: overlay, Esc e click fuori chiudono.
 * Finché è aperta, `body[data-modal-open]` segnala agli handler globali
 * (es. Esc della plan view) di non intervenire.
 */
export default function Modal({ title, onClose, children, width = 640 }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    document.body.setAttribute('data-modal-open', '')
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        onClose()
      }
    }
    // capture: arriva prima dei listener di pagina registrati in bubbling
    window.addEventListener('keydown', onKey, true)
    panelRef.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus()
    return () => {
      document.body.removeAttribute('data-modal-open')
      window.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal card" role="dialog" aria-modal="true" aria-label={title} style={{ maxWidth: width }} ref={panelRef}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="btn pin-close" onClick={onClose} aria-label="Chiudi">
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}
