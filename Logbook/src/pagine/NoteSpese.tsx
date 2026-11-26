// "><(((º> sabusabu <º)))><"
/**
 * Note spese (Giorno 45, 26/11/2026).
 *
 * - Dipendente: elenco delle proprie note con lo stato, e "Nuova nota spese": giorno,
 *   categoria, importo, progetto (facoltativo), descrizione e la foto dello scontrino
 *   (dal telefono il pulsante del file apre anche la fotocamera). Finché la nota è in
 *   attesa la può correggere o ritirare.
 * - HR: tutte le note con filtro per stato, i totali (da decidere, da rimborsare), e per
 *   ogni riga Approva, Rifiuta (chiede il motivo), Rimborsata. Può inserirne una a nome di
 *   un dipendente, anche senza scontrino.
 *
 * API: /api/note-spese (server/rotte/note-spese.ts); lo scontrino si carica con /api/file.
 */
import { useState, type FormEvent } from 'react';
import { formattaData, oggiIso } from '../../comune/date';
import { ESTENSIONI_ALLEGATO_ASSENZA } from '../../comune/documenti';
import { centesimiDaEuro, euroDaCentesimi, formattaEuro } from '../../comune/importi';
import { api, ErroreApi } from '../api';
import { useAuth } from '../auth';
import { CaricaFile, LinkFile } from '../componenti/File';
import { Avviso, Caricamento, Campo, classiInput, Etichetta, IntestazionePagina, Modale, Pulsante } from '../componenti/ui';
import type { Dipendente, Progetto, VistaFile } from '../tipi';
import { usaDati } from '../usaDati';

type Stato = 'RICHIESTA' | 'APPROVATA' | 'RIFIUTATA' | 'RIMBORSATA';
type Categoria = 'VITTO' | 'ALLOGGIO' | 'TRASPORTO' | 'CARBURANTE' | 'MATERIALE' | 'ALTRO';
type Nota = {
  id: number;
  dipendenteId: number;
  data: string;
  categoria: Categoria;
  importoCent: number;
  descrizione: string;
  stato: Stato;
  noteHr: string | null;
  rimborsataIl: string | null;
  dipendente: { nome: string; cognome: string; matricola: string };
  progetto: { id: number; codice: string; nome: string } | null;
  file: VistaFile | null;
};
type Risposta = { note: Nota[]; totali: Partial<Record<Stato, { note: number; importoCent: number }>> };

const CATEGORIE: Record<Categoria, string> = { VITTO: 'Vitto', ALLOGGIO: 'Alloggio', TRASPORTO: 'Trasporto', CARBURANTE: 'Carburante', MATERIALE: 'Materiale', ALTRO: 'Altro' };
const STATI: Record<Stato, { testo: string; colore: 'verde' | 'rosso' | 'giallo' | 'grigio' | 'blu' }> = {
  RICHIESTA: { testo: 'In attesa', colore: 'giallo' },
  APPROVATA: { testo: 'Approvata, da rimborsare', colore: 'blu' },
  RIFIUTATA: { testo: 'Rifiutata', colore: 'rosso' },
  RIMBORSATA: { testo: 'Rimborsata', colore: 'verde' },
};

function ModuloNota({ nota, onChiudi, onSalvata }: { nota: Nota | null; onChiudi: () => void; onSalvata: () => void }) {
  const { admin } = useAuth();
  const { dati: progetti } = usaDati<Progetto[]>('/api/progetti');
  const { dati: dipendenti } = usaDati<Dipendente[]>(admin && !nota ? '/api/dipendenti' : null);
  const [m, setM] = useState({
    dipendenteId: '',
    data: nota?.data ?? oggiIso(),
    categoria: (nota?.categoria ?? 'VITTO') as Categoria,
    importo: nota ? euroDaCentesimi(nota.importoCent) : '',
    progettoId: nota?.progetto ? String(nota.progetto.id) : '',
    descrizione: nota?.descrizione ?? '',
  });
  const [file, setFile] = useState<VistaFile | null>(nota?.file ?? null);
  const [errori, setErrori] = useState<Record<string, string>>({});
  const [errore, setErrore] = useState<string | null>(null);
  const [lavoro, setLavoro] = useState(false);
  const campo = (nome: keyof typeof m) => ({ value: m[nome], onChange: (e: { target: { value: string } }) => setM({ ...m, [nome]: e.target.value }) });

  const salva = async (e: FormEvent) => {
    e.preventDefault();
    setErrore(null);
    let importoCent: number | null;
    try {
      importoCent = centesimiDaEuro(m.importo);
    } catch {
      importoCent = null;
    }
    if (importoCent === null) {
      setErrori({ importoCent: 'Scrivi l\'importo (es. 18,50)' });
      return;
    }
    setLavoro(true);
    const corpo = { dipendenteId: m.dipendenteId, data: m.data, categoria: m.categoria, importoCent, progettoId: m.progettoId, descrizione: m.descrizione, fileId: file?.id ?? '' };
    try {
      if (nota) await api.put(`/api/note-spese/${nota.id}`, corpo);
      else await api.post('/api/note-spese', corpo);
      onSalvata();
    } catch (err) {
      if (err instanceof ErroreApi) setErrori(err.campi);
      setErrore(err instanceof Error ? err.message : String(err));
    } finally {
      setLavoro(false);
    }
  };

  return (
    <Modale titolo={nota ? 'Modifica nota spese' : 'Nuova nota spese'} aperta onChiudi={onChiudi}>
      <form onSubmit={salva} className="space-y-3" noValidate>
        {errore && <Avviso tipo="errore">{errore}</Avviso>}
        {admin && !nota && (
          <Campo etichetta="Dipendente" obbligatorio errore={errori.dipendenteId}>
            <select className={classiInput(errori.dipendenteId)} {...campo('dipendenteId')}>
              <option value="">Scegli…</option>
              {(dipendenti ?? []).filter((d) => d.stato === 'ATTIVO').map((d) => (
                <option key={d.id} value={d.id}>
                  {d.cognome} {d.nome}
                </option>
              ))}
            </select>
          </Campo>
        )}
        <div className="flex flex-wrap gap-3">
          <div className="min-w-0 flex-[1_1_10rem]">
            <Campo etichetta="Giorno della spesa" obbligatorio errore={errori.data}>
              <input type="date" max={oggiIso()} className={classiInput(errori.data)} {...campo('data')} />
            </Campo>
          </div>
          <div className="min-w-0 flex-[1_1_10rem]">
            <Campo etichetta="Importo (€)" obbligatorio errore={errori.importoCent}>
              <input inputMode="decimal" placeholder="0,00" className={`${classiInput(errori.importoCent)} text-right`} {...campo('importo')} />
            </Campo>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="min-w-0 flex-[1_1_10rem]">
            <Campo etichetta="Categoria" obbligatorio errore={errori.categoria}>
              <select className={classiInput(errori.categoria)} {...campo('categoria')}>
                {Object.entries(CATEGORIE).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Campo>
          </div>
          <div className="min-w-0 flex-[1_1_10rem]">
            <Campo etichetta="Progetto" errore={errori.progettoId} aiuto="Facoltativo">
              <select className={classiInput(errori.progettoId)} {...campo('progettoId')}>
                <option value="">Nessuno</option>
                {(progetti ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.codice} · {p.nome}
                  </option>
                ))}
              </select>
            </Campo>
          </div>
        </div>
        <Campo etichetta="Descrizione" obbligatorio errore={errori.descrizione}>
          <input className={classiInput(errori.descrizione)} placeholder="Es. pranzo in trasferta a Catania" {...campo('descrizione')} />
        </Campo>
        <Campo etichetta="Scontrino o ricevuta" obbligatorio={!admin}>
          <CaricaFile file={file} onFile={setFile} errore={errori.fileId} testoPulsante="Foto o file dello scontrino…" estensioni={ESTENSIONI_ALLEGATO_ASSENZA} aiutoFormati="Foto o PDF" />
        </Campo>
        <div className="flex justify-end gap-2 border-t border-gray-100 pt-3">
          <Pulsante onClick={onChiudi}>Annulla</Pulsante>
          <Pulsante type="submit" variante="primario" disabled={lavoro}>
            {lavoro ? 'Salvataggio…' : 'Salva'}
          </Pulsante>
        </div>
      </form>
    </Modale>
  );
}

export function NoteSpese() {
  const { admin } = useAuth();
  const [filtro, setFiltro] = useState<Stato | ''>('');
  const { dati, errore, ricarica } = usaDati<Risposta>(`/api/note-spese${filtro ? `?stato=${filtro}` : ''}`);
  const [modulo, setModulo] = useState<{ nota: Nota | null } | null>(null);
  const [messaggio, setMessaggio] = useState<string | null>(null);

  const esegui = async (azione: () => Promise<unknown>) => {
    setMessaggio(null);
    try {
      await azione();
      ricarica();
    } catch (e) {
      setMessaggio(e instanceof Error ? e.message : String(e));
    }
  };
  const rifiuta = (n: Nota) => {
    const motivo = window.prompt(`Motivo del rifiuto della nota spese di ${n.dipendente.cognome} ${n.dipendente.nome} (lo leggerà il dipendente):`);
    if (motivo?.trim()) void esegui(() => api.post(`/api/note-spese/${n.id}/decisione`, { stato: 'RIFIUTATA', noteHr: motivo.trim() }));
  };
  const elimina = (n: Nota) => {
    if (window.confirm(`${admin ? 'Eliminare' : 'Ritirare'} la nota spese del ${formattaData(n.data)} (${formattaEuro(n.importoCent)})?`)) void esegui(() => api.delete(`/api/note-spese/${n.id}`));
  };

  const totale = (s: Stato) => dati?.totali[s] ?? { note: 0, importoCent: 0 };

  return (
    <>
      <IntestazionePagina
        titolo={admin ? 'Note spese' : 'Le mie note spese'}
        sottotitolo={admin ? 'Spese anticipate dai dipendenti: approvazione e rimborso' : 'Spese che hai anticipato, con la foto dello scontrino'}
        azioni={
          <Pulsante variante="primario" onClick={() => setModulo({ nota: null })}>
            + Nuova nota spese
          </Pulsante>
        }
      />
      {errore && <Avviso tipo="errore">{errore}</Avviso>}
      {messaggio && <Avviso tipo="errore" className="mb-3">{messaggio}</Avviso>}
      {!dati && !errore && <Caricamento />}
      {dati && (
        <>
          <div className="mb-3 flex flex-wrap gap-3">
            {(
              [
                ['RICHIESTA', admin ? 'Da decidere' : 'In attesa'],
                ['APPROVATA', 'Da rimborsare'],
                ['RIMBORSATA', 'Rimborsate'],
              ] as const
            ).map(([s, titolo]) => (
              <button
                key={s}
                type="button"
                onClick={() => setFiltro(filtro === s ? '' : s)}
                aria-pressed={filtro === s}
                className={`scheda min-w-0 flex-[1_1_10rem] p-3 text-left transition-colors ${filtro === s ? 'border-marchio ring-1 ring-marchio' : 'hover:border-marchio'}`}
              >
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{titolo}</div>
                <div className="cifre font-display text-xl font-medium text-marchio">{formattaEuro(totale(s).importoCent)}</div>
                <div className="text-xs text-gray-600">
                  {totale(s).note} {totale(s).note === 1 ? 'nota' : 'note'}
                </div>
              </button>
            ))}
          </div>
          {filtro && (
            <p className="mb-2 text-sm text-gray-600">
              Filtro: {STATI[filtro].testo.toLowerCase()}.{' '}
              <button type="button" className="text-marchio underline-offset-2 hover:underline" onClick={() => setFiltro('')}>
                Mostra tutte
              </button>
            </p>
          )}
          {dati.note.length === 0 ? (
            <Avviso tipo="info">{filtro ? 'Nessuna nota spese in questo stato.' : admin ? 'Nessuna nota spese.' : 'Non hai ancora inserito note spese.'}</Avviso>
          ) : (
            <ul className="space-y-2">
              {dati.note.map((n) => (
                <li key={n.id} className="scheda p-3">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="cifre font-display text-lg font-medium text-marchio">{formattaEuro(n.importoCent)}</span>
                    <span className="cifre text-sm text-gray-600">{formattaData(n.data)}</span>
                    <span className="text-sm text-gray-700">{CATEGORIE[n.categoria]}</span>
                    <Etichetta colore={STATI[n.stato].colore}>{STATI[n.stato].testo}</Etichetta>
                    {admin && (
                      <span className="text-sm font-medium text-gray-900">
                        {n.dipendente.cognome} {n.dipendente.nome}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-sm text-gray-800">{n.descrizione}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600">
                    {n.progetto && <span>{n.progetto.codice} · {n.progetto.nome}</span>}
                    {n.file ? <LinkFile file={n.file} compatto /> : <span className="text-gray-500">senza scontrino</span>}
                    {n.rimborsataIl && <span>rimborsata il {formattaData(n.rimborsataIl.slice(0, 10))}</span>}
                  </div>
                  {n.noteHr && <div className="mt-1 text-sm text-gray-700">HR: {n.noteHr}</div>}
                  <div className="mt-2 flex flex-wrap justify-end gap-2">
                    {admin && (n.stato === 'RICHIESTA' || n.stato === 'RIFIUTATA') && (
                      <Pulsante variante="primario" onClick={() => void esegui(() => api.post(`/api/note-spese/${n.id}/decisione`, { stato: 'APPROVATA' }))}>
                        Approva
                      </Pulsante>
                    )}
                    {admin && (n.stato === 'RICHIESTA' || n.stato === 'APPROVATA') && <Pulsante onClick={() => rifiuta(n)}>Rifiuta</Pulsante>}
                    {admin && n.stato === 'APPROVATA' && (
                      <Pulsante variante="primario" onClick={() => void esegui(() => api.post(`/api/note-spese/${n.id}/rimborsata`))}>
                        Segna rimborsata
                      </Pulsante>
                    )}
                    {n.stato === 'RICHIESTA' && <Pulsante onClick={() => setModulo({ nota: n })}>Modifica</Pulsante>}
                    {(n.stato === 'RICHIESTA' || (admin && n.stato !== 'RIMBORSATA')) && (
                      <Pulsante variante="pericolo" onClick={() => elimina(n)}>
                        {admin ? 'Elimina' : 'Ritira'}
                      </Pulsante>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {modulo && (
        <ModuloNota
          key={modulo.nota?.id ?? 'nuova'}
          nota={modulo.nota}
          onChiudi={() => setModulo(null)}
          onSalvata={() => {
            setModulo(null);
            ricarica();
          }}
        />
      )}
    </>
  );
}
