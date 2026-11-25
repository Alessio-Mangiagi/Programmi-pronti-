// "><(((º> sabusabu <º)))><"
/**
 * "Amministratori" dentro il riquadro Dati del programma (Giorno 34, 25/11/2026: il primo
 * amministratore nasce all'installazione "e poi solo lui possa dare quel ruolo").
 *
 * Solo il proprietario lo vede (lo mostra DatiProgramma.tsx) e solo a lui il server risponde
 * (GET /api/proprietario/account, PUT /api/proprietario/account/:id/ruolo). Elenca gli
 * account attivi: accanto a ciascuno "Rendi amministratore" o "Togli il ruolo". Il
 * proprietario resta sempre amministratore. Chi cambia ruolo viene scollegato e rientra con
 * i nuovi poteri; il cambio finisce nel registro attività.
 */
import { useState } from 'react';
import { api, ErroreApi } from '../api';
import { usaDati } from '../usaDati';
import { Avviso, Etichetta, Pulsante } from './ui';

type Account = { id: number; username: string; ruolo: 'ADMIN' | 'DIPENDENTE'; attivo: boolean; nome: string | null; proprietario: boolean };

export function AccountAmministratori() {
  const { dati, ricarica } = usaDati<Account[]>('/api/proprietario/account');
  const [errore, setErrore] = useState<string | null>(null);
  const [lavoro, setLavoro] = useState<number | null>(null);
  if (!dati) return null;

  const cambia = async (a: Account) => {
    const nuovo = a.ruolo === 'ADMIN' ? 'DIPENDENTE' : 'ADMIN';
    const domanda =
      nuovo === 'ADMIN'
        ? `Rendere amministratore ${a.username}? Vedrà e modificherà i dati di tutti i dipendenti.`
        : `Togliere il ruolo di amministratore a ${a.username}?`;
    if (!window.confirm(domanda)) return;
    setLavoro(a.id);
    setErrore(null);
    try {
      await api.put(`/api/proprietario/account/${a.id}/ruolo`, { ruolo: nuovo });
      await ricarica();
    } catch (e) {
      setErrore(e instanceof ErroreApi ? e.message : 'Operazione non riuscita');
    } finally {
      setLavoro(null);
    }
  };

  const attivi = dati.filter((a) => a.attivo);
  return (
    <div className="space-y-2 border-t border-gray-100 pt-3">
      <h3 className="font-ui text-sm font-semibold text-testo-forte">Amministratori</h3>
      <p className="text-sm text-gray-600">Solo tu puoi dare o togliere il ruolo di amministratore. Gli account dei dipendenti si creano dalla loro scheda.</p>
      {errore && <Avviso tipo="errore">{errore}</Avviso>}
      <ul className="divide-y divide-gray-100 text-sm">
        {attivi.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-2 py-1.5">
            <span className="min-w-0 flex-1 truncate">
              <b className="font-semibold text-testo-forte">{a.username}</b>
              {a.nome && <span className="text-gray-600"> · {a.nome}</span>}
            </span>
            {a.proprietario ? <Etichetta colore="blu">Proprietario</Etichetta> : a.ruolo === 'ADMIN' ? <Etichetta colore="verde">Amministratore</Etichetta> : null}
            {!a.proprietario && (
              <Pulsante variante={a.ruolo === 'ADMIN' ? 'pericolo' : 'secondario'} onClick={() => cambia(a)} disabled={lavoro !== null}>
                {a.ruolo === 'ADMIN' ? 'Togli il ruolo' : 'Rendi amministratore'}
              </Pulsante>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
