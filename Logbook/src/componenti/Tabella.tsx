// "><(((º> sabusabu <º)))><"
/**
 * Tabella da gestionale riusata in tutte le pagine: ricerca libera, ordinamento con
 * clic sull'intestazione (di nuovo = verso opposto) e paginazione.
 *
 * Lavora sui dati già caricati nel browser: per le anagrafiche di un'azienda (decine o
 * centinaia di righe) è immediato e non richiede altre API. Ogni colonna dice come
 * mostrarsi (`render`) e su quale valore ordinare (`valore`).
 *
 * Sul telefono (sotto i 640px) la tabella diventa un elenco di schede: la colonna
 * `principale` (o la prima) fa da titolo, le altre seguono come "etichetta: valore" e vanno a capo da sole
 * (flexbox). L'ordinamento si sceglie da un menu, perché non ci sono intestazioni da
 * cliccare. Da 640px in su resta la tabella classica, larga quanto lo spazio disponibile.
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
  /** Titolo della scheda sul telefono (es. il nome del dipendente). Assente = la prima colonna. */
  principale?: boolean;
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
  const ordinabili = colonne.filter((c) => c.valore);
  const titolo = colonne.find((c) => c.principale) ?? colonne[0];
  const dettagli = colonne.filter((c) => c !== titolo);
  const contenuto = (c: Colonna<T>, r: T) => (c.render ? c.render(r) : (c.valore?.(r) ?? ''));
  const nessuna = ricerca ? 'Nessun risultato per la ricerca' : vuoto;

  return (
    <div>
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
            className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-marchio focus:outline-none sm:w-64"
          />
        )}
        {strumenti}
        {/* Solo sul telefono: le intestazioni non ci sono, l'ordinamento si sceglie qui. */}
        {ordinabili.length > 0 && (
          <select
            aria-label="Ordina per"
            className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm sm:hidden"
            value={ordine ? `${ordine.chiave}:${ordine.verso}` : ''}
            onChange={(e) => {
              const [chiave, verso] = e.target.value.split(':');
              setOrdine(chiave ? { chiave, verso: Number(verso) as 1 | -1 } : null);
            }}
          >
            <option value="">Ordine: come arriva</option>
            {ordinabili.flatMap((c) => [
              <option key={`${c.chiave}:1`} value={`${c.chiave}:1`}>
                {c.titolo} ▲
              </option>,
              <option key={`${c.chiave}:-1`} value={`${c.chiave}:-1`}>
                {c.titolo} ▼
              </option>,
            ])}
          </select>
        )}
        <span className="ml-auto text-xs text-gray-500">
          {filtrate.length} {filtrate.length === 1 ? 'elemento' : 'elementi'}
        </span>
      </div>

      {/* Telefono: una scheda per riga. */}
      <ul className="space-y-2 sm:hidden">
        {visibili.map((r) => (
          <li
            key={chiaveRiga(r)}
            data-scheda-riga
            className={`scheda px-3 py-2 text-sm ${onRiga ? 'cursor-pointer active:bg-ghiaccio' : ''}`}
            onClick={onRiga ? () => onRiga(r) : undefined}
          >
            {titolo && <div className="font-semibold text-testo-forte">{contenuto(titolo, r)}</div>}
            <dl className="cifre mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {dettagli.map((c) => (
                <div key={c.chiave} className="flex min-w-0 max-w-full items-baseline gap-1.5">
                  <dt className="shrink-0 font-ui text-[0.68rem] font-semibold uppercase tracking-[0.03em] text-gray-500">{c.titolo}</dt>
                  <dd className="min-w-0 break-words">{contenuto(c, r)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
        {visibili.length === 0 && <li className="scheda px-3 py-6 text-center text-sm text-gray-500">{nessuna}</li>}
      </ul>

      {/* Da 640px: tabella classica. */}
      <div className="hidden overflow-x-auto scheda sm:block">
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
                    {contenuto(c, r)}
                  </td>
                ))}
              </tr>
            ))}
            {visibili.length === 0 && (
              <tr>
                <td colSpan={colonne.length} className="px-3 py-6 text-center text-gray-500">
                  {nessuna}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {pagine > 1 && (
        <div className="mt-2 flex flex-wrap items-center justify-end gap-2 text-sm">
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
