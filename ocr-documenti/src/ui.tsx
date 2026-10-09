// Parti presentazionali condivise: palette, icone, stili dei bottoni.
// Separate da App.tsx perché non dipendono da nessuno stato dell'applicazione.
import type React from 'react'

// Palette corporate Cosedil. I VALORI stanno in index.css (`:root`), qui ci sono
// solo i riferimenti: gli stili inline di React non possono usare `var()` nei
// calcoli (es. `${C.border}20` per l'alpha), quindi il fallback letterale resta
// come secondo argomento — è quello che vince se il CSS non è ancora caricato.
const leggi = (nome: string, fallback: string): string => {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(nome).trim()
  return v || fallback
}
export const C = {
  bg: leggi('--c-bg', '#f2f3f5'),
  panel: leggi('--c-panel', '#ffffff'),
  header: leggi('--c-header', '#f9f9fb'),
  border: leggi('--c-border', '#dfe4ea'),
  text: leggi('--c-text', '#212326'),
  muted: leggi('--c-muted', '#66707a'),
  accent: leggi('--c-accent', '#0c4577'),
  blue: leggi('--c-blue', '#198fd9'),
  green: leggi('--c-green', '#1e8e3e'),
  red: leggi('--c-red', '#c5221f'),
  yellow: leggi('--c-yellow', '#a16207'),
  brandGreen: leggi('--c-brand-green', '#65bc7b'),
  warnBg: leggi('--c-warn-bg', '#fff8e1'),
  warnBorder: leggi('--c-warn-border', '#e6c26e'),
}

export const FONT = '"Open Sans", "Segoe UI", Arial, Helvetica, sans-serif'
export const FONT_HEAD = '"Ubuntu", Arial, Helvetica, sans-serif'

// ── Bottoni ──────────────────────────────────────────────────────────────────
// Tre livelli, non più uno solo: la sidebar aveva dodici bottoni pieni tutti
// uguali e nessuno diceva quale premere per primo.
//   primario   = l'azione che produce il deliverable (uno per schermata)
//   secondario = azione normale, contorno
//   silenzioso = azione di servizio, solo testo
export type LivelloBtn = 'primario' | 'secondario' | 'silenzioso'
export const bottone = (
  livello: LivelloBtn,
  colore: string = C.accent,
  attivo = true,
): React.CSSProperties => ({
  padding: livello === 'primario' ? '9px 12px' : '6px 10px',
  borderRadius: 6,
  fontSize: livello === 'primario' ? 12.5 : 11.5,
  fontWeight: livello === 'primario' ? 700 : 600,
  letterSpacing: '0.02em',
  fontFamily: 'inherit',
  width: '100%',
  textAlign: 'center',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  border: livello === 'secondario' ? `1px solid ${colore}` : '1px solid transparent',
  background: livello === 'primario' ? colore : 'transparent',
  color: livello === 'primario' ? '#ffffff' : colore,
  opacity: attivo ? 1 : 0.45,
  cursor: attivo ? 'pointer' : 'not-allowed',
})

// Stile a due stati (attivo/inattivo) dei controlli della barra superiore e delle
// azioni sul risultato. Invariato rispetto a prima: cambiarlo qui cambierebbe una
// trentina di bottoni già a posto.
export const btn = (active: boolean, color: string = C.accent): React.CSSProperties => ({
  padding: '6px 16px',
  borderRadius: 4,
  border: `1px solid ${active ? color : C.border}`,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 11,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  background: active ? `${color}14` : '#ffffff',
  color: active ? color : C.muted,
  transition: 'all 0.15s',
  boxShadow: active ? '0 1px 2px rgba(12,69,119,0.12)' : 'none',
  fontFamily: 'inherit',
})

// Etichetta di sezione della sidebar
export const etichettaSezione: React.CSSProperties = {
  fontSize: 9, fontWeight: 700, color: C.accent, letterSpacing: '0.1em',
  textTransform: 'uppercase', paddingBottom: 4,
}

// ── Nome di file che non perde l'estensione ─────────────────────────────────
// In una lista stretta `text-overflow: ellipsis` taglia a DESTRA, cioè proprio
// dove sta l'estensione: "…Subappalto Sabbie d'oro_fmto tra le Parti.pdf" si
// riduceva a "2026_198-138_029 Subappa…", senza tipo di file e senza la parte
// che distingue due contratti quasi omonimi.
// Qui l'estensione è un elemento a sé che non si stringe (`flexShrink: 0`):
// l'ellissi mangia solo il nome, il ".pdf" resta sempre visibile.
// Niente troncamento calcolato in JS: la larghezza la decide il layout, quindi
// resta corretto a qualsiasi dimensione del pannello.
export const NomeFile = ({ nome, style }: { nome: string; style?: React.CSSProperties }) => {
  const i = nome.lastIndexOf('.')
  // estensione vera = punto non iniziale seguito da poche lettere/cifre; un nome
  // come "Contratto rev.01 definitivo" non ha estensione da tenere fissa
  const est = i > 0 && /^\.[A-Za-z0-9]{1,5}$/.test(nome.slice(i)) ? nome.slice(i) : ''
  const base = est ? nome.slice(0, i) : nome
  return (
    <span style={{ display: 'flex', minWidth: 0, ...style }} title={nome}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{base}</span>
      {est && <span style={{ flexShrink: 0 }}>{est}</span>}
    </span>
  )
}

// ── Icone SVG inline (stroke 1.8, stile Lucide) — niente emoji come icone ──
const iconBase = (size: number): React.SVGProps<SVGSVGElement> => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
  style: { verticalAlign: '-2px', flexShrink: 0 },
  'aria-hidden': true,
})
export const IconDoc = ({ size = 15 }: { size?: number }) => (
  <svg {...iconBase(size)}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
)
export const IconUpload = ({ size = 15 }: { size?: number }) => (
  <svg {...iconBase(size)}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
)
export const IconBook = ({ size = 15 }: { size?: number }) => (
  <svg {...iconBase(size)}>
    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
  </svg>
)
export const IconHelp = ({ size = 15 }: { size?: number }) => (
  <svg {...iconBase(size)}>
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
)
export const IconScanText = ({ size = 15 }: { size?: number }) => (
  <svg {...iconBase(size)}>
    <path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" />
    <path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" />
    <line x1="7" y1="9" x2="17" y2="9" /><line x1="7" y1="13" x2="17" y2="13" /><line x1="7" y1="17" x2="13" y2="17" />
  </svg>
)
export const IconMark = ({ size = 20 }: { size?: number }) => (
  <svg {...iconBase(size)}>
    <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
    <path d="M2 22h20" />
    <path d="M10 6h1" /><path d="M13 6h1" /><path d="M10 10h1" /><path d="M13 10h1" />
    <path d="M10 14h1" /><path d="M13 14h1" /><path d="M10 18h4" />
  </svg>
)
export const IconAlert = ({ size = 14 }: { size?: number }) => (
  <svg {...iconBase(size)}>
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
)
export const IconCheck = ({ size = 14 }: { size?: number }) => (
  <svg {...iconBase(size)}><polyline points="20 6 9 17 4 12" /></svg>
)
export const IconFolder = ({ size = 15 }: { size?: number }) => (
  <svg {...iconBase(size)}>
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
)
export const IconBolt = ({ size = 15 }: { size?: number }) => (
  <svg {...iconBase(size)}><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" /></svg>
)
// tre puntini verticali: il menu delle azioni su un file
export const IconDots = ({ size = 15 }: { size?: number }) => (
  <svg {...iconBase(size)}>
    <circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="12" cy="19" r="1.6" fill="currentColor" stroke="none" />
  </svg>
)
// freccia che esce dal riquadro: apri in un'altra finestra
export const IconExternal = ({ size = 15 }: { size?: number }) => (
  <svg {...iconBase(size)}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="M15 3h6v6" /><path d="M10 14 21 3" /></svg>
)
