// "><(((º> sabusabu <º)))><"
/**
 * Elenco dei progetti.
 *
 * - HR: tutti i progetti, con ricerca a caratteri e filtro di stato; "Nuovo progetto" e il
 *   clic su una riga aprono la pagina del progetto (/progetti/nuovo, /progetti/:id) con
 *   dati, dipendenti assegnati, documentazione e note (Giorno 17, 24/11/2026: prima era
 *   una finestra).
 * - Dipendente ("I miei progetti"): solo i progetti a cui è assegnato; dalla pagina del
 *   progetto carica la documentazione di avanzamento (risposta 2c).
 *
 * `?apri=<id>` (link dalla Dashboard) porta direttamente alla pagina del progetto.
 */
import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { formattaData } from '../../comune/date';
import { formattaOre } from '../../comune/orari';
import { STATI_PROGETTO } from '../../comune/schemi';
import { useAuth } from '../auth';
import { coloreProgetto } from '../colori';
import { Tabella, type Colonna } from '../componenti/Tabella';
import { Avviso, Caricamento, Etichetta, IntestazionePagina, Pulsante } from '../componenti/ui';
import type { Progetto } from '../tipi';
import { usaDati } from '../usaDati';
import { ETICHETTE_STATO_PROGETTO } from './SchedaProgetto';

export function Progetti() {
  const { admin, utente } = useAuth();
  const naviga = useNavigate();
  const [parametri] = useSearchParams();
  // Il dipendente vede solo i suoi progetti (il server rifiuta comunque quelli degli altri).
  const { dati, errore, caricamento } = usaDati<Progetto[]>(admin ? '/api/progetti' : `/api/progetti?assegnatiA=${utente?.dipendenteId ?? 0}`);
  const [filtroStato, setFiltroStato] = useState<Progetto['stato'] | ''>(admin ? '' : 'ATTIVO');

  const daAprire = Number(parametri.get('apri')) || null;
  if (daAprire) return <Navigate to={`/progetti/${daAprire}`} replace />;

  const colonne: Colonna<Progetto>[] = [
    {
      chiave: 'codice',
      titolo: 'Codice',
      valore: (p) => p.codice,
      render: (p) => (
        <span className="inline-flex items-center gap-2 font-medium">
          <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: coloreProgetto(p) }} />
          {p.codice}
        </span>
      ),
    },
    { chiave: 'nome', titolo: 'Nome', valore: (p) => p.nome, principale: true },
    { chiave: 'cliente', titolo: 'Cliente', valore: (p) => p.cliente },
    { chiave: 'inizio', titolo: 'Inizio', valore: (p) => p.dataInizio, render: (p) => formattaData(p.dataInizio) },
    { chiave: 'fine', titolo: 'Fine', valore: (p) => p.dataFine, render: (p) => (p.dataFine ? formattaData(p.dataFine) : '—') },
    ...(admin
      ? ([
          {
            chiave: 'max',
            titolo: 'Max ore/giorno',
            valore: (p) => p.maxMinutiGiorno,
            render: (p) => (p.maxMinutiGiorno != null ? formattaOre(p.maxMinutiGiorno) : <span className="text-gray-400">nessun limite</span>),
            allinea: 'destra',
          },
          {
            chiave: 'assegnati',
            titolo: 'Dipendenti',
            valore: (p) => p.assegnati ?? 0,
            render: (p) => (p.assegnati ? p.assegnati : <span className="text-[#8e2a1f]" title="Nessuno può registrare ore">nessuno</span>),
            allinea: 'destra',
          },
        ] satisfies Colonna<Progetto>[])
      : []),
    {
      chiave: 'stato',
      titolo: 'Stato',
      valore: (p) => p.stato,
      render: (p) => <Etichetta colore={ETICHETTE_STATO_PROGETTO[p.stato].colore}>{ETICHETTE_STATO_PROGETTO[p.stato].testo}</Etichetta>,
    },
  ];

  return (
    <>
      <IntestazionePagina
        titolo={admin ? 'Progetti' : 'I miei progetti'}
        sottotitolo={admin ? 'Progetti e commesse: dati, dipendenti assegnati, documentazione e note' : 'I progetti a cui sei assegnato: apri un progetto per caricare la documentazione di avanzamento'}
        azioni={
          admin && (
            <Pulsante variante="primario" onClick={() => naviga('/progetti/nuovo')}>
              + Nuovo progetto
            </Pulsante>
          )
        }
      />
      {errore && <Avviso tipo="errore">{errore}</Avviso>}
      {caricamento && !dati && <Caricamento />}
      {dati && (
        <Tabella
          righe={dati.filter((p) => !filtroStato || p.stato === filtroStato)}
          colonne={colonne}
          chiaveRiga={(p) => p.id}
          testoRicerca={(p) => `${p.codice} ${p.nome} ${p.cliente ?? ''} ${p.descrizione ?? ''} ${p.commessaSkytower ?? ''}`}
          onRiga={(p) => naviga(`/progetti/${p.id}`)}
          ordinamentoIniziale={{ chiave: 'codice', verso: 1 }}
          vuoto={admin ? 'Nessun progetto' : 'Non sei assegnato a nessun progetto: rivolgiti a HR'}
          strumenti={
            <select aria-label="Filtra per stato" className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm" value={filtroStato} onChange={(e) => setFiltroStato(e.target.value as typeof filtroStato)}>
              <option value="">Tutti gli stati</option>
              {STATI_PROGETTO.map((s) => (
                <option key={s} value={s}>
                  {ETICHETTE_STATO_PROGETTO[s].testo}
                </option>
              ))}
            </select>
          }
        />
      )}
    </>
  );
}
