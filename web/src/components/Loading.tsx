/** Indicatore di caricamento uniforme (spinner + testo). */
export default function Loading({ text = 'Caricamento…', className = '' }: { text?: string; className?: string }) {
  return (
    <div className={`loading ${className}`} role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span className="muted">{text}</span>
    </div>
  )
}
