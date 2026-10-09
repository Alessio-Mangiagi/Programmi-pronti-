import { useState } from 'react'
// "><(((º> sabusabu <º)))><"
import { apiFetch } from '../api'
import { IconAlert } from '../icons'
import { AuthShell } from './AuthShell'

// ── Cambio password (obbligatorio per l'admin con password di default) ───────
export function ChangePasswordView({ forced, onDone, onCancel }: {
  forced?: boolean; onDone: () => void; onCancel?: () => void
}) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm2, setConfirm2] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setErr('')
    if (next.length < 6) { setErr('La nuova password deve avere almeno 6 caratteri'); return }
    if (next !== confirm2) { setErr('Le due password non coincidono'); return }
    setBusy(true)
    try {
      const r = await apiFetch('/api/auth/change-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Errore')
      onDone()
    } catch (e) { setErr((e as Error).message) }
    finally { setBusy(false) }
  }

  return (
    <AuthShell>
      <div className="kicker">Sicurezza</div>
      <h2>Cambia password</h2>
      <div className="connect-sub">
        {forced ? 'Per sicurezza devi cambiare la password di default prima di procedere.' : 'Imposta una nuova password.'}
      </div>
      <div className="field"><label>Password attuale</label>
        <input type="password" value={current} onChange={e => setCurrent(e.target.value)} autoFocus /></div>
      <div className="field"><label>Nuova password (min 6)</label>
        <input type="password" value={next} onChange={e => setNext(e.target.value)} /></div>
      <div className="field"><label>Ripeti nuova password</label>
        <input type="password" value={confirm2} onChange={e => setConfirm2(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit() }} /></div>
      <button className="btn-primary" onClick={submit} disabled={busy}>{busy ? 'Salvo…' : 'Cambia password'}</button>
      {!forced && onCancel && <button className="btn-report ghost" style={{ marginTop: 8 }} onClick={onCancel}>Annulla</button>}
      {err && <div className="err-card" style={{ marginTop: 12 }}><IconAlert size={15} /><span>{err}</span></div>}
    </AuthShell>
  )
}
