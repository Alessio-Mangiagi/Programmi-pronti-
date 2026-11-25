// "><(((º> sabusabu <º)))><"
/**
 * Documentazione del giorno nella finestra delle ore, solo HR (Giorno 28, risposta 3c del
 * 24/11/2026: "il menu di inserimento deve poter inserire della documentazione e delle note";
 * 3a+b: nella finestra delle ore del giorno allegati e nota, "che finiscono anche nella
 * documentazione del progetto della fascia").
 *
 * - Elenco: la documentazione dei progetti della giornata con la data di quel giorno
 *   (GET /api/documenti-progetto?data=), con il file da aprire ed "Elimina".
 * - "+ Aggiungi documentazione": progetto (uno di quelli delle fasce), titolo già proposto
 *   ("Giornata del 20/11/2026 – Rossi Mario"), nota, avanzamento facoltativo e file.
 *   Si salva come documentazione del progetto con origine GIORNATA: la si ritrova nella
 *   pagina del progetto con l'etichetta "dalla giornata" (componenti/DocumentazioneProgetto.tsx).
 *
 * Non dipende dal "Salva giornata": la documentazione si salva subito con il suo pulsante.
 */
import { useState } from 'react';
import { formattaData } from '../../comune/date';
import { api, ErroreApi } from '../api';
import { coloreProgetto } from '../colori';
import type { DocumentoProgetto, Progetto, VistaFile } from '../tipi';
import { usaDati } from '../usaDati';
import { CaricaFile, LinkFile } from './File';
import { Avviso, Campo, classiInput, Pulsante } from './ui';

export function DocumentazioneGiorno({ data, nomeDipendente, progetti }: { data: string; nomeDipendente: string; progetti: Progetto[] }) {
  const { dati: documenti, ricarica } = usaDati<DocumentoProgetto[]>(`/api/documenti-progetto?data=${data}`);
  const [aperto, setAperto] = useState(false);
  const [progettoId, setProgettoId] = useState('');
  const [titolo, setTitolo] = useState(`Giornata del ${formattaData(data)} – ${nomeDipendente}`);
  const [nota, setNota] = useState('');
  const [percentuale, setPercentuale] = useState('');
  const [file, setFile] = useState<VistaFile | null>(null);
  const [errori, setErrori] = useState<Record<string, string>>({});
  const [messaggio, setMessaggio] = useState<{ tipo: 'errore' | 'successo'; testo: string } | null>(null);
  const [invio, setInvio] = useState(false);

  const ids = new Set(progetti.map((p) => p.id));
  const delGiorno = (documenti ?? []).filter((d) => ids.has(d.progettoId));
  // Con un solo progetto nella giornata non serve sceglierlo.
  const progettoScelto = progettoId || (progetti.length === 1 ? String(progetti[0].id) : '');

  const salva = async () => {
    setMessaggio(null);
    setErrori({});
    setInvio(true);
    try {
      await api.post('/api/documenti-progetto', {
        progettoId: Number(progettoScelto),
        data,
        titolo,
        nota,
        percentuale: percentuale === '' ? null : Number(percentuale),
        fileId: file?.id ?? null,
        origine: 'GIORNATA',
      });
      setMessaggio({ tipo: 'successo', testo: 'Documentazione salvata: la trovi anche nella pagina del progetto.' });
      setAperto(false);
      setNota('');
      setPercentuale('');
      setFile(null);
      ricarica();
    } catch (e) {
      if (e instanceof ErroreApi) {
        setErrori(e.campi);
        setMessaggio({ tipo: 'errore', testo: e.message });
      }
    } finally {
      setInvio(false);
    }
  };

  const elimina = async (d: DocumentoProgetto) => {
    if (!window.confirm(`Eliminare "${d.titolo}"${d.file ? ' e il suo file' : ''}?`)) return;
    try {
      await api.delete(`/api/documenti-progetto/${d.id}`);
      ricarica();
    } catch (e) {
      setMessaggio({ tipo: 'errore', testo: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <section className="space-y-2 border-t border-gray-100 pt-3" aria-labelledby="titolo-doc-giorno">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="titolo-doc-giorno" className="text-sm font-semibold uppercase text-gray-500">
          Documentazione del giorno
        </h3>
        {!aperto && progetti.length > 0 && (
          <Pulsante variante="leggero" className="!px-2 !py-0.5" onClick={() => setAperto(true)}>
            + Aggiungi documentazione
          </Pulsante>
        )}
      </div>
      {messaggio && <Avviso tipo={messaggio.tipo}>{messaggio.testo}</Avviso>}
      {progetti.length === 0 && <p className="text-xs text-gray-500">La documentazione va sul progetto di una fascia: aggiungi e salva prima le ore del giorno.</p>}

      {delGiorno.length > 0 && (
        <ul className="divide-y divide-gray-100 text-sm">
          {delGiorno.map((d) => (
            <li key={d.id} className="flex flex-wrap items-start gap-2 py-1.5">
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: coloreProgetto(d.progetto) }} />
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {d.titolo} <span className="text-xs font-normal text-gray-500">· {d.progetto.codice}{d.percentuale != null ? ` · avanzamento ${d.percentuale}%` : ''}</span>
                </div>
                {d.nota && <p className="whitespace-pre-line text-xs text-gray-600">{d.nota}</p>}
                {d.file && <LinkFile file={d.file} compatto />}
              </div>
              <button type="button" className="rounded px-1.5 py-0.5 text-xs text-errore hover:bg-[#fdf3f2]" onClick={() => elimina(d)}>
                Elimina
              </button>
            </li>
          ))}
        </ul>
      )}

      {aperto && (
        <div className="space-y-2 rounded border border-gray-200 p-2">
          <div className="flex flex-wrap gap-2 [&>*]:min-w-0 [&>*]:flex-[1_1_12rem]">
            {progetti.length > 1 && (
              <Campo etichetta="Progetto" obbligatorio errore={errori.progettoId}>
                <select className={classiInput(errori.progettoId)} value={progettoId} onChange={(e) => setProgettoId(e.target.value)}>
                  <option value="">— scegli —</option>
                  {progetti.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.codice} · {p.nome}
                    </option>
                  ))}
                </select>
              </Campo>
            )}
            <Campo etichetta="Titolo" obbligatorio errore={errori.titolo}>
              <input className={classiInput(errori.titolo)} value={titolo} maxLength={150} onChange={(e) => setTitolo(e.target.value)} />
            </Campo>
            <Campo etichetta="Avanzamento %" errore={errori.percentuale} aiuto="Facoltativo, 0-100">
              <input type="number" min={0} max={100} className={classiInput(errori.percentuale)} value={percentuale} onChange={(e) => setPercentuale(e.target.value)} />
            </Campo>
          </div>
          <Campo etichetta="Nota" errore={errori.nota}>
            <textarea rows={2} className={classiInput(errori.nota)} maxLength={2000} value={nota} onChange={(e) => setNota(e.target.value)} />
          </Campo>
          <CaricaFile file={file} onFile={setFile} errore={errori.fileId} testoPulsante="Allega file…" />
          <div className="flex justify-end gap-2">
            <Pulsante onClick={() => setAperto(false)}>Annulla</Pulsante>
            <Pulsante variante="primario" onClick={salva} disabled={invio || !progettoScelto || !titolo.trim()}>
              {invio ? 'Salvataggio…' : 'Salva documentazione'}
            </Pulsante>
          </div>
        </div>
      )}
    </section>
  );
}
