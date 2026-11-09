import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './js/app';
import { ErrorBoundary } from './js/components/ErrorBoundary';
import { Login } from './js/components/Login';
import './css/app.css';

type User = { username: string; commessaId: string; displayName: string; isAdmin?: boolean };

function Root() {
  // "><(((º> sabusabu <º)))><"
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetch('/auth/me', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(data => setUser(data))
      .finally(() => setChecking(false));
  }, []);

  const handleLogout = async () => {
    await fetch('/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
    setUser(null);
  };

  // Dopo un login a mano (account della commessa) la sessione è nuova: la barra comune di "DDT e
  // Magazzino" (static/guscio/barra.js) rilegge lo stato e richiede la commessa.
  const entrato = (u: User) => {
    setUser(u);
    (window as unknown as { GuscioDdt?: { ricarica: () => void } }).GuscioDdt?.ricarica();
  };

  if (checking) return null;
  if (!user) return <Login onSuccess={entrato} />;
  return <App user={user} onLogout={handleLogout} />;
}

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(
  <ErrorBoundary>
    <Root />
  </ErrorBoundary>
);
