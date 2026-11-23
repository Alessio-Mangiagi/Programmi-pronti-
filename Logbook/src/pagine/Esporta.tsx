// "><(((º> sabusabu <º)))><"
/**
 * Estrazioni Excel (solo HR): scegli periodo, dipendenti e progetti, controlla il
 * riepilogo (stessi totali del calendario) e scarica uno dei due report:
 * - Calendario lavorato: un foglio per dipendente, giorno per giorno;
 * - Ore per progetto: progetti lavorati da ogni dipendente, con costo lordo e riepilogo.
 *
 * API: POST /api/esporta/riepilogo | /calendario | /progetti (server/rotte/esporta.ts).
 */
import { useEffect, useState } from 'react';
import { aggiungiGiorni, dataIso, formattaData, giorniNelMese, oggiIso } from '../../comune/date';
import { formattaOre } from '../../comune/orari';
import { api, scaricaFile } from '../api';
import { Avviso, Campo, classiInput, IntestazionePagina, Pulsante } from '../componenti/ui';
import type { Dipendente, Progetto } from '../tipi';
import { usaDati } from '../usaDati';

type Riepilogo = { dipendenti: number; fasce: number; minuti: number; perDipendente: { id: number; nome: string; minuti: number }[] };

/** Periodi rapidi: mese corrente, mese scorso, anno corrente. */
function periodiRapidi() {
  const oggi = oggiIso();
  const [a, m] = oggi.split('-').map(Number);
  const ap = m === 1 ? a - 1 : a;
  const mp = m === 1 ? 12 : m - 1;
  return [
    { etichetta: 'Mese corrente', da: dataIso(a, m, 1), a: dataIso(a, m, giorniNelMese(a, m)) },
    { etichetta: 'Mese scorso', da: dataIso(ap, mp, 1), a: dataIso(ap, mp, giorniNelMese(ap, mp)) },
    { etichetta: 'Ultimi 30 giorni', da: aggiungiGiorni(oggi, -29), a: oggi },
    { etichetta: 'Anno corrente', da: dataIso(a, 1, 1), a: dataIso(a, 12, 31) },
  ];
}

/** Elenco di caselle con "tutti/nessuno"; nessuna selezione = tutti (come le API). */
function Selezione<T extends { id: number }>({
  titolo, elementi, scelti, setScelti, etichetta,
}: {
  titolo: string; elementi: T[]; scelti: number[]; setScelti: (v: number[]) => void; etichetta: (e: T) => string;
}) {
  return (
    <div className="rounded border border-gray-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase text-gray-500">{titolo}</span>
        <span className="text-xs text-gray-500">{scelti.length ? `${scelti.length} scelti` : 'tutti'}</span>
      </div>
      <div className="max-h-56 space-y-0.5 overflow-y-auto text-sm">
        {elementi.map((e) => (
          <label key={e.id} className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-gray-50">
            <input type="checkbox" checked={scelti.includes(e.id)} onChange={(ev) => setScelti(ev.target.checked ? [...scelti, e.id] : scelti.filter((x) => x !== e.id))} />
            {etichetta(e)}
          </label>
        ))}
      </div>
      {scelti.length > 0 && (
        <button type="button" className="mt-2 text-xs text-marchio hover:underline" onClick={() => setScelti([])}>
          Togli la selezione (tutti)
        </button>
      )}
    </div>
  );
}

export function Esporta() {
  const rapidi = periodiRapidi();
  const [da, setDa] = useState(rapidi[1].da);
  const [a, setA] = useState(rapidi[1].a);
  const [dipendenteIds, setDipendenteIds] = useState<number[]>([]);
  const [progettoIds, setProgettoIds] = useState<number[]>([]);
  const [riepilogo, setRiepilogo] = useState<Riepilogo | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [scaricamento, setScaricamento] = useState<string | null>(null);
  const { dati: dipendenti } = usaDati<Dipendente[]>('/api/dipendenti');
  const { dati: progetti } = usaDati<Progetto[]>('/api/progetti');

  const filtri = { da, a, dipendenteIds, progettoIds };
  const chiave = JSON.stringify(filtri);

  // Riepilogo aggiornato a ogni cambio dei filtri (piccola attesa per non chiamare a ogni tasto).
  useEffect(() => {
    setErrore(null);
    const timer = setTimeout(() => {
      api.post<Riepilogo>('/api/esporta/riepilogo', JSON.parse(chiave)).then(setRiepilogo, (e: Error) => {
        setRiepilogo(null);
        setErrore(e.message);
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [chiave]);

  const scarica = async (tipo: 'calendario' | 'progetti') => {
    setScaricamento(tipo);
    setErrore(null);
    try {
      await scaricaFile(`/api/esporta/${tipo}`, filtri);
    } catch (e) {
      setErrore(e instanceof Error ? e.message : String(e));
    } finally {
      setScaricamento(null);
    }
  };

  return (
    <>
      <IntestazionePagina titolo="Esporta in Excel" sottotitolo="Report del calendario lavorato e delle ore per progetto" />

      <div className="mb-3 rounded border border-gray-200 bg-white p-3">
        <div className="flex flex-wrap items-end gap-3">
          <Campo etichetta="Dal">
            <input type="date" className={classiInput()} value={da} onChange={(e) => setDa(e.target.value)} />
          </Campo>
          <Campo etichetta="Al">
            <input type="date" className={classiInput()} value={a} min={da} onChange={(e) => setA(e.target.value)} />
          </Campo>
          <div className="flex flex-wrap gap-1">
            {rapidi.map((p) => (
              <Pulsante key={p.etichetta} variante={p.da === da && p.a === a ? 'primario' : 'secondario'} onClick={() => { setDa(p.da); setA(p.a); }}>
                {p.etichetta}
              </Pulsante>
            ))}
          </div>
        </div>
      </div>

      <div className="mb-3 grid gap-3 md:grid-cols-2">
        <Selezione titolo="Dipendenti" elementi={dipendenti ?? []} scelti={dipendenteIds} setScelti={setDipendenteIds} etichetta={(d) => `${d.cognome} ${d.nome}${d.stato === 'CESSATO' ? ' (cessato)' : ''}`} />
        <Selezione titolo="Progetti" elementi={progetti ?? []} scelti={progettoIds} setScelti={setProgettoIds} etichetta={(p) => `${p.codice} · ${p.nome}`} />
      </div>

      {errore && <Avviso tipo="errore" className="mb-3">{errore}</Avviso>}

      {riepilogo && (
        <div className="mb-3 rounded border border-gray-200 bg-white p-3 text-sm">
          <div className="mb-2 flex flex-wrap items-baseline gap-4">
            <span className="text-xs font-semibold uppercase text-gray-500">Riepilogo {formattaData(da)} – {formattaData(a)}</span>
            <span>{riepilogo.dipendenti} dipendenti</span>
            <span>{riepilogo.fasce} fasce orarie</span>
            <span className="cifre text-lg font-semibold text-marchio">{formattaOre(riepilogo.minuti)} ore</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {riepilogo.perDipendente.map((d) => (
              <span key={d.id} className="cifre rounded border border-gray-200 px-2 py-0.5">
                {d.nome}: <b>{formattaOre(d.minuti)}</b>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded border border-gray-200 bg-white p-4">
          <h2 className="font-semibold text-marchio">Calendario lavorato</h2>
          <p className="mb-3 text-sm text-gray-600">Un foglio per dipendente: anagrafica, ogni giorno con fasce, progetto, ore, assenze e festività, totali del periodo e ore contrattuali attese.</p>
          <Pulsante variante="primario" disabled={!!scaricamento || !riepilogo} onClick={() => scarica('calendario')}>
            {scaricamento === 'calendario' ? 'Preparazione…' : '⤓ Scarica calendario lavorato'}
          </Pulsante>
        </div>
        <div className="rounded border border-gray-200 bg-white p-4">
          <h2 className="font-semibold text-marchio">Ore per progetto</h2>
          <p className="mb-3 text-sm text-gray-600">Per ogni dipendente i progetti lavorati con ore e costo lordo, totale complessivo e riepilogo dipendenti × progetti.</p>
          <Pulsante variante="primario" disabled={!!scaricamento || !riepilogo} onClick={() => scarica('progetti')}>
            {scaricamento === 'progetti' ? 'Preparazione…' : '⤓ Scarica ore per progetto'}
          </Pulsante>
        </div>
      </div>
    </>
  );
}
