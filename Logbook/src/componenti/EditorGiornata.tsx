// "><(((º> sabusabu <º)))><"
/**
 * Finestra di dettaglio di un giorno per un dipendente: elenco delle fasce orarie
 * (progetto, dalle, alle, note) modificabile, con ore calcolate riga per riga, totale
 * del giorno e sovrapposizioni evidenziate mentre si scrive.
 *
 * "Salva" manda tutta la giornata insieme (PUT /api/registrazioni/giornata): il server
 * ricontrolla tutto e, se qualcosa non va, il giorno resta com'era e gli errori tornano
 * sulle righe giuste ("fasce.N.campo").
 *
 * `avvisi` sono righe informative passate dal calendario (festività, assenze del giorno).
 */
import { useEffect, useMemo, useState } from 'react';
import { formattaData, giornoSettimana } from '../../comune/date';
import { durataMinuti, formattaOre, isOrarioValido, minutiDaOrario, orarioDaMinuti } from '../../comune/orari';
import { coppieSovrapposte, schemaGiornata } from '../../comune/registrazioni';
import { erroriPerCampo } from '../../comune/schemi';
import { api, ErroreApi } from '../api';
import { coloreProgetto } from '../colori';
import type { Progetto, Registrazione } from '../tipi';
import { Avviso, Caricamento, classiInput, Modale, Pulsante } from './ui';

type Riga = { chiave: number; progettoId: string; oraInizio: string; oraFine: string; note: string };

const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
let contatore = 0;
const nuovaRiga = (r: Partial<Riga> = {}): Riga => ({ chiave: ++contatore, progettoId: '', oraInizio: '', oraFine: '', note: '', ...r });

/** Durata della riga in minuti, o null se gli orari non sono (ancora) validi. */
function durataRiga(r: Riga): number | null {
  if (!isOrarioValido(r.oraInizio) || !isOrarioValido(r.oraFine) || r.oraFine <= r.oraInizio) return null;
  return durataMinuti(r.oraInizio, r.oraFine);
}

export function EditorGiornata({
  dipendenteId,
  nomeDipendente,
  data,
  avvisi = [],
  onChiudi,
  onSalvato,
}: {
  dipendenteId: number;
  nomeDipendente: string;
  data: string;
  avvisi?: { tipo: 'info' | 'attenzione'; testo: string }[];
  onChiudi: () => void;
  onSalvato: () => void;
}) {
  const [righe, setRighe] = useState<Riga[] | null>(null);
  const [progetti, setProgetti] = useState<Progetto[]>([]);
  const [errori, setErrori] = useState<Record<string, string>>({});
  const [messaggio, setMessaggio] = useState<string | null>(null);
  const [invio, setInvio] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get<Registrazione[]>(`/api/registrazioni?dipendenteId=${dipendenteId}&da=${data}&a=${data}`),
      api.get<Progetto[]>('/api/progetti'),
    ])
      .then(([fasce, prog]) => {
        setProgetti(prog);
        setRighe(fasce.map((f) => nuovaRiga({ progettoId: String(f.progettoId), oraInizio: f.oraInizio, oraFine: f.oraFine, note: f.note ?? '' })));
      })
      .catch((e: Error) => setMessaggio(e.message));
  }, [dipendenteId, data]);

  // Progetti selezionabili: attivi/sospesi, più quelli chiusi già usati in questo giorno.
  const progettiScelta = useMemo(() => {
    const usati = new Set((righe ?? []).map((r) => r.progettoId));
    return progetti.filter((p) => p.stato !== 'CHIUSO' || usati.has(String(p.id)));
  }, [progetti, righe]);

  const sovrapposte = useMemo(() => {
    const indici = new Set<number>();
    for (const [i, j] of coppieSovrapposte(righe ?? [])) {
      indici.add(i);
      indici.add(j);
    }
    return indici;
  }, [righe]);

  if (!righe) {
    return (
      <Modale titolo={`Ore del ${formattaData(data)}`} aperta onChiudi={onChiudi} larghezza="max-w-3xl">
        {messaggio ? <Avviso tipo="errore">{messaggio}</Avviso> : <Caricamento />}
      </Modale>
    );
  }

  const aggiorna = (chiave: number, campo: keyof Riga, valore: string) => setRighe((rr) => rr!.map((r) => (r.chiave === chiave ? { ...r, [campo]: valore } : r)));

  /** Nuova riga che parte dalla fine dell'ultima (o alle 08:00) e dura un'ora. */
  const aggiungi = () => {
    const ultima = righe[righe.length - 1];
    const inizio = ultima && isOrarioValido(ultima.oraFine) ? ultima.oraFine : '08:00';
    const fine = minutiDaOrario(inizio) + 60 < 24 * 60 ? orarioDaMinuti(minutiDaOrario(inizio) + 60) : '23:59';
    setRighe([...righe, nuovaRiga({ oraInizio: inizio, oraFine: fine, progettoId: ultima?.progettoId ?? '' })]);
  };

  const totale = righe.reduce((s, r) => s + (durataRiga(r) ?? 0), 0);

  const salva = async () => {
    setMessaggio(null);
    const corpo = {
      dipendenteId,
      data,
      fasce: righe.map((r) => ({ progettoId: r.progettoId, oraInizio: r.oraInizio, oraFine: r.oraFine, note: r.note })),
    };
    const controllo = schemaGiornata.safeParse(corpo);
    if (!controllo.success) {
      setErrori(erroriPerCampo(controllo.error));
      setMessaggio('Correggi le righe evidenziate');
      return;
    }
    setErrori({});
    setInvio(true);
    try {
      await api.put('/api/registrazioni/giornata', corpo);
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

  const err = (i: number, campo: string) => errori[`fasce.${i}.${campo}`];

  return (
    <Modale titolo={`${nomeDipendente} — ${GIORNI[giornoSettimana(data)]} ${formattaData(data)}`} aperta onChiudi={onChiudi} larghezza="max-w-3xl">
      <div className="space-y-3">
        {avvisi.map((a) => (
          <Avviso key={a.testo} tipo={a.tipo}>
            {a.testo}
          </Avviso>
        ))}
        {messaggio && <Avviso tipo="errore">{messaggio}</Avviso>}
        {errori.data && <Avviso tipo="errore">{errori.data}</Avviso>}

        <div className="overflow-x-auto">
          <table className="cifre w-full text-sm">
            <thead className="text-xs uppercase text-gray-500">
              <tr>
                <th className="px-1 py-1 text-left">Progetto</th>
                <th className="w-28 px-1 py-1 text-left">Dalle</th>
                <th className="w-28 px-1 py-1 text-left">Alle</th>
                <th className="w-16 px-1 py-1 text-right">Ore</th>
                <th className="px-1 py-1 text-left">Note</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {righe.map((r, i) => {
                const durata = durataRiga(r);
                const progetto = progetti.find((p) => String(p.id) === r.progettoId);
                const errRiga = err(i, 'progettoId') || err(i, 'oraInizio') || err(i, 'oraFine') || err(i, 'note');
                return (
                  <tr key={r.chiave} className={`align-top ${sovrapposte.has(i) ? 'bg-red-50' : ''}`}>
                    <td className="px-1 py-1">
                      <div className="flex items-center gap-1.5">
                        <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: progetto ? coloreProgetto(progetto) : '#e5e7eb' }} />
                        <select aria-label={`Progetto riga ${i + 1}`} className={classiInput(err(i, 'progettoId'))} value={r.progettoId} onChange={(e) => aggiorna(r.chiave, 'progettoId', e.target.value)}>
                          <option value="">— scegli —</option>
                          {progettiScelta.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.codice} · {p.nome}
                            </option>
                          ))}
                        </select>
                      </div>
                    </td>
                    <td className="px-1 py-1">
                      <input type="time" step={300} aria-label={`Inizio riga ${i + 1}`} className={classiInput(err(i, 'oraInizio') || (sovrapposte.has(i) ? 'x' : undefined))} value={r.oraInizio} onChange={(e) => aggiorna(r.chiave, 'oraInizio', e.target.value)} />
                    </td>
                    <td className="px-1 py-1">
                      <input type="time" step={300} aria-label={`Fine riga ${i + 1}`} className={classiInput(err(i, 'oraFine'))} value={r.oraFine} onChange={(e) => aggiorna(r.chiave, 'oraFine', e.target.value)} />
                    </td>
                    <td className="px-1 py-2 text-right font-medium">{durata === null ? '—' : formattaOre(durata)}</td>
                    <td className="px-1 py-1">
                      <input aria-label={`Note riga ${i + 1}`} className={classiInput(err(i, 'note'))} value={r.note} onChange={(e) => aggiorna(r.chiave, 'note', e.target.value)} maxLength={500} />
                      {(errRiga || sovrapposte.has(i)) && <div className="mt-0.5 text-xs text-red-700">{errRiga ?? 'Fascia sovrapposta a un\'altra riga'}</div>}
                    </td>
                    <td className="px-1 py-1">
                      <button type="button" aria-label={`Elimina riga ${i + 1}`} className="rounded px-2 py-1 text-red-600 hover:bg-red-50" onClick={() => setRighe(righe.filter((x) => x.chiave !== r.chiave))}>
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
              {righe.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-1 py-4 text-center text-gray-500">
                    Nessuna fascia registrata in questo giorno.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200">
                <td colSpan={3} className="px-1 py-2">
                  <Pulsante variante="leggero" onClick={aggiungi}>
                    + Aggiungi fascia
                  </Pulsante>
                </td>
                <td className="px-1 py-2 text-right font-semibold text-marchio">{formattaOre(totale)}</td>
                <td colSpan={2} className="px-1 py-2 text-sm text-gray-500">
                  totale del giorno
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-100 pt-3">
          <Pulsante onClick={onChiudi}>Annulla</Pulsante>
          <Pulsante variante="primario" onClick={salva} disabled={invio || sovrapposte.size > 0}>
            {invio ? 'Salvataggio…' : 'Salva giornata'}
          </Pulsante>
        </div>
      </div>
    </Modale>
  );
}
