// "><(((º> sabusabu <º)))><"
/**
 * Calendario: vista principale di Logbook, per mese o per settimana.
 *
 * - Ogni giorno mostra le ore per progetto (colore del progetto), le assenze (colori per
 *   tipo; tratteggiate se ancora in attesa), le festività e il totale del giorno.
 * - Filtri: dipendente (solo HR; "Tutti" somma tutti), progetto, tipo di assenza.
 *   Col filtro progetto i totali sono le ore di quel progetto (li calcola il server).
 * - Clic su un giorno: con un dipendente scelto si apre l'editor della giornata; con
 *   "Tutti" si apre il riepilogo del giorno per dipendente, da cui si entra nell'editor.
 *
 * Dati: GET /api/calendario (server/rotte/calendario.ts).
 */
import { useMemo, useState } from 'react';
import { aggiungiGiorni, dataIso, formattaData, giorniNelMese, isFineSettimana, oggiIso } from '../../comune/date';
import { formattaOre } from '../../comune/orari';
import { calcolaTotali, inizioSettimana } from '../../comune/riepiloghi';
import { useAuth } from '../auth';
import { COLORE_FESTIVITA, COLORI_ASSENZA, coloreFascia, coloreProgetto } from '../colori';
import { EditorGiornata } from '../componenti/EditorGiornata';
import { Avviso, Caricamento, IntestazionePagina, Modale, Pulsante } from '../componenti/ui';
import type { Dipendente, Festivita, Progetto, StatoAssenza, TipoAssenza } from '../tipi';
import { usaDati } from '../usaDati';

type FasciaCal = {
  id: number; dipendenteId: number; progettoId: number; data: string; oraInizio: string; oraFine: string; note: string | null; minuti: number;
  progetto: { codice: string; nome: string; colore: string | null }; dipendente: { nome: string; cognome: string };
};
type AssenzaCal = {
  id: number; dipendenteId: number; tipo: TipoAssenza; dataInizio: string; dataFine: string; minutiPermesso: number | null; stato: StatoAssenza;
  dipendente: { nome: string; cognome: string };
};
type RispostaCalendario = {
  da: string; a: string; fasce: FasciaCal[]; assenze: AssenzaCal[]; festivita: Festivita[];
  totali: { perGiorno: Record<string, number>; perProgetto: Record<string, number>; totale: number };
};

const NOMI_GIORNI = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
const nomeMese = (anno: number, mese: number) => new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' }).format(new Date(anno, mese - 1, 1));
const breve = (p: { nome: string; cognome: string }) => `${p.cognome} ${p.nome[0]}.`;

/** Etichetta di un'assenza nella cella: tipo, eventuale durata del permesso, chi. */
function testoAssenza(a: AssenzaCal, conNome: boolean) {
  const base = COLORI_ASSENZA[a.tipo].etichetta + (a.tipo === 'PERMESSO' && a.minutiPermesso ? ` ${formattaOre(a.minutiPermesso)}` : '');
  return `${base}${conNome ? ` · ${breve(a.dipendente)}` : ''}${a.stato === 'RICHIESTA' ? ' (in attesa)' : ''}`;
}

export function Calendario() {
  const { utente, admin } = useAuth();
  const [vista, setVista] = useState<'mese' | 'settimana'>('mese');
  const [riferimento, setRiferimento] = useState(oggiIso());
  const [dipendenteId, setDipendenteId] = useState<string>(admin ? '' : String(utente?.dipendenteId ?? ''));
  const [progettoId, setProgettoId] = useState('');
  const [tipoAssenza, setTipoAssenza] = useState('');
  const [giornoAperto, setGiornoAperto] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ dipendenteId: number; nome: string; data: string } | null>(null);

  const [anno, mese] = riferimento.split('-').map(Number);
  const primoDelMese = dataIso(anno, mese, 1);
  const ultimoDelMese = dataIso(anno, mese, giorniNelMese(anno, mese));
  const da = vista === 'mese' ? inizioSettimana(primoDelMese) : inizioSettimana(riferimento);
  const a = vista === 'mese' ? aggiungiGiorni(inizioSettimana(ultimoDelMese), 6) : aggiungiGiorni(da, 6);

  const query = new URLSearchParams({ da, a });
  if (dipendenteId) query.set('dipendenteId', dipendenteId);
  if (progettoId) query.set('progettoId', progettoId);
  if (tipoAssenza) query.set('tipoAssenza', tipoAssenza);
  const { dati, errore, caricamento, ricarica } = usaDati<RispostaCalendario>(`/api/calendario?${query}`);
  const { dati: progetti } = usaDati<Progetto[]>('/api/progetti');
  const { dati: dipendenti } = usaDati<Dipendente[]>(admin ? '/api/dipendenti' : null);

  const giorni = useMemo(() => {
    const elenco: string[] = [];
    for (let d = da; d <= a; d = aggiungiGiorni(d, 1)) elenco.push(d);
    return elenco;
  }, [da, a]);

  // Indici per giorno: fasce, assenze, festività.
  const perGiorno = useMemo(() => {
    const fasce = new Map<string, FasciaCal[]>();
    for (const f of dati?.fasce ?? []) fasce.set(f.data, [...(fasce.get(f.data) ?? []), f]);
    const festivita = new Map((dati?.festivita ?? []).map((f) => [f.data, f]));
    const assenze = (d: string) => (dati?.assenze ?? []).filter((x) => x.dataInizio <= d && d <= x.dataFine);
    return { fasce, festivita, assenze };
  }, [dati]);

  // Totali del solo mese visualizzato (la griglia include giorni dei mesi vicini).
  const totaliPeriodo = useMemo(() => {
    const fasce = (dati?.fasce ?? []).filter((f) => vista === 'settimana' || (f.data >= primoDelMese && f.data <= ultimoDelMese));
    return calcolaTotali(fasce);
  }, [dati, vista, primoDelMese, ultimoDelMese]);

  const sposta = (verso: 1 | -1) => {
    if (vista === 'settimana') setRiferimento(aggiungiGiorni(riferimento, 7 * verso));
    else setRiferimento(dataIso(mese + verso > 12 ? anno + 1 : mese + verso < 1 ? anno - 1 : anno, ((mese + verso + 11) % 12) + 1, 1));
  };

  const nomeDipendenteScelto = () => {
    if (!admin) return utente!.nomeVisualizzato;
    const d = dipendenti?.find((x) => String(x.id) === dipendenteId);
    return d ? `${d.nome} ${d.cognome}` : '';
  };

  const apriGiorno = (data: string) => {
    if (dipendenteId) setEditor({ dipendenteId: Number(dipendenteId), nome: nomeDipendenteScelto(), data });
    else setGiornoAperto(data);
  };

  /** Righe informative per l'editor: festività e assenze di quel dipendente in quel giorno. */
  const avvisiGiorno = (data: string, idDip: number) => {
    const avvisi: { tipo: 'info' | 'attenzione'; testo: string }[] = [];
    const fest = perGiorno.festivita.get(data);
    if (fest) avvisi.push({ tipo: 'attenzione', testo: `Festività: ${fest.descrizione}` });
    for (const x of perGiorno.assenze(data).filter((x) => x.dipendenteId === idDip)) {
      avvisi.push({ tipo: x.stato === 'APPROVATA' ? 'attenzione' : 'info', testo: `${testoAssenza(x, false)}${x.stato === 'APPROVATA' ? ' — approvata' : ''}` });
    }
    return avvisi;
  };

  const periodo = vista === 'mese' ? nomeMese(anno, mese) : `${formattaData(da)} – ${formattaData(a)}`;
  const oggi = oggiIso();

  return (
    <>
      <IntestazionePagina titolo="Calendario" sottotitolo={admin ? 'Ore e assenze di tutti i dipendenti' : 'Le tue ore e le tue assenze'} />

      {/* Barra degli strumenti: vista, navigazione, filtri */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded border border-gray-200 bg-white p-2">
        <div className="inline-flex overflow-hidden rounded border border-gray-300 text-sm" role="group" aria-label="Vista">
          {(['mese', 'settimana'] as const).map((v) => (
            <button key={v} type="button" onClick={() => setVista(v)} className={`px-3 py-1.5 capitalize ${vista === v ? 'bg-marchio text-white' : 'bg-white hover:bg-gray-50'}`}>
              {v}
            </button>
          ))}
        </div>
        <Pulsante onClick={() => sposta(-1)} aria-label="Periodo precedente">‹</Pulsante>
        <Pulsante onClick={() => setRiferimento(oggiIso())}>Oggi</Pulsante>
        <Pulsante onClick={() => sposta(1)} aria-label="Periodo successivo">›</Pulsante>
        <span className="min-w-44 px-2 font-semibold capitalize text-marchio">{periodo}</span>

        <div className="ml-auto flex flex-wrap items-center gap-2 text-sm">
          {admin && (
            <select aria-label="Dipendente" className="rounded border border-gray-300 px-2 py-1.5" value={dipendenteId} onChange={(e) => setDipendenteId(e.target.value)}>
              <option value="">Tutti i dipendenti</option>
              {dipendenti?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.cognome} {d.nome}
                  {d.stato === 'CESSATO' ? ' (cessato)' : ''}
                </option>
              ))}
            </select>
          )}
          <select aria-label="Progetto" className="rounded border border-gray-300 px-2 py-1.5" value={progettoId} onChange={(e) => setProgettoId(e.target.value)}>
            <option value="">Tutti i progetti</option>
            {progetti?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.codice} · {p.nome}
              </option>
            ))}
          </select>
          <select aria-label="Tipo di assenza" className="rounded border border-gray-300 px-2 py-1.5" value={tipoAssenza} onChange={(e) => setTipoAssenza(e.target.value)}>
            <option value="">Tutte le assenze</option>
            <option value="FERIE">Solo ferie</option>
            <option value="PERMESSO">Solo permessi</option>
            <option value="MALATTIA">Solo malattia</option>
            <option value="NESSUNA">Nascondi assenze</option>
          </select>
        </div>
      </div>

      {errore && <Avviso tipo="errore">{errore}</Avviso>}
      {!dati && caricamento && <Caricamento />}

      {dati && (
        <div className={caricamento ? 'opacity-60 transition-opacity' : ''}>
          <div className="grid grid-cols-7 overflow-hidden rounded-t border border-gray-200 bg-gray-50 text-center text-xs font-semibold uppercase text-gray-600">
            {NOMI_GIORNI.map((g) => (
              <div key={g} className="py-1.5">
                {g}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 border-l border-gray-200">
            {giorni.map((d) => {
              const fuoriMese = vista === 'mese' && (d < primoDelMese || d > ultimoDelMese);
              const fest = perGiorno.festivita.get(d);
              const fasce = perGiorno.fasce.get(d) ?? [];
              const assenze = perGiorno.assenze(d);
              const totale = dati.totali.perGiorno[d] ?? 0;
              // Ore per progetto nel giorno (vista mese) o fasce una per una (vista settimana).
              const perProgetto = new Map<number, { minuti: number; f: FasciaCal }>();
              for (const f of fasce) perProgetto.set(f.progettoId, { minuti: (perProgetto.get(f.progettoId)?.minuti ?? 0) + f.minuti, f });
              return (
                <button
                  type="button"
                  key={d}
                  onClick={() => apriGiorno(d)}
                  aria-label={`${formattaData(d)}: ${formattaOre(totale)} ore`}
                  className={`flex flex-col gap-0.5 border-b border-r border-gray-200 p-1 text-left align-top text-xs hover:bg-marchio/5 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-marchio/40 ${
                    vista === 'mese' ? 'min-h-24' : 'min-h-64'
                  } ${fuoriMese ? 'bg-gray-50 text-gray-400' : isFineSettimana(d) || fest ? 'bg-gray-50/80' : 'bg-white'}`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`cifre font-semibold ${d === oggi ? 'rounded bg-marchio px-1.5 text-white' : ''}`}>
                      {vista === 'settimana' ? formattaData(d).slice(0, 5) : Number(d.slice(8))}
                    </span>
                    {totale > 0 && <span className="cifre font-bold text-marchio">{formattaOre(totale)}</span>}
                  </div>
                  {fest && (
                    <span className="truncate rounded px-1" style={{ backgroundColor: COLORE_FESTIVITA.sfondo, color: COLORE_FESTIVITA.testo }} title={fest.descrizione}>
                      {fest.descrizione}
                    </span>
                  )}
                  {assenze.map((x) => (
                    <span
                      key={x.id}
                      className="truncate rounded border px-1"
                      title={testoAssenza(x, true)}
                      style={{
                        backgroundColor: COLORI_ASSENZA[x.tipo].sfondo,
                        color: COLORI_ASSENZA[x.tipo].testo,
                        borderColor: COLORI_ASSENZA[x.tipo].bordo,
                        borderStyle: x.stato === 'RICHIESTA' ? 'dashed' : 'solid',
                      }}
                    >
                      {testoAssenza(x, !dipendenteId)}
                    </span>
                  ))}
                  {vista === 'mese'
                    ? [...perProgetto.values()].map(({ minuti, f }) => (
                        <span key={f.progettoId} className="flex items-center justify-between gap-1 truncate rounded px-1 text-white" style={{ backgroundColor: coloreFascia(f) }} title={`${f.progetto.codice} ${f.progetto.nome}`}>
                          <span className="truncate">{f.progetto.codice}</span>
                          <span className="cifre">{formattaOre(minuti)}</span>
                        </span>
                      ))
                    : fasce.map((f) => (
                        <span key={f.id} className="rounded border-l-4 bg-gray-50 px-1 py-0.5 text-gray-800" style={{ borderLeftColor: coloreFascia(f) }} title={f.note ?? undefined}>
                          <span className="cifre block font-medium">
                            {f.oraInizio}–{f.oraFine}
                          </span>
                          <span className="block truncate">{f.progetto.codice}{!dipendenteId && ` · ${breve(f.dipendente)}`}</span>
                        </span>
                      ))}
                </button>
              );
            })}
          </div>

          {/* Totali del periodo e legenda dei colori */}
          <div className="mt-3 flex flex-wrap items-start gap-4 rounded border border-gray-200 bg-white p-3 text-sm">
            <div>
              <div className="text-xs uppercase text-gray-500">Totale {vista === 'mese' ? 'del mese' : 'della settimana'}</div>
              <div className="cifre text-xl font-semibold text-marchio">{formattaOre(totaliPeriodo.totale)}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {progetti
                ?.filter((p) => totaliPeriodo.perProgetto[p.id])
                .map((p) => (
                  <span key={p.id} className="inline-flex items-center gap-1.5 rounded border border-gray-200 px-2 py-1">
                    <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: coloreProgetto(p) }} />
                    {p.codice}
                    <span className="cifre font-semibold">{formattaOre(totaliPeriodo.perProgetto[p.id])}</span>
                  </span>
                ))}
            </div>
            <div className="ml-auto flex flex-wrap gap-2 text-xs">
              {(Object.keys(COLORI_ASSENZA) as TipoAssenza[]).map((t) => (
                <span key={t} className="rounded border px-1.5 py-0.5" style={{ backgroundColor: COLORI_ASSENZA[t].sfondo, color: COLORI_ASSENZA[t].testo, borderColor: COLORI_ASSENZA[t].bordo }}>
                  {COLORI_ASSENZA[t].etichetta}
                </span>
              ))}
              <span className="rounded px-1.5 py-0.5" style={{ backgroundColor: COLORE_FESTIVITA.sfondo, color: COLORE_FESTIVITA.testo }}>
                Festività
              </span>
              <span className="rounded border border-dashed border-gray-400 px-1.5 py-0.5 text-gray-600">In attesa</span>
            </div>
          </div>
        </div>
      )}

      {giornoAperto && dati && (
        <RiepilogoGiorno
          data={giornoAperto}
          fasce={perGiorno.fasce.get(giornoAperto) ?? []}
          assenze={perGiorno.assenze(giornoAperto)}
          festivita={perGiorno.festivita.get(giornoAperto)}
          dipendenti={(dipendenti ?? []).filter((d) => d.stato === 'ATTIVO' || (perGiorno.fasce.get(giornoAperto) ?? []).some((f) => f.dipendenteId === d.id))}
          onChiudi={() => setGiornoAperto(null)}
          onModifica={(d) => {
            setGiornoAperto(null);
            setEditor({ dipendenteId: d.id, nome: `${d.nome} ${d.cognome}`, data: giornoAperto });
          }}
        />
      )}

      {editor && (
        <EditorGiornata
          dipendenteId={editor.dipendenteId}
          nomeDipendente={editor.nome}
          data={editor.data}
          avvisi={avvisiGiorno(editor.data, editor.dipendenteId)}
          onChiudi={() => setEditor(null)}
          onSalvato={() => {
            setEditor(null);
            ricarica();
          }}
        />
      )}
    </>
  );
}

/** Riepilogo di un giorno con tutti i dipendenti (vista HR "Tutti"). */
function RiepilogoGiorno({
  data, fasce, assenze, festivita, dipendenti, onChiudi, onModifica,
}: {
  data: string; fasce: FasciaCal[]; assenze: AssenzaCal[]; festivita?: Festivita; dipendenti: Dipendente[];
  onChiudi: () => void; onModifica: (d: Dipendente) => void;
}) {
  return (
    <Modale titolo={`Giorno ${formattaData(data)}`} aperta onChiudi={onChiudi} larghezza="max-w-2xl">
      {festivita && <Avviso tipo="attenzione" className="mb-3">Festività: {festivita.descrizione}</Avviso>}
      <table className="cifre w-full text-sm">
        <thead className="text-xs uppercase text-gray-500">
          <tr>
            <th className="py-1 text-left">Dipendente</th>
            <th className="py-1 text-left">Fasce</th>
            <th className="py-1 text-right">Ore</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {dipendenti.map((d) => {
            const sue = fasce.filter((f) => f.dipendenteId === d.id);
            const sueAssenze = assenze.filter((x) => x.dipendenteId === d.id);
            return (
              <tr key={d.id} className="border-t border-gray-100 align-top">
                <td className="py-1.5 font-medium">
                  {d.cognome} {d.nome}
                </td>
                <td className="py-1.5">
                  {sue.map((f) => (
                    <div key={f.id} className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: coloreFascia(f) }} />
                      {f.oraInizio}–{f.oraFine} {f.progetto.codice}
                    </div>
                  ))}
                  {sueAssenze.map((x) => (
                    <div key={x.id} style={{ color: COLORI_ASSENZA[x.tipo].testo }}>
                      {testoAssenza(x, false)}
                    </div>
                  ))}
                  {sue.length === 0 && sueAssenze.length === 0 && <span className="text-gray-400">—</span>}
                </td>
                <td className="py-1.5 text-right font-semibold">{formattaOre(sue.reduce((s, f) => s + f.minuti, 0))}</td>
                <td className="py-1.5 pl-2 text-right">
                  <Pulsante variante="leggero" onClick={() => onModifica(d)}>
                    Modifica
                  </Pulsante>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Modale>
  );
}
