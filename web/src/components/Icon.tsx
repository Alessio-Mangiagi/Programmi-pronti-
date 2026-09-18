import type { SVGProps } from 'react'

/* Icone lineari (stroke 1.5, stile Phosphor) usate al posto delle emoji: 1.1em, colore corrente. */
const PATHS = {
  'map-pin': 'M12 21s-6-5.2-6-11a6 6 0 0 1 12 0c0 5.8-6 11-6 11z M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  camera: 'M4 8h3l1.5-2h7L17 8h3v11H4z M12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  pencil: 'M4 20l4-1 10.5-10.5-3-3L5 16z M13.5 5.5l3 3',
  x: 'M6 6l12 12 M18 6L6 18',
  'arrow-up': 'M12 19V5 M6 11l6-6 6 6',
  'arrow-down': 'M12 5v14 M6 13l6 6 6-6',
  check: 'M5 12.5l4.5 4.5L19 7',
  plus: 'M12 5v14 M5 12h14',
  list: 'M8 6h13 M8 12h13 M8 18h13 M3.5 6h.01 M3.5 12h.01 M3.5 18h.01',
  'list-checks': 'M10 6h11 M10 12h11 M10 18h11 M3 6l1.5 1.5L7 5 M3 12l1.5 1.5L7 11 M3 18l1.5 1.5L7 17',
  tag: 'M20 12l-8 8-9-9V4h7l10 8z M7.5 7.5h.01',
  crosshair: 'M12 3v4 M12 17v4 M3 12h4 M17 12h4 M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
} as const

export type IconName = keyof typeof PATHS

export default function Icon({ name, className, ...rest }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
