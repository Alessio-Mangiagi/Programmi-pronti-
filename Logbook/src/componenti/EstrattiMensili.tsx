// "><(((º> sabusabu <º)))><"
/**
 * Estratti mensili (richiesta del 23/11/2026) nella pagina Esporta: scelta del mese,
 * anteprima a schermo dei due layout, download Excel e stampa / PDF.
 *
 * - "Mese a calendario": calendario del mese a sinistra con le ore di ogni giorno,
 *   anagrafica e riepilogo a destra, descrizione dei progetti in basso.
 * - "Giorni e costi": anagrafica completa in testa, una riga per giorno con ore, progetti,
 *   assenze (anche ferie e malattia), festività e costo netto/lordo del giorno.
 *
 * Il PDF si ottiene dalla stampa del browser ("Salva come PDF"): le regole @media print
 * in src/index.css nascondono menu e comandi e mettono un dipendente per pagina.
 * Dati: POST /api/esporta/mese (gli stessi numeri degli Excel).
 *
 * Layout in flexbox (24/11/2026): a schermo gli estratti dei dipendenti partono da 56rem
 * e si affiancano sugli schermi molto larghi (due o tre su un ultra wide). In stampa il
 * contenitore torna a blocchi (print:block), così resta un dipendente per pagina A4.
 * Sabato e domenica non compaiono (Giorno 25, li esclude comune/estratto-mese.ts): la
 * griglia ha cinque colonne da lunedì a venerdì e la tabella dei giorni solo i feriali.
 * Il calendario del mese è fatto di righe-settimana flex; calendario e anagrafica si
 * affiancano da 44rem di spazio in su, mentre in stampa restano sempre affiancati
 * (print:flex-nowrap).
 */
import { useEffect, useState } from 'react';
import { aggiungiGiorni, formattaData, oggiIso } from '../../comune/date';
import { ETICHETTE_GIORNI, GIORNI_GRIGLIA, settimaneDelMese, type EstrattoDipendente, type GiornoEstratto } from '../../comune/estratto-mese';
import { formattaEuro } from '../../comune/importi';
import { formattaOre } from '../../comune/orari';
import { api, scaricaFile } from '../api';
import { COLORE_FESTIVITA, COLORI_ASSENZA, coloreProgetto } from '../colori';
import { Avviso, Caricamento, Pulsante } from './ui';
import { Icona } from './icone';

type Risposta = { mese: string; nomeMese: string; estratti: EstrattoDipendente[] };

/** Sfondo del giorno: assenza, festivo, fuori rapporto. */
function sfondoGiorno(g: GiornoEstratto): string | undefined {
  if (g.fuoriRapporto) return '#e5e7eb';
  const tipo = g.assenze[0]?.tipo;
  if (tipo) return COLORI_ASSENZA[tipo].sfondo;
  if (g.festivita) return COLORE_FESTIVITA.sfondo;
  if (!g.lavorativo) return '#f3f4f6';
  return undefined;
}

const testoAssenze = (g: GiornoEstratto) =>
  g.assenze.map((x) => (x.tipo === 'PERMESSO' ? `Permesso ${formattaOre(x.minuti)}` : COLORI_ASSENZA[x.tipo].etichetta)).join(', ');

/** Anagrafica come elenco etichetta/valore (colonna di destra o testata). */
function righeAnagrafica(e: EstrattoDipendente): [string, string][] {
  const d = e.dipendente;
  return [
    ['Matricola', d.matricola],
    ['Codice fiscale', d.codiceFiscale],
    ['Mansione', d.mansione ?? '—'],
    ['Reparto', d.reparto ?? '—'],
    ['Contratto', d.tipoContratto],
    ['Ore settimanali', String(d.oreSettimanali)],
    ['Assunzione', formattaData(d.dataAssunzione)],
    ['Cessazione', d.dataCessazione ? formattaData(d.dataCessazione) : '—'],
    ['Email', d.email ?? '—'],
    ['Telefono', d.telefono ?? '—'],
    ['Costo orario netto', formattaEuro(d.costoOrarioNettoCent)],
    ['Costo orario lordo', formattaEuro(d.costoOrarioLordoCent)],
  ];
}

/** Layout 1: calendario a sinistra, anagrafica a destra, progetti in basso. */
function MeseACalendario({ e, nomeMese }: { e: EstrattoDipendente; nomeMese: string }) {
  const perData = new Map(e.giorni.map((g) => [g.data, g]));
  // Settimane da lunedì a venerdì (Giorno 25): ogni settimana è una riga flex di cinque celle.
  const settimane: (GiornoEstratto | null)[][] = settimaneDelMese(e.mese).map((lunedi) =>
    GIORNI_GRIGLIA.map((_, i) => perData.get(aggiungiGiorni(lunedi, i)) ?? null),
  );
  const t = e.totali;
  return (
    <section className="pagina-stampa scheda min-w-0 flex-[1_1_56rem] p-3 sm:p-4">
      <div className="flex flex-wrap gap-4 print:flex-nowrap">
        <div className="min-w-0 flex-[3_1_28rem]">
          <h3 className="mb-2 text-lg font-semibold text-marchio">Ore di {nomeMese}</h3>
          <div className="border-l border-t border-gray-300 text-xs">
            <div className="flex">
              {GIORNI_GRIGLIA.map((n) => (
                <div key={n} className="min-w-0 flex-1 basis-0 border-b border-r border-gray-300 bg-marchio py-1 text-center font-semibold text-white">
                  {n}
                </div>
              ))}
            </div>
            {settimane.map((settimana, s) => (
              <div key={s} className="flex">
                {settimana.map((g, i) => (
                  <div key={i} className="min-h-16 min-w-0 flex-1 basis-0 border-b border-r border-gray-300 p-1 4xl:min-h-20" style={{ backgroundColor: g ? sfondoGiorno(g) : '#e5e7eb' }}>
                    {g && (
                      <>
                        <div className="text-[10px] text-gray-500">{Number(g.data.slice(8))}</div>
                        {g.minutiLavorati > 0 && <div className="cifre text-center text-sm font-bold text-marchio">{formattaOre(g.minutiLavorati)}</div>}
                        <div className="break-words text-[9px] leading-tight text-gray-700">
                          {[testoAssenze(g), g.festivita, ...g.progetti.map((p) => `${p.codice} ${formattaOre(p.minuti)}`)].filter(Boolean).join(' · ')}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <h4 className="mb-1 mt-4 text-sm font-semibold text-marchio">Progetti del mese</h4>
          {/* Sul telefono la tabella dei progetti scorre in orizzontale dentro la scheda. */}
          <div className="overflow-x-auto">
            <table className="cifre w-full min-w-[28rem] text-xs print:min-w-0">
              <thead className="bg-gray-100 text-gray-600">
                <tr>
                  <th className="px-2 py-1 text-left">Codice</th>
                  <th className="px-2 py-1 text-left">Progetto</th>
                  <th className="px-2 py-1 text-left">Cliente</th>
                  <th className="px-2 py-1 text-right">Max ore/giorno</th>
                  <th className="px-2 py-1 text-right">Ore nel mese</th>
                </tr>
              </thead>
              <tbody>
                {e.progetti.map((p) => (
                  <tr key={p.id} className="border-t border-gray-100">
                    <td className="px-2 py-1">
                      <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ backgroundColor: coloreProgetto(p) }} />
                      {p.codice}
                    </td>
                    <td className="px-2 py-1">{p.nome}</td>
                    <td className="px-2 py-1">{p.cliente ?? '—'}</td>
                    <td className="px-2 py-1 text-right">{p.maxMinutiGiorno != null ? formattaOre(p.maxMinutiGiorno) : 'nessun limite'}</td>
                    <td className="px-2 py-1 text-right font-semibold">{formattaOre(p.minuti)}</td>
                  </tr>
                ))}
                {e.progetti.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-2 py-2 text-gray-500">
                      Nessuna ora registrata nel mese
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <aside className="min-w-0 flex-[1_1_16rem] rounded border border-gray-200 p-3 text-xs print:flex-[0_0_18rem]">
          <div className="mb-2 text-base font-semibold text-marchio">
            {e.dipendente.cognome} {e.dipendente.nome}
          </div>
          {/* Coppie etichetta/valore in righe flex: valore a destra, va a capo se lungo (email). */}
          <dl className="space-y-0.5">
            {righeAnagrafica(e).map(([k, v]) => (
              <div key={k} className="flex gap-3">
                <dt className="shrink-0 font-semibold text-gray-600">{k}</dt>
                <dd className="min-w-0 flex-1 break-all text-right">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mb-1 mt-3 font-semibold text-marchio">Riepilogo del mese</div>
          <dl className="cifre space-y-0.5">
            {(
              [
                ['Ore lavorate', formattaOre(t.minutiLavorati)],
                ['Ore attese', formattaOre(t.minutiAttesi)],
                ['Giorni con ore', String(t.giorniConOre)],
                ['Giorni lavorativi', String(t.giorniLavorativi)],
                ['Ferie (giorni)', String(t.giorniFerie)],
                ['Malattia (giorni)', String(t.giorniMalattia)],
                ['Permessi (ore)', formattaOre(t.minutiPermessi)],
                ['Costo netto', formattaEuro(t.costoNettoCent)],
                ['Costo lordo', formattaEuro(t.costoLordoCent)],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex gap-3">
                <dt className="shrink-0 font-semibold text-gray-600">{k}</dt>
                <dd className="min-w-0 flex-1 text-right">{v}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>
    </section>
  );
}

/** Layout 2: giorni in verticale con ore, assenze e costi. */
function GiorniECosti({ e, nomeMese }: { e: EstrattoDipendente; nomeMese: string }) {
  const t = e.totali;
  return (
    <section className="pagina-stampa scheda min-w-0 flex-[1_1_56rem] p-3 sm:p-4">
      <h3 className="text-lg font-semibold text-marchio">
        {e.dipendente.cognome} {e.dipendente.nome} — giorni e costi di {nomeMese}
      </h3>
      {/* Anagrafica in flexbox: le voci partono da 14rem e vanno a capo (una per riga sul telefono). */}
      <dl className="mb-3 mt-2 flex flex-wrap gap-x-6 gap-y-0.5 text-xs">
        {righeAnagrafica(e).map(([k, v]) => (
          <div key={k} className="min-w-0 flex-[1_1_14rem] break-words">
            <dt className="inline font-semibold text-gray-600">{k}: </dt>
            <dd className="inline">{v}</dd>
          </div>
        ))}
      </dl>
      {/* Dieci colonne: sul telefono la tabella scorre in orizzontale dentro la scheda. */}
      <div className="overflow-x-auto">
        <table className="cifre w-full min-w-[46rem] text-xs print:min-w-0">
          <thead className="bg-marchio text-white">
            <tr>
              {['Data', 'Giorno', 'Ore', 'Progetti', 'Fasce', 'Assenza', 'Festività', 'Ore retribuite', 'Costo netto', 'Costo lordo'].map((h) => (
                <th key={h} className={`px-2 py-1 ${['Ore', 'Ore retribuite', 'Costo netto', 'Costo lordo'].includes(h) ? 'text-right' : 'text-left'}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {e.giorni.map((g) => (
              <tr key={g.data} className="border-t border-gray-100" style={{ backgroundColor: sfondoGiorno(g) }}>
                <td className="px-2 py-0.5">{formattaData(g.data)}</td>
                <td className="px-2 py-0.5">{ETICHETTE_GIORNI[g.giornoSettimana]}</td>
                <td className="px-2 py-0.5 text-right font-medium">{g.minutiLavorati ? formattaOre(g.minutiLavorati) : ''}</td>
                <td className="px-2 py-0.5">{g.progetti.map((p) => `${p.codice} ${formattaOre(p.minuti)}`).join(', ')}</td>
                <td className="px-2 py-0.5">{g.fasce.map((f) => `${f.oraInizio}-${f.oraFine}`).join(', ')}</td>
                <td className="px-2 py-0.5">{g.fuoriRapporto ? 'Fuori rapporto' : testoAssenze(g)}</td>
                <td className="px-2 py-0.5">{g.festivita ?? ''}</td>
                <td className="px-2 py-0.5 text-right">{g.minutiRetribuiti ? formattaOre(g.minutiRetribuiti) : ''}</td>
                <td className="px-2 py-0.5 text-right">{g.minutiRetribuiti ? formattaEuro(g.costoNettoCent) : ''}</td>
                <td className="px-2 py-0.5 text-right">{g.minutiRetribuiti ? formattaEuro(g.costoLordoCent) : ''}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-400 font-bold">
              <td className="px-2 py-1" colSpan={2}>
                TOTALE
              </td>
              <td className="px-2 py-1 text-right">{formattaOre(t.minutiLavorati)}</td>
              <td colSpan={4} className="px-2 py-1 text-xs font-normal text-gray-600">
                Ferie {t.giorniFerie} gg · Malattia {t.giorniMalattia} gg · Permessi {formattaOre(t.minutiPermessi)} h · Ore attese {formattaOre(t.minutiAttesi)}
              </td>
              <td className="px-2 py-1 text-right">{formattaOre(t.minutiRetribuiti)}</td>
              <td className="px-2 py-1 text-right">{formattaEuro(t.costoNettoCent)}</td>
              <td className="px-2 py-1 text-right">{formattaEuro(t.costoLordoCent)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-2 text-[10px] text-gray-500">
        Costo del giorno = (ore lavorate + ferie/malattia nei giorni lavorativi a ore del contratto + permessi) × costo orario. Festività indicate senza costo.
      </p>
    </section>
  );
}

export function EstrattiMensili({ dipendenteIds, progettoIds }: { dipendenteIds: number[]; progettoIds: number[] }) {
  const [mese, setMese] = useState(aggiungiGiorni(oggiIso().slice(0, 8) + '01', -1).slice(0, 7)); // mese scorso
  const [vista, setVista] = useState<'calendario' | 'giorni'>('calendario');
  const [dati, setDati] = useState<Risposta | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [caricamento, setCaricamento] = useState(false);
  const filtri = { mese, dipendenteIds, progettoIds };
  const chiave = JSON.stringify(filtri);

  useEffect(() => {
    if (!/^\d{4}-\d{2}$/.test(mese)) return;
    setCaricamento(true);
    setErrore(null);
    const timer = setTimeout(() => {
      api
        .post<Risposta>('/api/esporta/mese', JSON.parse(chiave))
        .then(setDati, (e: Error) => {
          setDati(null);
          setErrore(e.message);
        })
        .finally(() => setCaricamento(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [chiave, mese]);

  const scarica = (percorso: string) => scaricaFile(percorso, filtri).catch((e: Error) => setErrore(e.message));

  return (
    <div className="mt-6">
      <div className="no-print mb-3 scheda p-3 sm:p-4">
        <h2 className="font-semibold text-marchio">Estratti mensili</h2>
        <p className="mb-3 text-sm text-gray-600">Un dipendente per pagina, con anteprima qui sotto. Dipendenti e progetti sono quelli scelti sopra.</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-gray-700">Mese</span>
            <input type="month" min="2020-01" className="rounded border border-gray-300 px-2 py-1.5 text-sm" value={mese} onChange={(e) => setMese(e.target.value)} />
          </label>
          <div className="inline-flex overflow-hidden rounded border border-gray-300 text-sm" role="group" aria-label="Layout">
            {(
              [
                ['calendario', 'Mese a calendario'],
                ['giorni', 'Giorni e costi'],
              ] as const
            ).map(([v, etichetta]) => (
              <button key={v} type="button" onClick={() => setVista(v)} className={`px-3 py-1.5 ${vista === v ? 'bg-marchio text-white' : 'bg-white hover:bg-gray-50'}`}>
                {etichetta}
              </button>
            ))}
          </div>
          <Pulsante onClick={() => scarica(vista === 'calendario' ? '/api/esporta/mese/calendario' : '/api/esporta/mese/giorni')} disabled={!dati}>
            <Icona nome="scarica" dimensione={16} /> Excel
          </Pulsante>
          <Pulsante onClick={() => window.print()} disabled={!dati}>
            <Icona nome="stampa" dimensione={16} /> Stampa / PDF
          </Pulsante>
        </div>
        <p className="mt-2 text-xs text-gray-500">Per il PDF: "Stampa / PDF" e, come stampante, "Salva come PDF" (orientamento orizzontale).</p>
      </div>
      {errore && <Avviso tipo="errore">{errore}</Avviso>}
      {caricamento && !dati && <Caricamento />}
      {dati && (
        // A schermo gli estratti si affiancano quando c'è spazio; in stampa tornano uno sotto l'altro (un dipendente per pagina).
        <div className={`flex flex-wrap gap-6 print:block ${caricamento ? 'opacity-60' : ''}`}>
          {dati.estratti.length === 0 && <Avviso tipo="info" className="basis-full">Nessun dipendente nel mese con i filtri scelti.</Avviso>}
          {dati.estratti.map((e) =>
            vista === 'calendario' ? <MeseACalendario key={e.dipendente.id} e={e} nomeMese={dati.nomeMese} /> : <GiorniECosti key={e.dipendente.id} e={e} nomeMese={dati.nomeMese} />,
          )}
        </div>
      )}
    </div>
  );
}
