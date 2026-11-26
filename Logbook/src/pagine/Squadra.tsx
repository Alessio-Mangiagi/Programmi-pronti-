// "><(((º> sabusabu <º)))><"
/**
 * "La mia squadra" (Giorno 43, 26/11/2026): la pagina del caposquadra.
 *
 * Chi è stato nominato caposquadra di un progetto da HR (scheda del progetto → Dipendenti
 * assegnati) sceglie qui progetto e giorno e scrive le ore di ogni dipendente della squadra
 * su quel progetto: una riga per persona, con le sue fasce orarie e il pulsante Salva.
 * Si possono scrivere solo oggi e i sette giorni prima; il resto resta a HR, che vede tutto
 * nel calendario e può correggere.
 *
 * Degli altri progetti del dipendente il caposquadra vede soltanto gli orari già occupati
 * ("occupato 14:00–16:00"), per non sovrapporsi: non su cosa.
 * La voce di menu compare solo a chi è caposquadra (auth/io → caposquadra).
 * API: /api/squadra (server/rotte/squadra.ts).
 */
import { useEffect, useState } from 'react';
import { durataMinuti, formattaOre } from '../../comune/orari';
import { api, ErroreApi } from '../api';
import { Avviso, Caricamento, classiInput, IntestazionePagina, Pulsante } from '../componenti/ui';
import { usaDati } from '../usaDati';

type Fascia = { oraInizio: string; oraFine: string };
type Membro = { id: number; nome: string; cognome: string; matricola: string; fasce: (Fascia & { id: number; origine: string })[]; occupato: Fascia[] };
type Squadre = { oggi: string; dal: string; progetti: { id: number; codice: string; nome: string; colore: string | null; squadra: { id: number }[] }[] };

function RigaMembro({ m, progettoId, data, onSalvato }: { m: Membro; progettoId: number; data: string; onSalvato: () => void }) {
  const [fasce, setFasce] = useState<Fascia[]>([]);
  const [messaggio, setMessaggio] = useState<{ tipo: 'errore' | 'successo'; testo: string } | null>(null);
  const [lavoro, setLavoro] = useState(false);
  const iniziali = JSON.stringify(m.fasce.map(({ oraInizio, oraFine }) => ({ oraInizio, oraFine })));

  // Le fasce salvate sul server sono il punto di partenza, anche dopo ogni ricaricamento.
  useEffect(() => {
    setFasce(JSON.parse(iniziali));
  }, [iniziali]);

  const cambia = (i: number, campo: keyof Fascia, valore: string) => setFasce(fasce.map((f, j) => (j === i ? { ...f, [campo]: valore } : f)));
  const complete = fasce.every((f) => f.oraInizio && f.oraFine);
  const modificato = JSON.stringify(fasce) !== iniziali;
  const totale = fasce.reduce((s, f) => s + (f.oraInizio && f.oraFine && f.oraFine > f.oraInizio ? durataMinuti(f.oraInizio, f.oraFine) : 0), 0);

  const salva = async () => {
    setMessaggio(null);
    setLavoro(true);
    try {
      await api.put('/api/squadra/giornata', { progettoId, dipendenteId: m.id, data, fasce });
      setMessaggio({ tipo: 'successo', testo: fasce.length ? 'Ore salvate.' : 'Ore tolte.' });
      onSalvato();
    } catch (e) {
      setMessaggio({ tipo: 'errore', testo: e instanceof ErroreApi ? e.message : 'Salvataggio non riuscito' });
    } finally {
      setLavoro(false);
    }
  };

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-medium text-gray-900">
          {m.cognome} {m.nome} <span className="text-xs font-normal text-gray-500">matr. {m.matricola}</span>
        </div>
        <div className="cifre text-sm text-gray-600">{formattaOre(totale)} ore</div>
      </div>
      {m.occupato.length > 0 && (
        <div className="cifre mt-0.5 text-xs text-gray-600">Già occupato su altri progetti: {m.occupato.map((o) => `${o.oraInizio}–${o.oraFine}`).join(', ')}</div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {fasce.map((f, i) => (
          <div key={i} className="flex items-center gap-1">
            <input type="time" aria-label={`Inizio fascia ${i + 1}`} className={`${classiInput()} w-28`} value={f.oraInizio} onChange={(e) => cambia(i, 'oraInizio', e.target.value)} />
            <span aria-hidden>–</span>
            <input type="time" aria-label={`Fine fascia ${i + 1}`} className={`${classiInput()} w-28`} value={f.oraFine} onChange={(e) => cambia(i, 'oraFine', e.target.value)} />
            <button type="button" aria-label={`Togli fascia ${i + 1}`} className="rounded px-2 py-1 text-errore hover:bg-[#fdf3f2]" onClick={() => setFasce(fasce.filter((_, j) => j !== i))}>
              ×
            </button>
          </div>
        ))}
        <Pulsante onClick={() => setFasce([...fasce, { oraInizio: '', oraFine: '' }])}>+ Fascia</Pulsante>
        <span className="flex-1" />
        <Pulsante variante="primario" onClick={() => void salva()} disabled={lavoro || !modificato || !complete}>
          {lavoro ? 'Salvataggio…' : 'Salva'}
        </Pulsante>
      </div>
      {messaggio && <Avviso tipo={messaggio.tipo} className="mt-2">{messaggio.testo}</Avviso>}
    </li>
  );
}

export function Squadra() {
  const { dati: squadre, errore } = usaDati<Squadre>('/api/squadra');
  const [progettoId, setProgettoId] = useState<number | null>(null);
  const [data, setData] = useState('');

  useEffect(() => {
    if (!squadre) return;
    if (progettoId === null && squadre.progetti.length) setProgettoId(squadre.progetti[0].id);
    if (!data) setData(squadre.oggi);
  }, [squadre, progettoId, data]);

  const pronto = squadre && progettoId !== null && data >= squadre.dal && data <= squadre.oggi;
  const { dati: membri, errore: erroreGiornata, ricarica } = usaDati<Membro[]>(pronto ? `/api/squadra/giornata?progettoId=${progettoId}&data=${data}` : null);

  if (errore) return <Avviso tipo="errore">{errore}</Avviso>;
  if (!squadre) return <Caricamento />;

  return (
    <>
      <IntestazionePagina titolo="La mia squadra" sottotitolo="Ore dei dipendenti dei progetti di cui sei caposquadra" />
      {squadre.progetti.length === 0 ? (
        <Avviso tipo="info">Non sei caposquadra di nessun progetto attivo. La nomina la fa HR dalla scheda del progetto.</Avviso>
      ) : (
        <>
          <div className="scheda mb-3 flex flex-wrap items-end gap-3 p-3">
            <label className="min-w-0 flex-[2_1_14rem] text-sm">
              <span className="mb-1 block font-medium text-gray-700">Progetto</span>
              <select className={classiInput()} value={progettoId ?? ''} onChange={(e) => setProgettoId(Number(e.target.value))}>
                {squadre.progetti.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.codice} · {p.nome} ({p.squadra.length})
                  </option>
                ))}
              </select>
            </label>
            <label className="flex-[1_1_10rem] text-sm">
              <span className="mb-1 block font-medium text-gray-700">Giorno</span>
              <input type="date" className={classiInput()} min={squadre.dal} max={squadre.oggi} value={data} onChange={(e) => setData(e.target.value)} />
            </label>
          </div>
          <p className="mb-3 text-xs text-gray-500">Puoi scrivere le ore di oggi e dei sette giorni precedenti, solo su questo progetto. HR vede tutto e può correggere.</p>
          {!pronto && <Avviso tipo="info">Scegli un giorno fra quelli ammessi.</Avviso>}
          {erroreGiornata && <Avviso tipo="errore">{erroreGiornata}</Avviso>}
          {pronto && !membri && !erroreGiornata && <Caricamento />}
          {pronto && membri && (
            <ul className="scheda divide-y divide-gray-100 px-3 sm:px-4">
              {membri.map((m) => (
                <RigaMembro key={`${m.id}-${data}-${progettoId}`} m={m} progettoId={progettoId!} data={data} onSalvato={ricarica} />
              ))}
              {membri.length === 0 && <li className="py-4 text-center text-sm text-gray-500">Nessun dipendente attivo assegnato a questo progetto.</li>}
            </ul>
          )}
        </>
      )}
    </>
  );
}
