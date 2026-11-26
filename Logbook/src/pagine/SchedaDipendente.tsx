// "><(((º> sabusabu <º)))><"
/**
 * Scheda dipendente (solo HR), per creare (/dipendenti/nuovo) o modificare (/dipendenti/:id).
 *
 * Giorno 18 (24/11/2026): tutto sulla stessa pagina, senza schede ("tutte le aree devono
 * essere nella stessa pagina, senza cambiare sezione e perdere la visualizzazione dei dati
 * precedenti"). Le sezioni sono riquadri in flexbox che si affiancano quando c'è spazio:
 * 1. Anagrafica, Contratto e Costi: un solo modulo, salvato insieme;
 * 2. Account di accesso, Stato del rapporto, Progetti assegnati;
 * 3. Attestati e Documenti (componenti/DocumentiDipendente.tsx), con i moduli dentro la
 *    sezione e non in una finestra sopra la pagina.
 * Per un dipendente nuovo c'è solo il modulo: il resto compare dopo "Crea dipendente".
 * In cima, una riga di collegamenti porta alle sezioni (la pagina è lunga sul telefono);
 * `?scheda=attestati` (link dalla dashboard) scorre fino a quella sezione.
 *
 * Omonimi: se esiste già un dipendente con lo stesso cognome e nome, sotto l'anagrafica
 * compare chi è, con matricola e codice fiscale: è il codice fiscale a distinguerli.
 *
 * Gli errori si controllano prima nel browser con le stesse regole del server
 * (comune/schemi.ts) e poi dal server, che resta l'unico controllo che conta.
 *
 * Giorno 26 (risposte 1a 2a 3a 4a del 24/11/2026):
 * - matricola SIGLA-NUMERO del contratto (comune/matricola.ts): per un dipendente nuovo
 *   Copilota propone la prossima libera (HR può correggerla); cambiando il contratto cambia
 *   subito la sigla e il numero resta;
 * - mansione scelta dall'elenco con ricerca a caratteri (datalist); se se ne scrive una
 *   nuova compare l'avviso e al salvataggio entra nell'elenco per tutti.
 */
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { DATA_MINIMA, formattaData, oggiIso } from '../../comune/date';
import { centesimiDaEuro, euroDaCentesimi } from '../../comune/importi';
import { normalizzaMatricola } from '../../comune/matricola';
import { erroriPerCampo, ETICHETTE_CONTRATTO, schemaDipendente, TIPI_CONTRATTO } from '../../comune/schemi';
import { api, ErroreApi } from '../api';
import { coloreProgetto } from '../colori';
import { AttestatiDipendente, DocumentiDipendente } from '../componenti/DocumentiDipendente';
import { SceltaConRicerca } from '../componenti/SceltaConRicerca';
import { Avviso, Caricamento, Campo, classiInput, Etichetta, IntestazionePagina, Pulsante } from '../componenti/ui';
import type { Dipendente, Progetto } from '../tipi';
import { usaDati } from '../usaDati';
import { ETICHETTE_STATO_PROGETTO } from './SchedaProgetto';

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

/** Sezioni della pagina: id dell'ancora ed etichetta del collegamento in cima. */
const SEZIONI = [
  ['anagrafica', 'Anagrafica e contratto'],
  ['account', 'Account e stato'],
  ['progetti', 'Progetti'],
  ['attestati', 'Attestati'],
  ['documenti', 'Documenti'],
] as const;

/** Riquadro di una sezione con titolo; `id` serve ai collegamenti in cima e alla dashboard. */
function Sezione({ id, titolo, children, classe = '' }: { id: string; titolo: string; children: ReactNode; classe?: string }) {
  return (
    <section id={id} aria-labelledby={`titolo-${id}`} className={`scheda min-w-0 scroll-mt-20 p-3 sm:p-4 ${classe}`}>
      <h2 id={`titolo-${id}`} className="mb-3 text-sm font-semibold uppercase text-gray-500">
        {titolo}
      </h2>
      {children}
    </section>
  );
}

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
  const [parametri] = useSearchParams();
  // Tutti i dipendenti: servono solo a riconoscere gli omonimi mentre si scrive il nome.
  const { dati: tutti } = usaDati<Dipendente[]>('/api/dipendenti');
  // Elenco delle mansioni proposte (Giorno 26, risposta 4a); si ricarica dopo il salvataggio.
  const { dati: mansioni, ricarica: ricaricaMansioni } = usaDati<string[]>('/api/dipendenti/mansioni');
  const mansioneNuova =
    modulo.mansione.trim() !== '' && mansioni != null && !mansioni.some((m) => m.toLocaleLowerCase('it') === modulo.mansione.trim().toLocaleLowerCase('it'));

  useEffect(() => {
    if (nuovo) {
      setDipendente(null);
      setModulo(VUOTO);
      setCaricamento(false);
      // Risposta 2a: la prossima matricola libera per il contratto proposto (HR la può cambiare).
      api
        .get<{ matricola: string }>(`/api/dipendenti/prossima-matricola?tipoContratto=${VUOTO.tipoContratto}`)
        .then((r) => setModulo((m) => (m.matricola ? m : { ...m, matricola: r.matricola })))
        .catch(() => {
          /* senza proposta HR scrive la matricola a mano */
        });
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

  // ?scheda=attestati (dalla dashboard): a pagina caricata scorre fino alla sezione.
  const sezioneDaLink = parametri.get('scheda');
  useEffect(() => {
    if (!sezioneDaLink || caricamento || !dipendente) return;
    const t = setTimeout(() => document.getElementById(sezioneDaLink)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    return () => clearTimeout(t);
  }, [sezioneDaLink, caricamento, dipendente]);

  // Omonimi: altri dipendenti con lo stesso cognome e nome (senza badare a maiuscole e spazi).
  const omonimi = useMemo(() => {
    const chiave = (n: string, c: string) => `${c} ${n}`.trim().replace(/\s+/g, ' ').toLowerCase();
    const mia = chiave(modulo.nome, modulo.cognome);
    if (!modulo.nome.trim() || !modulo.cognome.trim()) return [];
    return (tutti ?? []).filter((d) => d.id !== dipendente?.id && chiave(d.nome, d.cognome) === mia);
  }, [tutti, modulo.nome, modulo.cognome, dipendente?.id]);

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
        setMessaggio({ tipo: 'successo', testo: 'Dipendente creato: qui sotto puoi creare l\'account, assegnare i progetti e caricare attestati e documenti' });
      } else {
        const aggiornato = await api.put<Dipendente>(`/api/dipendenti/${id}`, corpo);
        setDipendente((d) => ({ ...aggiornato, utente: d?.utente }));
        setModulo(daDipendente(aggiornato));
        setMessaggio({ tipo: 'successo', testo: 'Scheda salvata' });
      }
      ricaricaMansioni();
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
        sottotitolo={nuovo ? 'Compila anagrafica e contratto e salva: poi potrai creare l\'account, assegnare i progetti e caricare attestati e documenti' : `Matricola ${dipendente!.matricola} · CF ${dipendente!.codiceFiscale}`}
        azioni={
          <>
            {!nuovo && (dipendente!.stato === 'ATTIVO' ? <Etichetta colore="verde">Attivo</Etichetta> : <Etichetta colore="grigio">Cessato</Etichetta>)}
            <Link to="/dipendenti" className="text-sm text-marchio hover:underline">
              ← Torna all'elenco
            </Link>
          </>
        }
      />

      {/* Collegamenti alle sezioni: non sono schede, la pagina mostra sempre tutto. */}
      {!nuovo && (
        <nav aria-label="Sezioni della scheda" className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {SEZIONI.map(([ancora, etichetta]) => (
            <a key={ancora} href={`#${ancora}`} className="text-marchio hover:underline" onClick={(e) => {
              e.preventDefault();
              document.getElementById(ancora)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}>
              {etichetta}
            </a>
          ))}
        </nav>
      )}
      {messaggio && <Avviso tipo={messaggio.tipo} className="mb-3">{messaggio.testo}</Avviso>}

      {/*
        Anagrafica, Contratto e Costi sono lo stesso modulo (si salvano insieme). Dentro,
        layout in flexbox: le sezioni partono da 24rem e si affiancano quando c'è spazio, i
        campi partono da 12rem e vanno a capo.
      */}
      <form id="anagrafica" onSubmit={salva} className="scheda scroll-mt-20 p-3 sm:p-4" noValidate>
        <div className="flex flex-wrap gap-x-6 gap-y-5">
          <section className="min-w-0 flex-[1_1_24rem]">
            <h2 className="mb-3 text-sm font-semibold uppercase text-gray-500">Anagrafica</h2>
            <div className="flex flex-wrap gap-3 [&>*]:min-w-0 [&>*]:flex-[1_1_12rem]">
              <Campo etichetta="Matricola" obbligatorio errore={err('matricola')} aiuto="Sigla del contratto e numero; la sigla segue il contratto">
                <input className={`${classiInput(err('matricola'))} font-mono uppercase`} placeholder="es. IND-0007" {...campo('matricola')} />
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
            {omonimi.length > 0 && (
              <Avviso tipo="info" className="mt-3">
                {omonimi.length === 1 ? 'Esiste già un dipendente' : `Esistono già ${omonimi.length} dipendenti`} con lo stesso nome:{' '}
                {omonimi.map((o, i) => (
                  <span key={o.id}>
                    {i > 0 && '; '}
                    <Link to={`/dipendenti/${o.id}`} className="font-semibold underline">
                      {o.cognome} {o.nome}
                    </Link>{' '}
                    (matr. {o.matricola}, CF <span className="font-mono">{o.codiceFiscale}</span>{o.stato === 'CESSATO' ? ', cessato' : ''})
                  </span>
                ))}
                . Il codice fiscale distingue le persone: se è la stessa persona, non crearla di nuovo.
              </Avviso>
            )}
          </section>

          <section className="min-w-0 flex-[1_1_24rem]">
            <h2 className="mb-3 text-sm font-semibold uppercase text-gray-500">Contratto</h2>
            <div className="flex flex-wrap gap-3 [&>*]:min-w-0 [&>*]:flex-[1_1_12rem]">
              <Campo etichetta="Mansione" errore={err('mansione')} aiuto={mansioneNuova ? undefined : 'Scegli dall\'elenco o scrivine una nuova'}>
                <input className={classiInput(err('mansione'))} list="elenco-mansioni" autoComplete="off" placeholder="Cerca o scrivi…" {...campo('mansione')} />
                <datalist id="elenco-mansioni">
                  {(mansioni ?? []).map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
                {mansioneNuova && <span className="mt-0.5 block text-xs text-[#8a5a00]">Nuova mansione: al salvataggio viene aggiunta all'elenco.</span>}
              </Campo>
              <Campo etichetta="Reparto" errore={err('reparto')}>
                <input className={classiInput(err('reparto'))} {...campo('reparto')} />
              </Campo>
              <Campo etichetta="Tipo contratto" obbligatorio errore={err('tipoContratto')}>
                <select
                  className={classiInput(err('tipoContratto'))}
                  value={modulo.tipoContratto}
                  onChange={(e) => {
                    const tipo = e.target.value as (typeof TIPI_CONTRATTO)[number];
                    // Risposta 3a: cambia la sigla della matricola, il numero resta (DET-0004 → IND-0004).
                    setModulo((m) => {
                      const n = normalizzaMatricola(m.matricola, tipo);
                      return { ...m, tipoContratto: tipo, matricola: 'matricola' in n ? n.matricola : m.matricola };
                    });
                  }}
                >
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

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-gray-100 pt-3">
          <Pulsante onClick={() => naviga('/dipendenti')}>{nuovo ? 'Annulla' : 'Chiudi'}</Pulsante>
          <Pulsante type="submit" variante="primario" disabled={invio}>
            {invio ? 'Salvataggio…' : nuovo ? 'Crea dipendente' : 'Salva modifiche'}
          </Pulsante>
        </div>
      </form>

      {nuovo && (
        <Avviso tipo="info" className="mt-4">
          Dopo «Crea dipendente» compariranno qui sotto l'account di accesso, i progetti assegnati, gli attestati e i documenti.
        </Avviso>
      )}

      {!nuovo && dipendente && (
        <>
          <div id="account" className="mt-4 flex scroll-mt-20 flex-wrap items-start gap-4 [&>*]:min-w-0 [&>*]:flex-[1_1_22rem]">
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
            <Sezione id="progetti" titolo="Progetti assegnati">
              <ProgettiDelDipendente dipendente={dipendente} />
            </Sezione>
          </div>
          <div className="mt-4 flex flex-wrap items-start gap-4 [&>*]:flex-[1_1_34rem]">
            <Sezione id="attestati" titolo="Attestati">
              <AttestatiDipendente dipendenteId={dipendente.id} />
            </Sezione>
            <Sezione id="documenti" titolo="Documenti">
              <DocumentiDipendente dipendenteId={dipendente.id} />
            </Sezione>
          </div>
        </>
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
      setMessaggio({
        tipo: 'successo',
        testo: password
          ? `${esistente ? 'Password reimpostata' : 'Account creato'}: comunica al dipendente nome utente e password. È provvisoria: al primo accesso Copilota gli chiede di cambiarla.`
          : 'Account aggiornato',
      });
    } catch (err) {
      if (err instanceof ErroreApi) {
        setErrori(err.campi);
        setMessaggio({ tipo: 'errore', testo: err.message });
      }
    }
  };

  return (
    <form onSubmit={salva} className="scheda p-3 sm:p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase text-gray-500">Account di accesso</h2>
      {messaggio && <Avviso tipo={messaggio.tipo} className="mb-3">{messaggio.testo}</Avviso>}
      {!esistente && <p className="mb-3 text-sm text-gray-600">Il dipendente non ha ancora un account per entrare in Copilota.</p>}
      {esistente?.passwordDaCambiare && (
        <p className="mb-3 text-sm text-gray-600">Password provvisoria: il dipendente non l'ha ancora cambiata al primo accesso.</p>
      )}
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
    <div className="scheda p-3 sm:p-4">
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

/**
 * Progetti a cui il dipendente è assegnato (Giorno 18): stessa assegnazione della pagina
 * del progetto, vista dal lato del dipendente. Si aggiunge un progetto alla volta
 * scegliendolo con la ricerca a caratteri; "Togli" lascia le ore già fatte.
 */
function ProgettiDelDipendente({ dipendente }: { dipendente: Dipendente }) {
  const { dati: suoi, ricarica } = usaDati<Progetto[]>(`/api/progetti?assegnatiA=${dipendente.id}`);
  const { dati: tutti } = usaDati<Progetto[]>('/api/progetti');
  const [scelto, setScelto] = useState('');
  const [messaggio, setMessaggio] = useState<{ tipo: 'errore' | 'successo'; testo: string } | null>(null);

  const giaSuoi = new Set((suoi ?? []).map((p) => p.id));
  const opzioni = (tutti ?? [])
    .filter((p) => p.stato !== 'CHIUSO' && !giaSuoi.has(p.id))
    .map((p) => ({ valore: String(p.id), etichetta: `${p.codice} · ${p.nome}`, dettaglio: p.cliente ?? undefined, colore: coloreProgetto(p) }));

  const esegui = async (azione: () => Promise<string>) => {
    setMessaggio(null);
    try {
      setMessaggio({ tipo: 'successo', testo: await azione() });
      ricarica();
    } catch (e) {
      setMessaggio({ tipo: 'errore', testo: e instanceof Error ? e.message : String(e) });
    }
  };

  const assegna = () =>
    scelto &&
    esegui(async () => {
      await api.post(`/api/progetti/${scelto}/dipendenti`, { dipendenteId: dipendente.id });
      const p = tutti?.find((x) => String(x.id) === scelto);
      setScelto('');
      return `Assegnato a ${p?.codice ?? 'progetto'}`;
    });

  const togli = (p: Progetto) => {
    if (!window.confirm(`Togliere ${dipendente.cognome} ${dipendente.nome} dal progetto ${p.codice}? Le ore già fatte restano, ma non potrà registrarne altre.`)) return;
    esegui(async () => {
      await api.delete(`/api/progetti/${p.id}/dipendenti/${dipendente.id}`);
      return `Tolto da ${p.codice}`;
    });
  };

  return (
    <div>
      <p className="mb-2 text-xs text-gray-500">Registra ore solo su questi progetti.</p>
      {dipendente.stato === 'ATTIVO' && (
        <div className="mb-2 flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-[1_1_12rem]">
            <SceltaConRicerca etichetta="Progetto da assegnare" segnaposto="Cerca per codice, nome o cliente…" opzioni={opzioni} valore={scelto} onCambia={setScelto} vuoto="Nessun altro progetto aperto" />
          </div>
          <Pulsante variante="primario" onClick={assegna} disabled={!scelto}>
            Assegna
          </Pulsante>
        </div>
      )}
      {messaggio && <Avviso tipo={messaggio.tipo} className="mb-2">{messaggio.testo}</Avviso>}
      {!suoi && <Caricamento />}
      <ul className="divide-y divide-gray-100 text-sm">
        {suoi?.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-2 py-1.5">
            <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: coloreProgetto(p) }} />
            <Link to={`/progetti/${p.id}`} className="min-w-0 flex-1 truncate text-testo-forte hover:text-marchio hover:underline">
              <span className="font-medium">{p.codice}</span> · {p.nome}
            </Link>
            {p.stato !== 'ATTIVO' && <Etichetta colore={ETICHETTE_STATO_PROGETTO[p.stato].colore}>{ETICHETTE_STATO_PROGETTO[p.stato].testo}</Etichetta>}
            <button type="button" className="rounded px-2 py-0.5 text-xs text-errore hover:bg-[#fdf3f2]" onClick={() => togli(p)}>
              Togli
            </button>
          </li>
        ))}
        {suoi && suoi.length === 0 && <li className="py-3 text-center text-gray-500">Nessun progetto: non può registrare ore</li>}
      </ul>
    </div>
  );
}
