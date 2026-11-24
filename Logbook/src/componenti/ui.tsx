// "><(((º> sabusabu <º)))><"
/**
 * Componenti di base dell'interfaccia nello stile del marchio Cosedil (skill
 * Cosedilfrontend): bottoni Ubuntu maiuscoli blu #0c4577, campi con etichetta Inter e
 * bordo #d2d2d2, avvisi e etichette con i toni del marchio, schede con ombra blu diffusa,
 * caricamento a segnaposto. Tutte le pagine li usano, così l'aspetto resta uniforme.
 */
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icona } from './icone';

type VariantePulsante = 'primario' | 'secondario' | 'pericolo' | 'leggero';

const CLASSI_PULSANTE: Record<VariantePulsante, string> = {
  primario: 'bg-marchio text-white border-marchio hover:bg-marchio-hover hover:border-marchio-hover hover:-translate-y-px',
  secondario: 'bg-white text-marchio border-marchio hover:bg-marchio hover:text-white',
  pericolo: 'bg-white text-errore border-errore/60 hover:bg-errore hover:text-white hover:border-errore',
  leggero: 'bg-transparent text-marchio border-transparent hover:bg-ghiaccio normal-case tracking-normal',
};

export function Pulsante({
  variante = 'secondario',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: VariantePulsante }) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex items-center justify-center gap-1.5 rounded border px-3.5 py-1.5 font-display text-[0.8rem] font-medium uppercase tracking-[0.05em] transition-[transform,background-color,color,border-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marchio-chiaro ${CLASSI_PULSANTE[variante]} ${className}`}
    />
  );
}

/** Etichetta (Inter) + controllo + messaggio d'errore sotto. */
export function Campo({
  etichetta,
  errore,
  obbligatorio,
  aiuto,
  children,
  className = '',
}: {
  etichetta: string;
  errore?: string;
  obbligatorio?: boolean;
  aiuto?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1 block font-ui text-[0.82rem] font-semibold text-gray-600">
        {etichetta}
        {obbligatorio && <span className="text-errore"> *</span>}
      </span>
      {children}
      {aiuto && !errore && <span className="mt-0.5 block text-xs text-gray-500">{aiuto}</span>}
      {errore && <span className="mt-0.5 block text-xs text-errore">{errore}</span>}
    </label>
  );
}

/** Classi comuni di input, select e textarea (bordo rosso se c'è un errore). */
export const classiInput = (errore?: string) =>
  `w-full rounded border bg-white px-2.5 py-1.5 text-sm text-testo transition-colors focus:outline-none focus:ring-2 focus:ring-marchio-chiaro ${
    errore ? 'border-errore' : 'border-gray-300 focus:border-marchio-chiaro'
  }`;

type TipoAvviso = 'errore' | 'successo' | 'info' | 'attenzione';
const CLASSI_AVVISO: Record<TipoAvviso, string> = {
  errore: 'border-[#eba79f] bg-[#fbe4e1] text-[#8e2a1f]',
  successo: 'border-[#a9d7b5] bg-[#e7f4ea] text-[#2f6b40]',
  info: 'border-[#c9dcee] bg-ghiaccio text-marchio',
  attenzione: 'border-[#e9c46a] bg-[#fdf1d6] text-[#6b4a00]',
};

export function Avviso({ tipo = 'info', children, className = '' }: { tipo?: TipoAvviso; children: ReactNode; className?: string }) {
  return (
    <div role={tipo === 'errore' ? 'alert' : 'status'} className={`flex items-start gap-2 rounded border px-3 py-2 text-sm ${CLASSI_AVVISO[tipo]} ${className}`}>
      {(tipo === 'errore' || tipo === 'attenzione') && <Icona nome="avviso" dimensione={16} className="mt-0.5 shrink-0" />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Caricamento: segnaposto a righe con riflesso (skeleton), testo per i lettori di schermo. */
export function Caricamento({ testo = 'Caricamento…' }: { testo?: string }) {
  return (
    <div className="space-y-2 py-4" aria-live="polite" aria-busy="true">
      <span className="sr-only">{testo}</span>
      <div className="scheletro h-8 w-1/3" />
      <div className="scheletro h-4 w-full" />
      <div className="scheletro h-4 w-11/12" />
      <div className="scheletro h-4 w-4/5" />
    </div>
  );
}

/** Titolo della pagina con sopratitolo facoltativo e azioni a destra. */
export function IntestazionePagina({ titolo, sottotitolo, sopratitolo, azioni }: { titolo: string; sottotitolo?: string; sopratitolo?: string; azioni?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-bordo pb-3 sm:mb-5">
      <div className="min-w-0">
        {sopratitolo && <div className="sopratitolo mb-0.5">{sopratitolo}</div>}
        <h1 className="font-display text-[1.4rem] font-normal leading-tight tracking-[-0.01em] text-testo-forte sm:text-[1.65rem]">{titolo}</h1>
        {sottotitolo && <p className="mt-0.5 text-sm text-gray-500">{sottotitolo}</p>}
      </div>
      {azioni && <div className="flex flex-wrap items-center gap-2">{azioni}</div>}
    </div>
  );
}

/**
 * Finestra modale; Esc o clic sullo sfondo la chiudono.
 * Sul telefono occupa quasi tutto lo schermo (margini di 8px) e scorre in verticale;
 * da 640px in su è una finestra centrata larga al massimo `larghezza`.
 *
 * Si disegna direttamente in <body> (portale, Giorno 20): dentro un contenitore con
 * backdrop-filter o transform, come l'intestazione sfocata del Layout, una finestra "fixed"
 * resterebbe chiusa nel contenitore invece di coprire tutta la pagina.
 */
export function Modale({
  titolo,
  aperta,
  onChiudi,
  children,
  larghezza = 'max-w-lg',
}: {
  titolo: string;
  aperta: boolean;
  onChiudi: () => void;
  children: ReactNode;
  larghezza?: string;
}) {
  useEffect(() => {
    if (!aperta) return;
    const tasto = (e: KeyboardEvent) => e.key === 'Escape' && onChiudi();
    window.addEventListener('keydown', tasto);
    return () => window.removeEventListener('keydown', tasto);
  }, [aperta, onChiudi]);
  if (!aperta) return null;
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-[#212326]/45 p-2 sm:p-4 sm:pt-16" onMouseDown={onChiudi}>
      <div role="dialog" aria-modal="true" aria-label={titolo} className={`scheda w-full min-w-0 ${larghezza} shadow-[0_12px_40px_rgba(12,69,119,0.18)]`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 border-b border-bordo px-4 py-3 sm:px-5">
          <h2 className="min-w-0 font-display text-lg font-medium text-testo-forte">{titolo}</h2>
          <button type="button" onClick={onChiudi} className="shrink-0 rounded p-1 text-gray-500 transition-colors hover:bg-fondo-alt hover:text-testo-forte" aria-label="Chiudi">
            <Icona nome="chiudi" />
          </button>
        </div>
        <div className="p-4 sm:p-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/** Etichetta di stato a pillola (attivo, approvata, rifiutata, …) con i toni del marchio. */
export function Etichetta({ colore, children }: { colore: 'verde' | 'rosso' | 'giallo' | 'grigio' | 'blu'; children: ReactNode }) {
  const classi = {
    verde: 'bg-[#e7f4ea] text-verde-testo',
    rosso: 'bg-[#fbe4e1] text-[#8e2a1f]',
    giallo: 'bg-[#fdf1d6] text-[#6b4a00]',
    grigio: 'bg-fondo-alt text-gray-600',
    blu: 'bg-ghiaccio text-marchio',
  }[colore];
  return <span className={`inline-block rounded-full px-2 py-0.5 font-ui text-[0.72rem] font-semibold ${classi}`}>{children}</span>;
}

/** Placeholder per le pagine non ancora sviluppate (indica il giorno del piano). */
export function InArrivo({ titolo, giorno }: { titolo: string; giorno: number }) {
  return (
    <>
      <IntestazionePagina titolo={titolo} />
      <Avviso tipo="info">Questa sezione arriva al Giorno {giorno} del piano di sviluppo.</Avviso>
    </>
  );
}
