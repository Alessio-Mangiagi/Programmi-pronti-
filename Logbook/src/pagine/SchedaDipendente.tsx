// "><(((º> sabusabu <º)))><"
/**
 * Scheda dipendente (solo HR), per creare (/dipendenti/nuovo) o modificare
 * (/dipendenti/:id). Tre blocchi:
 * 1. anagrafica e contratto, con costo orario netto e lordo in euro;
 * 2. account di accesso (nome utente, password, attivo) — solo per schede già salvate;
 * 3. disattivazione (cessazione) o riattivazione.
 *
 * Gli errori si controllano prima nel browser con le stesse regole del server
 * (comune/schemi.ts) e poi dal server, che resta l'unico controllo che conta.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { DATA_MINIMA, formattaData, oggiIso } from '../../comune/date';
import { centesimiDaEuro, euroDaCentesimi } from '../../comune/importi';
import { erroriPerCampo, ETICHETTE_CONTRATTO, schemaDipendente, TIPI_CONTRATTO } from '../../comune/schemi';
import { api, ErroreApi } from '../api';
import { Avviso, Caricamento, Campo, classiInput, Etichetta, IntestazionePagina, Pulsante } from '../componenti/ui';
import type { Dipendente } from '../tipi';

/** Valori del modulo: tutto testo, come nei campi. */
type Modulo = Record<
  | 'matricola' | 'nome' | 'cognome' | 'codiceFiscale' | 'email' | 'telefono' | 'mansione' | 'reparto'
  | 'dataAssunzione' | 'dataCessazione' | 'tipoContratto' | 'oreSettimanali' | 'costoNetto' | 'costoLordo' | 'stato',
  string
>;

const VUOTO: Modulo = {
  matricola: '', nome: '', cognome: '', codiceFiscale: '', email: '', telefono: '', mansione: '', reparto: '',
  dataAssunzione: oggiIso(), dataCessazione: '', tipoContratto: 'INDETERMINATO', oreSettimanali: '40',
  costoNetto: '', costoLordo: '', stato: 'ATTIVO',
};

const daDipendente = (d: Dipendente): Modulo => ({
  matricola: d.matricola, nome: d.nome, cognome: d.cognome, codiceFiscale: d.codiceFiscale, email: d.email ?? '',
  telefono: d.telefono ?? '', mansione: d.mansione ?? '', reparto: d.reparto ?? '', dataAssunzione: d.dataAssunzione,
  dataCessazione: d.dataCessazione ?? '', tipoContratto: d.tipoContratto, oreSettimanali: String(d.oreSettimanali),
  costoNetto: euroDaCentesimi(d.costoOrarioNettoCent), costoLordo: euroDaCentesimi(d.costoOrarioLordoCent), stato: d.stato,
});

export function SchedaDipendente() {
  const { id } = useParams();
  const nuovo = id === 'nuovo';
  const naviga = useNavigate();
  const [dipendente, setDipendente] = useState<Dipendente | null>(null);
  const [modulo, setModulo] = useState<Modulo>(VUOTO);
  const [errori, setErrori] = useState<Record<string, string>>({});
  const [messaggio, setMessaggio] = useState<{ tipo: 'errore' | 'successo'; testo: string } | null>(null);
  const [caricamento, setCaricamento] = useState(!nuovo);
  const [invio, setInvio] = useState(false);

  useEffect(() => {
    if (nuovo) {
      setDipendente(null);
      setModulo(VUOTO);
      return;
    }
    setCaricamento(true);
    api
      .get<Dipendente>(`/api/dipendenti/${id}`)
      .then((d) => {
        setDipendente(d);
        setModulo(daDipendente(d));
      })
      .catch((e: Error) => setMessaggio({ tipo: 'errore', testo: e.message }))
      .finally(() => setCaricamento(false));
  }, [id, nuovo]);

  const campo = (nome: keyof Modulo) => ({
    value: modulo[nome],
    onChange: (e: { target: { value: string } }) => setModulo((m) => ({ ...m, [nome]: e.target.value })),
  });

  const salva = async (e: FormEvent) => {
    e.preventDefault();
    setMessaggio(null);
    // Importi: da "14,50" a centesimi; un importo scritto male è un errore del campo.
    const erroriImporti: Record<string, string> = {};
    const centesimi = (testo: string, chiave: string) => {
      try {
        return centesimiDaEuro(testo);
      } catch {
        erroriImporti[chiave] = 'Importo non valido (es. 14,50)';
        return null;
      }
    };
    const { costoNetto, costoLordo, ...resto } = modulo;
    const corpo = {
      ...resto,
      costoOrarioNettoCent: centesimi(costoNetto, 'costoOrarioNettoCent'),
      costoOrarioLordoCent: centesimi(costoLordo, 'costoOrarioLordoCent'),
    };
    const controllo = schemaDipendente.safeParse(corpo);
    const erroriLocali = { ...(controllo.success ? {} : erroriPerCampo(controllo.error)), ...erroriImporti };
    if (Object.keys(erroriLocali).length) {
      setErrori(erroriLocali);
      setMessaggio({ tipo: 'errore', testo: 'Controlla i campi evidenziati' });
      return;
    }
    setErrori({});
    setInvio(true);
    try {
      if (nuovo) {
        const creato = await api.post<Dipendente>('/api/dipendenti', corpo);
        naviga(`/dipendenti/${creato.id}`, { replace: true });
      } else {
        const aggiornato = await api.put<Dipendente>(`/api/dipendenti/${id}`, corpo);
        setDipendente((d) => ({ ...aggiornato, utente: d?.utente }));
        setModulo(daDipendente(aggiornato));
        setMessaggio({ tipo: 'successo', testo: 'Scheda salvata' });
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

  if (caricamento) return <Caricamento />;
  if (!nuovo && !dipendente) return <Avviso tipo="errore">{messaggio?.testo ?? 'Dipendente non trovato'}</Avviso>;

  const titolo = nuovo ? 'Nuovo dipendente' : `${dipendente!.cognome} ${dipendente!.nome}`;
  const err = (chiave: string) => errori[chiave];

  return (
    <>
      <IntestazionePagina
        titolo={titolo}
        sottotitolo={nuovo ? 'Compila la scheda e salva; poi potrai creare l\'account di accesso' : `Matricola ${dipendente!.matricola}`}
        azioni={
          <>
            {!nuovo && (dipendente!.stato === 'ATTIVO' ? <Etichetta colore="verde">Attivo</Etichetta> : <Etichetta colore="grigio">Cessato</Etichetta>)}
            <Link to="/dipendenti" className="text-sm text-marchio hover:underline">
              ← Torna all'elenco
            </Link>
          </>
        }
      />
      {messaggio && <Avviso tipo={messaggio.tipo} className="mb-3">{messaggio.testo}</Avviso>}

      {/*
        Layout in flexbox (24/11/2026): le tre sezioni (anagrafica, contratto, costi) partono
        da 24rem e si affiancano quando c'è spazio (tutte e tre su un ultra wide); dentro
        ogni sezione i campi partono da 12rem e vanno a capo da soli (uno per riga sul telefono).
      */}
      <form onSubmit={salva} className="scheda p-3 sm:p-4" noValidate>
        <div className="flex flex-wrap gap-x-6 gap-y-5">
          <section className="min-w-0 flex-[1_1_24rem]">
            <h2 className="mb-3 text-sm font-semibold uppercase text-gray-500">Anagrafica</h2>
            <div className="flex flex-wrap gap-3 [&>*]:min-w-0 [&>*]:flex-[1_1_12rem]">
              <Campo etichetta="Matricola" obbligatorio errore={err('matricola')}>
                <input className={classiInput(err('matricola'))} {...campo('matricola')} />
              </Campo>
              <Campo etichetta="Nome" obbligatorio errore={err('nome')}>
                <input className={classiInput(err('nome'))} {...campo('nome')} />
              </Campo>
              <Campo etichetta="Cognome" obbligatorio errore={err('cognome')}>
                <input className={classiInput(err('cognome'))} {...campo('cognome')} />
              </Campo>
              <Campo etichetta="Codice fiscale" obbligatorio errore={err('codiceFiscale')}>
                <input className={`${classiInput(err('codiceFiscale'))} font-mono uppercase`} maxLength={16} {...campo('codiceFiscale')} />
              </Campo>
              <Campo etichetta="Email" errore={err('email')}>
                <input type="email" className={classiInput(err('email'))} {...campo('email')} />
              </Campo>
              <Campo etichetta="Telefono" errore={err('telefono')}>
                <input className={classiInput(err('telefono'))} {...campo('telefono')} />
              </Campo>
            </div>
          </section>

          <section className="min-w-0 flex-[1_1_24rem]">
            <h2 className="mb-3 text-sm font-semibold uppercase text-gray-500">Contratto</h2>
            <div className="flex flex-wrap gap-3 [&>*]:min-w-0 [&>*]:flex-[1_1_12rem]">
              <Campo etichetta="Mansione" errore={err('mansione')}>
                <input className={classiInput(err('mansione'))} {...campo('mansione')} />
              </Campo>
              <Campo etichetta="Reparto" errore={err('reparto')}>
                <input className={classiInput(err('reparto'))} {...campo('reparto')} />
              </Campo>
              <Campo etichetta="Tipo contratto" obbligatorio errore={err('tipoContratto')}>
                <select className={classiInput(err('tipoContratto'))} {...campo('tipoContratto')}>
                  {TIPI_CONTRATTO.map((t) => (
                    <option key={t} value={t}>
                      {ETICHETTE_CONTRATTO[t]}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo etichetta="Data assunzione" obbligatorio errore={err('dataAssunzione')}>
                <input type="date" min={DATA_MINIMA} className={classiInput(err('dataAssunzione'))} {...campo('dataAssunzione')} />
              </Campo>
              <Campo etichetta="Ore contrattuali settimanali" obbligatorio errore={err('oreSettimanali')}>
                <input type="number" min={1} max={60} step={0.5} className={classiInput(err('oreSettimanali'))} {...campo('oreSettimanali')} />
              </Campo>
              <Campo etichetta="Stato" errore={err('stato')}>
                <select className={classiInput(err('stato'))} {...campo('stato')}>
                  <option value="ATTIVO">Attivo</option>
                  <option value="CESSATO">Cessato</option>
                </select>
              </Campo>
              {modulo.stato === 'CESSATO' && (
                <Campo etichetta="Data cessazione" obbligatorio errore={err('dataCessazione')}>
                  <input type="date" min={DATA_MINIMA} className={classiInput(err('dataCessazione'))} {...campo('dataCessazione')} />
                </Campo>
              )}
            </div>
          </section>

          <section className="min-w-0 flex-[1_1_24rem]">
            <h2 className="mb-3 text-sm font-semibold uppercase text-gray-500">Costi (riservati a HR)</h2>
            <div className="flex flex-wrap gap-3 [&>*]:min-w-0 [&>*]:flex-[1_1_12rem]">
              <Campo etichetta="Costo orario netto (€)" errore={err('costoOrarioNettoCent')} aiuto="Es. 14,50">
                <input inputMode="decimal" className={`${classiInput(err('costoOrarioNettoCent'))} text-right`} {...campo('costoNetto')} />
              </Campo>
              <Campo etichetta="Costo orario lordo (€)" errore={err('costoOrarioLordoCent')} aiuto="Costo aziendale, es. 27,80">
                <input inputMode="decimal" className={`${classiInput(err('costoOrarioLordoCent'))} text-right`} {...campo('costoLordo')} />
              </Campo>
            </div>
          </section>
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-3">
          <Pulsante onClick={() => naviga('/dipendenti')}>Annulla</Pulsante>
          <Pulsante type="submit" variante="primario" disabled={invio}>
            {invio ? 'Salvataggio…' : nuovo ? 'Crea dipendente' : 'Salva modifiche'}
          </Pulsante>
        </div>
      </form>

      {!nuovo && dipendente && (
        <div className="mt-4 flex flex-wrap gap-4 [&>*]:min-w-0 [&>*]:flex-[1_1_26rem]">
          <BloccoAccount dipendente={dipendente} onAggiornato={(utente) => setDipendente({ ...dipendente, utente })} />
          <BloccoStato
            dipendente={dipendente}
            onAggiornato={(d) => {
              // Disattivare la scheda disattiva anche l'account (lo fa il server).
              const utente = d.stato === 'CESSATO' && dipendente.utente ? { ...dipendente.utente, attivo: false } : dipendente.utente;
              setDipendente({ ...d, utente });
              setModulo(daDipendente(d));
            }}
          />
        </div>
      )}
    </>
  );
}

/** Account di accesso del dipendente: crea, cambia nome utente/password, attiva/disattiva. */
function BloccoAccount({ dipendente, onAggiornato }: { dipendente: Dipendente; onAggiornato: (u: NonNullable<Dipendente['utente']>) => void }) {
  const esistente = dipendente.utente;
  const [username, setUsername] = useState(esistente?.username ?? `${dipendente.nome}.${dipendente.cognome}`.toLowerCase().replace(/\s+/g, ''));
  const [password, setPassword] = useState('');
  const [attivo, setAttivo] = useState(esistente?.attivo ?? true);
  const [errori, setErrori] = useState<Record<string, string>>({});
  const [messaggio, setMessaggio] = useState<{ tipo: 'errore' | 'successo'; testo: string } | null>(null);

  const salva = async (e: FormEvent) => {
    e.preventDefault();
    setErrori({});
    try {
      const account = await api.put<NonNullable<Dipendente['utente']>>(`/api/dipendenti/${dipendente.id}/account`, { username, password, attivo });
      onAggiornato(account);
      setPassword('');
      setMessaggio({ tipo: 'successo', testo: esistente ? 'Account aggiornato' : 'Account creato: comunica al dipendente nome utente e password' });
    } catch (err) {
      if (err instanceof ErroreApi) {
        setErrori(err.campi);
        setMessaggio({ tipo: 'errore', testo: err.message });
      }
    }
  };

  return (
    <form onSubmit={salva} className="scheda p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase text-gray-500">Account di accesso</h2>
      {messaggio && <Avviso tipo={messaggio.tipo} className="mb-3">{messaggio.testo}</Avviso>}
      {!esistente && <p className="mb-3 text-sm text-gray-600">Il dipendente non ha ancora un account per entrare in Logbook.</p>}
      <div className="flex flex-wrap gap-3 [&>*]:min-w-0 [&>*]:flex-[1_1_12rem]">
        <Campo etichetta="Nome utente" obbligatorio errore={errori.username}>
          <input className={classiInput(errori.username)} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
        </Campo>
        <Campo etichetta={esistente ? 'Nuova password' : 'Password'} obbligatorio={!esistente} errore={errori.password} aiuto={esistente ? 'Vuota = invariata' : 'Almeno 8 caratteri, lettere e numeri'}>
          <input type="password" className={classiInput(errori.password)} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </Campo>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={attivo} onChange={(e) => setAttivo(e.target.checked)} />
        Account attivo (può entrare)
      </label>
      {errori.attivo && <p className="text-xs text-errore">{errori.attivo}</p>}
      <div className="mt-3 flex justify-end">
        <Pulsante type="submit" variante="primario">
          {esistente ? 'Aggiorna account' : 'Crea account'}
        </Pulsante>
      </div>
    </form>
  );
}

/** Disattivazione (cessazione) o riattivazione del dipendente. */
function BloccoStato({ dipendente, onAggiornato }: { dipendente: Dipendente; onAggiornato: (d: Dipendente) => void }) {
  const [data, setData] = useState(oggiIso());
  const [errore, setErrore] = useState<string | null>(null);

  const esegui = async (azione: 'disattiva' | 'riattiva') => {
    setErrore(null);
    if (azione === 'disattiva' && !window.confirm(`Disattivare ${dipendente.nome} ${dipendente.cognome} dal ${formattaData(data)}? Anche il suo account verrà bloccato.`)) return;
    try {
      onAggiornato(await api.post<Dipendente>(`/api/dipendenti/${dipendente.id}/${azione}`, azione === 'disattiva' ? { dataCessazione: data } : {}));
    } catch (err) {
      setErrore(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="scheda p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase text-gray-500">Stato del rapporto</h2>
      {errore && <Avviso tipo="errore" className="mb-3">{errore}</Avviso>}
      {dipendente.stato === 'ATTIVO' ? (
        <div className="flex flex-wrap items-end gap-3">
          <Campo etichetta="Data di cessazione">
            <input type="date" min={DATA_MINIMA} className={classiInput()} value={data} onChange={(e) => setData(e.target.value)} />
          </Campo>
          <Pulsante variante="pericolo" onClick={() => esegui('disattiva')}>
            Disattiva dipendente
          </Pulsante>
          <p className="w-full text-xs text-gray-500">Le ore e le assenze già registrate restano nei report.</p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-gray-700">Cessato dal {dipendente.dataCessazione ? formattaData(dipendente.dataCessazione) : '—'}.</span>
          <Pulsante onClick={() => esegui('riattiva')}>Riattiva dipendente</Pulsante>
        </div>
      )}
    </div>
  );
}
