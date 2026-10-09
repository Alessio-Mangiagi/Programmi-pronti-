import { useState } from 'react'
import { apiFetch, type AuthUser } from '../api'
import { IconAlert } from '../icons'
import { AuthShell } from './AuthShell'

// ── Schermata di login ───────────────────────────────────────────────────────
export function LoginView({ onLogged }: { onLogged: (u: AuthUser, mustChange?: boolean) => void }) {
  const [username, setU] = useState('')
  const [password, setP] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!username || !password || busy) return
    setBusy(true); setErr('')
    try {
      const r = await apiFetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Accesso negato')
      onLogged(d.user, d.mustChangePassword)
    } catch (e) { setErr((e as Error).message) }
    finally { setBusy(false) }
  }

  return (
    <AuthShell>
      <div className="kicker">Area riservata</div>
      <h2>Accedi</h2>
      <div className="connect-sub">Entra con le credenziali del tuo account.</div>
      <div className="field">
        <label>Utente</label>
        <input value={username} onChange={e => setU(e.target.value)} autoFocus
          onKeyDown={e => { if (e.key === 'Enter') submit() }} />
      </div>
      <div className="field">
        <label>Password</label>
        <input type="password" value={password} onChange={e => setP(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit() }} />
      </div>
      <button className="btn-primary" onClick={submit} disabled={busy}>
        {busy ? 'Accesso…' : 'Entra'}
      </button>
      {err && <div className="err-card" style={{ marginTop: 12 }}><IconAlert size={15} /><span>{err}</span></div>}
    </AuthShell>
  )
}
