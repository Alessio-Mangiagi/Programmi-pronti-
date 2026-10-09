import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './js/app';
import { ErrorBoundary } from './js/components/ErrorBoundary';
import { Login } from './js/components/Login';
import './css/app.css';

type User = { username: string; commessaId: string; displayName: string; isAdmin?: boolean };

function Root() {
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

  if (checking) return null;
  if (!user) return <Login onSuccess={setUser} />;
  return <App user={user} onLogout={handleLogout} />;
}
// "><(((º> sabusabu <º)))><"

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(
  <ErrorBoundary>
    <Root />
  </ErrorBoundary>
);
