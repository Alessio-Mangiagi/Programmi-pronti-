import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import Icon from './Icon'
import { type ToastApi, ToastContext } from './useToast'

type Kind = 'error' | 'success' | 'info'
type Toast = { id: number; kind: Kind; text: string }

const TTL_MS: Record<Kind, number> = { error: 7000, success: 3500, info: 4500 }

/** Notifiche non bloccanti in basso al centro; gli errori restano più a lungo. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)

  const dismiss = useCallback((id: number) => setToasts((prev) => prev.filter((t) => t.id !== id)), [])
  const push = useCallback(
    (kind: Kind, text: string) => {
      const id = ++seq.current
      setToasts((prev) => [...prev.slice(-3), { id, kind, text }])
      window.setTimeout(() => dismiss(id), TTL_MS[kind])
    },
    [dismiss],
  )
  const api = useMemo<ToastApi>(
    () => ({ error: (t) => push('error', t), success: (t) => push('success', t), info: (t) => push('info', t) }),
    [push],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            <span>{t.text}</span>
            <button type="button" className="toast-close" onClick={() => dismiss(t.id)} aria-label="Chiudi">
              <Icon name="x" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
