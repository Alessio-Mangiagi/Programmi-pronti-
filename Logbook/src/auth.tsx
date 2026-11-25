// "><(((º> sabusabu <º)))><"
/**
 * Stato del login condiviso da tutta l'interfaccia (React context).
 *
 * All'apertura chiede al server chi è collegato (GET /api/auth/io): il cookie di
 * sessione è HttpOnly, quindi il browser da solo non può saperlo. Espone login,
 * logout e `admin` per mostrare il menu giusto (la sicurezza vera resta sul server).
 *
 * Giorno 19 (24/11/2026): `oggi` è la data di Logbook (GET /api/oggi, orologio del server),
 * non quella del PC. Il calendario la usa per decidere cosa il dipendente può scrivere
 * (solo la giornata di oggi) e il Layout avvisa se il PC ha un'altra data. Si riallinea
 * ogni 5 minuti e quando si torna sulla finestra, così a mezzanotte "oggi" cambia da solo.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { oggiIso } from '../comune/date';
import { api, ErroreApi } from './api';
import type { UtenteCollegato } from './tipi';

type StatoAuth = {
  utente: UtenteCollegato | null;
  /** true finché non si sa ancora se c'è una sessione. */
  caricamento: boolean;
  admin: boolean;
  /** Data di Logbook "AAAA-MM-GG" (server); finché non arriva, quella del PC. */
  oggi: string;
  /** true se la data del PC non coincide con quella di Logbook. */
  orologioDiverso: boolean;
  /**
   * true se questo è la copia dimostrativa con i dati di esempio (npm run demo /
   * avvia-demo.bat, dal 25/11/2026): lo dice il server in GET /api/oggi, anche prima del login.
   */
  dimostrazione: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Rilegge l'utente collegato (dopo il cambio della password provvisoria, Giorno 24). */
  ricarica: () => Promise<void>;
};

const ContestoAuth = createContext<StatoAuth | null>(null);

/**
 * Prefisso delle chiavi di sessionStorage che ricordano "finestra delle segnalazioni già
 * mostrata" (componenti/Segnalazioni.tsx). Il login le toglie: a ogni accesso HR la rivede.
 */
export const PREFISSO_NOTIFICHE_MOSTRATE = 'logbook.segnalazioni.mostrate.';

export function FornitoreAuth({ children }: { children: ReactNode }) {
  const [utente, setUtente] = useState<UtenteCollegato | null>(null);
  const [caricamento, setCaricamento] = useState(true);
  const [oggiServer, setOggiServer] = useState<string | null>(null);
  // Data del PC al momento dell'ultimo allineamento (per l'avviso "data diversa").
  const [oggiPc, setOggiPc] = useState(oggiIso());
  const [dimostrazione, setDimostrazione] = useState(false);

  /** Chiede la data a Logbook; se il server non risponde resta l'ultima nota. */
  const allineaData = useCallback(async () => {
    try {
      const r = await api.get<{ oggi: string; adesso: string; dimostrazione?: boolean }>('/api/oggi');
      setOggiServer(r.oggi);
      setOggiPc(oggiIso());
      setDimostrazione(r.dimostrazione === true);
    } catch {
      /* server non raggiungibile: lo segnalano già le altre chiamate */
    }
  }, []);

  // Anche il titolo della scheda del browser distingue la copia dimostrativa dal Logbook vero.
  useEffect(() => {
    document.title = dimostrazione ? 'Logbook — copia dimostrativa' : 'Logbook — ore e presenze';
  }, [dimostrazione]);

  useEffect(() => {
    allineaData();
    const ogni5minuti = setInterval(allineaData, 5 * 60 * 1000);
    window.addEventListener('focus', allineaData);
    return () => {
      clearInterval(ogni5minuti);
      window.removeEventListener('focus', allineaData);
    };
  }, [allineaData]);

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
    // Giorno 20: a ogni accesso HR rivede la finestra delle segnalazioni aperte
    // (componenti/Segnalazioni.tsx la mostra una volta e lo ricorda in sessionStorage).
    try {
      for (const k of Object.keys(sessionStorage)) if (k.startsWith(PREFISSO_NOTIFICHE_MOSTRATE)) sessionStorage.removeItem(k);
    } catch {
      /* archivio del browser non disponibile */
    }
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
    <ContestoAuth.Provider
      value={{
        utente, caricamento, admin: utente?.ruolo === 'ADMIN', login, logout, ricarica,
        oggi: oggiServer ?? oggiPc,
        orologioDiverso: oggiServer !== null && oggiServer !== oggiPc,
        dimostrazione,
      }}
    >
      {children}
    </ContestoAuth.Provider>
  );
}

export function useAuth(): StatoAuth {
  const stato = useContext(ContestoAuth);
  if (!stato) throw new Error('useAuth usato fuori da <FornitoreAuth>');
  return stato;
}
