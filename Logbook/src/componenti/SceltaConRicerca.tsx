// "><(((º> sabusabu <º)))><"
/**
 * Campo di scelta con ricerca (combobox): al posto di un <select> lungo, si scrivono
 * alcune lettere e l'elenco si restringe (richiesta del 24/11/2026: "quando sono presenti
 * più soggetti dobbiamo poter filtrare tramite filtro a inserimento di caratteri").
 *
 * - Cerca su etichetta e dettaglio, senza badare ad accenti e maiuscole; tutte le parole
 *   scritte devono comparire, in qualunque ordine ("rossi ma" trova "Rossi Mario").
 * - Il dettaglio (es. matricola e codice fiscale) compare sotto l'etichetta: con due
 *   omonimi è quello che li distingue.
 * - Tastiera: frecce su/giù, Invio sceglie, Esc chiude. Clic fuori chiude senza cambiare.
 * - Accessibilità: role="combobox" + listbox (schema ARIA 1.2), l'opzione attiva è
 *   annunciata con aria-activedescendant.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { classiInput } from './ui';

type OpzioneRicerca = { valore: string; etichetta: string; dettaglio?: string; colore?: string };

/** Minuscole e senza accenti, per confronti "come li scrive una persona". */
const normalizzaRicerca = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** true se tutte le parole di `ricerca` compaiono in `testo`. */
export function corrisponde(testo: string, ricerca: string): boolean {
  const parole = normalizzaRicerca(ricerca).split(/\s+/).filter(Boolean);
  const t = normalizzaRicerca(testo);
  return parole.every((p) => t.includes(p));
}

export function SceltaConRicerca({
  opzioni,
  valore,
  onCambia,
  etichetta,
  segnaposto = 'Scrivi per cercare…',
  vuoto = 'Nessun risultato',
  errore,
  disattivato,
  massimo = 50,
}: {
  opzioni: OpzioneRicerca[];
  valore: string;
  onCambia: (valore: string) => void;
  /** Nome accessibile del campo (aria-label). */
  etichetta: string;
  segnaposto?: string;
  vuoto?: string;
  errore?: string;
  disattivato?: boolean;
  /** Righe mostrate al massimo (con migliaia di voci si continua a scrivere per restringere). */
  massimo?: number;
}) {
  const id = useId();
  const scelta = opzioni.find((o) => o.valore === valore);
  const [testo, setTesto] = useState('');
  const [aperto, setAperto] = useState(false);
  const [attiva, setAttiva] = useState(0);
  const contenitore = useRef<HTMLDivElement>(null);
  const elenco = useRef<HTMLUListElement>(null);

  const filtrate = useMemo(() => opzioni.filter((o) => corrisponde(`${o.etichetta} ${o.dettaglio ?? ''}`, testo)), [opzioni, testo]);
  const visibili = filtrate.slice(0, massimo);

  // Clic fuori: chiude e torna a mostrare la scelta corrente.
  useEffect(() => {
    if (!aperto) return;
    const fuori = (e: MouseEvent) => {
      if (!contenitore.current?.contains(e.target as Node)) {
        setAperto(false);
        setTesto('');
      }
    };
    document.addEventListener('mousedown', fuori);
    return () => document.removeEventListener('mousedown', fuori);
  }, [aperto]);

  // L'opzione attiva resta visibile quando ci si muove con le frecce.
  useEffect(() => {
    elenco.current?.querySelector(`[data-indice="${attiva}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [attiva]);

  const scegli = (o: OpzioneRicerca) => {
    onCambia(o.valore);
    setAperto(false);
    setTesto('');
  };

  const tasto = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAperto(true);
      setAttiva((i) => Math.min(i + 1, visibili.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setAttiva((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (aperto && visibili[attiva]) {
        e.preventDefault(); // non invia il modulo che contiene il campo
        scegli(visibili[attiva]);
      }
    } else if (e.key === 'Escape' && aperto) {
      e.stopPropagation(); // non chiude la finestra modale che contiene il campo
      setAperto(false);
      setTesto('');
    }
  };

  return (
    <div ref={contenitore} className="relative min-w-0">
      <div className="relative">
        {scelta?.colore && !aperto && <span className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 rounded-sm" style={{ backgroundColor: scelta.colore }} />}
        <input
          role="combobox"
          aria-label={etichetta}
          aria-expanded={aperto}
          aria-controls={`${id}-elenco`}
          aria-autocomplete="list"
          aria-activedescendant={aperto && visibili[attiva] ? `${id}-${attiva}` : undefined}
          disabled={disattivato}
          className={`${classiInput(errore)} pr-8 ${scelta?.colore && !aperto ? 'pl-7' : ''}`}
          placeholder={scelta ? scelta.etichetta : segnaposto}
          value={aperto ? testo : (scelta?.etichetta ?? '')}
          onFocus={() => {
            setAperto(true);
            setAttiva(0);
          }}
          onClick={() => setAperto(true)}
          onChange={(e) => {
            setTesto(e.target.value);
            setAperto(true);
            setAttiva(0);
          }}
          onKeyDown={tasto}
          autoComplete="off"
        />
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400" aria-hidden="true">
          ▾
        </span>
      </div>
      {aperto && (
        <ul
          ref={elenco}
          id={`${id}-elenco`}
          role="listbox"
          aria-label={etichetta}
          className="absolute left-0 right-0 z-30 mt-1 max-h-64 overflow-y-auto rounded border border-gray-200 bg-white py-1 text-sm shadow-[0_8px_24px_rgba(12,69,119,0.14)]"
        >
          {visibili.map((o, i) => (
            <li
              key={o.valore}
              id={`${id}-${i}`}
              data-indice={i}
              role="option"
              aria-selected={o.valore === valore}
              // mousedown e non click: arriva prima che il campo perda il fuoco.
              onMouseDown={(e) => {
                e.preventDefault();
                scegli(o);
              }}
              onMouseEnter={() => setAttiva(i)}
              className={`flex cursor-pointer items-start gap-2 px-2.5 py-1.5 ${i === attiva ? 'bg-ghiaccio' : ''} ${o.valore === valore ? 'font-semibold text-marchio' : 'text-testo'}`}
            >
              {o.colore && <span className="mt-1 h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: o.colore }} />}
              <span className="min-w-0">
                <span className="block truncate">{o.etichetta}</span>
                {o.dettaglio && <span className="block truncate text-xs font-normal text-gray-500">{o.dettaglio}</span>}
              </span>
            </li>
          ))}
          {visibili.length === 0 && <li className="px-2.5 py-2 text-gray-500">{vuoto}</li>}
          {filtrate.length > visibili.length && (
            <li className="px-2.5 py-1.5 text-xs text-gray-500">Altri {filtrate.length - visibili.length}: continua a scrivere per restringere</li>
          )}
        </ul>
      )}
    </div>
  );
}
