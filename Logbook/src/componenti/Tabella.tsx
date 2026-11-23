// "><(((º> sabusabu <º)))><"
/**
 * Tabella da gestionale riusata in tutte le pagine: ricerca libera, ordinamento con
 * clic sull'intestazione (di nuovo = verso opposto) e paginazione.
 *
 * Lavora sui dati già caricati nel browser: per le anagrafiche di un'azienda (decine o
 * centinaia di righe) è immediato e non richiede altre API. Ogni colonna dice come
 * mostrarsi (`render`) e su quale valore ordinare (`valore`).
 */
import { useMemo, useState, type ReactNode } from 'react';

export type Colonna<T> = {
  chiave: string;
  titolo: string;
  /** Valore per l'ordinamento (e, se manca `render`, da mostrare). Assente = non ordinabile. */
  valore?: (riga: T) => string | number | null | undefined;
  render?: (riga: T) => ReactNode;
  allinea?: 'destra' | 'centro';
  classe?: string;
};

const normalizza = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function Tabella<T>({
  righe,
  colonne,
  chiaveRiga,
  testoRicerca,
  onRiga,
  perPagina = 20,
  vuoto = 'Nessun elemento',
  strumenti,
  ordinamentoIniziale,
}: {
  righe: T[];
  colonne: Colonna<T>[];
  chiaveRiga: (riga: T) => string | number;
  /** Testo su cui cercare per ogni riga (es. nome + cognome + matricola). Assente = niente ricerca. */
  testoRicerca?: (riga: T) => string;
  onRiga?: (riga: T) => void;
  perPagina?: number;
  vuoto?: string;
  /** Filtri o pulsanti extra accanto alla ricerca. */
  strumenti?: ReactNode;
  ordinamentoIniziale?: { chiave: string; verso: 1 | -1 };
}) {
  const [ricerca, setRicerca] = useState('');
  const [ordine, setOrdine] = useState(ordinamentoIniziale ?? null);
  const [pagina, setPagina] = useState(0);

  const filtrate = useMemo(() => {
    const parole = normalizza(ricerca).split(/\s+/).filter(Boolean);
    let risultato = righe;
    if (parole.length && testoRicerca) {
      // Tutte le parole devono comparire (in qualunque ordine): "rossi mario" trova Mario Rossi.
      risultato = righe.filter((r) => {
        const testo = normalizza(testoRicerca(r));
        return parole.every((p) => testo.includes(p));
      });
    }
    const colonna = ordine && colonne.find((c) => c.chiave === ordine.chiave);
    if (colonna?.valore) {
      const v = colonna.valore;
      risultato = [...risultato].sort((a, b) => {
        const x = v(a);
        const y = v(b);
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        const confronto = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'it', { numeric: true });
        return confronto * ordine!.verso;
      });
    }
    return risultato;
  }, [righe, ricerca, ordine, colonne, testoRicerca]);

  const pagine = Math.max(1, Math.ceil(filtrate.length / perPagina));
  const paginaVera = Math.min(pagina, pagine - 1);
  const visibili = filtrate.slice(paginaVera * perPagina, (paginaVera + 1) * perPagina);

  const ordinaPer = (c: Colonna<T>) => {
    if (!c.valore) return;
    setOrdine((o) => (o?.chiave === c.chiave ? { chiave: c.chiave, verso: o.verso === 1 ? -1 : 1 } : { chiave: c.chiave, verso: 1 }));
  };

  const allineamento = (c: Colonna<T>) => (c.allinea === 'destra' ? 'text-right' : c.allinea === 'centro' ? 'text-center' : 'text-left');

  return (
    <div>
      {(testoRicerca || strumenti) && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {testoRicerca && (
            <input
              type="search"
              placeholder="Cerca…"
              aria-label="Cerca nella tabella"
              value={ricerca}
              onChange={(e) => {
                setRicerca(e.target.value);
                setPagina(0);
              }}
              className="w-64 rounded border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-marchio focus:outline-none"
            />
          )}
          {strumenti}
          <span className="ml-auto text-xs text-gray-500">
            {filtrate.length} {filtrate.length === 1 ? 'elemento' : 'elementi'}
          </span>
        </div>
      )}
      <div className="overflow-x-auto scheda">
        <table className="cifre w-full text-sm">
          <thead className="intestazione-tabella">
            <tr>
              {colonne.map((c) => (
                <th
                  key={c.chiave}
                  scope="col"
                  className={`whitespace-nowrap border-b border-gray-200 px-3 py-2 font-semibold ${allineamento(c)} ${c.valore ? 'cursor-pointer select-none hover:text-marchio' : ''}`}
                  onClick={() => ordinaPer(c)}
                  aria-sort={ordine?.chiave === c.chiave ? (ordine.verso === 1 ? 'ascending' : 'descending') : undefined}
                >
                  {c.titolo}
                  {ordine?.chiave === c.chiave && <span className="ml-1">{ordine.verso === 1 ? '▲' : '▼'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibili.map((r) => (
              <tr
                key={chiaveRiga(r)}
                className={`border-b border-gray-100 last:border-0 odd:bg-white even:bg-fondo ${onRiga ? 'cursor-pointer hover:bg-ghiaccio' : ''}`}
                onClick={onRiga ? () => onRiga(r) : undefined}
              >
                {colonne.map((c) => (
                  <td key={c.chiave} className={`px-3 py-1.5 ${allineamento(c)} ${c.classe ?? ''}`}>
                    {c.render ? c.render(r) : (c.valore?.(r) ?? '')}
                  </td>
                ))}
              </tr>
            ))}
            {visibili.length === 0 && (
              <tr>
                <td colSpan={colonne.length} className="px-3 py-6 text-center text-gray-500">
                  {ricerca ? 'Nessun risultato per la ricerca' : vuoto}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pagine > 1 && (
        <div className="mt-2 flex items-center justify-end gap-2 text-sm">
          <button type="button" className="rounded border border-gray-300 bg-white px-2 py-1 disabled:opacity-40" disabled={paginaVera === 0} onClick={() => setPagina(paginaVera - 1)}>
            ‹ Precedente
          </button>
          <span className="text-gray-600">
            Pagina {paginaVera + 1} di {pagine}
          </span>
          <button
            type="button"
            className="rounded border border-gray-300 bg-white px-2 py-1 disabled:opacity-40"
            disabled={paginaVera >= pagine - 1}
            onClick={() => setPagina(paginaVera + 1)}
          >
            Successiva ›
          </button>
        </div>
      )}
    </div>
  );
}
