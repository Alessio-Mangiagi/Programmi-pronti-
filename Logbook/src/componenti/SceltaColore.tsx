// "><(((º> sabusabu <º)))><"
/**
 * Menu per scegliere il colore di un progetto nel calendario (richiesta del 24/11/2026:
 * "la scelta del colore deve avere un menù più simile esteticamente alla piattaforma").
 *
 * Sostituisce il selettore di sistema (<input type="color">, diverso in ogni browser e
 * fuori dallo stile Cosedil) con:
 * - un pulsante che sembra un campo del modulo: campione del colore, nome, freccia;
 * - un pannello a scheda (bordo chiaro, ombra blu) con i colori della tavolozza del
 *   marchio (COLORI_PROGETTO in src/colori.ts), ognuno col suo nome;
 * - "Automatico" (nessun colore salvato: lo sceglie Copilota dalla tavolozza, sempre lo
 *   stesso per progetto) e "Altro colore…" per un codice libero, se proprio serve.
 *
 * Valore: '' = automatico, altrimenti '#RRGGBB' (lo stesso formato che il server valida
 * in comune/schemi.ts, schemaProgetto.colore). Esc o un clic fuori chiudono il pannello.
 */
import { useEffect, useRef, useState } from 'react';
import { COLORI_PROGETTO, nomeColore } from '../colori';
import { Icona } from './icone';

export function SceltaColore({
  valore,
  onCambia,
  automatico,
  errore,
  etichetta = 'Colore nel calendario',
}: {
  valore: string;
  onCambia: (v: string) => void;
  /** Colore che Copilota userebbe con "Automatico" (per mostrarlo nel campione). */
  automatico: string;
  errore?: string;
  etichetta?: string;
}) {
  const [aperto, setAperto] = useState(false);
  const radice = useRef<HTMLDivElement>(null);
  const altro = useRef<HTMLInputElement>(null);

  // Chiusura con Esc o clic fuori dal componente.
  useEffect(() => {
    if (!aperto) return;
    const fuori = (e: MouseEvent) => {
      if (radice.current && !radice.current.contains(e.target as Node)) setAperto(false);
    };
    const tasto = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Esc chiude solo il menu, non la finestra del progetto che lo contiene.
        e.stopPropagation();
        setAperto(false);
      }
    };
    document.addEventListener('mousedown', fuori);
    window.addEventListener('keydown', tasto, true);
    return () => {
      document.removeEventListener('mousedown', fuori);
      window.removeEventListener('keydown', tasto, true);
    };
  }, [aperto]);

  const scegli = (v: string) => {
    onCambia(v);
    setAperto(false);
  };
  const mostrato = valore || automatico;

  return (
    <div ref={radice} className="relative">
      <button
        type="button"
        aria-label={`${etichetta}: ${valore ? nomeColore(valore) : 'automatico'}`}
        aria-haspopup="listbox"
        aria-expanded={aperto}
        onClick={() => setAperto((a) => !a)}
        className={`flex w-full items-center gap-2 rounded border bg-white px-2.5 py-1.5 text-left text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-marchio-chiaro ${
          errore ? 'border-errore' : 'border-gray-300 hover:border-marchio'
        }`}
      >
        <span className="h-4 w-4 shrink-0 rounded-sm ring-1 ring-black/10" style={{ backgroundColor: mostrato }} />
        <span className="min-w-0 flex-1 truncate">{valore ? nomeColore(valore) : 'Automatico'}</span>
        <span className={`text-gray-500 transition-transform duration-300 ${aperto ? 'rotate-180' : ''}`} aria-hidden="true">
          ▾
        </span>
      </button>

      {aperto && (
        <div
          role="listbox"
          aria-label={etichetta}
          className="scheda absolute right-0 z-50 mt-1 w-[19rem] max-w-[calc(100vw-2rem)] p-2 shadow-[0_8px_24px_rgba(12,69,119,0.14)]"
        >
          <div className="sopratitolo mb-1 px-2 pt-1 !text-gray-500">Colori del marchio</div>
          {/* Voci in flexbox su due colonne (campione + nome per esteso), come le voci dei menu della piattaforma. */}
          <div className="flex flex-wrap">
            {COLORI_PROGETTO.map((c) => {
              const scelto = valore.toLowerCase() === c.hex.toLowerCase();
              return (
                <button
                  key={c.hex}
                  type="button"
                  role="option"
                  aria-selected={scelto}
                  title={`${c.nome} (${c.hex})`}
                  onClick={() => scegli(c.hex)}
                  className={`flex min-w-0 basis-1/2 items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-ghiaccio focus:outline-none focus-visible:ring-2 focus-visible:ring-marchio-chiaro ${
                    scelto ? 'bg-ghiaccio font-semibold text-marchio' : 'text-testo'
                  }`}
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-white ring-1 ring-black/10" style={{ backgroundColor: c.hex }}>
                    {scelto && <Icona nome="spunta" dimensione={14} />}
                  </span>
                  <span className="min-w-0 truncate">{c.nome}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2 text-sm">
            <button
              type="button"
              role="option"
              aria-selected={!valore}
              onClick={() => scegli('')}
              className={`flex items-center gap-2 rounded px-2 py-1 transition-colors hover:bg-ghiaccio ${!valore ? 'font-semibold text-marchio' : 'text-gray-700'}`}
            >
              <span className="h-4 w-4 rounded-sm ring-1 ring-black/10" style={{ backgroundColor: automatico }} />
              Automatico
            </button>
            <button type="button" onClick={() => altro.current?.click()} className="ml-auto rounded px-2 py-1 text-marchio transition-colors hover:bg-ghiaccio">
              Altro colore…
            </button>
            {/* Selettore di sistema solo per i codici fuori tavolozza: nascosto, lo apre "Altro colore…". */}
            <input ref={altro} type="color" tabIndex={-1} aria-hidden="true" className="sr-only" value={mostrato} onChange={(e) => onCambia(e.target.value)} />
          </div>
        </div>
      )}
    </div>
  );
}
