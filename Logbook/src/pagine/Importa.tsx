// "><(((º> sabusabu <º)))><"
/**
 * Import delle ore da Excel (solo HR), in tre passi:
 * 1. scarica il modello (colonne predefinite, riga di esempio, istruzioni, elenchi validi);
 * 2. scegli il file compilato: il server lo controlla e mostra l'anteprima riga per riga
 *    con gli errori (nulla viene ancora salvato);
 * 3. se non ci sono errori, conferma: il file viene ricontrollato e importato tutto
 *    insieme. Con anche un solo errore non si importa nulla.
 *
 * API: /api/importa/modello, /anteprima, /conferma (server/rotte/importa.ts).
 */
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { formattaData } from '../../comune/date';
import { formattaOre } from '../../comune/orari';
import { api, ErroreApi, scaricaFile } from '../api';
import { Avviso, Caricamento, Etichetta, IntestazionePagina, Pulsante } from '../componenti/ui';
import { Icona } from '../componenti/icone';

type RigaImport = {
  riga: number; matricola: string; data: string | null; oraInizio: string | null; oraFine: string | null;
  codiceProgetto: string; note: string | null; dipendente: string | null; progetto: string | null; minuti: number | null;
  errori: string[]; ignorata?: string;
};
type Esito = {
  righe: RigaImport[];
  riepilogo: { totali: number; valide: number; conErrori: number; ignorate: number; minuti: number };
  importabile: boolean;
  erroreFile?: string;
};

export function Importa() {
  const [file, setFile] = useState<File | null>(null);
  const [esito, setEsito] = useState<Esito | null>(null);
  const [soloErrori, setSoloErrori] = useState(false);
  const [lavoro, setLavoro] = useState<'controllo' | 'import' | null>(null);
  const [messaggio, setMessaggio] = useState<{ tipo: 'errore' | 'successo'; testo: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const scegli = async (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    setEsito(null);
    setMessaggio(null);
    setLavoro('controllo');
    try {
      const r = await api.file<Esito>('/api/importa/anteprima', f);
      setEsito(r);
      setSoloErrori(r.riepilogo.conErrori > 0);
    } catch (e) {
      setMessaggio({ tipo: 'errore', testo: e instanceof Error ? e.message : String(e) });
    } finally {
      setLavoro(null);
    }
  };

  const conferma = async () => {
    if (!file) return;
    setLavoro('import');
    setMessaggio(null);
    try {
      const r = await api.file<{ importate: number; minuti: number; periodo: string }>('/api/importa/conferma', file);
      setMessaggio({ tipo: 'successo', testo: `Importate ${r.importate} fasce orarie (${formattaOre(r.minuti)} ore) ${r.periodo}.` });
      setEsito(null);
      setFile(null);
      if (input.current) input.current.value = '';
    } catch (e) {
      // 400 con l'anteprima aggiornata: qualcosa è cambiato fra anteprima e conferma.
      if (e instanceof ErroreApi) setMessaggio({ tipo: 'errore', testo: e.message });
      await scegli(file);
    } finally {
      setLavoro(null);
    }
  };

  const righe = (esito?.righe ?? []).filter((r) => !soloErrori || r.errori.length);

  return (
    <>
      <IntestazionePagina titolo="Importa ore da Excel" sottotitolo="Le righe vengono controllate tutte prima di importare: con un solo errore non si importa nulla" />

      <div className="mb-4 grid gap-3 md:grid-cols-2">
        <div className="scheda p-4">
          <div className="mb-1 text-xs font-semibold uppercase text-gray-500">1 · Modello</div>
          <p className="mb-3 text-sm text-gray-600">Colonne: matricola, data, ora inizio, ora fine, codice progetto, note. Contiene istruzioni ed elenchi di dipendenti e progetti validi.</p>
          <Pulsante onClick={() => scaricaFile('/api/importa/modello').catch((e: Error) => setMessaggio({ tipo: 'errore', testo: e.message }))}>
            <Icona nome="scarica" dimensione={16} /> Scarica il modello .xlsx
          </Pulsante>
        </div>
        <div className="scheda p-4">
          <div className="mb-1 text-xs font-semibold uppercase text-gray-500">2 · File compilato</div>
          <p className="mb-3 text-sm text-gray-600">Scegli il file: vedrai l'anteprima con gli eventuali errori riga per riga.</p>
          <input
            ref={input}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => scegli(e.target.files?.[0])}
            className="block w-full text-sm file:mr-3 file:rounded file:border file:border-gray-300 file:bg-white file:px-3 file:py-1.5 file:text-sm hover:file:bg-gray-50"
          />
        </div>
      </div>

      {messaggio && (
        <Avviso tipo={messaggio.tipo} className="mb-3">
          {messaggio.testo} {messaggio.tipo === 'successo' && <Link to="/calendario" className="font-medium underline">Vai al calendario</Link>}
        </Avviso>
      )}
      {lavoro === 'controllo' && <Caricamento testo="Controllo del file in corso…" />}

      {esito && (
        <div className="space-y-3">
          {esito.erroreFile && <Avviso tipo="errore">{esito.erroreFile}</Avviso>}
          {esito.righe.length > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-3 scheda p-3 text-sm">
                <span className="text-xs font-semibold uppercase text-gray-500">3 · Anteprima</span>
                <span>{esito.riepilogo.totali} righe</span>
                <Etichetta colore="verde">{esito.riepilogo.valide} corrette</Etichetta>
                {esito.riepilogo.conErrori > 0 && <Etichetta colore="rosso">{esito.riepilogo.conErrori} con errori</Etichetta>}
                {esito.riepilogo.ignorate > 0 && <Etichetta colore="grigio">{esito.riepilogo.ignorate} ignorate</Etichetta>}
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={soloErrori} onChange={(e) => setSoloErrori(e.target.checked)} />
                  solo righe con errori
                </label>
                <div className="ml-auto">
                  {esito.importabile ? (
                    <Pulsante variante="primario" onClick={conferma} disabled={lavoro !== null}>
                      {lavoro === 'import' ? 'Import in corso…' : `Conferma e importa ${esito.riepilogo.valide} righe (${formattaOre(esito.riepilogo.minuti)} ore)`}
                    </Pulsante>
                  ) : (
                    <span className="font-medium text-errore">File rifiutato: correggi le righe in rosso e ricaricalo</span>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto scheda">
                <table className="cifre w-full text-sm">
                  <thead className="intestazione-tabella">
                    <tr>
                      {['Riga', 'Matricola', 'Dipendente', 'Data', 'Dalle', 'Alle', 'Ore', 'Progetto', 'Esito'].map((t) => (
                        <th key={t} className="border-b border-gray-200 px-3 py-2 text-left font-semibold">
                          {t}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {righe.map((r) => (
                      <tr key={r.riga} className={`border-b border-gray-100 align-top ${r.errori.length ? 'bg-[#fdf3f2]' : r.ignorata ? 'text-gray-400' : ''}`}>
                        <td className="px-3 py-1.5 font-medium">{r.riga}</td>
                        <td className="px-3 py-1.5">{r.matricola}</td>
                        <td className="px-3 py-1.5">{r.dipendente ?? '—'}</td>
                        <td className="px-3 py-1.5">{r.data ? formattaData(r.data) : '—'}</td>
                        <td className="px-3 py-1.5">{r.oraInizio ?? '—'}</td>
                        <td className="px-3 py-1.5">{r.oraFine ?? '—'}</td>
                        <td className="px-3 py-1.5 text-right">{r.minuti ? formattaOre(r.minuti) : '—'}</td>
                        <td className="px-3 py-1.5">{r.codiceProgetto}</td>
                        <td className="px-3 py-1.5">
                          {r.ignorata ? (
                            r.ignorata
                          ) : r.errori.length ? (
                            <ul className="list-disc pl-4 text-[#8e2a1f]">
                              {r.errori.map((e) => (
                                <li key={e}>{e}</li>
                              ))}
                            </ul>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-verde-testo"><Icona nome="spunta" dimensione={14} /> corretta</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
