// "><(((º> sabusabu <º)))><"
/**
 * Pannello a destra del calendario, solo HR (Giorno 27, risposta 1a del 24/11/2026: "clic su
 * un giorno, oppure su più giorni tenendo premuto Ctrl o Maiusc; nel pannello a destra scegli
 * progetto, dipendenti e orari, che vengono inseriti su tutti i giorni scelti").
 *
 * - In cima i giorni scelti (si tolgono uno per uno). I giorni futuri, i sabati, le domeniche
 *   e i festivi restano elencati ma non ricevono ore: sono esclusi prima dell'invio.
 * - "Inserisci ore": progetto (scelta con ricerca), dipendenti ASSEGNATI a quel progetto e
 *   attivi (casella per ciascuno, filtro a caratteri se sono tanti), fasce orarie e nota.
 *   POST /api/registrazioni/blocco: le fasce si aggiungono a quelle già registrate; il
 *   server controlla ogni dipendente in ogni giorno e, con anche un solo problema, non
 *   inserisce nulla e risponde con l'elenco (chi, quale giorno, perché), mostrato qui.
 * - "Ore del giorno" (con un solo giorno scelto): chi ha lavorato e le assenze, con "Apri"
 *   che porta all'editor della giornata (correzioni, cancellazione di una fascia).
 */
import { useEffect, useMemo, useState } from 'react';
import { formattaData, giornoSettimana } from '../../comune/date';
import { formattaOre, isOrarioValido, durataMinuti } from '../../comune/orari';
import { coppieSovrapposte, type ProblemaBlocco } from '../../comune/registrazioni';
import { api, ErroreApi } from '../api';
import { COLORI_ASSENZA, coloreFascia, coloreProgetto } from '../colori';
import type { Assegnato, Progetto } from '../tipi';
import { Icona } from './icone';
import { corrisponde, SceltaConRicerca } from './SceltaConRicerca';
import { Avviso, classiInput, Pulsante } from './ui';

const GIORNI_BREVI = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];

/** Fascia o assenza del giorno, come le passa il calendario (solo i campi che servono qui). */
export type FasciaPannello = { id: number; dipendenteId: number; progettoId: number; oraInizio: string; oraFine: string; minuti: number; progetto: { codice: string; colore: string | null } };
export type AssenzaPannello = { id: number; dipendenteId: number; tipo: keyof typeof COLORI_ASSENZA; testo: string };

type Riga = { chiave: number; oraInizio: string; oraFine: string };
let contatore = 0;
const riga = (oraInizio: string, oraFine: string): Riga => ({ chiave: ++contatore, oraInizio, oraFine });

export function PannelloGiorni({
  giorni,
  motivoEscluso,
  progetti,
  progettoFiltrato,
  dipendenteFiltrato,
  nomi,
  dipendentiDelGiorno,
  fasceDelGiorno,
  assenzeDelGiorno,
  onTogli,
  onChiudi,
  onInserito,
  onApri,
}: {
  /** Giorni scelti, in ordine. */
  giorni: string[];
  /** Perché un giorno non riceve ore ("Giorno futuro", "Sabato", "Festività: …"), o null. */
  motivoEscluso: (data: string) => string | null;
  progetti: Progetto[];
  progettoFiltrato?: string;
  dipendenteFiltrato?: string;
  nomi: Map<number, string>;
  /** Con un solo giorno scelto: dipendenti da elencare in "Ore del giorno". */
  dipendentiDelGiorno: { id: number; nome: string }[];
  fasceDelGiorno: FasciaPannello[];
  assenzeDelGiorno: AssenzaPannello[];
  onTogli: (data: string) => void;
  onChiudi: () => void;
  onInserito: () => void;
  onApri: (dipendenteId: number, data: string) => void;
}) {
  const [progettoId, setProgettoId] = useState(progettoFiltrato ?? '');
  const [assegnati, setAssegnati] = useState<Assegnato[] | null>(null);
  const [scelti, setScelti] = useState<Set<number>>(new Set());
  const [filtro, setFiltro] = useState('');
  const [fasce, setFasce] = useState<Riga[]>(() => [riga('08:00', '12:00'), riga('13:00', '17:00')]);
  const [note, setNote] = useState('');
  const [invio, setInvio] = useState(false);
  const [esito, setEsito] = useState<{ tipo: 'successo' | 'errore'; testo: string; problemi?: ProblemaBlocco[]; altri?: number } | null>(null);

  const validi = giorni.filter((d) => !motivoEscluso(d));
  const esclusi = giorni.filter((d) => motivoEscluso(d));

  // Dipendenti assegnati al progetto scelto (solo questi possono ricevere ore, Giorno 17).
  useEffect(() => {
    setAssegnati(null);
    if (!progettoId) return;
    let attuale = true;
    api
      .get<Assegnato[]>(`/api/progetti/${progettoId}/dipendenti`)
      .then((elenco) => {
        if (!attuale) return;
        const attivi = elenco.filter((a) => a.dipendente.stato === 'ATTIVO');
        setAssegnati(attivi);
        // Col calendario filtrato su un dipendente, lui è già spuntato (se è nel progetto).
        setScelti(new Set(attivi.filter((a) => String(a.dipendente.id) === dipendenteFiltrato).map((a) => a.dipendente.id)));
      })
      .catch((e: Error) => attuale && setEsito({ tipo: 'errore', testo: e.message }));
    return () => {
      attuale = false;
    };
  }, [progettoId, dipendenteFiltrato]);

  const opzioniProgetti = useMemo(
    () => progetti.filter((p) => p.stato !== 'CHIUSO').map((p) => ({ valore: String(p.id), etichetta: `${p.codice} · ${p.nome}`, dettaglio: p.cliente ?? undefined, colore: coloreProgetto(p) })),
    [progetti],
  );
  const visibili = (assegnati ?? []).filter((a) => corrisponde(`${a.dipendente.cognome} ${a.dipendente.nome} ${a.dipendente.matricola} ${a.dipendente.codiceFiscale}`, filtro));
  const sovrapposte = new Set(coppieSovrapposte(fasce).flat());
  const fasceValide = fasce.length > 0 && fasce.every((f) => isOrarioValido(f.oraInizio) && isOrarioValido(f.oraFine) && f.oraFine > f.oraInizio) && sovrapposte.size === 0;
  const minutiGiorno = fasceValide ? fasce.reduce((s, f) => s + durataMinuti(f.oraInizio, f.oraFine), 0) : 0;
  const pronto = Boolean(progettoId) && scelti.size > 0 && validi.length > 0 && fasceValide && !invio;

  const aggiornaFascia = (chiave: number, campo: 'oraInizio' | 'oraFine', valore: string) => setFasce((ff) => ff.map((f) => (f.chiave === chiave ? { ...f, [campo]: valore } : f)));

  const inserisci = async () => {
    setEsito(null);
    setInvio(true);
    try {
      const r = await api.post<{ inserite: number; minuti: number }>('/api/registrazioni/blocco', {
        progettoId: Number(progettoId),
        dipendenteIds: [...scelti],
        date: validi,
        fasce: fasce.map(({ oraInizio, oraFine }) => ({ oraInizio, oraFine })),
        note,
      });
      setEsito({ tipo: 'successo', testo: `Inserite ${r.inserite} fasce, ${formattaOre(r.minuti)} ore in tutto.` });
      onInserito();
    } catch (e) {
      if (e instanceof ErroreApi) {
        const dati = e.dati as { problemi?: ProblemaBlocco[]; totaleProblemi?: number } | null;
        const problemi = dati?.problemi ?? [];
        setEsito({ tipo: 'errore', testo: e.message, problemi: problemi.slice(0, 15), altri: Math.max(0, (dati?.totaleProblemi ?? problemi.length) - 15) });
      } else setEsito({ tipo: 'errore', testo: String(e) });
    } finally {
      setInvio(false);
    }
  };

  const unGiorno = giorni.length === 1 ? giorni[0] : null;

  return (
    <aside aria-label="Giorni scelti" className="scheda min-w-0 space-y-4 p-3 sm:p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="sopratitolo">{giorni.length === 1 ? 'Giorno scelto' : `${giorni.length} giorni scelti`}</div>
          <p className="mt-0.5 text-xs text-gray-500">Ctrl+clic aggiunge o toglie un giorno, Maiusc+clic sceglie un intervallo.</p>
        </div>
        <button type="button" onClick={onChiudi} className="rounded p-1 text-gray-500 hover:bg-gray-100" aria-label="Chiudi il pannello e svuota la scelta">
          <Icona nome="chiudi" dimensione={16} />
        </button>
      </div>

      <ul className="flex flex-wrap gap-1.5" aria-label="Giorni">
        {giorni.map((d) => {
          const motivo = motivoEscluso(d);
          return (
            <li key={d} className={`cifre inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs ${motivo ? 'border-dashed border-gray-300 text-gray-400' : 'border-marchio/30 bg-ghiaccio text-marchio'}`} title={motivo ?? undefined}>
              {GIORNI_BREVI[giornoSettimana(d)]} {formattaData(d).slice(0, 5)}
              <button type="button" onClick={() => onTogli(d)} className="rounded hover:bg-white" aria-label={`Togli il ${formattaData(d)}`}>
                <Icona nome="chiudi" dimensione={12} />
              </button>
            </li>
          );
        })}
      </ul>
      {esclusi.length > 0 && (
        <Avviso tipo="info">
          Non ricevono ore: {esclusi.map((d) => `${formattaData(d).slice(0, 5)} (${motivoEscluso(d)!.toLowerCase()})`).join(', ')}.
        </Avviso>
      )}

      <section className="space-y-3 border-t border-gray-100 pt-3" aria-labelledby="titolo-inserisci">
        <h2 id="titolo-inserisci" className="text-sm font-semibold uppercase text-gray-500">
          Inserisci ore
        </h2>
        <div>
          <span className="mb-1 block text-xs font-semibold text-gray-600">Progetto</span>
          <SceltaConRicerca opzioni={opzioniProgetti} valore={progettoId} onCambia={setProgettoId} etichetta="Progetto" segnaposto="Cerca per codice, nome o cliente…" />
        </div>

        {progettoId && (
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-gray-600">Dipendenti assegnati {assegnati && `(${scelti.size}/${assegnati.length})`}</span>
              {assegnati && assegnati.length > 1 && (
                <span className="flex gap-2 text-xs">
                  <button type="button" className="text-marchio hover:underline" onClick={() => setScelti(new Set(visibili.map((a) => a.dipendente.id)))}>
                    Tutti
                  </button>
                  <button type="button" className="text-marchio hover:underline" onClick={() => setScelti(new Set())}>
                    Nessuno
                  </button>
                </span>
              )}
            </div>
            {assegnati && assegnati.length > 6 && (
              <input className={`${classiInput()} mb-1`} placeholder="Filtra per nome, matricola o codice fiscale…" value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Filtra i dipendenti" />
            )}
            {!assegnati && <p className="text-xs text-gray-500">Caricamento…</p>}
            {assegnati?.length === 0 && <Avviso tipo="attenzione">Nessun dipendente attivo è assegnato a questo progetto: assegnali dalla pagina del progetto.</Avviso>}
            <ul className="max-h-56 space-y-0.5 overflow-y-auto">
              {visibili.map((a) => (
                <li key={a.dipendente.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-ghiaccio">
                    <input
                      type="checkbox"
                      checked={scelti.has(a.dipendente.id)}
                      onChange={(e) =>
                        setScelti((s) => {
                          const n = new Set(s);
                          if (e.target.checked) n.add(a.dipendente.id);
                          else n.delete(a.dipendente.id);
                          return n;
                        })
                      }
                    />
                    <span className="min-w-0 flex-1 truncate">{nomi.get(a.dipendente.id) ?? `${a.dipendente.cognome} ${a.dipendente.nome}`}</span>
                    <span className="cifre text-xs text-gray-400">{a.dipendente.matricola}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <span className="mb-1 block text-xs font-semibold text-gray-600">Fasce orarie (uguali per tutti i giorni)</span>
          <ul className="space-y-1">
            {fasce.map((f, i) => (
              <li key={f.chiave} className="flex items-center gap-1.5">
                <input type="time" step={300} aria-label={`Inizio fascia ${i + 1}`} className={classiInput(sovrapposte.has(i) ? 'x' : undefined)} value={f.oraInizio} onChange={(e) => aggiornaFascia(f.chiave, 'oraInizio', e.target.value)} />
                <span className="text-gray-400">–</span>
                <input type="time" step={300} aria-label={`Fine fascia ${i + 1}`} className={classiInput(f.oraFine && f.oraInizio && f.oraFine <= f.oraInizio ? 'x' : undefined)} value={f.oraFine} onChange={(e) => aggiornaFascia(f.chiave, 'oraFine', e.target.value)} />
                <button type="button" className="rounded px-1.5 py-1 text-errore hover:bg-[#fdf3f2] disabled:invisible" disabled={fasce.length === 1} onClick={() => setFasce((ff) => ff.filter((x) => x.chiave !== f.chiave))} aria-label={`Togli fascia ${i + 1}`}>
                  <Icona nome="chiudi" dimensione={14} />
                </button>
              </li>
            ))}
          </ul>
          {sovrapposte.size > 0 && <p className="mt-0.5 text-xs text-errore">Le fasce si sovrappongono fra loro.</p>}
          {fasce.length < 6 && (
            <Pulsante variante="leggero" className="mt-1 !px-2 !py-0.5" onClick={() => setFasce((ff) => [...ff, riga(ff[ff.length - 1]?.oraFine || '08:00', '')])}>
              + Aggiungi fascia
            </Pulsante>
          )}
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-gray-600">Note (facoltative, su tutte le fasce)</span>
          <input className={classiInput()} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>

        {esito && (
          <Avviso tipo={esito.tipo}>
            {esito.testo}
            {esito.problemi && esito.problemi.length > 0 && (
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">
                {esito.problemi.map((p, i) => (
                  <li key={i}>
                    <b>{nomi.get(p.dipendenteId) ?? p.dipendente}</b>, {formattaData(p.data)}: {p.messaggio}
                  </li>
                ))}
                {(esito.altri ?? 0) > 0 && <li>…e altri {esito.altri}</li>}
              </ul>
            )}
          </Avviso>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3">
          <span className="cifre text-xs text-gray-600">
            {scelti.size} {scelti.size === 1 ? 'dipendente' : 'dipendenti'} × {validi.length} {validi.length === 1 ? 'giorno' : 'giorni'} × {formattaOre(minutiGiorno)} ={' '}
            <b className="text-marchio">{formattaOre(minutiGiorno * scelti.size * validi.length)} ore</b>
          </span>
          <Pulsante variante="primario" onClick={inserisci} disabled={!pronto}>
            {invio ? 'Inserimento…' : 'Inserisci'}
          </Pulsante>
        </div>
      </section>

      {unGiorno && (
        <section className="space-y-1 border-t border-gray-100 pt-3" aria-labelledby="titolo-ore-giorno">
          <h2 id="titolo-ore-giorno" className="text-sm font-semibold uppercase text-gray-500">
            Ore del {formattaData(unGiorno)}
          </h2>
          <ul className="cifre divide-y divide-gray-100 text-sm">
            {dipendentiDelGiorno.map((d) => {
              const sue = fasceDelGiorno.filter((f) => f.dipendenteId === d.id);
              const sueAssenze = assenzeDelGiorno.filter((x) => x.dipendenteId === d.id);
              return (
                <li key={d.id} className="flex items-start gap-2 py-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{d.nome}</div>
                    {sue.map((f) => (
                      <div key={f.id} className="flex items-center gap-1.5 text-xs text-gray-600">
                        <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: coloreFascia(f) }} />
                        {f.oraInizio}–{f.oraFine} {f.progetto.codice}
                      </div>
                    ))}
                    {sueAssenze.map((x) => (
                      <div key={x.id} className="text-xs" style={{ color: COLORI_ASSENZA[x.tipo].testo }}>
                        {x.testo}
                      </div>
                    ))}
                  </div>
                  <span className="w-12 text-right font-semibold">{formattaOre(sue.reduce((s, f) => s + f.minuti, 0))}</span>
                  <Pulsante variante="leggero" className="!px-2 !py-0.5" onClick={() => onApri(d.id, unGiorno)}>
                    Apri
                  </Pulsante>
                </li>
              );
            })}
            {dipendentiDelGiorno.length === 0 && <li className="py-2 text-xs text-gray-500">Nessun dipendente.</li>}
          </ul>
        </section>
      )}
    </aside>
  );
}
