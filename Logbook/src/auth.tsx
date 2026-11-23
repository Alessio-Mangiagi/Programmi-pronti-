// "><(((º> sabusabu <º)))><"
/**
 * Stato del login condiviso da tutta l'interfaccia (React context).
 *
 * All'apertura chiede al server chi è collegato (GET /api/auth/io): il cookie di
 * sessione è HttpOnly, quindi il browser da solo non può saperlo. Espone login,
 * logout e `admin` per mostrare il menu giusto (la sicurezza vera resta sul server).
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ErroreApi } from './api';
import type { UtenteCollegato } from './tipi';

type StatoAuth = {
  utente: UtenteCollegato | null;
  /** true finché non si sa ancora se c'è una sessione. */
  caricamento: boolean;
  admin: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const ContestoAuth = createContext<StatoAuth | null>(null);

export function FornitoreAuth({ children }: { children: ReactNode }) {
  const [utente, setUtente] = useState<UtenteCollegato | null>(null);
  const [caricamento, setCaricamento] = useState(true);

  const ricarica = useCallback(async () => {
    try {
      setUtente(await api.get<UtenteCollegato>('/api/auth/io'));
    } catch (e) {
      if (!(e instanceof ErroreApi) || e.stato !== 401) console.error(e);
      setUtente(null);
    } finally {
      setCaricamento(false);
    }
  }, []);

  useEffect(() => {
    ricarica();
    // Sessione scaduta durante l'uso (un'API ha risposto 401): si torna al login.
    const scaduta = () => setUtente(null);
    window.addEventListener('logbook:sessione-scaduta', scaduta);
    return () => window.removeEventListener('logbook:sessione-scaduta', scaduta);
  }, [ricarica]);

  const login = async (username: string, password: string) => {
    await api.post('/api/auth/login', { username, password });
    await ricarica();
  };

  const logout = async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      setUtente(null);
    }
  };

  return (
    <ContestoAuth.Provider value={{ utente, caricamento, admin: utente?.ruolo === 'ADMIN', login, logout }}>
      {children}
    </ContestoAuth.Provider>
  );
}

export function useAuth(): StatoAuth {
  const stato = useContext(ContestoAuth);
  if (!stato) throw new Error('useAuth usato fuori da <FornitoreAuth>');
  return stato;
}
