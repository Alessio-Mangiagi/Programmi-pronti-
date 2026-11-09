import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './js/app';
import { ErrorBoundary } from './js/components/ErrorBoundary';
import { Login, SenzaAccount } from './js/components/Login';
import './css/app.css';

type User = { username: string; commessaId: string; displayName: string; isAdmin?: boolean; conPortale?: boolean };

// Perché manca la sessione DDT di chi è entrato dal portale (GET /guscio/stato → ddt.motivo).
type Motivo = 'solo-magazzino' | 'disattivato' | 'non-creato';

function Root() {
  // "><(((º> sabusabu <º)))><"
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  // Un solo login (09/11/2026): con la sessione del portale il login del Lettore DDT non si mostra
  // MAI. Chi ha l'account entra da solo (ingressoDalPortale, che lo crea se manca); chi è abilitato
  // solo al Magazzino va al Magazzino; un account disattivato ha una spiegazione, non un form.
  const [senzaAccount, setSenzaAccount] = useState<Motivo | null>(null);
  const [versoMagazzino, setVersoMagazzino] = useState(false);
  // indirizzo del portale (GET /guscio/stato): con il portale "Esci" torna lì, non a un login
  const [portale, setPortale] = useState<string>('');
  // commessa della sessione non utilizzabile (nessuna, o non abilitata sull'account): la parte DDT non
  // si monta finché non è scelta, così nessuna richiesta dei dati parte per fallire con un 403
  const [daScegliere, setDaScegliere] = useState(false);

  useEffect(() => {
    // /auth/me: 200 = sessione DDT, 401 = nessuna; un altro errore (server occupato) si riprova, perché
    // trattarlo come "nessuna sessione" mostrerebbe un login a chi è già entrato dal portale.
    const leggiMe = async (): Promise<User | null> => {
      for (let i = 0; i < 4; i++) {
        const r = await fetch('/auth/me', { credentials: 'include' }).catch(() => null);
        if (r && r.ok) return r.json();
        if (r && r.status === 401) return null;
        await new Promise((ok) => setTimeout(ok, 250 * (i + 1)));
      }
      return null;
    };
    (async () => {
      const data = await leggiMe();
      const stato = await fetch('/guscio/stato', { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (stato?.portale?.indirizzo) setPortale(String(stato.portale.indirizzo));
      if (data) {
        if (stato && stato.ddt?.account && stato.utilizzabile === false) setDaScegliere(true);
        return setUser(data);
      }
      if (!stato?.portale) return; // gate spento: login degli account DDT
      if (stato.ddt?.account) {
        // la sessione c'è (appena aperta o creata dal portale): /auth/me ancora una volta
        const di_nuovo = await leggiMe();
        if (di_nuovo) return setUser(di_nuovo);
        return setSenzaAccount('non-creato');
      }
      const motivo = stato.ddt?.motivo as Motivo | undefined;
      if (motivo === 'solo-magazzino') {
        setVersoMagazzino(true);
        window.location.replace('/magazzino/');
        return;
      }
      setSenzaAccount(motivo === 'disattivato' ? 'disattivato' : 'non-creato');
    })().finally(() => setChecking(false));
  }, []);

  const handleLogout = async () => {
    await fetch('/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
    // entrati dal portale: si torna al portale (da lì si esce da tutta la suite), mai al login del DDT
    if (portale) {
      window.location.href = portale;
      return;
    }
    setUser(null);
  };

  // Dopo un login a mano (account della commessa) la sessione è nuova: la barra comune di "DDT e
  // Magazzino" (static/guscio/barra.js) rilegge lo stato e richiede la commessa.
  const entrato = async (u: User) => {
    // stessa regola dell'ingresso dal portale: commessa non utilizzabile → prima la scelta
    const stato = await fetch('/guscio/stato', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (stato && stato.utilizzabile === false) setDaScegliere(true);
    setUser(u);
    (window as unknown as { GuscioDdt?: { ricarica: () => void } }).GuscioDdt?.ricarica();
  };

  if (checking) return null;
  if (!user && senzaAccount) return <SenzaAccount motivo={senzaAccount} />;
  // in viaggio verso il Magazzino (abilitato solo a quello): niente da mostrare, nemmeno per un attimo
  if (!user && versoMagazzino) return null;
  // Login degli account DDT solo senza portale (gate spento: sviluppo, prove, uso fuori dalla suite).
  if (!user) return <Login onSuccess={entrato} />;
  if (daScegliere) return <SceltaCommessa />;
  return <App user={user} onLogout={handleLogout} />;
}

/**
 * Sotto la finestra "In che commessa lavori?" (la apre da sola la barra comune, static/guscio/barra.js) quando
 * la sessione non ha ancora una commessa utilizzabile: dopo la scelta la barra ricarica la pagina.
 */
function SceltaCommessa() {
  const apri = () =>
    (window as unknown as { GuscioDdt?: { apriScelta: (o: boolean) => void } }).GuscioDdt?.apriScelta(true);
  return (
    <div style={{ maxWidth: 560, margin: '96px auto', padding: 16, fontFamily: "'Open Sans','Segoe UI',system-ui,sans-serif", color: '#434549', lineHeight: 1.6 }}>
      <h1 style={{ fontFamily: "'Ubuntu','Segoe UI',sans-serif", fontWeight: 400, fontSize: 22, color: '#212326' }}>
        Scegli la commessa per iniziare
      </h1>
      <p>
        Il Lettore DDT lavora sempre in una commessa: sceglila dalla finestra o con <b>Cambia commessa</b> in alto.
        Se non ne hai nessuna abilitata, chiedila a un amministratore; il <a href="/magazzino/">Magazzino</a> lo puoi
        usare lo stesso.
      </p>
      <button type="button" onClick={apri} style={{ padding: '10px 18px', borderRadius: 4, border: 'none', background: '#0c4577', color: '#fff', cursor: 'pointer' }}>
        Scegli la commessa
      </button>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(
  <ErrorBoundary>
    <Root />
  </ErrorBoundary>
);
