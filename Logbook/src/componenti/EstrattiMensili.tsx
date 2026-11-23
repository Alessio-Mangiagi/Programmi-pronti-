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
 */
import { useEffect, useState } from 'react';
import { aggiungiGiorni, formattaData, oggiIso } from '../../comune/date';
import { ETICHETTE_GIORNI, type EstrattoDipendente, type GiornoEstratto } from '../../comune/estratto-mese';
import { formattaEuro } from '../../comune/importi';
import { formattaOre } from '../../comune/orari';
import { inizioSettimana } from '../../comune/riepiloghi';
import { api, scaricaFile } from '../api';
import { COLORE_FESTIVITA, COLORI_ASSENZA, coloreProgetto } from '../colori';
import { Avviso, Caricamento, Pulsante } from './ui';

type Risposta = { mese: string; nomeMese: string; estratti: EstrattoDipendente[] };

/** Sfondo del giorno: assenza, festivo/weekend, fuori rapporto. */
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
  const inizio = inizioSettimana(e.giorni[0].data);
  const perData = new Map(e.giorni.map((g) => [g.data, g]));
  const celle: (GiornoEstratto | null)[] = [];
  for (let d = inizio; celle.length < 42; d = aggiungiGiorni(d, 1)) {
    celle.push(perData.get(d) ?? null);
    if (celle.length % 7 === 0 && d >= e.giorni[e.giorni.length - 1].data) break;
  }
  const t = e.totali;
  return (
    <section className="pagina-stampa mb-6 rounded border border-gray-200 bg-white p-4">
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="min-w-0 flex-1">
          <h3 className="mb-2 text-lg font-semibold text-marchio">Ore di {nomeMese}</h3>
          <div className="grid grid-cols-7 border-l border-t border-gray-300 text-xs">
            {['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].map((n) => (
              <div key={n} className="border-b border-r border-gray-300 bg-marchio py-1 text-center font-semibold text-white">
                {n}
              </div>
            ))}
            {celle.map((g, i) => (
              <div key={i} className="min-h-16 border-b border-r border-gray-300 p-1" style={{ backgroundColor: g ? sfondoGiorno(g) : '#e5e7eb' }}>
                {g && (
                  <>
                    <div className="text-[10px] text-gray-500">{Number(g.data.slice(8))}</div>
                    {g.minutiLavorati > 0 && <div className="cifre text-center text-sm font-bold text-marchio">{formattaOre(g.minutiLavorati)}</div>}
                    <div className="text-[9px] leading-tight text-gray-700">
                      {[testoAssenze(g), g.festivita, ...g.progetti.map((p) => `${p.codice} ${formattaOre(p.minuti)}`)].filter(Boolean).join(' · ')}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
          <h4 className="mb-1 mt-4 text-sm font-semibold text-marchio">Progetti del mese</h4>
          <table className="cifre w-full text-xs">
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
        <aside className="w-full shrink-0 rounded border border-gray-200 p-3 text-xs lg:w-72">
          <div className="mb-2 text-base font-semibold text-marchio">
            {e.dipendente.cognome} {e.dipendente.nome}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            {righeAnagrafica(e).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="font-semibold text-gray-600">{k}</dt>
                <dd className="break-all">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mb-1 mt-3 font-semibold text-marchio">Riepilogo del mese</div>
          <dl className="cifre grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
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
              <div key={k} className="contents">
                <dt className="font-semibold text-gray-600">{k}</dt>
                <dd className="text-right">{v}</dd>
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
    <section className="pagina-stampa mb-6 rounded border border-gray-200 bg-white p-4">
      <h3 className="text-lg font-semibold text-marchio">
        {e.dipendente.cognome} {e.dipendente.nome} — giorni e costi di {nomeMese}
      </h3>
      <dl className="mb-3 mt-2 grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs md:grid-cols-4">
        {righeAnagrafica(e).map(([k, v]) => (
          <div key={k}>
            <dt className="inline font-semibold text-gray-600">{k}: </dt>
            <dd className="inline">{v}</dd>
          </div>
        ))}
      </dl>
      <table className="cifre w-full text-xs">
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
      <div className="no-print mb-3 rounded border border-gray-200 bg-white p-4">
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
            ⤓ Excel
          </Pulsante>
          <Pulsante onClick={() => window.print()} disabled={!dati}>
            🖶 Stampa / PDF
          </Pulsante>
        </div>
        <p className="mt-2 text-xs text-gray-500">Per il PDF: "Stampa / PDF" e, come stampante, "Salva come PDF" (orientamento orizzontale).</p>
      </div>
      {errore && <Avviso tipo="errore">{errore}</Avviso>}
      {caricamento && !dati && <Caricamento />}
      {dati && (
        <div className={caricamento ? 'opacity-60' : ''}>
          {dati.estratti.length === 0 && <Avviso tipo="info">Nessun dipendente nel mese con i filtri scelti.</Avviso>}
          {dati.estratti.map((e) =>
            vista === 'calendario' ? <MeseACalendario key={e.dipendente.id} e={e} nomeMese={dati.nomeMese} /> : <GiorniECosti key={e.dipendente.id} e={e} nomeMese={dati.nomeMese} />,
          )}
        </div>
      )}
    </div>
  );
}
