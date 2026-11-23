// "><(((º> sabusabu <º)))><"
/**
 * Elenco dei dipendenti (solo HR): ricerca per nome, matricola, codice fiscale, mansione
 * o reparto; filtro attivi/cessati; clic su una riga per aprire la scheda.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formattaEuro } from '../../comune/importi';
import { ETICHETTE_CONTRATTO } from '../../comune/schemi';
import { Tabella, type Colonna } from '../componenti/Tabella';
import { Avviso, Caricamento, Etichetta, IntestazionePagina, Pulsante } from '../componenti/ui';
import type { Dipendente } from '../tipi';
import { usaDati } from '../usaDati';

const COLONNE: Colonna<Dipendente>[] = [
  { chiave: 'matricola', titolo: 'Matricola', valore: (d) => d.matricola },
  { chiave: 'nome', titolo: 'Cognome e nome', valore: (d) => `${d.cognome} ${d.nome}`, render: (d) => <span className="font-medium">{d.cognome} {d.nome}</span> },
  { chiave: 'cf', titolo: 'Codice fiscale', valore: (d) => d.codiceFiscale, classe: 'font-mono text-xs' },
  { chiave: 'mansione', titolo: 'Mansione', valore: (d) => d.mansione },
  { chiave: 'reparto', titolo: 'Reparto', valore: (d) => d.reparto },
  { chiave: 'contratto', titolo: 'Contratto', valore: (d) => ETICHETTE_CONTRATTO[d.tipoContratto] },
  { chiave: 'ore', titolo: 'Ore sett.', valore: (d) => d.oreSettimanali, allinea: 'destra' },
  { chiave: 'lordo', titolo: 'Costo orario lordo', valore: (d) => d.costoOrarioLordoCent ?? null, render: (d) => formattaEuro(d.costoOrarioLordoCent), allinea: 'destra' },
  {
    chiave: 'account',
    titolo: 'Account',
    valore: (d) => d.utente?.username ?? null,
    render: (d) => (d.utente ? <span className={d.utente.attivo ? '' : 'text-gray-400 line-through'}>{d.utente.username}</span> : <span className="text-gray-400">—</span>),
  },
  {
    chiave: 'stato',
    titolo: 'Stato',
    valore: (d) => d.stato,
    render: (d) => (d.stato === 'ATTIVO' ? <Etichetta colore="verde">Attivo</Etichetta> : <Etichetta colore="grigio">Cessato</Etichetta>),
  },
];

export function Dipendenti() {
  const naviga = useNavigate();
  const { dati, errore, caricamento } = usaDati<Dipendente[]>('/api/dipendenti');
  const [filtroStato, setFiltroStato] = useState<'ATTIVO' | 'CESSATO' | ''>('ATTIVO');

  const righe = (dati ?? []).filter((d) => !filtroStato || d.stato === filtroStato);

  return (
    <>
      <IntestazionePagina
        titolo="Dipendenti"
        sottotitolo="Anagrafica, contratto, costi orari e account di accesso"
        azioni={
          <Pulsante variante="primario" onClick={() => naviga('/dipendenti/nuovo')}>
            + Nuovo dipendente
          </Pulsante>
        }
      />
      {errore && <Avviso tipo="errore">{errore}</Avviso>}
      {caricamento && !dati && <Caricamento />}
      {dati && (
        <Tabella
          righe={righe}
          colonne={COLONNE}
          chiaveRiga={(d) => d.id}
          testoRicerca={(d) => `${d.nome} ${d.cognome} ${d.matricola} ${d.codiceFiscale} ${d.mansione ?? ''} ${d.reparto ?? ''} ${d.email ?? ''}`}
          onRiga={(d) => naviga(`/dipendenti/${d.id}`)}
          ordinamentoIniziale={{ chiave: 'nome', verso: 1 }}
          vuoto="Nessun dipendente"
          strumenti={
            <select
              aria-label="Filtra per stato"
              className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
              value={filtroStato}
              onChange={(e) => setFiltroStato(e.target.value as typeof filtroStato)}
            >
              <option value="ATTIVO">Solo attivi</option>
              <option value="CESSATO">Solo cessati</option>
              <option value="">Tutti</option>
            </select>
          }
        />
      )}
    </>
  );
}
