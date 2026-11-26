// "><(((º> sabusabu <º)))><"
/**
 * Costo della manodopera di un progetto (Giorno 41, 26/11/2026), nella scheda del progetto.
 * Solo amministratori: usa i costi orari, che sono dati riservati di HR.
 *
 * Mostra ore registrate e costo lordo, il confronto con il preventivo (euro e ore) con due
 * barre, il dettaglio per dipendente e per mese. Il preventivo si scrive qui stesso.
 *
 * Due avvertenze che il riquadro dice anche a schermo:
 * - chi non ha il costo orario in anagrafica conta nelle ore ma non negli euro: il totale
 *   è parziale finché HR non lo scrive nella scheda del dipendente;
 * - il costo usa il costo orario di oggi anche per le ore passate.
 * API: /api/costi-progetti (server/rotte/costi-progetti.ts).
 */
import { useEffect, useState, type FormEvent } from 'react';
import { centesimiDaEuro, euroDaCentesimi, formattaEuro } from '../../comune/importi';
import { formattaOre } from '../../comune/orari';
import { api, ErroreApi } from '../api';
import { usaDati } from '../usaDati';
import { Avviso, Campo, classiInput, Pulsante } from './ui';

type Dettaglio = {
  minuti: number;
  costoLordoCent: number;
  costoNettoCent: number;
  senzaCosto: number;
  preventivoManodoperaCent: number | null;
  preventivoOre: number | null;
  percentualeCosto: number | null;
  percentualeOre: number | null;
  perDipendente: { dipendenteId: number; nome: string; minuti: number; costoOrarioLordoCent: number | null; costoLordoCent: number | null }[];
  perMese: { mese: string; minuti: number; costoLordoCent: number }[];
};

const nomeMese = (mese: string) => new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${mese}-01T00:00:00Z`));
const percento = (n: number) => `${new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 }).format(n)}%`;

/** Barra del consumo: verde fino all'80%, gialla fino al 100%, rossa oltre. */
function Consumo({ etichetta, percentuale, dettaglio }: { etichetta: string; percentuale: number | null; dettaglio: string }) {
  if (percentuale === null) return null;
  const colore = percentuale > 100 ? '#c0392b' : percentuale > 80 ? '#d9a300' : '#3f8f55';
  return (
    <div className="min-w-0 flex-[1_1_16rem]">
      <div className="flex justify-between gap-2 text-sm">
        <span className="text-gray-700">{etichetta}</span>
        <span className="cifre font-medium" style={{ color: percentuale > 100 ? colore : undefined }}>
          {percento(percentuale)}
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded bg-gray-100" role="progressbar" aria-valuenow={Math.round(percentuale)} aria-valuemin={0} aria-valuemax={100} aria-label={etichetta}>
        <div className="h-full rounded" style={{ width: `${Math.min(100, percentuale)}%`, background: colore }} />
      </div>
      <div className="mt-0.5 text-xs text-gray-500">{dettaglio}</div>
    </div>
  );
}

export function CostoManodopera({ progettoId }: { progettoId: number }) {
  const { dati, errore, ricarica } = usaDati<Dettaglio>(`/api/costi-progetti/${progettoId}`);
  const [euro, setEuro] = useState('');
  const [ore, setOre] = useState('');
  const [errori, setErrori] = useState<Record<string, string>>({});
  const [messaggio, setMessaggio] = useState<{ tipo: 'errore' | 'successo'; testo: string } | null>(null);
  const [lavoro, setLavoro] = useState(false);

  useEffect(() => {
    if (!dati) return;
    setEuro(euroDaCentesimi(dati.preventivoManodoperaCent));
    setOre(dati.preventivoOre == null ? '' : String(dati.preventivoOre).replace('.', ','));
  }, [dati]);

  const salva = async (e: FormEvent) => {
    e.preventDefault();
    setMessaggio(null);
    // centesimiDaEuro solleva un errore se il testo non è un importo: qui diventa il messaggio del campo.
    let cent: number | null;
    try {
      cent = centesimiDaEuro(euro);
    } catch {
      setErrori({ preventivoManodoperaCent: 'Importo non valido (es. 12500,00)' });
      return;
    }
    setLavoro(true);
    try {
      await api.put(`/api/costi-progetti/${progettoId}/preventivo`, { preventivoManodoperaCent: cent ?? '', preventivoOre: ore.trim().replace(',', '.') });
      setErrori({});
      setMessaggio({ tipo: 'successo', testo: 'Preventivo salvato.' });
      ricarica();
    } catch (err) {
      if (err instanceof ErroreApi) setErrori(err.campi);
      setMessaggio({ tipo: 'errore', testo: err instanceof Error ? err.message : String(err) });
    } finally {
      setLavoro(false);
    }
  };

  return (
    <section className="scheda p-3 sm:p-4" aria-labelledby="titolo-costo">
      <h2 id="titolo-costo" className="font-display text-lg font-medium text-marchio">
        Costo della manodopera
      </h2>
      <p className="mb-3 text-sm text-gray-600">Ore registrate sul progetto per il costo orario lordo di ogni dipendente. Visibile solo a HR.</p>
      {errore && <Avviso tipo="errore">{errore}</Avviso>}
      {dati && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-x-8 gap-y-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Costo lordo</div>
              <div className="cifre font-display text-2xl font-medium text-marchio">{formattaEuro(dati.costoLordoCent)}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Ore registrate</div>
              <div className="cifre font-display text-2xl font-medium text-marchio">{formattaOre(dati.minuti)}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Costo netto</div>
              <div className="cifre font-display text-2xl font-medium text-gray-700">{formattaEuro(dati.costoNettoCent)}</div>
            </div>
          </div>
          {dati.senzaCosto > 0 && (
            <Avviso tipo="attenzione">
              {dati.senzaCosto === 1 ? 'Un dipendente ha' : `${dati.senzaCosto} dipendenti hanno`} ore su questo progetto ma nessun costo orario in anagrafica: il totale in euro è parziale.
            </Avviso>
          )}
          {(dati.percentualeCosto !== null || dati.percentualeOre !== null) && (
            <div className="flex flex-wrap gap-6">
              <Consumo etichetta="Preventivo in euro consumato" percentuale={dati.percentualeCosto} dettaglio={`${formattaEuro(dati.costoLordoCent)} su ${formattaEuro(dati.preventivoManodoperaCent)}`} />
              <Consumo etichetta="Ore preventivate consumate" percentuale={dati.percentualeOre} dettaglio={`${formattaOre(dati.minuti)} su ${formattaOre(Math.round((dati.preventivoOre ?? 0) * 60))}`} />
            </div>
          )}

          <form onSubmit={salva} className="flex flex-wrap items-end gap-3 border-t border-gray-100 pt-3" noValidate>
            <div className="min-w-0 flex-[1_1_12rem]">
              <Campo etichetta="Preventivo manodopera (€ lordi)" errore={errori.preventivoManodoperaCent}>
                <input inputMode="decimal" className={`${classiInput(errori.preventivoManodoperaCent)} text-right`} value={euro} onChange={(e) => setEuro(e.target.value)} placeholder="non impostato" />
              </Campo>
            </div>
            <div className="min-w-0 flex-[1_1_12rem]">
              <Campo etichetta="Ore preventivate" errore={errori.preventivoOre}>
                <input inputMode="decimal" className={`${classiInput(errori.preventivoOre)} text-right`} value={ore} onChange={(e) => setOre(e.target.value)} placeholder="non impostate" />
              </Campo>
            </div>
            <Pulsante type="submit" variante="primario" disabled={lavoro}>
              {lavoro ? 'Salvataggio…' : 'Salva preventivo'}
            </Pulsante>
          </form>
          {messaggio && <Avviso tipo={messaggio.tipo}>{messaggio.testo}</Avviso>}

          {dati.perDipendente.length === 0 ? (
            <p className="text-sm text-gray-600">Nessuna ora registrata su questo progetto.</p>
          ) : (
            <div className="flex flex-wrap gap-6">
              <div className="min-w-0 flex-[2_1_24rem] overflow-x-auto">
                <table className="cifre w-full text-sm">
                  <thead className="text-xs uppercase text-gray-500">
                    <tr>
                      <th className="py-1 text-left">Dipendente</th>
                      <th className="py-1 pl-3 text-right">Ore</th>
                      <th className="py-1 pl-3 text-right">€/ora</th>
                      <th className="py-1 pl-3 text-right">Costo lordo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dati.perDipendente.map((d) => (
                      <tr key={d.dipendenteId} className="border-t border-gray-100">
                        <td className="py-1.5">{d.nome}</td>
                        <td className="py-1.5 pl-3 text-right">{formattaOre(d.minuti)}</td>
                        <td className="py-1.5 pl-3 text-right text-gray-600">{d.costoOrarioLordoCent == null ? '—' : formattaEuro(d.costoOrarioLordoCent)}</td>
                        <td className="py-1.5 pl-3 text-right font-medium">{d.costoLordoCent == null ? <span className="font-normal text-gray-500">costo orario mancante</span> : formattaEuro(d.costoLordoCent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="min-w-0 flex-[1_1_16rem] overflow-x-auto">
                <table className="cifre w-full text-sm">
                  <thead className="text-xs uppercase text-gray-500">
                    <tr>
                      <th className="py-1 text-left">Mese</th>
                      <th className="py-1 pl-3 text-right">Ore</th>
                      <th className="py-1 pl-3 text-right">Costo lordo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dati.perMese.map((m) => (
                      <tr key={m.mese} className="border-t border-gray-100">
                        <td className="py-1.5 capitalize">{nomeMese(m.mese)}</td>
                        <td className="py-1.5 pl-3 text-right">{formattaOre(m.minuti)}</td>
                        <td className="py-1.5 pl-3 text-right font-medium">{formattaEuro(m.costoLordoCent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <p className="text-xs text-gray-500">Il costo usa il costo orario che il dipendente ha oggi in anagrafica, anche per le ore dei mesi passati.</p>
        </div>
      )}
    </section>
  );
}
