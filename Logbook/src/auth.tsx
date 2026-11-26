// "><(((º> sabusabu <º)))><"
/**
 * Stato del login condiviso da tutta l'interfaccia (React context).
 *
 * All'apertura chiede al server chi è collegato (GET /api/auth/io): il cookie di
 * sessione è HttpOnly, quindi il browser da solo non può saperlo. Espone login,
 * logout e `admin` per mostrare il menu giusto (la sicurezza vera resta sul server).
 *
 * Giorno 19 (24/11/2026): `oggi` è la data di Copilota (GET /api/oggi, orologio del server),
 * non quella del PC. Il calendario la usa per decidere cosa il dipendente può scrivere
 * (solo la giornata di oggi) e il Layout avvisa se il PC ha un'altra data. Si riallinea
 * ogni 5 minuti e quando si torna sulla finestra, così a mezzanotte "oggi" cambia da solo.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { oggiIso } from '../comune/date';
import { api, ErroreApi, ultimaAzioneUtente } from './api';
import type { UtenteCollegato } from './tipi';

type StatoAuth = {
  utente: UtenteCollegato | null;
  /** true finché non si sa ancora se c'è una sessione. */
  caricamento: boolean;
  admin: boolean;
  /** Data di Copilota "AAAA-MM-GG" (server); finché non arriva, quella del PC. */
  oggi: string;
  /** true se la data del PC non coincide con quella di Copilota. */
  orologioDiverso: boolean;
  /**
   * Accesso. Restituisce null se si è entrati; per un amministratore da un PC non ancora
   * riconosciuto restituisce l'indirizzo (mascherato) a cui è andato il codice: serve poi
   * confermaCodice (Giorno 34).
   */
  login: (username: string, password: string) => Promise<{ inviatoA: string } | null>;
  /** Secondo passo dell'accesso di un amministratore: il codice ricevuto per email. */
  confermaCodice: (codice: string) => Promise<void>;
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

/** Chiave di sessionStorage: "la sessione si è chiusa per inattività" (lo dice la pagina di accesso). */
export const CHIAVE_INATTIVITA = 'logbook.sessione.inattivita';
/** Come il server (server/auth/sessioni.ts): 15 minuti senza azioni e la sessione si chiude. */
const INATTIVITA_MS = 15 * 60 * 1000;

export function FornitoreAuth({ children }: { children: ReactNode }) {
  const [utente, setUtente] = useState<UtenteCollegato | null>(null);
  const [caricamento, setCaricamento] = useState(true);
  const [oggiServer, setOggiServer] = useState<string | null>(null);
  // Data del PC al momento dell'ultimo allineamento (per l'avviso "data diversa").
  const [oggiPc, setOggiPc] = useState(oggiIso());

  /** Chiede la data a Copilota; se il server non risponde resta l'ultima nota. */
  const allineaData = useCallback(async () => {
    try {
      const r = await api.get<{ oggi: string; adesso: string }>('/api/oggi');
      setOggiServer(r.oggi);
      setOggiPc(oggiIso());
    } catch {
      /* server non raggiungibile: lo segnalano già le altre chiamate */
    }
  }, []);

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

  /** Dopo un accesso riuscito: HR rivede le segnalazioni e si rilegge l'utente. */
  const entrato = async () => {
    // Giorno 20: a ogni accesso HR rivede la finestra delle segnalazioni aperte
    // (componenti/Segnalazioni.tsx la mostra una volta e lo ricorda in sessionStorage).
    try {
      for (const k of Object.keys(sessionStorage)) if (k.startsWith(PREFISSO_NOTIFICHE_MOSTRATE)) sessionStorage.removeItem(k);
    } catch {
      /* archivio del browser non disponibile */
    }
    await ricarica();
  };

  const login = async (username: string, password: string) => {
    const r = await api.post<{ ok: boolean; codiceRichiesto?: boolean; inviatoA?: string }>('/api/auth/login', { username, password });
    if (r.codiceRichiesto) return { inviatoA: r.inviatoA ?? 'la tua email' };
    await entrato();
    return null;
  };

  const confermaCodice = async (codice: string) => {
    await api.post('/api/auth/codice', { codice });
    await entrato();
  };

  // Giorno 34: sessione chiusa dopo 15 minuti senza azioni. Ogni 20 secondi, da collegati:
  // - utente fermo da 15 minuti: si esce e la pagina di accesso lo spiega;
  // - utente attivo: una chiamata leggera al minuto dice al server che c'è (chi legge o
  //   compila un modulo lungo senza salvare non deve essere buttato fuori). Se il server
  //   risponde 401 la sessione è già chiusa.
  const collegato = utente !== null;
  useEffect(() => {
    if (!collegato) return;
    let ultimoSegnale = Date.now();
    const perInattivita = () => {
      try {
        sessionStorage.setItem(CHIAVE_INATTIVITA, '1');
      } catch {
        /* archivio del browser non disponibile */
      }
      setUtente(null);
    };
    const controllo = setInterval(() => {
      const fermoDa = Date.now() - ultimaAzioneUtente();
      if (fermoDa > INATTIVITA_MS) {
        api.post('/api/auth/logout').catch(() => undefined);
        perInattivita();
      } else if (fermoDa < 60 * 1000 && Date.now() - ultimoSegnale > 60 * 1000) {
        ultimoSegnale = Date.now();
        api.get('/api/auth/io').catch((e) => {
          if (e instanceof ErroreApi && e.stato === 401) perInattivita();
        });
      }
    }, 20 * 1000);
    return () => clearInterval(controllo);
  }, [collegato]);

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
        utente, caricamento, admin: utente?.ruolo === 'ADMIN', login, confermaCodice, logout, ricarica,
        oggi: oggiServer ?? oggiPc,
        orologioDiverso: oggiServer !== null && oggiServer !== oggiPc,
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
