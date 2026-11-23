// "><(((º> sabusabu <º)))><"
/**
 * Assenze: ferie, permessi e malattia, più (per HR) la gestione delle festività.
 *
 * - Dipendente ("Le mie assenze"): elenco delle proprie richieste con lo stato, nuova
 *   richiesta, modifica o ritiro finché è in attesa.
 * - HR: schede "Da approvare", "Tutte" e "Festività". Dalla richiesta si approva, si
 *   rifiuta (con motivo) o si modifica; si possono registrare assenze già approvate
 *   (es. malattia comunicata per telefono).
 *
 * Per la malattia il modulo chiede solo il protocollo del certificato: niente note,
 * nessuna informazione sanitaria (vedi comune/assenze.ts).
 */
import { useMemo, useState, type FormEvent } from 'react';
import { ETICHETTE_ASSENZA, ETICHETTE_FESTIVITA, ETICHETTE_STATO_ASSENZA, schemaAssenza, schemaFestivita, TIPI_ASSENZA, TIPI_FESTIVITA } from '../../comune/assenze';
import { DATA_MINIMA, formattaData, oggiIso } from '../../comune/date';
import { formattaOre } from '../../comune/orari';
import { erroriPerCampo } from '../../comune/schemi';
import { api, ErroreApi } from '../api';
import { useAuth } from '../auth';
import { COLORE_FESTIVITA, COLORI_ASSENZA } from '../colori';
import { Tabella, type Colonna } from '../componenti/Tabella';
import { Avviso, Caricamento, Campo, classiInput, Etichetta, IntestazionePagina, Modale, Pulsante } from '../componenti/ui';
import type { Assenza, Dipendente, Festivita, StatoAssenza } from '../tipi';
import { usaDati } from '../usaDati';

type AssenzaConGiorni = Assenza & { giorniLavorativi: number };

const COLORE_STATO: Record<StatoAssenza, 'giallo' | 'verde' | 'rosso'> = { RICHIESTA: 'giallo', APPROVATA: 'verde', RIFIUTATA: 'rosso' };

/** "dal 07/12 al 11/12/2026 (4 gg)" oppure "14/12/2026 · 2:00" per i permessi. */
function periodo(a: AssenzaConGiorni) {
  if (a.tipo === 'PERMESSO') return `${formattaData(a.dataInizio)} · ${formattaOre(a.minutiPermesso ?? 0)} h`;
  const gg = `${a.giorniLavorativi} ${a.giorniLavorativi === 1 ? 'giorno' : 'giorni'} lav.`;
  return a.dataInizio === a.dataFine ? `${formattaData(a.dataInizio)} (${gg})` : `${formattaData(a.dataInizio)} → ${formattaData(a.dataFine)} (${gg})`;
}

export function Assenze() {
  const { admin } = useAuth();
  const [scheda, setScheda] = useState<'attesa' | 'tutte' | 'festivita'>(admin ? 'attesa' : 'tutte');
  const { dati, errore, caricamento, ricarica } = usaDati<AssenzaConGiorni[]>('/api/assenze');
  const { dati: dipendenti } = usaDati<Dipendente[]>(admin ? '/api/dipendenti' : null);
  const [aperta, setAperta] = useState<AssenzaConGiorni | 'nuova' | null>(null);
  const [filtroTipo, setFiltroTipo] = useState('');

  const inAttesa = (dati ?? []).filter((a) => a.stato === 'RICHIESTA');
  const righe = (scheda === 'attesa' ? inAttesa : dati ?? []).filter((a) => !filtroTipo || a.tipo === filtroTipo);

  const colonne: Colonna<AssenzaConGiorni>[] = [
    ...(admin ? [{ chiave: 'dip', titolo: 'Dipendente', valore: (a: AssenzaConGiorni) => `${a.dipendente.cognome} ${a.dipendente.nome}` } satisfies Colonna<AssenzaConGiorni>] : []),
    {
      chiave: 'tipo',
      titolo: 'Tipo',
      valore: (a) => a.tipo,
      render: (a) => (
        <span className="rounded border px-1.5 py-0.5 text-xs" style={{ backgroundColor: COLORI_ASSENZA[a.tipo].sfondo, color: COLORI_ASSENZA[a.tipo].testo, borderColor: COLORI_ASSENZA[a.tipo].bordo }}>
          {ETICHETTE_ASSENZA[a.tipo]}
        </span>
      ),
    },
    { chiave: 'periodo', titolo: 'Periodo', valore: (a) => a.dataInizio, render: periodo },
    { chiave: 'note', titolo: 'Note', valore: (a) => a.noteDipendente ?? (a.protocolloCertificato ? `Prot. ${a.protocolloCertificato}` : null), classe: 'max-w-64 truncate' },
    { chiave: 'stato', titolo: 'Stato', valore: (a) => a.stato, render: (a) => <Etichetta colore={COLORE_STATO[a.stato]}>{ETICHETTE_STATO_ASSENZA[a.stato]}</Etichetta> },
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
            <Pulsante variante="primario" onClick={() => setAperta('nuova')}>
              {admin ? '+ Nuova assenza' : '+ Nuova richiesta'}
            </Pulsante>
          )
        }
      />
      {admin && (
        <div className="mb-3 flex gap-1 border-b border-gray-200" role="tablist">
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
              testoRicerca={admin ? (a) => `${a.dipendente.nome} ${a.dipendente.cognome} ${a.dipendente.matricola} ${a.noteDipendente ?? ''}` : undefined}
              onRiga={(a) => setAperta(a)}
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

      {aperta && (
        <ModuloAssenza
          assenza={aperta === 'nuova' ? null : aperta}
          dipendenti={dipendenti ?? []}
          onChiudi={() => setAperta(null)}
          onFatto={() => {
            setAperta(null);
            ricarica();
          }}
        />
      )}
    </>
  );
}

/** Creazione, modifica e (per HR) decisione su un'assenza. */
function ModuloAssenza({
  assenza, dipendenti, onChiudi, onFatto,
}: {
  assenza: AssenzaConGiorni | null; dipendenti: Dipendente[]; onChiudi: () => void; onFatto: () => void;
}) {
  const { admin } = useAuth();
  const modificabile = !assenza || admin || assenza.stato === 'RICHIESTA';
  const [m, setM] = useState({
    dipendenteId: assenza ? String(assenza.dipendenteId) : '',
    tipo: assenza?.tipo ?? 'FERIE',
    dataInizio: assenza?.dataInizio ?? oggiIso(),
    dataFine: assenza?.dataFine ?? oggiIso(),
    ore: assenza?.minutiPermesso ? String(assenza.minutiPermesso / 60) : '',
    noteDipendente: assenza?.noteDipendente ?? '',
    protocolloCertificato: assenza?.protocolloCertificato ?? '',
    noteHr: assenza?.noteHr ?? '',
    giaApprovata: false,
  });
  const [errori, setErrori] = useState<Record<string, string>>({});
  const [messaggio, setMessaggio] = useState<string | null>(null);

  const imposta = (campo: keyof typeof m, valore: string | boolean) => setM((x) => ({ ...x, [campo]: valore }));

  /** Corpo per le API: il permesso vale un giorno e ha la durata in minuti. */
  const corpo = () => ({
    ...(admin ? { dipendenteId: m.dipendenteId || undefined } : {}),
    tipo: m.tipo,
    dataInizio: m.dataInizio,
    dataFine: m.tipo === 'PERMESSO' ? m.dataInizio : m.dataFine,
    minutiPermesso: m.tipo === 'PERMESSO' && m.ore ? Math.round(Number(m.ore.replace(',', '.')) * 60) : null,
    noteDipendente: m.tipo === 'MALATTIA' ? null : m.noteDipendente,
    protocolloCertificato: m.tipo === 'MALATTIA' ? m.protocolloCertificato : null,
  });

  const esegui = async (azione: () => Promise<unknown>) => {
    setMessaggio(null);
    try {
      await azione();
      onFatto();
    } catch (err) {
      if (err instanceof ErroreApi) {
        setErrori(err.campi);
        setMessaggio(err.message);
      }
    }
  };

  const salva = (e: FormEvent) => {
    e.preventDefault();
    const c = corpo();
    const controllo = schemaAssenza.safeParse(c);
    if (!controllo.success) {
      setErrori(erroriPerCampo(controllo.error));
      return;
    }
    if (admin && !assenza && !m.dipendenteId) {
      setErrori({ dipendenteId: 'Scegli il dipendente' });
      return;
    }
    setErrori({});
    esegui(() =>
      assenza
        ? api.put(`/api/assenze/${assenza.id}`, { ...c, ...(admin ? { noteHr: m.noteHr } : {}) })
        : api.post('/api/assenze', { ...c, ...(m.giaApprovata ? { stato: 'APPROVATA' } : {}) }),
    );
  };

  const decidi = (stato: 'APPROVATA' | 'RIFIUTATA') => {
    if (stato === 'RIFIUTATA' && !m.noteHr.trim()) {
      setErrori({ noteHr: 'Indica il motivo del rifiuto' });
      return;
    }
    esegui(() => api.post(`/api/assenze/${assenza!.id}/decisione`, { stato, noteHr: m.noteHr }));
  };

  const elimina = () => {
    if (!window.confirm(admin ? 'Eliminare definitivamente questa assenza?' : 'Ritirare la richiesta?')) return;
    esegui(() => api.delete(`/api/assenze/${assenza!.id}`));
  };

  const titolo = assenza ? `${ETICHETTE_ASSENZA[assenza.tipo]} — ${assenza.dipendente.cognome} ${assenza.dipendente.nome}` : admin ? 'Nuova assenza' : 'Nuova richiesta';

  return (
    <Modale titolo={titolo} aperta onChiudi={onChiudi}>
      <form onSubmit={salva} className="space-y-3" noValidate>
        {messaggio && <Avviso tipo="errore">{messaggio}</Avviso>}
        {assenza && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Etichetta colore={COLORE_STATO[assenza.stato]}>{ETICHETTE_STATO_ASSENZA[assenza.stato]}</Etichetta>
            {assenza.decisoDa && assenza.decisoIl && (
              <span className="text-gray-500">
                da {assenza.decisoDa.username} il {formattaData(assenza.decisoIl.slice(0, 10))}
              </span>
            )}
          </div>
        )}
        {!modificabile && <Avviso tipo="info">La richiesta è già stata decisa: per cambiarla rivolgiti a HR.</Avviso>}

        <fieldset disabled={!modificabile} className="space-y-3">
          {admin && !assenza && (
            <Campo etichetta="Dipendente" obbligatorio errore={errori.dipendenteId}>
              <select className={classiInput(errori.dipendenteId)} value={m.dipendenteId} onChange={(e) => imposta('dipendenteId', e.target.value)}>
                <option value="">— scegli —</option>
                {dipendenti
                  .filter((d) => d.stato === 'ATTIVO')
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.cognome} {d.nome}
                    </option>
                  ))}
              </select>
            </Campo>
          )}
          <Campo etichetta="Tipo" obbligatorio errore={errori.tipo}>
            <div className="flex gap-2">
              {TIPI_ASSENZA.map((t) => (
                <label key={t} className={`flex-1 cursor-pointer rounded border px-3 py-1.5 text-center text-sm ${m.tipo === t ? 'border-marchio bg-marchio/10 font-semibold text-marchio' : 'border-gray-300'}`}>
                  <input type="radio" className="sr-only" name="tipo" checked={m.tipo === t} onChange={() => imposta('tipo', t)} />
                  {ETICHETTE_ASSENZA[t]}
                </label>
              ))}
            </div>
          </Campo>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo etichetta={m.tipo === 'PERMESSO' ? 'Giorno' : 'Dal'} obbligatorio errore={errori.dataInizio}>
              <input type="date" min={DATA_MINIMA} className={classiInput(errori.dataInizio)} value={m.dataInizio} onChange={(e) => imposta('dataInizio', e.target.value)} />
            </Campo>
            {m.tipo === 'PERMESSO' ? (
              <Campo etichetta="Durata (ore)" obbligatorio errore={errori.minutiPermesso} aiuto="Es. 2 oppure 1,5">
                <input inputMode="decimal" className={classiInput(errori.minutiPermesso)} value={m.ore} onChange={(e) => imposta('ore', e.target.value)} />
              </Campo>
            ) : (
              <Campo etichetta="Al" obbligatorio errore={errori.dataFine}>
                <input type="date" className={classiInput(errori.dataFine)} value={m.dataFine} min={m.dataInizio} onChange={(e) => imposta('dataFine', e.target.value)} />
              </Campo>
            )}
          </div>
          {m.tipo === 'MALATTIA' ? (
            <Campo etichetta="Protocollo del certificato medico" errore={errori.protocolloCertificato} aiuto="Solo il numero di protocollo: non indicare diagnosi o informazioni sanitarie">
              <input className={classiInput(errori.protocolloCertificato)} value={m.protocolloCertificato} onChange={(e) => imposta('protocolloCertificato', e.target.value)} />
            </Campo>
          ) : (
            <Campo etichetta="Note" errore={errori.noteDipendente}>
              <textarea rows={2} className={classiInput(errori.noteDipendente)} value={m.noteDipendente} onChange={(e) => imposta('noteDipendente', e.target.value)} maxLength={500} />
            </Campo>
          )}
        </fieldset>

        {admin && (
          <Campo etichetta="Note HR" errore={errori.noteHr} aiuto="Obbligatorie per rifiutare">
            <textarea rows={2} className={classiInput(errori.noteHr)} value={m.noteHr} onChange={(e) => imposta('noteHr', e.target.value)} maxLength={500} />
          </Campo>
        )}
        {!admin && assenza?.noteHr && <Avviso tipo="info">Note HR: {assenza.noteHr}</Avviso>}
        {admin && !assenza && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={m.giaApprovata} onChange={(e) => imposta('giaApprovata', e.target.checked)} />
            Registra come già approvata
          </label>
        )}

        <div className="flex flex-wrap justify-between gap-2 border-t border-gray-100 pt-3">
          <div className="flex gap-2">
            {assenza && (admin || assenza.stato === 'RICHIESTA') && (
              <Pulsante variante="pericolo" onClick={elimina}>
                {admin ? 'Elimina' : 'Ritira richiesta'}
              </Pulsante>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Pulsante onClick={onChiudi}>Chiudi</Pulsante>
            {modificabile && (
              <Pulsante type="submit" variante={admin && assenza?.stato === 'RICHIESTA' ? 'secondario' : 'primario'}>
                {assenza ? 'Salva modifiche' : admin ? 'Registra' : 'Invia richiesta'}
              </Pulsante>
            )}
            {admin && assenza && assenza.stato !== 'RIFIUTATA' && (
              <Pulsante variante="pericolo" onClick={() => decidi('RIFIUTATA')}>
                Rifiuta
              </Pulsante>
            )}
            {admin && assenza && assenza.stato !== 'APPROVATA' && (
              <Pulsante variante="primario" onClick={() => decidi('APPROVATA')}>
                Approva
              </Pulsante>
            )}
          </div>
        </div>
      </form>
    </Modale>
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

      <form onSubmit={aggiungi} className="flex flex-wrap items-end gap-2 rounded border border-gray-200 bg-white p-3" noValidate>
        <Campo etichetta="Data" errore={errori.data}>
          <input type="date" min={DATA_MINIMA} className={classiInput(errori.data)} value={nuova.data} onChange={(e) => setNuova({ ...nuova, data: e.target.value })} />
        </Campo>
        <Campo etichetta="Descrizione" errore={errori.descrizione} className="min-w-64 flex-1">
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
