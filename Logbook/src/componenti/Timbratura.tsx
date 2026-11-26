// "><(((º> sabusabu <º)))><"
/**
 * Timbratura (Giorno 42, 26/11/2026), in cima alla dashboard.
 *
 * - `TimbraturaDipendente`: il dipendente sceglie il progetto e timbra l'entrata; poi un solo
 *   pulsante grande per l'uscita. Sotto, le ultime timbrature con lo stato: in attesa di HR,
 *   confermata (è diventata ore), rifiutata (con il motivo). Pensata per il telefono.
 * - `TimbratureDaConfermare`: HR vede le timbrature chiuse dai dipendenti, può correggere
 *   entrata e uscita, e conferma (nasce la fascia oraria) o rifiuta scrivendo il motivo.
 *
 * Una timbratura non è ancora un'ora lavorata: lo diventa con la conferma di HR, che passa
 * per gli stessi controlli delle ore inserite a mano. L'ora la decide il server (fuso
 * italiano), non il telefono. API: /api/timbrature (server/rotte/timbrature.ts).
 */
import { useState } from 'react';
import { formattaData } from '../../comune/date';
import { api } from '../api';
import { coloreProgetto } from '../colori';
import { usaDati } from '../usaDati';
import { Avviso, classiInput, Etichetta, Pulsante } from './ui';

type Stato = 'APERTA' | 'DA_CONFERMARE' | 'CONFERMATA' | 'RIFIUTATA';
type Timbratura = {
  id: number;
  data: string;
  oraInizio: string;
  oraFine: string | null;
  stato: Stato;
  noteHr: string | null;
  dipendente: { nome: string; cognome: string; matricola: string };
  progetto: { id: number; codice: string; nome: string; colore: string | null };
};
type Mie = { oggi: string; adesso: string; aperta: Timbratura | null; recenti: Timbratura[]; progetti: { id: number; codice: string; nome: string; colore: string | null }[] };

const ETICHETTE: Record<Stato, { testo: string; colore: 'verde' | 'rosso' | 'giallo' | 'grigio' | 'blu' }> = {
  APERTA: { testo: 'In corso', colore: 'blu' },
  DA_CONFERMARE: { testo: 'In attesa di HR', colore: 'giallo' },
  CONFERMATA: { testo: 'Confermata', colore: 'verde' },
  RIFIUTATA: { testo: 'Rifiutata', colore: 'rosso' },
};

const Pallino = ({ p }: { p: { id: number; colore: string | null } }) => (
  <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: coloreProgetto(p) }} aria-hidden />
);

export function TimbraturaDipendente() {
  const { dati, errore: erroreDati, ricarica } = usaDati<Mie>('/api/timbrature/mie');
  const [progettoId, setProgettoId] = useState('');
  const [errore, setErrore] = useState<string | null>(null);
  const [lavoro, setLavoro] = useState(false);

  // Account senza scheda dipendente (403): la timbratura non lo riguarda, niente riquadro.
  if (erroreDati || !dati) return null;
  const scelto = progettoId || (dati.progetti.length === 1 ? String(dati.progetti[0].id) : '');

  const timbra = async (verso: 'entrata' | 'uscita') => {
    setErrore(null);
    setLavoro(true);
    try {
      await api.post(`/api/timbrature/${verso}`, verso === 'entrata' ? { progettoId: scelto } : undefined);
      ricarica();
    } catch (e) {
      setErrore(e instanceof Error ? e.message : String(e));
    } finally {
      setLavoro(false);
    }
  };

  return (
    <section className="scheda mb-4 p-3 sm:p-4" aria-labelledby="titolo-timbratura">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="titolo-timbratura" className="font-display text-lg font-medium text-marchio">
          Timbratura
        </h2>
        <span className="cifre text-sm text-gray-600">
          {formattaData(dati.oggi)}, ore {dati.adesso}
        </span>
      </div>
      {errore && <Avviso tipo="errore" className="mt-2">{errore}</Avviso>}
      {dati.aperta ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-[1_1_14rem]">
            <div className="flex items-center gap-2 font-medium text-gray-900">
              <Pallino p={dati.aperta.progetto} />
              <span className="truncate">
                {dati.aperta.progetto.codice} · {dati.aperta.progetto.nome}
              </span>
            </div>
            <div className="text-sm text-gray-600">
              Entrata alle <b className="cifre">{dati.aperta.oraInizio}</b>
              {dati.aperta.data !== dati.oggi && ` del ${formattaData(dati.aperta.data)}: l'uscita non è stata timbrata, l'orario lo completerà HR`}
            </div>
          </div>
          <Pulsante variante="primario" className="flex-[1_1_10rem] py-3 text-base" onClick={() => void timbra('uscita')} disabled={lavoro}>
            {lavoro ? 'Attendi…' : 'Timbra uscita'}
          </Pulsante>
        </div>
      ) : dati.progetti.length === 0 ? (
        <p className="mt-2 text-sm text-gray-600">Non hai progetti attivi assegnati: per timbrare chiedi a HR di assegnarti al progetto.</p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <select aria-label="Progetto" className={`${classiInput()} min-w-0 flex-[2_1_14rem] py-3`} value={scelto} onChange={(e) => setProgettoId(e.target.value)}>
            {dati.progetti.length > 1 && <option value="">Scegli il progetto…</option>}
            {dati.progetti.map((p) => (
              <option key={p.id} value={p.id}>
                {p.codice} · {p.nome}
              </option>
            ))}
          </select>
          <Pulsante variante="primario" className="flex-[1_1_10rem] py-3 text-base" onClick={() => void timbra('entrata')} disabled={lavoro || !scelto}>
            {lavoro ? 'Attendi…' : 'Timbra entrata'}
          </Pulsante>
        </div>
      )}
      <p className="mt-2 text-xs text-gray-500">Le timbrature diventano ore lavorate dopo la conferma di HR.</p>
      {dati.recenti.length > 0 && (
        <ul className="mt-3 divide-y divide-gray-100 border-t border-gray-100 text-sm">
          {dati.recenti.slice(0, 5).map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
              <span className="cifre text-gray-600">{formattaData(t.data)}</span>
              <span className="cifre font-medium">
                {t.oraInizio}–{t.oraFine ?? '?'}
              </span>
              <span className="flex min-w-0 items-center gap-1.5">
                <Pallino p={t.progetto} />
                {t.progetto.codice}
              </span>
              <Etichetta colore={ETICHETTE[t.stato].colore}>{ETICHETTE[t.stato].testo}</Etichetta>
              {t.noteHr && <span className="basis-full text-xs text-gray-600">HR: {t.noteHr}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RigaDaConfermare({ t, onFatto }: { t: Timbratura; onFatto: () => void }) {
  const [inizio, setInizio] = useState(t.oraInizio);
  const [fine, setFine] = useState(t.oraFine ?? '');
  const [errore, setErrore] = useState<string | null>(null);
  const [lavoro, setLavoro] = useState(false);

  const esegui = async (azione: () => Promise<unknown>) => {
    setErrore(null);
    setLavoro(true);
    try {
      await azione();
      onFatto();
    } catch (e) {
      setErrore(e instanceof Error ? e.message : String(e));
      setLavoro(false);
    }
  };
  const rifiuta = () => {
    const motivo = window.prompt(`Motivo del rifiuto della timbratura di ${t.dipendente.cognome} ${t.dipendente.nome} (lo leggerà il dipendente):`);
    if (motivo?.trim()) void esegui(() => api.post(`/api/timbrature/${t.id}/rifiuta`, { noteHr: motivo.trim() }));
  };

  return (
    <li className="py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-[2_1_14rem]">
          <div className="font-medium text-gray-900">
            {t.dipendente.cognome} {t.dipendente.nome}
          </div>
          <div className="flex items-center gap-1.5 text-sm text-gray-600">
            <span className="cifre">{formattaData(t.data)}</span>
            <Pallino p={t.progetto} />
            <span className="truncate">
              {t.progetto.codice} · {t.progetto.nome}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <input type="time" aria-label="Entrata" className={`${classiInput()} w-28`} value={inizio} onChange={(e) => setInizio(e.target.value)} />
          <span aria-hidden>–</span>
          <input type="time" aria-label="Uscita" className={`${classiInput(t.oraFine ? undefined : 'manca')} w-28`} value={fine} onChange={(e) => setFine(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <Pulsante variante="primario" disabled={lavoro || !inizio || !fine} onClick={() => void esegui(() => api.post(`/api/timbrature/${t.id}/conferma`, { oraInizio: inizio, oraFine: fine }))}>
            Conferma
          </Pulsante>
          <Pulsante disabled={lavoro} onClick={rifiuta}>
            Rifiuta
          </Pulsante>
        </div>
      </div>
      {!t.oraFine && !errore && <div className="mt-1 text-xs text-gray-600">Uscita non timbrata: scrivi l'orario prima di confermare.</div>}
      {errore && <Avviso tipo="errore" className="mt-2">{errore}</Avviso>}
    </li>
  );
}

export function TimbratureDaConfermare({ onCambio }: { onCambio?: () => void }) {
  const { dati, ricarica } = usaDati<Timbratura[]>('/api/timbrature');
  if (!dati || dati.length === 0) return null;
  return (
    <section className="scheda mb-4 p-3 sm:p-4" aria-labelledby="titolo-timbrature-hr">
      <h2 id="titolo-timbrature-hr" className="font-display text-lg font-medium text-marchio">
        Timbrature da confermare <span className="cifre text-base font-normal text-gray-600">({dati.length})</span>
      </h2>
      <p className="text-sm text-gray-600">Timbrate dai dipendenti. Diventano ore lavorate solo con la conferma; gli orari si possono correggere prima.</p>
      <ul className="mt-2 divide-y divide-gray-100 border-t border-gray-100">
        {dati.map((t) => (
          <RigaDaConfermare
            key={t.id}
            t={t}
            onFatto={() => {
              ricarica();
              onCambio?.();
            }}
          />
        ))}
      </ul>
    </section>
  );
}
