// "><(((º> sabusabu <º)))><"
/**
 * Pagina di accesso nello stile Cosedil: pannello blu del marchio con logo della Suite e
 * motto aziendale a sinistra, modulo a destra (su schermi stretti solo il modulo).
 * Nome utente e password sono quelli propri di Copilota, non quelli del Portale.
 *
 * Giorno 34 (25/11/2026):
 * - per un amministratore che entra da un PC non ancora riconosciuto, dopo la password
 *   compare un secondo passo: il codice di 6 cifre ricevuto per email (server/rotte/auth.ts).
 *   Dopo il codice quel PC resta riconosciuto per 30 giorni;
 * - se la sessione si è chiusa da sola dopo 15 minuti senza fare nulla, lo si dice
 *   (auth.tsx lo ricorda in sessionStorage con la chiave CHIAVE_INATTIVITA).
 */
import { useState, type FormEvent } from 'react';
import { ErroreApi } from '../api';
import { CHIAVE_INATTIVITA, useAuth } from '../auth';
import { PasswordDimenticata } from '../componenti/PasswordDimenticata';
import { Avviso, Campo, classiInput, Pulsante } from '../componenti/ui';

/** Legge e toglie il segno "sessione chiusa per inattività": il messaggio compare una volta sola. */
function chiusaPerInattivita(): boolean {
  try {
    const si = sessionStorage.getItem(CHIAVE_INATTIVITA) === '1';
    sessionStorage.removeItem(CHIAVE_INATTIVITA);
    return si;
  } catch {
    return false;
  }
}

export function Login() {
  const { login, confermaCodice } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errore, setErrore] = useState<string | null>(null);
  const [invio, setInvio] = useState(false);
  const [inattivita] = useState(chiusaPerInattivita);
  /** Valorizzato quando il server ha mandato il codice: indirizzo (mascherato) a cui è andato. */
  const [codiceInviatoA, setCodiceInviatoA] = useState<string | null>(null);
  const [codice, setCodice] = useState('');
  // Giorno 40: modulo "Password dimenticata" al posto dell'accesso; al ritorno, il messaggio di esito.
  const [dimenticata, setDimenticata] = useState(false);
  const [esito, setEsito] = useState<string | null>(null);

  const entra = async (e: FormEvent) => {
    e.preventDefault();
    setInvio(true);
    setErrore(null);
    try {
      const attesa = await login(username.trim(), password);
      if (attesa) {
        setCodiceInviatoA(attesa.inviatoA);
        setCodice('');
      }
    } catch (err) {
      setErrore(err instanceof ErroreApi ? err.message : 'Accesso non riuscito');
    } finally {
      setInvio(false);
    }
  };

  const conferma = async (e: FormEvent) => {
    e.preventDefault();
    setInvio(true);
    setErrore(null);
    try {
      await confermaCodice(codice);
    } catch (err) {
      setErrore(err instanceof ErroreApi ? err.message : 'Codice non accettato');
    } finally {
      setInvio(false);
    }
  };

  const daCapo = () => {
    setCodiceInviatoA(null);
    setPassword('');
    setErrore(null);
  };

  return (
    // Due pannelli in flexbox: affiancati da 768px, sul telefono resta il modulo con una
    // fascia blu del marchio in cima (il pannello grande a sinistra è nascosto).
    <div className="flex min-h-[100dvh] items-center justify-center bg-fondo p-3 sm:p-4">
      <div className="scheda flex w-full max-w-3xl flex-col overflow-hidden md:flex-row">
        <div className="flex items-center gap-3 bg-marchio px-5 py-4 text-white md:hidden">
          <img src="/logo-cosedil-chiaro.png" alt="" className="h-10 w-10 rounded-lg" />
          <div className="leading-tight">
            <div className="font-display text-xl font-medium">Copilota</div>
            <div className="font-ui text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-white/70">Suite Cosedil</div>
          </div>
        </div>
        <div className="relative hidden min-w-0 flex-[1.05_1_0%] flex-col justify-between gap-6 bg-marchio p-8 text-white md:flex">
          <div className="flex items-center gap-3">
            <img src="/logo-cosedil-chiaro.png" alt="" className="h-12 w-12 rounded-lg" />
            <div className="font-ui text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-white/70">Suite Cosedil</div>
          </div>
          <div>
            <div className="font-display text-4xl font-normal tracking-[-0.01em]">Copilota</div>
            <p className="mt-2 max-w-xs text-sm leading-relaxed text-white/80">Ore per cantiere e commessa, ferie, permessi e presenze del personale.</p>
          </div>
          <div className="font-display text-sm text-white/60">Costruiamo il tuo domani</div>
          <div className="absolute inset-x-0 bottom-0 h-1 bg-marchio-verde" />
        </div>
        {dimenticata ? (
          <PasswordDimenticata
            usernameIniziale={username}
            onFine={(messaggio) => {
              setDimenticata(false);
              setEsito(messaggio ?? null);
              setPassword('');
              setErrore(null);
            }}
          />
        ) : codiceInviatoA === null ? (
          <form onSubmit={entra} className="min-w-0 flex-1 space-y-4 p-5 sm:p-8">
            <div>
              <div className="sopratitolo">Accesso</div>
              <h1 className="font-display text-2xl font-normal text-testo-forte">Entra in Copilota</h1>
              <p className="mt-1 text-sm text-gray-500">Usa il nome utente e la password ricevuti da HR.</p>
            </div>
            {inattivita && !errore && <Avviso tipo="info">Sessione chiusa dopo 15 minuti senza attività. Entra di nuovo per continuare.</Avviso>}
            {esito && !errore && <Avviso tipo="successo">{esito}</Avviso>}
            {errore && <Avviso tipo="errore">{errore}</Avviso>}
            <Campo etichetta="Nome utente">
              <input autoFocus autoComplete="username" className={classiInput()} value={username} onChange={(e) => setUsername(e.target.value)} />
            </Campo>
            <Campo etichetta="Password">
              <input type="password" autoComplete="current-password" className={classiInput()} value={password} onChange={(e) => setPassword(e.target.value)} />
            </Campo>
            <Pulsante type="submit" variante="primario" className="w-full py-2.5" disabled={invio || !username || !password}>
              {invio ? 'Accesso in corso…' : 'Accedi'}
            </Pulsante>
            <button type="button" className="text-sm text-marchio underline-offset-2 hover:underline" onClick={() => { setDimenticata(true); setEsito(null); setErrore(null); }}>
              Password dimenticata?
            </button>
          </form>
        ) : (
          <form onSubmit={conferma} className="min-w-0 flex-1 space-y-4 p-5 sm:p-8">
            <div>
              <div className="sopratitolo">Secondo passo</div>
              <h1 className="font-display text-2xl font-normal text-testo-forte">Codice di accesso</h1>
              <p className="mt-1 text-sm text-gray-500">
                Abbiamo mandato un codice di 6 cifre a <b>{codiceInviatoA}</b>. Vale 10 minuti. Su questo PC non verrà più chiesto per 30 giorni.
              </p>
            </div>
            {errore && <Avviso tipo="errore">{errore}</Avviso>}
            <Campo etichetta="Codice ricevuto per email">
              <input
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                className={classiInput()}
                value={codice}
                onChange={(e) => setCodice(e.target.value.replace(/\D/g, ''))}
                placeholder="6 cifre"
              />
            </Campo>
            <Pulsante type="submit" variante="primario" className="w-full py-2.5" disabled={invio || codice.length !== 6}>
              {invio ? 'Controllo…' : 'Entra'}
            </Pulsante>
            <Pulsante className="w-full" onClick={daCapo} disabled={invio}>
              Torna al login
            </Pulsante>
          </form>
        )}
      </div>
    </div>
  );
}
