// "><(((º> sabusabu <º)))><"
/**
 * Pagina del progetto (/progetti/nuovo, /progetti/:id), Giorno 17 (24/11/2026): "l'inserimento
 * progetto deve aprire una nuova pagina in cui sono presenti anche le note e la
 * documentazione del progetto". Tutto sulla stessa pagina, senza schede: le sezioni si
 * affiancano in due colonne flex quando c'è spazio e si impilano sul telefono.
 *
 * HR (admin):
 * - Dati del progetto (codice, nome, cliente, stato, date, ore massime, colore, descrizione,
 *   commessa SkyTower) con "Salva" e "Chiudi progetto";
 * - Dipendenti assegnati: si aggiungono uno alla volta con la scelta a ricerca (risposta 2a:
 *   solo gli assegnati registrano ore) e si tolgono (le ore fatte restano);
 * - Avanzamento e Documentazione (componenti/DocumentazioneProgetto.tsx);
 * - Note interne, visibili solo a HR.
 * Dipendente: dati in sola lettura, il suo avanzamento e la sua documentazione.
 *
 * Un progetto nuovo mostra solo i dati: il resto compare dopo il primo salvataggio.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { DATA_MINIMA, formattaData, oggiIso } from '../../comune/date';
import { formattaOre } from '../../comune/orari';
import { erroriPerCampo, schemaProgetto, STATI_PROGETTO } from '../../comune/schemi';
import { api, ErroreApi } from '../api';
import { useAuth } from '../auth';
import { coloreProgetto } from '../colori';
import { DocumentazioneProgetto } from '../componenti/DocumentazioneProgetto';
import { SceltaColore } from '../componenti/SceltaColore';
import { corrisponde, SceltaConRicerca } from '../componenti/SceltaConRicerca';
import { Avviso, Caricamento, Campo, classiInput, Etichetta, IntestazionePagina, Pulsante } from '../componenti/ui';
import { dettaglioDipendente, nomiSenzaOmonimie } from '../omonimi';
import type { Assegnato, Dipendente, Impostazioni, NotaProgetto, Progetto } from '../tipi';
import { usaDati } from '../usaDati';

export const ETICHETTE_STATO_PROGETTO: Record<Progetto['stato'], { testo: string; colore: 'verde' | 'giallo' | 'grigio' }> = {
  ATTIVO: { testo: 'Attivo', colore: 'verde' },
  SOSPESO: { testo: 'Sospeso', colore: 'giallo' },
  CHIUSO: { testo: 'Chiuso', colore: 'grigio' },
};

/** Valori del modulo; `maxOre` è il testo del campo in ore ("9" o "7,5"), convertito in minuti all'invio. */
type Modulo = {
  codice: string; nome: string; cliente: string; dataInizio: string; dataFine: string; stato: Progetto['stato'];
  colore: string; maxOre: string; descrizione: string; commessaSkytower: string;
};

const VUOTO: Modulo = { codice: '', nome: '', cliente: '', dataInizio: oggiIso(), dataFine: '', stato: 'ATTIVO', colore: '', maxOre: '', descrizione: '', commessaSkytower: '' };

const daProgetto = (p: Progetto): Modulo => ({
  codice: p.codice, nome: p.nome, cliente: p.cliente ?? '', dataInizio: p.dataInizio, dataFine: p.dataFine ?? '', stato: p.stato,
  colore: p.colore ?? '', maxOre: p.maxMinutiGiorno != null ? String(p.maxMinutiGiorno / 60).replace('.', ',') : '',
  descrizione: p.descrizione ?? '', commessaSkytower: p.commessaSkytower ?? '',
});

/** "7,5" → 450 minuti; "" → null; testo non numerico → NaN (lo segnala lo schema). */
const minutiDaOre = (testo: string) => (testo.trim() === '' ? null : Math.round(Number(testo.replace(',', '.')) * 60));

export function SchedaProgetto() {
  const { id } = useParams();
  const nuovo = id === 'nuovo';
  const { admin } = useAuth();
  const [progetto, setProgetto] = useState<Progetto | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [caricamento, setCaricamento] = useState(!nuovo);
  // Collegamento a SkyTower: serve a mostrare "Invia a SkyTower" e il menu delle commesse (solo HR).
  const { dati: impostazioni } = usaDati<Impostazioni>(admin ? '/api/impostazioni' : null);
  const skytowerAttivo = Boolean(impostazioni?.skytower.attivo);

  useEffect(() => {
    if (nuovo) {
      setProgetto(null);
      setCaricamento(false);
      return;
    }
    setCaricamento(true);
    setErrore(null);
    api
      .get<Progetto>(`/api/progetti/${id}`)
      .then(setProgetto)
      .catch((e: Error) => setErrore(e.message))
      .finally(() => setCaricamento(false));
  }, [id, nuovo]);

  if (caricamento) return <Caricamento />;
  // Al primo giro dopo un cambio di indirizzo il caricamento non è ancora partito: niente errore finto.
  if (!nuovo && !progetto) return errore ? <Avviso tipo="errore">{errore}</Avviso> : <Caricamento />;
  if (nuovo && !admin) return <Avviso tipo="errore">Solo HR crea i progetti</Avviso>;

  const stato = progetto ? ETICHETTE_STATO_PROGETTO[progetto.stato] : null;

  return (
    <>
      <IntestazionePagina
        sopratitolo={progetto ? progetto.codice : undefined}
        titolo={progetto ? progetto.nome : 'Nuovo progetto'}
        sottotitolo={progetto ? [progetto.cliente, `dal ${formattaData(progetto.dataInizio)}${progetto.dataFine ? ` al ${formattaData(progetto.dataFine)}` : ''}`].filter(Boolean).join(' · ') : 'Compila i dati e salva: poi potrai assegnare i dipendenti e caricare la documentazione'}
        azioni={
          <>
            {stato && <Etichetta colore={stato.colore}>{stato.testo}</Etichetta>}
            <Link to="/progetti" className="text-sm text-marchio hover:underline">
              ← {admin ? 'Torna all\'elenco' : 'I miei progetti'}
            </Link>
          </>
        }
      />

      {/* Due colonne flex: a sinistra dati, dipendenti e note; a destra avanzamento e documentazione. */}
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-[1_1_28rem] flex-col gap-4">
          {admin ? <DatiProgetto key={progetto?.id ?? 'nuovo'} progetto={progetto} skytowerAttivo={skytowerAttivo} onSalvato={setProgetto} /> : <RiepilogoProgetto progetto={progetto!} />}
          {admin && progetto && <DipendentiAssegnati progetto={progetto} />}
          {admin && progetto && <NoteInterne progettoId={progetto.id} />}
        </div>
        <div className="flex min-w-0 flex-[1.3_1_32rem] flex-col gap-4">
          {progetto ? (
            <DocumentazioneProgetto progetto={progetto} admin={admin} skytowerAttivo={skytowerAttivo} />
          ) : (
            <Avviso tipo="info">Dopo il salvataggio qui compariranno l'avanzamento, la documentazione caricata dai dipendenti e le note interne.</Avviso>
          )}
        </div>
      </div>
    </>
  );
}

/** Dati del progetto in sola lettura (vista del dipendente). */
function RiepilogoProgetto({ progetto: p }: { progetto: Progetto }) {
  return (
    <section className="scheda p-3 sm:p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase text-gray-500">Dati del progetto</h2>
      <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm [&>div]:min-w-0 [&>div]:flex-[1_1_10rem]">
        <div>
          <dt className="text-xs text-gray-500">Codice</dt>
          <dd className="flex items-center gap-1.5 font-medium">
            <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: coloreProgetto(p) }} />
            {p.codice}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">Cliente</dt>
          <dd>{p.cliente ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">Ore massime al giorno</dt>
          <dd className="cifre">{p.maxMinutiGiorno != null ? formattaOre(p.maxMinutiGiorno) : 'nessun limite'}</dd>
        </div>
      </dl>
      {p.descrizione && <p className="mt-3 whitespace-pre-line text-sm text-gray-700">{p.descrizione}</p>}
    </section>
  );
}

/** Modulo dei dati (HR): crea o salva, e "Chiudi progetto". */
function DatiProgetto({ progetto, skytowerAttivo, onSalvato }: { progetto: Progetto | null; skytowerAttivo: boolean; onSalvato: (p: Progetto) => void }) {
  const naviga = useNavigate();
  const [modulo, setModulo] = useState<Modulo>(progetto ? daProgetto(progetto) : VUOTO);
  const [errori, setErrori] = useState<Record<string, string>>({});
  const [messaggio, setMessaggio] = useState<{ tipo: 'errore' | 'successo'; testo: string } | null>(null);
  const [invio, setInvio] = useState(false);
  // Commesse di SkyTower per il suggerimento del campo (solo se il collegamento c'è).
  const { dati: commesse } = usaDati<{ codice: string; nome: string }[]>(skytowerAttivo ? '/api/impostazioni/skytower/commesse' : null);

  const campo = (nome: keyof Modulo) => ({
    value: modulo[nome],
    onChange: (e: { target: { value: string } }) => setModulo((m) => ({ ...m, [nome]: e.target.value })),
  });

  const invia = async (valori: Modulo) => {
    setMessaggio(null);
    const { maxOre, ...resto } = valori;
    const corpo = { ...resto, maxMinutiGiorno: minutiDaOre(maxOre) };
    const controllo = schemaProgetto.safeParse(corpo);
    if (!controllo.success) {
      setErrori(erroriPerCampo(controllo.error));
      setMessaggio({ tipo: 'errore', testo: 'Controlla i campi evidenziati' });
      return;
    }
    setErrori({});
    setInvio(true);
    try {
      if (progetto) {
        const salvato = await api.put<Progetto>(`/api/progetti/${progetto.id}`, corpo);
        setModulo(daProgetto(salvato));
        onSalvato(salvato);
        setMessaggio({ tipo: 'successo', testo: 'Progetto salvato' });
      } else {
        const creato = await api.post<Progetto>('/api/progetti', corpo);
        naviga(`/progetti/${creato.id}`, { replace: true });
      }
    } catch (err) {
      if (err instanceof ErroreApi) {
        setErrori(err.campi);
        setMessaggio({ tipo: 'errore', testo: err.message });
      }
    } finally {
      setInvio(false);
    }
  };

  const salva = (e: FormEvent) => {
    e.preventDefault();
    invia(modulo);
  };

  return (
    <form onSubmit={salva} className="scheda space-y-3 p-3 sm:p-4" noValidate>
      <h2 className="text-sm font-semibold uppercase text-gray-500">Dati del progetto</h2>
      {messaggio && <Avviso tipo={messaggio.tipo}>{messaggio.testo}</Avviso>}
      <div className="flex flex-wrap gap-3 [&>*]:min-w-0 [&>*]:flex-[1_1_10rem]">
        <Campo etichetta="Codice" obbligatorio errore={errori.codice}>
          <input className={`${classiInput(errori.codice)} uppercase`} {...campo('codice')} />
        </Campo>
        <Campo etichetta="Stato" errore={errori.stato}>
          <select className={classiInput(errori.stato)} {...campo('stato')}>
            {STATI_PROGETTO.map((s) => (
              <option key={s} value={s}>
                {ETICHETTE_STATO_PROGETTO[s].testo}
              </option>
            ))}
          </select>
        </Campo>
      </div>
      <Campo etichetta="Nome" obbligatorio errore={errori.nome}>
        <input className={classiInput(errori.nome)} {...campo('nome')} />
      </Campo>
      <div className="flex flex-wrap gap-3 [&>*]:min-w-0 [&>*:first-child]:flex-[2_1_14rem] [&>*:last-child]:flex-[1_1_10rem]">
        <Campo etichetta="Cliente" errore={errori.cliente}>
          <input className={classiInput(errori.cliente)} {...campo('cliente')} />
        </Campo>
        <Campo etichetta="Ore massime al giorno" errore={errori.maxMinutiGiorno} aiuto="Per dipendente; vuoto = nessun limite">
          <input inputMode="decimal" placeholder="es. 8" className={`${classiInput(errori.maxMinutiGiorno)} text-right`} {...campo('maxOre')} />
        </Campo>
      </div>
      <div className="flex flex-wrap gap-3 [&>*]:min-w-0 [&>*]:flex-[1_1_9rem]">
        <Campo etichetta="Data inizio" obbligatorio errore={errori.dataInizio}>
          <input type="date" min={DATA_MINIMA} className={classiInput(errori.dataInizio)} {...campo('dataInizio')} />
        </Campo>
        <Campo etichetta="Data fine" errore={errori.dataFine}>
          <input type="date" min={DATA_MINIMA} className={classiInput(errori.dataFine)} {...campo('dataFine')} />
        </Campo>
        {/* Niente <Campo> (che è un <label>): il menu dei colori contiene più pulsanti. */}
        <div className="text-sm">
          <span className="mb-1 block font-ui text-[0.82rem] font-semibold text-gray-600">Colore nel calendario</span>
          <SceltaColore
            valore={modulo.colore}
            onCambia={(colore) => setModulo((m) => ({ ...m, colore }))}
            automatico={coloreProgetto({ id: progetto?.id ?? 0, colore: null })}
            errore={errori.colore}
          />
          {errori.colore && <span className="mt-0.5 block text-xs text-errore">{errori.colore}</span>}
        </div>
      </div>
      <Campo etichetta="Descrizione" errore={errori.descrizione}>
        <textarea rows={3} className={classiInput(errori.descrizione)} placeholder="Oggetto dei lavori, luogo, referenti…" {...campo('descrizione')} maxLength={2000} />
      </Campo>
      <Campo
        etichetta="Commessa SkyTower"
        errore={errori.commessaSkytower}
        aiuto={skytowerAttivo ? 'Codice della commessa in cui inviare la documentazione (scrivi o scegli dai suggerimenti)' : 'Serve il collegamento a SkyTower in Impostazioni per inviare la documentazione'}
      >
        <input className={`${classiInput(errori.commessaSkytower)} font-mono`} list="commesse-skytower" placeholder="es. 101-003" {...campo('commessaSkytower')} />
        <datalist id="commesse-skytower">
          {commesse?.map((c) => (
            <option key={c.codice} value={c.codice}>
              {c.nome}
            </option>
          ))}
        </datalist>
      </Campo>
      <div className="flex flex-wrap justify-between gap-2 border-t border-gray-100 pt-3">
        <div>
          {progetto && progetto.stato !== 'CHIUSO' && (
            <Pulsante variante="pericolo" onClick={() => window.confirm(`Chiudere il progetto ${progetto.codice}? Non si potranno più registrare ore.`) && invia({ ...modulo, stato: 'CHIUSO' })}>
              Chiudi progetto
            </Pulsante>
          )}
        </div>
        <div className="flex gap-2">
          {!progetto && <Pulsante onClick={() => naviga('/progetti')}>Annulla</Pulsante>}
          <Pulsante type="submit" variante="primario" disabled={invio}>
            {invio ? 'Salvataggio…' : progetto ? 'Salva modifiche' : 'Crea progetto'}
          </Pulsante>
        </div>
      </div>
    </form>
  );
}

/**
 * Dipendenti assegnati (risposte 2a 3a): si aggiungono uno alla volta scegliendo da un
 * campo a ricerca (nome, matricola, codice fiscale); omonimi distinti dal codice fiscale.
 */
function DipendentiAssegnati({ progetto }: { progetto: Progetto }) {
  const { dati: assegnati, errore, ricarica } = usaDati<Assegnato[]>(`/api/progetti/${progetto.id}/dipendenti`);
  const { dati: dipendenti } = usaDati<Dipendente[]>('/api/dipendenti');
  const [scelto, setScelto] = useState('');
  const [filtro, setFiltro] = useState('');
  const [messaggio, setMessaggio] = useState<{ tipo: 'errore' | 'successo'; testo: string } | null>(null);

  // Nomi distinti dal codice fiscale se due dipendenti si chiamano allo stesso modo.
  const nomi = useMemo(() => nomiSenzaOmonimie(dipendenti ?? assegnati?.map((a) => a.dipendente) ?? []), [dipendenti, assegnati]);
  const giaDentro = new Set((assegnati ?? []).map((a) => a.dipendente.id));
  const opzioni = (dipendenti ?? [])
    .filter((d) => d.stato === 'ATTIVO' && !giaDentro.has(d.id))
    .map((d) => ({ valore: String(d.id), etichetta: nomi.get(d.id) ?? `${d.cognome} ${d.nome}`, dettaglio: dettaglioDipendente(d) }))
    .sort((a, b) => a.etichetta.localeCompare(b.etichetta, 'it'));
  const visibili = (assegnati ?? []).filter((a) => corrisponde(`${a.dipendente.cognome} ${a.dipendente.nome} ${a.dipendente.matricola} ${a.dipendente.codiceFiscale} ${a.dipendente.mansione ?? ''}`, filtro));

  const esegui = async (azione: () => Promise<string>) => {
    setMessaggio(null);
    try {
      setMessaggio({ tipo: 'successo', testo: await azione() });
      ricarica();
    } catch (e) {
      setMessaggio({ tipo: 'errore', testo: e instanceof Error ? e.message : String(e) });
    }
  };

  const aggiungi = () => {
    if (!scelto) return;
    esegui(async () => {
      await api.post(`/api/progetti/${progetto.id}/dipendenti`, { dipendenteId: Number(scelto) });
      setScelto('');
      return `${nomi.get(Number(scelto))} assegnato a ${progetto.codice}`;
    });
  };

  const togli = (a: Assegnato) => {
    const nome = nomi.get(a.dipendente.id) ?? `${a.dipendente.cognome} ${a.dipendente.nome}`;
    const avviso = a.minuti > 0 ? `\nHa già ${formattaOre(a.minuti)} ore sul progetto: restano, ma non potrà registrarne altre.` : '';
    if (!window.confirm(`Togliere ${nome} dal progetto ${progetto.codice}?${avviso}`)) return;
    esegui(async () => {
      await api.delete(`/api/progetti/${progetto.id}/dipendenti/${a.dipendente.id}`);
      return `${nome} tolto da ${progetto.codice}`;
    });
  };

  return (
    <section className="scheda p-3 sm:p-4" aria-labelledby="titolo-assegnati">
      <h2 id="titolo-assegnati" className="mb-1 text-sm font-semibold uppercase text-gray-500">
        Dipendenti assegnati {assegnati && <span className="cifre font-normal normal-case text-gray-400">({assegnati.length})</span>}
      </h2>
      <p className="mb-3 text-xs text-gray-500">Solo i dipendenti assegnati possono registrare ore su questo progetto.</p>
      {progetto.stato !== 'CHIUSO' && (
        <div className="mb-3 flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-[1_1_16rem]">
            <SceltaConRicerca
              etichetta="Dipendente da assegnare"
              segnaposto="Cerca per nome, matricola o codice fiscale…"
              opzioni={opzioni}
              valore={scelto}
              onCambia={setScelto}
              vuoto={dipendenti ? 'Nessun dipendente attivo da aggiungere' : 'Caricamento…'}
            />
          </div>
          <Pulsante variante="primario" onClick={aggiungi} disabled={!scelto}>
            Assegna
          </Pulsante>
        </div>
      )}
      {messaggio && (
        <Avviso tipo={messaggio.tipo} className="mb-2">
          {messaggio.testo}
        </Avviso>
      )}
      {errore && <Avviso tipo="errore">{errore}</Avviso>}
      {(assegnati?.length ?? 0) > 5 && (
        <input
          type="search"
          aria-label="Filtra i dipendenti assegnati"
          placeholder="Filtra…"
          className="mb-2 w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-marchio focus:outline-none sm:w-64"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
        />
      )}
      {!assegnati && !errore && <Caricamento />}
      <ul className="cifre divide-y divide-gray-100 text-sm">
        {visibili.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5">
            <Link to={`/dipendenti/${a.dipendente.id}`} className="min-w-0 flex-[1_1_10rem] font-medium text-testo-forte hover:text-marchio hover:underline">
              {nomi.get(a.dipendente.id) ?? `${a.dipendente.cognome} ${a.dipendente.nome}`}
              {a.dipendente.stato === 'CESSATO' && <span className="ml-1 text-xs font-normal text-gray-400">(cessato)</span>}
            </Link>
            <span className="text-xs text-gray-500">matr. {a.dipendente.matricola}</span>
            <span className="font-mono text-xs text-gray-500">{a.dipendente.codiceFiscale}</span>
            <span className="w-16 text-right" title="Ore registrate su questo progetto">
              {formattaOre(a.minuti)} h
            </span>
            <button type="button" className="rounded px-2 py-0.5 text-xs text-errore hover:bg-[#fdf3f2]" onClick={() => togli(a)}>
              Togli
            </button>
          </li>
        ))}
        {assegnati && visibili.length === 0 && (
          <li className="py-4 text-center text-gray-500">{filtro ? 'Nessuno corrisponde al filtro' : 'Nessun dipendente assegnato: nessuno può registrare ore su questo progetto'}</li>
        )}
      </ul>
    </section>
  );
}

/** Note interne del progetto: solo HR le scrive e le legge. */
function NoteInterne({ progettoId }: { progettoId: number }) {
  const { dati: note, errore, ricarica } = usaDati<NotaProgetto[]>(`/api/note-progetto?progettoId=${progettoId}`);
  const [testo, setTesto] = useState('');
  const [errori, setErrori] = useState<Record<string, string>>({});

  const aggiungi = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.post('/api/note-progetto', { progettoId, testo });
      setTesto('');
      setErrori({});
      ricarica();
    } catch (err) {
      if (err instanceof ErroreApi) setErrori({ testo: err.campi.testo ?? err.message });
    }
  };

  const elimina = async (n: NotaProgetto) => {
    if (!window.confirm('Eliminare questa nota?')) return;
    await api.delete(`/api/note-progetto/${n.id}`);
    ricarica();
  };

  return (
    <section className="scheda p-3 sm:p-4" aria-labelledby="titolo-note">
      <h2 id="titolo-note" className="mb-1 text-sm font-semibold uppercase text-gray-500">
        Note interne
      </h2>
      <p className="mb-2 text-xs text-gray-500">Visibili solo a HR.</p>
      <form onSubmit={aggiungi} className="flex flex-wrap items-end gap-2" noValidate>
        <Campo etichetta="Nuova nota" errore={errori.testo} className="min-w-0 flex-[1_1_16rem]">
          <textarea rows={2} className={classiInput(errori.testo)} value={testo} onChange={(e) => setTesto(e.target.value)} maxLength={4000} />
        </Campo>
        <Pulsante type="submit" variante="primario" disabled={!testo.trim()}>
          Aggiungi
        </Pulsante>
      </form>
      {errore && <Avviso tipo="errore">{errore}</Avviso>}
      <ul className="mt-3 divide-y divide-gray-100 text-sm">
        {note?.map((n) => (
          <li key={n.id} className="py-2">
            <div className="flex flex-wrap items-baseline gap-2 text-xs text-gray-500">
              <span className="cifre">{formattaData(n.creatoIl.slice(0, 10))}</span>
              <span>{n.autore}</span>
              <button type="button" className="ml-auto rounded px-1.5 text-errore hover:bg-[#fdf3f2]" onClick={() => elimina(n)}>
                Elimina
              </button>
            </div>
            <p className="whitespace-pre-line text-gray-800">{n.testo}</p>
          </li>
        ))}
        {note && note.length === 0 && <li className="py-3 text-center text-gray-500">Nessuna nota</li>}
      </ul>
    </section>
  );
}
