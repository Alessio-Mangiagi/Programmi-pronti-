// "><(((º> sabusabu <º)))><"
/**
 * Dashboard provvisoria (Giorno 2): benvenuto e, per HR, i conteggi del database.
 * Il riepilogo vero (ore del mese, assenze da approvare) arriva al Giorno 9.
 */
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Avviso, Caricamento, IntestazionePagina } from '../componenti/ui';
import { formattaData } from '../../comune/date';
import { formattaOre } from '../../comune/orari';

type StatoDati = {
  dipendenti: number;
  progetti: number;
  registrazioni: number;
  assenze: number;
  festivita: number;
  utenti: number;
  minutiTotali: number;
  periodo: { da: string; a: string } | null;
};

export function Dashboard() {
  const { utente, admin } = useAuth();
  const [stato, setStato] = useState<StatoDati | null>(null);
  const [errore, setErrore] = useState<string | null>(null);

  useEffect(() => {
    if (!admin) return;
    api.get<StatoDati>('/api/stato-dati').then(setStato, (e: Error) => setErrore(e.message));
  }, [admin]);

  return (
    <>
      <IntestazionePagina titolo="Dashboard" sottotitolo={`Benvenuto, ${utente?.nomeVisualizzato}`} />
      {!admin && <Avviso tipo="info">Dal menu puoi consultare il calendario delle tue ore e gestire le tue assenze.</Avviso>}
      {admin && errore && <Avviso tipo="errore">{errore}</Avviso>}
      {admin && !errore && !stato && <Caricamento />}
      {admin && stato && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {(
            [
              ['Dipendenti', stato.dipendenti],
              ['Progetti', stato.progetti],
              ['Fasce orarie', stato.registrazioni],
              ['Ore totali', formattaOre(stato.minutiTotali)],
              ['Assenze', stato.assenze],
              ['Account', stato.utenti],
            ] as const
          ).map(([etichetta, valore]) => (
            <div key={etichetta} className="rounded border border-gray-200 bg-white px-3 py-2">
              <div className="text-xs uppercase text-gray-500">{etichetta}</div>
              <div className="cifre text-xl font-semibold text-marchio">{valore}</div>
            </div>
          ))}
          {stato.periodo && (
            <p className="col-span-full text-sm text-gray-500">
              Ore registrate dal {formattaData(stato.periodo.da)} al {formattaData(stato.periodo.a)}.
            </p>
          )}
        </div>
      )}
    </>
  );
}
