// "><(((º> sabusabu <º)))><"
/**
 * Registro attività (Giorno 34, 25/11/2026: "registro attività deve essere visibile nella
 * barra sinistra solo ad admin").
 *
 * Elenco, dal più recente, di accessi riusciti e falliti, blocchi per troppi tentativi, cambi
 * password, ruoli dati o tolti e di ogni operazione che modifica o esporta dati, con chi l'ha
 * fatta, quando e da quale indirizzo. Serve a capire cosa è successo dopo un problema.
 * Si legge soltanto: nessuno può correggere o cancellare righe dall'interfaccia. Le righe
 * restano 400 giorni. API: GET /api/registro (server/servizi/registro.ts), solo amministratori.
 */
import { useState, type FormEvent } from 'react';
import { Avviso, Caricamento, Campo, classiInput, Etichetta, IntestazionePagina, Pulsante } from '../componenti/ui';
import { usaDati } from '../usaDati';

type Riga = { id: number; quando: string; username: string; azione: string; dettaglio: string | null; esito: 'OK' | 'NEGATO' | 'ERRORE'; ip: string | null };
type Risposta = { totale: number; pagina: number; perPagina: number; righe: Riga[] };

const quando = (iso: string) =>
  new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function Registro() {
  const [filtri, setFiltri] = useState({ testo: '', esito: '', da: '', a: '' });
  const [applicati, setApplicati] = useState(filtri);
  const [pagina, setPagina] = useState(1);
  const parametri = new URLSearchParams({ pagina: String(pagina) });
  for (const [k, v] of Object.entries(applicati)) if (v) parametri.set(k, v);
  const { dati, errore, ricarica } = usaDati<Risposta>(`/api/registro?${parametri}`);

  const cerca = (e: FormEvent) => {
    e.preventDefault();
    setPagina(1);
    setApplicati(filtri);
  };
  const pagine = dati ? Math.max(1, Math.ceil(dati.totale / dati.perPagina)) : 1;

  return (
    <>
      <IntestazionePagina
        titolo="Registro attività"
        sopratitolo="Amministrazione"
        sottotitolo="Accessi e operazioni degli ultimi 400 giorni, dal più recente. Visibile solo agli amministratori"
        azioni={<Pulsante onClick={ricarica}>Aggiorna</Pulsante>}
      />
      <form onSubmit={cerca} className="scheda mb-4 flex flex-wrap items-end gap-3 p-3">
        <Campo etichetta="Cerca (utente, azione)" className="min-w-0 flex-[1_1_14rem]">
          <input className={classiInput()} value={filtri.testo} maxLength={60} onChange={(e) => setFiltri({ ...filtri, testo: e.target.value })} placeholder="es. mario.rossi, Accesso, Ore" />
        </Campo>
        <Campo etichetta="Esito" className="w-40">
          <select className={classiInput()} value={filtri.esito} onChange={(e) => setFiltri({ ...filtri, esito: e.target.value })}>
            <option value="">Tutti</option>
            <option value="OK">Riuscite</option>
            <option value="NEGATO">Negate o fallite</option>
            <option value="ERRORE">Errori</option>
          </select>
        </Campo>
        <Campo etichetta="Dal" className="w-40">
          <input type="date" className={classiInput()} value={filtri.da} onChange={(e) => setFiltri({ ...filtri, da: e.target.value })} />
        </Campo>
        <Campo etichetta="Al" className="w-40">
          <input type="date" className={classiInput()} value={filtri.a} onChange={(e) => setFiltri({ ...filtri, a: e.target.value })} />
        </Campo>
        <Pulsante type="submit" variante="primario">
          Cerca
        </Pulsante>
      </form>

      {errore && <Avviso tipo="errore">{errore}</Avviso>}
      {!dati && !errore && <Caricamento />}
      {dati && (
        <div className="scheda overflow-x-auto">
          <table className="w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="bg-fondo-alt text-left font-ui text-[0.72rem] font-semibold uppercase tracking-[0.04em] text-gray-600">
                <th className="px-3 py-2">Quando</th>
                <th className="px-3 py-2">Utente</th>
                <th className="px-3 py-2">Azione</th>
                <th className="px-3 py-2">Dettaglio</th>
                <th className="px-3 py-2">Esito</th>
                <th className="px-3 py-2">Indirizzo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {dati.righe.map((r) => (
                <tr key={r.id} className="hover:bg-ghiaccio">
                  <td className="cifre whitespace-nowrap px-3 py-1.5 text-gray-600">{quando(r.quando)}</td>
                  <td className="px-3 py-1.5 font-semibold text-testo-forte">{r.username}</td>
                  <td className="px-3 py-1.5">{r.azione}</td>
                  <td className="max-w-[22rem] truncate px-3 py-1.5 text-gray-500" title={r.dettaglio ?? undefined}>
                    {r.dettaglio}
                  </td>
                  <td className="px-3 py-1.5">
                    {r.esito === 'OK' ? <Etichetta colore="verde">Riuscita</Etichetta> : r.esito === 'NEGATO' ? <Etichetta colore="rosso">Negata</Etichetta> : <Etichetta colore="giallo">Errore</Etichetta>}
                  </td>
                  <td className="cifre whitespace-nowrap px-3 py-1.5 text-gray-500">{r.ip}</td>
                </tr>
              ))}
              {dati.righe.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-gray-500">
                    Nessuna attività con questi filtri.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-3 py-2 text-sm text-gray-600">
            <span>
              <b className="cifre">{dati.totale}</b> righe · pagina <b className="cifre">{dati.pagina}</b> di <b className="cifre">{pagine}</b>
            </span>
            <span className="flex gap-2">
              <Pulsante onClick={() => setPagina((p) => p - 1)} disabled={pagina <= 1}>
                Più recenti
              </Pulsante>
              <Pulsante onClick={() => setPagina((p) => p + 1)} disabled={pagina >= pagine}>
                Più vecchie
              </Pulsante>
            </span>
          </div>
        </div>
      )}
    </>
  );
}
