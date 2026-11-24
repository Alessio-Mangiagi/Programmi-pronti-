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
 *
 * Ogni voce porta al suo elemento (richiesta del 24/11/2026):
 * - richieste e assenze in arrivo → Assenze con quella richiesta aperta (?apri=<id>);
 * - giorni senza ore → Calendario di quel dipendente; il singolo giorno apre l'editor
 *   (?dipendente=&data=&giorno=);
 * - ore del mese per dipendente → Calendario filtrato su di lui;
 * - progetti → scheda del progetto (HR) o Calendario filtrato sul progetto (dipendente);
 * - festività → scheda Festività (HR) o Calendario su quel giorno (dipendente).
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

/**
 * Riquadro numerico in cima alla pagina; `allarme` lo colora quando c'è da intervenire.
 * `a` = pagina a cui porta il clic; `vai` = azione sulla pagina stessa (es. scorrere al pannello).
 */
function Tessera({ titolo, valore, dettaglio, allarme, a, vai }: { titolo: string; valore: string; dettaglio?: string; allarme?: boolean; a?: string; vai?: () => void }) {
  const cliccabile = Boolean(a || vai);
  const corpo = (
    <div className={`scheda h-full border-t-[3px] px-3 py-3 sm:px-4 ${allarme ? '!border-t-[#e9c46a] !bg-[#fdf8eb]' : '!border-t-marchio'} ${cliccabile ? 'scheda-attiva' : ''}`}>
      <div className="sopratitolo !text-gray-500">{titolo}</div>
      <div className={`cifre font-display text-[1.5rem] font-medium leading-tight sm:text-[1.75rem] ${allarme ? 'text-[#6b4a00]' : 'text-marchio'}`}>{valore}</div>
      {dettaglio && <div className="text-xs text-gray-500">{dettaglio}</div>}
    </div>
  );
  // Il riquadro è un figlio del contenitore flex: parte da 10rem e cresce fino a riempire la riga.
  const classi = 'min-w-0 flex-[1_1_10rem]';
  if (a) return <Link to={a} className={classi}>{corpo}</Link>;
  if (vai) return <button type="button" onClick={vai} className={`${classi} text-left`}>{corpo}</button>;
  return <div className={classi}>{corpo}</div>;
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

function Pannello({ titolo, azione, children, id }: { titolo: string; azione?: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="scheda min-w-0 flex-[1_1_30rem] scroll-mt-20">
      <div className="flex flex-wrap items-center justify-between gap-x-3 border-b border-gray-100 px-4 py-2">
        <h2 className="font-display text-[0.98rem] font-medium text-marchio">{titolo}</h2>
        {azione}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

/** Riga di elenco che porta a un'altra pagina: tutta la riga è cliccabile. */
const RigaLink = ({ a, children }: { a: string; children: React.ReactNode }) => (
  <li>
    <Link to={a} className="-mx-1 flex flex-wrap items-center gap-2 rounded px-1 py-1.5 transition-colors hover:bg-ghiaccio focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marchio-chiaro">
      {children}
    </Link>
  </li>
);

/** Stile dei collegamenti dentro il testo (nomi, giorni). */
const LINK = 'rounded text-marchio hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marchio-chiaro';

/** Porta al pannello dei giorni senza ore (stessa pagina). */
const scorriAiGiorni = () => document.getElementById('giorni-senza-ore')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

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
          vai={giorniMancanti > 0 ? scorriAiGiorni : undefined}
        />
        <Tessera titolo="Assenti oggi" valore={String(assentiOggi.length)} dettaglio={assentiOggi.map((a) => a.dipendente).join(', ') || 'nessuno'} a={admin ? '/assenze?scheda=tutte' : '/assenze'} />
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
                  <RigaLink key={a.id} a={`/assenze?apri=${a.id}`}>
                    <ChipAssenza tipo={a.tipo} />
                    <span className="font-medium text-marchio">{a.dipendente}</span>
                    <span className="text-gray-600">{periodo(a)}</span>
                    <span className="ml-auto text-xs text-gray-400">chiesta il {formattaData(a.creatoIl.slice(0, 10))}</span>
                  </RigaLink>
                ))}
              </ul>
            )}
          </Pannello>
        ) : (
          <Pannello titolo="Giorni da registrare" id="giorni-senza-ore">
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
          <Pannello titolo="Giorni lavorativi senza ore (fino a ieri)" id="giorni-senza-ore">
            {conGiorniMancanti.length === 0 ? (
              <p className="text-sm text-gray-500">Tutti i dipendenti hanno registrato le ore.</p>
            ) : (
              <ul className="divide-y divide-gray-100 text-sm">
                {conGiorniMancanti.map((d) => (
                  <li key={d.id} className="py-1.5">
                    {/* Nome → calendario del dipendente sul primo giorno mancante; giorno → editor di quel giorno. */}
                    <Link className={`font-medium ${LINK}`} to={`/calendario?dipendente=${d.id}&data=${d.giorniSenzaOre[0]}`}>
                      {d.nome}
                    </Link>
                    <span className="ml-2 text-[#6b4a00]">{d.giorniSenzaOre.length} {d.giorniSenzaOre.length === 1 ? 'giorno' : 'giorni'}:</span>{' '}
                    {d.giorniSenzaOre.map((g, i) => (
                      <span key={g}>
                        {i > 0 && ', '}
                        <Link className={LINK} to={`/calendario?dipendente=${d.id}&data=${g}&giorno=${g}`} title={`Registra le ore del ${formattaData(g)}`}>
                          {formattaData(g).slice(0, 5)}
                        </Link>
                      </span>
                    ))}
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
                  <td className="py-1.5">
                    <Link className={LINK} to={admin ? `/calendario?dipendente=${d.id}` : '/calendario'}>
                      {d.nome}
                    </Link>
                  </td>
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
                <Link
                  key={p.id}
                  to={admin ? `/progetti?apri=${p.id}` : `/calendario?progetto=${p.id}`}
                  className="inline-flex items-center gap-1.5 rounded border border-gray-200 px-2 py-0.5 transition-colors hover:border-marchio hover:bg-ghiaccio focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marchio-chiaro"
                  title={admin ? `Apri il progetto ${p.nome}` : `Le tue ore su ${p.nome}`}
                >
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: coloreProgetto(p) }} />
                  {p.codice} <b className="cifre">{formattaOre(p.minuti)}</b>
                </Link>
              ))}
            </div>
          )}
        </Pannello>

        {/* Prossimi giorni */}
        <Pannello titolo="In arrivo: assenze (14 giorni) e festività">
          {dati.prossimeAssenze.length === 0 && dati.prossimeFestivita.length === 0 && <p className="text-sm text-gray-500">Nessuna assenza o festività in programma.</p>}
          <ul className="divide-y divide-gray-100 text-sm">
            {dati.prossimeAssenze.map((a) => (
              <RigaLink key={a.id} a={`/assenze?apri=${a.id}`}>
                <ChipAssenza tipo={a.tipo} />
                {admin && <span className="font-medium text-marchio">{a.dipendente}</span>}
                <span className="text-gray-600">{periodo(a)}</span>
              </RigaLink>
            ))}
            {dati.prossimeFestivita.map((f) => (
              <RigaLink key={f.id} a={admin ? '/assenze?scheda=festivita' : `/calendario?data=${f.data}`}>
                <span className="rounded px-1.5 py-0.5 text-xs" style={{ backgroundColor: COLORE_FESTIVITA.sfondo, color: COLORE_FESTIVITA.testo }}>
                  Festività
                </span>
                <span>{f.descrizione}</span>
                <span className="text-gray-600">{formattaData(f.data)}</span>
              </RigaLink>
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
