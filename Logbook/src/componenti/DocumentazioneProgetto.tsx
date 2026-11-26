// "><(((º> sabusabu <º)))><"
/**
 * Avanzamento e documentazione di un progetto (Giorno 17, risposta 2c), nella pagina del
 * progetto (pagine/SchedaProgetto.tsx). Due sezioni affiancate o impilate:
 *
 * 1. Avanzamento: ultima percentuale dichiarata e andamento nel tempo (GraficoAvanzamento).
 * 2. Documentazione: modulo per caricare (titolo, giorno, percentuale, nota, file) ed
 *    elenco con filtro a caratteri; "visto"/"da vedere", risposta, eliminazione e, se c'è il
 *    collegamento in Impostazioni e il progetto ha la commessa, invio a SkyTower.
 * Dal Giorno 20 (risposta 2 "tutti i dati li inserisce HR") la sezione è solo di HR: quello
 * che HR carica nasce già "visto"; "da vedere" resta per riaprire un documento.
 *
 * API: /api/documenti-progetto (server/rotte/documentazione-progetto.ts); i file passano
 * prima da /api/file (CaricaFile).
 */
import { useMemo, useState, type FormEvent } from 'react';
import { DATA_MINIMA, formattaData } from '../../comune/date';
import { useAuth } from '../auth';
import { schemaDocumentoProgetto } from '../../comune/documenti';
import { erroriPerCampo } from '../../comune/schemi';
import { api, ErroreApi } from '../api';
import type { DocumentoProgetto, Progetto, VistaFile } from '../tipi';
import { usaDati } from '../usaDati';
import { CaricaFile, LinkFile } from './File';
import { GraficoAvanzamento } from './GraficoAvanzamento';
import { corrisponde } from './SceltaConRicerca';
import { Avviso, Caricamento, Campo, classiInput, Etichetta, Pulsante } from './ui';

type Modulo = { titolo: string; data: string; percentuale: string; nota: string };
const VUOTO = (oggi: string): Modulo => ({ titolo: '', data: oggi, percentuale: '', nota: '' });

export function DocumentazioneProgetto({ progetto, skytowerAttivo }: { progetto: Progetto; skytowerAttivo: boolean }) {
  const { dati, errore, caricamento, ricarica, setDati } = usaDati<DocumentoProgetto[]>(`/api/documenti-progetto?progettoId=${progetto.id}`);
  const [filtro, setFiltro] = useState('');
  const [soloDaVedere, setSoloDaVedere] = useState(false);

  const punti = useMemo(
    () => (dati ?? []).filter((d) => d.percentuale != null).map((d) => ({ id: d.id, data: d.data, percentuale: d.percentuale!, titolo: d.titolo, autore: d.autore.nome })),
    [dati],
  );
  const ultimo = useMemo(() => [...punti].sort((a, b) => b.data.localeCompare(a.data) || b.id - a.id)[0], [punti]);
  const daVedere = (dati ?? []).filter((d) => !d.visto).length;
  const visibili = (dati ?? []).filter((d) => (!soloDaVedere || !d.visto) && corrisponde(`${d.titolo} ${d.nota ?? ''} ${d.autore.nome} ${d.rispostaHr ?? ''}`, filtro));

  /** Sostituisce un documento aggiornato dal server senza ricaricare tutto l'elenco. */
  const aggiorna = (d: DocumentoProgetto) => setDati((elenco) => (elenco ?? []).map((x) => (x.id === d.id ? d : x)));

  // Si carica sui progetti non chiusi (stessa regola del server).
  const puoCaricare = progetto.stato !== 'CHIUSO';

  return (
    <>
      <section className="scheda p-3 sm:p-4" aria-labelledby="titolo-avanzamento">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="titolo-avanzamento" className="text-sm font-semibold uppercase text-gray-500">
            Avanzamento dichiarato
          </h2>
          {ultimo && (
            <span className="text-sm text-gray-600">
              ultimo <span className="cifre font-display text-2xl font-medium text-marchio">{ultimo.percentuale}%</span> il {formattaData(ultimo.data)}
            </span>
          )}
        </div>
        {dati ? <GraficoAvanzamento punti={punti} /> : <Caricamento />}
      </section>

      <section className="scheda p-3 sm:p-4" aria-labelledby="titolo-documentazione">
        <h2 id="titolo-documentazione" className="mb-3 flex flex-wrap items-center gap-2 text-sm font-semibold uppercase text-gray-500">
          Documentazione
          {daVedere > 0 && <Etichetta colore="giallo">{daVedere} da vedere</Etichetta>}
        </h2>
        {puoCaricare ? (
          <NuovoDocumento progettoId={progetto.id} onCreato={ricarica} />
        ) : (
          <Avviso tipo="info" className="mb-3">
            Il progetto è chiuso: non si carica nuova documentazione.
          </Avviso>
        )}

        {/* Filtro a caratteri (richiesta del 24/11/2026) e "solo da vedere" per HR */}
        <div className="mb-2 mt-4 flex flex-wrap items-center gap-2">
          <input
            type="search"
            aria-label="Cerca nella documentazione"
            placeholder="Cerca per titolo, nota, autore…"
            className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-marchio focus:outline-none sm:w-72"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
          />
          <label className="flex items-center gap-1.5 text-sm text-gray-700">
            <input type="checkbox" checked={soloDaVedere} onChange={(e) => setSoloDaVedere(e.target.checked)} />
            Solo da vedere
          </label>
          <span className="ml-auto text-xs text-gray-500">
            {visibili.length} {visibili.length === 1 ? 'documento' : 'documenti'}
          </span>
        </div>
        {errore && <Avviso tipo="errore">{errore}</Avviso>}
        {caricamento && !dati && <Caricamento />}
        <ul className="divide-y divide-gray-100">
          {visibili.map((d) => (
            <VoceDocumento key={d.id} documento={d} skytowerAttivo={skytowerAttivo} onAggiornato={aggiorna} onEliminato={ricarica} />
          ))}
          {dati && visibili.length === 0 && (
            <li className="py-6 text-center text-sm text-gray-500">{filtro || soloDaVedere ? 'Nessun documento corrisponde al filtro' : 'Ancora nessuna documentazione'}</li>
          )}
        </ul>
      </section>
    </>
  );
}

/** Modulo di caricamento: almeno uno fra file, nota e percentuale (regola dello schema). */
function NuovoDocumento({ progettoId, onCreato }: { progettoId: number; onCreato: () => void }) {
  // "Oggi" di Copilota (server): nessuna documentazione con data futura.
  const { oggi } = useAuth();
  const [m, setM] = useState<Modulo>(() => VUOTO(oggi));
  const [file, setFile] = useState<VistaFile | null>(null);
  const [errori, setErrori] = useState<Record<string, string>>({});
  const [messaggio, setMessaggio] = useState<{ tipo: 'errore' | 'successo'; testo: string } | null>(null);
  const [invio, setInvio] = useState(false);
  const imposta = (k: keyof Modulo, v: string) => setM((x) => ({ ...x, [k]: v }));

  const salva = async (e: FormEvent) => {
    e.preventDefault();
    setMessaggio(null);
    const corpo = { progettoId, ...m, fileId: file?.id ?? null, origine: 'PROGETTO' };
    const controllo = schemaDocumentoProgetto.safeParse(corpo);
    if (!controllo.success) {
      setErrori(erroriPerCampo(controllo.error));
      return;
    }
    setErrori({});
    setInvio(true);
    try {
      await api.post('/api/documenti-progetto', corpo);
      setM(VUOTO(oggi));
      setFile(null);
      setMessaggio({ tipo: 'successo', testo: 'Documentazione caricata' });
      onCreato();
    } catch (err) {
      if (err instanceof ErroreApi) {
        setErrori(err.campi);
        setMessaggio({ tipo: 'errore', testo: err.message });
      }
    } finally {
      setInvio(false);
    }
  };

  return (
    <form onSubmit={salva} className="space-y-3 rounded border border-gray-200 bg-fondo p-3" noValidate>
      {messaggio && <Avviso tipo={messaggio.tipo}>{messaggio.testo}</Avviso>}
      <div className="flex flex-wrap gap-3 [&>*]:min-w-0">
        <Campo etichetta="Titolo" obbligatorio errore={errori.titolo} className="flex-[3_1_14rem]">
          <input className={classiInput(errori.titolo)} placeholder="Es. Getto solaio piano 1" value={m.titolo} onChange={(e) => imposta('titolo', e.target.value)} maxLength={150} />
        </Campo>
        <Campo etichetta="Giorno" obbligatorio errore={errori.data} className="flex-[1_1_9rem]">
          <input type="date" min={DATA_MINIMA} max={oggi} className={classiInput(errori.data)} value={m.data} onChange={(e) => imposta('data', e.target.value)} />
        </Campo>
        <Campo etichetta="Avanzamento (%)" errore={errori.percentuale} aiuto="0-100, facoltativo" className="flex-[1_1_8rem]">
          <input type="number" min={0} max={100} step={1} inputMode="numeric" className={`${classiInput(errori.percentuale)} text-right`} value={m.percentuale} onChange={(e) => imposta('percentuale', e.target.value)} />
        </Campo>
      </div>
      <Campo etichetta="Nota" errore={errori.nota}>
        <textarea rows={2} className={classiInput(errori.nota)} placeholder="Cosa è stato fatto, problemi, prossimi passi" value={m.nota} onChange={(e) => imposta('nota', e.target.value)} maxLength={2000} />
      </Campo>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="text-sm">
          <span className="mb-1 block font-ui text-[0.82rem] font-semibold text-gray-600">File (foto, verbale, rapportino…)</span>
          <CaricaFile file={file} onFile={setFile} errore={errori.fileId} />
        </div>
        <Pulsante type="submit" variante="primario" disabled={invio}>
          {invio ? 'Caricamento…' : 'Carica documentazione'}
        </Pulsante>
      </div>
    </form>
  );
}

/** Un documento dell'elenco con le azioni permesse a chi guarda. */
function VoceDocumento({
  documento: d, skytowerAttivo, onAggiornato, onEliminato,
}: {
  documento: DocumentoProgetto; skytowerAttivo: boolean; onAggiornato: (d: DocumentoProgetto) => void; onEliminato: () => void;
}) {
  const [risposta, setRisposta] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [occupato, setOccupato] = useState(false);

  const esegui = async (azione: () => Promise<void>) => {
    setErrore(null);
    setOccupato(true);
    try {
      await azione();
    } catch (e) {
      setErrore(e instanceof Error ? e.message : String(e));
    } finally {
      setOccupato(false);
    }
  };
  const revisione = (corpo: { visto?: boolean; rispostaHr?: string }) =>
    esegui(async () => onAggiornato(await api.patch<DocumentoProgetto>(`/api/documenti-progetto/${d.id}/revisione`, corpo)));

  // "Invia a SkyTower": solo HR, solo con collegamento e commessa (risposta 4a), solo con un file.
  const inviabile = skytowerAttivo && !!d.progetto.commessaSkytower && !!d.file && !d.skytowerInviatoIl;

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="cifre text-sm text-gray-500">{formattaData(d.data)}</span>
        <span className="min-w-0 font-medium text-testo-forte">{d.titolo}</span>
        {d.percentuale != null && <span className="cifre rounded bg-ghiaccio px-1.5 py-0.5 text-xs font-semibold text-marchio">{d.percentuale}%</span>}
        {d.origine === 'GIORNATA' && <span className="text-xs text-gray-500">dalla giornata</span>}
        <span className="ml-auto flex flex-wrap items-center gap-2 text-xs text-gray-500">
          <span>{d.autore.nome}</span>
          {d.visto ? (
            <Etichetta colore="verde">Visto{d.vistoDa ? ` da ${d.vistoDa.username}` : ''}</Etichetta>
          ) : (
            <Etichetta colore="giallo">Da vedere</Etichetta>
          )}
        </span>
      </div>
      {d.nota && <p className="mt-1 whitespace-pre-line text-sm text-gray-700">{d.nota}</p>}
      {d.file && (
        <div className="mt-1 text-sm">
          <LinkFile file={d.file} />
        </div>
      )}
      {d.rispostaHr && risposta === null && (
        <Avviso tipo="info" className="mt-2">
          <b>Commento HR:</b> {d.rispostaHr}
        </Avviso>
      )}
      {d.skytowerInviatoIl && (
        <p className="mt-1 text-xs text-verde-testo">
          Inviato a SkyTower il {formattaData(d.skytowerInviatoIl.slice(0, 10))}
          {d.skytowerUrl ? (
            <>
              {' '}
              —{' '}
              <a href={d.skytowerUrl} target="_blank" rel="noopener" className="underline">
                {d.skytowerId ?? 'apri'}
              </a>
            </>
          ) : (
            ` (${d.skytowerId})`
          )}
        </p>
      )}
      {errore && (
        <Avviso tipo="errore" className="mt-2">
          {errore}
        </Avviso>
      )}

      {risposta !== null && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <Campo etichetta="Commento" className="min-w-0 flex-[1_1_16rem]">
            <textarea rows={2} className={classiInput()} value={risposta} onChange={(e) => setRisposta(e.target.value)} maxLength={1000} autoFocus />
          </Campo>
          <Pulsante onClick={() => setRisposta(null)}>Annulla</Pulsante>
          <Pulsante variante="primario" disabled={occupato} onClick={() => revisione({ rispostaHr: risposta, visto: true }).then(() => setRisposta(null))}>
            Salva commento
          </Pulsante>
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        <Pulsante variante="leggero" className="!px-2 !py-0.5" disabled={occupato} onClick={() => revisione({ visto: !d.visto })}>
          {d.visto ? 'Segna da vedere' : 'Segna visto'}
        </Pulsante>
        {risposta === null && (
          <Pulsante variante="leggero" className="!px-2 !py-0.5" onClick={() => setRisposta(d.rispostaHr ?? '')}>
            {d.rispostaHr ? 'Modifica commento' : 'Commenta'}
          </Pulsante>
        )}
        {inviabile && (
          <Pulsante
            variante="leggero"
            className="!px-2 !py-0.5"
            disabled={occupato}
            onClick={() => esegui(async () => onAggiornato(await api.post<DocumentoProgetto>(`/api/documenti-progetto/${d.id}/skytower`)))}
            title={`Invia il file nella commessa ${d.progetto.commessaSkytower} di SkyTower`}
          >
            {occupato ? 'Invio…' : 'Invia a SkyTower'}
          </Pulsante>
        )}
        <Pulsante
          variante="leggero"
          className="!px-2 !py-0.5 !text-errore"
          disabled={occupato}
          onClick={() => window.confirm(`Eliminare "${d.titolo}"${d.file ? ' e il suo file' : ''}?`) && esegui(async () => {
            await api.delete(`/api/documenti-progetto/${d.id}`);
            onEliminato();
          })}
        >
          Elimina
        </Pulsante>
      </div>
    </li>
  );
}
