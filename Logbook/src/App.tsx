// "><(((º> sabusabu <º)))><"
/**
 * Pagina provvisoria del Giorno 1: dimostra che frontend, backend e database sono
 * collegati mostrando quanti dati ci sono (GET /api/stato-dati).
 * Dal Giorno 2 lascia il posto a login, menu laterale e pagine vere.
 */
import { useEffect, useState } from 'react';
import { formattaData } from '../comune/date';
import { formattaOre } from '../comune/orari';

/** Risposta di GET /api/stato-dati (server/app.ts). */
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

export default function App() {
  const [stato, setStato] = useState<StatoDati | null>(null);
  const [errore, setErrore] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/stato-dati')
      .then(async (r) => {
        if (!r.ok) throw new Error(`Il server ha risposto ${r.status}`);
        setStato(await r.json());
      })
      .catch((e: Error) => setErrore(`Backend non raggiungibile: ${e.message}`));
  }, []);

  const voci: [string, string][] = stato
    ? [
        ['Dipendenti', String(stato.dipendenti)],
        ['Progetti', String(stato.progetti)],
        ['Fasce orarie registrate', String(stato.registrazioni)],
        ['Ore lavorate totali', formattaOre(stato.minutiTotali)],
        ['Assenze', String(stato.assenze)],
        ['Festività', String(stato.festivita)],
      ]
    : [];

  return (
    <div className="min-h-screen">
      <header className="bg-marchio text-white px-6 py-3 flex items-center gap-3 shadow">
        <span className="text-lg font-semibold tracking-wide">Logbook</span>
        <span className="text-sm text-white/70">ore e presenze dipendenti</span>
      </header>
      <main className="max-w-3xl mx-auto p-6">
        <h1 className="text-xl font-semibold text-marchio mb-1">Stato del database</h1>
        <p className="text-sm text-gray-500 mb-4">
          Pagina di verifica del Giorno 1: login e menu arrivano al Giorno 2.
        </p>
        {errore && <div className="rounded border border-red-300 bg-red-50 text-red-800 px-4 py-3">{errore}</div>}
        {!errore && !stato && <div className="text-gray-500">Caricamento…</div>}
        {stato && (
          <>
            <table className="w-full bg-white border border-gray-200 text-sm cifre">
              <tbody>
                {voci.map(([etichetta, valore]) => (
                  <tr key={etichetta} className="border-b border-gray-100 last:border-0">
                    <td className="px-4 py-2 text-gray-600">{etichetta}</td>
                    <td className="px-4 py-2 text-right font-medium">{valore}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {stato.periodo && (
              <p className="text-sm text-gray-500 mt-3">
                Ore registrate dal {formattaData(stato.periodo.da)} al {formattaData(stato.periodo.a)}.
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}
