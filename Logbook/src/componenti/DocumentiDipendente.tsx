// "><(((º> sabusabu <º)))><"
/**
 * Schede "Attestati" e "Documenti" della scheda dipendente (solo HR), Giorno 15
 * (24/11/2026, risposta 1c).
 *
 * Attestati: elenco con stato a oggi (valido, in scadenza nei 30 giorni, scaduto, non
 * scade) e finestra per inserirli o modificarli: tipo da elenco fisso, titolo, rilascio,
 * scadenza, note, file. Per la visita medica si scrive solo l'esito (idoneità), mai
 * diagnosi: stessa regola della malattia.
 * Documenti: titolo, note e file obbligatorio (contratto, documento d'identità…).
 *
 * API: /api/attestati, /api/documenti-dipendente (server/rotte/attestati.ts); i file
 * passano da /api/file (componenti/File.tsx).
 */
import { useState, type FormEvent } from 'react';
import { ETICHETTE_ATTESTATO, ETICHETTE_STATO_ATTESTATO, schemaAttestato, TIPI_ATTESTATO } from '../../comune/documenti';
import { formattaData } from '../../comune/date';
import { erroriPerCampo } from '../../comune/schemi';
import { api, ErroreApi } from '../api';
import type { Attestato, DocumentoDipendente, StatoAttestato, TipoAttestato, VistaFile } from '../tipi';
import { usaDati } from '../usaDati';
import { CaricaFile, LinkFile } from './File';
import { Tabella, type Colonna } from './Tabella';
import { Avviso, Caricamento, Campo, classiInput, Etichetta, Modale, Pulsante } from './ui';

const COLORE_STATO: Record<StatoAttestato, 'verde' | 'giallo' | 'rosso' | 'grigio'> = {
  VALIDO: 'verde',
  IN_SCADENZA: 'giallo',
  SCADUTO: 'rosso',
  SENZA_SCADENZA: 'grigio',
};

export function AttestatiDipendente({ dipendenteId }: { dipendenteId: number }) {
  const { dati, errore, caricamento, ricarica } = usaDati<Attestato[]>(`/api/attestati?dipendenteId=${dipendenteId}`);
  const [aperto, setAperto] = useState<Attestato | 'nuovo' | null>(null);

  const colonne: Colonna<Attestato>[] = [
    { chiave: 'titolo', titolo: 'Attestato', valore: (a) => a.titolo, render: (a) => <span className="font-medium">{a.titolo}</span>, principale: true },
    { chiave: 'tipo', titolo: 'Tipo', valore: (a) => ETICHETTE_ATTESTATO[a.tipo] },
    { chiave: 'rilascio', titolo: 'Rilascio', valore: (a) => a.dataRilascio, render: (a) => formattaData(a.dataRilascio) },
    { chiave: 'scadenza', titolo: 'Scadenza', valore: (a) => a.dataScadenza, render: (a) => (a.dataScadenza ? formattaData(a.dataScadenza) : '—') },
    { chiave: 'stato', titolo: 'Stato', valore: (a) => a.stato, render: (a) => <Etichetta colore={COLORE_STATO[a.stato]}>{ETICHETTE_STATO_ATTESTATO[a.stato]}</Etichetta> },
    { chiave: 'file', titolo: 'File', render: (a) => (a.file ? <LinkFile file={a.file} compatto /> : <span className="text-gray-400">—</span>) },
  ];

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-600">Gli attestati in scadenza nei prossimi 30 giorni compaiono anche nella dashboard di HR.</p>
        <Pulsante variante="primario" onClick={() => setAperto('nuovo')}>
          + Nuovo attestato
        </Pulsante>
      </div>
      {errore && <Avviso tipo="errore">{errore}</Avviso>}
      {caricamento && !dati && <Caricamento />}
      {dati && (
        <Tabella
          righe={dati}
          colonne={colonne}
          chiaveRiga={(a) => a.id}
          onRiga={(a) => setAperto(a)}
          ordinamentoIniziale={{ chiave: 'scadenza', verso: 1 }}
          vuoto="Nessun attestato: aggiungi il primo con «Nuovo attestato»"
        />
      )}
      {aperto && (
        <FinestraAttestato
          dipendenteId={dipendenteId}
          attestato={aperto === 'nuovo' ? null : aperto}
          onChiudi={() => setAperto(null)}
          onSalvato={() => {
            setAperto(null);
            ricarica();
          }}
        />
      )}
    </section>
  );
}

function FinestraAttestato({ dipendenteId, attestato, onChiudi, onSalvato }: { dipendenteId: number; attestato: Attestato | null; onChiudi: () => void; onSalvato: () => void }) {
  const [m, setM] = useState({
    tipo: (attestato?.tipo ?? 'SICUREZZA') as TipoAttestato,
    titolo: attestato?.titolo ?? '',
    dataRilascio: attestato?.dataRilascio ?? '',
    dataScadenza: attestato?.dataScadenza ?? '',
    note: attestato?.note ?? '',
  });
  const [file, setFile] = useState<VistaFile | null>(attestato?.file ?? null);
  const [errori, setErrori] = useState<Record<string, string>>({});
  const [messaggio, setMessaggio] = useState<string | null>(null);
  const [invio, setInvio] = useState(false);
  const imposta = (k: keyof typeof m, v: string) => setM((x) => ({ ...x, [k]: v }));

  const salva = async (e: FormEvent) => {
    e.preventDefault();
    const corpo = { ...m, dipendenteId, fileId: file?.id ?? null };
    const controllo = schemaAttestato.safeParse(corpo);
    if (!controllo.success) {
      setErrori(erroriPerCampo(controllo.error));
      return;
    }
    setErrori({});
    setInvio(true);
    try {
      if (attestato) await api.put(`/api/attestati/${attestato.id}`, corpo);
      else await api.post('/api/attestati', corpo);
      onSalvato();
    } catch (err) {
      if (err instanceof ErroreApi) {
        setErrori(err.campi);
        setMessaggio(err.message);
      }
    } finally {
      setInvio(false);
    }
  };

  const elimina = async () => {
    if (!attestato || !window.confirm(`Eliminare l'attestato "${attestato.titolo}"? Si cancella anche il file allegato.`)) return;
    try {
      await api.delete(`/api/attestati/${attestato.id}`);
      onSalvato();
    } catch (err) {
      setMessaggio(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Modale titolo={attestato ? `Attestato: ${attestato.titolo}` : 'Nuovo attestato'} aperta onChiudi={onChiudi} larghezza="max-w-xl">
      <form onSubmit={salva} className="space-y-3" noValidate>
        {messaggio && <Avviso tipo="errore">{messaggio}</Avviso>}
        <div className="flex flex-wrap gap-3 [&>*]:min-w-0 [&>*]:flex-[1_1_12rem]">
          <Campo etichetta="Tipo" obbligatorio errore={errori.tipo}>
            <select className={classiInput(errori.tipo)} value={m.tipo} onChange={(e) => imposta('tipo', e.target.value)}>
              {TIPI_ATTESTATO.map((t) => (
                <option key={t} value={t}>
                  {ETICHETTE_ATTESTATO[t]}
                </option>
              ))}
            </select>
          </Campo>
          <Campo etichetta="Titolo" obbligatorio errore={errori.titolo}>
            <input className={classiInput(errori.titolo)} placeholder="Es. Formazione specifica rischio alto" value={m.titolo} onChange={(e) => imposta('titolo', e.target.value)} maxLength={150} />
          </Campo>
        </div>
        <div className="flex flex-wrap gap-3 [&>*]:min-w-0 [&>*]:flex-[1_1_10rem]">
          <Campo etichetta="Data di rilascio" obbligatorio errore={errori.dataRilascio}>
            <input type="date" className={classiInput(errori.dataRilascio)} value={m.dataRilascio} onChange={(e) => imposta('dataRilascio', e.target.value)} />
          </Campo>
          <Campo etichetta="Data di scadenza" errore={errori.dataScadenza} aiuto="Vuota se non scade">
            <input type="date" min={m.dataRilascio || undefined} className={classiInput(errori.dataScadenza)} value={m.dataScadenza} onChange={(e) => imposta('dataScadenza', e.target.value)} />
          </Campo>
        </div>
        {m.tipo === 'VISITA_MEDICA' && (
          <Avviso tipo="attenzione">Per la visita medica scrivi solo l'esito (es. «idoneo», «idoneo con prescrizioni»): niente diagnosi o informazioni sanitarie.</Avviso>
        )}
        <Campo etichetta="Note" errore={errori.note}>
          <textarea rows={2} className={classiInput(errori.note)} value={m.note} onChange={(e) => imposta('note', e.target.value)} maxLength={500} />
        </Campo>
        <div className="text-sm">
          <span className="mb-1 block font-ui text-[0.82rem] font-semibold text-gray-600">File dell'attestato</span>
          <CaricaFile file={file} onFile={setFile} errore={errori.fileId} />
        </div>
        <div className="flex flex-wrap justify-between gap-2 border-t border-gray-100 pt-3">
          <div>
            {attestato && (
              <Pulsante variante="pericolo" onClick={elimina}>
                Elimina
              </Pulsante>
            )}
          </div>
          <div className="flex gap-2">
            <Pulsante onClick={onChiudi}>Annulla</Pulsante>
            <Pulsante type="submit" variante="primario" disabled={invio}>
              {invio ? 'Salvataggio…' : 'Salva'}
            </Pulsante>
          </div>
        </div>
      </form>
    </Modale>
  );
}

export function DocumentiDipendente({ dipendenteId }: { dipendenteId: number }) {
  const { dati, errore, caricamento, ricarica } = usaDati<DocumentoDipendente[]>(`/api/documenti-dipendente?dipendenteId=${dipendenteId}`);
  const [titolo, setTitolo] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<VistaFile | null>(null);
  const [errori, setErrori] = useState<Record<string, string>>({});
  const [messaggio, setMessaggio] = useState<{ tipo: 'errore' | 'successo'; testo: string } | null>(null);

  const aggiungi = async (e: FormEvent) => {
    e.preventDefault();
    setMessaggio(null);
    try {
      await api.post('/api/documenti-dipendente', { dipendenteId, titolo, note, fileId: file?.id });
      setTitolo('');
      setNote('');
      setFile(null);
      setErrori({});
      setMessaggio({ tipo: 'successo', testo: 'Documento aggiunto' });
      ricarica();
    } catch (err) {
      if (err instanceof ErroreApi) {
        setErrori(err.campi);
        setMessaggio({ tipo: 'errore', testo: err.message });
      }
    }
  };

  const elimina = async (d: DocumentoDipendente) => {
    if (!window.confirm(`Eliminare "${d.titolo}"? Si cancella anche il file.`)) return;
    await api.delete(`/api/documenti-dipendente/${d.id}`);
    ricarica();
  };

  return (
    <section className="space-y-3">
      <form onSubmit={aggiungi} className="scheda flex flex-wrap items-end gap-3 p-3" noValidate>
        <Campo etichetta="Titolo" obbligatorio errore={errori.titolo} className="min-w-0 flex-[2_1_14rem]">
          <input className={classiInput(errori.titolo)} placeholder="Es. Contratto di assunzione" value={titolo} onChange={(e) => setTitolo(e.target.value)} maxLength={150} />
        </Campo>
        <Campo etichetta="Note" errore={errori.note} className="min-w-0 flex-[2_1_14rem]">
          <input className={classiInput(errori.note)} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </Campo>
        <div className="min-w-0 flex-[1_1_12rem]">
          <span className="mb-1 block font-ui text-[0.82rem] font-semibold text-gray-600">
            File <span className="text-errore">*</span>
          </span>
          <CaricaFile file={file} onFile={setFile} errore={errori.fileId} />
        </div>
        <Pulsante type="submit" variante="primario">
          Aggiungi
        </Pulsante>
      </form>
      {messaggio && <Avviso tipo={messaggio.tipo}>{messaggio.testo}</Avviso>}
      {errore && <Avviso tipo="errore">{errore}</Avviso>}
      {caricamento && !dati && <Caricamento />}
      {dati && (
        <Tabella
          righe={dati}
          colonne={[
            { chiave: 'titolo', titolo: 'Documento', valore: (d) => d.titolo, render: (d) => <span className="font-medium">{d.titolo}</span>, principale: true },
            { chiave: 'file', titolo: 'File', render: (d) => <LinkFile file={d.file} /> },
            { chiave: 'note', titolo: 'Note', valore: (d) => d.note, classe: 'max-w-64 truncate' },
            { chiave: 'data', titolo: 'Caricato il', valore: (d) => d.creatoIl, render: (d) => formattaData(d.creatoIl.slice(0, 10)) },
            {
              chiave: 'azioni',
              titolo: '',
              render: (d) => (
                <button type="button" className="rounded px-2 py-0.5 text-xs text-errore hover:bg-[#fdf3f2]" onClick={() => elimina(d)}>
                  Elimina
                </button>
              ),
            },
          ]}
          chiaveRiga={(d) => d.id}
          vuoto="Nessun documento"
        />
      )}
    </section>
  );
}
