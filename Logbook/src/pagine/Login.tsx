// "><(((º> sabusabu <º)))><"
/**
 * Pagina di accesso nello stile Cosedil: pannello blu del marchio con logo della Suite e
 * motto aziendale a sinistra, modulo a destra (su schermi stretti solo il modulo).
 * Nome utente e password sono quelli propri di Logbook, non quelli del Portale.
 */
import { useState, type FormEvent } from 'react';
import { ErroreApi } from '../api';
import { useAuth } from '../auth';
import { FasciaDimostrazione } from '../componenti/FasciaDimostrazione';
import { Avviso, Campo, classiInput, Pulsante } from '../componenti/ui';

export function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errore, setErrore] = useState<string | null>(null);
  const [invio, setInvio] = useState(false);

  const entra = async (e: FormEvent) => {
    e.preventDefault();
    setInvio(true);
    setErrore(null);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setErrore(err instanceof ErroreApi ? err.message : 'Accesso non riuscito');
    } finally {
      setInvio(false);
    }
  };

  return (
    // Due pannelli in flexbox: affiancati da 768px, sul telefono resta il modulo con una
    // fascia blu del marchio in cima (il pannello grande a sinistra è nascosto).
    <div className="flex min-h-[100dvh] items-center justify-center bg-fondo p-3 sm:p-4">
      <div className="scheda flex w-full max-w-3xl flex-col overflow-hidden md:flex-row">
        <div className="flex items-center gap-3 bg-marchio px-5 py-4 text-white md:hidden">
          <img src="/logo-cosedil-chiaro.png" alt="" className="h-10 w-10 rounded-lg" />
          <div className="leading-tight">
            <div className="font-display text-xl font-medium">Logbook</div>
            <div className="font-ui text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-white/70">Suite Cosedil</div>
          </div>
        </div>
        <div className="relative hidden min-w-0 flex-[1.05_1_0%] flex-col justify-between gap-6 bg-marchio p-8 text-white md:flex">
          <div className="flex items-center gap-3">
            <img src="/logo-cosedil-chiaro.png" alt="" className="h-12 w-12 rounded-lg" />
            <div className="font-ui text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-white/70">Suite Cosedil</div>
          </div>
          <div>
            <div className="font-display text-4xl font-normal tracking-[-0.01em]">Logbook</div>
            <p className="mt-2 max-w-xs text-sm leading-relaxed text-white/80">Ore per cantiere e commessa, ferie, permessi e presenze del personale.</p>
          </div>
          <div className="font-display text-sm text-white/60">Costruiamo il tuo domani</div>
          <div className="absolute inset-x-0 bottom-0 h-1 bg-marchio-verde" />
        </div>
        <form onSubmit={entra} className="min-w-0 flex-1 space-y-4 p-5 sm:p-8">
          <div>
            <div className="sopratitolo">Accesso</div>
            <h1 className="font-display text-2xl font-normal text-testo-forte">Entra in Logbook</h1>
            <p className="mt-1 text-sm text-gray-500">Usa il nome utente e la password ricevuti da HR.</p>
          </div>
          {/* Solo nella copia dimostrativa (25/11/2026): si capisce prima ancora di entrare. */}
          <FasciaDimostrazione inScheda />
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
        </form>
      </div>
    </div>
  );
}
