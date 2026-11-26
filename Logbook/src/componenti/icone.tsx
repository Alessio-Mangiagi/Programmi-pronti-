// "><(((º> sabusabu <º)))><"
/**
 * Icone SVG lineari (tratto 1.5, stile Phosphor/Lucide) usate al posto delle emoji, come
 * chiede il design system Cosedil. Ereditano il colore del testo (currentColor).
 */
import type { SVGProps } from 'react';

const TRATTI = {
  dashboard: 'M4 13h6V4H4v9Zm10 7h6V11h-6v9ZM4 20h6v-4H4v4ZM14 4v4h6V4h-6Z',
  calendario: 'M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-12ZM4 10h16M8.5 3v4M15.5 3v4',
  dipendenti: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.5c1.8.8 3 2.6 3 4.7',
  progetti: 'M3.5 7.5A1.5 1.5 0 0 1 5 6h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18V7.5Z',
  assenze: 'M12 3v2M12 19v2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M3 12h2M19 12h2M5.6 18.4 7 17M17 7l1.4-1.4M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  importa: 'M12 3v12m0 0-4-4m4 4 4-4M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17',
  esporta: 'M12 15V3m0 0L8 7m4-4 4 4M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17',
  scarica: 'M12 4v11m0 0-4-4m4 4 4-4M5 20h14',
  stampa: 'M7 9V4h10v5M7 17H5.5A1.5 1.5 0 0 1 4 15.5v-5A1.5 1.5 0 0 1 5.5 9h13a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H17M7 14h10v6H7v-6Z',
  menu: 'M4 7h16M4 12h16M4 17h16',
  chiudi: 'M6 6l12 12M18 6 6 18',
  spunta: 'M5 12.5 10 17l9-10',
  aggiungi: 'M12 5v14M5 12h14',
  esci: 'M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15M10 16l4-4-4-4M14 12H4',
  // Giorno 37: mese chiuso.
  lucchetto: 'M7 11V8a5 5 0 0 1 10 0v3M6.5 11h11A1.5 1.5 0 0 1 19 12.5v6a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18.5v-6A1.5 1.5 0 0 1 6.5 11ZM12 15v2',
  chiave: 'M14.5 9.5a4 4 0 1 0-3.9 4L9 15h-2v2H5v2H3v-2.5l6.6-6.6a4 4 0 0 0 4.9-.4ZM15.5 7.5h.01',
  sinistra: 'M15 5l-7 7 7 7',
  destra: 'M9 5l7 7-7 7',
  avviso: 'M12 8v5M12 16.5h.01M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  // Giorno 15 (24/11/2026): impostazioni, file allegati, attestati.
  impostazioni:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 13.5l1.6 1.2-2 3.5-1.9-.7a7 7 0 0 1-1.7 1l-.3 2h-4l-.3-2a7 7 0 0 1-1.7-1l-1.9.7-2-3.5 1.6-1.2a7 7 0 0 1 0-3L3.2 9.3l2-3.5 1.9.7a7 7 0 0 1 1.7-1l.3-2h4l.3 2a7 7 0 0 1 1.7 1l1.9-.7 2 3.5-1.6 1.2a7 7 0 0 1 0 3Z',
  allegato: 'M20 11.5 12.5 19a5 5 0 0 1-7-7l8-8a3.3 3.3 0 0 1 4.7 4.7l-8 8a1.7 1.7 0 0 1-2.4-2.4L15 7',
  documento: 'M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7.5L14 3ZM14 3v4.5h4.5M9 13h6M9 16.5h6',
  attestato: 'M12 14a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM8.5 12.5 7 21l5-3 5 3-1.5-8.5',
  // Giorno 20: campanella delle segnalazioni (notifiche di HR).
  campanella: 'M6 9.5a6 6 0 1 1 12 0c0 4.5 2 6 2 6H4s2-1.5 2-6ZM10 19a2 2 0 0 0 4 0',
  // Giorno 34: registro attività (elenco puntato).
  registro: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
} as const;

export type NomeIcona = keyof typeof TRATTI;

export function Icona({ nome, dimensione = 18, ...props }: { nome: NomeIcona; dimensione?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={dimensione}
      height={dimensione}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={TRATTI[nome]} />
    </svg>
  );
}
