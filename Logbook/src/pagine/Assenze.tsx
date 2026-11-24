// "><(((º> sabusabu <º)))><"
/**
 * Assenze: ferie, permessi e malattia, più (per HR) la gestione delle festività.
 *
 * - Dipendente ("Le mie assenze"): elenco delle proprie richieste con lo stato.
 * - HR: schede "Da approvare", "Tutte" e "Festività"; ricerca a caratteri su nome,
 *   matricola, codice fiscale e note; omonimi distinti dal codice fiscale.
 * "+ Nuova" e il clic su una riga aprono la pagina dell'assenza (pagine/SchedaAssenza.tsx,
 * Giorno 18: prima era una finestra), dove si richiede, modifica, approva o rifiuta.
 *
 * Collegamenti dalla Dashboard (24/11/2026): `?apri=<id>` porta alla pagina di quella
 * richiesta, `?scheda=festivita|tutte` sceglie la scheda.
 */
import { useMemo, useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ETICHETTE_ASSENZA, ETICHETTE_FESTIVITA, ETICHETTE_STATO_ASSENZA, schemaFestivita, TIPI_ASSENZA, TIPI_FESTIVITA } from '../../comune/assenze';
import { DATA_MINIMA, formattaData, oggiIso } from '../../comune/date';
import { erroriPerCampo } from '../../comune/schemi';
import { api, ErroreApi } from '../api';
import { useAuth } from '../auth';
import { COLORE_FESTIVITA } from '../colori';
import { Tabella, type Colonna } from '../componenti/Tabella';
import { Avviso, Caricamento, Campo, classiInput, Etichetta, IntestazionePagina, Pulsante } from '../componenti/ui';
import { nomiSenzaOmonimie } from '../../comune/omonimi';
import type { Dipendente, Festivita } from '../tipi';
import { usaDati } from '../usaDati';
import { ChipTipoAssenza, COLORE_STATO_ASSENZA, periodoAssenza, type AssenzaConGiorni } from './SchedaAssenza';

export function Assenze() {
  const { admin } = useAuth();
  const naviga = useNavigate();
  const [parametri] = useSearchParams();
  const [scheda, setScheda] = useState<'attesa' | 'tutte' | 'festivita'>(() => {
    const richiesta = parametri.get('scheda');
    if (admin && richiesta === 'festivita') return 'festivita';
    return richiesta === 'tutte' || !admin ? 'tutte' : 'attesa';
  });
  const { dati, errore, caricamento } = usaDati<AssenzaConGiorni[]>('/api/assenze');
  const { dati: dipendenti } = usaDati<Dipendente[]>(admin ? '/api/dipendenti' : null);
  const [filtroTipo, setFiltroTipo] = useState('');
  // Nomi senza ambiguità (omonimi distinti dal codice fiscale) e codici fiscali per la ricerca.
  const nomi = useMemo(() => nomiSenzaOmonimie(dipendenti ?? []), [dipendenti]);
  const codiciFiscali = useMemo(() => new Map((dipendenti ?? []).map((d) => [d.id, d.codiceFiscale])), [dipendenti]);

  // ?apri=<id> (dalla Dashboard): porta alla pagina di quella richiesta.
  const daAprire = Number(parametri.get('apri')) || null;
  if (daAprire) return <Navigate to={`/assenze/${daAprire}`} replace />;

  const inAttesa = (dati ?? []).filter((a) => a.stato === 'RICHIESTA');
  const righe = (scheda === 'attesa' ? inAttesa : dati ?? []).filter((a) => !filtroTipo || a.tipo === filtroTipo);

  const colonne: Colonna<AssenzaConGiorni>[] = [
    ...(admin
      ? [{ chiave: 'dip', titolo: 'Dipendente', valore: (a: AssenzaConGiorni) => nomi.get(a.dipendenteId) ?? `${a.dipendente.cognome} ${a.dipendente.nome}`, principale: true } satisfies Colonna<AssenzaConGiorni>]
      : []),
    { chiave: 'tipo', titolo: 'Tipo', valore: (a) => a.tipo, render: (a) => <ChipTipoAssenza tipo={a.tipo} /> },
    { chiave: 'periodo', titolo: 'Periodo', valore: (a) => a.dataInizio, render: periodoAssenza },
    { chiave: 'note', titolo: 'Note', valore: (a) => a.noteDipendente ?? (a.protocolloCertificato ? `Prot. ${a.protocolloCertificato}` : null), classe: 'max-w-64 truncate' },
    { chiave: 'stato', titolo: 'Stato', valore: (a) => a.stato, render: (a) => <Etichetta colore={COLORE_STATO_ASSENZA[a.stato]}>{ETICHETTE_STATO_ASSENZA[a.stato]}</Etichetta> },
    { chiave: 'hr', titolo: 'Note HR', valore: (a) => a.noteHr, classe: 'max-w-64 truncate text-gray-600' },
    { chiave: 'richiesta', titolo: 'Richiesta il', valore: (a) => a.creatoIl, render: (a) => formattaData(a.creatoIl.slice(0, 10)) },
  ];

  return (
    <>
      <IntestazionePagina
        titolo={admin ? 'Assenze' : 'Le mie assenze'}
        sottotitolo={admin ? 'Richieste di ferie, permessi e malattia; festività' : 'Richiedi ferie, permessi o comunica la malattia'}
        azioni={
          scheda !== 'festivita' && (
            <Pulsante variante="primario" onClick={() => naviga('/assenze/nuova')}>
              {admin ? '+ Nuova assenza' : '+ Nuova richiesta'}
            </Pulsante>
          )
        }
      />
      {admin && (
        // Sul telefono le tre schede possono non starci: la barra scorre in orizzontale invece di sforare.
        <div className="mb-3 flex gap-1 overflow-x-auto whitespace-nowrap border-b border-gray-200" role="tablist">
          {(
            [
              ['attesa', `Da approvare (${inAttesa.length})`],
              ['tutte', 'Tutte le assenze'],
              ['festivita', 'Festività'],
            ] as const
          ).map(([chiave, etichetta]) => (
            <button
              key={chiave}
              type="button"
              role="tab"
              aria-selected={scheda === chiave}
              onClick={() => setScheda(chiave)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm ${scheda === chiave ? 'border-marchio font-semibold text-marchio' : 'border-transparent text-gray-600 hover:text-marchio'}`}
            >
              {etichetta}
            </button>
          ))}
        </div>
      )}

      {scheda === 'festivita' ? (
        <GestioneFestivita />
      ) : (
        <>
          {errore && <Avviso tipo="errore">{errore}</Avviso>}
          {caricamento && !dati && <Caricamento />}
          {dati && (
            <Tabella
              righe={righe}
              colonne={colonne}
              chiaveRiga={(a) => a.id}
              testoRicerca={(a) => `${a.dipendente.nome} ${a.dipendente.cognome} ${a.dipendente.matricola} ${codiciFiscali.get(a.dipendenteId) ?? ''} ${ETICHETTE_ASSENZA[a.tipo]} ${a.noteDipendente ?? ''}`}
              onRiga={(a) => naviga(`/assenze/${a.id}`)}
              vuoto={scheda === 'attesa' ? 'Nessuna richiesta da approvare' : 'Nessuna assenza'}
              strumenti={
                <select aria-label="Filtra per tipo" className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm" value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
                  <option value="">Tutti i tipi</option>
                  {TIPI_ASSENZA.map((t) => (
                    <option key={t} value={t}>
                      {ETICHETTE_ASSENZA[t]}
                    </option>
                  ))}
                </select>
              }
            />
          )}
        </>
      )}

    </>
  );
}

/** Scheda Festività (solo HR): elenco per anno, aggiunta, cancellazione, nazionali in un clic. */
function GestioneFestivita() {
  const [anno, setAnno] = useState(Number(oggiIso().slice(0, 4)));
  const { dati, errore, caricamento, ricarica } = usaDati<Festivita[]>(`/api/festivita?anno=${anno}`);
  const [nuova, setNuova] = useState({ data: `${anno}-01-01`, descrizione: '', tipo: 'LOCALE' });
  const [errori, setErrori] = useState<Record<string, string>>({});
  const [messaggio, setMessaggio] = useState<{ tipo: 'errore' | 'successo'; testo: string } | null>(null);

  const anni = useMemo(() => {
    const corrente = Number(oggiIso().slice(0, 4));
    return [corrente - 1, corrente, corrente + 1, corrente + 2];
  }, []);

  const esegui = async (azione: () => Promise<string | void>) => {
    setMessaggio(null);
    try {
      const testo = await azione();
      if (testo) setMessaggio({ tipo: 'successo', testo });
      ricarica();
    } catch (err) {
      if (err instanceof ErroreApi) {
        setErrori(err.campi);
        setMessaggio({ tipo: 'errore', testo: err.message });
      }
    }
  };

  const aggiungi = (e: FormEvent) => {
    e.preventDefault();
    const controllo = schemaFestivita.safeParse(nuova);
    if (!controllo.success) {
      setErrori(erroriPerCampo(controllo.error));
      return;
    }
    setErrori({});
    esegui(async () => {
      await api.post('/api/festivita', nuova);
      setNuova({ ...nuova, descrizione: '' });
      return 'Festività aggiunta';
    });
  };

  const colonne: Colonna<Festivita>[] = [
    { chiave: 'data', titolo: 'Data', valore: (f) => f.data, render: (f) => formattaData(f.data) },
    { chiave: 'giorno', titolo: 'Giorno', render: (f) => new Intl.DateTimeFormat('it-IT', { weekday: 'long' }).format(new Date(`${f.data}T12:00:00`)) },
    { chiave: 'descrizione', titolo: 'Descrizione', valore: (f) => f.descrizione },
    {
      chiave: 'tipo',
      titolo: 'Tipo',
      valore: (f) => f.tipo,
      render: (f) => (
        <span className="rounded px-1.5 py-0.5 text-xs" style={{ backgroundColor: COLORE_FESTIVITA.sfondo, color: COLORE_FESTIVITA.testo }}>
          {ETICHETTE_FESTIVITA[f.tipo]}
        </span>
      ),
    },
    {
      chiave: 'azioni',
      titolo: '',
      allinea: 'destra',
      render: (f) => (
        <Pulsante
          variante="leggero"
          onClick={() => window.confirm(`Eliminare "${f.descrizione}" del ${formattaData(f.data)}?`) && esegui(async () => void (await api.delete(`/api/festivita/${f.id}`)))}
        >
          Elimina
        </Pulsante>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Anno" className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm" value={anno} onChange={(e) => setAnno(Number(e.target.value))}>
          {anni.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <Pulsante onClick={() => esegui(async () => `Festività nazionali ${anno}: ${(await api.post<{ aggiunte: number }>('/api/festivita/carica-nazionali', { anno })).aggiunte} aggiunte`)}>
          Carica festività nazionali {anno}
        </Pulsante>
      </div>
      {messaggio && <Avviso tipo={messaggio.tipo}>{messaggio.testo}</Avviso>}

      <form onSubmit={aggiungi} className="flex flex-wrap items-end gap-2 scheda p-3" noValidate>
        <Campo etichetta="Data" errore={errori.data}>
          <input type="date" min={DATA_MINIMA} className={classiInput(errori.data)} value={nuova.data} onChange={(e) => setNuova({ ...nuova, data: e.target.value })} />
        </Campo>
        <Campo etichetta="Descrizione" errore={errori.descrizione} className="min-w-0 flex-[1_1_14rem]">
          <input className={classiInput(errori.descrizione)} placeholder="Es. Santo patrono" value={nuova.descrizione} onChange={(e) => setNuova({ ...nuova, descrizione: e.target.value })} />
        </Campo>
        <Campo etichetta="Tipo" errore={errori.tipo}>
          <select className={classiInput(errori.tipo)} value={nuova.tipo} onChange={(e) => setNuova({ ...nuova, tipo: e.target.value })}>
            {TIPI_FESTIVITA.map((t) => (
              <option key={t} value={t}>
                {ETICHETTE_FESTIVITA[t]}
              </option>
            ))}
          </select>
        </Campo>
        <Pulsante type="submit" variante="primario">
          Aggiungi
        </Pulsante>
      </form>

      {errore && <Avviso tipo="errore">{errore}</Avviso>}
      {caricamento && !dati && <Caricamento />}
      {dati && <Tabella righe={dati} colonne={colonne} chiaveRiga={(f) => f.id} perPagina={40} vuoto={`Nessuna festività nel ${anno}`} />}
    </div>
  );
}
