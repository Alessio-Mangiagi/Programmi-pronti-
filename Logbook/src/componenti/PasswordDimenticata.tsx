// "><(((º> sabusabu <º)))><"
/**
 * "Password dimenticata" (Giorno 40, 26/11/2026), dentro la pagina di accesso.
 *
 * Due passi, senza passare da HR:
 * 1. il nome utente → Copilota manda un codice di 6 cifre all'email dell'account (quella in
 *    anagrafica). La risposta è sempre la stessa, che l'account esista o no: non si può
 *    usare questo modulo per scoprire i nomi utente;
 * 2. codice + password nuova (scritta due volte). Poi si torna all'accesso.
 *
 * Chi non ha un'email in anagrafica non riceve nulla e deve chiedere a HR, come prima.
 * API: POST /api/auth/dimenticata e /api/auth/reimposta (server/rotte/auth.ts).
 */
import { useState, type FormEvent } from 'react';
import { api, ErroreApi } from '../api';
import { Avviso, Campo, classiInput, Pulsante } from './ui';

export function PasswordDimenticata({ usernameIniziale, onFine }: { usernameIniziale: string; onFine: (messaggio?: string) => void }) {
  const [passo, setPasso] = useState<'nome' | 'codice'>('nome');
  const [username, setUsername] = useState(usernameIniziale);
  const [codice, setCodice] = useState('');
  const [nuova, setNuova] = useState('');
  const [ripeti, setRipeti] = useState('');
  const [info, setInfo] = useState<string | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [invio, setInvio] = useState(false);

  const esegui = async (azione: () => Promise<void>) => {
    setErrore(null);
    setInvio(true);
    try {
      await azione();
    } catch (err) {
      setErrore(err instanceof ErroreApi ? err.message : 'Operazione non riuscita: riprova');
    } finally {
      setInvio(false);
    }
  };

  const chiedi = (e: FormEvent) => {
    e.preventDefault();
    void esegui(async () => {
      const r = await api.post<{ messaggio: string }>('/api/auth/dimenticata', { username: username.trim() });
      setInfo(r.messaggio);
      setPasso('codice');
    });
  };

  const cambia = (e: FormEvent) => {
    e.preventDefault();
    if (nuova !== ripeti) {
      setErrore('Le due password non coincidono');
      return;
    }
    void esegui(async () => {
      await api.post('/api/auth/reimposta', { username: username.trim(), codice, nuova });
      onFine('Password cambiata. Ora entra con la password nuova.');
    });
  };

  const indietro = (
    <button type="button" className="text-sm text-marchio underline-offset-2 hover:underline" onClick={() => onFine()}>
      Torna all'accesso
    </button>
  );

  if (passo === 'nome') {
    return (
      <form onSubmit={chiedi} className="min-w-0 flex-1 space-y-4 p-5 sm:p-8">
        <div>
          <div className="sopratitolo">Password dimenticata</div>
          <h1 className="font-display text-2xl font-normal text-testo-forte">Scegli una password nuova</h1>
          <p className="mt-1 text-sm text-gray-500">Scrivi il tuo nome utente: ti mandiamo un codice all'email che HR ha in anagrafica.</p>
        </div>
        {errore && <Avviso tipo="errore">{errore}</Avviso>}
        <Campo etichetta="Nome utente">
          <input autoFocus autoComplete="username" className={classiInput()} value={username} onChange={(e) => setUsername(e.target.value)} />
        </Campo>
        <Pulsante type="submit" variante="primario" className="w-full py-2.5" disabled={invio || !username.trim()}>
          {invio ? 'Invio in corso…' : 'Mandami il codice'}
        </Pulsante>
        {indietro}
      </form>
    );
  }

  return (
    <form onSubmit={cambia} className="min-w-0 flex-1 space-y-4 p-5 sm:p-8">
      <div>
        <div className="sopratitolo">Password dimenticata</div>
        <h1 className="font-display text-2xl font-normal text-testo-forte">Codice e password nuova</h1>
      </div>
      {info && !errore && <Avviso tipo="info">{info}</Avviso>}
      {errore && <Avviso tipo="errore">{errore}</Avviso>}
      <Campo etichetta="Codice ricevuto per email">
        <input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} className={classiInput()} value={codice} onChange={(e) => setCodice(e.target.value.replace(/\D/g, ''))} placeholder="6 cifre" />
      </Campo>
      <Campo etichetta="Password nuova" aiuto="Almeno 8 caratteri con lettere e numeri (12 per gli amministratori)">
        <input type="password" autoComplete="new-password" className={classiInput()} value={nuova} onChange={(e) => setNuova(e.target.value)} />
      </Campo>
      <Campo etichetta="Ripeti la password nuova">
        <input type="password" autoComplete="new-password" className={classiInput()} value={ripeti} onChange={(e) => setRipeti(e.target.value)} />
      </Campo>
      <Pulsante type="submit" variante="primario" className="w-full py-2.5" disabled={invio || codice.length !== 6 || !nuova || !ripeti}>
        {invio ? 'Salvataggio…' : 'Cambia password'}
      </Pulsante>
      <div className="flex flex-wrap justify-between gap-2">
        <button type="button" className="text-sm text-marchio underline-offset-2 hover:underline" onClick={() => { setPasso('nome'); setCodice(''); setErrore(null); }}>
          Non è arrivato: chiedi un altro codice
        </button>
        {indietro}
      </div>
    </form>
  );
}
