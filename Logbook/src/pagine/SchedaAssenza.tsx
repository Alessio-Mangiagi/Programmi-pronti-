// "><(((º> sabusabu <º)))><"
/**
 * Pagina di un'assenza (/assenze/nuova, /assenze/:id), Giorno 18 (24/11/2026): "similmente a
 * come si tratta l'inserimento delle anagrafiche, vale ugualmente per assenze e ferie".
 * Prima era una finestra sopra l'elenco; ora è una pagina come la scheda dipendente.
 *
 * - A sinistra il modulo: dipendente (solo HR, scelta con ricerca a caratteri e omonimi
 *   distinti dal codice fiscale), tipo, date o durata del permesso, note o protocollo del
 *   certificato per la malattia (niente dati sanitari: comune/assenze.ts), note di HR e,
 *   dal Giorno 22 (risposta 3b), un allegato facoltativo (es. il giustificativo di un
 *   permesso; per la malattia solo l'attestato senza diagnosi).
 *   HR approva, rifiuta (motivo obbligatorio), modifica o elimina; il dipendente modifica o
 *   ritira la sua richiesta finché è in attesa.
 * - A destra le altre assenze dello stesso dipendente: si decide vedendo il resto
 *   dell'anno, senza lasciare la pagina.
 *
 * Dopo la creazione si resta sulla pagina dell'assenza appena creata; dopo l'eliminazione
 * si torna all'elenco.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ETICHETTE_ASSENZA, ETICHETTE_STATO_ASSENZA, schemaAssenza, TIPI_ASSENZA } from '../../comune/assenze';
import { DATA_MINIMA, formattaData, oggiIso } from '../../comune/date';
import { formattaOre } from '../../comune/orari';
import { erroriPerCampo } from '../../comune/schemi';
import { api, ErroreApi } from '../api';
import { useAuth } from '../auth';
import { COLORI_ASSENZA } from '../colori';
import { CaricaFile, LinkFile } from '../componenti/File';
import { SceltaConRicerca } from '../componenti/SceltaConRicerca';
import { Avviso, Caricamento, Campo, classiInput, Etichetta, IntestazionePagina, Pulsante } from '../componenti/ui';
import { dettaglioDipendente, nomiSenzaOmonimie } from '../../comune/omonimi';
import type { Assenza, Dipendente, StatoAssenza, VistaFile } from '../tipi';
import { usaDati } from '../usaDati';

export type AssenzaConGiorni = Assenza & { giorniLavorativi: number };

export const COLORE_STATO_ASSENZA: Record<StatoAssenza, 'giallo' | 'verde' | 'rosso'> = { RICHIESTA: 'giallo', APPROVATA: 'verde', RIFIUTATA: 'rosso' };

/** "dal 07/12 al 11/12/2026 (4 gg)" oppure "14/12/2026 · 2:00" per i permessi. */
export function periodoAssenza(a: AssenzaConGiorni) {
  if (a.tipo === 'PERMESSO') return `${formattaData(a.dataInizio)} · ${formattaOre(a.minutiPermesso ?? 0)} h`;
  const gg = `${a.giorniLavorativi} ${a.giorniLavorativi === 1 ? 'giorno' : 'giorni'} lav.`;
  return a.dataInizio === a.dataFine ? `${formattaData(a.dataInizio)} (${gg})` : `${formattaData(a.dataInizio)} → ${formattaData(a.dataFine)} (${gg})`;
}

/** Etichetta colorata del tipo di assenza (stessi colori del calendario). */
export const ChipTipoAssenza = ({ tipo }: { tipo: Assenza['tipo'] }) => (
  <span className="rounded border px-1.5 py-0.5 text-xs" style={{ backgroundColor: COLORI_ASSENZA[tipo].sfondo, color: COLORI_ASSENZA[tipo].testo, borderColor: COLORI_ASSENZA[tipo].bordo }}>
    {ETICHETTE_ASSENZA[tipo]}
  </span>
);

export function SchedaAssenza() {
  const { id } = useParams();
  const nuova = id === 'nuova';
  const { admin, utente } = useAuth();
  const [assenza, setAssenza] = useState<AssenzaConGiorni | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [esito, setEsito] = useState<string | null>(null);
  const { dati: dipendenti } = usaDati<Dipendente[]>(admin ? '/api/dipendenti' : null);
  // Il dipendente scelto nel modulo (per HR cambia mentre si compila una nuova assenza).
  const [dipendenteScelto, setDipendenteScelto] = useState('');
  const posizione = useLocation();

  useEffect(() => {
    // Il messaggio dopo la creazione arriva con la navigazione (lo stato si azzera cambiando pagina).
    setEsito((posizione.state as { esito?: string } | null)?.esito ?? null);
    if (nuova) {
      setAssenza(null);
      return;
    }
    setAssenza(null);
    setErrore(null);
    api
      .get<AssenzaConGiorni>(`/api/assenze/${id}`)
      .then((a) => {
        setAssenza(a);
        setDipendenteScelto(String(a.dipendenteId));
      })
      .catch((e: Error) => setErrore(e.message));
    // posizione.state cambia solo insieme all'indirizzo: basta l'id.
  }, [id, nuova]);

  if (!nuova && !assenza) return errore ? <Avviso tipo="errore">{errore}</Avviso> : <Caricamento />;

  const idDipendente = admin ? Number(dipendenteScelto) || null : utente?.dipendenteId ?? null;
  const titolo = assenza
    ? `${ETICHETTE_ASSENZA[assenza.tipo]} — ${assenza.dipendente.cognome} ${assenza.dipendente.nome}`
    : admin
      ? 'Nuova assenza'
      : 'Nuova richiesta';

  return (
    <>
      <IntestazionePagina
        titolo={titolo}
        sottotitolo={assenza ? periodoAssenza(assenza) : admin ? 'Registra un\'assenza per un dipendente, anche già approvata' : 'Richiedi ferie o un permesso, o comunica la malattia'}
        azioni={
          <>
            {assenza && <Etichetta colore={COLORE_STATO_ASSENZA[assenza.stato]}>{ETICHETTE_STATO_ASSENZA[assenza.stato]}</Etichetta>}
            <Link to="/assenze" className="text-sm text-marchio hover:underline">
              ← {admin ? 'Torna alle assenze' : 'Le mie assenze'}
            </Link>
          </>
        }
      />
      {esito && <Avviso tipo="successo" className="mb-3">{esito}</Avviso>}
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-[1_1_28rem]">
          <ModuloAssenza
            key={assenza?.id ?? 'nuova'}
            assenza={assenza}
            dipendenti={dipendenti ?? []}
            dipendenteScelto={dipendenteScelto}
            onDipendente={setDipendenteScelto}
            onFatto={(aggiornata, testo) => {
              setEsito(testo);
              if (aggiornata) setAssenza(aggiornata);
            }}
          />
        </div>
        <div className="min-w-0 flex-[1_1_24rem]">
          <AltreAssenze dipendenteId={idDipendente} attuale={assenza?.id} />
        </div>
      </div>
    </>
  );
}

/** Creazione, modifica e (per HR) decisione su un'assenza. */
function ModuloAssenza({
  assenza, dipendenti, dipendenteScelto, onDipendente, onFatto,
}: {
  assenza: AssenzaConGiorni | null; dipendenti: Dipendente[]; dipendenteScelto: string; onDipendente: (v: string) => void;
  onFatto: (aggiornata: AssenzaConGiorni | null, testo: string) => void;
}) {
  const { admin } = useAuth();
  const naviga = useNavigate();
  const modificabile = !assenza || admin || assenza.stato === 'RICHIESTA';
  const [m, setM] = useState({
    tipo: assenza?.tipo ?? 'FERIE',
    dataInizio: assenza?.dataInizio ?? oggiIso(),
    dataFine: assenza?.dataFine ?? oggiIso(),
    ore: assenza?.minutiPermesso ? String(assenza.minutiPermesso / 60).replace('.', ',') : '',
    noteDipendente: assenza?.noteDipendente ?? '',
    protocolloCertificato: assenza?.protocolloCertificato ?? '',
    noteHr: assenza?.noteHr ?? '',
    giaApprovata: false,
  });
  const [errori, setErrori] = useState<Record<string, string>>({});
  const [messaggio, setMessaggio] = useState<string | null>(null);
  const [invio, setInvio] = useState(false);
  // Allegato: si carica subito (POST /api/file) e qui si tiene solo per collegarlo al salvataggio.
  const [file, setFile] = useState<VistaFile | null>(assenza?.file ?? null);
  const nomi = useMemo(() => nomiSenzaOmonimie(dipendenti), [dipendenti]);

  const imposta = (campo: keyof typeof m, valore: string | boolean) => setM((x) => ({ ...x, [campo]: valore }));

  /** Corpo per le API: il permesso vale un giorno e ha la durata in minuti. */
  const corpo = () => ({
    ...(admin ? { dipendenteId: Number(dipendenteScelto) || undefined } : {}),
    tipo: m.tipo,
    dataInizio: m.dataInizio,
    dataFine: m.tipo === 'PERMESSO' ? m.dataInizio : m.dataFine,
    minutiPermesso: m.tipo === 'PERMESSO' && m.ore ? Math.round(Number(m.ore.replace(',', '.')) * 60) : null,
    noteDipendente: m.tipo === 'MALATTIA' ? null : m.noteDipendente,
    protocolloCertificato: m.tipo === 'MALATTIA' ? m.protocolloCertificato : null,
    // Sempre presente: la modifica sostituisce l'assenza intera (senza file = file tolto).
    fileId: file?.id ?? null,
  });

  /** Esegue un'azione sul server; gli errori tornano sui campi e in cima al modulo. */
  const esegui = async (azione: () => Promise<void>) => {
    setMessaggio(null);
    setInvio(true);
    try {
      await azione();
    } catch (err) {
      if (err instanceof ErroreApi) {
        setErrori(err.campi);
        setMessaggio(err.message);
      }
    } finally {
      setInvio(false);
    }
  };

  const salva = (e: FormEvent) => {
    e.preventDefault();
    const c = corpo();
    const controllo = schemaAssenza.safeParse(c);
    if (!controllo.success) {
      setErrori(erroriPerCampo(controllo.error));
      return;
    }
    if (admin && !assenza && !dipendenteScelto) {
      setErrori({ dipendenteId: 'Scegli il dipendente' });
      return;
    }
    setErrori({});
    esegui(async () => {
      if (assenza) {
        const a = await api.put<AssenzaConGiorni>(`/api/assenze/${assenza.id}`, { ...c, ...(admin ? { noteHr: m.noteHr } : {}) });
        onFatto(a, 'Modifiche salvate');
      } else {
        const a = await api.post<AssenzaConGiorni>('/api/assenze', { ...c, ...(m.giaApprovata ? { stato: 'APPROVATA' } : {}) });
        naviga(`/assenze/${a.id}`, { replace: true, state: { esito: admin ? 'Assenza registrata' : 'Richiesta inviata: HR la vedrà nella dashboard' } });
      }
    });
  };

  const decidi = (stato: 'APPROVATA' | 'RIFIUTATA') => {
    if (stato === 'RIFIUTATA' && !m.noteHr.trim()) {
      setErrori({ noteHr: 'Indica il motivo del rifiuto' });
      return;
    }
    esegui(async () => {
      await api.post(`/api/assenze/${assenza!.id}/decisione`, { stato, noteHr: m.noteHr });
      onFatto(await api.get<AssenzaConGiorni>(`/api/assenze/${assenza!.id}`), stato === 'APPROVATA' ? 'Assenza approvata' : 'Richiesta rifiutata');
    });
  };

  const elimina = () => {
    if (!window.confirm(admin ? 'Eliminare definitivamente questa assenza?' : 'Ritirare la richiesta?')) return;
    esegui(async () => {
      await api.delete(`/api/assenze/${assenza!.id}`);
      naviga('/assenze', { replace: true });
    });
  };

  const opzioniDipendenti = dipendenti
    .filter((d) => d.stato === 'ATTIVO')
    .map((d) => ({ valore: String(d.id), etichetta: nomi.get(d.id) ?? `${d.cognome} ${d.nome}`, dettaglio: dettaglioDipendente(d) }))
    .sort((a, b) => a.etichetta.localeCompare(b.etichetta, 'it'));

  return (
    <form onSubmit={salva} className="scheda space-y-3 p-3 sm:p-4" noValidate>
      <h2 className="text-sm font-semibold uppercase text-gray-500">{assenza ? 'Dati dell\'assenza' : admin ? 'Nuova assenza' : 'Nuova richiesta'}</h2>
      {messaggio && <Avviso tipo="errore">{messaggio}</Avviso>}
      {assenza?.decisoDa && assenza.decisoIl && (
        <p className="text-sm text-gray-500">
          {ETICHETTE_STATO_ASSENZA[assenza.stato]} da {assenza.decisoDa.username} il {formattaData(assenza.decisoIl.slice(0, 10))}
        </p>
      )}
      {!modificabile && <Avviso tipo="info">La richiesta è già stata decisa: per cambiarla rivolgiti a HR.</Avviso>}

      <fieldset disabled={!modificabile || invio} className="space-y-3">
        {admin && !assenza && (
          <div className="text-sm">
            <span className="mb-1 block font-ui text-[0.82rem] font-semibold text-gray-600">
              Dipendente <span className="text-errore">*</span>
            </span>
            <SceltaConRicerca
              etichetta="Dipendente"
              segnaposto="Cerca per nome, matricola o codice fiscale…"
              opzioni={opzioniDipendenti}
              valore={dipendenteScelto}
              onCambia={onDipendente}
              errore={errori.dipendenteId}
            />
            {errori.dipendenteId && <span className="mt-0.5 block text-xs text-errore">{errori.dipendenteId}</span>}
          </div>
        )}
        <Campo etichetta="Tipo" obbligatorio errore={errori.tipo}>
          <div className="flex gap-2">
            {TIPI_ASSENZA.map((t) => (
              <label key={t} className={`flex-1 cursor-pointer rounded border px-3 py-1.5 text-center text-sm ${m.tipo === t ? 'border-marchio bg-marchio/10 font-semibold text-marchio' : 'border-gray-300'}`}>
                <input type="radio" className="sr-only" name="tipo" checked={m.tipo === t} onChange={() => imposta('tipo', t)} />
                {ETICHETTE_ASSENZA[t]}
              </label>
            ))}
          </div>
        </Campo>
        <div className="flex flex-wrap gap-3 [&>*]:min-w-0 [&>*]:flex-[1_1_11rem]">
          <Campo etichetta={m.tipo === 'PERMESSO' ? 'Giorno' : 'Dal'} obbligatorio errore={errori.dataInizio}>
            <input type="date" min={DATA_MINIMA} className={classiInput(errori.dataInizio)} value={m.dataInizio} onChange={(e) => imposta('dataInizio', e.target.value)} />
          </Campo>
          {m.tipo === 'PERMESSO' ? (
            <Campo etichetta="Durata (ore)" obbligatorio errore={errori.minutiPermesso} aiuto="Es. 2 oppure 1,5">
              <input inputMode="decimal" className={classiInput(errori.minutiPermesso)} value={m.ore} onChange={(e) => imposta('ore', e.target.value)} />
            </Campo>
          ) : (
            <Campo etichetta="Al" obbligatorio errore={errori.dataFine}>
              <input type="date" className={classiInput(errori.dataFine)} value={m.dataFine} min={m.dataInizio} onChange={(e) => imposta('dataFine', e.target.value)} />
            </Campo>
          )}
        </div>
        {m.tipo === 'MALATTIA' ? (
          <Campo etichetta="Protocollo del certificato medico" errore={errori.protocolloCertificato} aiuto="Solo il numero di protocollo: non indicare diagnosi o informazioni sanitarie">
            <input className={classiInput(errori.protocolloCertificato)} value={m.protocolloCertificato} onChange={(e) => imposta('protocolloCertificato', e.target.value)} />
          </Campo>
        ) : (
          <Campo etichetta="Note" errore={errori.noteDipendente}>
            <textarea rows={2} className={classiInput(errori.noteDipendente)} value={m.noteDipendente} onChange={(e) => imposta('noteDipendente', e.target.value)} maxLength={500} />
          </Campo>
        )}
        {/* Allegato facoltativo (Giorno 22). Dentro il fieldset: a richiesta decisa si guarda soltanto. */}
        <div className="text-sm">
          <span className="mb-1 block font-ui text-[0.82rem] font-semibold text-gray-600">Allegato</span>
          {modificabile ? (
            <CaricaFile file={file} onFile={setFile} errore={errori.fileId} testoPulsante="Allega file…" />
          ) : file ? (
            <LinkFile file={file} />
          ) : (
            <span className="text-gray-500">Nessun allegato</span>
          )}
          {m.tipo === 'MALATTIA' ? (
            <span className="mt-1 block text-xs text-[#6b4a00]">Solo l'attestato per il datore di lavoro: non allegare referti o certificati con la diagnosi.</span>
          ) : (
            <span className="mt-1 block text-xs text-gray-500">Facoltativo, es. il giustificativo di un permesso.</span>
          )}
        </div>
      </fieldset>

      {admin && (
        <Campo etichetta="Note HR" errore={errori.noteHr} aiuto="Obbligatorie per rifiutare">
          <textarea rows={2} className={classiInput(errori.noteHr)} value={m.noteHr} onChange={(e) => imposta('noteHr', e.target.value)} maxLength={500} />
        </Campo>
      )}
      {!admin && assenza?.noteHr && <Avviso tipo="info">Note HR: {assenza.noteHr}</Avviso>}
      {admin && !assenza && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={m.giaApprovata} onChange={(e) => imposta('giaApprovata', e.target.checked)} />
          Registra come già approvata
        </label>
      )}

      <div className="flex flex-wrap justify-between gap-2 border-t border-gray-100 pt-3">
        <div className="flex gap-2">
          {assenza && (admin || assenza.stato === 'RICHIESTA') && (
            <Pulsante variante="pericolo" onClick={elimina} disabled={invio}>
              {admin ? 'Elimina' : 'Ritira richiesta'}
            </Pulsante>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {modificabile && (
            <Pulsante type="submit" variante={admin && assenza?.stato === 'RICHIESTA' ? 'secondario' : 'primario'} disabled={invio}>
              {assenza ? 'Salva modifiche' : admin ? 'Registra' : 'Invia richiesta'}
            </Pulsante>
          )}
          {admin && assenza && assenza.stato !== 'RIFIUTATA' && (
            <Pulsante variante="pericolo" onClick={() => decidi('RIFIUTATA')} disabled={invio}>
              Rifiuta
            </Pulsante>
          )}
          {admin && assenza && assenza.stato !== 'APPROVATA' && (
            <Pulsante variante="primario" onClick={() => decidi('APPROVATA')} disabled={invio}>
              Approva
            </Pulsante>
          )}
        </div>
      </div>
    </form>
  );
}

/** Le altre assenze dello stesso dipendente, la più recente prima: clic per aprirla. */
function AltreAssenze({ dipendenteId, attuale }: { dipendenteId: number | null; attuale?: number }) {
  const { dati, errore } = usaDati<AssenzaConGiorni[]>(dipendenteId ? `/api/assenze?dipendenteId=${dipendenteId}` : null);
  const altre = (dati ?? []).filter((a) => a.id !== attuale);
  return (
    <section className="scheda p-3 sm:p-4" aria-labelledby="titolo-altre-assenze">
      <h2 id="titolo-altre-assenze" className="mb-2 text-sm font-semibold uppercase text-gray-500">
        Altre assenze {dati?.[0] ? `di ${dati[0].dipendente.cognome} ${dati[0].dipendente.nome}` : ''}
      </h2>
      {!dipendenteId && <p className="text-sm text-gray-500">Scegli il dipendente per vedere le sue altre assenze.</p>}
      {errore && <Avviso tipo="errore">{errore}</Avviso>}
      {dipendenteId && !dati && !errore && <Caricamento />}
      <ul className="divide-y divide-gray-100 text-sm">
        {altre.map((a) => (
          <li key={a.id}>
            <Link to={`/assenze/${a.id}`} className="-mx-1 flex flex-wrap items-center gap-2 rounded px-1 py-1.5 hover:bg-ghiaccio">
              <ChipTipoAssenza tipo={a.tipo} />
              <span className="cifre text-gray-700">{periodoAssenza(a)}</span>
              <span className="ml-auto">
                <Etichetta colore={COLORE_STATO_ASSENZA[a.stato]}>{ETICHETTE_STATO_ASSENZA[a.stato]}</Etichetta>
              </span>
            </Link>
          </li>
        ))}
        {dati && altre.length === 0 && <li className="py-3 text-center text-gray-500">Nessun'altra assenza</li>}
      </ul>
    </section>
  );
}
