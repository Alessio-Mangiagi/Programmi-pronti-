// "><(((º> sabusabu <º)))><"
/**
 * Pagina di accesso: nome utente e password propri di Logbook (non quelli del Portale).
 */
import { useState, type FormEvent } from 'react';
import { ErroreApi } from '../api';
import { useAuth } from '../auth';
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
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm overflow-hidden rounded border border-gray-200 bg-white shadow-sm">
        <div className="bg-marchio px-6 py-5 text-white">
          <div className="text-2xl font-semibold tracking-wide">Logbook</div>
          <div className="text-sm text-white/75">Ore e presenze dipendenti</div>
        </div>
        <form onSubmit={entra} className="space-y-4 px-6 py-5">
          {errore && <Avviso tipo="errore">{errore}</Avviso>}
          <Campo etichetta="Nome utente">
            <input autoFocus autoComplete="username" className={classiInput()} value={username} onChange={(e) => setUsername(e.target.value)} />
          </Campo>
          <Campo etichetta="Password">
            <input type="password" autoComplete="current-password" className={classiInput()} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Campo>
          <Pulsante type="submit" variante="primario" className="w-full py-2" disabled={invio || !username || !password}>
            {invio ? 'Accesso in corso…' : 'Accedi'}
          </Pulsante>
        </form>
      </div>
    </div>
  );
}
