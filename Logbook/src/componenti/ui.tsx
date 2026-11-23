// "><(((º> sabusabu <º)))><"
/**
 * Componenti di base dell'interfaccia, stile gestionale (denso, bordi netti, colori
 * del marchio): pulsanti, campi dei moduli con errore, avvisi, caricamento, finestre.
 * Tutte le pagine li usano, così l'aspetto resta uniforme.
 */
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';

type VariantePulsante = 'primario' | 'secondario' | 'pericolo' | 'leggero';

const CLASSI_PULSANTE: Record<VariantePulsante, string> = {
  primario: 'bg-marchio text-white hover:bg-marchio-scuro border-marchio',
  secondario: 'bg-white text-gray-800 hover:bg-gray-50 border-gray-300',
  pericolo: 'bg-white text-red-700 hover:bg-red-50 border-red-300',
  leggero: 'bg-transparent text-marchio hover:bg-marchio/10 border-transparent',
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
      className={`inline-flex items-center justify-center gap-1.5 rounded border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${CLASSI_PULSANTE[variante]} ${className}`}
    />
  );
}

/** Etichetta + controllo + messaggio d'errore sotto (in rosso). */
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
      <span className="mb-1 block font-medium text-gray-700">
        {etichetta}
        {obbligatorio && <span className="text-red-600"> *</span>}
      </span>
      {children}
      {aiuto && !errore && <span className="mt-0.5 block text-xs text-gray-500">{aiuto}</span>}
      {errore && <span className="mt-0.5 block text-xs text-red-700">{errore}</span>}
    </label>
  );
}

/** Classi comuni di input, select e textarea (bordo rosso se c'è un errore). */
export const classiInput = (errore?: string) =>
  `w-full rounded border bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-marchio/30 ${
    errore ? 'border-red-400' : 'border-gray-300 focus:border-marchio'
  }`;

type TipoAvviso = 'errore' | 'successo' | 'info' | 'attenzione';
const CLASSI_AVVISO: Record<TipoAvviso, string> = {
  errore: 'border-red-300 bg-red-50 text-red-800',
  successo: 'border-green-300 bg-green-50 text-green-800',
  info: 'border-blue-200 bg-blue-50 text-blue-900',
  attenzione: 'border-amber-300 bg-amber-50 text-amber-900',
};

export function Avviso({ tipo = 'info', children, className = '' }: { tipo?: TipoAvviso; children: ReactNode; className?: string }) {
  return (
    <div role={tipo === 'errore' ? 'alert' : 'status'} className={`rounded border px-3 py-2 text-sm ${CLASSI_AVVISO[tipo]} ${className}`}>
      {children}
    </div>
  );
}

export function Caricamento({ testo = 'Caricamento…' }: { testo?: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-gray-500" aria-live="polite">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-marchio" />
      {testo}
    </div>
  );
}

/** Titolo della pagina con azioni a destra (es. "Nuovo dipendente"). */
export function IntestazionePagina({ titolo, sottotitolo, azioni }: { titolo: string; sottotitolo?: string; azioni?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-gray-200 pb-3">
      <div>
        <h1 className="text-xl font-semibold text-marchio">{titolo}</h1>
        {sottotitolo && <p className="text-sm text-gray-500">{sottotitolo}</p>}
      </div>
      {azioni && <div className="flex flex-wrap gap-2">{azioni}</div>}
    </div>
  );
}

/** Finestra modale semplice; Esc o clic sullo sfondo la chiudono. */
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
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-16" onMouseDown={onChiudi}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titolo}
        className={`w-full ${larghezza} rounded bg-white shadow-xl`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2.5">
          <h2 className="font-semibold text-marchio">{titolo}</h2>
          <button type="button" onClick={onChiudi} className="rounded px-2 text-xl leading-none text-gray-500 hover:bg-gray-100" aria-label="Chiudi">
            ×
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

/** Etichetta colorata per stati (attivo, approvata, rifiutata, …). */
export function Etichetta({ colore, children }: { colore: 'verde' | 'rosso' | 'giallo' | 'grigio' | 'blu'; children: ReactNode }) {
  const classi = {
    verde: 'bg-green-100 text-green-800',
    rosso: 'bg-red-100 text-red-800',
    giallo: 'bg-amber-100 text-amber-900',
    grigio: 'bg-gray-100 text-gray-700',
    blu: 'bg-blue-100 text-blue-800',
  }[colore];
  return <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${classi}`}>{children}</span>;
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
