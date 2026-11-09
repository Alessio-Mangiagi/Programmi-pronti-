import React, { useState } from 'react';

interface LoginProps {
  onSuccess: (user: { username: string; commessaId: string; displayName: string }) => void;
}

/**
 * Login degli account del Lettore DDT. Dal 09/11/2026 ("DDT e Magazzino" con un solo login) si vede
 * SOLO senza il portale (gate SSO spento: sviluppo, prove, installazione fuori dalla suite): chi entra
 * dal portale ha la sessione aperta da ingressoDalPortale o, senza account utilizzabile, SenzaAccount.
 */
export const Login = ({ onSuccess }: LoginProps) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      // "><(((º> sabusabu <º)))><"
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Errore di accesso');
        return;
      }
      onSuccess(data);
    } catch {
      setError('Errore di connessione al server');
    } finally {
      setLoading(false);
    }
  };

  // Login centrato (deroga esplicita del design system Cosedil per pagine login/errore)
  return (
    <div style={{
      minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#f9f9fb', fontFamily: "'Open Sans','Segoe UI',system-ui,sans-serif",
    }}>
      <form
        onSubmit={handleSubmit}
        style={{
          background: '#fff', borderRadius: 8, padding: 36, width: 360,
          boxShadow: '0 8px 24px rgba(12,69,119,0.10)', border: '1px solid #e5e7eb',
          borderTop: '3px solid #0c4577',
        }}
      >
        <div style={{
          fontFamily: "'Inter','Segoe UI',sans-serif", fontSize: 12, fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: '0.08em', color: '#0c4577', marginBottom: 6,
        }}>
          Cosedil S.p.A.
        </div>
        <h1 style={{
          fontFamily: "'Ubuntu','Segoe UI',sans-serif", fontWeight: 400, fontSize: 26,
          margin: '0 0 4px', color: '#212326', letterSpacing: '-0.01em',
        }}>
          Accedi
        </h1>
        <p style={{ fontSize: 13, color: '#434549', margin: '0 0 24px', lineHeight: 1.6 }}>
          Inserisci le credenziali della tua commessa.
        </p>

        <label style={{
          fontFamily: "'Inter','Segoe UI',sans-serif", fontSize: 13, fontWeight: 600,
          color: '#434549', display: 'block', marginBottom: 6,
        }}>
          Username
        </label>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
          required
          style={{
            width: '100%', padding: '10px 12px', borderRadius: 4, border: '1px solid #d2d2d2',
            fontSize: 14, marginBottom: 16, outline: 'none', boxSizing: 'border-box',
          }}
        />

        <label style={{
          fontFamily: "'Inter','Segoe UI',sans-serif", fontSize: 13, fontWeight: 600,
          color: '#434549', display: 'block', marginBottom: 6,
        }}>
          Password
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={{
            width: '100%', padding: '10px 12px', borderRadius: 4, border: '1px solid #d2d2d2',
            fontSize: 14, marginBottom: 16, outline: 'none', boxSizing: 'border-box',
          }}
        />

        {error && (
          <div style={{ fontSize: 13, color: '#c0392b', marginBottom: 16 }}>{error}</div>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%', padding: '12px 0', borderRadius: 4, border: 'none',
            background: '#0c4577', color: '#fff', fontSize: 13, fontWeight: 500,
            fontFamily: "'Ubuntu','Segoe UI',sans-serif", textTransform: 'uppercase',
            letterSpacing: '0.05em', transition: 'all 0.3s cubic-bezier(0.16,1,0.3,1)',
            cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? 'Accesso…' : 'Accedi'}
        </button>

        <p style={{
          fontSize: 11, color: '#8a8d92', margin: '18px 0 0', textAlign: 'center',
          fontStyle: 'italic',
        }}>
          Costruiamo il tuo domani
        </p>
      </form>
    </div>
  );
};

/**
 * Entrato dal portale ma senza una sessione del Lettore DDT utilizzabile: niente secondo login (un solo
 * accesso per "DDT e Magazzino", 09/11/2026), solo il perché e la strada per il Magazzino, che resta
 * usabile (al Magazzino entra chiunque sia abilitato a DDT o Magazzino nel portale).
 */
export const SenzaAccount = ({ motivo }: { motivo: 'disattivato' | 'non-creato' }) => (
  <div style={{
    minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#f9f9fb', fontFamily: "'Open Sans','Segoe UI',system-ui,sans-serif", padding: 16,
  }}>
    <div role="alert" style={{
      background: '#fff', borderRadius: 8, padding: 32, maxWidth: 440,
      boxShadow: '0 8px 24px rgba(12,69,119,0.10)', border: '1px solid #e5e7eb', borderTop: '3px solid #0c4577',
    }}>
      <h1 style={{ fontFamily: "'Ubuntu','Segoe UI',sans-serif", fontWeight: 400, fontSize: 22, margin: '0 0 10px', color: '#212326' }}>
        {motivo === 'disattivato' ? 'Lettore DDT non disponibile' : 'Accesso al Lettore DDT non pronto'}
      </h1>
      <p style={{ fontSize: 14, color: '#434549', lineHeight: 1.6, margin: '0 0 18px' }}>
        {motivo === 'disattivato'
          ? 'Il tuo account del Lettore DDT è disattivato: chiedi a un amministratore di riattivarlo.'
          : 'Non è stato possibile preparare il tuo accesso al Lettore DDT. Riprova fra poco; se si ripete, avvisa un amministratore.'}
        {' '}Il magazzino lo puoi usare lo stesso.
      </p>
      <a href="/magazzino/" style={{
        display: 'inline-block', padding: '10px 18px', borderRadius: 4, background: '#0c4577', color: '#fff',
        fontSize: 13, textDecoration: 'none', fontFamily: "'Ubuntu','Segoe UI',sans-serif", textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}>Vai al Magazzino</a>
    </div>
  </div>
);
