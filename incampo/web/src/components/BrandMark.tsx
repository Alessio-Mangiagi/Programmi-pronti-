/**
 * Logo InCampo: il pin delle icone dell'app e del favicon (corpo nel colore del testo,
 * centro verde Cosedil). Il riquadro di sfondo lo dà `.brand-mark` nel CSS.
 */
export default function BrandMark() {
  return (
    <span className="brand-mark" role="img" aria-label="InCampo">
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M16 27s-7.5-6.4-7.5-13.3a7.5 7.5 0 0 1 15 0C23.5 20.6 16 27 16 27z" fill="currentColor" />
        <circle cx="16" cy="13.7" r="3.1" fill="var(--cosedil-green)" />
      </svg>
    </span>
  )
}
