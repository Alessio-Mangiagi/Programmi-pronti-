// "><(((º> sabusabu <º)))><"
/**
 * Segnalazioni dei dipendenti a HR (Giorno 20, 24/11/2026, risposte 1b e 4).
 *
 * Le ore le inserisce solo HR. Se nella sua giornata qualcosa non torna, il dipendente lo
 * segnala; "HR decide e interviene su segnalazione ma il sistema notifica a HR quando accede".
 *
 * - SegnalazioniGiorno: dentro la finestra della giornata. Il dipendente vede le sue
 *   segnalazioni di quel giorno, ne manda una nuova o ritira quelle ancora aperte; HR legge
 *   quelle del dipendente per quel giorno, corregge le ore nella stessa finestra e le chiude
 *   con una risposta.
 * - Notifiche (solo HR, nell'intestazione): campanella con il numero di segnalazioni aperte
 *   (aggiornato ogni minuto e al ritorno sulla finestra) e, all'accesso, una finestra con
 *   l'elenco. All'accesso = una volta per sessione del browser e dopo ogni login.
 *
 * API: /api/segnalazioni (server/rotte/segnalazioni.ts). Dopo ogni modifica si lancia
 * l'evento "logbook:segnalazioni", così il contatore si aggiorna subito.
 */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { formattaData } from '../../comune/date';
import { api, ErroreApi } from '../api';
import { useAuth } from '../auth';
import type { Segnalazione } from '../tipi';
import { usaDati } from '../usaDati';
import { Icona } from './icone';
import { Avviso, Campo, classiInput, Etichetta, Modale, Pulsante } from './ui';

const EVENTO = 'logbook:segnalazioni';
const avvisaCambio = () => window.dispatchEvent(new Event(EVENTO));

/** Collegamento al giorno nel calendario di quel dipendente (apre la finestra della giornata). */
export const linkGiorno = (s: { dipendenteId: number; data: string }) => `/calendario?dipendente=${s.dipendenteId}&data=${s.data}&giorno=${s.data}`;

export function SegnalazioniGiorno({ dipendenteId, data }: { dipendenteId: number; data: string }) {
  const { admin, oggi } = useAuth();
  const { dati, ricarica } = usaDati<Segnalazione[]>(`/api/segnalazioni?dipendenteId=${dipendenteId}&data=${data}`);
  const [testo, setTesto] = useState('');
  const [errore, setErrore] = useState<string | null>(null);
  const [inviata, setInviata] = useState(false);

  const esegui = async (azione: () => Promise<unknown>) => {
    setErrore(null);
    try {
      await azione();
      ricarica();
      avvisaCambio();
    } catch (e) {
      setErrore(e instanceof ErroreApi ? (e.campi.testo ?? e.message) : String(e));
    }
  };

  const invia = (e: FormEvent) => {
    e.preventDefault();
    esegui(async () => {
      await api.post('/api/segnalazioni', { data, testo });
      setTesto('');
      setInviata(true);
    });
  };

  const elenco = dati ?? [];
  // Il dipendente segnala sui giorni fino a oggi; HR qui legge e risponde soltanto.
  const puoSegnalare = !admin && data <= oggi;
  if (admin && elenco.length === 0) return null;

  return (
    <section aria-labelledby={`segnalazioni-${data}`} className="rounded border border-gray-200 bg-fondo p-3">
      <h3 id={`segnalazioni-${data}`} className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-600">
        <Icona nome="campanella" dimensione={15} />
        {admin ? 'Segnalazioni del dipendente su questo giorno' : 'Qualcosa non torna? Segnalalo a HR'}
      </h3>
      {errore && <Avviso tipo="errore" className="mb-2">{errore}</Avviso>}
      {inviata && <Avviso tipo="successo" className="mb-2">Segnalazione inviata: HR la vedrà appena entra in Logbook.</Avviso>}
      <ul className="space-y-2">
        {elenco.map((s) => (
          <VoceSegnalazione key={s.id} segnalazione={s} admin={admin} onCambio={() => { ricarica(); avvisaCambio(); }} onErrore={setErrore} />
        ))}
      </ul>
      {puoSegnalare && (
        <form onSubmit={invia} className="mt-2 flex flex-wrap items-end gap-2" noValidate>
          <Campo etichetta="Cosa non torna in questa giornata" className="min-w-0 flex-[1_1_16rem]">
            <textarea rows={2} className={classiInput()} placeholder="Es. ho lavorato fino alle 17:30, non alle 16:30" value={testo} onChange={(e) => setTesto(e.target.value)} maxLength={1000} />
          </Campo>
          <Pulsante type="submit" variante="primario" disabled={testo.trim().length < 3}>
            Invia segnalazione
          </Pulsante>
        </form>
      )}
    </section>
  );
}

function VoceSegnalazione({ segnalazione: s, admin, onCambio, onErrore }: { segnalazione: Segnalazione; admin: boolean; onCambio: () => void; onErrore: (m: string) => void }) {
  const [risposta, setRisposta] = useState(s.rispostaHr ?? '');
  const esegui = async (azione: () => Promise<unknown>) => {
    try {
      await azione();
      onCambio();
    } catch (e) {
      onErrore(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <li className="rounded border border-gray-200 bg-white p-2 text-sm">
      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <span>inviata il {formattaData(s.creatoIl.slice(0, 10))}</span>
        {s.stato === 'APERTA' ? <Etichetta colore="giallo">Aperta</Etichetta> : <Etichetta colore="verde">Risolta{s.risoltaDa ? ` da ${s.risoltaDa.username}` : ''}</Etichetta>}
      </div>
      <p className="mt-1 whitespace-pre-line text-gray-800">{s.testo}</p>
      {!admin && s.rispostaHr && (
        <Avviso tipo="info" className="mt-1">
          <b>Risposta HR:</b> {s.rispostaHr}
        </Avviso>
      )}
      {admin && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <Campo etichetta="Risposta al dipendente" className="min-w-0 flex-[1_1_14rem]">
            <input className={classiInput()} value={risposta} onChange={(e) => setRisposta(e.target.value)} maxLength={1000} placeholder="Es. corretto, ora risultano 8:00" />
          </Campo>
          {s.stato === 'APERTA' ? (
            <Pulsante variante="primario" onClick={() => esegui(() => api.patch(`/api/segnalazioni/${s.id}`, { stato: 'RISOLTA', rispostaHr: risposta }))}>
              Segna risolta
            </Pulsante>
          ) : (
            <Pulsante onClick={() => esegui(() => api.patch(`/api/segnalazioni/${s.id}`, { stato: 'APERTA', rispostaHr: risposta }))}>Riapri</Pulsante>
          )}
        </div>
      )}
      {!admin && s.stato === 'APERTA' && (
        <button type="button" className="mt-1 rounded px-1.5 py-0.5 text-xs text-errore hover:bg-[#fdf3f2]" onClick={() => window.confirm('Ritirare la segnalazione?') && esegui(() => api.delete(`/api/segnalazioni/${s.id}`))}>
          Ritira
        </button>
      )}
    </li>
  );
}

/**
 * Chiave del "già mostrata" della finestra all'accesso: una volta per sessione del browser.
 * Il prefisso è anche in src/auth.tsx, che al login toglie queste chiavi.
 */
export const PREFISSO_MOSTRATE = 'logbook.segnalazioni.mostrate.';
const chiaveMostrata = (utenteId: number) => `${PREFISSO_MOSTRATE}${utenteId}`;

/**
 * Campanella di HR con il numero di segnalazioni aperte e finestra all'accesso.
 * Il login (src/auth.tsx) cancella la chiave, così la finestra ricompare a ogni accesso.
 */
export function Notifiche() {
  const { utente, admin } = useAuth();
  const [aperte, setAperte] = useState<Segnalazione[] | null>(null);
  const [finestra, setFinestra] = useState(false);

  const aggiorna = useCallback(async () => {
    try {
      setAperte(await api.get<Segnalazione[]>('/api/segnalazioni?stato=APERTA'));
    } catch {
      /* se il server non risponde resta l'ultimo valore */
    }
  }, []);

  useEffect(() => {
    if (!admin) return;
    aggiorna();
    const ogniMinuto = setInterval(aggiorna, 60 * 1000);
    window.addEventListener('focus', aggiorna);
    window.addEventListener(EVENTO, aggiorna);
    return () => {
      clearInterval(ogniMinuto);
      window.removeEventListener('focus', aggiorna);
      window.removeEventListener(EVENTO, aggiorna);
    };
  }, [admin, aggiorna]);

  // All'accesso: se ci sono segnalazioni aperte la finestra si apre da sola, una volta.
  useEffect(() => {
    if (!admin || !utente || !aperte?.length) return;
    try {
      if (sessionStorage.getItem(chiaveMostrata(utente.id))) return;
      sessionStorage.setItem(chiaveMostrata(utente.id), '1');
    } catch {
      /* archivio del browser non disponibile: la si mostra comunque */
    }
    setFinestra(true);
  }, [admin, utente, aperte]);

  if (!admin) return null;
  const numero = aperte?.length ?? 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setFinestra(true)}
        className="relative shrink-0 rounded p-1.5 text-marchio transition-colors hover:bg-ghiaccio"
        aria-label={numero ? `${numero} segnalazioni aperte dei dipendenti` : 'Nessuna segnalazione aperta'}
        title={numero ? `${numero} segnalazioni aperte` : 'Nessuna segnalazione aperta'}
      >
        <Icona nome="campanella" dimensione={19} />
        {numero > 0 && (
          <span className="cifre absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-errore px-1 text-center text-[0.65rem] font-bold leading-4 text-white">{numero}</span>
        )}
      </button>
      <Modale titolo="Segnalazioni dei dipendenti" aperta={finestra} onChiudi={() => setFinestra(false)} larghezza="max-w-2xl">
        {numero === 0 ? (
          <p className="text-sm text-gray-600">Nessuna segnalazione aperta.</p>
        ) : (
          <>
            <p className="mb-3 text-sm text-gray-600">
              {numero === 1 ? 'Un dipendente segnala' : `${numero} segnalazioni:`} qualcosa che non torna nelle ore. Apri il giorno, correggi se serve e chiudi la segnalazione con una risposta.
            </p>
            <ul className="divide-y divide-gray-100 text-sm">
              {aperte!.map((s) => (
                <li key={s.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2">
                  <span className="font-medium text-testo-forte">
                    {s.dipendente.cognome} {s.dipendente.nome}
                  </span>
                  <span className="cifre text-gray-500">{formattaData(s.data)}</span>
                  <Link to={linkGiorno(s)} onClick={() => setFinestra(false)} className="ml-auto text-marchio hover:underline">
                    Apri il giorno →
                  </Link>
                  <p className="basis-full text-gray-700">{s.testo}</p>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="mt-3 flex justify-end border-t border-gray-100 pt-3">
          <Pulsante onClick={() => setFinestra(false)}>Ho visto</Pulsante>
        </div>
      </Modale>
    </>
  );
}
