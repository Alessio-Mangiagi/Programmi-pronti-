// "><(((º> sabusabu <º)))><"
/**
 * Chiusura del mese (Giorno 37, 26/11/2026), dentro "Estratti mensili" della pagina Esporta.
 *
 * Mostra lo stato del mese scelto negli estratti (aperto, oppure chiuso da chi e quando) e i
 * pulsanti di HR: "Chiudi mese" apre una finestra con quello che manca (richieste di assenza
 * ancora da decidere, che bloccano la chiusura, e giorni lavorativi senza ore, che sono solo
 * un avviso); "Riapri mese" toglie il blocco per fare una correzione.
 *
 * Un mese chiuso non si modifica più: ore, assenze e festività di quel mese sono rifiutate
 * dal server (server/servizi/mesi-chiusi.ts), così l'estratto dato al consulente paghe resta
 * uguale a quello in Copilota. API: /api/mesi-chiusi.
 */
import { useState } from 'react';
import { formattaData } from '../../comune/date';
import { api } from '../api';
import { usaDati } from '../usaDati';
import { Icona } from './icone';
import { Avviso, Etichetta, Modale, Pulsante } from './ui';

export type MeseChiuso = { mese: string; chiusoIl: string; chiusoDa: string };
type Controllo = {
  nome: string;
  finito: boolean;
  chiuso: MeseChiuso | null;
  richiesteInAttesa: { id: number; dipendente: string; tipo: string; dataInizio: string; dataFine: string }[];
  giorniSenzaOre: { dipendenteId: number; dipendente: string; giorni: string[] }[];
};

const NOMI_TIPO: Record<string, string> = { FERIE: 'ferie', PERMESSO: 'permesso', MALATTIA: 'malattia' };

export function ChiusuraMese({ mese }: { mese: string }) {
  const valido = /^\d{4}-\d{2}$/.test(mese);
  const { dati, ricarica } = usaDati<Controllo>(valido ? `/api/mesi-chiusi/${mese}/controllo` : null);
  const [aperta, setAperta] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [lavoro, setLavoro] = useState(false);

  if (!valido || !dati) return null;

  const esegui = async (azione: () => Promise<unknown>) => {
    setErrore(null);
    setLavoro(true);
    try {
      await azione();
      setAperta(false);
      ricarica();
    } catch (e) {
      setErrore(e instanceof Error ? e.message : String(e));
    } finally {
      setLavoro(false);
    }
  };
  const riapri = () => {
    if (!window.confirm(`Riaprire ${dati.nome}? Ore e assenze del mese torneranno modificabili. Ricorda di richiuderlo dopo la correzione.`)) return;
    void esegui(() => api.delete(`/api/mesi-chiusi/${mese}`));
  };
  const giorniScoperti = dati.giorniSenzaOre.reduce((s, r) => s + r.giorni.length, 0);

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3 text-sm">
      <span className="font-medium text-gray-700">Chiusura di {dati.nome}:</span>
      {dati.chiuso ? (
        <>
          <Etichetta colore="verde">Chiuso</Etichetta>
          <span className="text-gray-600">
            il {formattaData(dati.chiuso.chiusoIl.slice(0, 10))} da {dati.chiuso.chiusoDa}: ore e assenze non si modificano più
          </span>
          <span className="flex-1" />
          <Pulsante onClick={riapri} disabled={lavoro}>
            Riapri mese
          </Pulsante>
        </>
      ) : (
        <>
          <Etichetta colore="grigio">Aperto</Etichetta>
          <span className="text-gray-600">{dati.finito ? 'ore e assenze si possono ancora modificare' : 'si potrà chiudere quando il mese è finito'}</span>
          <span className="flex-1" />
          <Pulsante variante="primario" onClick={() => { setErrore(null); setAperta(true); }} disabled={!dati.finito}>
            <Icona nome="lucchetto" dimensione={16} /> Chiudi mese
          </Pulsante>
        </>
      )}
      {errore && !aperta && <Avviso tipo="errore" className="basis-full">{errore}</Avviso>}

      <Modale titolo={`Chiudere ${dati.nome}?`} aperta={aperta} onChiudi={() => setAperta(false)}>
        <div className="space-y-3 text-sm">
          <p>Dopo la chiusura ore, assenze e festività di {dati.nome} non si possono più modificare, finché il mese non viene riaperto.</p>
          {dati.richiesteInAttesa.length > 0 && (
            <Avviso tipo="errore">
              <b>Prima vanno decise {dati.richiesteInAttesa.length === 1 ? 'questa richiesta' : 'queste richieste'} di assenza:</b>
              <ul className="mt-1 list-disc pl-5">
                {dati.richiesteInAttesa.map((r) => (
                  <li key={r.id}>
                    {r.dipendente}: {NOMI_TIPO[r.tipo] ?? r.tipo}, {formattaData(r.dataInizio)}
                    {r.dataFine !== r.dataInizio ? ` → ${formattaData(r.dataFine)}` : ''}
                  </li>
                ))}
              </ul>
            </Avviso>
          )}
          {giorniScoperti > 0 ? (
            <Avviso tipo="info">
              <b>
                {giorniScoperti === 1 ? 'Un giorno lavorativo' : `${giorniScoperti} giorni lavorativi`} senza ore né assenza.
              </b>{' '}
              Si può chiudere lo stesso, se è giusto così.
              <ul className="mt-1 max-h-40 list-disc overflow-y-auto pl-5">
                {dati.giorniSenzaOre.map((r) => (
                  <li key={r.dipendenteId}>
                    {r.dipendente}: {r.giorni.map((g) => formattaData(g).slice(0, 5)).join(', ')}
                  </li>
                ))}
              </ul>
            </Avviso>
          ) : (
            dati.richiesteInAttesa.length === 0 && <Avviso tipo="successo">Tutto in ordine: nessuna richiesta in attesa e nessun giorno lavorativo senza ore.</Avviso>
          )}
          {errore && <Avviso tipo="errore">{errore}</Avviso>}
          <div className="flex justify-end gap-2 border-t border-gray-100 pt-3">
            <Pulsante onClick={() => setAperta(false)}>Annulla</Pulsante>
            <Pulsante variante="primario" disabled={lavoro || dati.richiesteInAttesa.length > 0} onClick={() => void esegui(() => api.post('/api/mesi-chiusi', { mese }))}>
              {lavoro ? 'Chiusura…' : 'Chiudi mese'}
            </Pulsante>
          </div>
        </div>
      </Modale>
    </div>
  );
}
