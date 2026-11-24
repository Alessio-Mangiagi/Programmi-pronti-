// "><(((º> sabusabu <º)))><"
/**
 * Dashboard: la prima pagina dopo il login. Mostra subito cosa richiede attenzione.
 *
 * HR: richieste di assenza da approvare, dipendenti con giorni lavorativi senza ore,
 * ore del mese lavorate vs attese per dipendente, ore per progetto, assenze e festività
 * dei prossimi giorni.
 * Dipendente: le proprie ore del mese, i giorni ancora da registrare (con pulsante che
 * apre direttamente l'editor della giornata), le proprie richieste e assenze.
 *
 * Dati: GET /api/dashboard (server/rotte/dashboard.ts).
 *
 * Layout in flexbox con a capo automatico (24/11/2026): i quattro riquadri partono da
 * 10rem (due per riga sul telefono, quattro su un monitor), i pannelli da 30rem (uno per
 * riga sul telefono, due su un monitor, tutti affiancati su un ultra wide).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ETICHETTE_ASSENZA } from '../../comune/assenze';
import { formattaData } from '../../comune/date';
import { formattaOre } from '../../comune/orari';
import { useAuth } from '../auth';
import { COLORE_FESTIVITA, COLORI_ASSENZA, coloreProgetto } from '../colori';
import { EditorGiornata } from '../componenti/EditorGiornata';
import { Avviso, Caricamento, IntestazionePagina, Pulsante } from '../componenti/ui';
import type { Festivita, TipoAssenza } from '../tipi';
import { usaDati } from '../usaDati';

type AssenzaBreve = { id: number; tipo: TipoAssenza; dataInizio: string; dataFine: string; minutiPermesso: number | null; dipendente: string };
type DatiDashboard = {
  oggi: string;
  mese: { da: string; a: string };
  totaleMinuti: number;
  totaleAttesi: number;
  perDipendente: { id: number; nome: string; oreSettimanali: number; minutiLavorati: number; minutiAttesi: number; giorniSenzaOre: string[] }[];
  perProgetto: { id: number; codice: string; nome: string; colore: string | null; minuti: number }[];
  richiesteInAttesa: (AssenzaBreve & { creatoIl: string })[];
  prossimeAssenze: AssenzaBreve[];
  prossimeFestivita: Festivita[];
};

const nomeMese = (iso: string) => new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' }).format(new Date(`${iso}T12:00:00`));
const periodo = (a: AssenzaBreve) =>
  a.tipo === 'PERMESSO' ? `${formattaData(a.dataInizio)} · ${formattaOre(a.minutiPermesso ?? 0)} h` : a.dataInizio === a.dataFine ? formattaData(a.dataInizio) : `${formattaData(a.dataInizio)} → ${formattaData(a.dataFine)}`;

/** Riquadro numerico in cima alla pagina; `allarme` lo colora quando c'è da intervenire. */
function Tessera({ titolo, valore, dettaglio, allarme, a }: { titolo: string; valore: string; dettaglio?: string; allarme?: boolean; a?: string }) {
  const corpo = (
    <div className={`scheda h-full border-t-[3px] px-3 py-3 sm:px-4 ${allarme ? '!border-t-[#e9c46a] !bg-[#fdf8eb]' : '!border-t-marchio'} ${a ? 'scheda-attiva' : ''}`}>
      <div className="sopratitolo !text-gray-500">{titolo}</div>
      <div className={`cifre font-display text-[1.5rem] font-medium leading-tight sm:text-[1.75rem] ${allarme ? 'text-[#6b4a00]' : 'text-marchio'}`}>{valore}</div>
      {dettaglio && <div className="text-xs text-gray-500">{dettaglio}</div>}
    </div>
  );
  // Il riquadro è un figlio del contenitore flex: parte da 10rem e cresce fino a riempire la riga.
  const classi = 'min-w-0 flex-[1_1_10rem]';
  return a ? <Link to={a} className={classi}>{corpo}</Link> : <div className={classi}>{corpo}</div>;
}

/** Barra lavorato/atteso: verde fino al 100%, la parte oltre resta piena. */
function Barra({ lavorati, attesi }: { lavorati: number; attesi: number }) {
  const percentuale = attesi ? Math.round((lavorati / attesi) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-16 overflow-hidden rounded bg-gray-200 sm:w-28 4xl:w-48">
        <div className={`h-full ${percentuale >= 95 ? 'bg-marchio-verde' : percentuale >= 75 ? 'bg-[#e9c46a]' : 'bg-[#e07a6e]'}`} style={{ width: `${Math.min(100, percentuale)}%` }} />
      </div>
      <span className="cifre w-10 text-right text-xs text-gray-600">{attesi ? `${percentuale}%` : '—'}</span>
    </div>
  );
}

function Pannello({ titolo, azione, children }: { titolo: string; azione?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="scheda min-w-0 flex-[1_1_30rem]">
      <div className="flex flex-wrap items-center justify-between gap-x-3 border-b border-gray-100 px-4 py-2">
        <h2 className="font-display text-[0.98rem] font-medium text-marchio">{titolo}</h2>
        {azione}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

const ChipAssenza = ({ tipo }: { tipo: TipoAssenza }) => (
  <span className="rounded border px-1.5 py-0.5 text-xs" style={{ backgroundColor: COLORI_ASSENZA[tipo].sfondo, color: COLORI_ASSENZA[tipo].testo, borderColor: COLORI_ASSENZA[tipo].bordo }}>
    {ETICHETTE_ASSENZA[tipo]}
  </span>
);

export function Dashboard() {
  const { utente, admin } = useAuth();
  const { dati, errore, caricamento, ricarica } = usaDati<DatiDashboard>('/api/dashboard');
  const [editor, setEditor] = useState<string | null>(null);

  if (errore) return <Avviso tipo="errore">Impossibile caricare la dashboard: {errore}</Avviso>;
  if (caricamento && !dati) return <Caricamento />;
  if (!dati) return null;

  const conGiorniMancanti = dati.perDipendente.filter((d) => d.giorniSenzaOre.length);
  const giorniMancanti = conGiorniMancanti.reduce((s, d) => s + d.giorniSenzaOre.length, 0);
  const assentiOggi = dati.prossimeAssenze.filter((a) => a.dataInizio <= dati.oggi && dati.oggi <= a.dataFine);
  const io = dati.perDipendente[0];

  return (
    <>
      <IntestazionePagina
        titolo={admin ? 'Dashboard HR' : `Ciao, ${utente?.nomeVisualizzato}`}
        sottotitolo={`Situazione di ${nomeMese(dati.oggi)} al ${formattaData(dati.oggi)}`}
        azioni={<Pulsante onClick={ricarica}>Aggiorna</Pulsante>}
      />

      {/* Numeri principali */}
      <div className="mb-4 flex flex-wrap gap-3">
        <Tessera titolo={admin ? 'Ore del mese' : 'Le mie ore del mese'} valore={formattaOre(dati.totaleMinuti)} dettaglio={`attese a oggi ${formattaOre(dati.totaleAttesi)}`} a="/calendario" />
        <Tessera
          titolo={admin ? 'Richieste da approvare' : 'Richieste in attesa'}
          valore={String(dati.richiesteInAttesa.length)}
          dettaglio={dati.richiesteInAttesa.length ? (admin ? 'clic per decidere' : 'in attesa di HR') : 'nessuna'}
          allarme={admin && dati.richiesteInAttesa.length > 0}
          a="/assenze"
        />
        <Tessera
          titolo="Giorni senza ore"
          valore={String(giorniMancanti)}
          dettaglio={admin ? `${conGiorniMancanti.length} dipendenti, fino a ieri` : 'giorni lavorativi fino a ieri'}
          allarme={giorniMancanti > 0}
        />
        <Tessera titolo="Assenti oggi" valore={String(assentiOggi.length)} dettaglio={assentiOggi.map((a) => a.dipendente).join(', ') || 'nessuno'} />
      </div>

      <div className="flex flex-wrap gap-4">
        {/* Cose da fare */}
        {admin ? (
          <Pannello titolo="Richieste da approvare" azione={<Link className="text-sm text-marchio hover:underline" to="/assenze">Vai alle assenze →</Link>}>
            {dati.richiesteInAttesa.length === 0 ? (
              <p className="text-sm text-gray-500">Nessuna richiesta in attesa.</p>
            ) : (
              <ul className="divide-y divide-gray-100 text-sm">
                {dati.richiesteInAttesa.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-2 py-1.5">
                    <ChipAssenza tipo={a.tipo} />
                    <span className="font-medium">{a.dipendente}</span>
                    <span className="text-gray-600">{periodo(a)}</span>
                    <span className="ml-auto text-xs text-gray-400">chiesta il {formattaData(a.creatoIl.slice(0, 10))}</span>
                  </li>
                ))}
              </ul>
            )}
          </Pannello>
        ) : (
          <Pannello titolo="Giorni da registrare">
            {!io || io.giorniSenzaOre.length === 0 ? (
              <p className="text-sm text-gray-500">Tutto in ordine: nessun giorno lavorativo senza ore.</p>
            ) : (
              <ul className="divide-y divide-gray-100 text-sm">
                {io.giorniSenzaOre.map((g) => (
                  <li key={g} className="flex items-center justify-between py-1.5">
                    <span>{new Intl.DateTimeFormat('it-IT', { weekday: 'long' }).format(new Date(`${g}T12:00:00`))} {formattaData(g)}</span>
                    <Pulsante variante="leggero" onClick={() => setEditor(g)}>
                      Registra ore
                    </Pulsante>
                  </li>
                ))}
              </ul>
            )}
          </Pannello>
        )}

        {admin && (
          <Pannello titolo="Giorni lavorativi senza ore (fino a ieri)">
            {conGiorniMancanti.length === 0 ? (
              <p className="text-sm text-gray-500">Tutti i dipendenti hanno registrato le ore.</p>
            ) : (
              <ul className="divide-y divide-gray-100 text-sm">
                {conGiorniMancanti.map((d) => (
                  <li key={d.id} className="py-1.5">
                    <span className="font-medium">{d.nome}</span>
                    <span className="ml-2 text-[#6b4a00]">{d.giorniSenzaOre.length} {d.giorniSenzaOre.length === 1 ? 'giorno' : 'giorni'}:</span>
                    <span className="ml-1 text-gray-600">{d.giorniSenzaOre.map((g) => formattaData(g).slice(0, 5)).join(', ')}</span>
                  </li>
                ))}
              </ul>
            )}
          </Pannello>
        )}

        {/* Ore del mese */}
        <Pannello titolo={`Ore di ${nomeMese(dati.oggi)}`}>
          <table className="cifre w-full text-sm">
            <thead className="text-xs uppercase text-gray-500">
              <tr>
                <th className="py-1 text-left">{admin ? 'Dipendente' : ''}</th>
                <th className="py-1 text-right">Lavorate</th>
                <th className="py-1 text-right">Attese</th>
                <th className="py-1 pl-3 text-left">Avanzamento</th>
              </tr>
            </thead>
            <tbody>
              {dati.perDipendente.map((d) => (
                <tr key={d.id} className="border-t border-gray-100">
                  <td className="py-1.5">{d.nome}</td>
                  <td className="py-1.5 text-right font-medium">{formattaOre(d.minutiLavorati)}</td>
                  <td className="py-1.5 text-right text-gray-600">{formattaOre(d.minutiAttesi)}</td>
                  <td className="py-1.5 pl-3">
                    <Barra lavorati={d.minutiLavorati} attesi={d.minutiAttesi} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {dati.perProgetto.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2 border-t border-gray-100 pt-3 text-sm">
              {dati.perProgetto.map((p) => (
                <span key={p.id} className="inline-flex items-center gap-1.5 rounded border border-gray-200 px-2 py-0.5" title={p.nome}>
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: coloreProgetto(p) }} />
                  {p.codice} <b className="cifre">{formattaOre(p.minuti)}</b>
                </span>
              ))}
            </div>
          )}
        </Pannello>

        {/* Prossimi giorni */}
        <Pannello titolo="In arrivo: assenze (14 giorni) e festività">
          {dati.prossimeAssenze.length === 0 && dati.prossimeFestivita.length === 0 && <p className="text-sm text-gray-500">Nessuna assenza o festività in programma.</p>}
          <ul className="divide-y divide-gray-100 text-sm">
            {dati.prossimeAssenze.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 py-1.5">
                <ChipAssenza tipo={a.tipo} />
                {admin && <span className="font-medium">{a.dipendente}</span>}
                <span className="text-gray-600">{periodo(a)}</span>
              </li>
            ))}
            {dati.prossimeFestivita.map((f) => (
              <li key={f.id} className="flex items-center gap-2 py-1.5">
                <span className="rounded px-1.5 py-0.5 text-xs" style={{ backgroundColor: COLORE_FESTIVITA.sfondo, color: COLORE_FESTIVITA.testo }}>
                  Festività
                </span>
                <span>{f.descrizione}</span>
                <span className="text-gray-600">{formattaData(f.data)}</span>
              </li>
            ))}
          </ul>
        </Pannello>
      </div>

      {editor && io && (
        <EditorGiornata
          dipendenteId={io.id}
          nomeDipendente={utente!.nomeVisualizzato}
          data={editor}
          onChiudi={() => setEditor(null)}
          onSalvato={() => {
            setEditor(null);
            ricarica();
          }}
        />
      )}
    </>
  );
}
